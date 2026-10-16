import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const source = (await build({ entryPoints: [new URL('../src/agents/client.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })).outputFiles[0].text

function experiments() {
  return ['first-agent', 'second-agent'].flatMap(agentId => [
    { id: `EXP-${agentId}-001`, agent_id: agentId, status: 'completed', change: { baseline_ref: 'none:first-experiment' } },
    { id: `EXP-${agentId}-002`, agent_id: agentId, change_sha256: 'a'.repeat(64), status: agentId === 'first-agent' ? 'active' : 'completed', change: {
      ...(agentId === 'first-agent' ? { variant_name: '资产告警轻量版' } : {}),
      research_question: `${agentId} 的省算力方案`, parent_experiment_id: `EXP-${agentId}-001`, parent_ref: `git:${'b'.repeat(40)}`,
      variant_kind: 'exploratory', compute_variant: { generation: agentId === 'first-agent' ? { mode: 'langgraph-aot', entry_path: 'dsh/managed/compute-workflow/index.ts', source_run_ids: ['run-22222222-2222-4222-8222-222222222222'] } : undefined },
    } },
  ])
}

function detail(agentId = 'first-agent', experimentId = `EXP-${agentId}-002`) {
  return { agent: { id: agentId, name: `名称 ${agentId}`, manifest: { description: '真实用途' } }, experiment: experiments().find(item => item.id === experimentId),
    versions: experiments().filter(item => item.agent_id === agentId).reverse().map(item => ({ id: item.id, status: item.status, baseline_ref: item.change.baseline_ref })), baseline: { ref: 'none:first-experiment' }, fusion: {}, related_references: [],
    declared: { source_contract: {}, catalog_source: {} }, loaded_instance: { status: 'not_queried' }, features: [],
    verification: { runs: [{ id: 'run-11111111-1111-4111-8111-111111111111', status: 'failed' }] },
    assets: [{ name: 'candidate', path: 'candidate', kind: 'directory', children: [{ name: 'prompt.md', path: 'candidate/prompt.md', kind: 'text' }] }] }
}

function page({ active = true, target, intercept } = {}) {
  const states = [], dependencies = [], cleanups = []
  let cursor = 0, effects = [], changed = false, tree, confirm = false
  const calls = [], contexts = [], navigations = [], assistantTasks = [], listeners = new Map()
  const history = [target ?? { page: 'agents' }]
  const react = { ...require('react'),
    useState(initial) { const at = cursor++; if (!(at in states)) states[at] = initial; return [states[at], value => { const next = typeof value === 'function' ? value(states[at]) : value; if (!Object.is(next, states[at])) { states[at] = next; changed = true } }] },
    useRef(initial) { const at = cursor++; if (!(at in states)) states[at] = { current: initial }; return states[at] },
    useMemo(factory, deps) { const at = cursor++; if (!dependencies[at] || deps.some((value, index) => !Object.is(value, dependencies[at][index]))) { dependencies[at] = deps; states[at] = factory() } return states[at] },
    useEffect(effect, deps) { const at = cursor++; if (!dependencies[at] || deps.some((value, index) => !Object.is(value, dependencies[at][index]))) { dependencies[at] = deps; effects.push(() => { cleanups[at]?.(); cleanups[at] = effect() }) } },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, URL, require: name => name === 'react' ? react : require(name),
    window: { location: { hostname: '127.0.0.1' }, confirm: () => confirm, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: { getElementById: () => ({ focus() {} }) },
  })
  const props = { active, target, onContext: context => contexts.push(context), onNavigate: value => { const { replace, ...destination } = value; navigations.push(value); if (replace) history[history.length - 1] = destination; else history.push(destination); props.target = destination; props.active = value.page === 'agents'; changed = true }, onAssistant: async (task, context) => { assistantTasks.push({ task, context }) },
    rpc: { async call(channel, endpoint, payload) {
      calls.push({ channel, endpoint, payload })
      const override = intercept?.(endpoint, payload)
      if (override !== undefined) return await override
      if (endpoint === 'agents/list') return { ok: true, value: { agents: ['first-agent', 'second-agent'].map(id => ({ id, name: `名称 ${id}`, version_count: 2, latest_experiment_status: 'active', active_experiment: `EXP-${id}-001` })), experiments: experiments() } }
      if (endpoint === 'agents/detail') return { ok: true, value: detail(payload.agent_id, payload.experiment_id) }
      if (endpoint === 'agents/edit/read') return { ok: true, value: { path: payload.path, kind: payload.path === 'candidate' ? 'directory' : 'text', content: '原始正文', sha256: 'a'.repeat(64), size: 12 } }
      if (endpoint === 'agents/edit/apply') return { ok: false, error: { code: 'conflict', message: '内容已变化' } }
      return { ok: true, value: { proposal: null } }
    } },
  }
  function render() { let count = 0; do { if (++count > 30) throw new Error('render loop'); cursor = 0; effects = []; changed = false; tree = module.exports.AgentsPage(props); effects.forEach(effect => effect()) } while (changed); return tree }
  async function settle() { for (let index = 0; index < 5; index++) { await new Promise(resolve => setImmediate(resolve)); render() } }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== 'object') return []; if (typeof value.type === 'function') return nodes(value.type(value.props)); return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))] }
  function text(value) { if (Array.isArray(value)) return value.map(text).join(''); return value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '') }
  const button = name => nodes().find(node => node.type === 'button' && text(node) === name)
  render()
  return { render, settle, nodes, text, button, calls, contexts, navigations, history, assistantTasks, props, listeners, setConfirm: value => { confirm = value } }
}

test('智能体五个任务页签、搜索与默认最新版本保持登记版本独立', async () => {
  const ui = page()
  await ui.settle()
  assert.deepEqual(ui.nodes().filter(node => node.props?.role === 'tab' && node.props.id?.startsWith('agent-tab-')).map(node => ui.text(node)), ['概览', 'Harness 资产', '能力状态', '生成与比较', '运行情况'])
  assert.ok(ui.calls.some(call => call.endpoint === 'agents/detail' && call.payload.agent_id === 'first-agent' && call.payload.experiment_id === undefined))
  assert.match(ui.text(ui.render()), /EXP-first-agent-002/)
  assert.match(ui.text(ui.render()), /登记版本EXP-first-agent-001/)
  const search = ui.nodes().find(node => node.props?.type === 'search')
  search.props.onChange({ target: { value: 'second-agent' } }); ui.render()
  const cards = ui.nodes().filter(node => node.props?.className === 'agent-list-card')
  assert.equal(cards.length, 1)
  assert.match(ui.text(cards[0]), /second-agent/)
  assert.equal(ui.nodes().some(node => node.props?.id === 'agent-panel-evaluation'), false)
})

test('导航精确定位研究版本、Run 报告，隐藏页不覆盖助手上下文', async () => {
  const ui = page({ target: { page: 'agents', agent_id: 'second-agent', experiment_id: 'EXP-second-agent-001', tab: 'runtime' } })
  await ui.settle()
  assert.equal(ui.nodes().find(node => node.props?.id === 'agent-panel-runtime').props.hidden, false)
  ui.button('查看报告').props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { page: 'evaluation', agent_id: 'second-agent', experiment_id: 'EXP-second-agent-001', tab: 'runs', run_id: 'run-11111111-1111-4111-8111-111111111111' })
  const count = ui.contexts.length
  ui.props.active = false
  ui.props.target = { page: 'agents', agent_id: 'first-agent' }
  ui.render(); await ui.settle()
  assert.equal(ui.contexts.length, count)
  ui.props.active = true; ui.render(); await ui.settle()
  assert.equal(ui.contexts.at(-1).agent_id, 'first-agent')
})

test('资产保存冲突保留草稿，取消放弃时关闭和切换均不丢失修改', async () => {
  const ui = page()
  await ui.settle()
  ui.button('Harness 资产').props.onClick(); ui.render()
  ui.button('prompt.md').props.onClick(); ui.render(); await ui.settle()
  ui.button('编辑').props.onClick(); ui.render()
  let editor = ui.nodes().find(node => node.type === 'textarea')
  editor.props.onChange({ target: { value: '未保存正文' } }); ui.render()
  await ui.button('应用保存').props.onClick(); await ui.settle()
  editor = ui.nodes().find(node => node.type === 'textarea')
  assert.equal(editor.props.value, '未保存正文')
  assert.match(ui.text(ui.render()), /草稿已保留/)
  assert.ok(ui.listeners.has('beforeunload'))
  ui.button('关闭').props.onClick(); ui.render()
  assert.equal(ui.nodes().find(node => node.type === 'textarea').props.value, '未保存正文')
  ui.nodes().find(node => node.props?.className === 'agent-list-card' && ui.text(node).includes('second-agent')).props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.contexts.at(-1).agent_id, 'first-agent')
  ui.setConfirm(true); ui.button('关闭').props.onClick(); ui.render()
  assert.equal(ui.nodes().find(node => node.type === 'textarea').props.value, '原始正文')
  assert.equal(ui.listeners.has('beforeunload'), false)
})

test('切换智能体后忽略上个目标迟到的详情响应', async () => {
  let resolveFirst
  const pending = new Promise(resolve => { resolveFirst = resolve })
  const ui = page({ intercept: (endpoint, payload) => endpoint === 'agents/detail' && payload.agent_id === 'first-agent' ? pending : undefined })
  await ui.settle()
  ui.nodes().find(node => node.props?.className === 'agent-list-card' && ui.text(node).includes('second-agent')).props.onClick(); ui.render(); await ui.settle()
  resolveFirst({ ok: true, value: detail('first-agent') }); await ui.settle()
  assert.equal(ui.contexts.at(-1).agent_id, 'second-agent')
  assert.equal(ui.contexts.at(-1).experiment_id, 'EXP-second-agent-002')
})

test('新版本继承盘点仍交由现有 AI 融合流程，保留目标和当前版本上下文', async () => {
  const ui = page({ intercept: endpoint => endpoint === 'agents/fusion/preview' ? { ok: true, value: { inventory: { sources: [] }, preview_id: 'fusion-preview' } } : undefined })
  await ui.settle()
  ui.button('新建研究版本').props.onClick(); ui.render()
  ui.nodes().find(node => node.type === 'textarea').props.onChange({ target: { value: '继承已有能力并改进摘要' } }); ui.render()
  ui.button('盘点继承来源').props.onClick(); await ui.settle()
  await ui.button('请 AI 整理融合方案').props.onClick()
  assert.equal(ui.assistantTasks.length, 1)
  assert.match(ui.assistantTasks[0].task, /继承已有能力并改进摘要/)
  assert.equal(ui.assistantTasks[0].context.experiment_id, 'EXP-first-agent-002')
  assert.equal(ui.assistantTasks[0].context.fusion_request.preview_id, 'fusion-preview')
  assert.equal(ui.calls.some(call => call.endpoint === 'agents/versions/create'), false)
})

function launchPage(instances = [], override) {
  return page({ intercept: (endpoint, payload) => {
    const result = override?.(endpoint, payload)
    if (result !== undefined) return result
    if (endpoint === 'instances/list') return { ok: true, value: { instances } }
    if (endpoint === 'instances/run') return { ok: true, value: { ok: true } }
    if (endpoint === 'instances/url') return { ok: true, value: { url: 'http://127.0.0.1:3100/assistant/' } }
  } })
}

test('新建实例只需一次确认启动，直接实际执行并保留名称和端口', async () => {
  const ui = launchPage()
  await ui.settle(); ui.button('启动智能体').props.onClick(); await ui.settle()
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/run'), false)
  const name = ui.nodes().find(node => node.type === 'label' && ui.text(node).startsWith('实例名称')).props.children[1]
  name.props.onChange({ target: { value: 'inspection-new' } }); ui.render()
  const port = ui.nodes().find(node => node.type === 'input' && node.props.inputMode === 'numeric')
  port.props.onChange({ target: { value: '3115' } }); ui.render()
  assert.equal(ui.button('预览启动'), undefined)
  ui.button('确认启动').props.onClick(); await ui.settle()
  const requests = ui.calls.filter(call => call.endpoint === 'instances/run')
  assert.equal(requests.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { operation: 'create', name: 'inspection-new', source: 'experiment:EXP-first-agent-002', port: 3115 })
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/preview'), false)
  assert.ok(ui.nodes().find(node => node.type === 'a' && node.props.href === 'http://127.0.0.1:3100/assistant/'))
  assert.ok(ui.button('获取对话入口')); assert.equal(ui.button('确认启动'), undefined)
})

test('已停止实例确认启动后执行start，已运行实例仅获取入口而不重复run', async () => {
  for (const state of ['stopped', 'running']) {
    const ui = launchPage([{ name: 'existing', source_id: 'experiment:EXP-first-agent-002', state }])
    await ui.settle(); ui.button('启动智能体').props.onClick(); await ui.settle()
    ui.button(state === 'running' ? '获取对话入口' : '确认启动').props.onClick(); await ui.settle()
    const requests = ui.calls.filter(call => call.endpoint === 'instances/run')
    assert.equal(requests.length, state === 'running' ? 0 : 1)
    if (state === 'stopped') assert.deepEqual(JSON.parse(JSON.stringify(requests[0].payload)), { operation: 'start', name: 'existing', source: 'experiment:EXP-first-agent-002' })
    assert.equal(ui.calls.filter(call => call.endpoint === 'instances/url').length, 1)
    assert.equal(ui.calls.some(call => call.endpoint === 'instances/preview'), false)
  }
})

test('实际启动中的快速双击只发送一次run，表单在执行期间禁用', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const ui = launchPage([], endpoint => endpoint === 'instances/run' ? pending : undefined)
  await ui.settle(); ui.button('启动智能体').props.onClick(); await ui.settle()
  const click = ui.button('确认启动').props.onClick
  click(); click(); ui.render(); await ui.settle()
  assert.equal(ui.calls.filter(call => call.endpoint === 'instances/run').length, 1)
  assert.equal(ui.button('确认启动').props.disabled, true)
  assert.equal(ui.button('关闭').props.disabled, true, '运行中不能关闭并遗失在途回执')
  assert.ok(ui.nodes().filter(node => node.type === 'input' && node.props.inputMode === 'numeric').every(node => node.props.disabled))
  finish({ ok: true, value: { ok: true } }); await ui.settle()
  assert.equal(ui.button('获取对话入口').props.disabled, false)
  assert.equal(ui.button('关闭').props.disabled, false)
})

test('实际启动失败显示原因为失败且不生成入口，启动后取入口失败不重复启动', async () => {
  for (const failure of ['run', 'receipt', 'url']) {
    let failed = false
    const ui = launchPage([], endpoint => {
      if (endpoint === 'instances/' + (failure === 'receipt' ? 'run' : failure) && !failed) {
        failed = true
        if (failure === 'receipt') return { ok: true, value: { ok: false, error: { message: '端口已被占用' } } }
        return { ok: false, error: { code: 'failed', message: failure === 'run' ? '端口已被占用' : '入口暂不可读' } }
      }
    })
    await ui.settle(); ui.button('启动智能体').props.onClick(); await ui.settle()
    ui.button('确认启动').props.onClick(); await ui.settle()
    assert.equal(ui.nodes().some(node => node.type === 'a' && ui.text(node) === '打开智能体对话'), false)
    if (failure !== 'url') {
      assert.match(ui.text(ui.render()), /端口已被占用/); assert.equal(ui.calls.some(call => call.endpoint === 'instances/url'), false)
      assert.equal(ui.button('确认启动').props.disabled, false)
    } else {
      assert.match(ui.text(ui.render()), /实例已启动，但获取对话入口失败/)
      ui.button('获取对话入口').props.onClick(); await ui.settle()
      assert.equal(ui.calls.filter(call => call.endpoint === 'instances/run').length, 1)
      assert.ok(ui.nodes().find(node => node.type === 'a' && ui.text(node) === '打开智能体对话'))
    }
  }
})

test('切换智能体或版本后，迟到的启动及入口回执不覆盖新对象也不继续旧目标查询', async () => {
  for (const stage of ['run', 'url']) for (const next of ['agent', 'version']) {
    let finish
    const pending = new Promise(resolve => { finish = resolve })
    const ui = launchPage([], endpoint => endpoint === 'instances/' + stage ? pending : undefined)
    await ui.settle(); ui.button('启动智能体').props.onClick(); await ui.settle()
    ui.button('确认启动').props.onClick(); ui.render(); await ui.settle()
    if (next === 'agent') ui.nodes().find(node => node.props?.className === 'agent-list-card' && ui.text(node).includes('second-agent')).props.onClick()
    else ui.nodes().find(node => node.props?.['aria-label'] === '版本').props.onChange({ target: { value: 'EXP-first-agent-001' } })
    ui.render(); await ui.settle()
    const firstDetails = ui.calls.filter(call => call.endpoint === 'agents/detail' && call.payload.agent_id === 'first-agent').length
    finish(stage === 'run' ? { ok: true, value: { ok: true } } : { ok: true, value: { url: 'http://127.0.0.1:3100/assistant/' } }); await ui.settle()
    assert.equal(ui.contexts.at(-1).agent_id, next === 'agent' ? 'second-agent' : 'first-agent')
    assert.equal(ui.contexts.at(-1).experiment_id, next === 'agent' ? 'EXP-second-agent-002' : 'EXP-first-agent-001')
    assert.equal(ui.nodes().some(node => node.type === 'a' && ui.text(node) === '打开智能体对话'), false)
    assert.equal(ui.calls.filter(call => call.endpoint === 'agents/detail' && call.payload.agent_id === 'first-agent').length, firstDetails)
    assert.equal(ui.calls.filter(call => call.endpoint === 'instances/url').length, stage === 'run' ? 0 : 1)
  }
})

test('智能体、版本和标签选择同步导航地址，后退精确恢复且不产生导航循环', async () => {
  const ui = page({ target: { page: 'agents' } })
  await ui.settle()
  const plain = value => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(ui.navigations.at(-1)), { page: 'agents', agent_id: 'first-agent', experiment_id: 'EXP-first-agent-002', tab: 'overview', replace: true })
  assert.equal(ui.history.length, 1, '默认地址补全必须替换原历史条目')
  ui.button('能力状态').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.tab, 'capabilities')
  assert.equal(ui.navigations.at(-1).replace, undefined)
  assert.equal(ui.history.length, 2)
  const version = ui.nodes().find(node => node.props?.['aria-label'] === '版本')
  version.props.onChange({ target: { value: 'EXP-first-agent-001' } }); ui.render(); await ui.settle()
  const previous = plain(ui.props.target)
  assert.deepEqual(previous, { page: 'agents', agent_id: 'first-agent', experiment_id: 'EXP-first-agent-001', tab: 'capabilities' })
  ui.nodes().find(node => node.props?.className === 'agent-list-card' && ui.text(node).includes('second-agent')).props.onClick(); ui.render(); await ui.settle()
  assert.deepEqual(plain(ui.props.target), { page: 'agents', agent_id: 'second-agent', experiment_id: 'EXP-second-agent-002', tab: 'overview' })
  assert.equal(ui.navigations.at(-1).replace, undefined, '显式切换智能体解析最新版后仍新增历史条目')
  assert.equal(ui.history.length, 4)
  const notified = ui.navigations.length
  ui.props.target = previous // 模拟 popstate 将历史 Hash 恢复为之前的精确对象。
  ui.render(); await ui.settle()
  assert.equal(ui.contexts.at(-1).agent_id, 'first-agent')
  assert.equal(ui.contexts.at(-1).experiment_id, 'EXP-first-agent-001')
  assert.equal(ui.contexts.at(-1).tab, 'capabilities')
  assert.equal(ui.navigations.length, notified)
  for (let index = 0; index < 3; index++) {
    const callback = ui.props.onNavigate
    ui.props.onNavigate = value => callback(value)
    ui.render(); await ui.settle()
  }
  assert.equal(ui.navigations.length, notified, '父组件回调身份变化不应重新发出导航')
})

test('后退或深链接切换遭草稿保护拒绝时恢复旧地址，确认放弃后才加载新目标', async () => {
  const ui = page({ target: { page: 'agents' } })
  await ui.settle()
  ui.button('Harness 资产').props.onClick(); ui.render()
  ui.button('prompt.md').props.onClick(); ui.render(); await ui.settle()
  ui.button('编辑').props.onClick(); ui.render()
  ui.nodes().find(node => node.type === 'textarea').props.onChange({ target: { value: '保留的资产草稿' } }); ui.render()
  const oldTarget = JSON.parse(JSON.stringify(ui.props.target))
  const deepTarget = { page: 'agents', agent_id: 'second-agent', experiment_id: 'EXP-second-agent-001', tab: 'runtime' }
  ui.props.target = deepTarget; ui.render(); await ui.settle()
  assert.deepEqual(JSON.parse(JSON.stringify(ui.props.target)), oldTarget)
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { ...oldTarget, replace: true })
  assert.equal(ui.nodes().find(node => node.type === 'textarea').props.value, '保留的资产草稿')
  assert.equal(ui.contexts.at(-1).agent_id, 'first-agent')
  ui.setConfirm(true)
  ui.props.target = deepTarget; ui.render(); await ui.settle()
  assert.equal(ui.contexts.at(-1).agent_id, 'second-agent')
  assert.equal(ui.contexts.at(-1).experiment_id, 'EXP-second-agent-001')
  assert.equal(ui.contexts.at(-1).tab, 'runtime')
  assert.deepEqual(JSON.parse(JSON.stringify(ui.props.target)), deepTarget)
})

test('整理特性入口携带选定版本及维护Skill，后续页面变化不改发起上下文', async () => {
  const ui = page({ target: { page: 'agents', agent_id: 'second-agent', experiment_id: 'EXP-second-agent-001' } })
  await ui.settle()
  await ui.button('请 AI 整理特性').props.onClick()
  const request = ui.assistantTasks[0]
  assert.equal(request.context.agent_id, 'second-agent')
  assert.equal(request.context.experiment_id, 'EXP-second-agent-001')
  assert.equal(request.context.skill, 'agent-maintenance')
  assert.equal(request.context.workflow, 'features')
  ui.props.target = { page: 'agents', agent_id: 'first-agent', experiment_id: 'EXP-first-agent-002' }
  await ui.settle()
  assert.equal(request.context.experiment_id, 'EXP-second-agent-001')
})

const plain = value => JSON.parse(JSON.stringify(value))
const listTab = (ui, view) => ui.nodes().find(node => node.props?.id === `agent-list-tab-${view}`)
const variantCards = ui => ui.nodes().filter(node => node.props?.className === 'agent-list-card agent-variant-card')

test('左右两层标签独立，切换列表保留右侧资产草稿且无需重新读取详情', async () => {
  const ui = page()
  await ui.settle()
  ui.button('Harness 资产').props.onClick(); ui.render()
  ui.button('prompt.md').props.onClick(); await ui.settle()
  ui.button('编辑').props.onClick(); ui.render()
  ui.nodes().find(node => node.type === 'textarea').props.onChange({ target: { value: '列表切换保留草稿' } }); ui.render()
  const before = ui.calls.length
  listTab(ui, 'variants').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.list_view, 'variants')
  assert.equal(ui.props.target.tab, 'assets')
  assert.equal(ui.props.target.experiment_id, 'EXP-first-agent-002')
  assert.equal(ui.nodes().find(node => node.type === 'textarea').props.value, '列表切换保留草稿')
  assert.equal(ui.calls.length, before, '左侧切换不读取详情、Run或比较context')
  listTab(ui, 'agents').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.list_view, undefined)
  assert.equal(ui.nodes().find(node => node.type === 'textarea').props.value, '列表切换保留草稿')
})

test('变体汇总仅保留搜索与所属范围，两个列表分别保留搜索且可回到全部变体', async () => {
  const ui = page()
  await ui.settle()
  ui.nodes().find(node => node.props?.placeholder === '名称或 Agent ID').props.onChange({ target: { value: 'first-agent' } }); ui.render()
  ui.nodes().find(node => node.props?.['aria-label'] === '查看 名称 first-agent 的变体').props.onClick(); ui.render(); await ui.settle()
  assert.match(ui.text(ui.nodes().find(node => node.props?.className === 'agent-variant-scope')), /名称 first-agent 的变体/)
  assert.equal(ui.nodes().some(node => node.props?.className === 'agent-variant-filters'), false)
  assert.equal(ui.nodes().some(node => node.props?.['aria-label']?.startsWith('筛选变体')), false)
  assert.equal(variantCards(ui).length, 1)
  ui.button('查看全部').props.onClick(); ui.render()
  assert.equal(variantCards(ui).length, 2, '普通研究版本不算作算力变体')
  ui.nodes().find(node => node.props?.placeholder === '变体名称、版本或来源 ID').props.onChange({ target: { value: 'EXP-second-agent-001' } }); ui.render()
  assert.equal(variantCards(ui).length, 1, '可按来源父版ID搜索')
  listTab(ui, 'agents').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.nodes().find(node => node.props?.placeholder === '名称或 Agent ID').props.value, 'first-agent')
  listTab(ui, 'variants').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.nodes().find(node => node.props?.placeholder === '变体名称、版本或来源 ID').props.value, 'EXP-second-agent-001')
  assert.equal(ui.calls.some(call => /compute-variants|runs\//.test(call.endpoint)), false)
})

test('变体选择显式定位所属智能体和生成页，同版本也可从资产页切换，父版仍在同页查看', async () => {
  const ui = page()
  await ui.settle()
  ui.button('Harness 资产').props.onClick(); ui.render(); await ui.settle()
  listTab(ui, 'variants').props.onClick(); ui.render(); await ui.settle()
  variantCards(ui).find(node => ui.text(node).includes('EXP-first-agent-002')).props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.tab, 'compute-variants', '同对象早返回也应用显式页签')
  variantCards(ui).find(node => ui.text(node).includes('EXP-second-agent-002')).props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.agent_id, 'second-agent')
  assert.equal(ui.props.target.experiment_id, 'EXP-second-agent-002')
  assert.equal(ui.props.target.tab, 'compute-variants', '跨Agent不能强制落回概览')
  ui.button('查看父版当前详情').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.experiment_id, 'EXP-second-agent-001')
  assert.equal(ui.props.target.tab, 'overview')
  assert.equal(ui.props.target.list_view, 'variants')
  assert.match(ui.text(ui.render()), /真实用途/)
})

test('变体深链接与浏览历史恢复列表和对象，迟到详情不覆盖最新列表视图', async () => {
  const target = { page: 'agents', agent_id: 'second-agent', experiment_id: 'EXP-second-agent-002', tab: 'overview', list_view: 'variants' }
  const ui = page({ target })
  await ui.settle()
  assert.equal(listTab(ui, 'variants').props['aria-selected'], true)
  const old = plain(ui.props.target)
  listTab(ui, 'agents').props.onClick(); ui.render(); await ui.settle()
  const notified = ui.navigations.length
  ui.props.target = old; ui.render(); await ui.settle()
  assert.equal(listTab(ui, 'variants').props['aria-selected'], true)
  assert.equal(ui.contexts.at(-1).experiment_id, 'EXP-second-agent-002')
  assert.equal(ui.navigations.length, notified)
  let finish
  const slow = page({ intercept: (endpoint, payload) => endpoint === 'agents/detail' && payload.agent_id === 'first-agent' ? new Promise(resolve => { finish = resolve }) : undefined })
  await slow.settle()
  listTab(slow, 'variants').props.onClick(); slow.render(); await slow.settle()
  finish({ ok: true, value: detail('first-agent') }); await slow.settle()
  assert.equal(slow.props.target.list_view, 'variants')
  assert.equal(listTab(slow, 'variants').props['aria-selected'], true)
})

test('来源Run定位父版报告，生成代码定位当前Candidate资产，缺失父版诚实显示', async () => {
  const ui = page()
  await ui.settle()
  ui.button('查看生成源码').props.onClick(); ui.render(); await ui.settle()
  assert.equal(ui.props.target.tab, 'assets')
  assert.ok(ui.calls.some(call => call.endpoint === 'agents/edit/read' && call.payload.path === 'evolution/experiments/EXP-first-agent-002/candidate/dsh/managed/compute-workflow/index.ts'))
  ui.button('查看诊断报告').props.onClick()
  assert.deepEqual(plain(ui.props.target), { page: 'evaluation', agent_id: 'first-agent', experiment_id: 'EXP-first-agent-001', tab: 'runs', run_id: 'run-22222222-2222-4222-8222-222222222222' })
  const unknown = page({ intercept: (endpoint, payload) => {
    if (endpoint !== 'agents/detail') return
    const value = detail(payload.agent_id, payload.experiment_id)
    value.experiment = { ...value.experiment, change: { baseline_ref: `git:${'c'.repeat(40)}` } }
    value.baseline = { ref: `git:${'c'.repeat(40)}` }
    return { ok: true, value }
  } })
  await unknown.settle()
  assert.match(unknown.text(unknown.nodes().find(node => node.props?.['aria-label'] === '生成来源')), /父版本未记录/)
  assert.equal(unknown.button('查看父版当前详情'), undefined)
})

test('列表主标题使用独立名称，不截取策略或研究问题，名称可直接搜索', async () => {
  const ui = page()
  await ui.settle()
  listTab(ui, 'variants').props.onClick(); ui.render(); await ui.settle()
  const titles = () => variantCards(ui).map(card => ui.text(card.props.children[0].props.children[0]))
  assert.deepEqual(titles(), ['资产告警轻量版', '未命名变体'])
  const search = ui.nodes().find(node => node.props?.placeholder === '变体名称、版本或来源 ID')
  search.props.onChange({ target: { value: '告警轻量' } }); ui.render()
  assert.equal(variantCards(ui).length, 1)
  assert.match(ui.text(variantCards(ui)[0]), /EXP-first-agent-002/)
  const version = ui.nodes().find(node => node.props?.['aria-label'] === '版本')
  assert.match(ui.text(version), /资产告警轻量版 · EXP-first-agent-002/)
})

test('名称保存后回读列表与详情，冲突保留草稿并可重新核对而不改策略', async () => {
  let saved = '资产告警轻量版', revision = 'a'.repeat(64), conflict = true
  const ui = page({ intercept: (endpoint, payload) => {
    if (endpoint === 'agents/list') return { ok: true, value: { agents: [{ id: 'first-agent', name: '名称 first-agent' }], experiments: experiments().map(item => item.id === 'EXP-first-agent-002' ? { ...item, change_sha256: revision, change: { ...item.change, variant_name: saved } } : item) } }
    if (endpoint === 'agents/detail') { const value = detail(payload.agent_id, payload.experiment_id); value.experiment = { ...value.experiment, change_sha256: revision, change: { ...value.experiment.change, variant_name: saved } }; return { ok: true, value } }
    if (endpoint === 'agents/compute-variants/rename') {
      if (conflict) { revision = 'b'.repeat(64); return { ok: false, error: { code: 'conflict', message: '版本信息已变化' } } }
      assert.equal(payload.expected_change_sha256, revision)
      saved = payload.variant_name
      return { ok: true, value: { experiment_id: payload.experiment_id, variant_name: saved } }
    }
  } })
  await ui.settle()
  ui.button('修改变体名称').props.onClick(); ui.render()
  const input = () => ui.nodes().find(node => node.props?.['aria-label'] === '变体名称')
  input().props.onChange({ target: { value: '独立的新名称' } }); ui.render()
  const form = () => ui.nodes().find(node => node.props?.['aria-label'] === '修改变体名称')
  form().props.onSubmit({ preventDefault() {} }); await ui.settle()
  assert.equal(input().props.value, '独立的新名称')
  assert.match(ui.text(ui.render()), /名称草稿已保留/)
  await ui.button('重新核对').props.onClick(); await ui.settle()
  assert.equal(input().props.value, '独立的新名称')
  conflict = false
  form().props.onSubmit({ preventDefault() {} }); await ui.settle()
  assert.equal(ui.button('取消改名'), undefined)
  assert.match(ui.text(variantCards(ui)[0]), /独立的新名称/)
  assert.equal(ui.calls.findLast(call => call.endpoint === 'agents/compute-variants/rename').payload.variant_name, '独立的新名称')
  assert.equal(ui.calls.some(call => /generate|eval\/start|compute-variants\/build/.test(call.endpoint)), false)
})

test('旧列表请求迟到时不能把新名称覆盖回旧名称', async () => {
  let finish, reads = 0
  const old = new Promise(resolve => { finish = resolve })
  const value = name => ({ agents: [{ id: 'first-agent', name: '名称 first-agent' }], experiments: experiments().map(item => item.id === 'EXP-first-agent-002' ? { ...item, change: { ...item.change, variant_name: name } } : item) })
  const ui = page({ intercept: endpoint => endpoint === 'agents/list' ? ++reads === 1 ? old : { ok: true, value: value('更新后的名称') } : undefined })
  await ui.settle()
  ui.button('刷新').props.onClick(); await ui.settle()
  finish({ ok: true, value: value('迟到的旧名称') }); await ui.settle()
  assert.match(ui.text(variantCards(ui)[0]), /更新后的名称/)
  assert.doesNotMatch(ui.text(variantCards(ui)[0]), /迟到的旧名称/)
})
