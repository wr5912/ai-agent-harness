import type { Context } from '@deepseek-ai/cordis'
import * as manager from 'harness-mcp-manager-server'

export const { name, inject, Config } = manager
export interface ManagerConfig {
  servers: { get(): any[] }
  groups: { get(): any[] }
}
declare module '@deepseek-ai/cordis' {
  interface Context { platformMcp: ManagerConfig }
}
export function apply(ctx: Context, config: ManagerConfig) {
  manager.apply(ctx, config)
  ctx.provide('platformMcp', config)
}
