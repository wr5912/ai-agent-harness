import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, appendPluginRecord } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createAssistant } from '../src/assistant/index.ts'

const sessionRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-session'))
const { createUserMessage } = await import(sessionRequire.resolve('@deepseek-ai/dsh-llm'))

function fixture(t, overrides = {}) {
  const ctx = new Context()
  new SessionStore(ctx); new SessionProjectionRegistry(ctx); new SystemPrompt(ctx, {})
  const id = 'session-closing-usage', root = '/task-closing-usage'
  const session = ctx.sessions.create(id, { meta: { cwd: root } })
  const services = { controller: { async resolveAgent() { return { agent: { id, session } } } },
    projections: ctx.sessionProjections, systemPrompt: ctx.systemPrompt,
    record: appendPluginRecord, notify() {} }
  const create = () => createAssistant(root, async () => ({ ok: true, value: {} }), services)
  let assistant = create()
  const record = data => appendPluginRecord(session, 'plugin:harness-platform/assistant', data)
  record({ kind: 'context', context: { skill: 'task-builder' } })
  const task = { id: 'completed-task', owner_session_id: id, state: 'running', model_calls: 35, assistant_model_calls: 22,
    started_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 60000).toISOString(), repair_rounds: 0, operations: [],
    plan: { goal: '交付模拟报告', agent_id: 'inspection', evaluation_case_ids: ['U-BUSINESS-001'], allowed_actions: [], deliverables: ['报告'], budget: { max_model_calls: 60 } }, ...overrides }
  record({ kind: 'execution', owner_session_id: id, execution: task })
  record({ kind: 'execution', owner_session_id: id, execution: { ...task, state: 'completed', delivery: { ready: true } } })
  const status = async () => (await assistant.handler('status', { session_id: id }, new AbortController().signal)).value
  t.after(async () => { await assistant.dispose(); await ctx.fiber.dispose() })
  return { session, record, status, before: () => assistant.beforeModelCall(id),
    async reload() { await assistant.dispose(); assistant = create() } }
}

test('交付后的原生工具续轮和Goal注入仍计入同任务，新用户输入开始后不再归旧任务', async t => {
  const f = fixture(t)
  f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  f.session.append('turn/start', { turn: 2 })
  f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '继续核对已交付结果' }], source: { kind: 'goal', goalId: 'goal-test', revision: 1, round: 1 } }), { surfaceOp: 'append' })
  await f.before()
  assert.equal((await f.status()).execution.model_calls, 36)
  assert.equal((await f.status()).execution.assistant_model_calls, 23)
  await f.reload()
  assert.equal((await f.status()).execution.model_calls, 36)
  f.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '现在帮我查看另一个智能体' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  await f.before()
  const state = await f.status()
  assert.equal(state.execution.model_calls, 36)
  assert.equal(state.execution.assistant_model_calls, 23)
  assert.equal(state.model_calls_observed, 2)
  assert.equal(state.closing_task_id, undefined)
  assert.equal(state.execution.state, 'completed')
})

test('收尾说明严格遵守原额度和时限，不把已核验交付改成失败', async t => {
  for (const overrides of [{ model_calls: 60 }, { deadline_at: new Date(Date.now() - 1000).toISOString() }]) {
    const f = fixture(t, overrides)
    await assert.rejects(() => f.before(), /收尾说明的任务额度已耗尽/)
    const state = await f.status()
    assert.equal(state.model_calls_observed, 0)
    assert.equal(state.execution.state, 'completed')
    assert.equal(state.execution.delivery.ready, true)
  }
})

test('历史未标task_id的模型调用只保留Session事实，不猜补旧任务成本', async t => {
  const f = fixture(t)
  f.record({ kind: 'model-call', owner_session_id: 'session-closing-usage' })
  await f.reload()
  assert.equal((await f.status()).model_calls_observed, 1)
  assert.equal((await f.status()).execution.model_calls, 35)
})
