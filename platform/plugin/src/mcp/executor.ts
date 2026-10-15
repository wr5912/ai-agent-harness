import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { compositionDefinition, compositionInputSchema } from './definition.ts'
import type { CompositionConfig } from './compositions.ts'
import { callOpenApiOperation, loadOpenApi, type OpenApiConnection } from './openapi.ts'

export type ConnectionStatus = {
  registered: boolean
  specLoaded: boolean | 'unknown'
  toolCallSucceeded: boolean | 'unknown'
  lastError?: string
}

export type McpRegistry = {
  openapi: Map<string, OpenApiConnection>
  mcp: Map<string, any>
  status: Map<string, ConnectionStatus>
  stateFile?: string
  native?: {
    load(connection: OpenApiConnection, signal?: AbortSignal): Promise<any>
    call(source: any, operationId: string, args: Record<string, any>, signal?: AbortSignal): Promise<any>
  }
}

type PersistedState = { openapi?: OpenApiConnection[]; mcp?: any[] }

function defaultStateFile(assetRoot: string): string {
  const rootKey = createHash('sha256').update(assetRoot).digest('hex').slice(0, 16)
  const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state')
  return join(stateRoot, 'ai-agent-harness', 'platform', 'mcp', rootKey, 'connections.json')
}

export function createRegistry(assetRoot?: string, stateFile = assetRoot ? defaultStateFile(assetRoot) : undefined): McpRegistry {
  const registry: McpRegistry = { openapi: new Map(), mcp: new Map(), status: new Map(), stateFile }
  if (!stateFile || !existsSync(stateFile)) return registry
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as PersistedState
  for (const connection of state.openapi ?? []) {
    registry.openapi.set(connection.id, connection)
    registry.status.set(connection.id, { registered: true, specLoaded: 'unknown', toolCallSucceeded: 'unknown' })
  }
  for (const connection of state.mcp ?? []) {
    registry.mcp.set(connection.id, connection)
    registry.status.set(connection.id, { registered: true, specLoaded: 'unknown', toolCallSucceeded: 'unknown' })
  }
  return registry
}

export function saveRegistry(registry: McpRegistry) {
  if (!registry.stateFile) return
  mkdirSync(dirname(registry.stateFile), { recursive: true })
  const temp = `${registry.stateFile}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify({ openapi: [...registry.openapi.values()], mcp: [...registry.mcp.values()] }, null, 2))
  renameSync(temp, registry.stateFile)
}

function gitCommitOf(assetRoot: string): string {
  try {
    return execFileSync('git', ['-C', assetRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
}

function gitDirtyOf(assetRoot: string): boolean | 'unknown' {
  try {
    return execFileSync('git', ['-C', assetRoot, 'status', '--porcelain'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0
  } catch {
    return 'unknown'
  }
}

function sourceDigestOf(assetRoot: string): string {
  const files = ['client.tsx', 'definition.ts', 'compositions.ts', 'executor.ts', 'index.ts', 'openapi.ts', 'manager.ts', 'native.ts']
    .map(file => `platform/plugin/src/mcp/${file}`)
    .concat(['platform/plugin/build.mjs', 'platform/plugin/package.json', 'platform/plugin/pnpm-lock.yaml', 'platform/plugin/src/index.ts',
      ...['index.ts', 'openapi.ts'].map(file => `evolution/experiments/EXP-security-operations-expert-018-rfbf7fd53a340/candidate/dsh/managed/mcp-manager/${file}`)])
  try {
    const hash = createHash('sha256')
    for (const file of files) hash.update(file).update('\0').update(readFileSync(join(assetRoot, file)))
    return hash.digest('hex')
  } catch {
    return 'unknown'
  }
}

export function compositionVersion(assetRoot: string, config?: CompositionConfig) {
  const gitCommit = gitCommitOf(assetRoot)
  const gitDirty = gitDirtyOf(assetRoot)
  const sourceDigest = sourceDigestOf(assetRoot)
  const definition = { ...compositionDefinition, ...config, inputSchema: compositionInputSchema(config),
    upstream: { kind: 'openapi', steps: compositionSteps(config) } }
  const digest = createHash('sha256').update(JSON.stringify({ gitCommit, gitDirty, sourceDigest, definition })).digest('hex')
  return { gitCommit, gitDirty, sourceDigest, digest, definition }
}

function statusFor(registry: McpRegistry, id: string): ConnectionStatus {
  const current = registry.status.get(id) ?? { registered: registry.openapi.has(id) || registry.mcp.has(id), specLoaded: false, toolCallSucceeded: false }
  registry.status.set(id, current)
  return current
}

function bounded(value: any): any {
  if (Array.isArray(value)) return value.slice(0, 20)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50))
  return value
}

function inputString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 不能为空`)
  return value.trim()
}

function inputLimit(value: unknown): number {
  if (value === undefined) return 5
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 20) throw new Error('limit 必须是 1 到 20 的整数')
  return value
}

function compositionInput(input: Record<string, any>, config?: CompositionConfig) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['asset', 'limit'].includes(key))) throw new Error('组合输入仅接受 asset 和 limit')
  const asset = inputString(input.asset, 'asset')
  if (config?.flow && (!/^[1-9]\d*$/.test(asset) || !Number.isSafeInteger(Number(asset)))) throw new Error('SOC 查询须填写有效的正整数资产 ID')
  return { asset, limit: inputLimit(input.limit) }
}

function compositionSteps(config?: CompositionConfig) {
  const soc = config?.flow === 'soc-asset-alerts'
  return [
    { step: 'asset', title: '查询资产', connectionId: config?.connectionId,
      operationId: soc ? 'get_soc_asset_by_asset_id' : 'get_asset',
      input: soc ? { assetId: '$input.asset' } : { asset: '$input.asset' }, output: 'asset' },
    { step: 'alerts', title: soc ? '查询近 30 天关联告警分组' : '查询相关告警', connectionId: soc ? config?.alertsConnectionId : config?.connectionId,
      operationId: soc ? 'list_detect_alert' : 'list_alerts',
      input: soc ? { 'req.assetId': '$state.assetId', 'req.pageNum': 1, 'req.pageSize': '$input.limit', 'req.windowSeconds': 2592000 }
        : { assetId: '$state.assetId', limit: '$input.limit' }, output: 'alerts' },
  ]
}

const CompositionState = Annotation.Root({
  input: Annotation<{ asset: string; limit: number }>(),
  asset: Annotation<any>(),
  assetId: Annotation<string | number>(),
  alerts: Annotation<any[]>(),
  alertSummary: Annotation<any>(),
  receipts: Annotation<any[]>(),
  trace: Annotation<any[]>(),
  error: Annotation<{ code: string; message: string } | undefined>(),
})

function compositionGraph(config: CompositionConfig | undefined, call: (step: ReturnType<typeof compositionSteps>[number], args: Record<string, any>) => Promise<any>) {
  const [assetStep, alertsStep] = compositionSteps(config)
  const soc = config?.flow === 'soc-asset-alerts'
  return new StateGraph(CompositionState)
    .addNode('getAsset', async state => {
      const started = Date.now()
      const args = soc ? { assetId: Number(state.input.asset) } : { asset: state.input.asset }
      const first = await call(assetStep, args)
      const asset = soc ? first.json?.data : first.json
      const assetId = soc ? asset?.assetId : asset?.id ?? asset?.asset?.id
      const error = !first.ok ? { code: 'step_failed', message: `查询资产失败：HTTP ${first.status}` }
        : soc && first.json?.code !== 200 ? { code: 'business_failed', message: `查询资产业务失败：code ${first.json?.code ?? '缺失'}` }
        : soc ? (!Number.isSafeInteger(assetId) || assetId !== Number(state.input.asset) ? { code: 'mapping_failed', message: '第一步结果缺少或不匹配所查询的资产 ID' } : undefined)
        : typeof assetId !== 'string' || !assetId ? { code: 'mapping_failed', message: '第一步结果缺少资产 ID' } : undefined
      const trace: any[] = [{ ...assetStep, status: error ? 'failed' : 'succeeded', httpStatus: first.status, durationMs: Date.now() - started, mappedArguments: args }]
      if (error) trace.push({ ...alertsStep, status: 'skipped', reason: error.message })
      return { asset: bounded(asset), assetId, receipts: [first.receipt], trace, error }
    }, { metadata: assetStep })
    .addNode('listAlerts', async state => {
      const started = Date.now()
      const args = soc ? { req: { assetId: String(state.assetId), pageNum: 1, pageSize: state.input.limit, windowSeconds: 2592000 } }
        : { assetId: state.assetId, limit: state.input.limit }
      const second = await call(alertsStep, args)
      const items = soc ? second.json?.data?.groups : second.json?.alerts ?? second.json
      const error = !second.ok ? { code: 'step_failed', message: `查询告警失败：HTTP ${second.status}` }
        : soc && second.json?.code !== 200 ? { code: 'business_failed', message: `查询告警业务失败：code ${second.json?.code ?? '缺失'}` }
        : !Array.isArray(items) ? { code: 'mapping_failed', message: '第二步结果缺少告警列表' } : undefined
      const alerts = error ? [] : items.slice(0, state.input.limit)
      const alertSummary = soc && !error ? Object.fromEntries(['totalGroups', 'totalAlerts', 'truncated', 'from', 'to', 'pageNum', 'pageSize'].map(key => [key, second.json.data[key]])) : undefined
      return {
        alerts, alertSummary, receipts: [...state.receipts, second.receipt],
        trace: [...state.trace, { ...alertsStep, status: error ? 'failed' : 'succeeded', httpStatus: second.status, durationMs: Date.now() - started, mappedArguments: args }], error,
      }
    }, { metadata: alertsStep })
    .addEdge(START, 'getAsset')
    .addConditionalEdges('getAsset', state => state.error ? END : 'listAlerts', [END, 'listAlerts'])
    .addEdge('listAlerts', END)
    .compile({ checkpointer: false })
}

export async function compositionStructure(config?: CompositionConfig) {
  const graph = await compositionGraph(config, async () => { throw new Error('结构查询不可执行节点') }).getGraphAsync()
  return { nodes: Object.values(graph.nodes).map(node => ({ id: node.id, ...node.metadata })), edges: graph.edges }
}

export async function dryRunComposition(registry: McpRegistry, config: CompositionConfig, input: Record<string, any>) {
  const validated = compositionInput(input, config)
  for (const step of compositionSteps(config)) {
    if (!step.connectionId || !registry.openapi.has(step.connectionId)) throw new Error(`未注册组合依赖连接：${step.connectionId ?? '未选择'}`)
  }
  return { ok: true, mode: 'dry', input: validated, graph: await compositionStructure(config), upstreamRequests: 0,
    checks: ['输入有效', 'LangGraph 图已编译', '依赖连接已登记'],
    unverified: ['上游规格及工具可用性', '实际参数映射与工具执行结果'] }
}

function totalSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function assertReadonlyOperation(source: Awaited<ReturnType<typeof loadOpenApi>>, operationId: string) {
  const operation = source.operations.get(operationId)
  if (!operation) throw new Error(`组合依赖操作不存在：${operationId}`)
  if (operation.method !== 'get') throw new Error(`只读组合拒绝非 GET 操作：${operationId}`)
}

export async function executeComposition(registry: McpRegistry, assetRoot: string, config: CompositionConfig, input: Record<string, any>, signal?: AbortSignal) {
  const version = compositionVersion(assetRoot, config)
  const validated = compositionInput(input, config)
  const runSignal = totalSignal(signal)
  const sources = new Map<string, any>()
  for (const step of compositionSteps(config)) {
    const connection = registry.openapi.get(step.connectionId ?? '')
    if (!connection) throw new Error(`未注册组合依赖连接：${step.connectionId ?? '未选择'}`)
    if (!sources.has(connection.id)) sources.set(connection.id, await (registry.native?.load ?? loadOpenApi)(connection, runSignal))
    assertReadonlyOperation(sources.get(connection.id), step.operationId)
    statusFor(registry, connection.id).specLoaded = true
  }

  const call = registry.native?.call ?? callOpenApiOperation
  const result = await compositionGraph(config, async (step, args) => {
    const value = await call(sources.get(step.connectionId!), step.operationId, args, runSignal)
    statusFor(registry, step.connectionId!).toolCallSucceeded = value.ok && (!config.flow || value.json?.code === 200)
    return value
  })
    .invoke({ input: validated, alerts: [], receipts: [], trace: [] }, { signal: runSignal })
  return {
    ok: !result.error,
    version,
    receipts: result.receipts,
    result: { asset: result.asset, alerts: result.alerts, trace: result.trace, ...(result.alertSummary ? { alertSummary: result.alertSummary } : {}) },
    ...(result.error ? { error: result.error } : {}),
  }
}
