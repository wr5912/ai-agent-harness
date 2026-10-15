import type { Context } from '@deepseek-ai/cordis'
import * as manager from 'harness-mcp-manager-server'
import { join } from 'node:path'
import { COMPOSITION_SERVICE_ID, publishedCompositionService, readCompositions } from './compositions.ts'
import { createPublishedCompositionClient } from './index.ts'
import { createManagedMcpHandler } from './native.ts'

export const { name, inject, Config } = manager
export interface ManagerConfig {
  servers: { get(): any[] }
  groups: { get(): any[] }
  dispatch?: (request: any, signal?: AbortSignal) => Promise<{ status: number; value: any }>
}
declare module '@deepseek-ai/cordis' {
  interface Context { platformMcp: ManagerConfig }
}
export function apply(ctx: Context, config: ManagerConfig) {
  const assetRoot = process.env.HARNESS_ASSET_ROOT
  if (!assetRoot) throw new Error('未设置 HARNESS_ASSET_ROOT')
  const platformClient = createPublishedCompositionClient(assetRoot, createManagedMcpHandler(assetRoot, () => config.servers.get()))
  let dispatch: ManagerConfig['dispatch']
  manager.apply(ctx, { ...config, platformClient, platformDispatch: (handler: NonNullable<ManagerConfig['dispatch']>) => { dispatch = handler }, servers: { get() {
    const servers = config.servers.get()
    if (servers.some(server => server.id === COMPOSITION_SERVICE_ID || server.platformComposition)) throw new Error('platform-compositions 是已发布编排的保留服务 ID')
    const service = publishedCompositionService(readCompositions(join(assetRoot, 'platform/mcp-compositions.json')).catalog)
    return service ? [...servers, service] : servers
  } } })
  ctx.provide('platformMcp', { ...config, dispatch: (request, signal) => {
    if (!dispatch) throw new Error('MCP 管理服务尚未就绪')
    return dispatch(request, signal)
  } })
}
