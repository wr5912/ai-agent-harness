import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { cancelPolicyBinding, setPolicyConfirmationTurn, setPolicyUserRequest } from './policy-configuration-guard.mjs'
import {
  continueWithModel, controlledContextMessage, queueControlledOutput,
  queuePostDeliveryInteraction,
} from './operation-result-delivery.mjs'
import { isPolicyStatusQuery, publicSelectionError, submitPolicyRejection } from './policy-selection-runtime.mjs'
import {
  askNativeOperationQuestion, nativeOperationDecision, nativeOperationQuestion,
} from './native-operation-question.mjs'

export const name = 'policy-confirmation-runtime'
export const inject = ['sessionQuery', 'userQuestions']

const RESULT = 'mcp__policy-configuration__get_policy_configuration_result'
const STATUS = 'mcp__policy-configuration__get_policy_configuration_status'
const STATE_DIR = '/var/lib/dsh/policy-confirmation-state'
const CONFIRMATION_TIMEOUT_MS = 90000
const RESULT_SETTLE_TIMEOUT_MS = 30000
const RESULT_POLL_INTERVAL_MS = 2000
const PENDING_RESULT_CODES = new Set(['DRAFT_READY', 'EXECUTION_IN_PROGRESS'])
const TERMINAL_RESULT_CODES = new Set(['SUCCESS', 'FAILED', 'CANCELLED', 'EXECUTION_UNKNOWN'])
const locks = new Map()
const NATIVE_QUESTION_ID = 'policy-draft-decision'
const EXECUTE_LABEL = '执行'
const CANCEL_LABEL = '取消执行'

const textOf = message => message?.content?.filter(item => item.type === 'text').map(item => item.text).join('') ?? ''
const approval = message => message?.source?.kind === 'user' && textOf(message).trim() === '执行'

function projection(value) {
  if (!value || typeof value !== 'object') return null
  if (value.code === '200' && value.data && typeof value.data === 'object') return value.data
  return null
}

function resultProjection(result) {
  if (!result || result.isError) return null
  const direct = projection(result.value)
  if (direct) return direct
  const blocks = result.content?.flatMap(block => block.type === 'tool-result' ? block.content ?? [] : [block]) ?? []
  const raw = blocks.find(block => block.type === 'text')?.text
  try { return projection(JSON.parse(raw)) } catch { return null }
}

function confirmationExpiry(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? { value, epoch } : null
}

/** Extract only a real, bound Platform DRAFT from the result tool execution. */
export function draftFromExecution(exec, result) {
  if (exec?.name !== RESULT || result?.isError) return null
  const value = resultProjection(result)
  if (!value || exec.arguments?.operationId !== value.operation_id ||
      value.task_status !== 'DRAFT' || value.confirmation_required !== true ||
      value.result_code !== 'DRAFT_READY' || typeof value.operation_id !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(value.candidate_digest ?? '') ||
      !Number.isInteger(value.version) || value.version < 1 ||
      !confirmationExpiry(value.confirmation_expires_at) ||
      typeof value.result_markdown !== 'string' || !value.result_markdown.trim()) return null
  return {
    operationId: value.operation_id,
    candidateDigest: value.candidate_digest,
    taskId: value.task_id,
    version: value.version,
    confirmationExpiresAt: value.confirmation_expires_at,
    resultMarkdown: value.result_markdown,
  }
}

/** Native DSH question shown after the authoritative draft is committed above. */
export function nativePolicyQuestion(draft) {
  return nativeOperationQuestion(policyQuestionSpec(draft))
}

/** Free text always wins over a selected option and is never execution authority. */
export function nativePolicyDecision(answer, draft) {
  const decision = nativeOperationDecision(answer, policyQuestionSpec(draft))
  return decision.kind === 'confirm' ? { kind: 'execute' } : decision
}

function policyQuestionSpec(draft) {
  const expiry = confirmationExpiry(draft?.confirmationExpiresAt)
  return {
    domain: 'policy',
    id: draft ? `${NATIVE_QUESTION_ID}-${createHash('sha256').update(`${draft.operationId}\n${draft.version}\n${draft.candidateDigest}`).digest('hex').slice(0, 24)}` : NATIVE_QUESTION_ID,
    header: '策略确认',
    question: '是否执行上方策略草稿？',
    confirmLabel: EXECUTE_LABEL,
    confirmDescription: expiry
      ? `确认当前冻结草稿；确认窗口截止 ${expiry.value}。`
      : '确认当前冻结草稿，并进入平台及安全运营系统的审批或执行流程。',
    cancelLabel: CANCEL_LABEL,
    cancelDescription: '不提交当前草稿，本次不进入审批或执行流程。',
  }
}

function resultOf(event) {
  const message = event?.data?.message
  if (message?.source?.kind !== 'tool' || message.isError) return null
  const block = message.content?.find(item => item.type === 'tool-result' && item.toolCallId === message.source.callId)
  if (block?.isError) return null
  const content = block ? block.content : message.content
  const raw = content?.find(item => item.type === 'text')?.text
  try { return projection(JSON.parse(raw)) } catch { return null }
}

export function latestDraft(events) {
  const calls = new Map()
  const projections = []
  const userEvents = []
  for (const event of events) {
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') userEvents.push(event)
    if (event.type === 'tool/call') calls.set(event.data?.callId, event.data)
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data?.message?.source?.callId)
    if (!call || ![RESULT, STATUS].includes(call.name)) continue
    let args
    try { args = JSON.parse(call.arguments) } catch { continue }
    const value = resultOf(event)
    if (value && args?.operationId === value.operation_id) projections.push({ ...value, seq: event.seq, name: call.name })
  }
  const current = projections.at(-1)
  const newerUsers = current ? userEvents.filter(event => event.seq > current.seq) : []
  // The current approval may already be in the session snapshot at pre-step.
  if (!current || newerUsers.length > 1 ||
      (newerUsers.length === 1 && !approval(newerUsers[0].data)) ||
      current.task_status !== 'DRAFT' ||
      current.confirmation_required !== true || current.result_code !== 'DRAFT_READY' ||
      typeof current.operation_id !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(current.candidate_digest ?? '') ||
      !confirmationExpiry(current.confirmation_expires_at)) return null
  if (projections.some(item => item.operation_id === current.operation_id &&
      item.candidate_digest && item.candidate_digest !== current.candidate_digest)) return null
  if (!Number.isInteger(current.version) || current.version < 1) return null
  return { operationId: current.operation_id, candidateDigest: current.candidate_digest,
    taskId: current.task_id, version: current.version,
    confirmationExpiresAt: current.confirmation_expires_at }
}

function confirmationPayload(sessionId, draft, now = Date.now()) {
  const requestExpiry = confirmationExpiry(draft.confirmationExpiresAt)
  if (!requestExpiry) throw new ConfirmationWindowExpiredError('策略草稿缺少有效的权威确认截止时间')
  const issuedAt = Math.floor(now / 1000)
  const expiresAt = Math.min(issuedAt + 120, Math.floor(requestExpiry.epoch / 1000))
  if (expiresAt <= issuedAt) {
    throw new ConfirmationWindowExpiredError('策略草稿确认窗口已过期')
  }
  const id = createHash('sha256')
    .update(`${sessionId}\n${draft.operationId}\n${draft.version}\n${draft.candidateDigest}`).digest('hex')
  return {
    issuer: process.env.PLATFORM_CONFIRMATION_ISSUER,
    audience: 'operation-confirmation-v1', event_type: 'UserPromptSubmit', decision: 'CONFIRM',
    tenant_id: process.env.AI_WORKBENCH_EMERGENCY_TENANT_ID,
    workspace_id: process.env.AI_WORKBENCH_EMERGENCY_WORKSPACE_ID,
    user_id: process.env.EMERGENCY_CONFIRMATION_ACTOR_ID,
    session_id: sessionId, event_id: `dsh-${id}`,
    operation_id: draft.operationId, version: draft.version,
    candidate_digest: draft.candidateDigest, purpose: 'strategy.apply',
    issued_at: issuedAt, expires_at: expiresAt,
  }
}

class ConfirmationConfigurationError extends Error {}

/** 在创建 proof 和发送请求之前校验本地运行配置。 */
export function confirmationPrivateKey(environment = process.env) {
  const required = [
    'AI_PLATFORM_URL', 'PLATFORM_CONFIRMATION_ISSUER',
    'EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64', 'EMERGENCY_CONFIRMATION_ACTOR_ID',
    'AI_WORKBENCH_EMERGENCY_TENANT_ID', 'AI_WORKBENCH_EMERGENCY_WORKSPACE_ID',
  ]
  const missing = required.filter(key => !environment[key]?.trim())
  if (missing.length) {
    throw new ConfirmationConfigurationError(`确认运行配置缺失：${missing.join('、')}`)
  }
  try {
    const key = createPrivateKey(Buffer.from(environment.EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64, 'base64'))
    if (key.asymmetricKeyType !== 'rsa') throw new Error('unsupported-key-type')
    return key
  } catch {
    throw new ConfirmationConfigurationError('确认签名私钥无效，需要有效的 RSA 私钥')
  }
}

function proofFor(payload, privateKey) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign('sha256', Buffer.from(encoded, 'ascii'), privateKey).toString('base64url')}`
}

export function confirmationArguments(sessionId, draft, now = Date.now()) {
  const privateKey = confirmationPrivateKey()
  return {
    operationId: draft.operationId,
    body: {
      request_id: confirmationArgumentsRequestId(sessionId, draft),
      candidate_digest: draft.candidateDigest,
      proof: proofFor(confirmationPayload(sessionId, draft, now), privateKey),
    },
  }
}

function statePath(sessionId, draft) {
  const key = createHash('sha256').update(`${sessionId}\n${draft.operationId}\n${draft.candidateDigest}`).digest('hex')
  return join(STATE_DIR, `${key}.json`)
}

async function loadState(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

async function saveState(path, value) {
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}

class RetryableError extends Error {
  constructor(message, retrySafe = false) {
    super(message)
    this.retrySafe = retrySafe
  }
}

class ConfirmationRejectedError extends Error {}

class ConfirmationWindowExpiredError extends Error {}

async function post(url, payload, timeoutMs) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch { throw new RetryableError('平台传输失败或超时') }
  if (response.status === 503) throw new RetryableError('平台暂时不可用', true)
  const envelope = await response.json().catch(() => null)
  if (!response.ok || envelope?.code !== '200') {
    throw new ConfirmationRejectedError(
      `平台未接受确认（接口状态：${response.status}）`)
  }
  return envelope.data
}

function findProjection(value) {
  if (value?.error) throw new Error('MCP tools/call 返回 JSON-RPC 错误')
  const queue = [value]
  while (queue.length) {
    const item = queue.shift()
    if (typeof item === 'string') {
      try { queue.push(JSON.parse(item)) } catch { /* Not JSON. */ }
    } else if (Array.isArray(item)) queue.push(...item)
    else if (item && typeof item === 'object') {
      if (item.isError === true) throw new Error('MCP 工具返回业务错误')
      if (item.operation_id && item.candidate_digest && item.confirmation && item.execution) return item
      queue.push(...Object.values(item))
    }
  }
  throw new Error('MCP 响应缺少策略确认联合投影')
}

export function validateConfirmation(value, draft) {
  const item = findProjection(value)
  if (item.operation_id !== draft.operationId || item.candidate_digest !== draft.candidateDigest ||
      item.confirmation?.accepted !== true ||
      typeof item.confirmation.approval_receipt_id !== 'string' ||
      !item.confirmation.approval_receipt_id.trim() ||
      !item.execution || typeof item.execution !== 'object' ||
      !['NONE', 'EXECUTION'].includes(item.failure_scope) ||
      typeof item.result_markdown !== 'string' || !item.result_markdown.trim()) {
    throw new Error('策略确认联合投影缺少有效回执或与 DRAFT 绑定不一致')
  }
  return item
}

function validateResult(value, draft) {
  const item = projection(value)
  if (!item || item.operation_id !== draft.operationId ||
      item.candidate_digest !== draft.candidateDigest || item.version !== draft.version ||
      typeof item.result_code !== 'string' ||
      typeof item.result_markdown !== 'string' || !item.result_markdown.trim()) {
    throw new Error('策略结果投影缺失或与当前 DRAFT 绑定不一致')
  }
  return item
}

async function readResult(draft, timeoutMs, fetchImpl) {
  const baseUrl = process.env.AI_PLATFORM_URL
  let response
  try {
    response = await fetchImpl(
      `${baseUrl.replace(/\/$/, '')}/api/v1/policy-configurations/${draft.operationId}/result`,
      { signal: AbortSignal.timeout(timeoutMs) },
    )
  } catch { throw new RetryableError('平台策略结果查询失败或超时') }
  if ([502, 503, 504].includes(response.status)) throw new RetryableError('平台结果查询暂时不可用', true)
  const envelope = await response.json().catch(() => null)
  if (!response.ok || envelope?.code !== '200') {
    throw new Error(`平台策略结果查询被拒绝（接口状态：${response.status}）`)
  }
  return validateResult(envelope, draft)
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function withSettledResult(confirmation, result) {
  const terminal = TERMINAL_RESULT_CODES.has(result.result_code)
  return {
    ...confirmation,
    execution: {
      ...confirmation.execution,
      operation_status: terminal ? 'terminal' : 'executing',
      task_status: result.task_status,
      result_code: result.result_code,
      result_unknown: result.result_code === 'EXECUTION_UNKNOWN',
    },
    failure_scope: ['FAILED', 'CANCELLED'].includes(result.result_code) ? 'EXECUTION' : 'NONE',
    result_markdown: result.result_markdown,
  }
}

/** 确认已接受后，在限定时间内只按 operation_id 收敛 SOC 权威结果。 */
export async function settleConfirmation(confirmation, draft, options = {}) {
  if (!PENDING_RESULT_CODES.has(confirmation.execution?.result_code)) return confirmation
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? delay
  const now = options.now ?? Date.now
  const deadline = now() + (options.timeoutMs ?? RESULT_SETTLE_TIMEOUT_MS)
  const pollIntervalMs = options.pollIntervalMs ?? RESULT_POLL_INTERVAL_MS
  let latest = confirmation.execution.result_code === 'DRAFT_READY'
    ? withSettledResult(confirmation, {
      task_status: 'EXECUTING', result_code: 'EXECUTION_IN_PROGRESS',
      result_markdown: `策略确认已接受，安全运营系统正在审批或执行。\n\n操作号：${draft.operationId}`,
    })
    : confirmation
  while (now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())))
    try {
      const result = await readResult(
        draft, Math.max(100, deadline - now()), fetchImpl)
      if (result.result_code === 'DRAFT_READY') continue
      latest = withSettledResult(confirmation, result)
      if (TERMINAL_RESULT_CODES.has(result.result_code)) return latest
    } catch (error) {
      if (error instanceof RetryableError && error.retrySafe) continue
      if (error instanceof RetryableError) break
      throw error
    }
  }
  return latest
}

async function callOnce(args, draft, deadline) {
  const baseUrl = process.env.AI_PLATFORM_URL
  if (!baseUrl || !process.env.PLATFORM_CONFIRMATION_ISSUER ||
      !process.env.EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64 ||
      !process.env.EMERGENCY_CONFIRMATION_ACTOR_ID ||
      !process.env.AI_WORKBENCH_EMERGENCY_TENANT_ID ||
      !process.env.AI_WORKBENCH_EMERGENCY_WORKSPACE_ID) {
    throw new Error('平台确认运行时配置不完整')
  }
  const value = await post(
    `${baseUrl.replace(/\/$/, '')}/api/v1/policy-configurations/${draft.operationId}/confirmation`,
    args.body, Math.max(100, deadline - Date.now()))
  return validateConfirmation(value, draft)
}

export async function invokeConfirmation(args, draft, call = callOnce) {
  const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await call(args, draft, deadline) }
    catch (error) {
      if (!(error instanceof RetryableError) || !error.retrySafe || attempt === 1) throw error
    }
  }
}

async function confirm(sessionId, draft) {
  const path = statePath(sessionId, draft)
  const existing = await loadState(path)
  if (existing) return existing
  const requestId = confirmationArgumentsRequestId(sessionId, draft)
  try {
    const args = confirmationArguments(sessionId, draft)
    const confirmation = await invokeConfirmation(args, draft)
    let result = confirmation
    let settlementError
    try {
      result = await settleConfirmation(confirmation, draft)
    } catch (error) {
      settlementError = error.message
    }
    const state = {
      operationId: draft.operationId, candidateDigest: draft.candidateDigest,
      requestId, resultMarkdown: result.result_markdown,
      failureScope: result.failure_scope, confirmation: result.confirmation,
      execution: result.execution,
    }
    if (settlementError) state.technicalError = settlementError
    await saveState(path, state)
    return state
  } catch (error) {
    if (error instanceof ConfirmationConfigurationError) {
      const state = {
        operationId: draft.operationId, candidateDigest: draft.candidateDigest, requestId,
        resultMarkdown: `处理结果：未执行\n原因：${error.message}，本次确认未发送。\n操作号：${draft.operationId}\n下一步：修复实例确认配置后，重新生成草稿并确认。`,
        technicalError: error.message, failureScope: 'CONFIRMATION',
      }
      await saveState(path, state)
      return state
    }
    if (error instanceof ConfirmationWindowExpiredError || error instanceof ConfirmationRejectedError) {
      const expired = error instanceof ConfirmationWindowExpiredError
      const reason = expired
        ? `${error.message}，本次未提交、未审批、未执行。`
        : `${error.message}，本次确认未被接受。`
      const state = {
        operationId: draft.operationId, candidateDigest: draft.candidateDigest, requestId,
        resultMarkdown: `处理结果：未执行\n原因：${reason}\n操作号：${draft.operationId}\n下一步：请重新发起策略草稿后再确认。`,
        technicalError: error.message,
        failureScope: 'CONFIRMATION',
      }
      await saveState(path, state)
      return state
    }
    // A network timeout may happen after the server accepted the request.
    // Keep the same request id and do not start another confirmation on a later turn.
    const state = {
      operationId: draft.operationId, candidateDigest: draft.candidateDigest,
      requestId,
      resultMarkdown: `执行结果：待核实\n原因：未取得平台或安全运营系统权威执行结果。\n操作号：${draft.operationId}\n下一步：请稍后只查询该操作，避免重复提交。`,
      technicalError: error.message,
      failureScope: 'UNKNOWN',
    }
    await saveState(path, state)
    return state
  }
}

function confirmationArgumentsRequestId(sessionId, draft) {
  const material = `${sessionId}\n${draft.operationId}\n${draft.candidateDigest}`
  return `policy-confirmation-${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

function context(text) {
  return controlledContextMessage(name, text)
}

function refinementContext(text) {
  return {
    id: randomUUID(), role: 'user', source: { kind: name, form: 'answer' },
    content: [{
      type: 'text',
      text: `用户在原生策略草稿决策面板中补充了以下内容：\n\n${text}\n\n这段内容不是“执行”授权。旧草稿确认已作废；结合本会话原请求按补充或修改条件处理，使用新的 request_id 重新解析并准备，不得确认或提交旧草稿。`,
    }],
  }
}

function cancellationMarkdown(draft, skipped = false) {
  return [
    skipped ? '已跳过策略草稿确认。' : '已取消执行当前策略草稿。',
    '当前草稿未提交、未审批、未执行。',
    `操作号：${draft.operationId}`,
  ].join('\n')
}

async function confirmDraftForAgent(agent, draft) {
  const key = `${agent.id}\n${draft.operationId}\n${draft.candidateDigest}`
  if (!locks.has(key)) locks.set(key, confirm(agent.id, draft).finally(() => locks.delete(key)))
  return locks.get(key)
}

/** Run the trusted decision behind the native question surface. */
export async function handleNativePolicyDecision(exec, draft, answer, confirmDraft = confirmDraftForAgent) {
  const decision = nativePolicyDecision(answer, draft)
  if (decision.kind === 'execute') {
    const state = await confirmDraft(exec.agent, draft)
    return {
      kind: 'controlled', markdown: state.resultMarkdown,
      context: context(state.resultMarkdown), decision,
    }
  }
  if (decision.kind === 'custom' || decision.kind === 'cancel') {
    cancelPolicyBinding(exec.agent, draft.operationId)
    let result
    try {
      result = await submitPolicyRejection(exec.agent.id, draft.operationId, draft.candidateDigest, draft.version,
        decision.kind === 'custom' ? 'REQUEST_CHANGES' : 'REJECT',
        decision.kind === 'custom' ? decision.text : '用户在原生策略草稿面板明确取消执行', exec.signal)
    } catch (error) {
      const markdown = `处理结果：尚未取得权威取消结果\n原因：${publicSelectionError(error)}\n本地旧确认已关闭，本次未确认或执行。\n操作号：${draft.operationId}\n下一步：只查询该操作最新状态，避免重复提交。`
      await saveState(statePath(exec.agent.id, draft), { operationId: draft.operationId, candidateDigest: draft.candidateDigest,
        resultMarkdown: markdown, failureScope: 'DECISION_UNKNOWN', invalidated: true })
      return { kind: 'controlled', markdown, context: context(markdown), decision }
    }
    await saveState(statePath(exec.agent.id, draft), { operationId: draft.operationId, candidateDigest: draft.candidateDigest,
      resultMarkdown: result.result_markdown, execution: { result_code: result.result_code, task_status: result.task_status },
      failureScope: 'USER_DECISION', invalidated: true, platformCancelled: true })
    if (decision.kind === 'custom') {
      setPolicyUserRequest(exec.agent, decision.text)
      continueWithModel(exec.agent.id)
      return { kind: 'model', context: refinementContext(decision.text), decision }
    }
    return { kind: 'controlled', markdown: result.result_markdown, context: context(result.result_markdown), decision }
  }
  const markdown = cancellationMarkdown(draft, true)
    + '\n平台草稿仍待确认；本地旧确认面板已关闭。'
  cancelPolicyBinding(exec.agent, draft.operationId)
  await saveState(statePath(exec.agent.id, draft), { operationId: draft.operationId, candidateDigest: draft.candidateDigest,
    resultMarkdown: markdown, failureScope: 'SKIPPED', invalidated: true })
  return { kind: 'controlled', markdown, context: context(markdown), decision }
}

/** 原生确认不产生模型工具回执，因此后续步骤从本会话真实 DRAFT 绑定读持久状态。 */
async function confirmationStates(events, sessionId) {
  const calls = new Map()
  const states = new Map()
  for (const event of events) {
    if (event.type === 'tool/call') calls.set(event.data?.callId, event.data)
    if (event.type !== 'tool/result') continue
    const call = calls.get(event.data?.message?.source?.callId)
    if (call?.name !== RESULT) continue
    const value = resultOf(event)
    if (value?.result_code !== 'DRAFT_READY' || !value?.candidate_digest) continue
    const draft = { operationId: value.operation_id, candidateDigest: value.candidate_digest }
    const state = await loadState(statePath(sessionId, draft))
    if (state?.operationId === value.operation_id && state.candidateDigest === value.candidate_digest) states.set(state.operationId, state)
  }
  return [...states.values()]
}

/** 仅变换模型可见的旧回执，不改写 Session 原始事件与实验事实。 */
export function applyPolicyStateContext(messages, states) {
  const byOperation = new Map(states.map(state => [state.operationId, state]))
  return messages.map(message => {
    if (message.source?.kind !== 'tool') return message
    let changed = false
    const rewrite = blocks => blocks.map(block => {
      if (block.type === 'tool-result') return { ...block, content: rewrite(block.content ?? []) }
      if (block.type !== 'text') return block
      let envelope
      try { envelope = JSON.parse(block.text) } catch { return block }
      const value = projection(envelope)
      const state = byOperation.get(value?.operation_id)
      if (!state || value?.result_code !== 'DRAFT_READY' || ['SKIPPED', 'DECISION_UNKNOWN'].includes(state.failureScope)) return block
      changed = true
      const code = state.execution?.result_code ?? (state.invalidated ? 'CANCELLED' : 'EXECUTION_UNKNOWN')
      return { ...block, text: JSON.stringify({ ...envelope, data: { ...value,
        result_code: code, task_status: state.execution?.task_status ?? (state.invalidated ? 'CANCELLED' : 'UNKNOWN'),
        confirmation_required: false, result_markdown: state.resultMarkdown,
      } }) }
    })
    const content = rewrite(message.content ?? [])
    return changed ? { ...message, content } : message
  })
}

function stateContext(state) {
  return {
    id: randomUUID(), role: 'user', source: { kind: name, form: 'authoritative-state' },
    content: [{ type: 'text', text: `本会话原生确认的已知结果如下；跳过或本地确认关闭不代表平台任务已取消。不要把其他操作的状态混用。历史任务最新状态必须按操作号读取平台，不得用这份缓存替代查询。\n${JSON.stringify({ operation_id: state.operationId, candidate_digest: state.candidateDigest,
      result_code: state.execution?.result_code, task_status: state.execution?.task_status,
      confirmation: state.confirmation, failure_scope: state.failureScope, invalidated: state.invalidated === true,
      result_markdown: state.resultMarkdown })}` }],
  }
}

export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (downstream.kind !== 'accept' || (exec.agent?.session?.header?.delegationDepth ?? 0) !== 0) {
      return downstream
    }
    const draft = draftFromExecution(exec, result)
    if (!draft || isPolicyStatusQuery(exec.agent.id)) return downstream
    const previous = await loadState(statePath(exec.agent.id, draft))
    if (previous) { queueControlledOutput(exec.agent.id, previous.resultMarkdown); return downstream }
    queuePostDeliveryInteraction(exec.agent.id, async signal => {
      const asked = await askNativeOperationQuestion(
        ctx, { agent: exec.agent, signal }, policyQuestionSpec(draft))
      if (!asked.available) return
      const outcome = await handleNativePolicyDecision(
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
    const snapshot = await ctx.sessionQuery.readSession(agent.id)
    const states = await confirmationStates(snapshot.events, agent.id)
    const contextual = { ...decision, messages: [...applyPolicyStateContext(decision.messages, states), ...states.map(stateContext)] }
    const realUsers = messages.filter(message => message.source?.kind === 'user')
    if (!realUsers.length) return contextual
    if (step !== 1) return contextual
    setPolicyConfirmationTurn(agent, false)
    if (realUsers.length !== 1 || !approval(realUsers[0])) return contextual
    const draft = latestDraft(snapshot.events)
    if (!draft) return contextual
    if (states.some(state => state.operationId === draft.operationId && state.candidateDigest === draft.candidateDigest)) {
      queueControlledOutput(agent.id, '当前策略草稿已确认、取消或作废，请按操作号查询最新状态；本次未重复执行。')
      setPolicyConfirmationTurn(agent, true)
      return contextual
    }
    setPolicyConfirmationTurn(agent, true)
    const state = await confirmDraftForAgent(agent, draft)
    queueControlledOutput(agent.id, state.resultMarkdown)
    return { ...contextual, messages: [...contextual.messages, context(state.resultMarkdown)] }
  })
}
