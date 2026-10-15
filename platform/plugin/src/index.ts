import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type * as NativeWebApp from '@deepseek-ai/dsh-web-app'
import { applyAuthentication } from './auth.ts'
import { inventory as agentExperimentInventory } from '../../../plugins/asset-query-cli/query.mjs'
import { CHANNEL } from './protocol.ts'
import type { Inventory, RunAsset } from './protocol.ts'
import { DOMAIN_PREFIXES } from './protocol.ts'
import { recentRuns } from './dashboard.ts'
import { createAgentsHandler } from './agents/index.ts'
import { createInstancesHandler } from './instances/index.ts'
import { applyMcpGateway, createMcpHandler } from './mcp/index.ts'
import type {} from './mcp/manager.ts'
import { createManagedMcpHandler } from './mcp/native.ts'
import { runtimeModule } from '../../../runtime/adapters/dsh-web/src/resolve-runtime.ts'

// 使用启动器核对过的全局 Runtime；开发依赖只提供类型和隔离测试环境。
const WebApp: typeof NativeWebApp = await runtimeModule('@deepseek-ai/dsh-web-app')

export const name = 'harness-platform'
export const inject = ['connection', 'webServer', 'credentials', 'platformMcp']
export const Config = WebApp.Config
export type Config = NativeWebApp.Config

const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function inventory(assetRoot: string): Inventory {
  const root = resolve(assetRoot)
  const assets = agentExperimentInventory(root)
  const runs: RunAsset[] = []
  for (const id of assets.experiments) {
    const base = `evolution/experiments/${id}/runs`
    let entries
    try {
      entries = readdirSync(join(root, base), { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries.filter(entry => entry.isDirectory() && RUN_ID.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      runs.push({ id: entry.name, experiment_id: id, path: `${base}/${entry.name}` })
    }
  }
  return {
    schema_version: '1.0',
    root,
    observed_at: new Date().toISOString(),
    agents: assets.agents.map(id => ({ id, path: `agents/${id}` })),
    experiments: assets.experiments.map(id => ({ id, path: `evolution/experiments/${id}` })),
    runs,
  }
}

function failure(code: string, message: string, details = {}): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details } }
}

export function createInventoryHandler(assetRoot: string): ConnectionRpcHandler {
  return async (endpoint, payload, signal, peer) => {
    if (endpoint !== 'inventory') return failure('not_found', '未知的资产查询操作')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
      return failure('invalid_request', 'inventory 不接受查询参数')
    }
    if (signal.aborted) return failure('aborted', '资产查询已取消')
    try {
      return { ok: true, value: inventory(assetRoot) }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown'
      return failure('asset_read_failed', '无法读取仓库资产', { filesystem_code: code })
    }
  }
}

export function createPlatformHandler(assetRoot: string, domains: Record<'agents' | 'instances' | 'mcp', ConnectionRpcHandler>): ConnectionRpcHandler {
  const readInventory = createInventoryHandler(assetRoot)
  return async (endpoint, payload, signal, peer) => {
    if (signal.aborted) return failure('aborted', '请求已取消')
    if (endpoint === 'inventory') return readInventory(endpoint, payload, signal, peer)
    if (endpoint === 'home') {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) {
        return failure('invalid_request', '首页查询不接受参数')
      }
      try {
        const assets = inventory(assetRoot)
        const [runs, instances, mcp] = await Promise.all([
          recentRuns(assets.root, assets.agents.map(agent => agent.id), signal),
          domains.instances('list', {}, signal, peer),
          domains.mcp('list', {}, signal, peer),
        ])
        return { ok: true, value: { recent_runs: runs, instances, mcp } }
      } catch {
        return failure('run_read_failed', '无法读取 Run 索引，请核对记录和 Python 环境。')
      }
    }
    const prefix = DOMAIN_PREFIXES.find(value => endpoint.startsWith(value))
    if (!prefix) return failure('not_found', '未知的平台操作')
    const result = await domains[prefix.slice(0, -1) as keyof typeof domains](endpoint.slice(prefix.length), payload, signal, peer)
    if (endpoint === 'agents/detail' && result.ok) {
      const instances = await domains.instances('list', {}, signal, peer)
      const value = result.value as { experiment: { id: string }; loaded_instance: unknown }
      value.loaded_instance = instances.ok
        ? { status: 'observed', instances: (instances.value as { instances: { source_id: string }[] }).instances
          .filter(instance => instance.source_id === `experiment:${value.experiment.id}`),
        note: '实例与只读挂载来自 Docker 观察；具体能力是否生效仍需相应 Session/Run 证据。' }
        : { status: 'unknown', reason: instances.error.message }
    }
    return result
  }
}

export function applyTools(ctx: Context) {
  const assetRoot = process.env.HARNESS_ASSET_ROOT
  if (!assetRoot) throw new Error('未设置 HARNESS_ASSET_ROOT')
  // 当前 Cordis 的 Service getter 在内部注册时沿提供方 Fiber 解析依赖。
  // 把已注入的载体绑定到子上下文，供原生 RPC 注册读取；父上下文不变。
  const registrationContext = ctx.extend({ webServer: ctx.webServer })
  const manager = ctx.platformMcp
  const mcp = manager ? createManagedMcpHandler(assetRoot, () => manager.servers.get()) : createMcpHandler(assetRoot)
  registrationContext.connection.rpc.handle(CHANNEL, createPlatformHandler(assetRoot, {
    agents: createAgentsHandler(assetRoot), instances: createInstancesHandler(assetRoot), mcp,
  }))
  applyMcpGateway(registrationContext, assetRoot, mcp)
}

export async function apply(ctx: Context, config: Config) {
  const assetRoot = process.env.HARNESS_ASSET_ROOT
  if (!assetRoot) throw new Error('未设置 HARNESS_ASSET_ROOT')
  await applyAuthentication(ctx, assetRoot)
  applyTools(ctx)
  WebApp.apply(ctx, { ...config, publicUrl: `${ctx.webServer.protocol}//${ctx.webServer.host}:${ctx.webServer.port}${ctx.webServer.publicPath('/')}` })
}
