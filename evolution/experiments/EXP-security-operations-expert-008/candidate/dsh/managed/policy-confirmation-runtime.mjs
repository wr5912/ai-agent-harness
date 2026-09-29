import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { setPolicyConfirmationTurn } from './policy-configuration-guard.mjs'

export const name = 'policy-confirmation-runtime'
export const inject = ['sessionQuery']

const RESULT = 'mcp__policy-configuration__get_policy_configuration_result'
const STATUS = 'mcp__policy-configuration__get_policy_configuration_status'
const STATE_DIR = '/var/lib/dsh/policy-confirmation-state'
const locks = new Map()

const textOf = message => message?.content?.filter(item => item.type === 'text').map(item => item.text).join('') ?? ''
const approval = message => message?.source?.kind === 'user' && textOf(message).trim() === '执行'

function projection(value) {
  if (!value || typeof value !== 'object') return null
  if (value.code === '200' && value.data && typeof value.data === 'object') return value.data
  return null
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
      !/^sha256:[0-9a-f]{64}$/.test(current.candidate_digest ?? '')) return null
  if (projections.some(item => item.operation_id === current.operation_id &&
      item.candidate_digest && item.candidate_digest !== current.candidate_digest)) return null
  return { operationId: current.operation_id, candidateDigest: current.candidate_digest, taskId: current.task_id }
}

export function confirmationArguments(sessionId, draft) {
  const material = `${sessionId}\n${draft.operationId}\n${draft.candidateDigest}`
  return {
    operationId: draft.operationId,
    body: {
      request_id: `policy-confirmation-${createHash('sha256').update(material).digest('hex').slice(0, 32)}`,
      candidate_digest: draft.candidateDigest,
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

function decodeResponse(raw, contentType) {
  if (!raw.trim()) return null
  if (!contentType.includes('text/event-stream')) return JSON.parse(raw)
  const lines = raw.split(/\r?\n/).filter(line => line.startsWith('data:'))
  if (!lines.length) throw new Error('MCP SSE 响应缺少 data')
  return JSON.parse(lines.at(-1).slice(5).trim())
}

class RetryableError extends Error {}

async function post(url, token, payload, sessionId, timeoutMs) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId
  let response
  try {
    response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch { throw new RetryableError('MCP 传输失败或超时') }
  if (response.status === 503) throw new RetryableError('MCP 暂时不可用')
  if (!response.ok) throw new Error(`MCP 请求被拒绝（HTTP ${response.status}）`)
  const body = decodeResponse(await response.text(), response.headers.get('content-type') ?? '')
  return { body, sessionId: response.headers.get('mcp-session-id') }
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

async function callOnce(args, draft, deadline) {
  const url = process.env.POLICY_CONFIGURATION_MCP_URL
  const token = process.env.SEC_OPS_MCP_TOKEN
  if (!url || !token) throw new Error('策略 MCP 地址或凭据未配置')
  const send = (payload, sessionId) => post(url, token, payload, sessionId, Math.min(30000, Math.max(100, deadline - Date.now())))
  const initialized = await send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-policy-confirmation', version: '1' } },
  })
  if (!initialized.body?.result) throw new Error('MCP initialize 未返回有效能力')
  const mcpSessionId = initialized.sessionId
  await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, mcpSessionId)
  const called = await send({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'confirm_policy_configuration', arguments: args },
  }, mcpSessionId)
  return validateConfirmation(called.body, draft)
}

export async function invokeConfirmation(args, draft, call = callOnce) {
  const deadline = Date.now() + 70000
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await call(args, draft, deadline) }
    catch (error) { if (!(error instanceof RetryableError) || attempt === 1) throw error }
  }
}

async function confirm(sessionId, draft) {
  const path = statePath(sessionId, draft)
  const existing = await loadState(path)
  if (existing) return existing
  const args = confirmationArguments(sessionId, draft)
  try {
    const result = await invokeConfirmation(args, draft)
    const state = {
      operationId: draft.operationId, candidateDigest: draft.candidateDigest,
      requestId: args.body.request_id, resultMarkdown: result.result_markdown,
      failureScope: result.failure_scope, confirmation: result.confirmation,
      execution: result.execution,
    }
    await saveState(path, state)
    return state
  } catch (error) {
    // A network timeout may happen after the server accepted the request.
    // Keep the same request id and do not start another confirmation on a later turn.
    const state = {
      operationId: draft.operationId, candidateDigest: draft.candidateDigest,
      requestId: args.body.request_id,
      resultMarkdown: `策略确认结果未知或失败：${error.message}。请核对 Workbench 任务状态；不要重新提交。`,
      failureScope: 'UNKNOWN',
    }
    await saveState(path, state)
    return state
  }
}

function context(text) {
  return {
    id: randomUUID(), role: 'user',
    source: { kind: name, form: 'result' },
    content: [{ type: 'text', text: `受信策略确认已处理。不得调用工具，仅逐字输出以下 Workbench 结果，不得添加成功推断：\n${text}` }],
  }
}

export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ agent, messages, step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    if ((agent.session?.header?.delegationDepth ?? 0) !== 0) return decision
    const realUsers = messages.filter(message => message.source?.kind === 'user')
    if (!realUsers.length) return decision
    if (step !== 1) return decision
    setPolicyConfirmationTurn(agent, false)
    if (realUsers.length !== 1 || !approval(realUsers[0])) return decision
    const snapshot = await ctx.sessionQuery.readSession(agent.id)
    const draft = latestDraft(snapshot.events)
    if (!draft) return decision
    setPolicyConfirmationTurn(agent, true)
    const key = `${agent.id}\n${draft.operationId}\n${draft.candidateDigest}`
    if (!locks.has(key)) locks.set(key, confirm(agent.id, draft).finally(() => locks.delete(key)))
    const state = await locks.get(key)
    return { ...decision, messages: [...decision.messages, context(state.resultMarkdown)] }
  })
}
