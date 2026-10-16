import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const compiled = await build({ entryPoints: [new URL('../src/agents/compute-variants.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })
function panel(eligible = false, hasPlan = true, readContext) {
  const states = [], deps = [], cleanups = [], calls = [], tasks = []
  let cursor = 0, effects = [], changed = false, tree
  const react = { ...require('react'),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value; if (!Object.is(next, states[index])) { states[index] = next; changed = true } }] },
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index] },
    useEffect(effect, values) { const index = cursor++; if (!deps[index] || values.some((value, at) => value !== deps[index][at])) { deps[index] = values; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() }) } },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, URLSearchParams, require: name => name === 'react' ? react : require(name) })
  const context = { experiment_id: 'EXP-alpha-002', agent_id: 'alpha', parent_ref: `git:${'a'.repeat(40)}`, parent_experiment_id: 'EXP-alpha-001', fixed_parent_ref: `git:${'a'.repeat(40)}`, variant_kind: 'exploratory', decision: 'inconclusive', plan: { strategy: '减少重复调用', case_hashes: { 'U-ONE-001': 'digest' }, critical_case_ids: ['U-ONE-001'], min_runs_per_case: 2, max_pass_rate_drop_pp: 0, resource_metric: 'total_tokens', min_resource_reduction_pct: 10 }, cases: [{ case_id: 'U-ONE-001', title: '查询状态' }], runs: [{ run_id: 'parent-run', experiment_id: 'EXP-alpha-001', status: 'completed' }, { run_id: 'variant-run', experiment_id: 'EXP-alpha-002', status: 'completed' }] }
  if (!hasPlan) context.plan = null
  const props = { onAssistant: async (task, context) => { tasks.push({task, context}) }, agentId: 'alpha', experimentId: 'EXP-alpha-002', versions: [{ id: 'EXP-alpha-001' }, { id: 'EXP-alpha-002' }], rpc: { call: async (_channel, method, body) => {
    calls.push({ method, body })
    if (method.endsWith('/context')) return readContext ? readContext(context) : { ok: true, value: context }
    if (method.endsWith('/preview')) return { ok: true, value: { parent_experiment_id: body.parent_experiment_id, preview_sha256: 'preview-digest', plan: { case_hashes: { 'U-ONE-001': 'digest' }, min_runs_per_case: 2, resource_metric: 'total_tokens', min_resource_reduction_pct: 10 } } }
    if (method.endsWith('/create')) return { ok: true, value: { experiment_id: 'EXP-alpha-003' } }
    if (method.endsWith('/compare')) return { ok: true, value: { quality: { passed: true, cases: [{ case_id: 'U-ONE-001', parent_runs: 1, variant_runs: 1, parent_pass_rate: 100, variant_pass_rate: 100, critical: true, quality_passed: true }] }, resources: Object.fromEntries(['model_calls', 'input_tokens', 'output_tokens', 'total_tokens', 'elapsed_ms'].map(key => [key, { parent: 200, variant: eligible ? 100 : null, reduction_pct: eligible ? 50 : null }])), comparability: { passed: eligible, limits: eligible ? [] : ['独立 Run 数量不足'] }, resource_evidence: { passed: eligible, limits: eligible ? [] : ['缺少完整 token'] }, eligible_for_end: eligible, comparison_sha256: 'compared', notes: ['仅限冻结任务范围。'] } }
    if (method.endsWith('/confirm')) return { ok: true, value: { decision: body.decision, variant_kind: body.decision === 'end' ? 'end' : 'exploratory' } }
    throw new Error('unexpected')
  } } }
  function render() { let count = 0; do { if (++count > 30) throw new Error('render did not settle'); cursor = 0; effects = []; changed = false; tree = module.exports.ComputeVariantsPanel(props); effects.forEach(effect => effect()) } while (changed); return tree }
  async function settle() { for (let index = 0; index < 6; index++) { render(); await new Promise(resolve => setImmediate(resolve)) }; render() }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(item => nodes(item)); if (!value || typeof value !== 'object') return []; return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))] }
  function text(value) { if (!arguments.length) value = tree; return Array.isArray(value) ? value.map(item => text(item)).join('') : value && typeof value === 'object' ? text(value.props?.children ?? '') : String(value ?? '') }
  const label = title => nodes().find(node => node.props?.['aria-label'] === title)
  const button = title => nodes().find(node => node.type === 'button' && text(node) === title)
  const change = (title, value) => { label(title).props.onChange({ target: { value, checked: value } }); render() }
  render()
  return { settle, text, calls, tasks, change, button, nodes, render, cleanup: () => cleanups.forEach(fn => fn?.()) }
}
async function compare(ui) { await ui.settle(); ui.change('parent parent-run', true); ui.change('variant variant-run', true); ui.button('比较实际效果与资源').props.onClick(); await ui.settle() }

test('证据不足显示未知和缺口，人工勾选也不能启用 end', async () => {
  const ui = panel()
  try { await compare(ui); assert.match(ui.text(), /未知/); assert.match(ui.text(), /独立 Run 数量不足/); assert.match(ui.text(), /数据仓库提交冻结计划/)
    ui.change('已审阅完整效果与工具结果', true); ui.change('变体研究结论', '需要补充独立运行。')
    assert.equal(ui.button('确认近似等效并标记 end').props.disabled, true)
    ui.button('记录证据不足').props.onClick(); await ui.settle()
    assert.equal(ui.calls.find(call => call.method.endsWith('/confirm')).body.decision, 'inconclusive')
  } finally { ui.cleanup() }
})

test('end 显式确认绑定比较摘要，选择Run变化后旧结果失效', async () => {
  const ui = panel(true)
  try { await compare(ui); assert.equal(ui.button('确认近似等效并标记 end').props.disabled, true)
    ui.change('已审阅完整效果与工具结果', true); ui.change('变体研究结论', '已核对完整输出。')
    assert.equal(ui.button('确认近似等效并标记 end').props.disabled, false)
    ui.button('确认近似等效并标记 end').props.onClick(); await ui.settle()
    const sent = ui.calls.find(call => call.method.endsWith('/confirm')).body
    assert.equal(sent.comparison_sha256, 'compared'); assert.equal(sent.human_confirmed, true)
    ui.button('比较实际效果与资源').props.onClick(); await ui.settle(); ui.change('parent parent-run', false)
    assert.equal(ui.button('确认近似等效并标记 end'), undefined)
  } finally { ui.cleanup() }
})


test('算力变体AI入口绑定专用Skill、版本与已选择Run，不直接执行写操作', async () => {
  const ui = panel()
  try {
    await ui.settle(); ui.change('parent parent-run', true); ui.change('variant variant-run', true)
    ui.button('请 AI 分析算力变体').props.onClick(); await ui.settle()
    const task = ui.tasks[0]
    assert.equal(task.context.skill, 'compute-variant-research')
    assert.equal(task.context.experiment_id, 'EXP-alpha-002')
    assert.deepEqual(Array.from(task.context.parent_run_ids), ['parent-run'])
    assert.deepEqual(Array.from(task.context.variant_run_ids), ['variant-run'])
    assert.match(task.task, /不替我确认/)
    assert.equal(ui.calls.some(call => /\/(create|confirm)$/.test(call.method)), false)
  } finally { ui.cleanup() }
})


test('AI为主入口，手动计划先预览后确认，表单修改使预览失效', async () => {
  const ui = panel(false, false)
  try {
    await ui.settle()
    assert.equal(ui.button('请 AI 策划算力变体').props.className, 'compute-primary')
    assert.equal(ui.button('从固定父版派生'), undefined)
    ui.button('手动制定计划').props.onClick(); await ui.settle()
    ui.change('策略与研究问题', '减少重复查询并保留关键结果')
    ui.button('预览派生计划').props.onClick(); await ui.settle()
    assert.equal(ui.calls.some(call => call.method.endsWith('/create')), false)
    assert.ok(ui.button('确认创建探索性变体'))
    ui.nodes().find(node => node.type === 'fieldset' && node.props.id === 'compute-manual-plan').props.onChange(); ui.render()
    assert.equal(ui.button('确认创建探索性变体'), undefined)
    ui.button('预览派生计划').props.onClick(); await ui.settle()
    ui.button('确认创建探索性变体').props.onClick(); await ui.settle()
    assert.equal(ui.calls.find(call => call.method.endsWith('/create')).body.expected_preview_sha256, 'preview-digest')
  } finally { ui.cleanup() }
})

test('初次读取期间禁止刷新竞态，失败后刷新恢复完整表单默认值', async () => {
  let rejectInitial, reads = 0
  const ui = panel(false, false, context => ++reads === 1
    ? new Promise((_, reject) => { rejectInitial = reject })
    : { ok: true, value: context })
  try {
    await ui.settle()
    assert.equal(ui.button('刷新').props.disabled, true)
    assert.equal(ui.button('手动制定计划').props.disabled, true)
    rejectInitial(new Error('暂时无法读取'))
    await ui.settle()
    assert.equal(ui.button('刷新').props.disabled, false)
    ui.button('刷新').props.onClick(); await ui.settle()
    ui.button('手动制定计划').props.onClick(); await ui.settle()
    ui.change('策略与研究问题', '减少重复查询')
    assert.equal(ui.button('预览派生计划').props.disabled, false)
    ui.button('预览派生计划').props.onClick(); await ui.settle()
    const input = ui.calls.find(call => call.method.endsWith('/preview')).body
    assert.equal(input.parent_ref, `git:${'a'.repeat(40)}`)
    assert.deepEqual(Array.from(input.case_ids), ['U-ONE-001'])
  } finally { ui.cleanup() }
})
