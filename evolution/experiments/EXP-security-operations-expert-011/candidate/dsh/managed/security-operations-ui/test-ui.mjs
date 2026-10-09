import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const entries = new Map()
let plugin
let states = []
let cursor = 0
const React = {
  createElement(type, props, ...children) { return { type, props: { ...props, children } } },
  useState(initial) {
    const position = cursor++
    if (!(position in states)) states[position] = initial
    return [states[position], value => { states[position] = value }]
  },
  useEffect() {},
}

const workspaceSnapshot = { pinnedSessionIds: ['saved-session'] }
const sessionSnapshot = { byId: { 'saved-session': { id: 'saved-session', displayTitle: '已收藏的研判会话' } } }
const opened = []

runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { plugin = value } } },
  document: { createElement() { return { dataset: {} } }, head: { appendChild() {} } },
})
assert.equal(plugin.id, 'dsh-security-operations-ui')

const { apply } = plugin.factory(name => {
  assert.equal(name, 'react')
  return React
})
apply({
  effect(effect) { effect() },
  get(name) {
    return {
      workspaces: { list: { subscribe() {}, getSnapshot: () => workspaceSnapshot } },
      sessions: { list: { subscribe() {}, getSnapshot: () => sessionSnapshot } },
      uiWorkspace: { openSession(id) { opened.push(id) } },
    }[name]
  },
  slots: {
    entries() { return [{ store: { create() { return {
      getSnapshot() { return { layoutInfo: { rightbar: null } } },
      actions: { setRightbar() {} },
    } } } }] },
    inject(_name, register) { register() },
    register(options, component) { entries.set(options.name, component) },
  },
  sidebarRight: { openTab() {} },
  sidebarRightTabs: { register() {} },
})

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
assert.equal(cards(tree).length, 6)
cards(tree)[0].props.onClick()
assert.match(inserted[0], /最近24小时网络总结报告/)

nodes(tree, node => node.type === 'input')[0].props.onChange({ target: { value: '资产盘点' } })
tree = render()
assert.equal(cards(tree).length, 1)

nodes(tree, node => node.props?.role === 'tab' && node.props['aria-selected'] === false)[0].props.onClick()
tree = render()
assert.equal(cards(tree).length, 2)
assert(cards(tree).every(card => card.props.children[0].props.src === hero.props.children[0].props.src))
cards(tree)[0].props.onClick()
assert.equal(inserted[1], '@威胁研判子智能体 ')

nodes(tree, node => node.props?.role === 'tab' && node.props.children.includes('收藏'))[0].props.onClick()
tree = render()
assert.equal(cards(tree).length, 1)
cards(tree)[0].props.onClick()
assert.deepEqual(opened, ['saved-session'])
console.log('本地图片、推荐筛选、数字员工、收藏与草稿插入通过')
