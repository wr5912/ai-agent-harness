import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const compiled = await build({ entryPoints: [new URL('../src/evaluation/client.tsx', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'] })
const runA = 'run-11111111-1111-4111-8111-111111111111'
const runB = 'run-22222222-2222-4222-8222-222222222222'
const expA = 'EXP-alpha-001'
const doc = { case: { id: 'C-1', title: '测试一', inputs: ['第一轮'], expected_behavior: '正确回答', scene: '场景一', tier: 'fast' }, sha256: 'case-v1', path: 'agents/alpha/evaluation.md' }
const detail = { experiment: { id: expA }, versions: [{ id: expA }], evaluation: { path: doc.path, sha256: doc.sha256, cases: [{ id: 'C-1', title: '测试一', scene: '场景一', tier: 'fast', input_preview: '第一轮' }, { id: 'C-2', title: '测试二', scene: '场景二', tier: 'full', input_preview: '第二轮' }] }, decision: { content: '# Decision\ncontinue', sha256: 'decision-v1' } }
function workbench({ target, handler, onAssistant } = {}) {
  const states = [], dependencies = [], cleanups = []
  let cursor, effects, changed, tree, failSave = false, loadedDoc = structuredClone(doc), decisionContent = detail.decision.content
  const calls = [], navigations = [], contexts = [], confirmations = [], assistants = []
  const updateListeners = new Set()
  let updateSnapshot = { domains: [], revision: 0 }
  const updates = { subscribe: listener => { updateListeners.add(listener); return () => updateListeners.delete(listener) }, getSnapshot: () => updateSnapshot, invalidate: domains => { updateSnapshot = { domains, revision: updateSnapshot.revision + 1 }; [...updateListeners].forEach(listener => listener()) } }
  const confirmationAnswers = []
  const react = {
    ...require('react'),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value; if (!Object.is(next, states[index])) { states[index] = next; changed = true } }]
    },
    useRef(initial) { const index = cursor++; if (!(index in states)) states[index] = { current: initial }; return states[index] },
    useMemo(compute, deps) { const index = cursor++; if (!dependencies[index] || deps.some((value, at) => value !== dependencies[index][at])) { states[index] = compute(); dependencies[index] = deps }; return states[index] },
    useEffect(effect, deps) {
      const index = cursor++
      if (!dependencies[index] || deps.some((value, at) => value !== dependencies[index][at])) { dependencies[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = effect() }) }
    },
  }
  const MarkdownText = () => null, MarkdownDelegateProvider = () => null
  const module = { exports: {} }
  const beforeUnload = new Set()
  const window = { confirm: message => { confirmations.push(message); return confirmationAnswers.shift() ?? true }, addEventListener: (name, listener) => { if (name === 'beforeunload') beforeUnload.add(listener) }, removeEventListener: (name, listener) => beforeUnload.delete(listener), setInterval: () => 1, clearInterval: () => undefined }
  vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require: name => name === 'react' ? react : name === '@deepseek-ai/dsh-client-ui-primitives' ? { MarkdownText, MarkdownDelegateProvider } : require(name), window, document: { baseURI: 'http://localhost:3090/hap/', getElementById: () => ({ focus() {} }) }, URL })
  const { EvaluationPage } = module.exports
  const defaultHandler = async (action, payload) => {
    if (action === 'list') return { agents: [{ id: 'alpha' }, { id: 'beta' }] }
    if (action === 'detail') return { ...detail, decision: { ...detail.decision, content: decisionContent } }
    if (action === 'runs/index') return { experiments: [{ experiment_id: payload.agent_id === 'alpha' ? expA : 'EXP-beta-001', runs: [{ run_id: payload.agent_id === 'alpha' ? runA : runB, status: 'completed', created_at: '2026-10-15T08:00:00Z' }] }] }
    if (action === 'runs/show') return { run_id: payload.run_id, run_path: `evolution/experiments/${expA}/runs/${payload.run_id}`, manifest: { agent_id: 'alpha', experiment_id: expA, status: 'completed' }, summary: { effective_verdict: 'passed' }, source: { executor: 'api' }, cases: [{ case_id: 'C-1', frozen: { inputs: ['原始输入'], expected_behavior: '原始标准' }, trials: [], evidence: [] }], missing: [] }
    if (action === 'runs/report') return { present: true, path: 'report.md', content: '# 测试评估报告\n\n完整报告正文' }
    if (action === 'runs/files') return { sealed: true, files: [{ path: `evolution/experiments/${expA}/runs/${payload.run_id}/evidence/C-1/trace.jsonl`, size: 90000, kind: 'text' }] }
    if (action === 'runs/read-file') return { path: payload.path, content: '预览轨迹', truncated: true }
    if (action === 'cases/read') return structuredClone(loadedDoc)
    if (action === 'cases/update') {
      if (failSave) throw new Error('conflict: 文件已被修改')
      loadedDoc = { ...loadedDoc, sha256: 'case-v2', case: { ...loadedDoc.case, title: payload.title, inputs: [...payload.inputs], expected_behavior: payload.expected_behavior, fast: payload.fast } }
      return structuredClone(loadedDoc)
    }
    if (action === 'eval/preview') return { result: { mode: payload.mode, case_ids: payload.cases ?? ['C-1'], executor: payload.executor } }
    if (action === 'eval/start') return { job_id: 'job-1', status: 'running' }
    if (action === 'eval/status') return { job_id: 'job-1', status: 'completed', result: { run_id: runA } }
    if (action === 'eval/cancel') return { status: 'cancelled' }
    if (action === 'decision/update') { decisionContent = payload.content; return { sha256: 'decision-v2' } }
    throw new Error(`未处理的 RPC ${action}`)
  }
  const props = { active: true, target, updates, onAssistant: async (task, context) => { assistants.push({ task, context }); await onAssistant?.(task, context) }, onNavigate: value => { navigations.push(value); props.target = value; changed = true }, onContext: value => contexts.push(value), rpc: { call: async (channel, endpoint, payload) => {
    const action = endpoint.replace(/^agents\//, '')
    calls.push({ action, payload })
    try { return { ok: true, value: await (handler ? handler(action, payload, defaultHandler) : defaultHandler(action, payload)) } } catch (error) { const [code, ...message] = error.message.split(': '); return { ok: false, error: { code, message: message.join(': ') } } }
  } } }
  function render() {
    let count = 0
    do { if (++count > 60) throw new Error('渲染未收敛'); cursor = 0; effects = []; changed = false; tree = EvaluationPage(props); effects.forEach(effect => effect()) } while (changed)
    return tree
  }
  async function settle() { for (let index = 0; index < 8; index++) { render(); await new Promise(resolve => setImmediate(resolve)) }; return render() }
  function nodes(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.flatMap(item => nodes(item)); if (!value || typeof value !== 'object') return []; return [value, ...(value.props?.children === undefined ? [] : nodes(value.props.children))] }
  function text(value) { if (!arguments.length) value = tree; if (Array.isArray(value)) return value.map(text).join(''); return value && typeof value === 'object' ? text(value.props?.children) : String(value ?? '') }
  const button = title => nodes().find(node => node.type === 'button' && text(node) === title)
  const byLabel = title => nodes().find(node => node.props?.['aria-label'] === title)
  function change(title, value) { const element = byLabel(title); assert.ok(element, `缺少控件 ${title}`); element.props.onChange({ target: { value, checked: value } }); render() }
  render()
  return { render, settle, nodes, text, button, byLabel, change, calls, navigations, contexts, assistants, MarkdownText, beforeUnload, confirmations, confirmationAnswers, setFailSave: value => { failSave = value }, setTarget(value) { props.target = value; render() }, setActive(value) { props.active = value; render() }, getTarget() { return props.target }, cleanup() { cleanups.forEach(cleanup => cleanup?.()) } }
}

test('评测中心默认汇总全部智能体 Run，点击即读取报告并保留挂载前缀下载', async () => {
  const ui = workbench()
  await ui.settle()
  assert.deepEqual(ui.calls.filter(call => call.action === 'runs/index').map(call => call.payload.agent_id).sort(), ['alpha', 'beta'])
  assert.equal(ui.calls.some(call => call.action === 'detail'), false)
  assert.equal(ui.byLabel('评测工作区').props.children.find(node => node.props.id === 'evaluation-tab-runs').props['aria-selected'], true)
  ui.button(runA).props.onClick({ stopPropagation() {} })
  await ui.settle()
  assert.ok(ui.nodes().some(node => node.type === ui.MarkdownText && node.props.text.includes('完整报告正文')))
  const archive = ui.nodes().find(node => node.type === 'a' && ui.text(node) === '下载完整 Run ZIP')
  assert.equal(new URL(archive.props.href).pathname, '/hap/api/harness-platform/runs/download')
  assert.equal(new URL(archive.props.href).searchParams.get('kind'), 'archive')
  assert.equal(ui.navigations.at(-1).run_id, runA)
  ui.cleanup()
})

test('用例行选择与执行复选框独立，编辑多轮输入保存回读，失败保留草稿并保护跳转', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'cases', agent_id: 'alpha', experiment_id: expA } })
  await ui.settle()
  ui.byLabel('执行 C-1').props.onChange({ target: { checked: true } })
  await ui.settle()
  assert.equal(ui.calls.some(call => call.action === 'cases/read'), false)
  ui.button('C-1测试一').props.onClick({ stopPropagation() {} })
  await ui.settle()
  ui.button('编辑用例').props.onClick()
  ui.render()
  ui.change('用例名称', '修改后的用例')
  ui.button('＋ 添加一轮输入').props.onClick()
  ui.render()
  ui.change('第 2 轮输入', '后续追问')
  let prevented = false
  for (const protect of ui.beforeUnload) protect({ preventDefault() { prevented = true }, returnValue: undefined })
  assert.equal(prevented, true)
  ui.setFailSave(true)
  ui.button('保存用例').props.onClick()
  await ui.settle()
  assert.match(ui.text(), /草稿已保留/)
  assert.equal(ui.byLabel('用例名称').props.value, '修改后的用例')
  ui.confirmationAnswers.push(false)
  ui.button('C-2测试二').props.onClick({ stopPropagation() {} })
  ui.render()
  assert.equal(ui.byLabel('用例名称').props.value, '修改后的用例')
  assert.equal(ui.navigations.at(-1).case_id, 'C-1')
  ui.setFailSave(false)
  ui.button('保存用例').props.onClick()
  await ui.settle()
  const save = ui.calls.filter(call => call.action === 'cases/update').at(-1)
  assert.deepEqual(Array.from(save.payload.inputs), ['第一轮', '后续追问'])
  assert.equal(save.payload.expected_sha256, 'case-v1')
  assert.equal(ui.byLabel('用例名称'), undefined)
  assert.match(ui.text(), /已保存。后续评测立即使用新定义/)
  ui.cleanup()
})

test('超过预览限制的轨迹通过完整文件下载入口导出', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', run_id: runA } })
  await ui.settle()
  const file = ui.nodes().find(node => node.type === 'button' && ui.text(node).includes('evidence/C-1/trace.jsonl'))
  file.props.onClick()
  await ui.settle()
  assert.match(ui.text(), /仅预览前 64 KiB/)
  const link = ui.nodes().find(node => node.type === 'a' && ui.text(node) === '下载完整文件')
  assert.equal(new URL(link.props.href).searchParams.get('path'), `evolution/experiments/${expA}/runs/${runA}/evidence/C-1/trace.jsonl`)
  assert.equal(new URL(link.props.href).searchParams.get('kind'), 'file')
  assert.equal(ui.calls.filter(call => call.action === 'runs/read-file').length, 1)
  ui.cleanup()
})

test('新建评测传递明确范围并定位返回 Run，研究决策保存绑定该 Run 的 Experiment', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'cases', agent_id: 'alpha', experiment_id: expA } })
  await ui.settle()
  ui.byLabel('执行 C-2').props.onChange({ target: { checked: true } })
  ui.render()
  ui.button('＋ 新建评测').props.onClick()
  ui.render()
  ui.button('执行预览').props.onClick()
  await ui.settle()
  assert.deepEqual(Array.from(ui.calls.find(call => call.action === 'eval/preview').payload.cases), ['C-2'])
  ui.button('启动评测').props.onClick()
  await ui.settle()
  assert.equal(ui.navigations.at(-1).run_id, runA)
  ui.button('记录研究决策').props.onClick()
  await ui.settle()
  ui.change('Decision 正文', '# Decision\nadopt')
  ui.button('保存研究决策').props.onClick()
  await ui.settle()
  const save = ui.calls.find(call => call.action === 'decision/update')
  assert.equal(save.payload.experiment_id, expA)
  assert.equal(save.payload.expected_sha256, 'decision-v1')
  assert.match(ui.text(), /研究决策已保存/)
  ui.cleanup()
})

test('深链切换 Run 后迟到的报告响应不会覆盖当前目标', async () => {
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', run_id: runA }, handler: async (action, payload, original) => {
    if (payload.run_id === runA && ['runs/show', 'runs/report', 'runs/files'].includes(action)) await waiting
    const value = await original(action, payload)
    return action === 'runs/report' ? { ...value, content: `报告 ${payload.run_id}` } : value
  } })
  await ui.settle()
  ui.setTarget({ page: 'evaluation', tab: 'runs', run_id: runB })
  await ui.settle()
  release()
  await ui.settle()
  const rendered = ui.nodes().filter(node => node.type === ui.MarkdownText).map(node => node.props.text)
  assert.ok(rendered.includes(`报告 ${runB}`))
  assert.ok(!rendered.includes(`报告 ${runA}`))
  ui.cleanup()
})

test('比较限制候选为同一智能体，并按冻结输入并排展示共同 Case', async () => {
  const runC = 'run-33333333-3333-4333-8333-333333333333'
  const ui = workbench({ target: { page: 'evaluation', tab: 'compare' }, handler: async (action, payload, original) => {
    if (action === 'runs/index' && payload.agent_id === 'alpha') return { experiments: [{ experiment_id: expA, runs: [{ run_id: runA, status: 'completed' }, { run_id: runC, status: 'completed' }] }] }
    if (action === 'runs/compare') return { left_run: runA, right_run: runC, left_only: [], right_only: [], limits: ['executor: 不同'], cases: [{ case_id: 'C-1', frozen_contract_same: false, observed_change: '记录有差异' }] }
    const value = await original(action, payload)
    if (action === 'runs/show') value.cases[0].frozen.inputs = [payload.run_id === runA ? '左侧冻结输入' : '右侧冻结输入']
    return value
  } })
  await ui.settle()
  ui.change('左侧 Run', runA)
  const rightOptions = ui.byLabel('右侧 Run').props.children.flat().filter(Boolean).map(node => node.props.value)
  assert.ok(rightOptions.includes(runC))
  assert.ok(!rightOptions.includes(runB))
  ui.change('右侧 Run', runC)
  ui.button('开始比较').props.onClick()
  await ui.settle()
  assert.match(ui.text(), /executor: 不同/)
  assert.match(ui.text(), /冻结用例口径不同/)
  const caseInputs = ui.nodes().filter(node => node.type?.name === 'RunCase').flatMap(node => Array.from(node.props.item.frozen.inputs))
  assert.deepEqual(caseInputs, ['左侧冻结输入', '右侧冻结输入'])
  ui.cleanup()
})

test('浏览器导航从具体研究版本返回全部版本时清除旧版本筛选', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA } })
  await ui.settle()
  assert.equal(ui.byLabel('评测研究版本').props.value, expA)
  ui.setTarget({ page: 'evaluation', tab: 'runs', agent_id: 'alpha' })
  await ui.settle()
  assert.equal(ui.byLabel('评测研究版本').props.value, '')
  assert.equal(ui.contexts.at(-1).experiment_id, undefined)
  ui.cleanup()
})

test('已有旧报告时启动新评测会定位新 Run，任务报告按钮合并标签与 Run 导航', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA, run_id: runB } })
  await ui.settle()
  ui.button('＋ 新建评测').props.onClick()
  ui.render()
  ui.button('启动评测').props.onClick()
  await ui.settle()
  assert.equal(ui.navigations.at(-1).run_id, runA)
  assert.equal(ui.navigations.at(-1).tab, 'runs')
  assert.equal(ui.contexts.at(-1).run_id, runA)
  ui.nodes().find(node => node.props?.id === 'evaluation-tab-cases').props.onClick()
  await ui.settle()
  ui.button('查看本次报告').props.onClick()
  await ui.settle()
  assert.equal(ui.navigations.at(-1).run_id, runA)
  assert.equal(ui.navigations.at(-1).tab, 'runs')
  assert.equal(ui.nodes().find(node => node.props?.id === 'evaluation-tab-runs').props['aria-selected'], true)
  ui.cleanup()
})

test('比较证据入口一次导航到运行标签和对应 Run，并打开实际轨迹文件', async () => {
  const runC = 'run-33333333-3333-4333-8333-333333333333'
  const ui = workbench({ target: { page: 'evaluation', tab: 'compare' }, handler: async (action, payload, original) => {
    if (action === 'runs/index' && payload.agent_id === 'alpha') return { experiments: [{ experiment_id: expA, runs: [{ run_id: runA, status: 'completed' }, { run_id: runC, status: 'completed' }] }] }
    if (action === 'runs/compare') return { left_run: runA, right_run: runC, left_only: [], right_only: [], limits: [], cases: [{ case_id: 'C-1', frozen_contract_same: true, observed_change: '记录相同' }] }
    return original(action, payload)
  } })
  await ui.settle()
  ui.change('左侧 Run', runA)
  ui.change('右侧 Run', runC)
  ui.button('开始比较').props.onClick()
  await ui.settle()
  const source = ui.nodes().find(node => node.type?.name === 'RunCase')
  const count = ui.navigations.length
  source.props.onEvidence(`evolution/experiments/${expA}/runs/${runA}/evidence/C-1/trace.jsonl`)
  await ui.settle()
  assert.equal(ui.navigations.length, count + 1)
  assert.equal(ui.navigations.at(-1).run_id, runA)
  assert.equal(ui.navigations.at(-1).tab, 'runs')
  assert.equal(ui.nodes().find(node => node.props?.id === 'evaluation-tab-runs').props['aria-selected'], true)
  assert.equal(ui.nodes().find(node => node.props?.id === 'evaluation-run-tab-files').props['aria-selected'], true)
  assert.ok(ui.calls.some(call => call.action === 'runs/read-file' && call.payload.run_id === runA))
  ui.cleanup()
})

test('深链切换智能体会取消旧比较选择并隔离迟到的比较响应', async () => {
  const runC = 'run-33333333-3333-4333-8333-333333333333'
  let release
  const pending = new Promise(resolve => { release = resolve })
  const ui = workbench({ target: { page: 'evaluation', tab: 'compare', agent_id: 'alpha' }, handler: async (action, payload, original) => {
    if (action === 'runs/index' && payload.agent_id === 'alpha') return { experiments: [{ experiment_id: expA, runs: [{ run_id: runA, status: 'completed' }, { run_id: runC, status: 'completed' }] }] }
    if (action === 'runs/compare') { await pending; return { left_run: runA, right_run: runC, limits: ['Alpha迟到结果'], cases: [{ case_id: 'C-1', frozen_contract_same: true, observed_change: 'Alpha结果' }] } }
    return original(action, payload)
  } })
  await ui.settle()
  ui.change('左侧 Run', runA)
  ui.change('右侧 Run', runC)
  ui.button('开始比较').props.onClick()
  await ui.settle()
  ui.setTarget({ page: 'evaluation', tab: 'compare', agent_id: 'beta' })
  await ui.settle()
  assert.equal(ui.byLabel('左侧 Run').props.value, '')
  assert.equal(ui.byLabel('右侧 Run').props.value, '')
  release()
  await ui.settle()
  assert.ok(!ui.text().includes('Alpha迟到结果'))
  assert.ok(!ui.text().includes('Alpha结果'))
  assert.equal(ui.byLabel('评测智能体').props.value, 'beta')
  ui.cleanup()
})

test('状态响应迟到时已离开评测页只更新任务，返回后不补跳报告', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const origin = { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA, run_id: runB }
  const ui = workbench({ target: origin, handler: async (action, payload, original) => { if (action === 'eval/status') await pending; return original(action, payload) } })
  await ui.settle()
  ui.button('＋ 新建评测').props.onClick()
  ui.render()
  ui.button('启动评测').props.onClick()
  await ui.settle()
  assert.ok(ui.calls.some(call => call.action === 'eval/status'))
  ui.setActive(false)
  ui.setTarget({ page: 'home' })
  const navigationCount = ui.navigations.length
  release()
  await ui.settle()
  assert.equal(ui.navigations.length, navigationCount)
  assert.equal(ui.getTarget().page, 'home')
  assert.match(ui.text(), /评测任务 · 已完成/)
  ui.setTarget(origin)
  ui.setActive(true)
  await ui.settle()
  ui.button('刷新状态').props.onClick()
  await ui.settle()
  assert.equal(ui.navigations.length, navigationCount)
  assert.equal(ui.contexts.at(-1).run_id, runB)
  ui.cleanup()
})

test('等待状态时切换智能体范围，旧任务完成不覆盖新范围或导航', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA }, handler: async (action, payload, original) => { if (action === 'eval/status') await pending; return original(action, payload) } })
  await ui.settle()
  ui.button('＋ 新建评测').props.onClick()
  ui.render()
  ui.button('启动评测').props.onClick()
  await ui.settle()
  ui.setTarget({ page: 'evaluation', tab: 'runs', agent_id: 'beta' })
  await ui.settle()
  const navigationCount = ui.navigations.length
  release()
  await ui.settle()
  assert.equal(ui.navigations.length, navigationCount)
  assert.equal(ui.byLabel('评测智能体').props.value, 'beta')
  assert.equal(ui.byLabel('评测研究版本').props.value, '')
  assert.equal(ui.contexts.at(-1).run_id, undefined)
  assert.match(ui.text(), /评测任务 · 已完成/)
  ui.cleanup()
})

test('等待任务时手动选择其他 Run，首个任务 run_id 不抢占当前报告', async () => {
  const runC = 'run-33333333-3333-4333-8333-333333333333'
  let release
  const pending = new Promise(resolve => { release = resolve })
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA, run_id: runB }, handler: async (action, payload, original) => {
    if (action === 'eval/status') { await pending; return { job_id: 'job-1', status: 'completed', result: { run_id: runC } } }
    return original(action, payload)
  } })
  await ui.settle()
  ui.button('＋ 新建评测').props.onClick()
  ui.render()
  ui.button('启动评测').props.onClick()
  await ui.settle()
  ui.button(runA).props.onClick({ stopPropagation() {} })
  await ui.settle()
  const navigationCount = ui.navigations.length
  release()
  await ui.settle()
  assert.equal(ui.navigations.length, navigationCount)
  assert.equal(ui.getTarget().run_id, runA)
  assert.equal(ui.contexts.at(-1).run_id, runA)
  ui.cleanup()
})

test('任务状态迟到时用户已切到用例标签，保留当前标签与选择', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA }, handler: async (action, payload, original) => { if (action === 'eval/status') await pending; return original(action, payload) } })
  await ui.settle()
  ui.button('＋ 新建评测').props.onClick()
  ui.render()
  ui.button('启动评测').props.onClick()
  await ui.settle()
  ui.nodes().find(node => node.props?.id === 'evaluation-tab-cases').props.onClick()
  await ui.settle()
  const navigationCount = ui.navigations.length
  release()
  await ui.settle()
  assert.equal(ui.navigations.length, navigationCount)
  assert.equal(ui.getTarget().tab, 'cases')
  assert.equal(ui.nodes().find(node => node.props?.id === 'evaluation-tab-cases').props['aria-selected'], true)
  ui.cleanup()
})

test('Run AI 抽取按钮从实际 Run 身份固定上下文并明确调用 skill，页面筛选不替换目标', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'beta', experiment_id: 'EXP-beta-001', run_id: runA } })
  try {
    await ui.settle()
    const button = ui.button('请 AI 抽取决策样本')
    assert.equal(button.props.disabled, false)
    await button.props.onClick(); await ui.settle()
    assert.deepEqual(JSON.parse(JSON.stringify(ui.assistants[0].context)), { page: 'evaluation', run_id: runA, agent_id: 'alpha', experiment_id: expA, skill: 'decision-sample-extraction' })
    assert.match(ui.assistants[0].task, /读取并使用 decision-sample-extraction Skill/)
    assert.match(ui.assistants[0].task, /datasets\/source/); assert.match(ui.assistants[0].task, /datasets\/preview/)
    assert.equal(ui.calls.some(item => item.action === 'datasets/preview' || item.action === 'datasets/apply'), false)
  } finally { ui.cleanup() }
})

test('Run 尚未封存或身份尚未读取时禁用 AI 抽取，打开助手失败可见且可重试', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', run_id: runA }, onAssistant: async () => { throw new Error('模型暂时不可达') }, handler: async (action, payload, original) => { if (action === 'runs/show') await pending; return original(action, payload) } })
  try {
    await ui.settle(); assert.equal(ui.button('请 AI 抽取决策样本').props.disabled, true)
    release(); await ui.settle(); assert.equal(ui.button('请 AI 抽取决策样本').props.disabled, false)
    await ui.button('请 AI 抽取决策样本').props.onClick(); await ui.settle()
    assert.match(ui.text(), /模型暂时不可达/); assert.equal(ui.button('请 AI 抽取决策样本').props.disabled, false)
  } finally { ui.cleanup() }
  const running = workbench({ target: { page: 'evaluation', tab: 'runs', run_id: runA }, handler: async (action, payload, original) => {
    const value = await original(action, payload)
    if (action === 'runs/show') value.manifest.status = 'running'
    if (action === 'runs/files') value.sealed = false
    return value
  } })
  try { await running.settle(); assert.equal(running.button('请 AI 抽取决策样本').props.disabled, true) } finally { running.cleanup() }
})

test('新增用例与 Run 转草稿入口传递准确身份，保存后定位新 Case 并立即刷新清单', async () => {
  let createdDocument
  const ui = workbench({ target: { page: 'evaluation', tab: 'cases', agent_id: 'alpha', experiment_id: expA }, handler: async (action, payload, original) => {
    if (createdDocument && action === 'cases/read' && payload.case_id === createdDocument.case.id) return createdDocument
    const value = await original(action, payload)
    if (createdDocument && action === 'detail') return { ...value, evaluation: { ...value.evaluation, cases: [...value.evaluation.cases, { id: createdDocument.case.id, title: createdDocument.case.title, scene: createdDocument.case.scene, tier: 'fast' }] } }
    return value
  } })
  try {
    await ui.settle(); ui.button('＋ 新增用例').props.onClick(); ui.render()
    const create = ui.nodes().find(node => node.type?.name === 'CaseCreationDialog')
    assert.ok(create); assert.equal(create.props.agentId, 'alpha'); assert.equal(create.props.experimentId, expA); assert.equal(create.props.sourceRun, undefined)
    const before = ui.calls.filter(item => item.action === 'detail').length
    createdDocument = { path: doc.path, sha256: 'case-created', case: { id: 'U-NEW-001', title: '新的复现输入', inputs: ['全新输入'], expected_behavior: '核对结果', scene: '基础', tier: 'fast', fast: true } }
    create.props.onSaved(createdDocument); create.props.onClose()
    await ui.settle()
    assert.equal(ui.navigations.at(-1).case_id, 'U-NEW-001'); assert.equal(ui.navigations.at(-1).tab, 'cases')
    assert.ok(ui.calls.filter(item => item.action === 'detail').length > before)
    assert.ok(ui.byLabel('执行 U-NEW-001'), '新增保存后即出现在后续评测执行范围选项')
    assert.equal(ui.nodes().some(node => node.type?.name === 'CaseCreationDialog'), false)
    ui.setTarget({ page: 'evaluation', tab: 'runs', run_id: runA }); await ui.settle()
    ui.nodes().find(node => node.props?.id === 'evaluation-run-tab-results').props.onClick(); await ui.settle()
    ui.button('从此 Run 创建用例草稿').props.onClick(); ui.render()
    const fromRun = ui.nodes().find(node => node.type?.name === 'CaseCreationDialog')
    assert.equal(fromRun.props.agentId, 'alpha'); assert.equal(fromRun.props.experimentId, expA)
    assert.deepEqual(JSON.parse(JSON.stringify(fromRun.props.sourceRun)), { run_id: runA, case_id: 'C-1' })
  } finally { ui.cleanup() }
})

test('新增用例草稿参与浏览器后退与深链保护，拒绝回原对象，允许后关闭对话框', async () => {
  const origin = { page: 'evaluation', tab: 'cases', agent_id: 'alpha', experiment_id: expA }
  const ui = workbench({ target: origin })
  try {
    await ui.settle(); ui.button('＋ 新增用例').props.onClick(); ui.render()
    const create = ui.nodes().find(node => node.type?.name === 'CaseCreationDialog')
    create.props.onDirty(true); ui.render()
    let protectedRefresh = false
    for (const callback of ui.beforeUnload) callback({ preventDefault() { protectedRefresh = true }, returnValue: undefined })
    assert.equal(protectedRefresh, true)
    ui.confirmationAnswers.push(false)
    ui.setTarget({ page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA, run_id: runA }); await ui.settle()
    assert.equal(ui.getTarget().tab, 'cases'); assert.equal(ui.getTarget().run_id, undefined)
    assert.equal(ui.nodes().find(node => node.type?.name === 'CaseCreationDialog').props.agentId, 'alpha')
    ui.confirmationAnswers.push(false)
    ui.setTarget({ page: 'evaluation', tab: 'cases', agent_id: 'beta', experiment_id: 'EXP-beta-001' }); await ui.settle()
    assert.equal(ui.getTarget().agent_id, 'alpha'); assert.equal(ui.byLabel('评测研究版本').props.value, expA)
    ui.confirmationAnswers.push(true)
    ui.setTarget({ page: 'evaluation', tab: 'cases', agent_id: 'beta', experiment_id: 'EXP-beta-001' }); await ui.settle()
    assert.equal(ui.getTarget().agent_id, 'beta')
    assert.equal(ui.nodes().some(node => node.type?.name === 'CaseCreationDialog'), false)
  } finally { ui.cleanup() }
})

test('新增用例保存忙时拒绝目标和页面切换，不重复询问或丢弃模态草稿', async () => {
  const ui = workbench({ target: { page: 'evaluation', tab: 'cases', agent_id: 'alpha', experiment_id: expA } })
  try {
    await ui.settle(); ui.button('＋ 新增用例').props.onClick(); ui.render()
    const create = ui.nodes().find(node => node.type?.name === 'CaseCreationDialog')
    create.props.onDirty(true); create.props.onBusy(true); ui.render()
    const confirmations = ui.confirmations.length
    ui.setTarget({ page: 'evaluation', tab: 'cases', agent_id: 'beta', experiment_id: 'EXP-beta-001' }); await ui.settle()
    assert.equal(ui.getTarget().agent_id, 'alpha'); assert.equal(ui.confirmations.length, confirmations)
    assert.ok(ui.nodes().some(node => node.type?.name === 'CaseCreationDialog'))
    ui.setTarget({ page: 'home' }); ui.setActive(false); await ui.settle()
    assert.equal(ui.getTarget().page, 'evaluation'); assert.equal(ui.getTarget().agent_id, 'alpha')
    assert.ok(ui.nodes().some(node => node.type?.name === 'CaseCreationDialog'))
    create.props.onBusy(false); create.props.onDirty(false); ui.setActive(true); await ui.settle()
  } finally { ui.cleanup() }
})

test('新增用例草稿允许离开评测页后卸载模态层，拒绝时恢复评测深链', async () => {
  const origin = { page: 'evaluation', tab: 'cases', agent_id: 'alpha', experiment_id: expA }
  const ui = workbench({ target: origin })
  try {
    await ui.settle(); ui.button('＋ 新增用例').props.onClick(); ui.render()
    ui.nodes().find(node => node.type?.name === 'CaseCreationDialog').props.onDirty(true); ui.render()
    ui.confirmationAnswers.push(false); ui.setTarget({ page: 'home' }); ui.setActive(false); await ui.settle()
    assert.equal(ui.getTarget().page, 'evaluation'); assert.ok(ui.nodes().some(node => node.type?.name === 'CaseCreationDialog'))
    ui.setActive(true); await ui.settle()
    ui.confirmationAnswers.push(true); ui.setTarget({ page: 'home' }); ui.setActive(false); await ui.settle()
    assert.equal(ui.getTarget().page, 'home'); assert.equal(ui.nodes().some(node => node.type?.name === 'CaseCreationDialog'), false)
  } finally { ui.cleanup() }
})

test('取消评测保持正在取消状态，禁止重复取消并在 CLI 收尾后读取封存报告', async () => {
  let state = 'running'
  const ui = workbench({ target: { page: 'evaluation', tab: 'runs', agent_id: 'alpha', experiment_id: expA }, handler: async (action, payload, original) => {
    if (action === 'eval/status') return { job_id: 'job-1', status: state, result: state === 'cancelled' ? { run_id: runA, cancelled: true, instance_stopped: true } : undefined }
    if (action === 'eval/cancel') { state = 'cancelling'; return { status: state } }
    return original(action, payload)
  } })
  try {
    await ui.settle(); ui.button('＋ 新建评测').props.onClick(); ui.render(); ui.button('启动评测').props.onClick(); await ui.settle()
    ui.button('取消评测').props.onClick(); await ui.settle()
    assert.match(ui.text(), /评测任务 · 正在取消/); assert.equal(ui.button('取消评测').props.disabled, true)
    ui.button('取消评测').props.onClick(); await ui.settle()
    assert.equal(ui.calls.filter(item => item.action === 'eval/cancel').length, 1)
    state = 'cancelled'; ui.button('刷新状态').props.onClick(); await ui.settle()
    assert.match(ui.text(), /评测任务 · 已取消/); assert.ok(ui.calls.some(item => item.action === 'runs/show' && item.payload.run_id === runA))
  } finally { ui.cleanup() }
})
