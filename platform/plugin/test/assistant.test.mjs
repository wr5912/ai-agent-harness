import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, appendPluginRecord } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createAssistant, redactAssistant } from '../src/assistant/index.ts'
import { assistantMcp } from '../src/assistant/mcp.ts'

function fixture(t, responder) {
  const ctx = new Context()
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new SystemPrompt(ctx, {})
  const sessions = new Map(), tools = new Map(), calls = [], prompts = []
  let count = 0
  ctx.on('session/event', (session, event) => sessions.get(session.id)?.events.push(event))
  function addSession(id, cwd = '/project', seed = [], parentSession) {
    const row = { events: [...seed], input: {}, session: undefined }
    sessions.set(id, row)
    row.session = ctx.sessions.create(id, { ...(seed.length ? { seed } : {}), ...(parentSession ? { inheritedEventCount: seed.length } : {}), meta: { cwd, ...(parentSession ? { parentSession, isSeeded: true } : {}) } })
    return row.session
  }
  const controller = {
    async create(input) { assert.ok(!(input.cwd && input.workspaceId)); const id = `session-${++count}`; addSession(id, input.cwd ?? '/project'); sessions.get(id).input = input; return { sessionId: id } },
    async resolveAgent(id) { return { agent: { id, session: sessions.get(id).session } } },
    async prompt(request) { prompts.push(request); return { accepted: true } },
    cancel() { return { accepted: true } },
  }
  const services = { controller, projections: ctx.sessionProjections, systemPrompt: ctx.systemPrompt,
    record(session, type, data) { appendPluginRecord(session, type, data) }, notify() {} }
  const platform = async (endpoint, input, signal) => { calls.push({ endpoint, input }); return await responder?.(endpoint, input, signal) ?? { ok: true, value: { ok: true, source: endpoint } } }
  const create = () => { const assistant = createAssistant('/project', platform, services); assistant.registerTools({ register: tool => tools.set(tool.name, tool) }); return assistant }
  let assistant = create()
  t.after(async () => { await assistant.dispose(); await ctx.fiber.dispose() })
  const signal = new AbortController().signal
  const rpc = (action, input, requestSignal = signal) => assistant.handler(action, input, requestSignal)
  const execute = async (id, domain, action, input = {}, toolSignal = signal) => tools.get(`platform_${domain}`).execute({ action, input }, { agent: { id }, signal: toolSignal })
  const status = async id => (await rpc('status', { session_id: id })).value
  async function proposal(id) {
    for (let index = 0; index < 40; index++) {
      const value = (await status(id)).proposals.find(item => item.state === 'awaiting_confirmation')
      if (value) return value
      await setImmediate()
    }
    assert.fail('未出现待确认提案')
  }
  const assemble = async id => (await ctx.systemPrompt.assemble({ agent: { session: sessions.get(id).session } })).sections.find(item => item.name === 'harness-platform/assistant')?.text ?? ''
  return { ctx, sessions, services, tools, calls, prompts, rpc, status, execute, proposal, assemble, addSession,
    async reload() { await assistant.dispose(); assistant = create() } }
}

test('真实 Session 投影隔离上下文、冷恢复固定任务，用户 prompt 保持原文', async t => {
  const f = fixture(t)
  const task = '你好\n保留原始空格  '
  const first = (await f.rpc('session', { task, workspace_id: 'project-workspace', context: { experiment_id: 'EXP-a-001', literal: '{{secret}}' } })).value.session_id
  const second = (await f.rpc('session', { context: { experiment_id: 'EXP-b-001' } })).value.session_id
  assert.notEqual(first, second)
  assert.equal(f.sessions.get(first).input.workspaceId, 'project-workspace')
  assert.equal(f.sessions.get(first).input.cwd, undefined)
  assert.deepEqual(f.prompts[0].content, [{ type: 'text', text: task }])
  await f.rpc('context', { session_id: first, context: { experiment_id: 'EXP-a-002' } })
  await f.reload()
  const status = await f.status(first)
  assert.equal(status.context.experiment_id, 'EXP-a-002')
  assert.equal(status.task_context.experiment_id, 'EXP-a-001')
  const a = await f.assemble(first), b = await f.assemble(second)
  assert.ok(a.includes('EXP-a-001') && a.includes('EXP-a-002') && a.includes('{{secret}}'))
  assert.ok(!a.includes('EXP-b-001') && !a.includes(task))
  assert.ok(b.includes('EXP-b-001') && !b.includes('EXP-a-'))
  assert.equal(f.prompts.length, 1, '页面变化和冷恢复不得触发用户消息')
  f.addSession('ordinary')
  assert.equal(await f.assemble('ordinary'), '', '普通原生会话不自动注入平台策略')
  f.addSession('foreign', '/another-project')
  assert.equal((await f.rpc('status', { session_id: 'foreign' })).ok, false)
})

test('工具在确认前保持 pending，真实回执返回原调用，重复确认不重复写入或伪造消息', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', { task: '停止实例' })).value.session_id
  await f.execute(id, 'agents', 'eval/status', { job_id: 'same-job' })
  assert.equal(f.calls[0].endpoint, 'agents/eval/status')
  let returned = false
  const operation = f.execute(id, 'instances', 'run', { name: 'isolated', operation: 'stop' }).then(value => { returned = true; return value })
  const proposed = await f.proposal(id)
  assert.equal(returned, false)
  assert.equal(f.calls.filter(call => call.endpoint === 'instances/run').length, 0)
  const confirmed = await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  assert.equal(confirmed.value.continuation, 'resumed')
  const receipt = await operation
  assert.equal(receipt.kind, 'platform-operation')
  assert.equal(receipt.state, 'completed')
  assert.equal(receipt.result.value.source, 'instances/run')
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  assert.equal(f.calls.filter(call => call.endpoint === 'instances/run').length, 1)
  assert.equal(f.calls.find(call => call.endpoint === 'instances/run').input.confirmed, true)
  assert.equal(f.prompts.length, 1)
})

test('原生记录冷恢复后可确认一次，但不会通过伪用户消息自动启动旧工具', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', {})).value.session_id
  appendPluginRecord(f.sessions.get(id).session, 'plugin:harness-platform/assistant', {
    kind: 'proposal', id: 'cold-proposal', domain: 'instances', action: 'run',
    input: { name: 'isolated', operation: 'stop' }, preview: {}, state: 'awaiting_confirmation',
  })
  await f.reload()
  const receipt = await f.rpc('confirm', { session_id: id, proposal_id: 'cold-proposal' })
  assert.equal(receipt.value.continuation, 'requires_user_message')
  await f.rpc('confirm', { session_id: id, proposal_id: 'cold-proposal' })
  assert.equal(f.calls.filter(call => call.endpoint === 'instances/run').length, 1)
  assert.equal(f.prompts.length, 0)
})

test('fork 可继承上下文，不能继承父会话提案或确认权', async t => {
  const f = fixture(t)
  const parent = (await f.rpc('session', { context: { experiment_id: 'EXP-parent' } })).value.session_id
  appendPluginRecord(f.sessions.get(parent).session, 'plugin:harness-platform/assistant', {
    kind: 'proposal', id: 'legacy-parent-proposal', domain: 'instances', action: 'run', input: {}, state: 'awaiting_confirmation',
  })
  const second = (await f.rpc('session', {})).value.session_id
  f.addSession('forked', '/project', f.sessions.get(parent).events, parent)
  assert.ok((await f.assemble('forked')).includes('EXP-parent'))
  assert.deepEqual((await f.status('forked')).proposals, [])
  for (const session_id of ['forked', second]) assert.equal((await f.rpc('confirm', { session_id, proposal_id: 'legacy-parent-proposal' })).ok, false)
  assert.equal(f.calls.length, 0)
})

test('冷恢复中断的 running 仅在读取时显示 unknown，不改写记录或自动重试', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', {})).value.session_id
  appendPluginRecord(f.sessions.get(id).session, 'plugin:harness-platform/assistant', {
    kind: 'proposal', id: 'interrupted-operation', domain: 'instances', action: 'run',
    input: { name: 'isolated', operation: 'stop' }, state: 'running', owner_session_id: id,
  })
  const prior = f.sessions.get(id).events.length
  await f.reload()
  assert.equal((await f.status(id)).proposals[0].state, 'unknown')
  await f.rpc('confirm', { session_id: id, proposal_id: 'interrupted-operation' })
  assert.equal(f.calls.length, 0)
  assert.equal(f.sessions.get(id).events.length, prior)
  assert.equal(f.ctx.sessionProjections.stateOf(f.sessions.get(id).session, 'harnessPlatformAssistant').proposals[0].state, 'running')
})

test('取消待确认工具会结算取消，不能随后确认执行', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', {})).value.session_id
  const operation = f.execute(id, 'instances', 'run', { name: 'isolated', operation: 'stop' })
  const proposed = await f.proposal(id)
  await f.rpc('cancel', { session_id: id })
  const receipt = await operation
  assert.equal(receipt.kind, 'platform-operation')
  assert.equal(receipt.state, 'cancelled')
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  assert.equal(f.calls.filter(call => call.endpoint === 'instances/run').length, 0)
})

test('写入 running 回执期间取消，不会退回浏览器信号执行写入', async t => {
  const f = fixture(t), tool = new AbortController()
  const id = (await f.rpc('session', {})).value.session_id
  const operation = f.execute(id, 'instances', 'run', { name: 'isolated', operation: 'stop' }, tool.signal)
  const proposed = await f.proposal(id)
  const original = f.services.record
  f.services.record = async (session, type, value) => {
    original(session, type, value)
    if (value.kind === 'settlement' && value.state === 'running') tool.abort()
  }
  assert.equal((await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })).ok, false)
  assert.equal((await operation).state, 'cancelled')
  assert.equal((await f.status(id)).proposals[0].state, 'cancelled')
  assert.equal(f.calls.filter(call => call.endpoint === 'instances/run').length, 0)
})

test('工具方案关联真实 Session；结果脱敏且模型结束不伪造融合成功', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', {})).value.session_id
  await f.execute(id, 'agents', 'fusion/preview', { agent_id: 'a' })
  assert.equal(f.calls[0].input.assistant_session_id, id)
  assert.equal((await f.status(id)).proposals.length, 0)
  assert.deepEqual(redactAssistant({ password: 'private', headers: { Authorization: 'Bearer private' }, token: 'private', credential_configured: true }),
    { password: '[已隐藏]', headers: { Authorization: '[已隐藏]' }, token: '[已隐藏]', credential_configured: true })
})

test('MCP 配置使用原生 revision，调试管理复用实际 dispatcher action', async () => {
  const calls = []
  const bridge = assistantMcp({ describe: () => ({ namespaces: [{ ns: 'mcp-session-manager', revision: 9 }] }), async mutate(...args) { calls.push(args); return { revision: 10 } } },
    { dispatch: async request => { calls.push(request); return { status: 200, value: { tools: [] } } } })
  const signal = new AbortController().signal
  assert.equal((await bridge('configuration', {}, signal)).value.revision, 9)
  await bridge('saveConfiguration', { ops: [{ op: 'set', path: ['servers', '0', 'description'], value: '更新' }], revision: 9 }, signal)
  assert.equal(calls[0][0], 'mcp-session-manager')
  assert.equal(calls[0][2], 9)
  await bridge('sources/list', { serverId: 'soc' }, signal)
  assert.equal(calls[1].action, 'sources')
})

test('完整融合方案成为待确认卡片，确认后返回原工具，冻结的工具参数保持不变', async t => {
  const f = fixture(t, endpoint => endpoint === 'agents/fusion/preview' ? { ok: true, value: { preview_id: 'fixed-preview', plan_ready: true, plan: { features: [] } } } : undefined)
  const id = (await f.rpc('session', {})).value.session_id
  const frozen = Object.freeze({ agent_id: 'a' })
  const operation = f.execute(id, 'agents', 'fusion/preview', frozen)
  const card = await f.proposal(id)
  assert.equal(card.action, 'fusion/confirm')
  assert.equal(frozen.assistant_session_id, undefined)
  assert.equal(f.calls.filter(call => call.endpoint === 'agents/fusion/confirm').length, 0)
  await f.rpc('confirm', { session_id: id, proposal_id: card.id })
  assert.equal((await operation).state, 'completed')
  assert.equal(f.calls.find(call => call.endpoint === 'agents/fusion/confirm').input.preview_id, 'fixed-preview')
})

test('已确认融合只自主编辑同 Session 目标 Candidate，评测口径仍等待确认', async t => {
  const f = fixture(t, endpoint => endpoint === 'agents/fusion/status' ? { ok: true, value: { creation: { status: 'integrating', assistant_session_id: 'session-1' } } } : undefined)
  const id = (await f.rpc('session', {})).value.session_id
  const allowed = await f.execute(id, 'agents', 'edit/apply', { experiment_id: 'EXP-a-002', edits: [{ path: 'candidate/dsh/workspace/AGENTS.md', content: '融合' }] })
  assert.equal(allowed.state, 'completed')
  const protectedEdit = f.execute(id, 'agents', 'edit/apply', { experiment_id: 'EXP-a-002', edits: [{ path: 'agents/a/evaluation.md', content: '不同口径' }] })
  assert.equal((await f.proposal(id)).state, 'awaiting_confirmation')
  assert.equal(f.calls.filter(call => call.endpoint === 'agents/edit/apply').length, 1)
  await f.rpc('cancel', { session_id: id })
  await protectedEdit
  await assert.rejects(f.execute(id, 'mcp', 'saveConfiguration', { revision: 1, ops: [{ op: 'set', path: ['servers', '0', 'apiKey'], value: 'fixture-secret' }] }), /凭据/)
  assert.ok(!JSON.stringify(f.sessions.get(id).events).includes('fixture-secret'))
})
