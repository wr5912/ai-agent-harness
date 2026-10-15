import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const source = (await build({ entryPoints: [new URL('../src/instances/client.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })).outputFiles[0].text

function page() {
  const states = [], dependencies = [], cleanups = [], calls = []
  let cursor = 0, effects = [], changed = false, tree, listener
  const react = { ...require('react'),
    useState(initial) { const at = cursor++; if (!(at in states)) states[at] = initial; return [states[at], value => { const next = typeof value === 'function' ? value(states[at]) : value; if (!Object.is(next, states[at])) { states[at] = next; changed = true } }] },
    useRef(initial) { const at = cursor++; if (!(at in states)) states[at] = { current: initial }; return states[at] },
    useMemo(factory, deps) { const at = cursor++; if (!dependencies[at] || deps.some((value, index) => !Object.is(value, dependencies[at][index]))) { dependencies[at] = deps; states[at] = factory() } return states[at] },
    useEffect(effect, deps) { const at = cursor++; if (!dependencies[at] || deps.some((value, index) => !Object.is(value, dependencies[at][index]))) { dependencies[at] = deps; effects.push(() => { cleanups[at]?.(); cleanups[at] = effect() }) } },
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports, URL, require: name => name === 'react' ? react : require(name), window: { location: { hostname: '127.0.0.1' } } })
  const props = {
    updates: { subscribe(fn) { listener = fn; return () => { listener = undefined } }, getSnapshot: () => ({ domains: ['instances'] }) },
    rpc: { async call(_channel, endpoint, payload) {
      calls.push({ endpoint, payload })
      if (endpoint === 'instances/list') return { ok: true, value: { instances: [{ name: 'basic-instance', state: 'running', source_id: 'experiment:EXP-basic-001', port: 3084 }] } }
      if (endpoint === 'instances/preview') return { ok: true, value: { operation: payload.operation, name: payload.name, plan: { source_id: 'experiment:EXP-basic-001' } } }
      if (endpoint === 'instances/run') return { ok: true, value: { ...payload, ok: true } }
      throw new Error('unexpected operation')
    } },
  }
  function render() { let count = 0; do { if (++count > 30) throw new Error('render loop'); cursor = 0; effects = []; changed = false; tree = module.exports.InstancesPage(props); effects.forEach(effect => effect()) } while (changed); return tree }
  async function settle() { for (let index = 0; index < 5; index++) { await new Promise(resolve => setImmediate(resolve)); render() } }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(nodes); if (!value || typeof value !== 'object') return []; if (typeof value.type === 'function') return nodes(value.type(value.props)); return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))] }
  function text(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.map(text).join(''); return value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '') }
  const button = name => nodes().find(node => node.type === 'button' && text(node) === name && !node.props.disabled)
  render()
  return { render, settle, text, button, calls, invalidate() { listener() } }
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
