import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'
import { BUILD_PLACEHOLDER, HOME_SUBTITLE, PLATFORM_SLOGAN, homeTaskRequest } from '../src/home-entry.ts'
import { createPlatformUpdates } from '../src/realtime/client.ts'

const require = createRequire(import.meta.url)
const compile = async entry => (await build({ entryPoints: [new URL(entry, import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', loader: { '.svg': 'dataurl' }, external: ['react', 'react/jsx-runtime', 'react-dom/server'] })).outputFiles[0].text
const homeSource = await compile('../src/home.tsx'), loginSource = await compile('../src/login.tsx')
const experiment = 'EXP-alpha-001-r123456abcdef'
const runId = 'run-12345678-1234-4234-8234-123456789abc'
function home({ example = false, exampleCase = true, exampleExtra = false, exampleActive = 'EXP-daily-inspection-assistant-002-r222222222222', noRuns = false, runVerdict = 'failed', runStatus = 'completed', failStart = false, intercept } = {}) {
  const states = [], dependencies = [], cleanups = [], calls = [], tasks = [], navigations = []
  let cursor = 0, effects = [], changed = false, tree
  const react = { ...require('react'),
    useRef(initial) { const key = cursor++; if (!(key in states)) states[key] = { current: initial }; return states[key] },
    useState(initial) { const key = cursor++; if (!(key in states)) states[key] = initial; return [states[key], next => { const value = typeof next === 'function' ? next(states[key]) : next; if (!Object.is(states[key], value)) { states[key] = value; changed = true } }] },
    useEffect(effect, values) { const key = cursor++; if (!dependencies[key] || values.some((value, at) => value !== dependencies[key][at])) { dependencies[key] = values; effects.push(() => { cleanups[key]?.(); cleanups[key] = effect() }) } },
    useSyncExternalStore(_subscribe, get) { return get() },
  }
  react.useLayoutEffect = react.useEffect
  const module = { exports: {} }
  vm.runInNewContext(homeSource, { module, exports: module.exports, Error, require: name => name === 'react' ? react : require(name) })
  const inventory = { root: '/test-assets', observed_at: '2026-10-16T00:00:00Z', agents: [{ id: 'alpha' }, ...(example ? [{ id: 'daily-inspection-assistant' }] : [])], experiments: [], runs: [] }
  const updates = createPlatformUpdates()
  const props = { catalog: { subscribe() { return () => {} }, getSnapshot() { return { status: 'ready', inventory } }, refresh: async () => {} },
    updates, navigate: target => navigations.push(target),
    startConversation: async (root, prompt, context) => { if (failStart) throw new Error('会话服务暂不可用'); tasks.push({ root, prompt, context }) },
    rpc: { call: async (_channel, method, body) => {
      calls.push({ method, body })
      const intercepted = intercept?.(method, body)
      if (intercepted !== undefined) return await intercepted
      if (method === 'home') return { ok: true, value: { recent_runs: noRuns ? [] : [{ id: runId, agent_id: 'alpha', experiment_id: experiment, status: runStatus, effective_verdict: runVerdict, created_at: '2026-10-16T00:00:00Z' }], instances: { ok: true, value: { instances: [] } }, mcp: { ok: true, value: { connections: [] } } } }
      if (method === 'agents/list') return { ok: true, value: { agents: [{ id: 'alpha', name: '行业简报助手' }] } }
      if (method === 'agents/detail') return { ok: true, value: { agent: { id: body.agent_id, manifest: { active_experiment: body.agent_id === 'daily-inspection-assistant' ? exampleActive : body.experiment_id || experiment } }, experiment: { id: body.experiment_id || experiment }, selection: { basis: body.experiment_id ? 'explicit' : 'active_experiment' }, versions: [{ id: body.experiment_id || experiment }], evaluation: { cases: body.agent_id === 'daily-inspection-assistant' ? exampleCase ? [{ id: 'U-ASSET-PAGES-001' }] : [] : [{ id: 'U-BUSINESS-001' }] } } }
      if (method === 'agents/tasks/capabilities') return { ok: true, value: { sources: [{ source: 'experiment:EXP-daily-inspection-assistant-001-r111111111111', experiment_id: 'EXP-daily-inspection-assistant-001-r111111111111', plugins: [] }, { source: 'experiment:EXP-daily-inspection-assistant-002-r222222222222', experiment_id: 'EXP-daily-inspection-assistant-002-r222222222222', plugins: [{ plugin_names: ['/opt/dsh-managed/task-example-tools.mjs'] }] }, ...(exampleExtra ? [{ source: 'experiment:EXP-daily-inspection-assistant-003-r333333333333', experiment_id: 'EXP-daily-inspection-assistant-003-r333333333333', plugins: [{ plugin_names: ['/opt/dsh-managed/task-example-tools.mjs'] }] }] : [])] } }
      throw new Error(`unexpected RPC ${method}`)
    } },
  }
  function render() { let iteration = 0; do { if (++iteration > 30) throw new Error('render loop'); cursor = 0; effects = []; changed = false; tree = module.exports.HomePage(props); effects.forEach(effect => effect()) } while (changed); return tree }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(item => nodes(item)); if (!value || typeof value !== 'object') return []; return [value, ...nodes(value.props?.children)] }
  function text(value) { if (!arguments.length) value = tree; return Array.isArray(value) ? value.map(item => text(item)).join('') : value && typeof value === 'object' ? text(value.props?.children ?? '') : String(value ?? '') }
  const button = title => nodes().find(node => node.type === 'button' && text(node).trim().replace(' →', '') === title)
  const label = title => nodes().find(node => node.props?.['aria-label'] === title)
  async function settle() { for (let step = 0; step < 8; step++) { render(); await new Promise(resolve => setImmediate(resolve)) }; render() }
  const change = (title, value) => { label(title).props.onChange({ target: { value } }); render() }
  const click = async title => { const found = button(title); assert.ok(found, `missing button ${title}`); await found.props.onClick?.(); await settle() }
  const submit = async () => { nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle() }
  render()
  return { settle, nodes, text, calls, tasks, navigations, button, label, change, click, submit, invalidate: updates.invalidate, cleanup: () => cleanups.forEach(cleanup => cleanup?.()) }
}

test('首页准确展示业务标题、副标题、构建示例，登录承接品牌口号', async () => {
  const ui = home()
  try { await ui.settle(); assert.match(ui.text(), /让AI帮您管理、评测和改进智能体/); assert.ok(ui.text().includes(HOME_SUBTITLE)); assert.equal(ui.label('业务任务').props.placeholder, BUILD_PLACEHOLDER); assert.equal(ui.label('业务任务').props.rows, 1); assert.equal(ui.button('开始任务').props.disabled, true); assert.equal(ui.text().includes(PLATFORM_SLOGAN), false) } finally { ui.cleanup() }
  const module = { exports: {} }; vm.runInNewContext(loginSource, { module, exports: module.exports, require })
  assert.match(module.exports.loginPage('/hep/login'), /让智能体真正可用，持续变好。/)
})

test('构建入口保留需求原文并绑定task-builder，空输入和会话失败不假跳转', async () => {
  const ui = home()
  try {
    await ui.submit(); assert.equal(ui.tasks.length, 0); assert.match(ui.text(), /请先描述/)
    ui.change('业务任务', '构建每天生成行业情报简报的智能体。'); await ui.submit()
    assert.equal(ui.tasks[0].prompt, '构建每天生成行业情报简报的智能体。'); assert.equal(ui.tasks[0].context.skill, 'task-builder'); assert.equal(ui.tasks[0].context.entry_intent, 'build'); assert.deepEqual(ui.navigations, ['conversations'])
  } finally { ui.cleanup() }
  const failed = home({ failStart: true })
  try { failed.change('业务任务', '构建报告助手'); await failed.submit(); assert.match(failed.text(), /会话服务暂不可用/); assert.equal(failed.navigations.length, 0) } finally { failed.cleanup() }
})

test('评测入口实际读取目标和当前启用版本，带现有业务用例进入评测流程', async () => {
  const ui = home()
  try {
    await ui.click('评测已有智能体'); ui.change('要评测的智能体', 'alpha'); await ui.settle(); assert.equal(ui.button('开始评测').props.disabled, false)
    await ui.submit(); assert.equal(ui.tasks[0].context.workflow, 'evaluation'); assert.equal(ui.tasks[0].context.agent_id, 'alpha'); assert.equal(ui.tasks[0].context.experiment_id, experiment); assert.deepEqual(Array.from(ui.tasks[0].context.evaluation_case_ids), ['U-BUSINESS-001'])
    assert.equal(ui.calls.some(call => call.method === 'agents/detail' && call.body.agent_id === 'alpha'), true)
  } finally { ui.cleanup() }
})

test('首页按实际业务域刷新，助手事件不重复读取资产，实例和MCP变化只刷新摘要', async () => {
  const ui = home()
  try {
    await ui.click('评测已有智能体'); ui.change('要评测的智能体', 'alpha'); await ui.settle()
    const count = method => ui.calls.filter(call => call.method === method).length
    const initial = ['home', 'agents/list', 'agents/detail'].map(count)
    for (let index = 0; index < 5; index++) { ui.invalidate(['assistant']); await ui.settle() }
    assert.deepEqual(['home', 'agents/list', 'agents/detail'].map(count), initial)
    for (const domain of ['instances', 'mcp']) { ui.invalidate([domain]); await ui.settle() }
    assert.deepEqual(['home', 'agents/list', 'agents/detail'].map(count), [initial[0] + 2, initial[1], initial[2]])
    for (const domain of ['agents', 'catalog']) { ui.invalidate([domain]); await ui.settle() }
    assert.deepEqual(['home', 'agents/list', 'agents/detail'].map(count), [initial[0] + 4, initial[1] + 2, initial[2] + 2])
  } finally { ui.cleanup() }
})

test('同版本后台更新保持可操作，切换版本仍等待真实回读且忽略旧目标迟到响应', async () => {
  let hold = false
  const pending = []
  const ui = home({ intercept(method, body) {
    if (hold && method === 'agents/detail') return new Promise(resolve => pending.push({ body, resolve }))
  } })
  const reply = body => ({ ok: true, value: { agent: { id: body.agent_id }, experiment: { id: body.experiment_id }, versions: [{ id: body.experiment_id }], evaluation: { cases: [{ id: 'U-BUSINESS-001' }] } } })
  try {
    await ui.click('评测已有智能体'); ui.change('要评测的智能体', 'alpha'); await ui.settle()
    hold = true; ui.invalidate(['agents']); await ui.settle()
    assert.equal(pending.length, 1); assert.equal(ui.label('要评测的版本').props.disabled, false); assert.equal(ui.button('开始评测').props.disabled, false)
    await ui.submit(); assert.equal(ui.tasks[0].context.experiment_id, experiment)
    const next = 'EXP-alpha-002-r123456abcdef'
    ui.change('要评测的版本', next); await ui.settle()
    assert.equal(pending.length, 2); assert.equal(ui.button('开始评测').props.disabled, true)
    await ui.submit(); assert.equal(ui.tasks.length, 1); assert.match(ui.text(), /请先选择并读完/)
    pending[0].resolve(reply(pending[0].body)); await ui.settle()
    assert.equal(ui.label('要评测的版本').props.value, next); assert.equal(ui.button('开始评测').props.disabled, true)
    pending[1].resolve(reply(pending[1].body)); await ui.settle()
    assert.equal(ui.button('开始评测').props.disabled, false)
    await ui.submit(); assert.equal(ui.tasks[1].context.experiment_id, next)
  } finally { ui.cleanup() }
})

test('改进入口包含completed但业务失败的Run，并固定原始Run与三轮预算', async () => {
  const ui = home()
  try {
    await ui.click('改进优化任务'); ui.change('关联的运行记录', runId); await ui.submit()
    assert.equal(ui.tasks[0].context.run_id, runId); assert.equal(ui.tasks[0].context.experiment_id, experiment); assert.equal(ui.tasks[0].context.max_repair_rounds, 3); assert.match(ui.tasks[0].prompt, /保留原始证据/)
  } finally { ui.cleanup() }
  assert.equal(homeTaskRequest('improve', '').context.workflow, 'improvement')
})

test('体验示例只选择带实际工具和业务Case的来源，缺依赖时明确引导构建', async () => {
  const ui = home({ example: true })
  try {
    await ui.click('体验示例'); assert.ok(ui.button('开始体验')); await ui.click('开始体验')
    const context = ui.tasks[0].context; assert.equal(context.source, 'experiment:EXP-daily-inspection-assistant-002-r222222222222'); assert.equal(context.source_kind, 'basic_mock'); assert.deepEqual(Array.from(context.evaluation_case_ids), ['U-ASSET-PAGES-001']); assert.match(ui.tasks[0].prompt, /不称为真实设备健康检测/)
  } finally { ui.cleanup() }
  for (const options of [{ example: false }, { example: true, exampleCase: false }]) {
    const missing = home(options)
    try { await missing.click('体验示例'); assert.equal(missing.button('开始体验'), undefined); assert.match(missing.text(), /尚未安装带工具的巡检示例/); await missing.click('构建一个基础示例'); assert.match(missing.label('业务任务').props.value, /不连接外部设备/); assert.equal(missing.tasks.length, 0) } finally { missing.cleanup() }
  }
})


test('多版本示例默认使用具工具和Case的启用来源，版本切换可选且启动前回读', async () => {
  const active = 'EXP-daily-inspection-assistant-003-r333333333333'
  for (const selectedActive of [active, null, 'EXP-daily-inspection-assistant-001-r111111111111']) {
    const ui = home({ example: true, exampleExtra: true, exampleActive: selectedActive })
    try {
      await ui.click('体验示例')
      const expected = selectedActive === active ? active : 'EXP-daily-inspection-assistant-002-r222222222222'
      assert.equal(ui.label('巡检示例版本').props.value, `experiment:${expected}`)
      assert.equal(ui.button('开始体验').props.disabled, false)
      assert.equal(ui.label('可选示例版本').type, 'details'); assert.equal(ui.label('可选示例版本').props.open, undefined)
      if (selectedActive === active) assert.match(ui.text(), /版本 003（当前启用）/)
      const before = ui.calls.filter(call => call.method === 'agents/detail' && call.body.experiment_id === expected).length
      await ui.click('开始体验')
      assert.equal(ui.tasks[0].context.source, `experiment:${expected}`)
      assert.equal(ui.calls.filter(call => call.method === 'agents/detail' && call.body.experiment_id === expected).length, before + 1)
    } finally { ui.cleanup() }
  }
  const ui = home({ example: true, exampleExtra: true, exampleActive: active })
  try {
    await ui.click('体验示例'); ui.change('巡检示例版本', 'experiment:EXP-daily-inspection-assistant-002-r222222222222')
    await ui.click('开始体验'); assert.equal(ui.tasks[0].context.experiment_id, 'EXP-daily-inspection-assistant-002-r222222222222')
  } finally { ui.cleanup() }
})


test('首页输入时保持换行与IME行为，Ctrl+Enter仍提交当前模式草稿', async () => {
  const ui = home()
  try {
    await ui.settle(); ui.change('业务任务', '第一行\n第二行')
    let prevented = 0
    const event = (ctrlKey, composing) => ({ key: 'Enter', ctrlKey, nativeEvent: { isComposing: composing }, preventDefault() { prevented++ } })
    ui.label('业务任务').props.onKeyDown(event(false, false)); await ui.settle()
    ui.label('业务任务').props.onKeyDown(event(true, true)); await ui.settle()
    assert.equal(prevented, 0); assert.equal(ui.tasks.length, 0)
    ui.label('业务任务').props.onKeyDown(event(true, false)); await ui.settle()
    assert.equal(prevented, 1); assert.equal(ui.tasks.length, 1); assert.equal(ui.tasks[0].prompt, '第一行\n第二行')
  } finally { ui.cleanup() }
})


test('改进优化以任务描述为主，无运行记录也可开始，已有通过记录可选关联', async () => {
  for (const options of [{ noRuns: true }, { runStatus: 'running' }, { runVerdict: 'passed' }]) {
    const ui = home(options)
    try {
      await ui.click('改进优化任务')
      const association = ui.nodes().find(node => node.type === 'details' && ui.text(node).includes('关联运行记录（可选）'))
      assert.ok(association); assert.equal(association.props.open, undefined)
      if (options.runStatus === 'running') assert.equal(ui.nodes().some(node => node.type === 'option' && node.props.value === runId), false)
      assert.equal(ui.button('开始改进').props.disabled, false)
      await ui.submit(); assert.match(ui.tasks[0].prompt, /查询当前工作区/); assert.equal(ui.tasks[0].context.run_id, undefined); assert.equal(ui.tasks[0].context.source, undefined)
      ui.change('业务任务', '优化行业简报，减少重复信息并保留来源。'); await ui.submit()
      assert.equal(ui.tasks[1].prompt, '优化行业简报，减少重复信息并保留来源。')
      assert.equal(ui.tasks[1].context.entry_intent, 'improve'); assert.equal(ui.tasks[1].context.agent_id, undefined)
      await ui.click('构建业务智能体'); ui.change('业务任务', '构建草稿'); await ui.click('改进优化任务')
      assert.equal(ui.label('业务任务').props.value, '优化行业简报，减少重复信息并保留来源。')
      if (!options.noRuns && options.runStatus !== 'running') {
        ui.change('关联的运行记录', runId); await ui.submit()
        assert.equal(ui.tasks.at(-1).context.run_id, runId); assert.equal(ui.tasks.at(-1).context.source, `experiment:${experiment}`)
      }
    } finally { ui.cleanup() }
  }
})
