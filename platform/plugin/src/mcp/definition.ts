import type { CompositionConfig } from './compositions.ts'

export function compositionInputSchema(config?: CompositionConfig) {
  const schema = compositionDefinition.inputSchema
  return config?.flow ? { ...schema, properties: { ...schema.properties,
    asset: { type: 'string', description: 'SOC 正整数资产 ID，例如 9106', pattern: '^[1-9]\\d*$' },
  } } : schema
}

export const compositionDefinition = {
  schema_version: '1.0',
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
      alertSummary: { type: 'object', description: 'SOC 告警分组的查询范围、总分组数及总告警数；alerts 为首页分组' },
      trace: { type: 'array', items: { type: 'object' } },
    },
    required: ['asset', 'alerts', 'trace'],
  },
  upstream: {
    kind: 'openapi',
    operations: ['get_asset', 'list_alerts'],
  },
} as const
