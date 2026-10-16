import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const repo = new URL('../../../', import.meta.url).pathname
process.env.HARNESS_PROGRAM_ROOT = repo
const buildRoot = mkdtempSync(join(tmpdir(), 'decision-dataset-build-'))
await build({ entryPoints: [new URL('../src/evaluation/datasets.ts', import.meta.url).pathname], outfile: join(buildRoot, 'datasets.mjs'), bundle: true, platform: 'node', format: 'esm' })
const { createDecisionDatasetHandler, validateDecisionQuestion } = await import(`file://${join(buildRoot, 'datasets.mjs')}`)
const runId = 'run-11111111-1111-4111-8111-111111111111'
const runId2 = 'run-22222222-2222-4222-8222-222222222222'
const owner = 'session-dataset-owner'
const secret = 'sk-' + 'fixturedecisiontoken123456789'
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content) }
function envelope(type, data, seq, log = 'session.v4.jsonl') { return { session_log: log, event: { type, seq, time: 1700000000000 + seq, data } } }
function traceEvents() {
  const messages = [{ role: 'system', content: '仅查询基本巡检数据。' }, { role: 'user', content: `查询测试资产的巡检状态。 Authorization: Bearer ${secret}` }]
  return [
    envelope('session', { id: 'session-fixture' }, 0),
    envelope('user/message', { message: { source: { kind: 'user' }, content: [{ type: 'text', text: messages[1].content }] } }, 1),
    envelope('step/start', { id: 'step-1' }, 2),
    envelope('request/header', { header: { config: { provider: 'fixture', model: 'basic-model' }, messages, tools: [{ name: 'get_asset_status', description: '读取基本测试资产状态' }, { name: 'get_inspection_status', description: '读取基本巡检状态' }] } }, 3),
    envelope('tool/call', { callId: 'call-a', name: 'get_asset_status', arguments: { asset_id: 'test-asset', api_key: secret } }, 4),
    envelope('tool/result', { message: { source: { kind: 'tool', callId: 'call-a' }, content: [{ type: 'text', text: 'FUTURE_RESULT_A' }] } }, 5),
    envelope('tool/call', { callId: 'call-b', name: 'get_inspection_status', arguments: { asset_id: 'test-asset' } }, 6),
    envelope('tool/result', { message: { source: { kind: 'tool', callId: 'call-b' }, content: [{ type: 'text', text: 'FUTURE_RESULT_B' }] } }, 7),
  ]
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'decision-datasets-'))
  const base = id => `evolution/experiments/EXP-alpha-001-r0123456789ab/runs/${id}`
  const path = `${base(runId)}/evidence/U-BASIC-001/trace.jsonl`
  const raw = traceEvents().map(value => JSON.stringify(value)).join('\n') + '\n'
  function createRun(id, trace = raw) {
    write(join(root, base(id), 'run.yaml'), `run_id: ${id}\nagent_id: alpha\nstatus: completed\n`)
    write(join(root, base(id), 'inputs.lock.json'), JSON.stringify({ evaluation_cases: [{ case_id: 'U-BASIC-001', inputs: ['查询基本资产状态'], expected_behavior: '展示基本状态。' }] }))
    write(join(root, base(id), 'evidence/U-BASIC-001/checks.json'), JSON.stringify({ trace_available: true }))
    write(join(root, base(id), 'evidence/U-BASIC-001/trace.jsonl'), trace)
  }
  createRun(runId)
  const handle = createDecisionDatasetHandler(root)
  return { root, path, raw, handle, createRun, base }
}
async function withFixture(run) { const fx = fixture(); try { await run(fx) } finally { await rm(fx.root, { recursive: true, force: true }) } }
async function source(fx, extra = {}) {
  const result = await fx.handle('datasets/source', { run_id: runId, path: fx.path, ...extra })
  assert.ok(result.decisions?.some(item => item.eligible), JSON.stringify(result))
  return result
}
const question = (changes = {}) => ({ type: 'choice', instructions: '根据当前输入，下一步应使用哪种只读查询？', criteria: { asset: '查询基本资产状态', inspect: '查询基本巡检状态' }, label: 'asset', src: 'inspection-next-step', ...changes })
async function preview(fx, sourceValue, samples, changes = {}) {
  const drafts = (samples ?? [{ decision_id: sourceValue.decisions[0].decision_id, question: question(), label_basis: '根据用户输入提出候选，仍需人工复核。' }]).map(item => ({ action_name: sourceValue.decisions.find(decision => decision.decision_id === item.decision_id)?.observed_action.name, ...item }))
  return fx.handle('datasets/preview', { run_id: sourceValue.run_id, path: sourceValue.path, source_sha256: sourceValue.source_sha256, samples: drafts, assistant_session_id: owner, assistant_model: { provider: 'fixture', model: 'basic-model' }, ...changes })
}
async function apply(fx, value, session = owner) { return fx.handle('datasets/apply', { preview_id: value.preview_id, assistant_session_id: session }) }
function updatePayload(saved, record = saved.dataset.records[0], changes = {}) {
  return { dataset_id: saved.dataset.id, expected_sha256: saved.sha256, record_id: record._meta.id, question: record.questions.decision, group_id: record._meta.group_id, split: 'train', label_status: 'reviewed', decision_time_reviewed: true, label_basis: '人工核对原始输入和查询范围后确认。', ...changes }
}

test('真实保存的轨迹经过 source→preview→apply→read/edit/review→训练导出闭环', () => withFixture(async fx => {
  const listing = await fx.handle('datasets/source', { run_id: runId })
  assert.equal(listing.files[0].role, 'target')
  const src = await source(fx)
  const proposed = await preview(fx, src)
  assert.equal(proposed.count, 1); assert.equal(proposed.records[0]._meta.label_status, 'suggested')
  assert.equal((await fx.handle('datasets/list', { run_id: runId })).datasets.length, 0)
  const saved = await apply(fx, proposed)
  assert.equal(saved.dataset.records[0]._meta.label_status, 'suggested')
  const read = await fx.handle('datasets/read', { dataset_id: saved.dataset.id })
  assert.equal(read.sha256, saved.sha256)
  assert.equal(saved.dataset.records[0]._meta.decision_time_reviewed, false)
  await assert.rejects(() => fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'training' }), /尚无人员复核/)
  const candidates = await fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'candidates' })
  assert.equal(JSON.parse(candidates.content)._meta.label_status, 'suggested')
  const edited = await fx.handle('datasets/update', updatePayload(saved, undefined, { question: question({ label: 'inspect' }) }))
  assert.equal(edited.dataset.records[0].questions.decision.label, 'inspect')
  assert.equal(edited.dataset.records[0]._meta.label_status, 'reviewed')
  const training = await fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'training' })
  const record = JSON.parse(training.content)
  assert.equal(record.questions.decision.label, 'inspect'); assert.equal(record._meta.split, 'train')
  assert.match(record._meta.extractor.skill_sha256, /^[0-9a-f]{64}$/)
  assert.equal(record._meta.decision_time_reviewed, true)
}))

test('时点未核对不能复核，旧 reviewed 不进入训练；修改后保存待复核清除原确认', () => withFixture(async fx => {
  const saved = await apply(fx, await preview(fx, await source(fx)))
  for (const decision_time_reviewed of [undefined, false, 'true']) await assert.rejects(() => fx.handle('datasets/update', updatePayload(saved, undefined, { decision_time_reviewed })), /人工核对.*当前决策/)
  const legacy = structuredClone(saved.dataset)
  legacy.records[0]._meta.label_status = 'reviewed'
  delete legacy.records[0]._meta.decision_time_reviewed
  write(join(fx.root, saved.file), JSON.stringify(legacy))
  await assert.rejects(() => fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'training' }), /决策时点核对/)
  assert.equal((await fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'candidates' })).count, 1)
  const current = await fx.handle('datasets/read', { dataset_id: saved.dataset.id })
  const reviewed = await fx.handle('datasets/update', updatePayload(current, undefined, { question: question({ label: 'inspect' }) }))
  assert.equal(reviewed.dataset.records[0]._meta.decision_time_reviewed, true)
  const edited = await fx.handle('datasets/update', updatePayload(reviewed, undefined, { label_status: 'suggested', question: question({ instructions: '修改后的下一步查询是什么？' }) }))
  assert.equal(edited.dataset.records[0]._meta.decision_time_reviewed, false)
  assert.equal(edited.dataset.records[0]._meta.reviewed_at, null)
  await assert.rejects(() => fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'training' }), /尚无人员复核/)
}))

test('提案必须对应实际动作，题目来源由服务器固定且不能由模型或编辑伪造', () => withFixture(async fx => {
  const src = await source(fx), first = src.decisions[0]
  for (const action_name of [undefined, 'respond', 'get_inspection_status']) await assert.rejects(() => preview(fx, src, [{ decision_id: first.decision_id, action_name, question: question(), label_basis: '错误地把工具选择当作最终答复。' }]), /action_name.*实际动作/)
  const saved = await apply(fx, await preview(fx, src))
  const expected = `${src.path}:${first.anchor.line}`
  assert.equal(saved.dataset.records[0].questions.decision.src, expected)
  const changed = await fx.handle('datasets/update', updatePayload(saved, undefined, { question: question({ src: 'forged-source' }) }))
  assert.equal(changed.dataset.records[0].questions.decision.src, expected)
}))

test('并行工具共享决策前缀，未来结果和当前动作不得进入 state，凭据原件保持不变', () => withFixture(async fx => {
  const src = await source(fx)
  assert.equal(src.decisions.length, 2)
  const first = src.decisions[0], second = src.decisions[1]
  assert.deepEqual(first.state, second.state)
  assert.ok(!JSON.stringify(second.state).includes('FUTURE_RESULT_A'))
  assert.ok(!JSON.stringify(second.state).includes('FUTURE_RESULT_B'))
  assert.ok(!JSON.stringify(second.state).includes('call-a'))
  assert.ok(!JSON.stringify(src).includes(secret))
  const saved = await apply(fx, await preview(fx, src))
  assert.ok(!JSON.stringify(saved).includes(secret))
  assert.equal(readFileSync(join(fx.root, fx.path), 'utf8'), fx.raw)
  assert.ok(readFileSync(join(fx.root, fx.path), 'utf8').includes(secret))
}))

test('所有题型的无效 label、空候选和重复等级均被拒绝', () => {
  for (const value of [question({ label: 'missing' }), question({ criteria: { only: '唯一候选' }, label: 'only' }), question({ criteria: { a: '重复', b: '重复' }, label: 'a' }), question({ type: 'noul', label: 'true' }), question({ type: 'score', criteria: ['低', '高'], label: 2 }), question({ type: 'score', criteria: ['低', '低'], label: 0 }), question({ instructions: '' })]) assert.throws(() => validateDecisionQuestion(value))
  assert.equal(validateDecisionQuestion(question({ type: 'noul', criteria: { false: '不继续', true: '继续' }, label: true })).label, true)
  assert.equal(validateDecisionQuestion(question({ type: 'score', criteria: ['低', '高'], label: 0 })).label, 0)
})

test('不存在、评审角色与缺口切片不能作为候选，不能伪造 state 或 reviewed 状态', () => withFixture(async fx => {
  const src = await source(fx)
  await assert.rejects(() => preview(fx, src, [{ decision_id: 'invented', question: question(), label_basis: '不存在' }]), /不存在|材料不足/)
  const proposed = await preview(fx, src, [{ decision_id: src.decisions[0].decision_id, question: question(), label_basis: '建议', state: { injected: 'FUTURE_RESULT_A' }, decision_time_reviewed: true, _meta: { label_status: 'reviewed', decision_time_reviewed: true } }])
  assert.equal(proposed.records[0]._meta.label_status, 'suggested')
  assert.equal(proposed.records[0]._meta.decision_time_reviewed, false)
  assert.ok(!JSON.stringify(proposed.records[0].state).includes('injected'))
  const judge = `${fx.base(runId)}/evidence/U-BASIC-001/judge-trace.jsonl`
  write(join(fx.root, judge), fx.raw); write(join(fx.root, fx.base(runId), 'evidence/U-BASIC-001/judge.json'), '{}')
  const judgeSource = await fx.handle('datasets/source', { run_id: runId, path: judge })
  assert.ok(judgeSource.decisions.every(item => item.eligible === false))
  await assert.rejects(() => preview(fx, judgeSource), /不存在|材料不足/)
  fx.createRun(runId, 'invalid-json-line\n' + fx.raw)
  const incomplete = await fx.handle('datasets/source', { run_id: runId, path: fx.path })
  assert.ok(incomplete.decisions.every(item => item.eligible === false))
  await assert.rejects(() => preview(fx, incomplete), /不存在|材料不足/)
}))

test('重复预览保存不覆盖人工记录，并发确认同一题目仅一个成功', () => withFixture(async fx => {
  const src = await source(fx)
  const [first, second] = await Promise.all([preview(fx, src), preview(fx, src)])
  const results = await Promise.allSettled([apply(fx, first), apply(fx, second)])
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  assert.equal(results.filter(item => item.status === 'rejected').length, 1)
  const saved = results.find(item => item.status === 'fulfilled').value
  const edited = await fx.handle('datasets/update', updatePayload(saved, undefined, { question: question({ label: 'inspect' }) }))
  const again = await preview(fx, src)
  assert.equal(again.count, 0)
  assert.equal((await fx.handle('datasets/read', { dataset_id: edited.dataset.id })).dataset.records[0].questions.decision.label, 'inspect')
}))

test('同一任务组不能跨 split；摘要陈旧的修改拒绝，当前人工复核不丢失', () => withFixture(async fx => {
  const src = await source(fx)
  const records = src.decisions.map((item, index) => ({ decision_id: item.decision_id, question: question({ instructions: `第 ${index + 1} 个查询选择应如何判断？` }), label_basis: '分别核对业务范围。' }))
  const saved = await apply(fx, await preview(fx, src, records))
  assert.equal(saved.dataset.records.length, 2)
  assert.equal(saved.dataset.records[0]._meta.group_id, saved.dataset.records[1]._meta.group_id)
  const reviewed = await fx.handle('datasets/update', updatePayload(saved))
  await assert.rejects(() => fx.handle('datasets/update', updatePayload(saved, saved.dataset.records[1])), /其他任务修改/)
  await assert.rejects(() => fx.handle('datasets/update', updatePayload(reviewed, reviewed.dataset.records[1], { split: 'test' })), /同一任务分组/)
  const after = await fx.handle('datasets/read', { dataset_id: saved.dataset.id })
  assert.equal(after.dataset.records[0]._meta.label_status, 'reviewed'); assert.equal(after.dataset.records[1]._meta.label_status, 'suggested')
}))

test('预览 owner 隔离与原轨迹摘要变化均阻止确认，失败后不产生半个数据集', () => withFixture(async fx => {
  const src = await source(fx)
  const proposal = await preview(fx, src)
  await assert.rejects(() => apply(fx, proposal, 'different-session'), /预览已失效/)
  writeFileSync(join(fx.root, fx.path), fx.raw + JSON.stringify(envelope('turn/end', { reason: 'completed' }, 8)) + '\n')
  await assert.rejects(() => apply(fx, proposal), /轨迹.*变化|来源.*变化/)
  assert.equal((await fx.handle('datasets/list', {})).datasets.length, 0)
}))

test('跨 Run 相同决策材料和问题按内容去重，重复运行不会绕开既有复核', () => withFixture(async fx => {
  const first = await source(fx)
  await apply(fx, await preview(fx, first))
  fx.createRun(runId2)
  const second = await source(fx, { run_id: runId2, path: `${fx.base(runId2)}/evidence/U-BASIC-001/trace.jsonl` })
  const result = await preview(fx, second)
  assert.equal(result.count, 0, '来源位置变化不应改变精确内容去重结果')
}))

test('人工修改问题后再次抽取相同内容仍去重，编辑也不能制造重复训练题', () => withFixture(async fx => {
  const src = await source(fx)
  const saved = await apply(fx, await preview(fx, src))
  const revised = question({ instructions: '人工调整后的同一决策问题应如何选择？' })
  const edited = await fx.handle('datasets/update', updatePayload(saved, undefined, { question: revised }))
  const duplicate = await preview(fx, src, [{ decision_id: src.decisions[0].decision_id, question: revised, label_basis: '再次抽取已人工修改的题目。' }])
  assert.equal(duplicate.count, 0, '应按当前人工内容去重，而非只依赖最初抽取时的 ID')
  const other = await apply(fx, await preview(fx, src, [{ decision_id: src.decisions[1].decision_id, question: question({ instructions: '另一个原子判断是什么？' }), label_basis: '第二条不同题目。' }]))
  await assert.rejects(() => fx.handle('datasets/update', updatePayload(other, undefined, { question: revised })), /重复|相同题目|已存在/)
  assert.equal((await fx.handle('datasets/read', { dataset_id: edited.dataset.id })).dataset.records[0].questions.decision.instructions, revised.instructions)
}))

test('开发、校准和测试分组不进入训练下载，跨批次同组未分配样本同样留出', async () => {
  for (const split of ['development', 'calibration', 'test']) await withFixture(async fx => {
    const src = await source(fx)
    const first = await apply(fx, await preview(fx, src))
    const second = await apply(fx, await preview(fx, src, [{ decision_id: src.decisions[1].decision_id, question: question({ instructions: '是否需要补充另一项只读查询？' }), label_basis: '同一任务的另一个问题。' }]))
    await fx.handle('datasets/update', updatePayload(first, undefined, { split }))
    const reviewed = await fx.handle('datasets/update', updatePayload(second, undefined, { split: 'unassigned' }))
    assert.equal(first.dataset.records[0]._meta.group_id, reviewed.dataset.records[0]._meta.group_id)
    for (const saved of [first, second]) await assert.rejects(() => fx.handle('datasets/export', { dataset_id: saved.dataset.id, kind: 'training' }), /训练样本.*同组未分配/)
    assert.equal((await fx.handle('datasets/export', { dataset_id: second.dataset.id, kind: 'candidates' })).count, 1)
    const independent = await fx.handle('datasets/update', updatePayload(reviewed, undefined, { group_id: 'independent-training-task', split: 'train' }))
    const exported = await fx.handle('datasets/export', { dataset_id: independent.dataset.id, kind: 'training' })
    assert.equal(JSON.parse(exported.content)._meta.group_id, 'independent-training-task')
  })
})
