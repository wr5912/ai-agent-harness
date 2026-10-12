import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { inventory as agentExperimentInventory } from '../../asset-query-cli/query.mjs'
import { CHANNEL } from './protocol.ts'
import type { Inventory, RunAsset } from './protocol.ts'

export const name = 'harness-platform'
export const inject = ['connection', 'webServer']

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
  return async (endpoint, payload, signal) => {
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

export function apply(ctx: Context) {
  const assetRoot = process.env.HARNESS_ASSET_ROOT
  if (!assetRoot) throw new Error('未设置 HARNESS_ASSET_ROOT')
  // 当前 Cordis 的 Service getter 在内部注册时沿提供方 Fiber 解析依赖。
  // 把已注入的载体绑定到子上下文，供原生 RPC 注册读取；父上下文不变。
  const registrationContext = ctx.extend({ webServer: ctx.webServer })
  registrationContext.connection.rpc.handle(CHANNEL, createInventoryHandler(assetRoot))
}
