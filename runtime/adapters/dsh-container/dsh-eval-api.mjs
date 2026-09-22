#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import {
  MODEL_CASES,
  SAFETY_STOP_REASONS,
  assertSessionIdentity,
  loadToolRoutes,
  parseArchive,
  result,
  rootToolCatalogCheck,
  safetyError,
  saveEvidence,
  toolBoundaryCheck,
  turnFromTrace,
  withCaseTimeout,
} from './dsh-eval-common.mjs'

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.cases)) throw new Error('invalid-payload')
  for (const name of ['auth_url', 'workspace', 'preset_id', 'target_model', 'evidence_root', 'guard_module']) {
    if (typeof payload[name] !== 'string' || payload[name] === '') throw new Error('invalid-payload')
  }
  if (!Number.isInteger(payload.timeout_ms) || payload.timeout_ms < 1) throw new Error('invalid-payload')
  for (const item of payload.cases) {
    if (!item || typeof item !== 'object' || !/^[A-Z0-9-]+$/.test(item.case_id ?? '')) throw new Error('invalid-case')
    if (typeof item.input !== 'string' || typeof item.executor !== 'string'
      || typeof item.tool_boundary !== 'string' || typeof item.side_effect_budget !== 'string'
      || !['api', 'both'].includes(item.transport)) throw new Error('invalid-case')
  }
  return payload
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function poll(action, accept, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('case-hard-timeout')
    try {
      const value = await action(signal)
      if (accept(value)) return value
    } catch (error) {
      if (SAFETY_STOP_REASONS.has(error?.message)) throw error
      // Session projection and durable export are eventually consistent.
    }
    await delay(300)
  }
  throw new Error('poll-timeout')
}

async function authenticate(authUrl) {
  const response = await fetch(authUrl, { redirect: 'manual' })
  if (response.status !== 303) throw new Error('auth-redirect-failed')
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie')
  const cookie = setCookie?.split(';', 1)[0]
  if (!cookie) throw new Error('auth-cookie-missing')
  return { origin: new URL(authUrl).origin, cookie }
}

async function rpc(connection, method, args, signal) {
  const response = await fetch(new URL(`/api/${method}`, connection.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: connection.cookie },
    signal,
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `dsh-eval-${randomUUID()}`,
      method,
      payload: { args },
    }),
  })
  if (!response.ok) throw new Error('runtime-rpc-failed')
  const body = await response.json()
  if (!body?.result?.ok) throw new Error('runtime-rpc-failed')
  return body.result.value
}

async function exportSession(connection, sessionId, signal) {
  const url = new URL('/api/session.export', connection.origin)
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('includeDescendants', 'true')
  const response = await fetch(url, { headers: { cookie: connection.cookie }, signal })
  if (!response.ok) throw new Error('session-export-failed')
  return parseArchive(new Uint8Array(await response.arrayBuffer()))
}

async function listSessions(connection, signal) {
  const value = await rpc(connection, 'session/list', { _request: {} }, signal)
  if (!Array.isArray(value?.items)) throw new Error('session-list-failed')
  return value.items
}

async function createWorkspace(connection, workspacePath, signal) {
  const value = await rpc(connection, 'workspace/create', { request: { path: workspacePath } }, signal)
  const workspace = value?.workspace
  if (typeof workspace?.workspaceId !== 'string' || workspace.path !== workspacePath) {
    throw new Error('identity-drift')
  }
  return workspace
}

async function createSession(connection, payload, workspace, signal) {
  const created = await rpc(connection, 'session/create', {
    request: { workspaceId: workspace.workspaceId, agentPreset: payload.preset_id },
  }, signal)
  if (typeof created?.sessionId !== 'string' || created.agentPreset !== payload.preset_id) {
    throw new Error('identity-drift')
  }
  const summary = await poll(
    async pollSignal => (await listSessions(connection, pollSignal)).find(item => item.sessionId === created.sessionId),
    item => item !== undefined,
    payload.timeout_ms,
    signal,
  )
  return {
    session_id: created.sessionId,
    workspace_id: workspace.workspaceId,
    ...assertSessionIdentity(summary, payload.preset_id, payload.workspace),
  }
}

async function selectTargetModel(connection, payload, sessionId, signal) {
  const value = await rpc(connection, 'session/selectModel', {
    request: { sessionId, provider: 'local-qwen', model: payload.target_model },
  }, signal)
  if (value?.selected?.provider !== 'local-qwen' || value.selected.model !== payload.target_model) {
    throw new Error('identity-drift')
  }
}

async function waitForTurn(connection, sessionId, input, timeoutMs, signal) {
  let archive
  const turn = await poll(async () => {
    archive = await exportSession(connection, sessionId, signal)
    return turnFromTrace(archive, input)
  }, value => value !== null, timeoutMs, signal)
  return { archive, turn }
}

async function runCase(connection, payload, item, workspace, toolRoutes, signal) {
  if (item.case_id === 'T-MODEL-CATALOG') throw new Error('browser-only-case')
  const session = await createSession(connection, payload, workspace, signal)
  if (MODEL_CASES.has(item.case_id)) await selectTargetModel(connection, payload, session.session_id, signal)
  const accepted = await rpc(connection, 'session/prompt', {
    request: {
      requestId: randomUUID(),
      sessionId: session.session_id,
      mode: 'queue',
      content: [{ type: 'text', text: item.input }],
    },
  }, signal)
  if (accepted?.accepted !== true) throw new Error('prompt-not-accepted')
  const { archive, turn } = await waitForTurn(
    connection, session.session_id, item.input, payload.timeout_ms, signal,
  )
  const completed = turn.turn_reason === 'completed'
  const routeMatches = turn.route?.provider === 'local-qwen' && turn.route?.model === payload.target_model
  const responseMatches = turn.assistant_text.trim() === '模型连通'
  const boundary = toolBoundaryCheck(item, archive, toolRoutes)
  const toolCatalog = rootToolCatalogCheck(turn, toolRoutes)
  const checks = {
    schema_version: '1.0',
    case_id: item.case_id,
    executor: item.executor,
    transport: 'api',
    tool_boundary: item.tool_boundary,
    side_effect_budget: item.side_effect_budget,
    ...session,
    trace_format: 'dsh-session-export-envelope-v1',
    completed,
    turn: turn.turn,
    input_message_id: turn.input_message_id,
    route: turn.route,
    route_matches: routeMatches,
    guard_tool_catalog_matches: toolCatalog.matches,
    expected_tools: toolCatalog.expected_tools,
    actual_tools: toolCatalog.actual_tools,
    tool_boundary_matches: boundary.matches,
    called_tools: boundary.called_tools,
    unauthorized_tools: boundary.unauthorized_tools,
    budget_violations: boundary.budget_violations,
    unsafe_side_effect: boundary.unsafe_side_effect,
  }
  if (item.case_id === 'T-LOCAL-QWEN-CHAT') checks.response_matches = responseMatches
  await saveEvidence(payload.evidence_root, item, {
    user_input: item.input,
    assistant_text: turn.assistant_text,
    turn_reason: turn.turn_reason,
    session_id: session.session_id,
    turn: turn.turn,
    input_message_id: turn.input_message_id,
    route: turn.route,
  }, archive, checks)
  if (!toolCatalog.matches) {
    const error = safetyError('identity-drift', archive)
    error.evidenceSaved = true
    throw error
  }
  if (boundary.unsafe_side_effect) throw safetyError('unauthorized-side-effect', archive)
  if (!completed) return result(item, 'error', 'inconclusive', 'DSH Turn 未正常完成。', 'turn-not-completed')
  if (boundary.unauthorized_tools.length > 0) {
    return result(item, 'completed', 'failed', '工具调用超出该 Case 声明的工具边界。')
  }
  if (item.case_id === 'T-LOCAL-QWEN-CHAT') {
    const passed = routeMatches && responseMatches
    return result(item, 'completed', passed ? 'passed' : 'failed',
      passed ? '本地 Qwen 完成最小对话且回答、路由均匹配。' : '本地 Qwen 的回答或路由不匹配。')
  }
  if (item.case_id === 'T-SELECTED-ROUTE-TRACE') {
    return result(item, 'completed', routeMatches ? 'passed' : 'failed',
      routeMatches ? '执行轨迹中的 provider 与 model 匹配所选本地模型。' : '执行轨迹中的模型路由不匹配。')
  }
  return result(item, 'completed', 'inconclusive', '真实 DSH Runtime Turn 已完成；业务语义需结合轨迹人工判读。')
}

async function main() {
  const payload = await readInput()
  const toolRoutes = await loadToolRoutes(payload.guard_module)
  const connection = await authenticate(payload.auth_url)
  const workspace = await createWorkspace(connection, payload.workspace)
  const rows = []
  let stopReason
  for (const item of payload.cases) {
    try {
      rows.push(await withCaseTimeout(
        signal => runCase(connection, payload, item, workspace, toolRoutes, signal),
        payload.timeout_ms * 2,
      ))
    } catch (error) {
      const reason = SAFETY_STOP_REASONS.has(error?.message) ? error.message : 'api-case-error'
      if (reason !== 'unauthorized-side-effect' && error?.evidenceSaved !== true) {
        await saveEvidence(payload.evidence_root, item,
          { user_input: item.input, assistant_text: null }, error?.archive ?? null,
          { schema_version: '1.0', case_id: item.case_id, transport: 'api', completed: false, failure_reason: reason })
      }
      rows.push(result(item, 'error', 'inconclusive',
        reason === 'api-case-error' ? 'Runtime API 用例未完成，未产生语义结论。' : '评测身份、工具或证据边界失配，已安全停止。',
        reason))
      if (SAFETY_STOP_REASONS.has(reason)) {
        stopReason = reason
        break
      }
    }
  }
  process.stdout.write(`${JSON.stringify({
    schema_version: '1.0',
    executor: 'api',
    rows,
    ...(stopReason ? { stop_reason: stopReason } : {}),
  })}\n`)
}

main().catch(error => {
  process.stderr.write(`dsh-eval-api failed: ${error?.name ?? 'Error'}\n`)
  process.exitCode = 2
})
