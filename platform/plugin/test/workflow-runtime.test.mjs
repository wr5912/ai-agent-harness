import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { measureModelUsage } from '../src/evaluation/model-usage.ts'

const directory = mkdtempSync(join(tmpdir(), 'workflow-runtime-test-'))
const file = join(directory, 'runtime.mjs')
await build({ entryPoints: [new URL('../src/workflows/runtime.ts', import.meta.url).pathname], outfile: file, bundle: true,
  platform: 'node', format: 'esm', banner: { js: `import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);` } })
const { defineWorkflow, registerWorkflowTool, runWorkflow } = await import(`file://${file}`)
const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-api-session-controller'))
const sdk = name => import(pathToFileURL(sdkRequire.resolve(name)).href)
const [{ Context }, { ToolRuntime }, { SystemPrompt }, { createScope }] = await Promise.all([
  sdk('@deepseek-ai/cordis'), sdk('@deepseek-ai/dsh-tools'), sdk('@deepseek-ai/dsh-system-prompt'), sdk('@deepseek-ai/dsh-scope'),
])
test.after(() => rmSync(directory, { recursive: true, force: true }))

function fixture(dispatch, llm) {
  let tool
  const ctx = { tools: { register(value) { tool = value }, execute: dispatch }, llm }
  const identity = { callId: 'outer', rootCallId: 'outer-root', token: Symbol('native'), agent: { session: { id: 'session-real' } }, signal: new AbortController().signal }
  return { ctx, identity, tool: () => tool }
}
test('真实 LangGraph 执行两步原生子工具，传递参数和身份并保留ESM来源', async () => {
  const calls = [], f = fixture(async input => {
    calls.push(input)
    return { isError: false, value: input.name === 'get_asset' ? { id: 'asset-17' } : { alerts: [{ id: 'alert-9' }] }, content: [] }
  })
  registerWorkflowTool(f.ctx, defineWorkflow({ id: 'asset-alerts', toolName: 'query_asset_alerts', description: '查询', inputSchema: { type: 'object' },
    async run(context) { return runWorkflow(context, [
      { id: 'asset', run: (_values, current) => current.callTool('get_asset', { asset: current.input.asset }) },
      { id: 'alerts', run: (values, current) => current.callTool('list_alerts', { assetId: values.asset.id }) },
    ]) } }))
  const result = await f.tool().execute({ asset: '主机' }, f.identity)
  assert.equal(result.ok, true)
  assert.equal(result.result.alerts.alerts[0].id, 'alert-9')
  assert.deepEqual(calls.map(input => input.arguments), [{ asset: '主机' }, { assetId: 'asset-17' }])
  for (const input of calls) { assert.equal(input.parent, f.identity.token); assert.equal(input.rootCallId, 'outer-root'); assert.equal(input.agent, f.identity.agent); assert.equal(input.signal, f.identity.signal) }
  assert.equal(result.graph_execution.complete, true)
  assert.deepEqual(result.graph_execution.model_attempts, [])
  assert.equal(result.graph_execution.esm_sha256, createHash('sha256').update(readFileSync(file)).digest('hex'))
  assert.equal(f.tool().output.presentationMeta({}, result).graph_execution.execution_id, result.graph_execution.execution_id)
})
test('上游失败或取消停止后继节点，失败回执仍保留图证据', async () => {
  let calls = 0
  const f = fixture(async () => { calls++; return { isError: true, error: { code: 'BUSINESS_FAILED' }, content: [] } })
  registerWorkflowTool(f.ctx, defineWorkflow({ id: 'fail', toolName: 'fail', description: '失败', inputSchema: { type: 'object' },
    run: context => runWorkflow(context, [{ id: 'first', run: (_v, c) => c.callTool('first', {}) }, { id: 'second', run: (_v, c) => c.callTool('second', {}) }]) }))
  const value = await f.tool().execute({}, f.identity)
  assert.equal(value.ok, false); assert.equal(calls, 1)
  assert.equal(value.graph_execution.status, 'failed')
  assert.equal(value.graph_execution.trace[0].result.error.code, 'BUSINESS_FAILED')
  const aborted = new AbortController(); aborted.abort()
  assert.equal((await f.tool().execute({}, { ...f.identity, signal: aborted.signal })).graph_execution.status, 'cancelled')
  assert.equal(calls, 1)
})
test('图内模型请求保留同一次attempt及真实usage，不能隐藏在工具内', async () => {
  let preparations = 0
  const f = fixture(async () => assert.fail('没有工具调用'), { async prepareCall(config) {
    preparations++; return { config, async *stream() { yield { type: 'text-delta', text: '实际模型结果' }; yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11 } }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  } })
  registerWorkflowTool(f.ctx, defineWorkflow({ id: 'infer', toolName: 'infer', description: '推理', inputSchema: { type: 'object' },
    run: context => context.infer({ provider: 'provider-real', model: 'model-real' }, { messages: [{ role: 'user', content: [] }] }) }))
  const value = await f.tool().execute({}, f.identity)
  assert.equal(preparations, 1); assert.equal(value.ok, true)
  const attempts = value.graph_execution.model_attempts
  assert.deepEqual(attempts.map(item => item.status), ['preparing', 'started', 'completed'])
  assert.equal(new Set(attempts.map(item => item.attempt_id)).size, 1)
  assert.equal(attempts.at(-1).usage.totalTokens, 11)
  assert.equal(attempts.at(-1).session_id, 'session-real')
})

function nativeFixture(t, llm) {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx, { mode: 'native' })
  const agent = { id: 'workflow-agent', session: { id: 'workflow-session' } }
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  t.after(async () => { await scope.dispose(); await ctx.fiber.dispose() })
  let call = 0
  return { ctx, registration: { tools: ctx.tools, llm }, agent,
    execute: name => ctx.tools.execute({ name, arguments: {}, callId: `native-workflow-${++call}`, agent, signal: new AbortController().signal }),
    register(name, execute) { ctx.tools.register({ name, description: '真实原生边界测试', parameters: { type: 'object' },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute }) },
  }
}

test('真实ToolRuntime拒绝业务undefined；工作流返回明确失败并保留两次原生子调用图回执', async t => {
  const f = nativeFixture(t), calls = []
  const invalidResult = { steps: [{ operation: 'get_asset', detail: undefined }] }
  f.register('invalid_direct', () => invalidResult)
  const rejected = await f.execute('invalid_direct')
  assert.equal(rejected.isError, true)
  assert.equal(rejected.error.info?.code, 'INVALID_TOOL_OUTPUT', JSON.stringify(rejected))
  assert.match(rejected.error.message, /value is not lossless JSON/)
  for (const name of ['get_asset', 'list_alerts']) f.register(name, (_args, exec) => {
    calls.push({ name, parent: exec.parent, root: exec.rootCallId }); return { status: 200, json: { code: 200 } }
  })
  registerWorkflowTool(f.registration, defineWorkflow({ id: 'invalid-result', toolName: 'invalid_workflow', description: '校验业务输出', inputSchema: { type: 'object' },
    async run(context) {
      await context.callTool('get_asset', {})
      await context.callTool('list_alerts', {})
      return invalidResult
    } }))
  const result = await f.execute('invalid_workflow')
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.ok, false)
  assert.equal(result.value.error_code, 'WORKFLOW_INVALID_RESULT')
  assert.equal(Object.hasOwn(result.value, 'result'), false, '不能静默删除undefined后把原业务值作为成功结果')
  assert.equal(result.value.graph_execution.status, 'failed')
  assert.equal(result.value.graph_execution.complete, true)
  assert.equal(result.value.graph_execution.session_id, 'workflow-session')
  assert.equal(result.value.graph_execution.tool_call_id, 'native-workflow-2')
  assert.deepEqual(result.value.graph_execution.trace.map(row => row.node), ['get_asset', 'list_alerts'])
  assert.deepEqual(result.value.graph_execution.model_attempts, [])
  assert.equal(result.meta.graph_execution.execution_id, result.value.graph_execution.execution_id)
  assert.equal(calls.length, 2)
  for (const call of calls) { assert.ok(call.parent); assert.equal(call.root, 'native-workflow-2') }
})

test('真实ToolRuntime保留合法结果与原生失败，非JSON业务值不能经字符串化伪装成功', async t => {
  const f = nativeFixture(t)
  f.register('native_failed', () => { throw new Error('受控子工具失败') })
  registerWorkflowTool(f.registration, defineWorkflow({ id: 'child-failed', toolName: 'child_failed_workflow', description: '失败图', inputSchema: { type: 'object' },
    run: context => context.callTool('native_failed', {}) }))
  const failed = await f.execute('child_failed_workflow')
  assert.equal(failed.isError, false, JSON.stringify(failed))
  assert.equal(failed.value.ok, false)
  assert.equal(failed.value.graph_execution.trace[0].status, 'failed')
  assert.equal(failed.value.graph_execution.trace[0].result.error.message, '受控子工具失败')
  const cycle = {}; cycle.self = cycle
  for (const [index, value] of [undefined, { detail: undefined }, [undefined], NaN, Infinity, -0, 1n, new Date(0), cycle].entries()) {
    const name = `invalid_value_${index}`
    registerWorkflowTool(f.registration, defineWorkflow({ id: name, toolName: name, description: '无损校验', inputSchema: { type: 'object' }, async run() { return value } }))
    const result = await f.execute(name)
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(result.value.error_code, 'WORKFLOW_INVALID_RESULT')
    assert.equal(result.value.graph_execution.status, 'failed')
  }
  registerWorkflowTool(f.registration, defineWorkflow({ id: 'valid', toolName: 'valid_workflow', description: '合法图', inputSchema: { type: 'object' },
    async run() { return { detail: null, steps: [], total: 0 } } }))
  const success = await f.execute('valid_workflow')
  assert.equal(success.isError, false, JSON.stringify(success))
  assert.equal(success.value.ok, true)
  assert.deepEqual(success.value.result, { detail: null, steps: [], total: 0 })
})

test('真实ToolRuntime接收图内默认路由的attempt，未指定的观察字段不制造undefined输出', async t => {
  const f = nativeFixture(t, { async prepareCall() { return { config: { provider: 'actual-provider', model: 'actual-model' },
    async *stream() { yield { type: 'text-delta', text: '实际结果' }; yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } }; yield { type: 'finish', reason: { kind: 'stop' } } },
  } } })
  registerWorkflowTool(f.registration, defineWorkflow({ id: 'observed-default', toolName: 'observed_default', description: '原生模型观察', inputSchema: { type: 'object' },
    run: context => context.infer({}, { messages: [] }) }))
  const result = await f.execute('observed_default')
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.ok, true)
  const attempts = result.value.graph_execution.model_attempts
  assert.deepEqual(attempts.map(row => row.status), ['preparing', 'started', 'completed'])
  assert.equal(Object.hasOwn(attempts[0], 'provider'), false)
  assert.equal(attempts.at(-1).provider, 'actual-provider')
  assert.equal(attempts.at(-1).usage.totalTokens, 6)
})

test('真实ToolRuntime中图模型派发前中间件失败保留原始attempt且不能结算成一次远程调用', async t => {
  const f = nativeFixture(t, { async prepareCall() { return { config: { provider: 'actual-provider', model: 'actual-model' },
    async *stream() { throw new Error('Provider派发前的中间件失败') },
  } } })
  registerWorkflowTool(f.registration, defineWorkflow({ id: 'pre-dispatch-error', toolName: 'pre_dispatch_error', description: '派发前失败', inputSchema: { type: 'object' },
    run: context => context.infer({}, { messages: [] }) }))
  const result = await f.execute('pre_dispatch_error')
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.equal(result.value.ok, false)
  const attempts = result.value.graph_execution.model_attempts
  assert.deepEqual(attempts.map(row => row.status), ['preparing', 'started', 'failed'])
  const measured = measureModelUsage([], { attempts, requireSessionTrace: false })
  assert.equal(measured.actual_model_calls, null)
  assert.equal(measured.observed_model_calls, 0)
  assert.ok(measured.model_calls_unknown_reasons.includes('graph-attempt-invocation-unproven'))
})
