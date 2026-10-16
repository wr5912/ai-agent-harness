import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, appendPluginRecord } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { createAssistant, redactAssistant } from '../src/assistant/index.ts'
import { assistantMcp } from '../src/assistant/mcp.ts'

function fixture(t, responder, root = '/project') {
  const ctx = new Context()
  new SessionStore(ctx)
  new SessionProjectionRegistry(ctx)
  new SystemPrompt(ctx, {})
  const sessions = new Map(), tools = new Map(), calls = [], prompts = []
  let count = 0
  ctx.on('session/event', (session, event) => sessions.get(session.id)?.events.push(event))
  function addSession(id, cwd = root, seed = [], parentSession) {
    const row = { events: [...seed], input: {}, session: undefined }
    sessions.set(id, row)
    row.session = ctx.sessions.create(id, { ...(seed.length ? { seed } : {}), ...(parentSession ? { inheritedEventCount: seed.length } : {}), meta: { cwd, ...(parentSession ? { parentSession, isSeeded: true } : {}) } })
    return row.session
  }
  const controller = {
    async create(input) { assert.ok(!(input.cwd && input.workspaceId)); const id = `session-${++count}`; addSession(id, input.cwd ?? root); sessions.get(id).input = input; return { sessionId: id } },
    async resolveAgent(id) { return { agent: { id, session: sessions.get(id).session } } },
    async prompt(request) { prompts.push(request); return { accepted: true } },
    cancel() { return { accepted: true } },
  }
  const services = { controller, projections: ctx.sessionProjections, systemPrompt: ctx.systemPrompt,
    record(session, type, data) { appendPluginRecord(session, type, data) }, notify() {} }
  const platform = async (endpoint, input, signal) => { calls.push({ endpoint, input }); return await responder?.(endpoint, input, signal) ?? { ok: true, value: { ok: true, source: endpoint } } }
  const create = () => { const assistant = createAssistant(root, platform, services); assistant.registerTools({ register: tool => tools.set(tool.name, tool) }); return assistant }
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
  const assembly = id => ctx.systemPrompt.assemble({ agent: { session: sessions.get(id).session } })
  const assemble = async id => (await assembly(id)).sections.filter(item => ['harness-platform/assistant', 'harness-platform/assistant-output'].includes(item.name)).map(item => item.text).filter(Boolean).join('\n')
  return { ctx, sessions, services, tools, calls, prompts, rpc, status, execute, proposal, assemble, assembly, addSession,
    async reload() { await assistant.dispose(); assistant = create() } }
}

test('真实 Session 投影隔离上下文、冷恢复固定任务，用户 prompt 保持原文', async t => {
  const f = fixture(t)
  const task = '你好\n保留原始空格  '
  assert.equal((await f.rpc('session', { workspace_id: 'foreign-workspace' })).ok, false)
  const first = (await f.rpc('session', { task, context: { experiment_id: 'EXP-a-001', literal: '{{secret}}' } })).value.session_id
  const second = (await f.rpc('session', { context: { experiment_id: 'EXP-b-001' } })).value.session_id
  assert.notEqual(first, second)
  assert.equal(f.sessions.get(first).input.workspaceId, undefined)
  assert.equal(f.sessions.get(first).input.cwd, '/project')
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

test('各类平台任务只装载一份共用表达正文，不写入用户消息或会话事实', async t => {
  const principles = readFileSync(new URL('../../prompts/user-facing-output.md', import.meta.url), 'utf8').trim()
  assert.ok(principles, '共用表达来源必须有正文')
  const f = fixture(t)
  const suffixOrder = f.services.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX')
  const before = f.services.systemPrompt.section({ name: 'test/before-persona-suffix', order: suffixOrder - 0.5, text: '部署角色收尾之前' })
  const after = f.services.systemPrompt.section({ name: 'test/after-persona-suffix', order: suffixOrder + 0.5, text: '部署角色收尾之后' })
  t.after(() => { before(); after() })
  const contexts = [
    { page: 'home' },
    { page: 'agents', skill: 'agent-maintenance', workflow: 'features', experiment_id: 'EXP-basic-001' },
    { page: 'agents', skill: 'agent-maintenance', workflow: 'research', experiment_id: 'EXP-basic-001' },
    { page: 'agents', skill: 'compute-variant-research', workflow: 'compute-variants', experiment_id: 'EXP-basic-001' },
    { page: 'mcp', skill: 'mcp-composition' },
    { page: 'evaluation', skill: 'decision-sample-extraction', run_id: 'run-fixed' },
    { page: 'instances' },
  ]
  for (const context of contexts) {
    const task = `请处理 ${context.workflow ?? context.page}`
    const id = (await f.rpc('session', { task, context })).value.session_id
    const assembled = await f.assemble(id)
    assert.equal(assembled.split(principles).length - 1, 1, `${context.workflow ?? context.page} 应装载唯一正文`)
    const { sections } = await f.assembly(id)
    const names = sections.map(item => item.name)
    const outputIndex = names.indexOf('harness-platform/assistant-output')
    assert.equal(sections[outputIndex]?.text, principles)
    assert.ok(names.indexOf('harness-platform/assistant') < names.indexOf('test/before-persona-suffix'))
    assert.ok(names.indexOf('test/before-persona-suffix') < outputIndex && outputIndex < names.indexOf('test/after-persona-suffix'), '表达正文使用 Runtime 官方部署角色收尾位置')
    assert.equal(sections.map(item => item.text).join('\n').split(principles).length - 1, 1, '整组系统提示不得重复装载原则')
    assert.deepEqual(f.prompts.at(-1).content, [{ type: 'text', text: task }])
    assert.ok(!JSON.stringify(f.sessions.get(id).events).includes(JSON.stringify(principles).slice(1, -1)), '运行记录不复制共用可编辑原则')
  }
  assert.equal(f.calls.length, 0, '装载表达原则不发起业务操作')
})

test('原生 Session 事件冷恢复后仍装载表达正文，普通会话与其他工作区保持隔离', async t => {
  const principles = readFileSync(new URL('../../prompts/user-facing-output.md', import.meta.url), 'utf8').trim()
  const original = fixture(t)
  const id = (await original.rpc('session', { task: '抽取决策样本', context: { skill: 'decision-sample-extraction', run_id: 'run-fixed' } })).value.session_id
  const events = [...original.sessions.get(id).events]
  const restored = fixture(t)
  restored.addSession(id, '/project', events)
  assert.equal((await restored.assemble(id)).split(principles).length - 1, 1)
  assert.equal((await restored.status(id)).task_context.run_id, 'run-fixed')
  await restored.reload()
  assert.equal((await restored.assemble(id)).split(principles).length - 1, 1, '重新注册不能重复注入')
  restored.addSession('ordinary')
  restored.addSession('foreign', '/another-project', events)
  assert.equal(await restored.assemble('ordinary'), '')
  assert.equal(await restored.assemble('foreign'), '')
  assert.equal(restored.prompts.length, 0, '恢复和系统提示装载不得伪造用户消息')
})

test('表达原则从显式程序根读取，数据根的同名文件不能替代程序事实源', async t => {
  const sandbox = mkdtempSync(join(tmpdir(), 'assistant-output-source-'))
  t.after(() => rmSync(sandbox, { recursive: true, force: true }))
  const program = join(sandbox, 'program'), assets = join(sandbox, 'data')
  const principles = '程序来源的独立测试正文。\n第二段保留完整内容。'
  for (const root of [program, assets]) mkdirSync(join(root, 'platform/prompts'), { recursive: true })
  writeFileSync(join(program, 'platform/prompts/user-facing-output.md'), principles)
  writeFileSync(join(assets, 'platform/prompts/user-facing-output.md'), '数据目录中的同名文件不应生效')
  const previous = process.env.HARNESS_PROGRAM_ROOT
  process.env.HARNESS_PROGRAM_ROOT = program
  try {
    const f = fixture(t, undefined, assets)
    const id = (await f.rpc('session', { context: { page: 'home' } })).value.session_id
    assert.equal((await f.assemble(id)).split(principles).length - 1, 1)
    assert.ok(!(await f.assemble(id)).includes('数据目录中的同名文件不应生效'))
    await f.reload()
    assert.equal((await f.assemble(id)).split(principles).length - 1, 1)
  } finally {
    if (previous === undefined) delete process.env.HARNESS_PROGRAM_ROOT
    else process.env.HARNESS_PROGRAM_ROOT = previous
  }
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
  assert.equal(receipt.preview, undefined, '已结算工具结果不得携带仍要求确认的旧预览')
  assert.equal(receipt.input, undefined)
  assert.ok((await f.status(id)).proposals[0].preview, '原始提案预览仍留在Session供界面核对')
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

for (const action of ['callPublishedComposition', 'callTool']) test(`${action} 提案冻结实际发布版本，后续发布不改变确认目标`, async t => {
  const originalVersion = '1'.repeat(64), nextVersion = '2'.repeat(64)
  const entry = { id: 'composition-fixed', publishedVersionId: originalVersion, published: { toolName: 'basic_status', title: '原版基础状态', description: '固定基础模拟数据' } }
  const f = fixture(t, (endpoint, input) => endpoint === 'mcp/list'
    ? { ok: true, value: { compositions: [entry] } }
    : endpoint === 'mcp/callPublishedComposition' ? { ok: true, value: { executed_version: input.versionId } } : undefined)
  const id = (await f.rpc('session', {})).value.session_id
  const input = action === 'callTool' ? { serverId: 'platform-compositions', toolName: 'basic_status', arguments: { asset: 'test' } }
    : { toolName: 'basic_status', input: { asset: 'test' }, compositionId: 'model-supplied', versionId: nextVersion }
  const before = structuredClone(input)
  const operation = f.execute(id, 'mcp', action, Object.freeze(input))
  const card = await f.proposal(id)
  assert.equal(card.action, 'callPublishedComposition')
  assert.equal(card.preview.title, '原版基础状态')
  assert.equal(card.preview.versionId, originalVersion)
  assert.equal(card.input.compositionId, entry.id)
  assert.deepEqual(input, before)
  entry.publishedVersionId = nextVersion
  entry.published = { ...entry.published, title: '后来发布的版本' }
  const confirmed = await f.rpc('confirm', { session_id: id, proposal_id: card.id })
  assert.equal(confirmed.value.result.value.executed_version, originalVersion)
  assert.equal((await operation).state, 'completed')
  await f.rpc('confirm', { session_id: id, proposal_id: card.id })
  assert.deepEqual(f.calls.filter(call => call.endpoint === 'mcp/callPublishedComposition').map(call => call.input), [{
    toolName: 'basic_status', compositionId: entry.id, versionId: originalVersion, input: { asset: 'test' }, confirmed: true,
  }])
})

test('冷恢复的旧组合卡片缺少固定版本时拒绝执行', async t => {
  const f = fixture(t), id = (await f.rpc('session', {})).value.session_id
  for (const action of ['callPublishedComposition', 'callTool']) {
    appendPluginRecord(f.sessions.get(id).session, 'plugin:harness-platform/assistant', {
      kind: 'proposal', id: action, owner_session_id: id, domain: 'mcp', action,
      input: { serverId: 'platform-compositions', toolName: 'basic_status', input: {} }, state: 'awaiting_confirmation',
    })
    const response = await f.rpc('confirm', { session_id: id, proposal_id: action })
    assert.equal(response.ok, false)
    assert.match(response.error.message, /固定组合版本/)
  }
  assert.deepEqual(f.calls, [])
})

test('URL 用户信息及查询凭据在写提案前拒绝，查询、上下文和错误展示均脱敏', async t => {
  const credentials = [
    'https://demo-user:dummy-password@fixture.invalid/spec',
    'https://fixture.invalid/spec?token=dummy-token',
    'https://fixture.invalid/spec?api_key=dummy-api-key',
    'wss://fixture.invalid/mcp?access_token=dummy-access-token',
    "https://fixture.invalid/spec?token=dummy-quoted'token",
  ]
  const f = fixture(t, () => ({ ok: true, value: { url: credentials[0], message: `请求失败：${credentials[1]}`, nested: [{ endpoint: credentials[2] }] } }))
  const id = (await f.rpc('session', {})).value.session_id
  for (const url of credentials) await assert.rejects(f.execute(id, 'mcp', 'saveConfiguration', {
    revision: 1, ops: [{ op: 'set', path: ['servers', '0', 'specUrl'], value: url }],
  }), /凭据请通过原生配置页面维护/)
  assert.equal((await f.status(id)).proposals.length, 0)
  assert.equal(f.calls.length, 0)
  await f.rpc('context', { session_id: id, context: { url: credentials[0] } })
  const read = await f.execute(id, 'mcp', 'list')
  assert.ok(!JSON.stringify(read).includes('dummy-'))
  assert.ok(!JSON.stringify(f.sessions.get(id).events).includes('dummy-'))
  assert.ok(!(await f.assemble(id)).includes('dummy-'))
  const ordinary = 'https://EXAMPLE.invalid:443/spec?q=basic&page=2#view'
  assert.equal(redactAssistant(ordinary), ordinary, '普通 URL 原样保留，不因规范化误判凭据')
  const throwing = fixture(t, () => { throw new Error(`上游连接失败：${credentials[1]}`) })
  const throwingId = (await throwing.rpc('session', {})).value.session_id
  await assert.rejects(throwing.execute(throwingId, 'mcp', 'list'), error => !error.message.includes('dummy-') && !error.stack.includes('dummy-'))
  const previewFailure = fixture(t, () => ({ ok: false, error: { message: `预览连接失败：${credentials[1]}` } }))
  const previewId = (await previewFailure.rpc('session', {})).value.session_id
  assert.ok(!JSON.stringify(await previewFailure.execute(previewId, 'instances', 'run', { name: 'fixture', operation: 'stop' })).includes('dummy-'))
  appendPluginRecord(f.sessions.get(id).session, 'plugin:harness-platform/assistant', {
    kind: 'proposal', id: 'legacy-credential', owner_session_id: id, domain: 'mcp', action: 'saveConfiguration',
    input: { revision: 1, ops: [{ op: 'set', path: ['servers', '0', 'specUrl'], value: credentials[0] }] }, state: 'awaiting_confirmation',
  })
  assert.ok(!JSON.stringify(await f.status(id)).includes('dummy-'))
  assert.equal((await f.rpc('confirm', { session_id: id, proposal_id: 'legacy-credential' })).ok, false)
  f.services.controller.resolveAgent = async () => { throw new Error(`连接失败：${credentials[1]}`) }
  const failure = await f.rpc('status', { session_id: id })
  assert.ok(!JSON.stringify(failure).includes('dummy-'))
  // 恢复内存夹具，便于正常释放原生投影。
  f.services.controller.resolveAgent = async sessionId => ({ agent: { session: f.sessions.get(sessionId).session } })
})

test('决策抽取预览使用当前真实请求模型和固定 Run，AI 不能自行把标签标为人员复核', async t => {
  const f = fixture(t)
  const runId = 'run-11111111-1111-4111-8111-111111111111'
  const id = (await f.rpc('session', { task: '抽取决策样本', context: { run_id: runId } })).value.session_id
  const route = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' }
  f.sessions.get(id).session.append('request/header', { header: { config: { ...route, apiKey: 'fixture-private-model-key' } }, reason: 'initial' })
  await f.reload()
  const input = Object.freeze({ run_id: runId, path: 'evidence/U-BASIC-001/trace.jsonl', source_sha256: 'a'.repeat(64), samples: [], assistant_session_id: 'model-supplied-owner', assistant_model: { model: 'model-supplied-route' } })
  await f.execute(id, 'agents', 'datasets/preview', input)
  const call = f.calls.find(item => item.endpoint === 'agents/datasets/preview')
  assert.deepEqual(call.input.assistant_model, route)
  assert.equal(call.input.assistant_session_id, id)
  assert.equal(input.assistant_session_id, 'model-supplied-owner', '不得修改被冻结的模型工具入参')
  assert.ok(!JSON.stringify(call.input).includes('fixture-private-model-key'))
  assert.equal(f.tools.get('platform_agents').parameters.properties.action.enum.includes('datasets/update'), false)
  await assert.rejects(f.execute(id, 'agents', 'datasets/update', { label_status: 'reviewed' }), /未知的领域操作/)
  await f.rpc('context', { session_id: id, context: { run_id: 'run-22222222-2222-4222-8222-222222222222' } })
  await assert.rejects(f.execute(id, 'agents', 'datasets/preview', { ...input, run_id: 'run-22222222-2222-4222-8222-222222222222' }), /固定任务上下文/)
  assert.equal(f.calls.filter(item => item.endpoint === 'agents/datasets/preview').length, 1)
})

test('AI 决策样本预览经原生确认后仅携原 owner 保存一次，取消提案不写数据集', async t => {
  const f = fixture(t, (endpoint, input) => endpoint === 'agents/datasets/preview' ? { ok: true, value: { preview_id: `preview-${input.assistant_session_id}`, count: 1, status: 'suggested', records: [{ _meta: { label_status: 'suggested' } }] } } : undefined)
  const runId = 'run-11111111-1111-4111-8111-111111111111'
  const id = (await f.rpc('session', { task: '抽取样本', context: { run_id: runId } })).value.session_id
  const operation = f.execute(id, 'agents', 'datasets/preview', { run_id: runId, samples: [] })
  const proposed = await f.proposal(id)
  assert.equal(proposed.action, 'datasets/apply')
  assert.equal(proposed.owner_session_id, id)
  assert.equal(proposed.input.assistant_session_id, id)
  assert.equal(proposed.preview.records[0]._meta.label_status, 'suggested')
  assert.equal(f.calls.filter(item => item.endpoint === 'agents/datasets/apply').length, 0)
  const other = (await f.rpc('session', {})).value.session_id
  assert.equal((await f.rpc('confirm', { session_id: other, proposal_id: proposed.id })).ok, false)
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  assert.equal((await operation).state, 'completed')
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  const saved = f.calls.filter(item => item.endpoint === 'agents/datasets/apply')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].input.assistant_session_id, id)
  assert.equal(saved[0].input.preview_id, proposed.input.preview_id)
  const cancelId = (await f.rpc('session', { task: '抽取但取消', context: { run_id: runId } })).value.session_id
  const cancelled = f.execute(cancelId, 'agents', 'datasets/preview', { run_id: runId, samples: [] })
  const cancelProposal = await f.proposal(cancelId)
  await f.rpc('cancel', { session_id: cancelId })
  assert.equal((await cancelled).state, 'cancelled')
  await f.rpc('confirm', { session_id: cancelId, proposal_id: cancelProposal.id })
  assert.equal(f.calls.filter(item => item.endpoint === 'agents/datasets/apply').length, 1)
})


test('独立工作区固化助手身份、迁移旧 Session 归属且不改写原始事件', async t => {
  const root = mkdtempSync(join(tmpdir(), 'assistant workspace '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'workspace-fixture', legacyRoots: ['/old-platform'] }))
  const f = fixture(t, undefined, root)
  f.addSession('legacy', '/old-platform')
  appendPluginRecord(f.sessions.get('legacy').session, 'plugin:harness-platform/assistant', { kind: 'task', task: '读取旧任务', context: { agent_id: 'business-agent' } })
  const before = [...f.sessions.get('legacy').events]
  assert.equal((await f.rpc('status', { session_id: 'legacy' })).ok, true)
  await f.reload()
  assert.equal((await f.rpc('status', { session_id: 'legacy' })).ok, true)
  assert.equal(f.sessions.get('legacy').session.header.cwd, '/old-platform')
  assert.deepEqual(f.sessions.get('legacy').events, before)
  const prompt = await f.assemble('legacy')
  assert.ok(prompt.includes('workspace-fixture') && prompt.includes(root))
  assert.ok(prompt.includes('business-agent') && prompt.includes('workspace-management'))
  const created = await f.rpc('session', { task: '读取业务数据', context: { agent_id: 'business-agent' } })
  assert.equal(f.sessions.get(created.value.session_id).input.cwd, root)
  f.addSession('other', '/old-platform/unrelated')
  assert.equal((await f.rpc('status', { session_id: 'other' })).ok, false)
  assert.equal(await f.assemble('other'), '')
})


test('已绑定的管理 Session 不随路径复用而跨工作区身份接受工具调用', async t => {
  const root = mkdtempSync(join(tmpdir(), 'assistant bound workspace '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const descriptor = join(root, 'workspace.json')
  writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, id: 'workspace-first', legacyRoots: [] }))
  const f = fixture(t, undefined, root)
  const created = await f.rpc('session', { task: '读取任务' })
  const id = created.value.session_id
  assert.equal((await f.status(id)).workspace_id, 'workspace-first')
  writeFileSync(descriptor, JSON.stringify({ schemaVersion: 1, id: 'workspace-second', legacyRoots: [] }))
  assert.equal((await f.rpc('status', { session_id: id })).ok, false)
  assert.equal(await f.assemble(id), '')
  await assert.rejects(() => f.execute(id, 'agents', 'list'), /另一个工作区身份/)
  assert.equal(f.calls.length, 0)
})

test('普通派生、用例更新与业务样例创建可达，写操作仍须确认且只执行一次', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', { context: { skill: 'agent-maintenance', workflow: 'research' } })).value.session_id
  for (const [domain, action, input] of [
    ['agents', 'create', { agent_id: 'basic', parent_experiment_id: 'EXP-basic-001', parent_ref: `git:${'a'.repeat(40)}`, research_question: '基本模拟数据摘要是否更清楚' }],
    ['agents', 'cases/update', { experiment_id: 'EXP-basic-001', case_id: 'U-BASIC-001', expected_sha256: 'a'.repeat(64), title: '基本输入', inputs: ['读取基本状态'], expected_behavior: '引用实际状态', fast: true }],
    ['mcp', 'seedThreatCompositions', { revision: 'fixture-revision', bindings: { socConnectionId: 'basic-soc', reportConnectionId: 'basic-report' } }],
  ]) {
    const operation = f.execute(id, domain, action, input)
    const proposed = await f.proposal(id)
    assert.equal(proposed.action, action)
    assert.equal(f.calls.filter(call => call.endpoint === `${domain}/${action}`).length, 0)
    await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
    assert.equal((await operation).state, 'completed')
    await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
    assert.equal(f.calls.filter(call => call.endpoint === `${domain}/${action}`).length, 1)
  }
  assert.equal((await f.execute(id, 'agents', 'assets/read-fixed', { agent_id: 'basic', experiment_id: 'EXP-basic-001', ref: `git:${'a'.repeat(40)}` })).state, 'completed')
  for (const action of ['compositionRun', 'compositionArtifact']) {
    const response = await f.execute(id, 'mcp', action, { run_id: 'basic-run', artifactId: 'summary' })
    assert.equal(response.state, 'completed')
  }
})

test('整理特性锁定任务版本，页面导航不改变预览目标', async t => {
  const f = fixture(t, endpoint => endpoint === 'agents/features/preview' ? { ok: true, value: { preview_id: 'features-fixed', requires_confirmation: true } } : undefined)
  const id = (await f.rpc('session', { task: '整理当前版本特性', context: { skill: 'agent-maintenance', workflow: 'features', experiment_id: 'EXP-basic-001' } })).value.session_id
  await f.rpc('context', { session_id: id, context: { experiment_id: 'EXP-basic-002' } })
  await assert.rejects(() => f.execute(id, 'agents', 'features/preview', { experiment_id: 'EXP-basic-002', features: [] }), /固定任务上下文/)
  assert.equal((await f.execute(id, 'agents', 'features/read-source', { experiment_id: 'EXP-basic-001', ref: 'evaluation/observations.md' })).state, 'completed')
  await f.execute(id, 'agents', 'features/read-source', {})
  assert.equal(f.calls.at(-1).input.experiment_id, 'EXP-basic-001', '缺省目标也绑定原任务，不能漂移到最新编号')
  await assert.rejects(() => f.execute(id, 'agents', 'edit/preview', { experiment_id: 'EXP-basic-001', edits: [] }), /仅允许读取业务来源/)
  await assert.rejects(() => f.execute(id, 'instances', 'list'), /仅允许读取业务来源/)
  const operation = f.execute(id, 'agents', 'features/preview', { experiment_id: 'EXP-basic-001', features: [] })
  const proposed = await f.proposal(id)
  assert.equal(proposed.action, 'features/apply')
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  const settled = await operation
  assert.equal(settled.state, 'completed')
  assert.equal(settled.preview, undefined)
  assert.equal(settled.action, 'features/apply')
  assert.ok(settled.result.ok)
})

test('融合继续评测只使用实际目标source和确认Case，混淆字段与扩大范围重新确认', async t => {
  const f = fixture(t, (endpoint, input) => endpoint === 'agents/fusion/status'
    ? { ok: true, value: { creation: { status: 'integrating', assistant_session_id: input.experiment_id === 'EXP-basic-002' ? 'session-1' : 'another-session', plan: { evaluation_case_ids: ['U-BASIC-001'] } } } }
    : undefined)
  const id = (await f.rpc('session', {})).value.session_id
  const allowed = await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-basic-002' })
  assert.equal(allowed.state, 'completed')
  assert.deepEqual(f.calls.find(call => call.endpoint === 'agents/eval/start').input.cases, ['U-BASIC-001'])
  for (const input of [
    { source: 'experiment:EXP-other-001', experiment_id: 'EXP-basic-002', cases: ['U-BASIC-001'] },
    { source: 'experiment:EXP-basic-002', cases: ['U-UNCONFIRMED-001'] },
  ]) {
    const operation = f.execute(id, 'agents', 'eval/start', input)
    const proposed = await f.proposal(id)
    assert.equal(proposed.action, 'eval/start')
    assert.equal(f.calls.filter(call => call.endpoint === 'agents/eval/start').length, 1)
    await f.rpc('cancel', { session_id: id })
    await operation
  }
})

test('普通资产写入与评测先使用真实preview失败时不生成确认或执行', async t => {
  const f = fixture(t, endpoint => ['agents/edit/preview', 'agents/eval/preview'].includes(endpoint) ? { ok: false, error: { code: 'conflict', message: '固定来源已变化', details: {} } } : undefined)
  const id = (await f.rpc('session', {})).value.session_id
  for (const [action, input] of [['edit/apply', { experiment_id: 'EXP-basic-001', edits: [] }], ['eval/start', { source: 'experiment:EXP-basic-001' }]]) {
    const response = await f.execute(id, 'agents', action, input)
    assert.equal(response.ok, false)
    assert.equal(f.calls.some(call => call.endpoint === `agents/${action}`), false)
  }
  assert.deepEqual((await f.status(id)).proposals, [])
})

test('算力变体先预览真实计划再确认创建，摘要和方案在等待期间固定', async t => {
  const digest = 'c'.repeat(64)
  const f = fixture(t, (endpoint, input) => endpoint === 'agents/compute-variants/preview'
    ? { ok: true, value: { parent_experiment_id: input.parent_experiment_id, parent_ref: input.parent_ref, plan: { case_hashes: { 'U-BASIC-001': 'frozen-case' }, model_change: null }, model_configuration: 'inherited_from_fixed_parent', preview_sha256: digest } } : undefined)
  const id = (await f.rpc('session', { task: '策划并创建探索性算力变体', context: { skill: 'agent-maintenance', workflow: 'compute-variants', experiment_id: 'EXP-basic-001' } })).value.session_id
  const available = f.tools.get('platform_agents').parameters.properties.action.enum
  for (const action of ['context', 'preview', 'create', 'compare']) assert.ok(available.includes(`compute-variants/${action}`))
  assert.equal(available.includes('compute-variants/confirm'), false)
  for (const action of ['context', 'compare']) assert.equal((await f.execute(id, 'agents', `compute-variants/${action}`, { experiment_id: 'EXP-basic-001' })).state, 'completed')
  const input = { parent_experiment_id: 'EXP-basic-001', parent_ref: `git:${'a'.repeat(40)}`, strategy: '减少重复基本状态查询', case_ids: ['U-BASIC-001'], resource_metric: 'total_tokens', min_resource_reduction_pct: 10 }
  const operation = f.execute(id, 'agents', 'compute-variants/create', input)
  const proposed = await f.proposal(id)
  assert.equal(proposed.preview.value.parent_experiment_id, input.parent_experiment_id)
  assert.equal(proposed.preview.value.model_configuration, 'inherited_from_fixed_parent')
  assert.equal(proposed.input.expected_preview_sha256, digest)
  assert.equal(f.calls.filter(call => call.endpoint === 'agents/compute-variants/create').length, 0)
  input.case_ids.push('U-OTHER-001')
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  assert.equal((await operation).state, 'completed')
  const actual = f.calls.find(call => call.endpoint === 'agents/compute-variants/create').input
  assert.deepEqual(actual.case_ids, ['U-BASIC-001'])
  assert.equal(actual.expected_preview_sha256, digest)
  assert.equal(actual.human_confirmed, undefined)
})

test('算力变体预览失败或确认时配置已变，助手不宣称创建完成', async t => {
  let invalidPreview = true
  const f = fixture(t, endpoint => endpoint === 'agents/compute-variants/preview'
    ? invalidPreview ? { ok: false, error: { code: 'invalid_request', message: '父版无法恢复' } } : { ok: true, value: { preview_sha256: 'b'.repeat(64) } }
    : endpoint === 'agents/compute-variants/create' ? { ok: false, error: { code: 'conflict', message: '冻结Case已变化，请重新预览' } } : undefined)
  const id = (await f.rpc('session', { task: '创建变体' })).value.session_id
  const rejected = await f.execute(id, 'agents', 'compute-variants/create', { parent_experiment_id: 'EXP-basic-001' })
  assert.equal(rejected.ok, false)
  assert.equal((await f.status(id)).proposals.length, 0)
  assert.equal(f.calls.some(call => call.endpoint === 'agents/compute-variants/create'), false)
  invalidPreview = false
  const operation = f.execute(id, 'agents', 'compute-variants/create', { parent_experiment_id: 'EXP-basic-001' })
  const proposed = await f.proposal(id)
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  const receipt = await operation
  assert.equal(receipt.state, 'failed'); assert.equal(receipt.result.error.code, 'conflict')
})

test('助手不伪造变体人员复核，决策抽取会话也不能借新动作扩权', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', { task: '讨论变体' })).value.session_id
  await assert.rejects(() => f.execute(id, 'agents', 'compute-variants/confirm', { human_confirmed: true }), /未知的领域操作/)
  await assert.rejects(() => f.execute(id, 'agents', 'compute-variants/create', { human_confirmed: true }), /人员复核/)
  const extraction = (await f.rpc('session', { task: '抽取决策', context: { skill: 'decision-sample-extraction', run_id: 'run-fixed' } })).value.session_id
  for (const action of ['context', 'preview', 'compare', 'create']) await assert.rejects(() => f.execute(extraction, 'agents', `compute-variants/${action}`, { run_id: 'run-fixed' }), /决策样本任务仅允许/)
  assert.equal(f.calls.length, 0)
})


test('MCP 草稿复用真实结构校验，无效包装在提案前拒绝', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', { task: '新增只读组合', context: { skill: 'mcp-composition' } })).value.session_id
  const draft = { toolName: 'basic_read', title: '基础查询', description: '仅基础模拟数据', connectionId: 'mock-basic' }
  await assert.rejects(() => f.execute(id, 'mcp', 'saveCompositionDraft', { revision: 'before', draft: { config: draft, graph: {} } }), /工具名称/)
  assert.equal((await f.status(id)).proposals.length, 0)
  const operation = f.execute(id, 'mcp', 'saveCompositionDraft', { revision: 'before', draft })
  const proposed = await f.proposal(id)
  assert.deepEqual(proposed.input.draft, draft)
  assert.equal(f.calls.length, 0, '确认前不得保存')
  await f.rpc('confirm', { session_id: id, proposal_id: proposed.id })
  const result = await operation
  assert.equal(result.state, 'completed')
  assert.equal(result.preview, undefined)
  assert.equal(f.calls.filter(call => call.endpoint === 'mcp/saveCompositionDraft').length, 1)
})
