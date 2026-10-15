import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const script = new URL('./run-comparison.ts', import.meta.url).pathname
const route = { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'off' }
function view(id, actualRoutes = [route]) {
  return {
    run_id: id, run_path: `runs/${id}`,
    manifest: { agent_id: 'basic', status: 'completed' },
    source: { executor: 'api', model: 'deepseek-flash', review_mode: 'none',
      configured_capabilities: {}, dependency_env: {}, git_version: { commit: 'fixture', dirty: false } },
    image: { image_build_fingerprint: 'fixture', local_image_id: 'fixture' },
    cases: [{ case_id: 'U-BASIC-001', frozen: { inputs: ['查询基础状态'] },
      trials: [{ execution_status: 'completed', verdict: 'passed', observation: '基础状态已展示' }],
      output: ['基础状态已展示'], actual_routes: actualRoutes, review: null,
      load_observation: { preset_matches: true, workspace_matches: true }, evidence: [] }], missing: [],
  }
}
function compare(left, right) {
  const input = JSON.stringify({ left, right })
  const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.stringify({ left, right }), input, '比较不得改写来源对象')
  return JSON.parse(result.stdout)
}

test('完整相同路由保留观察性对照且显示实际provider、model和off', () => {
  const result = compare(view('old'), view('new'))
  assert.equal(result.comparable, true)
  assert.equal(result.causal_comparable, true)
  assert.deepEqual(result.limits, [])
  assert.match(result.markdown, /deepseek \/ deepseek-flash \/ reasoningEffort=off/)
  assert.match(result.markdown, /仍需结合实验设计判断/)
})

for (const field of ['provider', 'model', 'reasoningEffort']) {
  test(`记录中的${field}差异不能归因于Harness`, () => {
    const result = compare(view('old'), view('new', [{ ...route, [field]: 'different' }]))
    assert.equal(result.comparable, true)
    assert.equal(result.causal_comparable, false)
    assert.ok(result.limits.some(item => item.includes('实际模型路由不同')))
    assert.deepEqual(result.cases[0].left_actual_routes, [route])
    assert.deepEqual(result.cases[0].right_actual_routes, [{ ...route, [field]: 'different' }])
  })
}

test('off与未记录、双方均未记录必须分别保留未知限制', () => {
  const unknown = { provider: route.provider, model: route.model }
  const missing = compare(view('old'), view('new', [unknown]))
  assert.equal(missing.causal_comparable, false)
  assert.ok(missing.limits.some(item => /right 第 1 轮实际模型路由未记录 reasoningEffort/.test(item)))
  assert.ok(missing.limits.some(item => item.includes('实际模型路由不同')))
  const bothMissing = compare(view('old', [unknown]), view('new', [unknown]))
  assert.equal(bothMissing.comparable, true)
  assert.equal(bothMissing.causal_comparable, false)
  assert.equal(bothMissing.limits.filter(item => item.includes('未记录 reasoningEffort')).length, 2)
})

test('逐轮缺失不能在过滤模型名后被折叠为相同路由', () => {
  const result = compare(view('old', [route, null]), view('new', [route]))
  assert.equal(result.comparable, true)
  assert.equal(result.causal_comparable, false)
  assert.ok(result.limits.some(item => /left 第 2 轮实际模型路由未记录 provider \/ model \/ reasoningEffort/.test(item)))
  assert.ok(result.limits.some(item => item.includes('实际模型路由不同')))
  for (const routes of [null, []]) {
    const unknown = compare(view('old', routes), view('new', routes))
    assert.equal(unknown.causal_comparable, false)
    assert.equal(unknown.limits.filter(item => item.includes('缺少实际模型路由记录')).length, 2)
  }
})
