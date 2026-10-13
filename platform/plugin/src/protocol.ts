import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'

export const CHANNEL = '/harness-platform'

// 服务端模块处理去掉前缀后的 endpoint，页面使用同一个原生认证 RPC。
export const DOMAIN_PREFIXES = ['agents/', 'instances/', 'mcp/'] as const
export interface PlatformPageProps {
  rpc: ClientConnectionRpc
}

export interface Asset {
  id: string
  path: string
}

export interface RunAsset extends Asset {
  experiment_id: string
}

export interface Inventory {
  schema_version: '1.0'
  root: string
  observed_at: string
  agents: Asset[]
  experiments: Asset[]
  runs: RunAsset[]
}
