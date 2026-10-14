import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { compositionDefinition } from './definition.ts'
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
  const files = ['client.tsx', 'definition.ts', 'executor.ts', 'index.ts', 'openapi.ts', 'manager.ts']
    .map(file => `platform/plugin/src/mcp/${file}`)
    .concat(['platform/plugin/build.mjs', 'platform/plugin/src/index.ts',
      ...['index.ts', 'openapi.ts'].map(file => `evolution/experiments/EXP-security-operations-expert-018-rfbf7fd53a340/candidate/dsh/managed/mcp-manager/${file}`)])
  try {
    const hash = createHash('sha256')
    for (const file of files) hash.update(file).update('\0').update(readFileSync(join(assetRoot, file)))
    return hash.digest('hex')
  } catch {
    return 'unknown'
  }
}

function compositionDigest(gitCommit: string, gitDirty: boolean | 'unknown', sourceDigest: string): string {
  return createHash('sha256').update(JSON.stringify({ gitCommit, gitDirty, sourceDigest, definition: compositionDefinition })).digest('hex')
}

export function compositionVersion(assetRoot: string) {
  const gitCommit = gitCommitOf(assetRoot)
  const gitDirty = gitDirtyOf(assetRoot)
  const sourceDigest = sourceDigestOf(assetRoot)
  return { gitCommit, gitDirty, sourceDigest, digest: compositionDigest(gitCommit, gitDirty, sourceDigest), definition: compositionDefinition }
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

function totalSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function assertReadonlyOperations(source: Awaited<ReturnType<typeof loadOpenApi>>) {
  for (const operationId of compositionDefinition.upstream.operations) {
    const operation = source.operations.get(operationId)
    if (!operation) throw new Error(`组合依赖操作不存在：${operationId}`)
    if (operation.method !== 'get') throw new Error(`只读组合拒绝非 GET 操作：${operationId}`)
  }
}

export async function executeComposition(registry: McpRegistry, assetRoot: string, input: Record<string, any>, signal?: AbortSignal) {
  const version = compositionVersion(assetRoot)
  const connectionId = compositionDefinition.upstream.connectionId
  const connection = registry.openapi.get(connectionId)
  if (!connection) throw new Error(`未注册组合依赖连接：${connectionId}`)
  const asset = inputString(input.asset, 'asset')
  const limit = inputLimit(input.limit)
  const trace: any[] = []
  const started = Date.now()
  const status = statusFor(registry, connectionId)
  const runSignal = totalSignal(signal)
  const source = await (registry.native?.load ?? loadOpenApi)(connection, runSignal)
  assertReadonlyOperations(source)
  status.specLoaded = true

  const [assetStep, alertsStep] = compositionDefinition.steps
  const call = registry.native?.call ?? callOpenApiOperation
  const first = await call(source, assetStep.operationId, { asset }, runSignal)
  trace.push({ step: assetStep.id, operationId: assetStep.operationId, status: first.ok ? 'succeeded' : 'failed', httpStatus: first.status, durationMs: Date.now() - started })
  if (!first.ok) {
    status.toolCallSucceeded = false
    trace.push({ step: alertsStep.id, operationId: alertsStep.operationId, status: 'skipped', reason: '前置步骤失败' })
    return { ok: false, version, receipts: [first.receipt], result: { asset: bounded(first.json), alerts: [], trace }, error: { code: 'step_failed', message: `查询资产失败：HTTP ${first.status}` } }
  }
  const assetId = first.json?.id ?? first.json?.asset?.id
  if (typeof assetId !== 'string' || !assetId) {
    status.toolCallSucceeded = false
    trace.push({ step: alertsStep.id, operationId: alertsStep.operationId, status: 'skipped', reason: '缺少第一步输出 asset id' })
    return { ok: false, version, receipts: [first.receipt], result: { asset: bounded(first.json), alerts: [], trace }, error: { code: 'mapping_failed', message: '第一步结果缺少资产 ID' } }
  }
  const secondStart = Date.now()
  const second = await call(source, alertsStep.operationId, { assetId, limit }, runSignal)
  trace.push({ step: alertsStep.id, operationId: alertsStep.operationId, status: second.ok ? 'succeeded' : 'failed', httpStatus: second.status, durationMs: Date.now() - secondStart, mappedArguments: { assetId, limit } })
  status.toolCallSucceeded = second.ok
  const alerts = Array.isArray(second.json?.alerts) ? second.json.alerts.slice(0, limit) : Array.isArray(second.json) ? second.json.slice(0, limit) : []
  return {
    ok: second.ok,
    version,
    receipts: [first.receipt, second.receipt],
    result: { asset: bounded(first.json), alerts, trace },
    ...(second.ok ? {} : { error: { code: 'step_failed', message: `查询告警失败：HTTP ${second.status}` } }),
  }
}
