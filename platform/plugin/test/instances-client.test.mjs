import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const source = (await build({ entryPoints: [new URL('../src/instances/client.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })).outputFiles[0].text

function page({ instances = [{ name: 'basic-instance', state: 'running', source_id: 'experiment:EXP-basic-001', port: 3084 }], respond } = {}) {
  const states = [], dependencies = [], cleanups = [], calls = [], copied = [], navigations = []
  let cursor = 0, effects = [], changed = false, tree, listener
  const react = { ...require('react'),
    useState(initial) { const at = cursor++; if (!(at in states)) states[at] = initial; return [states[at], value => { const next = typeof value === 'function' ? value(states[at]) : value; if (!Object.is(next, states[at])) { states[at] = next; changed = true } }] },
    useRef(initial) { const at = cursor++; if (!(at in states)) states[at] = { current: initial }; return states[at] },
    useMemo(factory, deps) { const at = cursor++; if (!dependencies[at] || deps.some((value, index) => !Object.is(value, dependencies[at][index]))) { dependencies[at] = deps; states[at] = factory() } return states[at] },
    useEffect(effect, deps) { const at = cursor++; if (!dependencies[at] || deps.some((value, index) => !Object.is(value, dependencies[at][index]))) { dependencies[at] = deps; effects.push(() => { cleanups[at]?.(); cleanups[at] = effect() }) } },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, URL, require: name => name === 'react' ? react : require(name), window: { location: { hostname: '127.0.0.1' } }, navigator: { clipboard: { async writeText(value) { copied.push(value) } } } })
  const props = {
    onNavigate(target) { navigations.push(target) },
    updates: { subscribe(fn) { listener = fn; return () => { listener = undefined } }, getSnapshot: () => ({ domains: ['instances'] }) },
    rpc: { async call(_channel, endpoint, payload) {
      calls.push({ endpoint, payload })
      const result = await respond?.(endpoint, payload)
      if (result !== undefined) return result
      if (endpoint === 'instances/list') return { ok: true, value: { instances } }
      if (endpoint === 'instances/detail') return { ok: true, value: { instance: instances.find(item => item.name === payload.name), runs: [{ id: `run-${payload.name}`, path: `runs/run-${payload.name}` }], session_scope: { home_volume: `${payload.name}-home`, preserved: true, note: '会话保存在独立 HOME 中。' } } }
      if (endpoint === 'instances/logs') return { ok: true, value: { logs: `${payload.name}: runtime ready` } }
      if (endpoint === 'instances/url') return { ok: true, value: { url: `http://127.0.0.1:${instances.find(item => item.name === payload.name).port}/assistant/`, lan_access: false } }
      if (endpoint === 'instances/preview') return { ok: true, value: { operation: payload.operation, name: payload.name, plan: { source_id: 'experiment:EXP-basic-001' } } }
      if (endpoint === 'instances/run') return { ok: true, value: { ...payload, ok: true } }
      throw new Error('unexpected operation')
    } },
  }
  function render() { let count = 0; do { if (++count > 30) throw new Error('render loop'); cursor = 0; effects = []; changed = false; tree = module.exports.InstancesPage(props); effects.forEach(effect => effect()) } while (changed); return tree }
  async function settle() { for (let index = 0; index < 5; index++) { await new Promise(resolve => setImmediate(resolve)); render() } }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== 'object' || value.props?.hidden) return []; if (typeof value.type === 'function') return nodes(value.type(value.props)); return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))] }
  function text(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.map(text).join(''); return value && typeof value === 'object' ? value.props?.hidden ? '' : text(value.props?.children) : String(value ?? '') }
  const button = name => nodes().find(node => node.type === 'button' && text(node) === name && !node.props.disabled)
  const buttons = name => nodes().filter(node => node.type === 'button' && text(node) === name)
  const tab = name => nodes().find(node => node.props?.role === 'tab' && text(node) === name)
  render()
  return { render, settle, text, nodes, button, buttons, tab, calls, copied, navigations, invalidate() { listener() } }
}

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('实例列表实时刷新保留待确认预览，确认后仅执行原目标一次', async () => {
  const ui = page()
  await ui.settle()
  await ui.button('重启').props.onClick(); await ui.settle()
  assert.ok(ui.button('确认重启'))
  const reads = ui.calls.filter(call => call.endpoint === 'instances/list').length
  ui.invalidate(); await ui.settle()
  assert.ok(ui.calls.filter(call => call.endpoint === 'instances/list').length > reads)
  assert.ok(ui.button('确认重启'), '实时列表更新不能无提示清空用户当前预览')
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/run'), false)
  await ui.button('确认重启').props.onClick(); await ui.settle()
  const writes = ui.calls.filter(call => call.endpoint === 'instances/run')
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ endpoint: 'instances/run', payload: { operation: 'restart', name: 'basic-instance', expected_source_id: 'experiment:EXP-basic-001' } }])
  assert.match(ui.text(), /成功 1 项/)
})

test('实时刷新后的显式取消仍关闭预览，不执行实例操作', async () => {
  const ui = page()
  await ui.settle()
  await ui.button('重启').props.onClick(); await ui.settle()
  ui.invalidate(); await ui.settle()
  ui.button('取消').props.onClick(); ui.render()
  assert.equal(ui.button('确认重启'), undefined)
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/run'), false)
})

test('新建表单默认收起，填写后只请求创建预览，取消确认不创建实例', async () => {
  const ui = page()
  const input = label => ui.nodes().find(node => node.type === 'input' && node.props['aria-label'] === label)
  await ui.settle()
  assert.equal(input('实例名'), undefined)
  ui.button('新建实例').props.onClick(); ui.render()
  assert.equal(ui.buttons('创建预览')[0].props.disabled, true)
  for (const [label, value] of [['实例名', 'new-instance'], ['来源', 'experiment:EXP-basic-001'], ['端口', '3088']]) {
    input(label).props.onChange({ target: { value } }); ui.render()
  }
  await ui.button('创建预览').props.onClick(); await ui.settle()
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.find(call => call.endpoint === 'instances/preview').payload)), { operation: 'create', name: 'new-instance', source: 'experiment:EXP-basic-001', port: 3088 })
  assert.ok(ui.button('确认创建'))
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/run'), false)
  ui.button('取消').props.onClick(); ui.render()
  assert.equal(ui.button('确认创建'), undefined)
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/run'), false)
  ui.button('收起').props.onClick(); ui.render()
  assert.equal(input('实例名'), undefined)
})

test('实例详情按任务切换页签，嵌入地址取自接口且刷新后保留代码与当前页签', async () => {
  const ui = page()
  await ui.settle()
  await ui.button('详情').props.onClick(); await ui.settle()
  assert.ok(ui.nodes().some(node => node.props?.role === 'tablist' && node.props['aria-label'] === '实例详情'))
  assert.equal(ui.tab('概览').props['aria-selected'], true)
  assert.equal(ui.text().includes('basic-instance: runtime ready'), false, '默认概览不铺开运行日志')
  ui.tab('网站嵌入').props.onClick(); ui.render()
  await ui.button('生成 iframe 代码').props.onClick(); await ui.settle()
  assert.equal(ui.calls.filter(call => call.endpoint === 'instances/url').length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(ui.calls.find(call => call.endpoint === 'instances/url').payload)), { name: 'basic-instance' })
  assert.match(ui.text(), /src="http:\/\/127\.0\.0\.1:3084\/assistant\/"/)
  await ui.button('复制嵌入代码').props.onClick(); await ui.settle()
  assert.equal(ui.copied.length, 1)
  assert.match(ui.copied[0], /<iframe\n  src="http:\/\/127\.0\.0\.1:3084\/assistant\/"/)
  ui.invalidate(); await ui.settle()
  assert.equal(ui.tab('网站嵌入').props['aria-selected'], true)
  assert.match(ui.text(), /src="http:\/\/127\.0\.0\.1:3084\/assistant\/"/)
  assert.equal(ui.calls.filter(call => call.endpoint === 'instances/url').length, 1, '后台刷新不能重新生成或清空用户已取得的嵌入代码')
  ui.tab('运行日志').props.onClick(); ui.render()
  assert.match(ui.text(), /basic-instance: runtime ready/)
})

test('切换实例重置为概览，不沿用前一个实例的嵌入代码或日志', async () => {
  const ui = page({ instances: [
    { name: 'basic-instance', state: 'running', source_id: 'experiment:EXP-basic-001', port: 3084 },
    { name: 'other-instance', state: 'running', source_id: 'experiment:EXP-other-002', port: 3085 },
  ] })
  await ui.settle()
  await ui.buttons('详情')[0].props.onClick(); await ui.settle()
  ui.tab('网站嵌入').props.onClick(); ui.render()
  await ui.button('生成 iframe 代码').props.onClick(); await ui.settle()
  ui.tab('运行日志').props.onClick(); ui.render()
  assert.match(ui.text(), /basic-instance: runtime ready/)
  await ui.buttons('详情')[1].props.onClick(); await ui.settle()
  assert.equal(ui.tab('概览').props['aria-selected'], true)
  assert.equal(ui.text().includes('basic-instance: runtime ready'), false)
  ui.tab('网站嵌入').props.onClick(); ui.render()
  assert.equal(ui.button('复制嵌入代码'), undefined)
  assert.equal(ui.text().includes('src="http://127.0.0.1:3084/assistant/"'), false)
  ui.tab('运行日志').props.onClick(); ui.render()
  assert.match(ui.text(), /other-instance: runtime ready/)
})

test('关闭详情后忽略迟到的后台详情与嵌入地址回执', async () => {
  const pendingDetail = deferred(), pendingUrl = deferred()
  let detailReads = 0
  const ui = page({ respond(endpoint) {
    if (endpoint === 'instances/detail' && ++detailReads > 1) return pendingDetail.promise
    if (endpoint === 'instances/url') return pendingUrl.promise
  } })
  await ui.settle()
  await ui.button('详情').props.onClick(); await ui.settle()
  ui.tab('网站嵌入').props.onClick(); ui.render()
  ui.button('生成 iframe 代码').props.onClick(); await ui.settle()
  ui.invalidate(); await ui.settle()
  ui.button('关闭详情').props.onClick(); ui.render()
  pendingDetail.resolve({ ok: true, value: { instance: { name: 'basic-instance', state: 'running', port: 3084 }, runs: [], session_scope: { note: '迟到的详情' } } })
  pendingUrl.resolve({ ok: true, value: { url: 'http://127.0.0.1:3084/assistant/', lan_access: false } })
  await ui.settle()
  assert.equal(ui.tab('概览'), undefined, '关闭后的迟到回执不能重新打开详情')
  assert.equal(ui.text().includes('迟到的详情'), false)
  assert.equal(ui.text().includes('<iframe'), false)
})

test('实例登记消失时清理已生成的嵌入代码，也忽略进行中地址请求的迟到回执', async () => {
  const instances = [{ name: 'basic-instance', state: 'running', port: 3084 }]
  const pendingUrl = deferred()
  let registered = true, delayUrl = false
  const ui = page({ instances, respond(endpoint) {
    if (endpoint === 'instances/list') return { ok: true, value: { instances: registered ? instances : [] } }
    if (endpoint === 'instances/url' && delayUrl) return pendingUrl.promise
  } })
  await ui.settle()
  await ui.button('详情').props.onClick(); await ui.settle()
  ui.tab('网站嵌入').props.onClick(); ui.render()
  await ui.button('生成 iframe 代码').props.onClick(); await ui.settle()
  assert.ok(ui.button('复制嵌入代码'))

  registered = false
  ui.invalidate(); await ui.settle()
  assert.match(ui.text(), /登记已不存在/)
  assert.equal(ui.button('复制嵌入代码'), undefined)
  assert.equal(ui.text().includes('<iframe'), false)
  assert.equal(ui.buttons('生成 iframe 代码')[0].props.disabled, true)

  registered = true
  ui.invalidate(); await ui.settle()
  delayUrl = true
  ui.button('生成 iframe 代码').props.onClick(); await ui.settle()
  registered = false
  ui.invalidate(); await ui.settle()
  pendingUrl.resolve({ ok: true, value: { url: 'http://127.0.0.1:3084/assistant/', lan_access: false } })
  await ui.settle()
  assert.match(ui.text(), /登记已不存在/)
  assert.equal(ui.button('复制嵌入代码'), undefined)
  assert.equal(ui.text().includes('<iframe'), false, '登记消失后迟到的地址不能重新形成嵌入代码')
  assert.equal(ui.buttons('生成 iframe 代码')[0].props.disabled, true)
})

test('日志失败保留详情概览，错误仅在运行日志中显示；未运行或无端口时禁止生成嵌入代码', async () => {
  const ui = page({ instances: [
    { name: 'stopped-instance', state: 'stopped', port: 3084 },
    { name: 'no-port-instance', state: 'running' },
  ], respond(endpoint) {
    if (endpoint === 'instances/logs') return { ok: false, error: { message: 'container logs unavailable' } }
  } })
  await ui.settle()
  for (let index = 0; index < 2; index++) {
    await ui.buttons('详情')[index].props.onClick(); await ui.settle()
    assert.equal(ui.tab('概览').props['aria-selected'], true)
    assert.equal(ui.text().includes('container logs unavailable'), false)
    ui.tab('运行日志').props.onClick(); ui.render()
    assert.match(ui.text(), /container logs unavailable/)
    ui.tab('网站嵌入').props.onClick(); ui.render()
    assert.equal(ui.buttons('生成 iframe 代码')[0].props.disabled, true)
  }
  assert.equal(ui.calls.some(call => call.endpoint === 'instances/url'), false)
})
