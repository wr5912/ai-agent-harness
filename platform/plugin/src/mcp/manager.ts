import type { Context } from '@deepseek-ai/cordis'
import * as manager from 'harness-mcp-manager-server'
import { workspaceConfigPath } from '../workspace.ts'
import { COMPOSITION_SERVICE_ID, publishedCompositionService, readCompositions } from './compositions.ts'
import { createPublishedCompositionClient } from './index.ts'
import { createManagedMcpHandler } from './native.ts'
import { executableCatalog, type CompositionExtension } from './extension.ts'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'

export const { name, Config } = manager
export const inject = manager.inject
export interface ManagerConfig {
  servers: { get(): any[] }
  groups: { get(): any[] }
  dispatch?: (request: any, signal?: AbortSignal) => Promise<{ status: number; value: any }>
  compositionHandler?: ConnectionRpcHandler
  compositionExtension?: CompositionExtension
  currentGroup?: (id: string) => { id: string; targetDigest: string } | undefined
}
declare module '@deepseek-ai/cordis' {
  interface Context { platformMcp: ManagerConfig }
}
export function apply(ctx: Context, config: ManagerConfig) {
  const assetRoot = process.env.HARNESS_ASSET_ROOT
  if (!assetRoot) throw new Error('未设置 HARNESS_ASSET_ROOT')
  let dispatch: ManagerConfig['dispatch']
  const compositionExtension: CompositionExtension = {}
  const compositionHandler = createManagedMcpHandler(assetRoot, () => config.servers.get(), { extension: compositionExtension })
  const platformClient = createPublishedCompositionClient(assetRoot, compositionHandler)
  manager.apply(ctx, { ...config, platformClient, platformDispatch: (handler: NonNullable<ManagerConfig['dispatch']>) => { dispatch = handler }, servers: { get() {
    const servers = config.servers.get()
    if (servers.some(server => server.id === COMPOSITION_SERVICE_ID || server.platformComposition)) throw new Error('platform-compositions 是已发布编排的保留服务 ID')
    const catalog = readCompositions(workspaceConfigPath(assetRoot, 'mcp-compositions.json')).catalog
    const service = publishedCompositionService(catalog, executableCatalog(catalog, compositionExtension))
    return service ? [...servers, service] : servers
  } } })
  ctx.provide('platformMcp', { ...config, compositionHandler, compositionExtension,
    currentGroup: id => (ctx as any).mcpSessionManager.currentGroup(id), dispatch: (request, signal) => {
    if (!dispatch) throw new Error('MCP 管理服务尚未就绪')
    return dispatch(request, signal)
  } })
}
