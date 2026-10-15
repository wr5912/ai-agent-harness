import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

// 运行实际客户端产物，只替换 React 的状态调度和 Portal 容器。
function editor() {
  const require = createRequire(import.meta.url)
  const states = [], dependencies = []
  let registration, cursor, effects, changed
  const react = {
    ...require('react'),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = initial
      return [states[index], value => {
        states[index] = typeof value === 'function' ? value(states[index]) : value
        changed = true
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = { current: initial }
      return states[index]
    },
    useEffect(effect, deps) {
      const index = cursor++
      if (!dependencies[index] || deps.some((value, at) => value !== dependencies[index][at])) {
        dependencies[index] = deps
        effects.push(effect)
      }
    },
  }
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
    .replace('return module.exports;}});', 'return { ...module.exports, Manager };}});')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { registration = value } } },
    structuredClone, URL, location: { origin: 'http://127.0.0.1:3090' },
    document: { baseURI: 'http://127.0.0.1:3090/hap/' },
  })
  const { Manager } = registration.factory(name => name === 'react' ? react
    : name === 'react-dom' ? { ...require(name), createPortal: element => element } : require(name))
  const server = { id: 'biz-soc-framework', description: '', enabled: true,
    specUrl: 'http://127.0.0.1:18080/v3/api-docs/mcp', authType: 'credential',
    authHeader: 'X-API-Key', apiKey: 'fixture-credential', tools: { mode: 'all', names: [] } }
  const groups = [{ id: 'research', members: [{ serverId: 'platform-compositions', names: ['query_asset_related_alerts'] }] }]
  const writes = []
  const props = { view: 'servers', toolbarTarget: {}, onValidationError: () => { props.view = 'servers' },
    form: { state: { status: 'ready', writable: true, revision: 'r1', value: { servers: [server], groups, sharedToken: '' } } },
    publishedService: { id: 'platform-compositions', platformComposition: true, enabled: true,
      description: '工具组合编排（已发布）', publishedTools: [{ name: 'query_asset_related_alerts' }],
      tools: { mode: 'all', names: ['query_asset_related_alerts'] } },
    write: async (ops, revision) => {
      writes.push({ ops, revision })
      return revision === props.form.state.revision ? { ok: true }
        : { ok: false, error: { message: '配置版本冲突' } }
    },
  }
  let tree
  function render() {
    do {
      cursor = 0; effects = []; changed = false
      tree = Manager(props)
      effects.forEach(effect => effect())
    } while (changed)
    return tree
  }
  function nodes(value = tree) {
    if (Array.isArray(value)) return value.flatMap(item => nodes(item))
    if (!value || typeof value !== 'object') return []
    return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))]
  }
  function text(value) {
    if (Array.isArray(value)) return value.map(text).join('')
    return value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '')
  }
  const button = label => nodes().find(node => node.type === 'button' && text(node) === label)
  const input = label => nodes(nodes().find(node => node.type === 'label' && text(node) === label))
    .find(node => node.type === 'input')
  render()
  return { render, nodes, text, button, input, writes, server, groups,
    refreshValue: (value = props.form.state.value, revision = props.form.state.revision) => {
      props.form.state.value = structuredClone(value)
      props.form.state.revision = revision
      render()
    },
    setView: value => { props.view = value; render() }, getView: () => props.view }
}

test('自动生成的已发布组合服务不参与原生服务保存校验或持久化', async () => {
  const ui = editor()
  assert.ok(ui.button('工具组合编排工具组合编排（已发布） · 已启用'))
  ui.input('描述（可选）').props.onChange({ target: { value: '18080' } })
  ui.render()
  ui.button('工具组合编排工具组合编排（已发布） · 已启用').props.onClick()
  ui.render()
  assert.ok(ui.nodes().some(node => node.props?.service?.id === 'platform-compositions'))
  assert.equal(ui.button('保存更改').props.disabled, false)
  await ui.button('保存更改').props.onClick()
  ui.render()
  assert.equal(ui.writes.length, 1)
  const { ops, revision } = ui.writes[0]
  assert.equal(revision, 'r1')
  assert.deepEqual(ops.find(op => op.path[0] === 'servers').value, [{ ...ui.server, description: '18080' }])
  assert.deepEqual(ops.find(op => op.path[0] === 'groups').value, ui.groups)
  assert.match(ui.text(ui.render()), /配置已保存/)
})

test('列表中的其他服务不完整时定位该服务和具体字段，且不写入配置', async () => {
  const ui = editor()
  ui.button('＋ 新增服务器').props.onClick()
  ui.render()
  ui.input('ID').props.onChange({ target: { value: 'unfinished' } })
  ui.render()
  ui.nodes().find(node => node.type === 'button' && ui.text(node).startsWith('biz-soc-framework')).props.onClick()
  ui.render()
  assert.equal(ui.input('ID').props.value, 'biz-soc-framework')
  ui.setView('groups')
  ui.refreshValue()
  await ui.button('保存更改').props.onClick()
  ui.render()
  assert.equal(ui.writes.length, 0)
  assert.equal(ui.getView(), 'servers')
  assert.equal(ui.input('ID').props.value, 'unfinished')
  assert.match(ui.text(ui.render()), /第 2 项服务：请填写 OpenAPI 接口规范地址/)
  ui.input('ID').props.onChange({ target: { value: ' unfinished ' } })
  ui.render()
  await ui.button('保存更改').props.onClick()
  ui.render()
  assert.equal(ui.writes.length, 0)
  assert.match(ui.text(ui.render()), /第 2 项服务：ID 须为 1–32/)
  ui.refreshValue({ servers: [{ ...ui.server, description: '外部更新' }], groups: ui.groups, sharedToken: '' })
  assert.equal(ui.nodes().filter(node => node.props?.className === 'mcp-list-item').length, 3)
  assert.match(ui.text(ui.render()), /配置已在其他位置更新，当前草稿已保留/)
  assert.equal(ui.input('ID').props.value, ' unfinished ')
  assert.equal(ui.writes.length, 0)
})

test('无修改时同步外部配置，未保存草稿保留输入和原版本并明确拒绝过期保存', async () => {
  const ui = editor()
  ui.refreshValue({ servers: [{ ...ui.server, description: '外部更新' }], groups: ui.groups, sharedToken: '' }, 'r2')
  assert.equal(ui.nodes().filter(node => node.props?.className === 'mcp-list-item').length, 2)
  ui.nodes().find(node => node.type === 'button' && ui.text(node).startsWith('biz-soc-framework')).props.onClick()
  ui.render()
  assert.equal(ui.input('描述（可选）').props.value, '外部更新')
  ui.input('描述（可选）').props.onChange({ target: { value: '本地草稿' } })
  ui.render()
  ui.refreshValue({ servers: [{ ...ui.server, description: '其他编辑者更新' }], groups: ui.groups, sharedToken: '' }, 'r3')
  assert.equal(ui.input('描述（可选）').props.value, '本地草稿')
  assert.match(ui.text(ui.render()), /配置已在其他位置更新，当前草稿已保留/)
  await ui.button('保存更改').props.onClick()
  ui.render()
  assert.equal(ui.writes.length, 1)
  assert.equal(ui.writes[0].revision, 'r2')
  assert.equal(ui.writes[0].ops.find(op => op.path[0] === 'servers').value[0].description, '本地草稿')
  assert.equal(ui.input('描述（可选）').props.value, '本地草稿')
  assert.match(ui.text(ui.render()), /配置版本冲突/)
})

test('MCP 分组入口使用当前站点基址', () => {
  const ui = editor()
  ui.setView('groups')
  assert.match(ui.text(ui.render()), /http:\/\/127\.0\.0\.1:3090\/hap\/mcp\/groups\/research/)
})
