import type { CompositionConfig } from './compositions.ts'

export const INCIDENT_ID_PATTERN = '^INC-\\d{8}-\\d{6}$'
export const RUN_ID_PATTERN = '^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

export function compositionInputSchema(config?: CompositionConfig) {
  if (config?.kind) {
    const collect = config.kind === 'composite' || config.stage === 'collect'
    const key = collect ? 'incident_id' : 'run_id'
    return { type: 'object', properties: { [key]: { type: 'string', description: collect ? 'SOC 事件 ID，例如 INC-20261015-000001' : '前序阶段返回的运行 ID', pattern: collect ? INCIDENT_ID_PATTERN : RUN_ID_PATTERN } }, required: [key], additionalProperties: false }
  }
  const schema = compositionDefinition.inputSchema
  return config?.flow ? { ...schema, properties: { ...schema.properties,
    asset: { type: 'string', description: 'SOC 正整数资产 ID，例如 9106', pattern: '^[1-9]\\d*$' },
  } } : schema
}

export function compositionReadonly(config?: CompositionConfig) { return !config?.kind }

export function compositionOutputSchema(config?: CompositionConfig) {
  if (!config?.kind) return compositionDefinition.outputSchema
  return { type: 'object', properties: {
    run_id: { type: 'string' }, incident_id: { type: 'string' }, status: { type: 'string' }, phase_status: { type: 'string' },
    route: { type: 'string' }, judgement_id: { type: 'string' }, artifacts: { type: 'array', items: { type: 'object' } },
    trace: { type: 'array', items: { type: 'object' } },
    ...(config.kind === 'composite' ? { stepValues: { type: 'object', description: '已实际执行的子组合结果；全部跳过时为空，工具返回失败。' } } : {}),
  }, required: config.kind === 'composite' ? ['stepValues', 'trace'] : ['run_id', 'incident_id', 'status', 'phase_status', 'artifacts', 'trace'] }
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
