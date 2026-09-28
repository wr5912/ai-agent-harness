#!/usr/bin/env node

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
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

const COMPOSER = '[data-composer-input][contenteditable="true"]'

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
      const value = await action()
      if (accept(value)) return value
    } catch (error) {
      if (SAFETY_STOP_REASONS.has(error?.message)) throw error
    }
    await delay(300)
  }
  throw new Error('poll-timeout')
}

function diagnostic(error) {
  return `${error?.name ?? 'Error'}:${error?.message ?? 'unknown'}`
    .replace(/https?:\/\/\S+/g, '<redacted-url>')
    .replace(/token=[^&\s]+/g, 'token=<redacted>')
    .slice(0, 300)
}

async function rpc(page, method, args) {
  const response = await page.request.post(new URL(`/api/${method}`, page.url()).href, {
    data: {
      type: 'client-request',
      rpcId: `dsh-eval-${crypto.randomUUID()}`,
      method,
      payload: { args },
    },
  })
  if (!response.ok()) throw new Error('runtime-rpc-failed')
  const body = await response.json()
  if (!body?.result?.ok) throw new Error('runtime-rpc-failed')
  return body.result.value
}

async function listSessions(page) {
  const value = await rpc(page, 'session/list', { _request: {} })
  if (!Array.isArray(value?.items)) throw new Error('session-list-failed')
  return value.items
}

async function exportSession(page, sessionId) {
  const url = new URL('/api/session.export', page.url())
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('includeDescendants', 'true')
  const response = await page.request.get(url.href)
  if (!response.ok()) throw new Error('session-export-failed')
  return parseArchive(new Uint8Array(await response.body()))
}

async function resolveNewSession(page, existingIds, presetId, workspace, timeoutMs, signal) {
  const session = await poll(
    async () => (await listSessions(page)).find(item => !existingIds.has(item.sessionId)),
    item => item !== undefined,
    timeoutMs,
    signal,
  )
  return {
    session_id: session.sessionId,
    ...assertSessionIdentity(session, presetId, workspace),
  }
}

async function createApiSession(page, payload, workspace, presetId, signal) {
  const created = await rpc(page, 'session/create', {
    request: { workspaceId: workspace.workspaceId, agentPreset: presetId },
  })
  if (typeof created?.sessionId !== 'string' || created.agentPreset !== presetId) {
    throw new Error('identity-drift')
  }
  const summary = await poll(
    async () => (await listSessions(page)).find(item => item.sessionId === created.sessionId),
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

async function dismissTestingNotice(page, timeoutMs) {
  const notice = page.getByRole('dialog', { name: 'Internal Testing Notice' })
  try {
    await notice.waitFor({ state: 'visible', timeout: timeoutMs })
    await notice.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs })
    return true
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error
    return false
  }
}

async function connectWorkspace(page, workspace, timeoutMs) {
  const chooser = page.getByRole('textbox', { name: 'Choose workspace' })
  const composer = page.locator(COMPOSER).last()
  let noticeDismissed = false
  const state = await poll(async () => {
    noticeDismissed = await dismissTestingNotice(page, 500) || noticeDismissed
    return {
      ready: await composer.isVisible().catch(() => false),
      chooser: await chooser.isVisible().catch(() => false),
    }
  }, value => value.ready || value.chooser, timeoutMs)
  if (state.ready) return { testing_notice_dismissed: noticeDismissed, workspace_action: 'already-registered' }
  await chooser.click({ timeout: timeoutMs })
  const dialog = page.getByRole('dialog').last()
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(workspace)
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await composer.waitFor({ timeout: timeoutMs })
  return { testing_notice_dismissed: noticeDismissed, workspace_action: 'selected' }
}

async function send(page, text, timeoutMs) {
  const composer = page.locator(COMPOSER).last()
  await composer.waitFor({ timeout: timeoutMs })
  await composer.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await composer.press('Enter')
}

async function waitForTurns(page, sessionId, inputs, timeoutMs, signal) {
  let archive
  const turns = await poll(async () => {
    archive = await exportSession(page, sessionId)
    return turnsFromTrace(archive, inputs)
  }, value => value !== null, timeoutMs, signal)
  return { archive, turns }
}

async function waitForDisplayedTurn(page, turn, timeoutMs, signal) {
  if (turn.input_message_id === null || turn.turn === null) throw new Error('turn-render-key-missing')
  const userKey = `${'input-message'.length}:input-message${turn.input_message_id}`
  const assistantPrefix = `${'assistant-step'.length}:assistant-step${turn.turn}:`
  return await poll(async () => ({
    input_message_displayed: await page.locator(`[data-chat-anchor-key="${userKey}"]`).isVisible().catch(() => false),
    assistant_message_displayed: await page.locator(`[data-chat-anchor-key^="${assistantPrefix}"]`).last()
      .isVisible().catch(() => false),
  }), value => value.input_message_displayed && value.assistant_message_displayed, timeoutMs, signal)
}

async function promptApiSession(page, session, input, timeoutMs, signal) {
  const accepted = await rpc(page, 'session/prompt', {
    request: {
      requestId: crypto.randomUUID(),
      sessionId: session.session_id,
      mode: 'queue',
      content: [{ type: 'text', text: input }],
    },
  })
  if (accepted?.accepted !== true) throw new Error('prompt-not-accepted')
  const completed = await waitForTurns(page, session.session_id, [input], timeoutMs, signal)
  return { ...completed, session }
}

async function runCase(page, payload, item, workspace, uiStartup, signal) {
  const existingIds = new Set((await listSessions(page)).map(session => session.sessionId))
  await page.getByRole('button', { name: 'New session', exact: true }).last().click()
  let session = null
  let completed
  for (let index = 0; index < item.inputs.length; index += 1) {
    await send(page, item.inputs[index], payload.timeout_ms)
    if (session === null) {
      session = await resolveNewSession(
        page, existingIds, payload.preset_id, payload.workspace, payload.timeout_ms, signal,
      )
    }
    completed = await waitForTurns(
      page, session.session_id, item.inputs.slice(0, index + 1), payload.timeout_ms, signal,
    )
    await waitForDisplayedTurn(page, completed.turns.at(-1), payload.timeout_ms, signal)
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
    transport: 'browser',
    expected_behavior: item.expected_behavior,
    ...session,
    ui_startup: uiStartup,
    trace_format: 'dsh-session-export-envelope-v1',
    completed: turns.every(turn => turn.turn_reason === 'completed'),
  }
  if (!checks.completed) {
    await saveEvidence(payload.evidence_root, item, response, archive, checks)
    return result(item, 'error', 'inconclusive', 'DSH Turn 未正常完成。', 'turn-not-completed')
  }
  const judge = await judgeCase(item, response, archive, async input => {
    const judgeSession = await createApiSession(
      page, payload, workspace, payload.judge_preset_id, signal,
    )
    return await promptApiSession(page, judgeSession, input, payload.timeout_ms, signal)
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
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const rows = []
  let stopReason
  try {
    const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Asia/Shanghai' })
    const page = await context.newPage()
    await page.goto(payload.auth_url, { waitUntil: 'domcontentloaded', timeout: payload.timeout_ms })
    await page.locator('[class*="frame"]').waitFor({ timeout: payload.timeout_ms })
    const uiStartup = await connectWorkspace(page, payload.workspace, payload.timeout_ms)
    const workspaceValue = await rpc(page, 'workspace/create', { request: { path: payload.workspace } })
    const workspace = workspaceValue?.workspace
    if (typeof workspace?.workspaceId !== 'string' || workspace.path !== payload.workspace) {
      throw new Error('identity-drift')
    }
    for (const item of payload.cases) {
      try {
        rows.push(await withCaseTimeout(
          signal => runCase(page, payload, item, workspace, uiStartup, signal),
          payload.timeout_ms * (item.inputs.length + 2),
        ))
      } catch (error) {
        const reason = SAFETY_STOP_REASONS.has(error?.message) ? error.message : 'browser-case-error'
        const directory = join(payload.evidence_root, item.case_id)
        await mkdir(directory, { recursive: true })
        try { await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }) } catch {}
        await saveEvidence(payload.evidence_root, item,
          { inputs: item.inputs, assistant_texts: [] }, error?.archive ?? null,
          {
            schema_version: '1.0', case_id: item.case_id, transport: 'browser',
            completed: false, failure_reason: reason, failure_detail: diagnostic(error),
          })
        rows.push(result(item, 'error', 'inconclusive',
          reason === 'browser-case-error' ? '浏览器用例未完成，未产生语义结论。' : '评测身份或证据失配，已停止。',
          reason))
        if (SAFETY_STOP_REASONS.has(reason)) {
          stopReason = reason
          break
        }
      }
    }
    await context.close()
  } finally {
    await browser.close()
  }
  process.stdout.write(`${JSON.stringify({
    schema_version: '1.0',
    executor: 'browser',
    rows,
    ...(stopReason ? { stop_reason: stopReason } : {}),
  })}\n`)
}

main().catch(error => {
  process.stderr.write(`dsh-eval-browser failed: ${error?.name ?? 'Error'}\n`)
  process.exitCode = 2
})
