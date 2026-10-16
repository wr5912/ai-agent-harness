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
    beforeModelCall: id => assistant.beforeModelCall(id),
    async reload() { await assistant.dispose(); assistant = create() } }
}

function taskPlan(overrides = {}) {
  return { goal: '检查三台设备并交付完整报告', agent_id: 'test-agent', source: 'experiment:EXP-test-agent-001',
    evaluation_case_ids: ['U-BUSINESS-001'], deliverables: ['设备巡检报告'], instance_name: 'test-delivery',
    allowed_actions: [{ domain: 'agents', action: 'edit/apply' }, { domain: 'agents', action: 'eval/start' }, { domain: 'instances', action: 'run' }], ...overrides }
}
function installTaskGoals(f) {
  const goals = new Map()
  f.services.goals = {
    get(agent) { return goals.get(agent.id) },
    create(agent, request) { const row = { id: 'native-goal', revision: 1, phase: 'active', activation: 'armed', ...request }; goals.set(agent.id, row); return row },
    pause(agent) { const row = { ...goals.get(agent.id), revision: goals.get(agent.id).revision + 1, phase: 'paused', activation: 'disarmed' }; goals.set(agent.id, row); return row },
    resume(agent) { const row = { ...goals.get(agent.id), revision: goals.get(agent.id).revision + 1, phase: 'active', activation: 'armed' }; goals.set(agent.id, row); return row },
    complete(agent) { const row = { ...goals.get(agent.id), revision: goals.get(agent.id).revision + 1, phase: 'complete', activation: 'disarmed' }; goals.set(agent.id, row); return row },
  }
  return goals
}
async function beginTask(f, id, plan = taskPlan()) {
  const operation = f.execute(id, 'task', 'start', { plan })
  const proposal = await f.proposal(id)
  const confirmed = await f.rpc('confirm', { session_id: id, proposal_id: proposal.id })
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed))
  await operation
  assert.equal((await f.status(id)).execution.state, 'running')
}
function taskResponder(endpoint, input) {
  if (endpoint === 'agents/detail') return { ok: true, value: { experiment: { id: 'EXP-test-agent-001' }, evaluation: { sha256: 'fixed-evaluation', cases: [{ id: 'U-BUSINESS-001' }] }, derivation: { parent_ref: 'git:' + 'a'.repeat(40) } } }
  if (endpoint === 'agents/eval/start') return { ok: true, value: { job_id: 'job-' + Math.random(), status: 'running' } }
  if (endpoint === 'agents/eval/status') return { ok: true, value: { status: 'completed', run_id: 'run-own' } }
  if (endpoint === 'agents/tasks/delivery') return { ok: true, value: { ready: false, checks: [{ name: '业务统计', ok: false }] } }
}

test('尚未确认任务的原生status返回对象，不触发工具输出schema错误或创建任务', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', { task: '先了解当前任务' })).value.session_id
  const result = await f.execute(id, 'task', 'status')
  assert.equal(f.tools.get('platform_task').output.schema.type, 'object')
  assert.equal(typeof result, 'object'); assert.equal(result.state, 'not_started')
  assert.equal((await f.status(id)).execution, undefined)
  assert.equal((await f.status(id)).proposals.length, 0)
  assert.equal(f.calls.length, 0)
})

test('任务一次确认后仅向固定目标连续执行，初测不计轮次且第四轮修复被拒绝', async t => {
  const f = fixture(t, taskResponder)
  const goals = installTaskGoals(f)
  const id = (await f.rpc('session', { task: '构建巡检助手', context: { skill: 'task-builder' } })).value.session_id
  await beginTask(f, id)
  for (const action of ['preview', 'start']) await assert.rejects(() => f.execute(id, 'task', action, { plan: taskPlan() }), /已有未结束任务/)
  assert.equal((await f.status(id)).proposals.length, 1, '活动任务重复 start 不再产生第二张无效确认卡')
  assert.equal(goals.get(id).maxGoalRounds, 60)
  await assert.rejects(() => f.execute(id, 'task', 'begin-repair'), /初次评测/)
  await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
  assert.equal((await f.status(id)).execution.repair_rounds, 0)
  await assert.rejects(() => f.execute(id, 'agents', 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/dsh/workspace/AGENTS.md', content: 'fix' }] }), /预留/)
  for (let round = 1; round <= 3; round++) {
    await f.execute(id, 'task', 'begin-repair')
    assert.equal((await f.execute(id, 'agents', 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/dsh/workspace/AGENTS.md', content: `fix ${round}` }] })).state, 'completed')
    await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
    assert.equal((await f.status(id)).execution.repair_rounds, round)
  }
  await assert.rejects(() => f.execute(id, 'task', 'begin-repair'), /最多三轮/)
  await assert.rejects(() => f.execute(id, 'agents', 'cases/update', { experiment_id: 'EXP-test-agent-001' }), /冻结/)
  assert.equal(f.calls.filter(row => row.endpoint === 'agents/eval/start').length, 4)
  assert.equal((await f.status(id)).proposals.length, 1)
})

test('真实Session持久记模型调用，暂停及冷恢复不重置额度，fork不继承执行权', async t => {
  const f = fixture(t, taskResponder)
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '构建巡检助手' })).value.session_id
  await f.beforeModelCall(id)
  await beginTask(f, id, taskPlan({ budget: { max_model_calls: 3, max_repair_rounds: 3, timeout_minutes: 30 } }))
  assert.equal((await f.status(id)).execution.model_calls, 1)
  await f.beforeModelCall(id)
  await f.rpc('task/pause', { session_id: id })
  const deadline = (await f.status(id)).execution.deadline_at
  await assert.rejects(() => f.beforeModelCall(id), /尚未恢复/)
  assert.equal((await f.rpc('task/resume', { session_id: id })).ok, true)
  await f.reload()
  assert.equal((await f.status(id)).execution.state, 'paused')
  assert.equal((await f.status(id)).execution.model_calls, 2)
  assert.equal((await f.rpc('task/resume', { session_id: id })).ok, true)
  await f.beforeModelCall(id)
  await assert.rejects(() => f.beforeModelCall(id), /额度已耗尽/)
  assert.equal((await f.status(id)).execution.state, 'budget_exhausted')
  assert.equal((await f.status(id)).execution.model_calls, 3)
  assert.equal((await f.status(id)).execution.deadline_at, deadline)
  f.addSession('task-fork', '/project', f.sessions.get(id).events, id)
  assert.equal((await f.status('task-fork')).execution, undefined)
  await assert.rejects(() => f.execute('task-fork', 'task', 'begin-repair'), /没有已确认任务/)
})

test('交付必须引用本任务Run并通过服务侧核验，模型ready不能覆盖失败', async t => {
  const f = fixture(t, taskResponder)
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '交付报告' })).value.session_id
  await beginTask(f, id)
  await assert.rejects(() => f.execute(id, 'task', 'deliver', { run_id: 'run-other', ready: true, artifacts: ['report.md'] }), /本任务实际启动/)
  await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
  assert.equal((await f.execute(id, 'task', 'deliver', { run_id: 'run-own', ready: true, artifacts: ['report.md'] })).state, 'verification_failed')
  assert.equal((await f.status(id)).execution.state, 'running')
})

test('首次创建把已确认业务Case传给真实new入口，回执一次绑定目标和评判摘要', async t => {
  const f = fixture(t, (endpoint, input) => endpoint === 'agents/new' ? { ok: true, value: { source_id: 'experiment:EXP-test-agent-001', experiment_id: 'EXP-test-agent-001' } } : taskResponder(endpoint, input))
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '创建巡检助手' })).value.session_id
  await beginTask(f, id, taskPlan({ source: undefined, new_agent: { name: '设备巡检', description: '只读设备检查', role: '完整统计工具数据', evaluation_cases: [{ id: 'U-BUSINESS-001', title: '设备完整', inputs: '检查三台设备', expected_behavior: '包含全部设备且总数3' }] }, allowed_actions: [{ domain: 'agents', action: 'new' }] }))
  await f.execute(id, 'agents', 'new', { agent_id: 'test-agent', role: '丢弃业务要求' })
  assert.equal(f.calls.find(row => row.endpoint === 'agents/new').input.role, '完整统计工具数据')
  assert.equal((await f.status(id)).execution.target_source, 'experiment:EXP-test-agent-001')
  assert.equal((await f.status(id)).execution.evaluation_sha256, 'fixed-evaluation')
})

test('不可保存的新建Case在preview和start前被拒绝，不产生确认卡或执行任务', async t => {
  const f = fixture(t)
  const goals = installTaskGoals(f)
  const id = (await f.rpc('session', { task: '新建巡检助手并测试完整分页与漏页' })).value.session_id
  const business = { id: 'U-ASSET-PAGES-001', title: '完整分页', inputs: '读取全部分页', expected_behavior: '覆盖五台模拟设备' }
  const invalidCases = [
    [{ ...business, id: 'U-IDENTITY-001' }],
    [{ ...business, id: 'U-ROLE-001' }],
    [business, business],
    [{ ...business, title: '完整分页\n额外标题' }],
    [{ ...business, expected_behavior: '覆盖全部设备\n# 额外用例' }],
    Array.from({ length: 31 }, (_, i) => ({ ...business, id: `U-BUSINESS-${i}` })),
    [{ ...business, inputs: '设备'.repeat(5000) }],
  ]
  for (const evaluation_cases of invalidCases) {
    const plan = taskPlan({ source: undefined, evaluation_case_ids: [evaluation_cases[0].id], new_agent: { name: '巡检助手', description: '统计模拟台账', role: '读取实际工具数据', evaluation_cases } })
    for (const action of ['preview', 'start']) await assert.rejects(() => f.execute(id, 'task', action, { plan }))
    assert.equal((await f.rpc('task/start', { session_id: id, input: { plan } })).ok, false)
  }
  const state = await f.status(id)
  assert.equal(state.proposals.length, 0)
  assert.equal(state.execution, undefined)
  assert.equal(goals.size, 0)
  assert.equal(f.calls.length, 0)
})

test('新建业务Case可选择平台自动身份回归，不重复定义基础Case', async t => {
  const business = { id: 'U-BUSINESS-001', title: '完整设备', inputs: '读取全部分页', expected_behavior: '覆盖五台模拟设备' }
  const f = fixture(t, (endpoint, input) => {
    if (endpoint === 'agents/new') return { ok: true, value: { source_id: 'experiment:EXP-test-agent-001', experiment_id: 'EXP-test-agent-001' } }
    if (endpoint === 'agents/detail') return { ok: true, value: { experiment: { id: 'EXP-test-agent-001' }, evaluation: { sha256: 'fixed-evaluation', cases: [business, { id: 'U-IDENTITY-001' }, { id: 'U-ROLE-001' }] } } }
    return taskResponder(endpoint, input)
  })
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '创建巡检助手，保留身份回归' })).value.session_id
  await beginTask(f, id, taskPlan({ source: undefined, evaluation_case_ids: [business.id, 'U-IDENTITY-001', 'U-ROLE-001'], new_agent: { name: '巡检助手', description: '统计模拟台账', role: '读取实际工具数据', evaluation_cases: [business] }, allowed_actions: [{ domain: 'agents', action: 'new' }] }))
  await f.execute(id, 'agents', 'new', { agent_id: 'test-agent' })
  assert.equal((await f.status(id)).execution.target_source, 'experiment:EXP-test-agent-001')
  assert.deepEqual(f.calls.find(row => row.endpoint === 'agents/new').input.evaluation_cases, [{ ...business, fast: false }])
})

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

test('回退只恢复本任务实际修改文件，固定来源与当前摘要不匹配时拒绝覆盖', async t => {
  const original = '# 已固定的设备巡检\n', edited = '# 本轮修改\n'
  let content = original
  const sha = async text => (await import('node:crypto')).createHash('sha256').update(text).digest('hex')
  const f = fixture(t, async (endpoint, input) => {
    if (endpoint === 'agents/edit/read') return { ok: true, value: { content, sha256: await sha(content) } }
    if (endpoint === 'agents/assets/read-fixed') return { ok: true, value: { selected: { kind: 'text', content: original, sha256: await sha(original), truncated: false } } }
    if (endpoint === 'agents/edit/apply') { content = input.edits[0].content; return { ok: true, value: { written: [{ path: input.edits[0].path, sha256: await sha(content) }] } } }
    return taskResponder(endpoint, input)
  })
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '改进巡检' })).value.session_id
  await beginTask(f, id)
  await f.execute(id, 'agents', 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'evolution/experiments/EXP-test-agent-001/candidate/dsh/workspace/AGENTS.md', content: edited, expected_sha256: await sha(original) }] })
  assert.equal((await f.status(id)).execution.operations[0].input.edits[0].path, 'candidate/dsh/workspace/AGENTS.md')
  content = '# 用户并行修改\n'
  await assert.rejects(() => f.execute(id, 'task', 'rollback'), /并行改动/)
  assert.equal(content, '# 用户并行修改\n')
  content = edited
  const restored = await f.execute(id, 'task', 'rollback')
  assert.equal(restored.state, 'rolled_back')
  assert.equal(content, original)
  assert.equal((await f.status(id)).execution.state, 'paused')
  assert.equal((await f.status(id)).execution.operations[0].state, 'rolled_back')
})

test('装配与编辑共用修复轮次守卫，不能通过assembly跳过初测后的预留', async t => {
  const f = fixture(t, taskResponder)
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '装配巡检' })).value.session_id
  await beginTask(f, id, taskPlan({ allowed_actions: [{ domain: 'agents', action: 'tasks/assembly-apply' }, { domain: 'agents', action: 'eval/start' }] }))
  await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
  await assert.rejects(() => f.execute(id, 'agents', 'tasks/assembly-apply', { target_source: 'experiment:EXP-test-agent-001', files: [] }), /预留/)
  assert.equal(f.calls.filter(row => row.endpoint === 'agents/tasks/assembly-apply').length, 0)
})

test('确认前固定父版变化时拒绝开始，不能静默换成新HEAD', async t => {
  let parent = 'a'.repeat(40)
  const f = fixture(t, (endpoint, input) => {
    const value = taskResponder(endpoint, input)
    if (endpoint === 'agents/detail') value.value.derivation.parent_ref = `git:${parent}`
    return value
  })
  const goals = installTaskGoals(f)
  const id = (await f.rpc('session', { task: '从固定版本改进' })).value.session_id
  const waiting = f.execute(id, 'task', 'start', { plan: taskPlan() })
  const proposal = await f.proposal(id)
  parent = 'b'.repeat(40)
  const confirmed = await f.rpc('confirm', { session_id: id, proposal_id: proposal.id })
  assert.equal(confirmed.ok, false)
  assert.match(confirmed.error.message, /固定父版/)
  await waiting
  assert.equal((await f.status(id)).execution, undefined)
  assert.equal(goals.size, 0)
})

test('未知评测回执从预留operation_id读取真实Job后可显式恢复，不重复启动', async t => {
  let jobId
  const f = fixture(t, (endpoint, input) => {
    if (endpoint === 'agents/eval/start') { jobId = input.task_budget.operation_id; throw new Error('外部连接在Job启动后断开') }
    if (endpoint === 'agents/eval/status') return { ok: true, value: { job_id: jobId, source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'], status: 'completed', run_id: 'run-own' } }
    return taskResponder(endpoint, input)
  })
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '可恢复巡检' })).value.session_id
  await beginTask(f, id)
  await assert.rejects(() => f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] }), /断开/)
  assert.equal((await f.status(id)).execution.state, 'unknown')
  assert.equal((await f.rpc('task/resume', { session_id: id })).ok, false)
  assert.equal((await f.rpc('task/checkpoint', { session_id: id })).ok, true)
  assert.equal((await f.status(id)).execution.state, 'paused')
  assert.equal((await f.rpc('task/resume', { session_id: id })).ok, true)
  assert.equal(f.calls.filter(row => row.endpoint === 'agents/eval/start').length, 1)
})

test('长操作仍在等待时暂停立即取消其信号，晚到成功回执保持已暂停且不重发', async t => {
  let release, operationSignal
  const f = fixture(t, (endpoint, input, signal) => {
    if (endpoint === 'agents/tasks/assembly-apply') { operationSignal = signal; return new Promise(resolve => { release = resolve }) }
    return taskResponder(endpoint, input)
  })
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '装配后评测' })).value.session_id
  await beginTask(f, id, taskPlan({ allowed_actions: [{ domain: 'agents', action: 'tasks/assembly-apply' }] }))
  const operation = f.execute(id, 'agents', 'tasks/assembly-apply', { target_source: 'experiment:EXP-test-agent-001', files: [] })
  while (!release) await setImmediate()
  const paused = await Promise.race([f.rpc('task/pause', { session_id: id }), new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 150))])
  assert.equal(paused.ok, true)
  assert.equal(operationSignal.aborted, true)
  assert.equal((await f.status(id)).execution.state, 'paused')
  release({ ok: true, value: { source: 'experiment:EXP-test-agent-001' } })
  await operation
  assert.equal((await f.status(id)).execution.state, 'paused')
  assert.equal((await f.status(id)).execution.operations[0].state, 'completed')
  assert.equal(f.calls.filter(row => row.endpoint === 'agents/tasks/assembly-apply').length, 1)
})

test('业务与评审请求按job去重累计预算，同一status重复查询不重复计费', async t => {
  const f = fixture(t, (endpoint, input) => endpoint === 'agents/eval/status' ? { ok: true, value: { status: 'completed', run_id: 'run-own', actual_model_calls: 7, observed_model_calls: 7, model_calls_complete: true } } : taskResponder(endpoint, input))
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '预算内巡检' })).value.session_id
  await f.beforeModelCall(id)
  await beginTask(f, id)
  const started = await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
  const job = started.result.value.job_id
  await f.execute(id, 'agents', 'eval/status', { job_id: job })
  await f.execute(id, 'agents', 'eval/status', { job_id: job })
  assert.equal((await f.status(id)).execution.model_calls, 8)
  assert.equal((await f.status(id)).execution.assistant_model_calls, 1)
  assert.equal((await f.status(id)).execution.evaluation_usage[job].complete, true)
})

test('任务详情缺省使用固定上下文，绑定目标后优先实际新版本，显式复用来源保持不变', async t => {
  const f = fixture(t, taskResponder)
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '改进所选版本', context: { skill: 'task-builder', agent_id: 'test-agent', experiment_id: 'EXP-test-agent-000' } })).value.session_id
  await f.execute(id, 'agents', 'detail', { agent_id: 'test-agent' })
  assert.equal(f.calls.at(-1).input.experiment_id, 'EXP-test-agent-000')
  await f.execute(id, 'agents', 'detail', { agent_id: 'test-agent', experiment_id: 'EXP-test-agent-002' })
  assert.equal(f.calls.at(-1).input.experiment_id, 'EXP-test-agent-002')
  await beginTask(f, id)
  await f.execute(id, 'agents', 'detail', { agent_id: 'test-agent' })
  assert.equal(f.calls.at(-1).input.experiment_id, 'EXP-test-agent-001')
  const other = (await f.rpc('session', { task: '查看智能体' })).value.session_id
  await f.execute(other, 'agents', 'detail', { agent_id: 'test-agent' })
  assert.equal(f.calls.at(-1).input.experiment_id, undefined)
})

test('助手查询本任务评测在工具内等待实际终态，暂停可中断等待且不重复启动', async t => {
  let polls = 0
  const f = fixture(t, (endpoint, input) => endpoint === 'agents/eval/status'
    ? { ok: true, value: { job_id: input.job_id, status: ++polls === 1 ? 'running' : 'completed', observed_model_calls: 2, model_calls_complete: true } }
    : taskResponder(endpoint, input))
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '等待真实评测' })).value.session_id
  await beginTask(f, id)
  const started = await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
  const input = { job_id: started.result.value.job_id }
  assert.equal((await f.execute(id, 'agents', 'eval/status', input)).result.value.status, 'completed')
  assert.equal(polls, 2)
  assert.equal((await f.status(id)).execution.model_calls, 2)
  polls = 0
  const pending = f.execute(id, 'agents', 'eval/status', input)
  while (polls === 0) await setImmediate()
  await f.rpc('task/pause', { session_id: id })
  await pending
  assert.equal(polls, 1, '暂停后不得继续查询或重发评测')
  assert.equal(f.calls.filter(item => item.endpoint === 'agents/eval/start').length, 1)
  assert.equal(f.calls.some(item => item.endpoint === 'agents/eval/cancel'), true)
})

test('任务不能通过领域delivery入口绕过预算或替换已确认业务判据', async t => {
  const f = fixture(t, taskResponder)
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '交付巡检' })).value.session_id
  await beginTask(f, id)
  await assert.rejects(() => f.execute(id, 'agents', 'tasks/delivery', { required_tool_names: [], expected_device_ids: [] }), /platform_task deliver/)
  assert.equal(f.calls.filter(row => row.endpoint === 'agents/tasks/delivery').length, 0)
})

test('所有平台工具回执元信息保留真实动作与定位字段，不重复附带文件正文', t => {
  const f = fixture(t)
  const value = f.tools.get('platform_agents').output.presentationMeta({ action: 'edit/apply', input: { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/dsh/workspace/AGENTS.md', content: '无需重复传入的正文' }] } }, { kind: 'platform-operation', domain: 'agents', action: 'edit/apply', state: 'completed', result: { ok: true, value: { updated: 1 } } })
  assert.equal(value.action, 'edit/apply')
  assert.equal(value.input.experiment_id, 'EXP-test-agent-001')
  assert.equal(value.input.edits[0].path, 'candidate/dsh/workspace/AGENTS.md')
  assert.equal(value.input.edits[0].content, undefined)
  const preview = f.tools.get('platform_task').output.presentationMeta({ action: 'preview', input: {} }, { plan: { goal: '基本任务' } })
  assert.equal(preview.domain, 'task'); assert.equal(preview.action, 'preview')
})

test('用户可仅拒绝当前未执行提案，结算原工具但不取消其他提案或执行写入', async t => {
  const f = fixture(t)
  const id = (await f.rpc('session', { task: '核对两项实例操作' })).value.session_id
  const first = f.execute(id, 'instances', 'run', { name: 'first', operation: 'stop' })
  const proposal = await f.proposal(id)
  const second = f.execute(id, 'instances', 'run', { name: 'second', operation: 'stop' })
  while ((await f.status(id)).proposals.length < 2) await setImmediate()
  assert.equal((await f.rpc('reject', { session_id: id, proposal_id: proposal.id })).ok, true)
  assert.equal((await first).state, 'cancelled')
  assert.equal(f.calls.some(call => call.endpoint === 'instances/run'), false)
  const remaining = (await f.status(id)).proposals.find(item => item.id !== proposal.id)
  assert.equal(remaining.state, 'awaiting_confirmation')
  await f.rpc('confirm', { session_id: id, proposal_id: remaining.id })
  await second
  assert.equal(f.calls.filter(call => call.endpoint === 'instances/run').length, 1)
  assert.equal((await f.rpc('reject', { session_id: id, proposal_id: remaining.id })).ok, false)
})

test('暂停跨过截止后恢复持久记录预算耗尽，不更换原任务、额度、截止或操作', async t => {
  const f = fixture(t, taskResponder)
  installTaskGoals(f)
  const id = (await f.rpc('session', { task: '有总时限的交付任务' })).value.session_id
  await f.beforeModelCall(id)
  await beginTask(f, id)
  await f.execute(id, 'agents', 'eval/start', { source: 'experiment:EXP-test-agent-001', cases: ['U-BUSINESS-001'] })
  await f.rpc('task/pause', { session_id: id })
  const before = (await f.status(id)).execution
  t.mock.method(Date, 'now', () => Date.parse(before.deadline_at) + 1)
  const response = await f.rpc('task/resume', { session_id: id })
  assert.equal(response.ok, false); assert.match(response.error.message, /总时限已耗尽/)
  const after = (await f.status(id)).execution
  assert.equal(after.state, 'budget_exhausted'); assert.match(after.reason, /总时限已耗尽/)
  for (const key of ['id', 'started_at', 'deadline_at', 'model_calls', 'assistant_model_calls', 'repair_rounds']) assert.equal(after[key], before[key])
  assert.deepEqual(after.operations, before.operations)
  assert.equal((await f.rpc('task/resume', { session_id: id })).ok, false)
  assert.equal(f.calls.filter(item => item.endpoint === 'agents/eval/start').length, 1)
})
