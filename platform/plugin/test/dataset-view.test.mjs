import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const compiled = await build({ entryPoints: [new URL('../src/evaluation/dataset-view.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })
const baseQuestion = { type: 'choice', instructions: '选择基本查询', criteria: { read: '读取基本状态', ask: '补充测试标识' }, label: 'read', src: 'basic' }
const record = (id, instruction) => ({ state: { request: '查询基础测试资产' }, questions: { decision: { ...baseQuestion, instructions: instruction } }, _meta: { id, label_status: 'suggested', label_basis: '待核对的建议', group_id: 'task-basic', split: 'unassigned', cutoff: { line: 41, session_log: 'session.v4.jsonl' }, trace_path: 'evidence/C-1/trace.jsonl', observed_action: { name: 'get_inspection_result', arguments: { runId: 'basic-run' } } } })
function workbench({ handler } = {}) {
  const states = [], deps = [], cleanups = [], calls = [], downloads = [], blobs = [], dirty = [], confirms = [], answers = []
  let cursor, effects, changed, tree, errorMessage = ''
  const documents = new Map(['dataset-a', 'dataset-b'].map((id, index) => [id, { dataset: { id, run_id: 'run-a', records: [record(`${id}-1`, `第一题 ${index}`), record(`${id}-2`, `第二题 ${index}`)], extractor: {}, skipped: [] }, sha256: `${id}-v1` }]))
  const updateListeners = new Set()
  const updates = { subscribe: callback => { updateListeners.add(callback); return () => updateListeners.delete(callback) }, getSnapshot: () => ({ domains: ['agents'] }) }
  const react = {
    ...require('react'),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], next => { const value = typeof next === 'function' ? next(states[index]) : next; if (!Object.is(value, states[index])) { states[index] = value; changed = true } }] },
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index] },
    useEffect(effect, dependencies) { const index = cursor++; if (!deps[index] || dependencies.some((value, at) => value !== deps[index][at])) { deps[index] = dependencies; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() }) } },
  }
  const window = { confirm: text => { confirms.push(text); return answers.shift() ?? true }, document: { createElement: () => { const link = { click: () => downloads.push({ href: link.href, filename: link.download }) }; return link } } }
  const module = { exports: {} }
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => name === 'react' ? react : require(name), window, Blob, URL: { createObjectURL: blob => { blobs.push(blob); return `blob:${blobs.length}` }, revokeObjectURL() {} }, setTimeout: callback => { callback(); return 1 } })
  const defaultHandler = async (action, input) => {
    if (action === 'list') return { datasets: [...documents.values()].map(value => ({ id: value.dataset.id, created_at: '2026-10-16', count: value.dataset.records.length, reviewed: value.dataset.records.filter(item => item._meta.label_status === 'reviewed').length })) }
    if (action === 'read') return structuredClone(documents.get(input.dataset_id))
    if (action === 'update') {
      if (errorMessage) throw new Error(errorMessage)
      const value = documents.get(input.dataset_id), item = value.dataset.records.find(entry => entry._meta.id === input.record_id)
      assert.equal(input.expected_sha256, value.sha256)
      item.questions.decision = structuredClone(input.question); item._meta = { ...item._meta, label_basis: input.label_basis, group_id: input.group_id, split: input.split, label_status: input.label_status, decision_time_reviewed: input.label_status === 'reviewed' && input.decision_time_reviewed === true }
      value.sha256 += '-next'; return structuredClone(value)
    }
    if (action === 'export') return { filename: `${input.dataset_id}-${input.kind}.jsonl`, count: input.kind === 'candidates' ? 2 : 1, content: `${JSON.stringify({ kind: input.kind, saved: true })}\n` }
    throw new Error(`unknown ${action}`)
  }
  const props = { runId: 'run-a', active: true, updates, onDirty: value => dirty.push(value), rpc: { call: async (_channel, endpoint, input) => {
    const action = endpoint.replace('agents/datasets/', ''); calls.push({ action, input })
    try { return { ok: true, value: await (handler ? handler(action, input, defaultHandler) : defaultHandler(action, input)) } } catch (error) { const [code, ...message] = error.message.split(': '); return { ok: false, error: { code, message: message.join(': ') } } }
  } } }
  function render() { let turns = 0; do { if (++turns > 60) throw new Error('render did not settle'); cursor = 0; effects = []; changed = false; tree = module.exports.DecisionDatasetView(props); effects.forEach(effect => effect()) } while (changed); return tree }
  async function settle() { for (let index = 0; index < 7; index++) { render(); await new Promise(resolve => setImmediate(resolve)) }; return render() }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(item => nodes(item)); if (!value || typeof value !== 'object') return []; return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))] }
  function text(value) { if (!arguments.length) value = tree; return Array.isArray(value) ? value.map(item => text(item)).join('') : value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '') }
  const byLabel = label => nodes().find(node => node.props?.['aria-label'] === label)
  const button = title => nodes().find(node => node.type === 'button' && text(node) === title)
  function change(label, value) { byLabel(label).props.onChange({ target: { value } }); render() }
  function check(value = true) { byLabel('已核对决策时点与题目一致').props.onChange({ target: { checked: value } }); render() }
  function review() { check(); button('确认标签并复核本条').props.onClick() }
  render()
  return { settle, render, nodes, text, byLabel, button, change, check, review, calls, downloads, blobs, dirty, confirms, answers, documents, notify() { [...updateListeners].forEach(listener => listener()) }, setError(value) { errorMessage = value }, setRun(value) { props.runId = value; render() }, cleanup() { cleanups.forEach(cleanup => cleanup?.()) } }
}
async function open(ui, id = 'dataset-a') { await ui.settle(); ui.change('样本批次', id); await ui.settle() }

test('保存冲突保留问题、标签依据与分组草稿，未保存内容不冒充成功', async () => {
  const ui = workbench()
  try {
    await open(ui); ui.change('决策问题 JSON', JSON.stringify({ ...baseQuestion, label: 'ask' })); ui.change('决策标签依据', '需要保留的人工依据'); ui.change('决策任务分组', 'task-revised'); ui.change('决策数据用途', 'development'); ui.setError('conflict: 样本已被其他任务修改')
    ui.button('保存修改，待复核').props.onClick(); await ui.settle()
    assert.match(ui.text(), /草稿已保留/); assert.equal(ui.byLabel('决策标签依据').props.value, '需要保留的人工依据'); assert.equal(ui.byLabel('决策任务分组').props.value, 'task-revised')
    assert.equal(JSON.parse(ui.byLabel('决策问题 JSON').props.value).label, 'ask'); assert.equal(ui.dirty.at(-1), true)
    assert.equal(ui.calls.find(item => item.action === 'update').input.expected_sha256, 'dataset-a-v1')
    assert.equal(ui.documents.get('dataset-a').dataset.records[0]._meta.label_status, 'suggested')
  } finally { ui.cleanup() }
})

test('人工复核仅改变当前样本，训练下载与候选下载使用不同保存结果', async () => {
  const ui = workbench()
  try {
    await open(ui); assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, true)
    ui.button('下载候选 JSONL').props.onClick(); await ui.settle()
    ui.review(); await ui.settle()
    const records = ui.documents.get('dataset-a').dataset.records
    assert.equal(records[0]._meta.label_status, 'reviewed'); assert.equal(records[1]._meta.label_status, 'suggested')
    assert.equal(ui.calls.find(item => item.action === 'update').input.record_id, 'dataset-a-1')
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, false)
    ui.button('下载已复核训练 JSONL').props.onClick(); await ui.settle()
    assert.deepEqual(ui.calls.filter(item => item.action === 'export').map(item => item.input.kind), ['candidates', 'training'])
    assert.deepEqual(ui.downloads.map(item => item.filename), ['dataset-a-candidates.jsonl', 'dataset-a-training.jsonl'])
    assert.equal(JSON.parse(await ui.blobs[1].text()).kind, 'training')
  } finally { ui.cleanup() }
})

test('非法 JSON 不发送更新，分组跨 split 错误直接显示且保留草稿', async () => {
  const ui = workbench()
  try {
    await open(ui); ui.change('决策问题 JSON', '{broken'); ui.review(); await ui.settle()
    assert.match(ui.text(), /草稿已保留/); assert.equal(ui.calls.filter(item => item.action === 'update').length, 0)
    ui.change('决策问题 JSON', JSON.stringify(baseQuestion)); ui.change('决策数据用途', 'test'); ui.setError('invalid_dataset: 同一任务分组不能跨训练、开发、校准与测试用途')
    ui.review(); await ui.settle()
    assert.match(ui.text(), /同一任务分组不能跨/); assert.equal(ui.byLabel('决策数据用途').props.value, 'test')
  } finally { ui.cleanup() }
})

test('有草稿时拒绝切换保留当前样本，迟到的旧批次响应不覆盖新批次', async () => {
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const ui = workbench({ handler: async (action, input, original) => { if (action === 'read' && input.dataset_id === 'dataset-a') await waiting; return original(action, input) } })
  try {
    await ui.settle(); ui.change('样本批次', 'dataset-a'); await ui.settle(); ui.change('样本批次', 'dataset-b'); await ui.settle(); release(); await ui.settle()
    assert.equal(ui.byLabel('样本批次').props.value, 'dataset-b'); assert.equal(JSON.parse(ui.byLabel('决策问题 JSON').props.value).instructions, '第一题 1')
    ui.change('决策标签依据', '保留草稿'); ui.answers.push(false); ui.change('样本批次', 'dataset-a'); await ui.settle()
    assert.equal(ui.byLabel('样本批次').props.value, 'dataset-b'); assert.equal(ui.byLabel('决策标签依据').props.value, '保留草稿')
    const other = ui.nodes().find(node => node.type === 'button' && ui.text(node).includes('第二题 1'))
    ui.answers.push(false); other.props.onClick(); await ui.settle(); assert.equal(ui.byLabel('决策标签依据').props.value, '保留草稿')
  } finally { ui.cleanup() }
})

test('切换 Run 后旧读取响应不回填原批次，迟到导出也不污染当前消息', async () => {
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const ui = workbench({ handler: async (action, input, original) => { if (action === 'export') await waiting; return original(action, input) } })
  try {
    await open(ui); ui.button('下载候选 JSONL').props.onClick(); await ui.settle(); ui.setRun('run-b'); await ui.settle(); release(); await ui.settle()
    assert.equal(ui.byLabel('样本批次').props.value, '')
    assert.ok(!ui.text().includes('已下载 2 条候选样本'), '前一 Run 的迟到导出回执不能显示为当前操作结果')
  } finally { ui.cleanup() }
})

test('刷新时干净记录更新，脏草稿收到冲突提示并可显式重读最新摘要', async () => {
  const ui = workbench()
  try {
    await open(ui)
    const server = ui.documents.get('dataset-a')
    server.dataset.records[0]._meta.label_basis = '另一窗口保存的新依据'; server.sha256 = 'dataset-a-v2'
    ui.button('刷新样本').props.onClick(); await ui.settle()
    assert.equal(ui.byLabel('决策标签依据').props.value, '另一窗口保存的新依据')
    ui.change('决策标签依据', '当前窗口的未保存草稿')
    server.dataset.records[0]._meta.label_basis = '另一窗口第二次保存'; server.sha256 = 'dataset-a-v3'
    ui.button('刷新样本').props.onClick(); await ui.settle()
    assert.equal(ui.byLabel('决策标签依据').props.value, '当前窗口的未保存草稿')
    assert.match(ui.text(), /其他窗口修改.*草稿保留/)
    ui.button('重新读取本批次').props.onClick(); await ui.settle()
    assert.equal(ui.byLabel('决策标签依据').props.value, '另一窗口第二次保存')
    ui.change('决策标签依据', '在新版本上继续修改')
    ui.button('保存修改，待复核').props.onClick(); await ui.settle()
    assert.equal(ui.calls.filter(item => item.action === 'update').at(-1).input.expected_sha256, 'dataset-a-v3')
  } finally { ui.cleanup() }
})

test('刷新先读取旧快照后延迟，保存复核新版本后旧响应不能撤销复核或回退摘要', async () => {
  let hold = false, release
  const waiting = new Promise(resolve => { release = resolve })
  const ui = workbench({ handler: async (action, input, original) => {
    if (action === 'read' && hold) { hold = false; const old = await original(action, input); await waiting; return old }
    return original(action, input)
  } })
  try {
    await open(ui); hold = true; ui.button('刷新样本').props.onClick(); await ui.settle()
    ui.review(); await ui.settle()
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, false)
    release(); await ui.settle()
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, false, '迟到 v1 不能覆盖已保存的 reviewed v2')
    ui.change('决策标签依据', '基于新摘要继续编辑'); ui.button('保存修改，待复核').props.onClick(); await ui.settle()
    assert.equal(ui.calls.filter(item => item.action === 'update').at(-1).input.expected_sha256, 'dataset-a-v1-next')
  } finally { ui.cleanup() }
})

test('原订阅闭包在记录切换和保存后检查当前摘要，未变化文件不误报冲突', async () => {
  const ui = workbench()
  try {
    await open(ui); ui.review(); await ui.settle()
    ui.change('决策标签依据', '当前未保存的依据')
    ui.notify(); await ui.settle()
    assert.equal(ui.byLabel('决策标签依据').props.value, '当前未保存的依据')
    assert.ok(!ui.text().includes('其他窗口修改'), '订阅创建时的旧 document 不得与当前未变化文件误判冲突')
  } finally { ui.cleanup() }
})

test('已复核测试样本仍保留候选下载，训练下载不会因 reviewed 状态自动启用', async () => {
  const ui = workbench()
  try {
    await open(ui)
    ui.change('决策数据用途', 'test')
    ui.review(); await ui.settle()
    assert.equal(ui.documents.get('dataset-a').dataset.records[0]._meta.label_status, 'reviewed')
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, true)
    assert.ok(ui.button('下载候选 JSONL'))
  } finally { ui.cleanup() }
})

test('复核先显示当前动作和原始时点，勾选计入草稿且切条和修改问题后重新核对', async () => {
  const ui = workbench()
  try {
    await open(ui)
    assert.match(ui.text(ui.byLabel('样本决策时点')), /第 41 行.*session.v4.jsonl.*get_inspection_result/s)
    assert.equal(ui.button('确认标签并复核本条').props.disabled, true)
    ui.button('确认标签并复核本条').props.onClick(); await ui.settle()
    assert.equal(ui.calls.filter(item => item.action === 'update').length, 0)
    ui.check(); assert.equal(ui.dirty.at(-1), true)
    ui.change('决策问题 JSON', JSON.stringify({ ...baseQuestion, label: 'ask' }))
    assert.equal(ui.byLabel('已核对决策时点与题目一致').props.checked, false)
    assert.equal(ui.button('确认标签并复核本条').props.disabled, true)
    ui.check(); ui.change('决策标签依据', '需要重新核对的依据')
    assert.equal(ui.byLabel('已核对决策时点与题目一致').props.checked, false)
    ui.review(); await ui.settle()
    assert.equal(ui.calls.filter(item => item.action === 'update').at(-1).input.decision_time_reviewed, true)
    assert.equal(ui.byLabel('已核对决策时点与题目一致').props.checked, true)
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, false)
    ui.nodes().find(node => node.type === 'button' && ui.text(node).includes('第二题 0')).props.onClick(); await ui.settle()
    assert.equal(ui.byLabel('已核对决策时点与题目一致').props.checked, false)
    assert.equal(ui.button('确认标签并复核本条').props.disabled, true)
  } finally { ui.cleanup() }
})

test('旧 reviewed 缺少时点复核声明时可阅读与候选下载，但训练按钮仍禁用', async () => {
  const ui = workbench()
  try {
    ui.documents.get('dataset-a').dataset.records[0]._meta.label_status = 'reviewed'
    await open(ui)
    assert.equal(ui.byLabel('已核对决策时点与题目一致').props.checked, false)
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, true)
    assert.ok(ui.button('下载候选 JSONL'))
    ui.review(); await ui.settle()
    assert.equal(ui.button('下载已复核训练 JSONL').props.disabled, false)
  } finally { ui.cleanup() }
})
