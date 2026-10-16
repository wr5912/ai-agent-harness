import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const compiled = await build({ entryPoints: [new URL('../src/assistant/client.tsx', import.meta.url).pathname], write: false, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })
let proposal
const jsx = (type, props) => ({ type, props }), module = { exports: {} }
runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require(name) {
  if (name === 'react') return { ...require('react'), useState: initial => [initial, () => {}], useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
  return require(name)
} })
const assistant = { subscribe: () => () => {}, getSnapshot: () => ({ sessionId: 's', status: { proposals: [proposal] } }) }
function visible(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node !== 'object') return String(node)
  if (Array.isArray(node)) return node.map(visible).join(' ')
  if (typeof node.type === 'function') return visible(node.type(node.props))
  if (node.type === 'details' && !node.props.open) return visible([node.props.children].flat().find(child => child?.type === 'summary'))
  return visible(node.props?.children)
}
const render = () => visible(module.exports.AssistantOperations({ assistant, sessionId: 's', rpc: { call() { assert.fail('只渲染确认摘要，不执行操作') } } }))

test('特性、修改和评测确认首屏同时明确智能体与版本，完整证据仍折叠', () => {
  const id = 'EXP-inspection-delivery-demo-001-rf841e4415364'
  for (const change of [
    { action: 'features/apply', preview: { experiment_id: id, features: [{}], evidence_refs: ['只在详情展示'] } },
    { action: 'edit/apply', input: { experiment_id: id, edits: [{}] }, preview: {} },
    { action: 'eval/start', input: { source: `experiment:${id}`, cases: ['U-BUSINESS-001'] }, preview: {} },
  ]) {
    proposal = { id: 'p', domain: 'agents', state: 'awaiting_confirmation', ...change }
    const text = render()
    assert.match(text, /智能体“inspection-delivery-demo”的版本 001/)
    assert.match(text, /暂不执行/)
    assert.doesNotMatch(text, /只在详情展示|rf841e4415364/)
  }
  proposal = { ...proposal, preview: { agent_name: '台账巡检助手' } }
  assert.match(render(), /智能体“台账巡检助手”的版本 001/)
  proposal = { ...proposal, preview: { agent_id: 'actual-agent' } }
  assert.match(render(), /智能体“actual-agent”的版本 001/)
})
