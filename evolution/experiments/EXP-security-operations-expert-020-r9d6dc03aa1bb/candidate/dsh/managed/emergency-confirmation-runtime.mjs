import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setEmergencyConfirmationTurn } from './emergency-action-guard.mjs'
import {
  continueWithModel, controlledContextMessage, emergencyDraftMarkdown,
  emergencyDraftConflict, formatEmergencyStatus, queueControlledOutput, queuePostDeliveryInteraction,
} from './operation-result-delivery.mjs'
import {
  askNativeOperationQuestion, nativeOperationDecision, nativeOperationQuestion,
} from './native-operation-question.mjs'

export const name = 'emergency-confirmation-runtime'
export const inject = ['sessionQuery', 'userQuestions']

const RESULT = 'mcp__emergency-action__get_emergency_action_result'
const GET = 'mcp__emergency-action__get_emergency_action'
const PREPARE = 'mcp__emergency-action__prepare_emergency_action'
const REVISE = 'mcp__emergency-action__revise_emergency_action'
const CANCEL = 'mcp__emergency-action__cancel_emergency_action'
const STATE_DIR = '/var/lib/dsh/emergency-confirmation-state'
const locks = new Map()
const NATIVE_QUESTION_ID = 'emergency-draft-decision'
const CONFIRM_LABEL = '确认执行'
const CANCEL_LABEL = '取消执行'

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

function resultProjection(result) {
  if (!result || result.isError) return null
  if (result.value?.code === '200' && result.value.data && typeof result.value.data === 'object') {
    return result.value.data
  }
  const blocks = result.content?.flatMap(block => block.type === 'tool-result' ? block.content ?? [] : [block]) ?? []
  const raw = blocks.find(block => block.type === 'text')?.text
  try {
    const value = JSON.parse(raw)
    return value?.code === '200' && value.data && typeof value.data === 'object' ? value.data : null
  } catch { return null }
}

function emergencyQuestionSpec() {
  return {
    domain: 'emergency',
    id: NATIVE_QUESTION_ID,
    header: '应急指令确认',
    question: '是否执行上方应急指令草案？',
    confirmLabel: CONFIRM_LABEL,
    confirmDescription: '确认当前冻结草案，并进入 Platform/SOC 审批或执行流程。',
    cancelLabel: CANCEL_LABEL,
    cancelDescription: '不确认当前草案，本次不提交、不审批、不执行。',
  }
}

/** Extract only a real, bound and unexpired Platform emergency draft. */
export function draftFromExecution(exec, result, now = Date.now()) {
  if (![PREPARE, REVISE, GET, RESULT].includes(exec?.name) || result?.isError) return null
  const value = resultProjection(result)
  const boundOperation = exec.name === PREPARE || exec.arguments?.operationId === value?.operation_id
  if (!value || !boundOperation || emergencyDraftConflict(value) || value.phase !== 'READY' ||
      value.execution_status !== 'NOT_SUBMITTED' ||
      !/^op_[a-f0-9]{32}$/.test(value.operation_id ?? '') ||
      !Number.isInteger(value.version) || value.version < 1 ||
      !/^sha256:[a-f0-9]{64}$/.test(value.snapshot_digest ?? '') ||
      !value.snapshot || typeof value.snapshot !== 'object' || Array.isArray(value.snapshot) ||
      !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now) return null
  return {
    operationId: value.operation_id,
    version: value.version,
    snapshotDigest: value.snapshot_digest,
    expiresAt: value.expires_at,
    resultMarkdown: emergencyDraftMarkdown(value, true),
  }
}

export function nativeEmergencyQuestion(_draft) {
  return nativeOperationQuestion(emergencyQuestionSpec())
}

export function nativeEmergencyDecision(answer) {
  return nativeOperationDecision(answer, emergencyQuestionSpec())
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
  if (!current || emergencyDraftConflict(current) || !confirmationsOnly ||
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
    issuer: process.env.PLATFORM_CONFIRMATION_ISSUER,
    audience: 'operation-confirmation-v1', event_type: 'UserPromptSubmit', decision: 'CONFIRM',
    tenant_id: process.env.AI_WORKBENCH_EMERGENCY_TENANT_ID,
    workspace_id: process.env.AI_WORKBENCH_EMERGENCY_WORKSPACE_ID,
    user_id: process.env.EMERGENCY_CONFIRMATION_ACTOR_ID,
    session_id: sessionId, event_id: `dsh-${id}`,
    operation_id: draft.operationId, version: draft.version,
    snapshot_digest: draft.snapshotDigest, purpose: 'emergency.execute',
    issued_at: Math.floor(now / 1000), expires_at: Math.floor(now / 1000) + 120,
  }
}

function proofFor(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const pem = Buffer.from(process.env.EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64 ?? '', 'base64')
  const privateKey = createPrivateKey(pem)
  return `${encoded}.${sign('sha256', Buffer.from(encoded, 'ascii'), privateKey).toString('base64url')}`
}

export function confirmationRequest(sessionId, draft, now = Date.now()) {
  const id = keyFor(sessionId, draft)
  return {
    request_id: `dsh-emergency-${id.slice(0, 32)}`,
    expected_version: draft.version,
    snapshot_digest: draft.snapshotDigest,
    proof: proofFor(confirmationPayload(sessionId, draft, now)),
  }
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
      !['QUEUED', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'WAIT', 'TERMINAL'].includes(value.phase)) {
    throw new Error('Platform 确认回执与当前草案不一致')
  }
  return value
}

async function confirm(sessionId, draft) {
  const path = join(STATE_DIR, `${keyFor(sessionId, draft)}.json`)
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { /* First confirmation. */ }
  const request = confirmationRequest(sessionId, draft)
  const requestId = request.request_id
  let state
  try {
    const url = process.env.AI_PLATFORM_URL
    if (!url || !process.env.PLATFORM_CONFIRMATION_ISSUER ||
        !process.env.EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64 ||
        !process.env.EMERGENCY_CONFIRMATION_ACTOR_ID ||
        !process.env.AI_WORKBENCH_EMERGENCY_TENANT_ID ||
        !process.env.AI_WORKBENCH_EMERGENCY_WORKSPACE_ID) throw new Error('确认运行时配置不完整')
    const response = await fetch(`${url.replace(/\/$/, '')}/api/v1/emergency-actions/${draft.operationId}/confirmations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error(`Platform 确认接口返回 HTTP ${response.status}`)
    const envelope = await response.json()
    if (envelope?.code !== '200') throw new Error(`Platform 确认接口返回 ${envelope?.code ?? 'UNKNOWN'}`)
    const view = validateResponse(envelope.data, draft)
    state = { operationId: draft.operationId, requestId, phase: view.phase,
      approvalStatus: view.approval_status, executionStatus: view.execution_status,
      message: formatEmergencyStatus(null, view) }
  } catch (error) {
    // A timed-out response can arrive after Platform accepted the request.
    state = { operationId: draft.operationId, requestId, technicalError: error.message,
      message: `执行结果：待核实\n原因：未取得 Platform/SOC 权威执行结果。\n操作号：${draft.operationId}\n下一步：请稍后只查询该操作，避免重复提交。` }
  }
  await saveState(path, state)
  return state
}

export const formatConfirmationStatus = formatEmergencyStatus

export async function latestConfirmationStatus(draft, state, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = Date.now() + (options.waitMs ?? 30000)
  let latest = null
  const url = process.env.AI_PLATFORM_URL
  if (!url) return null
  do {
    try {
      const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/v1/emergency-actions/${draft.operationId}/result`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) break
      const envelope = await response.json()
      if (envelope?.code !== '200') break
      latest = validateResponse(envelope.data, draft)
      if (latest.phase === 'TERMINAL' || (!state.phase && latest.phase === 'READY')) break
    } catch { /* Keep the last valid observation if a read times out. */ }
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await sleep(Math.min(800, remaining))
  } while (Date.now() < deadline)
  return latest
}

function context(message, operationId = null) {
  return controlledContextMessage(name, message)
}

function refinementContext(text) {
  return {
    id: randomUUID(), role: 'user', source: { kind: name, form: 'answer' },
    content: [{
      type: 'text',
      text: `用户在原生应急指令决策面板中补充了以下内容：\n\n${text}\n\n这段内容不是“确认执行”授权。请按普通用户补充内容处理；不得确认或提交当前草案。`,
    }],
  }
}

function cancellationMarkdown(draft, skipped = false) {
  return [
    skipped ? '已跳过应急指令草案确认。' : '已取消执行当前应急指令草案。',
    '当前草案未确认、未提交、未审批、未执行。',
    `操作号：${draft.operationId}`,
  ].join('\n')
}

async function confirmDraftForAgent(agent, draft) {
  const key = `${agent.id}\n${keyFor(agent.id, draft)}`
  if (!locks.has(key)) locks.set(key, confirm(agent.id, draft).finally(() => locks.delete(key)))
  const state = await locks.get(key)
  const view = await latestConfirmationStatus(draft, state)
  return { state, view, message: formatEmergencyStatus(state, view) }
}

export async function handleNativeEmergencyDecision(exec, draft, answer,
  confirmDraft = confirmDraftForAgent) {
  const decision = nativeEmergencyDecision(answer)
  if (decision.kind === 'confirm') {
    const result = await confirmDraft(exec.agent, draft)
    return {
      kind: 'controlled', markdown: result.message,
      context: context(result.message, draft.operationId), decision,
    }
  }
  if (decision.kind === 'custom') {
    continueWithModel(exec.agent.id)
    return { kind: 'model', context: refinementContext(decision.text), decision }
  }
  const markdown = cancellationMarkdown(draft, decision.kind === 'skip')
  return { kind: 'controlled', markdown, context: context(markdown, draft.operationId), decision }
}

export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (downstream.kind !== 'accept' || (exec.agent?.session?.header?.delegationDepth ?? 0) !== 0) {
      return downstream
    }
    const draft = draftFromExecution(exec, result)
    if (!draft) return downstream
    queuePostDeliveryInteraction(exec.agent.id, async signal => {
      const asked = await askNativeOperationQuestion(
        ctx, { agent: exec.agent, signal }, emergencyQuestionSpec())
      if (!asked.available) return
      const outcome = await handleNativeEmergencyDecision(
        { agent: exec.agent, signal }, draft, asked.answer)
      if (outcome.kind === 'model') {
        exec.agent.steer(outcome.context)
        return undefined
      }
      return outcome.markdown
    })
    return downstream
  })

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
    const result = await confirmDraftForAgent(agent, draft)
    queueControlledOutput(agent.id, result.message)
    return { ...decision, messages: [...decision.messages,
      context(result.message, draft.operationId)] }
  })
}
