import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const entries = new Map()
const storage = new Map()
const groupModes = []
let plugin
let states = []
let cursor = 0
let effects
const requests = []
const pageDocument = { baseURI: 'http://localhost/', createElement() { return { dataset: {} } }, head: { appendChild() {} } }
const responseOverview = {
  windowHours: 24, parent: { state: 'idle', active: 0, sessions: 0, toolCalls: 0, skillLoads: 0 },
  roles: ['delegate_threat_analysis', 'delegate_fault_analysis', 'delegate_response_planning'].map(id =>
    ({ id, title: id, state: 'idle', active: 0, completed: 0, failed: 0, noChild: 0, unknown: 0, toolCalls: 0, skillLoads: 0, recent: [] })),
}
const React = {
  createElement(type, props, ...children) { return { type, props: { ...props, children } } },
  useState(initial) {
    const position = cursor++
    if (!(position in states)) states[position] = typeof initial === 'function' ? initial() : initial
    return [states[position], value => { states[position] = value }]
  },
  useEffect(effect) { effects?.push(effect) },
}

const workspaceSnapshot = { pinnedSessionIds: ['saved-session'] }
const sessionSnapshot = { phase: 'ready', byId: { 'saved-session': { id: 'saved-session', displayTitle: '已收藏的研判会话', blank: false, running: false } } }
const opened = []
const selectedLocales = []
let localeSnapshot = { mode: 'host', status: 'loading' }
let notifyLocale

runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: { confirm() { return true }, __ModuleLoader__: { load(value) { plugin = value } } },
  crypto: { randomUUID() { return 'new-employee' } },
  localStorage: { getItem(key) { return storage.get(key) ?? null }, setItem(key, value) { storage.set(key, value) } },
  document: pageDocument, URL, setImmediate,
  async fetch(url, options) { requests.push({ url: String(url), options }); return { ok: true, json: async () => responseOverview } },
  setInterval() { return 1 }, clearInterval() {},
})
assert.equal(plugin.id, 'dsh-security-operations-ui')

const { apply } = plugin.factory(name => {
  assert.equal(name, 'react')
  return React
})
const workspaceView = { actions: { setGroupBy(mode) {
  groupModes.push(mode)
  storage.set('dsh.workspace.view.v5', JSON.stringify({ groupBy: mode }))
} } }
const layoutView = {
  getSnapshot() { return { layoutInfo: { rightbar: null } } },
  actions: { setRightbar() {} },
}
const context = {
  effect(effect) { effect() },
  locale: { setLocale(id) { selectedLocales.push(id) } },
  configForms: { get(name) {
    assert.equal(name, 'locale')
    return { getSnapshot: () => localeSnapshot, subscribe(listener) { notifyLocale = listener; return () => {} } }
  } },
  sessions: { list: { subscribe() { return () => {} }, getSnapshot: () => sessionSnapshot } },
  workspaces: { create: async () => ({ workspaceId: 'workspace-id' }), list: { getSnapshot: () => ({ items: [] }) } },
  uiWorkspace: { openWorkspace: async () => {} },
  remote: { agentPresets: { select: async () => ({ ok: true }) } },
  get(name) {
    return {
      workspaces: { list: { subscribe() {}, getSnapshot: () => workspaceSnapshot } },
      sessions: { list: { subscribe() {}, getSnapshot: () => sessionSnapshot } },
      uiWorkspace: { openSession(id) { opened.push(id) } },
    }[name]
  },
  slots: {
    entries(name) { return [{ store: { create: () => name === 'sidebar.workspaces' ? workspaceView : layoutView } }] },
    subscribe() { return () => {} },
    inject(_name, register) { register() },
    register(options, component) { entries.set(options.name, component) },
  },
  sidebarRight: { openTab() {} },
  sidebarRightTabs: { register() {} },
}
apply(context)
assert.deepEqual(groupModes, ['flat'])
assert.deepEqual(selectedLocales, [])
localeSnapshot = { mode: 'host', status: 'ready', value: { preference: 'en' } }
notifyLocale()
assert.deepEqual(selectedLocales, [])
storage.set('dsh.workspace.view.v5', JSON.stringify({ groupBy: 'workspace' }))
localeSnapshot = { mode: 'host', status: 'ready', value: {} }
apply(context)
assert.deepEqual(groupModes, ['flat'])
assert.deepEqual(selectedLocales, ['zh'])
localeSnapshot = { mode: 'memory', status: 'unavailable' }
apply(context)
assert.deepEqual(selectedLocales, ['zh', 'zh'])

function nodes(root, predicate) {
  if (Array.isArray(root)) return root.flatMap(item => nodes(item, predicate))
  if (!root || typeof root !== 'object') return []
  return [...(predicate(root) ? [root] : []), ...nodes(root.props?.children, predicate)]
}
function render() {
  cursor = 0
  const dock = entries.get('conversation.input.dock')({
    session: { blank: true },
    useWorkspaces: select => select(workspaceSnapshot),
    useSessions: select => select(sessionSnapshot),
    inputActions: {
      captureInsertion() { return { start: 0, end: 0, draftRev: 0 } },
      insertText(value) { inserted.push(value); return true },
    },
  })
  return dock.type(dock.props)
}
const inserted = []
const cards = tree => nodes(tree, node => node.type === 'button' && node.props.className?.includes('soc-quick__card'))
const brand = entries.get('sidebar.brand.mark')({ size: 32 })
const hero = entries.get('conversation.hero.brand.mark')()
assert.match(brand.props.src, /^data:image\/webp;base64,/)
assert.match(hero.props.children[0].props.src, /^data:image\/gif;base64,/)

let tree = render()
assert.equal(cards(tree).length, 8)
const overviewNode = nodes(tree, node => node.type?.name === 'RuntimeOverview')[0]
cursor = 100
let overview = overviewNode.type(overviewNode.props)
assert.equal(nodes(overview, node => node.props?.['data-runtime-state']).length, 4)
assert.equal(nodes(overview, node => node.type === 'strong' && node.props.title === '主智能体：网络安全运营专家')[0]?.props.children[0], '网络安全运营专家')
assert(nodes(overview, node => node.props?.['data-runtime-state']).every(node => node.props['data-runtime-state'] === 'unknown'))
const activityCounts = tree => nodes(tree, node => node.props?.className === 'soc-runtime__activity')
  .map(node => nodes(node, child => child.type === 'b').map(child => child.props.children[0]))
assert.deepEqual(activityCounts(overview), [['—', '—'], ['—', '—'], ['—', '—'], ['—', '—']])
assert.equal(nodes(overview, node => node.props?.['aria-expanded'] === false).length, 1)
nodes(overview, node => node.props?.['aria-expanded'] === false)[0].props.onClick()
cursor = 100
overview = overviewNode.type(overviewNode.props)
assert.equal(nodes(overview, node => node.props?.className === 'soc-runtime__detail').length, 4)
cursor = 100
overview = overviewNode.type({ ...overviewNode.props, overview: {
  windowHours: 24,
  parent: { state: 'running', active: 1, sessions: 2, recentSessionId: 'parent-1', toolCalls: 6, skillLoads: 2 },
  roles: [
    { id: 'delegate_threat_analysis', title: '威胁研判子智能体', state: 'running', active: 1, completed: 0, failed: 0, noChild: 0, unknown: 0, toolCalls: 3, skillLoads: 1,
      recent: [{ parentSessionId: 'parent-1', childSessionId: 'child-1', startedAt: 1, status: 'running' }] },
    ...['delegate_fault_analysis', 'delegate_response_planning'].map(id =>
      ({ id, title: id, state: 'idle', active: 0, completed: 0, failed: 0, noChild: 0, unknown: 0, toolCalls: 0, skillLoads: 0, recent: [] })),
  ],
}, openSession: id => opened.push(id) })
assert.deepEqual(nodes(overview, node => node.props?.['data-runtime-state']).map(node => node.props['data-runtime-state']),
  ['running', 'running', 'idle', 'idle'])
assert.deepEqual(activityCounts(overview), [[6, 2], [3, 1], [0, 0], [0, 0]])
nodes(overview, node => node.type === 'button' && node.props.children.includes('查看最近会话'))[0].props.onClick()
nodes(overview, node => node.type === 'button' && node.props.children.includes('子会话'))[0].props.onClick()
assert.deepEqual(opened, ['parent-1', 'child-1'])
opened.length = 0
cards(tree)[0].props.onClick()
assert.match(inserted[0], /访问策略.*先生成草稿，不要执行/)

nodes(tree, node => node.type === 'input')[0].props.onChange({ target: { value: '资产盘点' } })
tree = render()
assert.equal(cards(tree).length, 1)

nodes(tree, node => node.props?.role === 'tab' && node.props['aria-selected'] === false)[0].props.onClick()
tree = render()
assert.equal(cards(tree).length, 2)
assert(cards(tree).every(card => card.props.children[0].props.src === hero.props.children[0].props.src))
cards(tree)[0].props.onClick()
assert.equal(inserted[1], '@威胁研判子智能体 ')

nodes(tree, node => node.props?.['aria-label'] === '编辑数字员工')[0].props.onClick()
tree = render()
nodes(tree, node => node.props?.className === 'soc-quick__card soc-employee-add')[0].props.onClick()
tree = render()
let form = nodes(tree, node => node.type === 'form')[0]
form.props.children[0].props.children[1].props.onChange({ target: { value: '新数字员工' } })
tree = render()
form = nodes(tree, node => node.type === 'form')[0]
form.props.children[1].props.children[1].props.onChange({ target: { value: '分析网络流量' } })
tree = render()
form = nodes(tree, node => node.type === 'form')[0]
form.props.children[2].props.children[1].props.onChange({ target: { value: '流量分析、异常检测' } })
tree = render()
nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} })
tree = render()
assert.equal(JSON.parse(storage.get('dsh.securityOperations.digitalEmployees.v1')).length, 3)
assert.equal(nodes(tree, node => node.props?.['aria-label'] === '编辑新数字员工').length, 1)
nodes(tree, node => node.props?.['aria-label'] === '编辑新数字员工')[0].props.onClick()
tree = render()
form = nodes(tree, node => node.type === 'form')[0]
form.props.children[0].props.children[1].props.onChange({ target: { value: '已修改数字员工' } })
tree = render()
nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} })
tree = render()
assert.equal(JSON.parse(storage.get('dsh.securityOperations.digitalEmployees.v1'))[2].title, '已修改数字员工')
nodes(tree, node => node.props?.['aria-label'] === '删除已修改数字员工')[0].props.onClick()
tree = render()
assert.equal(JSON.parse(storage.get('dsh.securityOperations.digitalEmployees.v1')).length, 2)
nodes(tree, node => node.props?.['aria-label'] === '完成编辑数字员工')[0].props.onClick()
tree = render()
assert.equal(cards(tree).length, 2)

nodes(tree, node => node.props?.role === 'tab' && node.props.children.includes('收藏'))[0].props.onClick()
tree = render()
assert.equal(cards(tree).length, 1)
cards(tree)[0].props.onClick()
assert.deepEqual(opened, ['saved-session'])

const fixedCalls = []
const blank = { id: 'blank', blank: true, retainedBy: { mainView: 1 }, projectionValues: {} }
const fixedContext = {
  ...context,
  sessions: { list: { subscribe() { return () => {} }, getSnapshot: () => ({ byId: { blank } }) } },
  workspaces: { create: async ({ path }) => { fixedCalls.push(path); return { workspaceId: 'workspace-id' } },
    list: { getSnapshot: () => ({ items: [{ workspaceId: 'other', sessionIds: ['blank'] }] }) } },
  uiWorkspace: { openWorkspace: async id => { fixedCalls.push(id); fixedContext.workspaces.list.getSnapshot = () => ({ items: [{ workspaceId: id, sessionIds: ['blank'] }] }) } },
  remote: { agentPresets: { select: async (id, preset) => { fixedCalls.push([id, preset]); return { ok: true } } } },
}
apply(fixedContext)
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(fixedCalls, ['/work/harness/workspace', 'workspace-id', ['blank', 'security-operations-expert']])
for (const prefix of ['/', '/assistant/', '/portal/apps/assistant/']) {
  pageDocument.baseURI = `https://portal.example${prefix}?token=entry-only#view`
  states = []; effects = []
  render()
  const cleanup = effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  effects = undefined
  const tree = render()
  const node = nodes(tree, node => node.type?.name === 'RuntimeOverview')[0]
  cursor = 100
  const overview = node.type(node.props)
  assert.equal(requests.at(-1).url, `https://portal.example${prefix}api/security-operations/overview`)
  assert.equal(requests.at(-1).options.credentials, 'same-origin')
  assert.deepEqual(nodes(overview, item => item.props?.['data-runtime-state']).map(item => item.props['data-runtime-state']), ['idle', 'idle', 'idle', 'idle'])
  cleanup()
}
console.log('固定工作区和预设、概览展开、数字员工增改删与持久化、快捷入口与三种应用前缀通过')
