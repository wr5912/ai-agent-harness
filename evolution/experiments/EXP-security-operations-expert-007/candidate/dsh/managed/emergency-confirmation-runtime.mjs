import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setEmergencyConfirmationTurn } from './emergency-action-guard.mjs'

export const name = 'emergency-confirmation-runtime'
export const inject = ['sessionQuery']

const RESULT = 'mcp__emergency-action__get_emergency_action_result'
const GET = 'mcp__emergency-action__get_emergency_action'
const PREPARE = 'mcp__emergency-action__prepare_emergency_action'
const REVISE = 'mcp__emergency-action__revise_emergency_action'
const CANCEL = 'mcp__emergency-action__cancel_emergency_action'
const STATE_DIR = '/var/lib/dsh/emergency-confirmation-state'
const locks = new Map()

const textOf = message => message?.content?.filter(item => item.type === 'text').map(item => item.text).join('') ?? ''
const isConfirmation = message => message?.source?.kind === 'user' && textOf(message).trim() === '确认执行'

function toolValue(event) {
  const message = event?.data?.message
  if (message?.source?.kind !== 'tool' || message.isError) return null
  const block = message.content?.find(item => item.type === 'tool-result' && item.toolCallId === message.source.callId)
  if (block?.isError) return null
  const content = block ? block.content : message.content
  try {
    const raw = JSON.parse(content?.find(item => item.type === 'text')?.text)
    return raw?.code === '200' && raw.data ? raw.data : raw
  } catch { return null }
}

export function latestDraft(events, confirmingMessageId) {
  const calls = new Map()
  const views = []
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(event.data?.callId, event.data)
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data?.message?.source?.callId)
    if (!call || ![PREPARE, REVISE, CANCEL, GET, RESULT].includes(call.name)) continue
    let args
    try { args = JSON.parse(call.arguments) } catch { continue }
    const value = toolValue(event)
    if (value && (call.name === PREPARE ? args?.body?.request_id : args?.operationId === value.operation_id)) {
      views.push({ ...value, seq: event.seq })
    }
  }
  const current = views.at(-1)
  const laterUsers = current && events.filter(event => event.type === 'user/message' &&
    event.data?.source?.kind === 'user' && event.seq > current.seq)
  const currentVisible = laterUsers?.some(event => event.data.id === confirmingMessageId)
  const confirmationsOnly = laterUsers?.every(event => isConfirmation(event.data)) &&
    (!currentVisible || laterUsers.at(-1).data.id === confirmingMessageId)
  if (!current || !confirmationsOnly ||
      events.some(event => event.type === 'tool/call' && event.seq > current.seq &&
        [PREPARE, REVISE, CANCEL].includes(event.data?.name)) ||
      current.phase !== 'READY' ||
      current.execution_status !== 'NOT_SUBMITTED' ||
      !/^op_[a-f0-9]{32}$/.test(current.operation_id ?? '') ||
      !Number.isInteger(current.version) || current.version < 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(current.snapshot_digest ?? '') ||
      !current.snapshot || !Number.isFinite(Date.parse(current.expires_at)) ||
      Date.parse(current.expires_at) <= Date.now()) return null
  if (views.some(item => item.operation_id === current.operation_id && item.version > current.version)) return null
  return { operationId: current.operation_id, version: current.version,
    snapshotDigest: current.snapshot_digest, expiresAt: current.expires_at }
}

function keyFor(sessionId, draft) {
  return createHash('sha256').update(`${sessionId}\n${draft.operationId}\n${draft.version}\n${draft.snapshotDigest}`).digest('hex')
}

export function confirmationPayload(sessionId, draft, now = Date.now()) {
  const id = keyFor(sessionId, draft)
  return {
    audience: 'emergency-confirmation-v1', event_type: 'UserPromptSubmit', decision: 'CONFIRM',
    tenant_id: process.env.AI_WORKBENCH_EMERGENCY_TENANT_ID,
    workspace_id: process.env.AI_WORKBENCH_EMERGENCY_WORKSPACE_ID,
    user_id: process.env.EMERGENCY_CONFIRMATION_ACTOR_ID,
    session_id: sessionId, event_id: `dsh-${id}`,
    operation_id: draft.operationId, version: draft.version,
    snapshot_digest: draft.snapshotDigest,
    issued_at: Math.floor(now / 1000), expires_at: Math.floor(now / 1000) + 120,
  }
}

function proofFor(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const pem = Buffer.from(process.env.EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64 ?? '', 'base64')
  const privateKey = createPrivateKey(pem)
  return `${encoded}.${sign('sha256', Buffer.from(encoded, 'ascii'), privateKey).toString('base64url')}`
}

async function saveState(path, state) {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: 'wx' })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

function validateResponse(value, draft) {
  if (value?.operation_id !== draft.operationId || value.version !== draft.version ||
      value.snapshot_digest !== draft.snapshotDigest ||
      !['QUEUED', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'TERMINAL'].includes(value.phase)) {
    throw new Error('Workbench 确认回执与当前草案不一致')
  }
  return value
}

async function confirm(sessionId, draft) {
  const path = join(STATE_DIR, `${keyFor(sessionId, draft)}.json`)
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { /* First confirmation. */ }
  const id = keyFor(sessionId, draft)
  const requestId = `dsh-emergency-${id.slice(0, 32)}`
  let state
  try {
    const url = process.env.EMERGENCY_WORKBENCH_URL
    const token = process.env.EMERGENCY_WORKBENCH_TOKEN
    if (!url || !token || !process.env.EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64 ||
        !process.env.EMERGENCY_CONFIRMATION_ACTOR_ID ||
        !process.env.AI_WORKBENCH_EMERGENCY_TENANT_ID ||
        !process.env.AI_WORKBENCH_EMERGENCY_WORKSPACE_ID) throw new Error('确认运行时配置不完整')
    const response = await fetch(`${url.replace(/\/$/, '')}/api/v1/emergency-actions/${draft.operationId}/confirmations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, expected_version: draft.version,
        snapshot_digest: draft.snapshotDigest,
        confirmation_event_ref: proofFor(confirmationPayload(sessionId, draft)) }),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`Workbench 确认接口返回 HTTP ${response.status}`)
    const view = validateResponse(await response.json(), draft)
    state = { operationId: draft.operationId, requestId, phase: view.phase,
      approvalStatus: view.approval_status, executionStatus: view.execution_status,
      message: formatConfirmationStatus(null, view) }
  } catch (error) {
    // A timed-out response can arrive after Workbench accepted the request.
    state = { operationId: draft.operationId, requestId,
      message: `确认接口未返回有效回执：${error.message}。操作号 ${draft.operationId}；提交结果待查账，请勿重复确认。` }
  }
  await saveState(path, state)
  return state
}

export function formatConfirmationStatus(state, view) {
  if (!view || (!state?.phase && view.phase === 'READY')) return state?.message ?? '确认结果待查账，请稍后按操作号查询。'
  const socStatus = view.soc_observation?.evidence?.status
  let result
  if (socStatus === 'SUCCESS') result = '执行结果：成功'
  else if (socStatus === 'FAILED' || socStatus === 'BLOCKED') result = '执行结果：失败'
  else if (socStatus === 'REJECTED') result = '执行结果：审批已拒绝，未执行'
  else if (socStatus === 'RUNNING') result = '当前进度：执行中'
  else if (socStatus === 'AWAITING_APPROVAL') result = '当前进度：待审批'
  else if (view.execution_status === 'SUCCEEDED') result = '执行结果：成功'
  else if (view.execution_status === 'FAILED') result = '执行结果：失败'
  else if (view.approval_status === 'REJECTED') result = '执行结果：审批已拒绝，未执行'
  else if (view.execution_status === 'RUNNING') result = '当前进度：执行中'
  else if (view.approval_status === 'PENDING') result = '当前进度：待审批'
  else if (view.phase === 'SUBMISSION_UNKNOWN') result = '当前进度：提交结果待核实，请稍后查询'
  else result = '当前进度：处理中，请稍后查询'
  const ids = [`操作号：${view.operation_id}`]
  if (view.soc_execution_id) ids.push(`SOC 执行号：${view.soc_execution_id}`)
  return `${result}\n${ids.join('；')}`
}

export async function latestConfirmationStatus(draft, state, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = Date.now() + (options.waitMs ?? 30000)
  let latest = null
  const url = process.env.EMERGENCY_WORKBENCH_URL
  const token = process.env.EMERGENCY_WORKBENCH_TOKEN
  if (!url || !token) return null
  do {
    try {
      const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/v1/emergency-actions/${draft.operationId}/result`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) break
      latest = validateResponse(await response.json(), draft)
      if (latest.phase === 'TERMINAL' || (!state.phase && latest.phase === 'READY')) break
    } catch { /* Keep the last valid observation if a read times out. */ }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(800, remaining))
  } while (Date.now() < deadline)
  return latest
}

function context(message, operationId = null) {
  return { id: randomUUID(), role: 'user',
    source: { kind: name, form: 'result' },
    content: [{ type: 'text', text: `受控确认运行时结果。直接用下方两行回复用户，不附加 Workbench 阶段、原始枚举、版本、摘要或设备回显；成功就说成功，处理中就说处理中。${operationId ? `如需更新，只能调用 get_emergency_action_result 查询 ${operationId}，不能再次准备、修订、取消或确认。` : '当前没有可确认的草案。'}\n${message}` }] }
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, messages, step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if ((agent.session?.header?.delegationDepth ?? 0) !== 0) return decision
    if (step !== 1) return decision
    const users = messages.filter(message => message.source?.kind === 'user')
    if (!users.length) return decision
    setEmergencyConfirmationTurn(agent, false)
    if (users.length !== 1 || !isConfirmation(users[0])) return decision
    const snapshot = await ctx.sessionQuery.readSession(agent.id)
    const draft = latestDraft(snapshot.events, users[0].id)
    if (!draft) return decision
    setEmergencyConfirmationTurn(agent, true, draft.operationId)
    const key = `${agent.id}\n${keyFor(agent.id, draft)}`
    if (!locks.has(key)) locks.set(key, confirm(agent.id, draft).finally(() => locks.delete(key)))
    const state = await locks.get(key)
    const view = await latestConfirmationStatus(draft, state)
    return { ...decision, messages: [...decision.messages,
      context(formatConfirmationStatus(state, view), draft.operationId)] }
  })
}
