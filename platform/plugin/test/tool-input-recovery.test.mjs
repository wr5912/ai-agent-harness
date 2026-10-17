import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { assistantProjection } from '../src/assistant/index.ts'
import { createToolInputRecovery, TOOL_INPUT_JSON_RETRY_POLICY } from '../src/assistant/tool-input-recovery.ts'

// 与部署验收使用同一标准 Runtime；所有模型响应来自本测试的本地基础数据服务。
const sdkRequire = createRequire(process.env.HARNESS_DSH_ENTRY ?? '/opt/dsh/npm/lib/node_modules/@deepseek-ai/dsh/package.json')
const sdk = name => import(pathToFileURL(sdkRequire.resolve(name)).href)
const [
  { Context }, { SessionStore, appendPluginRecord }, { SessionProjectionRegistry },
  { SystemPrompt }, { ToolRuntime }, { default: AgentRegistry }, { default: AgentLoop },
  { default: LlmRuntime, createUserMessage, expandAssistantStream }, { DeepSeekAdapter, resolveAdapterOptions },
] = await Promise.all([
  sdk('@deepseek-ai/cordis'), sdk('@deepseek-ai/dsh-session'), sdk('@deepseek-ai/dsh-session-projection'),
  sdk('@deepseek-ai/dsh-system-prompt'), sdk('@deepseek-ai/dsh-tools'), sdk('@deepseek-ai/dsh-agent'), sdk('@deepseek-ai/dsh-agent-loop'),
  sdk('@deepseek-ai/dsh-llm'), sdk('@deepseek-ai/dsh-llm-deepseek'),
])

const failure = { code: 'MALFORMED_RESPONSE', message: 'DeepSeek Messages stream: tool input is invalid JSON' }
// 复现故障摘要中的两类括号错误，只保留空对象，不带业务样本。
const malformedArguments = {
  extraClosingBrace: '{"samples":[{"questions":{"q":{}}},"targets":{"q":{}}}]}',
  missingClosingBrace: '{"samples":[{"questions":{"q":{}},"targets":{"q":{}}]}',
}
const taskContext = { skill: 'decision-sample-extraction', run_id: 'run-basic-fixture' }
const rows = (session, type) => session.snapshotEvents().filter(event => event.type === type)
const chunks = event => expandAssistantStream(event.data.stream).map(row => row.chunk)

function messageEvents({ action, invalid, text, stop = 'tool_use' }) {
  const content = text === undefined ? { type: 'tool_use', id: `call-${action}`, name: 'platform_agents', input: {} } : { type: 'text', text: '' }
  const arguments_ = invalid ?? JSON.stringify({ action, input: { basic: true } })
  return [
    { type: 'message_start', message: { id: 'message-basic', model: 'basic-model', usage: { input_tokens: 3, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: content },
    ...(text === undefined ? [
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: arguments_.slice(0, 18) } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: arguments_.slice(18) } },
    ] : [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }]),
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: text === undefined ? stop : 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ]
}

async function fixture(t, script, { context = taskContext, cancelOnRetry = false, unloadOnRetry = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'extraction-recovery-'))
  const requests = [], calls = [], failures = []
  let serverFailure, agent
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/messages')
      const body = []
      for await (const part of request) body.push(part)
      requests.push(JSON.parse(Buffer.concat(body).toString('utf8')))
      const events = script[requests.length - 1]
      assert.ok(events, '不能超出固定响应脚本继续请求')
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
    } catch (error) { serverFailure = error; response.writeHead(500).end('基础测试响应失败') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
    if (serverFailure) throw serverFailure
  })
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(plugin)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.sessionProjections.register(assistantProjection)
  const options = resolveAdapterOptions({ baseURL: `http://127.0.0.1:${server.address().port}`, thinking: 'disabled', maxTokens: 4096 })
  ctx.llm.registerAdapter(['basic-provider'], new DeepSeekAdapter({
    options: () => options, resolveAuth: async () => ({ headers: {} }),
    resolveUserId: () => '00000000-0000-4000-8000-000000000001',
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  }))
  ctx.tools.register({
    name: 'platform_agents', description: '记录基础模拟查询和预览次数',
    parameters: { type: 'object', properties: { action: { type: 'string' }, input: { type: 'object', additionalProperties: true } }, required: ['action', 'input'] },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) { calls.push(args); return { basic: true } },
  })
  const lifetime = new AbortController()
  const disposeRecoveryLifetime = ctx.effect(() => () => lifetime.abort(new Error('测试插件已卸载')))
  const recovery = createToolInputRecovery(root, ctx.sessionProjections, lifetime.signal)
  ctx.on('agent/request-error', (event, next) => {
    failures.push({ turn: event.turn, step: event.step, failure: event.failure, calls: structuredClone(calls) })
    return recovery(event, next)
  })
  if (cancelOnRetry || unloadOnRetry) ctx.on('session/event', (session, event) => {
    if (event.type === 'llm/retry' && session.id === agent?.id) queueMicrotask(() => {
      if (unloadOnRetry) void disposeRecoveryLifetime()
      else agent.cancel({ kind: 'user' })
    })
  })
  agent = await ctx.agentLoop.create('session-extraction-recovery', { provider: 'basic-provider', model: 'basic-model' }, { cwd: root })
  appendPluginRecord(agent.session, 'plugin:harness-platform/assistant', { kind: 'task', task: '提取基础模拟样本', context })
  return { root, ctx, agent, calls, failures, requests,
    async run() {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: '仅使用本地基础模拟数据验证抽取流程。' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      if (serverFailure) throw serverFailure
    },
  }
}

test('真实Messages解析失败在同一步重试，保留错误参数，既有查询和成功预览各执行一次', { timeout: 15_000 }, async t => {
  const f = await fixture(t, [
    messageEvents({ action: 'datasets/source' }), messageEvents({ action: 'datasets/preview', invalid: malformedArguments.extraClosingBrace }),
    messageEvents({ action: 'datasets/preview' }), messageEvents({ text: '基础预览已返回。' }),
  ])
  await f.run()
  assert.equal(f.requests.length, 4)
  assert.deepEqual(f.calls.map(call => call.action), ['datasets/source', 'datasets/preview'])
  assert.equal(f.failures.length, 1)
  assert.deepEqual(f.failures[0].failure, failure)
  assert.deepEqual(f.failures[0].calls.map(call => call.action), ['datasets/source'], '失败响应中的预览工具尚未执行')
  const attempt = rows(f.agent.session, 'assistant/attempt')[0]
  assert.equal(chunks(attempt).find(chunk => chunk.type === 'block-end').block.arguments, malformedArguments.extraClosingBrace)
  assert.deepEqual(chunks(attempt).at(-1).reason, { kind: 'error', failure })
  const retry = rows(f.agent.session, 'llm/retry')[0]
  const succeeded = rows(f.agent.session, 'assistant/message').find(event => event.data.step === attempt.data.step)
  assert.ok(succeeded)
  assert.equal(retry.data.turn, attempt.data.turn)
  assert.equal(retry.data.step, attempt.data.step)
  assert.equal(retry.data.policyKey, TOOL_INPUT_JSON_RETRY_POLICY)
  assert.equal(rows(f.agent.session, 'llm/retry-started').length, 1)
  assert.equal(rows(f.agent.session, 'turn/end').at(-1).data.reason.kind, 'completed')
  assert.equal(f.ctx.sessionProjections.stateOf(f.agent.session, 'harnessPlatformAssistant').extraction_json_retry, undefined)
  assert.deepEqual(f.requests[2].messages, f.requests[1].messages, '重试沿用成功历史，不把错误工具响应作为已执行消息')
})

test('连续解析失败最多追加两次请求，三个原始失败均保留，冷恢复仍保留已用额度', { timeout: 15_000 }, async t => {
  const originalArguments = [malformedArguments.extraClosingBrace, malformedArguments.missingClosingBrace, malformedArguments.extraClosingBrace]
  const f = await fixture(t, originalArguments.map(invalid => messageEvents({ action: 'datasets/preview', invalid })))
  await f.run()
  assert.equal(f.requests.length, 3)
  assert.equal(f.calls.length, 0)
  const attempts = rows(f.agent.session, 'assistant/attempt')
  assert.equal(attempts.length, 3)
  assert.deepEqual(attempts.map(event => chunks(event).find(chunk => chunk.type === 'block-end').block.arguments), originalArguments)
  assert.ok(attempts.every(event => chunks(event).at(-1).reason.failure.code === 'MALFORMED_RESPONSE'))
  const retries = rows(f.agent.session, 'llm/retry')
  assert.deepEqual(retries.map(event => event.data.retry), [1, 2])
  assert.equal(retries[0].data.retryId, retries[1].data.retryId)
  assert.ok(retries.every(event => event.data.maxRetries === 2))
  assert.deepEqual(rows(f.agent.session, 'turn/end').at(-1).data.reason.error, failure)

  // 将进行中的第二次重试恢复到新的 SDK Store/Projection，避免只验证进程内变量。
  const prefix = structuredClone(f.agent.session.snapshotEvents().slice(0, retries[1].seq + 1))
  const cold = new Context()
  t.after(() => cold.fiber.dispose())
  new SessionStore(cold)
  new SessionProjectionRegistry(cold)
  cold.sessionProjections.register(assistantProjection)
  const session = cold.sessions.create(f.agent.id, { seed: prefix, eventState: 'detached', inheritedEventCount: 0, meta: structuredClone(f.agent.session.header) })
  const restored = cold.sessionProjections.stateOf(session, 'harnessPlatformAssistant')
  assert.equal(restored.extraction_json_retry.retry, 2)
  assert.equal(restored.extraction_json_retry.retryId, retries[1].data.retryId)
  const size = session.snapshotEvents().length
  const outcome = await createToolInputRecovery(f.root, cold.sessionProjections)({ agent: { session }, turn: retries[1].data.turn, step: retries[1].data.step, provider: 'basic-provider', failure, signal: new AbortController().signal }, async () => undefined)
  assert.equal(outcome, undefined)
  assert.equal(session.snapshotEvents().length, size)
})

test('取消发生于原生重试等待期间时不发替代请求、不执行工具', { timeout: 10_000 }, async t => {
  const f = await fixture(t, [messageEvents({ action: 'datasets/preview', invalid: malformedArguments.extraClosingBrace })], { cancelOnRetry: true })
  await f.run()
  assert.equal(f.requests.length, 1)
  assert.equal(f.calls.length, 0)
  assert.equal(rows(f.agent.session, 'assistant/attempt').length, 1)
  assert.equal(rows(f.agent.session, 'llm/retry').length, 1)
  assert.equal(rows(f.agent.session, 'llm/retry-started').length, 0)
  assert.equal(rows(f.agent.session, 'turn/end').at(-1).data.reason.kind, 'aborted')
})

test('max_tokens结束的残缺参数保持原生截断语义，不误认为可重试解析失败', { timeout: 10_000 }, async t => {
  const f = await fixture(t, [messageEvents({ action: 'datasets/preview', invalid: malformedArguments.missingClosingBrace, stop: 'max_tokens' })])
  await f.run()
  assert.equal(f.requests.length, 1)
  assert.equal(f.calls.length, 0)
  assert.equal(f.failures.length, 0)
  assert.equal(rows(f.agent.session, 'llm/retry').length, 0)
  assert.equal(rows(f.agent.session, 'turn/end').at(-1).data.reason.kind, 'max-tokens')
})

test('恢复插件卸载中断退避，原错误保留且不发请求或执行工具', { timeout: 10_000 }, async t => {
  const f = await fixture(t, [messageEvents({ action: 'datasets/preview', invalid: malformedArguments.extraClosingBrace })], { unloadOnRetry: true })
  await f.run()
  assert.equal(f.requests.length, 1)
  assert.equal(f.calls.length, 0)
  assert.equal(rows(f.agent.session, 'assistant/attempt').length, 1)
  assert.equal(rows(f.agent.session, 'llm/retry').length, 1)
  assert.equal(rows(f.agent.session, 'llm/retry-started').length, 0)
  assert.deepEqual(rows(f.agent.session, 'turn/end').at(-1).data.reason.error, failure)
})

function directFixture(t, { context = taskContext, active = true, cwd } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'extraction-recovery-scope-')), ctx = new Context()
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  ctx.sessionProjections.register(assistantProjection)
  const session = ctx.sessions.create('session-direct', { meta: { cwd: cwd ?? root } })
  if (active) appendPluginRecord(session, 'plugin:harness-platform/assistant', { kind: 'task', context })
  t.after(async () => { await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }) })
  return { session, recover: createToolInputRecovery(root, ctx.sessionProjections),
    event: { agent: { session }, turn: 1, step: 1, provider: 'basic-provider', failure, signal: new AbortController().signal } }
}

test('未激活及其他工作区不进入管理恢复，其他错误类别保持原样', async t => {
  for (const options of [{ active: false }, { cwd: '/unrelated-basic-workspace' }]) {
    const f = directFixture(t, options)
    assert.equal(await f.recover(f.event, async () => undefined), undefined)
    assert.equal(rows(f.session, 'llm/retry').length, 0)
  }
  const f = directFixture(t)
  for (const detail of [
    { code: 'TRANSPORT', message: failure.message },
    { code: 'MALFORMED_RESPONSE', message: 'DeepSeek Messages SSE contains invalid JSON' },
    { code: 'ABORTED', message: 'request aborted' },
  ]) assert.equal(await f.recover({ ...f.event, failure: detail }, async () => undefined), undefined)
  assert.equal(rows(f.session, 'llm/retry').length, 0)
})

test('下游原生恢复优先，异常与已取消信号不被吞掉或重复计数', async t => {
  const f = directFixture(t), retry = { kind: 'retry' }, marker = new Error('其他恢复器失败')
  assert.equal(await f.recover(f.event, async () => retry), retry)
  await assert.rejects(() => f.recover(f.event, async () => { throw marker }), error => error === marker)
  const controller = new AbortController()
  controller.abort()
  assert.equal(await f.recover({ ...f.event, signal: controller.signal }, async () => undefined), undefined)
  assert.equal(await f.recover({ ...f.event, signal: controller.signal }, async () => retry), undefined, '取消优先于下游重试决定')
  assert.equal(rows(f.session, 'llm/retry').length, 0)
})


test('特性、运维、编排、评测与构建管理流程共用有限JSON重试，不重放已完成操作', { timeout: 15_000 }, async t => {
  const f = await fixture(t, [
    messageEvents({ action: 'features/preview' }),
    messageEvents({ action: 'detail', invalid: malformedArguments.missingClosingBrace }),
    messageEvents({ action: 'detail' }), messageEvents({ text: '基础操作已回读。' }),
  ], { context: { skill: 'workspace-management' } })
  await f.run()
  assert.equal(f.requests.length, 4)
  assert.deepEqual(f.calls.map(call => call.action), ['features/preview', 'detail'])
  assert.equal(rows(f.agent.session, 'llm/retry').length, 1)
  assert.equal(rows(f.agent.session, 'turn/end').at(-1).data.reason.kind, 'completed')
  for (const skill of ['agent-maintenance', 'mcp-composition', 'research-eval', 'task-builder', 'compute-variant-research']) {
    const scoped = directFixture(t, { context: { skill } })
    assert.deepEqual(await scoped.recover(scoped.event, async () => undefined), { kind: 'retry' })
    assert.equal(rows(scoped.session, 'llm/retry').length, 1)
  }
})

test('同一流先返回合法工具再遇到非法JSON时整条失败消息不执行，重试仅执行完整合法请求', { timeout: 15_000 }, async t => {
  const valid = messageEvents({ action: 'detail' })
  const malformed = messageEvents({ action: 'cases/list', invalid: malformedArguments.extraClosingBrace })
  const mixed = [valid[0], ...valid.slice(1, -2), ...malformed.slice(1, -2).map(row => ({ ...row, index: 1 })), ...valid.slice(-2)]
  const f = await fixture(t, [messageEvents({ action: 'features/preview' }), mixed, valid, messageEvents({ text: '已核对一次。' })], { context: { skill: 'workspace-management' } })
  await f.run()
  assert.equal(f.requests.length, 4)
  assert.deepEqual(f.calls.map(call => call.action), ['features/preview', 'detail'])
  assert.deepEqual(f.failures[0].calls.map(call => call.action), ['features/preview'])
  assert.equal(rows(f.agent.session, 'llm/retry').length, 1)
  assert.equal(rows(f.agent.session, 'turn/end').at(-1).data.reason.kind, 'completed')
})
