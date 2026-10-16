import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { compositionDefinition, compositionInputSchema, compositionOutputSchema, INCIDENT_ID_PATTERN, RUN_ID_PATTERN } from './definition.ts'
import { compositionVersionId, readCompositions, type Catalog, type CompositionConfig } from './compositions.ts'
import type { ThreatRuntime, CompositionExtension } from './extension.ts'
import { executeNested, nestedStructure, validateNested } from './nested.ts'
import { programRoot, workspaceConfigPath, workspaceLocalPath } from '../workspace.ts'
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
  threat?: ThreatRuntime
  extension?: CompositionExtension
  native?: {
    load(connection: OpenApiConnection, signal?: AbortSignal): Promise<any>
    call(source: any, operationId: string, args: Record<string, any>, signal?: AbortSignal): Promise<any>
  }
}

type PersistedState = { openapi?: OpenApiConnection[]; mcp?: any[] }

function defaultStateFile(assetRoot: string): string {
  return workspaceLocalPath(assetRoot, 'state', 'mcp-connections.json')
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

function sourceDigestOf(): string {
  const files = ['client.tsx', 'definition.ts', 'compositions.ts', 'executor.ts', 'index.ts', 'openapi.ts', 'manager.ts', 'native.ts', 'nested.ts', 'extension.ts', 'threat-editor.tsx']
    .map(file => `platform/plugin/src/mcp/${file}`)
    .concat(['platform/plugin/build.mjs', 'platform/plugin/package.json', 'platform/plugin/pnpm-lock.yaml', 'platform/plugin/src/index.ts',
      ...['index.ts', 'openapi.ts'].map(file => `plugins/mcp-manager/${file}`)])
  try {
    const hash = createHash('sha256')
    for (const file of files) hash.update(file).update('\0').update(readFileSync(join(programRoot(), file)))
    return hash.digest('hex')
  } catch {
    return 'unknown'
  }
}

export function compositionVersion(assetRoot: string, config?: CompositionConfig, extension?: CompositionExtension) {
  const gitCommit = gitCommitOf(assetRoot)
  const programCommit = gitCommitOf(programRoot())
  const programDirty = gitDirtyOf(programRoot())
  const gitDirty = gitDirtyOf(assetRoot)
  const sourceDigest = sourceDigestOf()
  const definition = { ...compositionDefinition, ...config, readonly: !config?.kind, inputSchema: compositionInputSchema(config), outputSchema: compositionOutputSchema(config),
    upstream: config?.kind ? { kind: config.kind, ...(config.kind === 'composite' ? { steps: config.steps } : { stage: config.stage, bindings: config.bindings }) } : { kind: 'openapi', steps: config?.flow ? [] : compositionSteps(config) } }
  const businessExtension = extension?.id ? { id: extension.id, sourceDigest: extension.sourceDigest ?? 'unknown' } : undefined
  const digest = createHash('sha256').update(JSON.stringify({ gitCommit, gitDirty, programCommit, programDirty, sourceDigest, businessExtension, definition })).digest('hex')
  return { gitCommit, gitDirty, programCommit, programDirty, sourceDigest, businessExtension, digest, definition, ...(config?.kind ? { versionId: compositionVersionId(config) } : {}) }
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

function compositionInput(input: Record<string, any>, config?: CompositionConfig): Record<string, any> {
  if (config?.kind) {
    const key = config.kind === 'composite' || config.stage === 'collect' ? 'incident_id' : 'run_id'
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => name !== key) || typeof input[key] !== 'string' || !new RegExp(key === 'incident_id' ? INCIDENT_ID_PATTERN : RUN_ID_PATTERN).test(input[key])) throw new Error(`${key} 格式无效，且不能传入其他字段`)
    return { [key]: input[key] }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['asset', 'limit'].includes(key))) throw new Error('组合输入仅接受 asset 和 limit')
  const asset = inputString(input.asset, 'asset')
  if (config?.flow && (!/^[1-9]\d*$/.test(asset) || !Number.isSafeInteger(Number(asset)))) throw new Error('SOC 查询须填写有效的正整数资产 ID')
  return { asset, limit: inputLimit(input.limit) }
}

function compositionSteps(config?: CompositionConfig, extension?: CompositionExtension) {
  if (config?.flow) {
    if (!extension?.flow) throw new Error('业务组合扩展尚未装载')
    return extension.flow.steps(config)
  }
  return [
    { step: 'asset', title: '查询资产', connectionId: config?.connectionId, operationId: 'get_asset', input: { asset: '$input.asset' }, output: 'asset' },
    { step: 'alerts', title: '查询相关告警', connectionId: config?.connectionId, operationId: 'list_alerts', input: { assetId: '$state.assetId', limit: '$input.limit' }, output: 'alerts' },
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

function compositionGraph(config: CompositionConfig | undefined, call: (step: ReturnType<typeof compositionSteps>[number], args: Record<string, any>) => Promise<any>, extension?: CompositionExtension) {
  const [assetStep, alertsStep] = compositionSteps(config, extension)
  const flow = config?.flow ? extension!.flow! : undefined
  return new StateGraph(CompositionState)
    .addNode('getAsset', async state => {
      const started = Date.now()
      const args = flow ? flow.assetArguments(state.input) : { asset: state.input.asset }
      const first = await call(assetStep, args)
      const decoded = flow?.assetResult(first, state.input)
      const asset = decoded ? decoded.asset : first.json
      const assetId = decoded ? decoded.assetId : asset?.id ?? asset?.asset?.id
      const error = !first.ok ? { code: 'step_failed', message: `查询资产失败：HTTP ${first.status}` }
        : decoded ? decoded.error : typeof assetId !== 'string' || !assetId ? { code: 'mapping_failed', message: '第一步结果缺少资产 ID' } : undefined
      const trace: any[] = [{ ...assetStep, status: error ? 'failed' : 'succeeded', httpStatus: first.status, durationMs: Date.now() - started, mappedArguments: args }]
      if (error) trace.push({ ...alertsStep, status: 'skipped', reason: error.message })
      return { asset: bounded(asset), assetId, receipts: [first.receipt], trace, error }
    }, { metadata: assetStep })
    .addNode('listAlerts', async state => {
      const started = Date.now()
      const args = flow ? flow.alertsArguments(state.input, state.assetId) : { assetId: state.assetId, limit: state.input.limit }
      const second = await call(alertsStep, args)
      const decoded = flow?.alertsResult(second)
      const items = decoded ? decoded.items : second.json?.alerts ?? second.json
      const error = !second.ok ? { code: 'step_failed', message: `查询告警失败：HTTP ${second.status}` }
        : decoded?.error ?? (!Array.isArray(items) ? { code: 'mapping_failed', message: '第二步结果缺少告警列表' } : undefined)
      const alerts = error ? [] : (items as any[]).slice(0, state.input.limit)
      const alertSummary = !error ? decoded?.summary : undefined
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

export async function compositionStructure(config?: CompositionConfig, catalog?: Catalog, extension?: CompositionExtension, allowUnavailable = false) {
  if (config?.flow && !extension?.flow && allowUnavailable) return { nodes: [], edges: [], unavailable: '业务组合扩展尚未装载' }
  if (config?.kind === 'composite') return nestedStructure(config, catalog ?? { schema_version: '1.0', compositions: [] })
  if (config?.kind === 'threat-stage') {
    const graph = await threatStageGraph(config, async () => { throw new Error('结构查询不可执行节点') }).getGraphAsync()
    return { nodes: Object.values(graph.nodes).map(node => ({ id: node.id, ...node.metadata })), edges: graph.edges }
  }
  const graph = await compositionGraph(config, async () => { throw new Error('结构查询不可执行节点') }, extension).getGraphAsync()
  return { nodes: Object.values(graph.nodes).map(node => ({ id: node.id, ...node.metadata })), edges: graph.edges }
}

const ThreatStageState = Annotation.Root({ input: Annotation<Record<string, any>>(), result: Annotation<any>() })
function threatStageGraph(config: CompositionConfig, call: (input: Record<string, any>) => Promise<any>) {
  const stage = config.stage!
  return new StateGraph(ThreatStageState).addNode(stage, async state => ({ result: await call(state.input) }), {
    metadata: { step: stage, title: config.title, operationId: stage, input: stage === 'collect' ? { incident_id: '$input.incident_id' } : { run_id: '$input.run_id' }, output: 'run' },
  }).addEdge(START, stage).addEdge(stage, END).compile({ checkpointer: false })
}

export async function dryRunComposition(registry: McpRegistry, config: CompositionConfig, input: Record<string, any>, catalog?: Catalog) {
  const validated = compositionInput(input, config)
  if (config.kind) {
    const resolved = catalog ?? { schema_version: '1.0' as const, compositions: [] }
    validateNested(config, resolved)
    const check = (child: CompositionConfig) => {
      if (child.kind === 'composite') {
        for (const step of child.steps ?? []) check(resolved.compositions.find(entry => entry.id === step.compositionId)!.versions!.find(version => version.versionId === step.versionId)!.config)
      } else if (child.kind === 'threat-stage') {
        if (!registry.threat) throw new Error('业务组合扩展尚未装载')
        for (const id of [child.bindings!.socConnectionId, child.bindings!.reportConnectionId]) if (!registry.openapi.has(id) && !registry.mcp.has(id)) throw new Error(`未注册组合依赖连接：${id}`)
      } else for (const step of compositionSteps(child, registry.extension)) if (!registry.openapi.has(step.connectionId!)) throw new Error(`未注册组合依赖连接：${step.connectionId}`)
    }
    check(config)
    return { ok: true, mode: 'dry', input: validated, graph: await compositionStructure(config, resolved, registry.extension), upstreamRequests: 0,
      checks: ['输入有效', '子组合版本与参数映射有效', '依赖连接已登记', 'LangGraph 图已编译'], unverified: ['SOC 认领与业务接口', '模型实际调用', '回写与报告保存'] }
  }
  for (const step of compositionSteps(config, registry.extension)) {
    if (!step.connectionId || !registry.openapi.has(step.connectionId)) throw new Error(`未注册组合依赖连接：${step.connectionId ?? '未选择'}`)
  }
  return { ok: true, mode: 'dry', input: validated, graph: await compositionStructure(config, undefined, registry.extension), upstreamRequests: 0,
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

export async function executeComposition(registry: McpRegistry, assetRoot: string, config: CompositionConfig, input: Record<string, any>, signal?: AbortSignal, catalog?: Catalog, nested = false): Promise<any> {
  const version = compositionVersion(assetRoot, config, registry.extension)
  const validated = compositionInput(input, config)
  if (config.kind) {
    const runSignal = nested && signal ? signal : signal ? AbortSignal.any([signal, AbortSignal.timeout(36 * 60_000)]) : AbortSignal.timeout(36 * 60_000)
    if (config.kind === 'threat-stage') {
      if (!registry.threat) throw new Error('威胁分析运行器尚未装载')
      const cleanup = nested && (config.stage === 'writeback' || config.stage === 'report')
      const state = await threatStageGraph(config, args => registry.threat!.execute(config.stage!, config.bindings!, args, cleanup ? AbortSignal.timeout(120_000) : runSignal)).invoke({ input: validated })
      const ok = ['completed', 'skipped'].includes(state.result.phase_status) && state.result.status !== 'claim_failed'
      return { ok, version, receipts: [], result: state.result,
        ...(!ok ? { error: { code: state.result.status === 'claim_failed' ? 'claim_failed' : 'threat_stage_failed',
          message: state.result.status === 'claim_failed' ? 'SOC 事件认领失败' : state.result.phase_status === 'unknown' ? '威胁分析阶段状态尚未确认' : '威胁分析阶段执行失败' } } : {}) }
    }
    runSignal.throwIfAborted()
    const resolved = catalog ?? readCompositions(workspaceConfigPath(assetRoot, 'mcp-compositions.json')).catalog
    const result = await executeNested(config, resolved, validated, (child, args) => executeComposition(registry, assetRoot, child, args, runSignal, resolved, true))
    return { ...result, version }
  }
  const runSignal = totalSignal(signal)
  const sources = new Map<string, any>()
  for (const step of compositionSteps(config, registry.extension)) {
    const connection = registry.openapi.get(step.connectionId ?? '')
    if (!connection) throw new Error(`未注册组合依赖连接：${step.connectionId ?? '未选择'}`)
    if (!sources.has(connection.id)) sources.set(connection.id, await (registry.native?.load ?? loadOpenApi)(connection, runSignal))
    assertReadonlyOperation(sources.get(connection.id), step.operationId)
    statusFor(registry, connection.id).specLoaded = true
  }

  const call = registry.native?.call ?? callOpenApiOperation
  const result = await compositionGraph(config, async (step, args) => {
    const value = await call(sources.get(step.connectionId!), step.operationId, args, runSignal)
    statusFor(registry, step.connectionId!).toolCallSucceeded = config.flow ? registry.extension!.flow!.succeeded(value) : value.ok
    return value
  }, registry.extension)
    .invoke({ input: validated as { asset: string; limit: number }, alerts: [], receipts: [], trace: [] }, { signal: runSignal })
  return {
    ok: !result.error,
    version,
    receipts: result.receipts,
    result: { asset: result.asset, alerts: result.alerts, trace: result.trace, ...(result.alertSummary ? { alertSummary: result.alertSummary } : {}) },
    ...(result.error ? { error: result.error } : {}),
  }
}
