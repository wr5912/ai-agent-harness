declare module 'harness-mcp-manager-server' {
  export const name: string
  export const inject: string[]
  export const Config: any
  export function apply(ctx: any, config: any): void
}
declare module 'harness-mcp-manager-client' {
  import type { ComponentType } from 'react'
  export const Manager: ComponentType<{ view: string; toolbarTarget: HTMLElement | null; form: { state: any }; write: (ops: any, revision: number) => Promise<any> }>
}
declare module 'harness-mcp-manager-openapi' {
  export function loadOpenApi(server: any): Promise<any>
  export function execute(source: any, operation: any, args: any): Promise<{ response: Response; text: string; uri: string }>
}
