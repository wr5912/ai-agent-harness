import { createHash } from 'node:crypto'

export const COMPOSITION_TOOL_NAME = 'query_asset_related_alerts'

export const compositionDefinition = {
  schema_version: '1.0',
  id: 'security-asset-related-alerts-readonly',
  title: '资产相关告警只读查询',
  readonly: true,
  inputSchema: {
    type: 'object',
    properties: {
      asset: { type: 'string', description: '资产 ID、主机名或 IP' },
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
    },
    required: ['asset'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      asset: { type: 'object' },
      alerts: { type: 'array', items: { type: 'object' } },
      trace: { type: 'array', items: { type: 'object' } },
    },
    required: ['asset', 'alerts', 'trace'],
  },
  upstream: {
    kind: 'openapi',
    connectionId: 'security-readonly-api',
    operations: ['get_asset', 'list_alerts'],
  },
  steps: [
    {
      id: 'asset',
      title: '查询资产',
      operationId: 'get_asset',
      input: { asset: '$input.asset' },
      output: 'asset',
    },
    {
      id: 'alerts',
      title: '查询相关告警',
      operationId: 'list_alerts',
      dependsOn: ['asset'],
      input: { assetId: '$steps.asset.id', limit: '$input.limit' },
      output: 'alerts',
    },
  ],
} as const

export function compositionDigest(gitCommit = 'unknown', gitDirty: boolean | 'unknown' = 'unknown', sourceDigest = 'unknown'): string {
  return createHash('sha256').update(JSON.stringify({ gitCommit, gitDirty, sourceDigest, definition: compositionDefinition })).digest('hex')
}
