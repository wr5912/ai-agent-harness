import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const source = (await build({ entryPoints: [new URL('../src/agents/client.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })).outputFiles[0].text

function detail(agentId = 'first-agent', experimentId = `EXP-${agentId}-002`) {
  return { agent: { id: agentId, name: `名称 ${agentId}`, manifest: { description: '真实用途' } }, experiment: { id: experimentId, status: 'active', change: {} },
    versions: [{ id: `EXP-${agentId}-002` }, { id: `EXP-${agentId}-001` }], baseline: { ref: 'none:first-experiment' }, fusion: {}, related_references: [],
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
      if (endpoint === 'agents/list') return { ok: true, value: { agents: ['first-agent', 'second-agent'].map(id => ({ id, name: `名称 ${id}`, version_count: 2, latest_experiment_status: 'active', active_experiment: `EXP-${id}-001` })) } }
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

test('智能体四个任务页签、搜索与默认最新版本保持登记版本独立', async () => {
  const ui = page()
  await ui.settle()
  assert.deepEqual(ui.nodes().filter(node => node.props?.role === 'tab').map(node => ui.text(node)), ['概览', 'Harness 资产', '能力状态', '运行情况'])
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

test('启动智能体保留预览、人工确认与打开会话入口', async () => {
  const ui = page({ intercept: endpoint => {
    if (endpoint === 'instances/list') return { ok: true, value: { instances: [] } }
    if (endpoint === 'instances/preview') return { ok: true, value: { operation: 'create', source: 'experiment:EXP-first-agent-002' } }
    if (endpoint === 'instances/run') return { ok: true, value: { ok: true } }
    if (endpoint === 'instances/url') return { ok: true, value: { url: 'http://127.0.0.1:3100/assistant/' } }
  } })
  await ui.settle()
  ui.button('启动智能体').props.onClick(); await ui.settle()
  ui.button('预览启动').props.onClick(); await ui.settle()
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/run'), false)
  ui.button('确认启动').props.onClick(); await ui.settle()
  const request = ui.calls.find(call => call.endpoint === 'instances/run')
  assert.equal(request.payload.source, 'experiment:EXP-first-agent-002')
  assert.ok(ui.nodes().find(node => node.type === 'a' && node.props.href === 'http://127.0.0.1:3100/assistant/'))
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
