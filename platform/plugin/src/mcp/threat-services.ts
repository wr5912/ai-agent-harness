import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { ensureThreatSource } from './threat/source.ts'
import type { ThreatModelRoute, ThreatServices } from './threat/types.ts'

type Dispatch = (request: Record<string, any>, signal?: AbortSignal) => Promise<{ status: number; value: any }>

/** 原生管理器负责连接认证，原生模型服务负责凭据；阶段进程只访问本次回环桥。 */
export function createNativeThreatServices(assetRoot: string, dispatch: Dispatch, llm: any, defaultModel: () => ThreatModelRoute, servers: () => any[] = () => []): ThreatServices {
  const catalogs = new Map<string, { specUrl: string; tools: any[] }>()
  const connectionFingerprint = (connectionId: string): string => {
    const server = servers().find(item => item.id === connectionId && item.enabled !== false)
    if (!server || !(server.specUrl || server.url)) throw new Error('threat_connection_conflict')
    const target = new URL(server.specUrl || server.url)
    target.username = ''; target.password = ''
    // 凭据可以轮换；目标身份不保存或依赖其值。
    for (const key of [...target.searchParams.keys()]) if (/token|secret|password|credential|authorization|api[-_]?key/i.test(key)) target.searchParams.delete(key)
    target.searchParams.sort()
    return createHash('sha256').update(JSON.stringify({ id: connectionId, kind: server.specUrl ? 'openapi' : 'mcp', target: target.href })).digest('hex')
  }
  const resolveModel = (route?: ThreatModelRoute): ThreatModelRoute => {
    const value = route ?? defaultModel()
    if (!value?.provider || !value.model) throw new Error('平台默认模型尚未配置')
    return { provider: value.provider, model: value.model, ...(value.reasoningEffort === undefined ? {} : { reasoningEffort: value.reasoningEffort }) }
  }
  return {
    connectionFingerprint,
    resolveModel,
    async invoke(connectionId, toolName, args, signal, expectedFingerprint) {
      signal.throwIfAborted()
      const assertConnection = () => {
        if (expectedFingerprint !== undefined && connectionFingerprint(connectionId) !== expectedFingerprint) throw new Error('threat_connection_conflict')
      }
      assertConnection()
      const server = servers().find(item => item.id === connectionId)
      let mapped = args
      if (server?.specUrl) {
        let catalog = catalogs.get(connectionId)
        if (!catalog || catalog.specUrl !== server.specUrl) {
          const found = await dispatch({ action: 'test', serverId: connectionId }, signal)
          assertConnection()
          if (found.status >= 400 || !Array.isArray(found.value?.tools)) throw new Error('无法发现组合依赖的 OpenAPI 工具')
          catalog = { specUrl: server.specUrl, tools: found.value.tools }
          catalogs.set(connectionId, catalog)
        }
        const tool = catalog.tools.find(item => item.name === toolName)
        if (!tool) throw new Error(`连接未暴露所需工具：${toolName}`)
        // 原生 OpenAPI 参数把 HTTP 请求体放在 body，SOC Gateway 请求体再包一层 arguments。
        const body = tool.inputSchema?.properties?.body
        if (body) mapped = { body: body.properties?.arguments ? { arguments: args } : args }
      }
      assertConnection()
      const reply = await dispatch({ action: 'callTool', serverId: connectionId, toolName, arguments: mapped, timeoutMs: 120_000 }, signal)
      if (reply.status >= 400) throw new Error(`平台连接调用失败：${connectionId}/${toolName}`)
      return reply.value
    },
    async inferFrozen(payload, route, signal) {
      signal.throwIfAborted()
      const source = await ensureThreatSource(assetRoot)
      const original = await import(pathToFileURL(source.bridgeModule).href)
      return original.inferFrozen({ llm }, resolveModel(route), payload, signal)
    },
  }
}
