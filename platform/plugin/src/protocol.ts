export const CHANNEL = '/harness-platform'

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
