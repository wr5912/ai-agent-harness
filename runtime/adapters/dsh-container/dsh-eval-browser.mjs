#!/usr/bin/env node

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import {
  SAFETY_STOP_REASONS,
  assertSessionIdentity,
  loadToolRoutes,
  parseArchive,
  result,
  rootToolCatalogCheck,
  runCheckScripts,
  safetyError,
  saveEvidence,
  toolBoundaryCheck,
  turnFromTrace,
  withCaseTimeout,
} from './dsh-eval-common.mjs'

const COMPOSER = '[data-composer-input][contenteditable="true"]'

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.cases)) throw new Error('invalid-payload')
  if (typeof payload.auth_url !== 'string' || typeof payload.workspace !== 'string'
    || typeof payload.preset_id !== 'string') throw new Error('invalid-payload')
  if (typeof payload.evidence_root !== 'string' || typeof payload.guard_module !== 'string'
    || !Number.isInteger(payload.timeout_ms)) throw new Error('invalid-payload')
  for (const item of payload.cases) {
    if (!item || typeof item !== 'object' || !/^[A-Z0-9-]+$/.test(item.case_id ?? '')) throw new Error('invalid-case')
    if (typeof item.input !== 'string' || typeof item.executor !== 'string'
      || typeof item.tool_boundary !== 'string' || typeof item.side_effect_budget !== 'string'
      || !Array.isArray(item.acceptance_ids) || !Array.isArray(item.method_ids)
      || typeof item.judgment_role !== 'string' || typeof item.expected_behavior !== 'string'
      || typeof item.check_method !== 'string'
      || !Array.isArray(item.check_scripts)
      || item.check_scripts.some(script => typeof script?.id !== 'string' || typeof script?.source !== 'string')
      || typeof item.target_model_provider !== 'string' || typeof item.target_model !== 'string'
      || typeof item.default_model_pattern !== 'string'
      || !['browser', 'both'].includes(item.transport)) {
      throw new Error('invalid-case')
    }
  }
  return payload
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function diagnostic(error) {
  const name = typeof error?.name === 'string' ? error.name : 'Error'
  const message = typeof error?.message === 'string' ? error.message : 'unknown'
  return `${name}:${message}`
    .replace(/https?:\/\/\S+/g, '<redacted-url>')
    .replace(/token=[^&\s]+/g, 'token=<redacted>')
    .slice(0, 300)
}

async function poll(action, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let value
  while (Date.now() < deadline) {
    try {
      value = await action()
      if (accept(value)) return value
    } catch (error) {
      if (SAFETY_STOP_REASONS.has(error?.message)) throw error
      // Session registration and durable export are eventually consistent.
    }
    await delay(300)
  }
  throw new Error('poll-timeout')
}

async function listSessions(page) {
  const response = await page.request.post(new URL('/api/session/list', page.url()).href, {
    data: {
      type: 'client-request',
      rpcId: `dsh-eval-${crypto.randomUUID()}`,
      method: 'session/list',
      payload: { args: { _request: {} } },
    },
  })
  if (!response.ok()) throw new Error('session-list-failed')
  const body = await response.json()
  if (!body?.result?.ok) throw new Error('session-list-failed')
  return body.result.value.items
}

async function newSession(page, existingIds, presetId, workspace, timeoutMs) {
  if (existingIds !== null) {
    await page.getByRole('button', { name: 'New session', exact: true }).last().click()
    await page.locator(COMPOSER).last().waitFor({ timeout: timeoutMs })
    return null
  }
  return await resolveSession(page, existingIds, presetId, workspace, timeoutMs)
}

async function resolveSession(page, existingIds, presetId, workspace, timeoutMs) {
  const item = await poll(
    async () => (await listSessions(page)).find(candidate => !existingIds?.has(candidate.sessionId)),
    candidate => candidate !== undefined,
    timeoutMs,
  )
  return {
    session_id: item.sessionId,
    ...assertSessionIdentity(item, presetId, workspace),
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
  // 复用同一 DSH Home 时工作区已经注册，界面会直接进入可输入状态。
  const chooser = page.getByRole('textbox', { name: 'Choose workspace' })
  const composer = page.locator(COMPOSER).last()
  let testingNoticeDismissed = false
  const state = await poll(async () => {
    testingNoticeDismissed = await dismissTestingNotice(page, 500) || testingNoticeDismissed
    return {
      ready: await composer.isVisible().catch(() => false),
      chooser: await chooser.isVisible().catch(() => false),
    }
  }, value => value.ready || value.chooser, timeoutMs)
  if (state.ready) {
    return {
      testing_notice_dismissed: testingNoticeDismissed,
      workspace_prompt_visible: false,
      workspace_action: 'already-registered',
      composer_ready: true,
    }
  }
  try {
    await chooser.click({ timeout: 5000 })
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error
    testingNoticeDismissed = await dismissTestingNotice(page, timeoutMs) || testingNoticeDismissed
    await chooser.click({ timeout: timeoutMs })
  }
  const dialog = page.getByRole('dialog').last()
  await dialog.waitFor({ timeout: timeoutMs })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(workspace)
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator(COMPOSER).last().waitFor({ timeout: timeoutMs })
  return {
    testing_notice_dismissed: testingNoticeDismissed,
    workspace_prompt_visible: true,
    workspace_action: 'selected',
    composer_ready: true,
  }
}

async function closeModelMenu(page, trigger, timeoutMs) {
  // 菜单打开后焦点已不在菜单内，Escape 不会关闭它；点击菜单外的空白区域才可靠收起。
  await page.mouse.click(12, 12)
  await poll(() => trigger.getAttribute('aria-expanded'), value => value !== 'true', timeoutMs)
}

async function openModelCatalog(page, timeoutMs) {
  const trigger = page.getByRole('button', { name: /^Select model, current/ })
  await trigger.waitFor({ timeout: timeoutMs })
  await trigger.click()
  await page.getByRole('menuitem', { name: /^Model\b/ }).click()
  const radios = page.getByRole('menuitemradio')
  await poll(() => radios.count(), count => count > 0, timeoutMs)
  const entries = await radios.evaluateAll(nodes => nodes.map(node => ({
    name: (node.textContent ?? '').trim(),
    selected: node.getAttribute('aria-checked') === 'true',
  })))
  await closeModelMenu(page, trigger, timeoutMs)
  return entries
}

async function selectModel(page, name, timeoutMs) {
  const trigger = page.getByRole('button', { name: /^Select model, current/ })
  await trigger.click()
  await page.getByRole('menuitem', { name: /^Model\b/ }).click()
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await poll(() => trigger.getAttribute('aria-label'), value => value?.includes(name), timeoutMs)
  await poll(() => trigger.getAttribute('aria-expanded'), value => value === 'false', timeoutMs)
}

async function send(page, text, timeoutMs) {
  const composer = page.locator(COMPOSER).last()
  await composer.waitFor({ timeout: timeoutMs })
  await composer.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(text)
  await composer.press('Enter')
}

async function exportSession(page, sessionId) {
  const url = new URL('/api/session.export', page.url())
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('includeDescendants', 'true')
  const response = await page.request.get(url.href)
  if (!response.ok()) throw new Error('session-export-failed')
  return parseArchive(new Uint8Array(await response.body()))
}

async function waitForTurn(page, sessionId, input, timeoutMs) {
  let archive
  const turn = await poll(async () => {
    archive = await exportSession(page, sessionId)
    return turnFromTrace(archive, input)
  }, value => value !== null, timeoutMs)
  return { archive, turn }
}

async function waitForDisplayedTurn(page, turn, timeoutMs) {
  if (turn.input_message_id === null || turn.turn === null) throw new Error('turn-render-key-missing')
  const userKey = `${'input-message'.length}:input-message${turn.input_message_id}`
  const assistantPrefix = `${'assistant-step'.length}:assistant-step${turn.turn}:`
  const user = page.locator(`[data-chat-anchor-key="${userKey}"]`)
  const assistant = page.locator(`[data-chat-anchor-key^="${assistantPrefix}"]`).last()
  return await poll(async () => ({
    input_message_displayed: await user.isVisible().catch(() => false)
      && await user.getAttribute('data-chat-flow-kind') === 'user',
    assistant_message_displayed: await assistant.isVisible().catch(() => false)
      && await assistant.getAttribute('data-chat-flow-kind') === 'assistant-step',
  }), value => value.input_message_displayed && value.assistant_message_displayed, timeoutMs)
}

async function runCase(page, payload, item, session, existingIds, catalog, defaultModel, toolRoutes, uiStartup) {
  const uiStartupMatches = uiStartup.composer_ready
    && ['selected', 'already-registered'].includes(uiStartup.workspace_action)
  if (item.case_id === 'T-MODEL-CATALOG') {
    const baseChecks = {
      schema_version: '1.0',
      case_id: item.case_id,
      executor: item.executor,
      transport: 'browser',
      tool_boundary: item.tool_boundary,
      side_effect_budget: item.side_effect_budget,
      acceptance_ids: item.acceptance_ids,
      method_ids: item.method_ids,
      judgment_role: item.judgment_role,
      expected_behavior: item.expected_behavior,
      check_method: item.check_method,
      target_model_provider: item.target_model_provider,
      target_model: item.target_model,
      default_model_pattern: item.default_model_pattern,
      ...session,
      trace_format: 'dsh-session-export-envelope-v1',
      ui_startup: uiStartup,
      ui_startup_matches: uiStartupMatches,
    }
    const response = { catalog, default_model: defaultModel }
    const checks = {
      ...baseChecks,
      catalog,
      default_model: defaultModel,
    }
    const codeChecks = runCheckScripts(item.check_scripts, {
      case: item, response, checks, catalog, default_model: defaultModel,
    })
    checks.code_checks = codeChecks
    await saveEvidence(payload.evidence_root, item, response, null, checks)
    if (!uiStartupMatches) {
      return result(item, 'error', 'inconclusive', '浏览器首屏或 Workspace 选择路径未完整覆盖。', 'browser-startup-incomplete')
    }
    if (codeChecks.some(check => !check.passed)) {
      return result(item, 'completed', 'failed', 'Web 模型目录的确定性代码检查未通过。')
    }
    return codeChecks.length > 0
      ? result(item, 'completed', 'passed', 'Web 模型目录的确定性代码检查通过。')
      : result(item, 'completed', 'inconclusive', 'Web 模型目录已读取，但没有可执行的判定脚本。')
  }

  const selectedModel = item.target_model || defaultModel
  await selectModel(page, selectedModel, payload.timeout_ms)
  await send(page, item.input, payload.timeout_ms)
  if (session === null) {
    session = await resolveSession(page, existingIds, payload.preset_id, payload.workspace, payload.timeout_ms)
  }
  const sessionId = session.session_id
  const { archive, turn } = await waitForTurn(page, sessionId, item.input, payload.timeout_ms)
  const display = await waitForDisplayedTurn(page, turn, payload.timeout_ms)
  const baseChecks = {
    schema_version: '1.0',
    case_id: item.case_id,
    executor: item.executor,
    transport: 'browser',
    tool_boundary: item.tool_boundary,
    side_effect_budget: item.side_effect_budget,
    acceptance_ids: item.acceptance_ids,
    method_ids: item.method_ids,
    judgment_role: item.judgment_role,
    expected_behavior: item.expected_behavior,
    check_method: item.check_method,
    target_model_provider: item.target_model_provider,
    target_model: item.target_model,
    default_model_pattern: item.default_model_pattern,
    ...session,
    trace_format: 'dsh-session-export-envelope-v1',
    ui_startup: uiStartup,
    ui_startup_matches: uiStartupMatches,
    ui_selected_model: selectedModel,
    ui_message_submitted: true,
    ui_display: display,
  }
  const completed = turn.turn_reason === 'completed'
  const boundary = toolBoundaryCheck(item, archive, toolRoutes)
  const toolCatalog = rootToolCatalogCheck(turn, toolRoutes)
  const checks = {
    ...baseChecks,
    completed,
    turn: turn.turn,
    input_message_id: turn.input_message_id,
    route: turn.route,
    selected_route_matches: !item.target_model || (
      turn.route?.provider === item.target_model_provider && turn.route?.model === item.target_model
    ),
    guard_tool_catalog_matches: toolCatalog.matches,
    expected_tools: toolCatalog.expected_tools,
    actual_tools: toolCatalog.actual_tools,
    tool_boundary_matches: boundary.matches,
    called_tools: boundary.called_tools,
    unauthorized_tools: boundary.unauthorized_tools,
    budget_violations: boundary.budget_violations,
    unsafe_side_effect: boundary.unsafe_side_effect,
  }
  const response = {
    user_input: item.input,
    assistant_text: turn.assistant_text,
    turn_reason: turn.turn_reason,
    session_id: sessionId,
    turn: turn.turn,
    input_message_id: turn.input_message_id,
    route: turn.route,
  }
  const codeChecks = runCheckScripts(item.check_scripts, { case: item, response, checks })
  checks.code_checks = codeChecks
  await saveEvidence(payload.evidence_root, item, response, archive, checks)
  if (!toolCatalog.matches) {
    const error = safetyError('identity-drift', archive)
    error.evidenceSaved = true
    throw error
  }
  if (boundary.unsafe_side_effect) {
    const error = safetyError('unauthorized-side-effect', archive)
    error.evidenceSaved = true
    throw error
  }
  if (!uiStartupMatches) {
    return result(item, 'error', 'inconclusive', '浏览器首屏或 Workspace 选择路径未完整覆盖。', 'browser-startup-incomplete')
  }
  if (!completed) return result(item, 'error', 'inconclusive', 'DSH Turn 未正常完成。', 'turn-not-completed')
  if (!boundary.matches) {
    return result(item, 'completed', 'failed', '工具调用或副作用超出该 Case 声明的边界。')
  }
  if (codeChecks.some(check => !check.passed)) {
    return result(item, 'completed', 'failed', '确定性代码检查未通过。')
  }
  return codeChecks.length > 0
    ? result(item, 'completed', 'passed', '确定性代码检查通过。')
    : result(item, 'completed', 'inconclusive', '真实 Web Turn 已完成；现有方法不足以自动判定语义。')
}

async function main() {
  const payload = await readInput()
  const toolRoutes = await loadToolRoutes(payload.guard_module)
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
    const catalog = await openModelCatalog(page, payload.timeout_ms)
    const defaultModel = catalog.find(entry => entry.selected)?.name
    if (!defaultModel) throw new Error('default-model-missing')

    let existingIds = null
    for (const item of payload.cases) {
      let session
      let stage = 'new-session'
      try {
        const knownIds = existingIds
        session = await newSession(page, knownIds, payload.preset_id, payload.workspace, payload.timeout_ms)
        stage = 'run-case'
        rows.push(await withCaseTimeout(
          () => runCase(page, payload, item, session, knownIds, catalog, defaultModel, toolRoutes, uiStartup),
          payload.timeout_ms * 2,
        ))
        existingIds = new Set((await listSessions(page)).map(item => item.sessionId))
      } catch (error) {
        const reason = SAFETY_STOP_REASONS.has(error?.message) ? error.message : 'browser-case-error'
        const directory = join(payload.evidence_root, item.case_id)
        await mkdir(directory, { recursive: true })
        try { await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }) } catch {}
        if (reason !== 'unauthorized-side-effect' && error?.evidenceSaved !== true) {
          await saveEvidence(payload.evidence_root, item,
            { user_input: item.input, assistant_text: null, session_id: session?.session_id ?? null }, error?.archive ?? null,
            {
              schema_version: '1.0',
              case_id: item.case_id,
              transport: 'browser',
              ui_startup: uiStartup,
              completed: false,
              failure_reason: reason,
              failure_detail: `${stage}:${diagnostic(error)}`,
            })
        }
        rows.push(result(item, 'error', 'inconclusive',
          reason === 'browser-case-error' ? '浏览器用例未完成，未产生语义结论。' : '评测身份、工具或证据边界失配，已安全停止。',
          reason))
        if (SAFETY_STOP_REASONS.has(reason)) {
          stopReason = reason
          break
        }
        existingIds = new Set((await listSessions(page)).map(session => session.sessionId))
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
