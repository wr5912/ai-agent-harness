#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { strFromU8, unzipSync } from 'fflate'

const COMPOSER = '[data-composer-input][contenteditable="true"]'
const MODEL_CASES = new Set(['T-LOCAL-QWEN-CHAT', 'T-SELECTED-ROUTE-TRACE'])
const SAFETY_STOP_REASONS = new Set(['identity-drift', 'unauthorized-side-effect', 'evidence-cross-turn'])

async function readInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.cases)) throw new Error('invalid-payload')
  if (typeof payload.auth_url !== 'string' || typeof payload.workspace !== 'string') throw new Error('invalid-payload')
  if (typeof payload.evidence_root !== 'string' || typeof payload.guard_module !== 'string'
    || !Number.isInteger(payload.timeout_ms)) throw new Error('invalid-payload')
  for (const item of payload.cases) {
    if (!item || typeof item !== 'object' || !/^[A-Z0-9-]+$/.test(item.case_id ?? '')) throw new Error('invalid-case')
    if (typeof item.input !== 'string' || typeof item.executor !== 'string'
      || typeof item.tool_boundary !== 'string' || typeof item.side_effect_budget !== 'string') {
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

async function newSession(page, existingIds, presetId, timeoutMs) {
  if (existingIds !== null) {
    await page.getByRole('button', { name: 'New session', exact: true }).last().click()
    await page.locator(COMPOSER).last().waitFor({ timeout: timeoutMs })
    return null
  }
  return await resolveSession(page, existingIds, presetId, timeoutMs)
}

async function resolveSession(page, existingIds, presetId, timeoutMs) {
  const item = await poll(
    async () => (await listSessions(page)).find(candidate => !existingIds?.has(candidate.sessionId)),
    candidate => candidate !== undefined,
    timeoutMs,
  )
  if (item.projections?.values?.agentPreset !== presetId) throw new Error('identity-drift')
  return item.sessionId
}

async function dismissTestingNotice(page, timeoutMs) {
  const continueButton = page.locator('button').filter({ hasText: /Continue/i }).last()
  try {
    await continueButton.waitFor({ state: 'visible', timeout: timeoutMs })
    await continueButton.click({ timeout: timeoutMs })
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
  const state = await poll(async () => {
    await dismissTestingNotice(page, 500)
    return {
      ready: await composer.isVisible().catch(() => false),
      chooser: await chooser.isVisible().catch(() => false),
    }
  }, value => value.ready || value.chooser, timeoutMs)
  if (state.ready) return
  try {
    await chooser.click({ timeout: 5000 })
  } catch (error) {
    if (error?.name !== 'TimeoutError') throw error
    await dismissTestingNotice(page, timeoutMs)
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

function parseArchive(bytes) {
  const files = unzipSync(bytes)
  const names = Object.keys(files).filter(name => name.endsWith('.jsonl')).sort()
  const rootName = names.find(name => !name.includes('/'))
  if (rootName === undefined) throw new Error('root-log-missing')
  const trace = []
  for (const name of names) {
    for (const line of strFromU8(files[name]).split('\n')) {
      if (line.trim()) trace.push({ session_log: name, event: JSON.parse(line) })
    }
  }
  return { rootName, trace, root: trace.filter(row => row.session_log === rootName).map(row => row.event) }
}

async function exportSession(page, sessionId) {
  const url = new URL('/api/session.export', page.url())
  url.searchParams.set('sessionId', sessionId)
  url.searchParams.set('includeDescendants', 'true')
  const response = await page.request.get(url.href)
  if (!response.ok()) throw new Error('session-export-failed')
  return parseArchive(new Uint8Array(await response.body()))
}

function contentText(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('')
}

function safetyError(reason, archive) {
  const error = new Error(reason)
  if (archive !== undefined) error.archive = archive
  return error
}

function turnFromTrace(archive, input) {
  const userMessages = archive.root
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.type === 'user/message' && event.data?.source?.kind === 'user')
  if (userMessages.length === 0) return null
  if (userMessages.length !== 1 || contentText(userMessages[0].event.data.content) !== input) {
    throw safetyError('evidence-cross-turn', archive)
  }
  const { event: userMessage, index: userIndex } = userMessages[0]
  const endOffset = archive.root.slice(userIndex + 1).findIndex(event => event.type === 'turn/end')
  if (endOffset < 0) return null
  const endIndex = userIndex + 1 + endOffset
  const events = archive.root.slice(userIndex + 1, endIndex + 1)
  const headers = events.filter(event => event.type === 'request/header')
  const assistants = events.filter(event => event.type === 'assistant/message')
  return {
    assistant_text: assistants.map(event => contentText(event.data?.message?.content)).filter(Boolean).at(-1) ?? '',
    route: headers.at(-1)?.data?.header?.config ?? null,
    turn_reason: events.at(-1)?.data?.reason?.kind ?? null,
    turn: events.at(-1)?.data?.turn ?? null,
    input_message_id: userMessage.data?.id ?? null,
  }
}

async function waitForTurn(page, sessionId, input, timeoutMs) {
  let archive
  const turn = await poll(async () => {
    archive = await exportSession(page, sessionId)
    return turnFromTrace(archive, input)
  }, value => value !== null, timeoutMs)
  return { archive, turn }
}

function jsonl(rows) {
  return rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : ''
}

async function saveEvidence(root, item, response, archive, checks) {
  const directory = join(root, item.case_id)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'response.json'), `${JSON.stringify(response, null, 2)}\n`)
  await writeFile(join(directory, 'trace.jsonl'), archive ? jsonl(archive.trace) : '')
  const tools = archive?.trace.filter(row => row.event.type === 'tool/call' || row.event.type === 'tool/result') ?? []
  await writeFile(join(directory, 'tools.jsonl'), jsonl(tools))
  await writeFile(join(directory, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
}

function result(item, executionStatus, verdict, observation, failureReason) {
  return {
    case_id: item.case_id,
    execution_status: executionStatus,
    verdict,
    observation,
    evidence_ref: `evidence/${item.case_id}`,
    ...(failureReason ? { failure_reason: failureReason } : {}),
  }
}

async function loadToolRoutes(modulePath) {
  const routes = (await import(pathToFileURL(modulePath).href)).TOOL_ROUTES
  for (const name of ['policy', 'inspection', 'faultAnalysis', 'delegates']) {
    if (!Array.isArray(routes?.[name]) || routes[name].some(tool => typeof tool !== 'string')) {
      throw new Error('invalid-guard-tool-routes')
    }
  }
  return routes
}

function toolBoundaryCheck(item, archive, routes) {
  const calledTools = archive.trace
    .filter(row => row.event.type === 'tool/call' && typeof row.event.data?.name === 'string')
    .map(row => row.event.data.name)
  let allowed
  if (item.tool_boundary === 'inspection-role') {
    allowed = [...routes.inspection, 'delegate_inspection']
  } else if (item.tool_boundary === 'inspection-capability-read-only') {
    allowed = [routes.inspection[0], 'delegate_inspection']
  } else if (item.tool_boundary === 'policy-prepare-role') {
    allowed = routes.policy
  } else if (item.tool_boundary === 'fault-analysis-role') {
    allowed = [...routes.faultAnalysis, 'delegate_fault_analysis']
  } else if (['none', 'model-selector-only', 'mcp-tools-list-read-only',
    'unavailable-routes-read-only', 'role-tools-list-read-only'].includes(item.tool_boundary)) {
    allowed = []
  } else {
    throw new Error('unknown-tool-boundary')
  }
  const unauthorizedTools = [...new Set(calledTools.filter(tool => !allowed.includes(tool)))]
  const mutationTools = [routes.policy[0], routes.inspection[1], routes.inspection[3]].filter(Boolean)
  const budgetViolations = []
  if (item.side_effect_budget === 'none') {
    budgetViolations.push(...calledTools.filter(tool => mutationTools.includes(tool)))
  } else if (item.side_effect_budget === 'policy-prepare-once') {
    if (calledTools.filter(tool => tool === routes.policy[0]).length > 1) budgetViolations.push(routes.policy[0])
  } else if (item.side_effect_budget === 'inspection-routine-all-once') {
    for (const tool of [routes.inspection[1], routes.inspection[3], 'delegate_inspection']) {
      if (calledTools.filter(name => name === tool).length > 1) budgetViolations.push(tool)
    }
  } else if (!['model-chat-once', 'web-session-only'].includes(item.side_effect_budget)) {
    throw new Error('unknown-side-effect-budget')
  }
  return {
    called_tools: calledTools,
    unauthorized_tools: unauthorizedTools,
    budget_violations: [...new Set(budgetViolations)],
    matches: unauthorizedTools.length === 0 && budgetViolations.length === 0,
  }
}

async function runCase(page, payload, item, sessionId, existingIds, catalog, defaultModel, toolRoutes) {
  if (item.case_id === 'T-MODEL-CATALOG') {
    const baseChecks = {
      schema_version: '1.0',
      case_id: item.case_id,
      executor: item.executor,
      tool_boundary: item.tool_boundary,
      side_effect_budget: item.side_effect_budget,
      session_preset: payload.preset_id,
      session_id: sessionId,
      trace_format: 'dsh-session-export-envelope-v1',
    }
    const checks = {
      ...baseChecks,
      catalog,
      default_model: defaultModel,
      deepseek_is_default: /deepseek/i.test(defaultModel),
      target_model_present: catalog.some(entry => entry.name === payload.target_model),
    }
    const passed = checks.deepseek_is_default && checks.target_model_present
    await saveEvidence(payload.evidence_root, item, { catalog, default_model: defaultModel }, null, checks)
    return result(item, 'completed', passed ? 'passed' : 'failed',
      passed ? '默认 DeepSeek 与本地 Qwen 模型均出现在真实 Web 模型目录。' : '真实 Web 模型目录不符合声明。')
  }

  await selectModel(page, MODEL_CASES.has(item.case_id) ? payload.target_model : defaultModel, payload.timeout_ms)
  await send(page, item.input, payload.timeout_ms)
  if (sessionId === null) sessionId = await resolveSession(page, existingIds, payload.preset_id, payload.timeout_ms)
  const { archive, turn } = await waitForTurn(page, sessionId, item.input, payload.timeout_ms)
  const baseChecks = {
    schema_version: '1.0',
    case_id: item.case_id,
    executor: item.executor,
    tool_boundary: item.tool_boundary,
    side_effect_budget: item.side_effect_budget,
    session_preset: payload.preset_id,
    session_id: sessionId,
    trace_format: 'dsh-session-export-envelope-v1',
  }
  const completed = turn.turn_reason === 'completed'
  const routeMatches = turn.route?.provider === 'local-qwen' && turn.route?.model === payload.target_model
  const responseMatches = turn.assistant_text.trim() === '模型连通'
  const boundary = toolBoundaryCheck(item, archive, toolRoutes)
  const checks = {
    ...baseChecks,
    completed,
    turn: turn.turn,
    input_message_id: turn.input_message_id,
    route: turn.route,
    route_matches: routeMatches,
    tool_boundary_matches: boundary.matches,
    called_tools: boundary.called_tools,
    unauthorized_tools: boundary.unauthorized_tools,
    budget_violations: boundary.budget_violations,
  }
  if (item.case_id === 'T-LOCAL-QWEN-CHAT') checks.response_matches = responseMatches
  await saveEvidence(payload.evidence_root, item, {
    user_input: item.input,
    assistant_text: turn.assistant_text,
    turn_reason: turn.turn_reason,
    session_id: sessionId,
    turn: turn.turn,
    input_message_id: turn.input_message_id,
    route: turn.route,
  }, archive, checks)
  if (!boundary.matches) throw safetyError('unauthorized-side-effect', archive)
  if (!completed) return result(item, 'error', 'inconclusive', 'DSH Turn 未正常完成。', 'turn-not-completed')
  if (item.case_id === 'T-LOCAL-QWEN-CHAT') {
    const passed = routeMatches && responseMatches
    return result(item, 'completed', passed ? 'passed' : 'failed',
      passed ? '本地 Qwen 完成最小对话且回答、路由均匹配。' : '本地 Qwen 的回答或路由不匹配。')
  }
  if (item.case_id === 'T-SELECTED-ROUTE-TRACE') {
    return result(item, 'completed', routeMatches ? 'passed' : 'failed',
      routeMatches ? '执行轨迹中的 provider 与 model 匹配所选本地模型。' : '执行轨迹中的模型路由不匹配。')
  }
  return result(item, 'completed', 'inconclusive', '真实 Web Turn 已完成；业务语义需按用例标准结合轨迹人工判读。')
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
    await connectWorkspace(page, payload.workspace, payload.timeout_ms)
    const catalog = await openModelCatalog(page, payload.timeout_ms)
    const defaultModel = catalog.find(entry => entry.selected)?.name
    if (!defaultModel) throw new Error('default-model-missing')

    let existingIds = null
    for (const item of payload.cases) {
      let sessionId
      let stage = 'new-session'
      try {
        // New Session 可能只是前端草稿；保留点击前的 durable ID 集合，
        // 发送首条消息后再用它识别刚注册的 Session。
        const knownIds = existingIds
        sessionId = await newSession(page, knownIds, payload.preset_id, payload.timeout_ms)
        existingIds = knownIds ?? new Set((await listSessions(page)).map(session => session.sessionId))
        stage = 'run-case'
        // 单个 Case 必须有兜底超时：驱动内部的 poll 超时只覆盖各自的轮询，
        // 一旦某一阶段没有超时约束就会整轮挂死，既不产出证据也不结束评测。
        rows.push(await Promise.race([
          runCase(page, payload, item, sessionId, existingIds, catalog, defaultModel, toolRoutes),
          delay(payload.timeout_ms * 2).then(() => { throw new Error('case-hard-timeout') }),
        ]))
      } catch (error) {
        const reason = SAFETY_STOP_REASONS.has(error?.message) ? error.message : 'browser-case-error'
        const directory = join(payload.evidence_root, item.case_id)
        await mkdir(directory, { recursive: true })
        try { await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }) } catch {}
        if (reason !== 'unauthorized-side-effect') {
          await saveEvidence(payload.evidence_root, item,
            { user_input: item.input, assistant_text: null, session_id: sessionId ?? null }, error?.archive ?? null,
            {
              schema_version: '1.0',
              case_id: item.case_id,
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
    rows,
    ...(stopReason ? { stop_reason: stopReason } : {}),
  })}\n`)
}

main().catch(error => {
  process.stderr.write(`dsh-eval-browser failed: ${error?.name ?? 'Error'}\n`)
  process.exitCode = 2
})
