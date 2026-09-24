#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import {
  SAFETY_STOP_REASONS,
  assertSessionIdentity,
  judgeCase,
  parseArchive,
  result,
  saveEvidence,
  turnsFromTrace,
  withCaseTimeout,
} from './dsh-eval-common.mjs'

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.cases)) throw new Error('invalid-payload')
  for (const name of ['auth_url', 'workspace', 'preset_id', 'judge_preset_id', 'evidence_root']) {
    if (typeof payload[name] !== 'string' || payload[name] === '') throw new Error('invalid-payload')
  }
  if (!Number.isInteger(payload.timeout_ms) || payload.timeout_ms < 1) throw new Error('invalid-payload')
  for (const item of payload.cases) {
    if (!item || typeof item !== 'object' || !/^U-[A-Z0-9-]+$/.test(item.case_id ?? '')
      || !Array.isArray(item.inputs) || item.inputs.length === 0
      || item.inputs.some(input => typeof input !== 'string' || input === '')
      || typeof item.expected_behavior !== 'string' || item.expected_behavior === '') {
      throw new Error('invalid-case')
    }
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

async function createSession(connection, payload, workspace, presetId, signal) {
  const created = await rpc(connection, 'session/create', {
    request: { workspaceId: workspace.workspaceId, agentPreset: presetId },
  }, signal)
  if (typeof created?.sessionId !== 'string' || created.agentPreset !== presetId) {
    throw new Error('identity-drift')
  }
  const summary = await poll(
    async pollSignal => (await listSessions(connection, pollSignal))
      .find(item => item.sessionId === created.sessionId),
    item => item !== undefined,
    payload.timeout_ms,
    signal,
  )
  return {
    session_id: created.sessionId,
    workspace_id: workspace.workspaceId,
    ...assertSessionIdentity(summary, presetId, payload.workspace),
  }
}

async function promptSession(connection, sessionId, input, inputs, timeoutMs, signal) {
  const accepted = await rpc(connection, 'session/prompt', {
    request: {
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: input }],
    },
  }, signal)
  if (accepted?.accepted !== true) throw new Error('prompt-not-accepted')
  let archive
  const turns = await poll(async () => {
    archive = await exportSession(connection, sessionId, signal)
    return turnsFromTrace(archive, inputs)
  }, value => value !== null, timeoutMs, signal)
  return { archive, turns }
}

async function runCase(connection, payload, item, workspace, signal) {
  const session = await createSession(connection, payload, workspace, payload.preset_id, signal)
  let completed
  for (let index = 0; index < item.inputs.length; index += 1) {
    completed = await promptSession(
      connection, session.session_id, item.inputs[index], item.inputs.slice(0, index + 1),
      payload.timeout_ms, signal,
    )
  }
  const { archive, turns } = completed
  const response = {
    inputs: item.inputs,
    assistant_texts: turns.map(turn => turn.assistant_text),
    session_id: session.session_id,
    turns,
  }
  const checks = {
    schema_version: '1.0',
    case_id: item.case_id,
    transport: 'api',
    expected_behavior: item.expected_behavior,
    ...session,
    trace_format: 'dsh-session-export-envelope-v1',
    completed: turns.every(turn => turn.turn_reason === 'completed'),
  }
  if (!checks.completed) {
    await saveEvidence(payload.evidence_root, item, response, archive, checks)
    return result(item, 'error', 'inconclusive', 'DSH Turn 未正常完成。', 'turn-not-completed')
  }
  const judge = await judgeCase(item, response, archive, async input => {
    const judgeSession = await createSession(
      connection, payload, workspace, payload.judge_preset_id, signal,
    )
    const judged = await promptSession(
      connection, judgeSession.session_id, input, [input], payload.timeout_ms, signal,
    )
    return { ...judged, session: judgeSession }
  })
  checks.judge = judge.checks
  await saveEvidence(payload.evidence_root, item, response, archive, checks, judge)
  if (!judge.available) {
    return result(item, 'completed', 'inconclusive', '评审未产生有效结论，需人工判定。')
  }
  const limitation = judge.checks.same_route_as_target ? ' 同一路由自评，仅作研究辅助。' : ''
  return result(item, 'completed', judge.response.verdict,
    `语义判定：${judge.response.reason}${limitation}`)
}

async function main() {
  const payload = await readInput()
  const connection = await authenticate(payload.auth_url)
  const workspace = await createWorkspace(connection, payload.workspace)
  const rows = []
  let stopReason
  for (const item of payload.cases) {
    try {
      rows.push(await withCaseTimeout(
        signal => runCase(connection, payload, item, workspace, signal),
        payload.timeout_ms * (item.inputs.length + 2),
      ))
    } catch (error) {
      const reason = SAFETY_STOP_REASONS.has(error?.message) ? error.message : 'api-case-error'
      await saveEvidence(payload.evidence_root, item,
        { inputs: item.inputs, assistant_texts: [] }, error?.archive ?? null,
        { schema_version: '1.0', case_id: item.case_id, transport: 'api', completed: false, failure_reason: reason })
      rows.push(result(item, 'error', 'inconclusive',
        reason === 'api-case-error' ? 'Runtime API 用例未完成，未产生语义结论。' : '评测身份或证据失配，已停止。',
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
