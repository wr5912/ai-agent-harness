import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'
import { load, dump } from 'js-yaml'

process.env.HARNESS_PROGRAM_ROOT = new URL('../../../', import.meta.url).pathname
process.env.HARNESS_PYTHON ||= '/usr/bin/python3'
const buildRoot = mkdtempSync(join(tmpdir(), 'compute-variants-build-'))
await build({ entryPoints: [new URL('../src/agents/compute-variants.ts', import.meta.url).pathname], outfile: join(buildRoot, 'variants.mjs'), bundle: true, platform: 'node', format: 'esm', external: ['@deepseek-ai/dsh-client-connection'] })
const { createComputeVariantsHandler, computeTraceMetrics } = await import(`file://${join(buildRoot, 'variants.mjs')}`)
const parent = 'EXP-alpha-001-r111111111111', variant = 'EXP-alpha-002-r222222222222'
const parentRun = 'run-11111111-1111-4111-8111-111111111111', variantRun = 'run-22222222-2222-4222-8222-222222222222'
const hash = value => createHash('sha256').update(value).digest('hex')
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
function git(root, args) { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() }
function trace(calls, tokens = 100) {
  const rows = [{ type: 'turn/start', time: 1000, data: { turn: 1 } }]
  for (let index = 1; index <= calls; index++) rows.push(
    { type: 'step/start', time: 1000 + index, data: { turn: 1, step: index } },
    { type: 'request/header', data: { header: { config: { provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'off' } } } },
    { type: 'assistant/message', time: 2000 + index, data: { turn: 1, step: index, usage: { inputTokens: tokens, outputTokens: 10, totalTokens: tokens + 10 }, message: { content: [{ type: 'text', text: '模拟资产状态正常。' }] } } },
    { type: 'tool/call', data: { callId: `call-${index}`, name: 'mock_status', arguments: '{}' } },
    { type: 'tool/result', data: { message: { source: { callId: `call-${index}` }, content: [{ type: 'text', text: '模拟资产状态正常。' }] } } },
    { type: 'step/end', time: 2000 + index, data: { turn: 1, step: index } },
  )
  rows.push({ type: 'turn/end', time: 1000 + calls * 1000, data: { turn: 1, reason: { kind: 'completed' } } })
  return rows.map(event => ({ session_log: 'root', event }))
}
function success(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value }
test('输入资源使用完整 prompt，缓存命中差异不构成上下文优化', () => {
  const metrics = usage => {
    const rows = trace(1)
    rows.find(row => row.event.type === 'assistant/message').event.data.usage = usage
    return computeTraceMetrics(rows, true).values
  }
  // 来自实际两个新 Session 的 DSH 归一分桶；输入总长相同。
  for (const [inputTokens, cacheReadTokens] of [[240, 2176], [496, 1920]]) {
    assert.equal(metrics({ inputTokens, cacheReadTokens, outputTokens: 50, totalTokens: 2466 }).input_tokens, 2416)
  }
  assert.equal(metrics({ inputTokens: 30, outputTokens: 10, totalTokens: 40 }).input_tokens, 30)
  assert.equal(metrics({ inputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3, outputTokens: 10, reasoningTokens: 7 }).input_tokens, 28)
  assert.equal(metrics({ inputTokens: 20, outputTokens: 10 }).input_tokens, null)
  for (const usage of [
    { inputTokens: 30, outputTokens: 10, totalTokens: 39 },
    { inputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3, outputTokens: 10, totalTokens: 40 },
    { inputTokens: 20, cacheReadTokens: -1, outputTokens: 10, totalTokens: 30 },
    { inputTokens: 20.5, outputTokens: 10, totalTokens: 30.5 },
    { inputTokens: Number.MAX_SAFE_INTEGER, cacheReadTokens: 1, cacheWriteTokens: 0, outputTokens: 0 },
    { inputTokens: 20, outputTokens: 10, totalTokens: 30, reasoningTokens: 11 },
  ]) {
    const value = metrics(usage)
    assert.equal(value.input_tokens, null); assert.equal(value.total_tokens, null)
  }
})
async function fixture(planOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'compute-variants-'))
  const path = id => join(root, `evolution/experiments/${id}`)
  write(join(root, 'agents/alpha/evaluation.md'), '# 评测\n\n## 查询\n\n#### U-ONE-001 查询状态\n\n**用户输入**\n\n> 查询模拟资产状态。\n\n**预期**\n\n准确返回状态。\n')
  write(join(path(parent), 'change.yaml'), dump({ experiment_id: parent, agent_id: 'alpha', baseline_ref: 'none:first-experiment' }))
  write(join(path(parent), 'candidate/AGENTS.md'), '完整的模拟查询智能体资产。')
  git(root, ['init']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['add', '.']); git(root, ['commit', '-m', 'fixed parent'])
  const parentCommit = git(root, ['rev-parse', 'HEAD']), runs = new Map()
  let readHook = null
  const digest = id => hash(readFileSync(join(path(id), 'candidate/AGENTS.md')))
  const handler = createComputeVariantsHandler(root, {
    candidateDigest: digest,
    gitCandidateDigest: (id, ref) => { const result = spawnSync('git', ['show', `${ref.slice(4)}:evolution/experiments/${id}/candidate/AGENTS.md`], { cwd: root }); return result.status === 0 ? hash(result.stdout) : null },
    readRun: async id => { await readHook?.(id); return runs.get(id) },
    createExperiment: async payload => {
      assert.equal(payload.parent_ref, `git:${parentCommit}`)
      cpSync(join(path(parent), 'candidate'), join(path(variant), 'candidate'), { recursive: true })
      write(join(path(variant), 'change.yaml'), dump({ experiment_id: variant, agent_id: 'alpha', baseline_ref: payload.parent_ref, parent_ref: payload.parent_ref, parent_experiment_id: parent }))
      write(join(path(variant), 'decision.md'), '# Decision\n\ninconclusive\n')
      return { ok: true, value: { experiment_id: variant } }
    },
  })
  const created = success(await handler('create', { parent_experiment_id: parent, parent_ref: `git:${parentCommit}`, strategy: '减少重复查询和模型调用，完整保留查询结果。', case_ids: ['U-ONE-001'], critical_case_ids: ['U-ONE-001'], min_runs_per_case: 1, resource_metric: 'total_tokens', min_resource_reduction_pct: 10, ...planOverrides }))
  git(root, ['add', '.']); git(root, ['commit', '-m', 'freeze variant plan'])
  const plannedCommit = git(root, ['rev-parse', 'HEAD'])
  const body = { experiment_id: variant, parent_run_ids: [parentRun], variant_run_ids: [variantRun] }
  const addRun = (id, experimentId, calls) => {
    const base = join(path(experimentId), 'runs', id)
    const manifest = { run_id: id, experiment_id: experimentId, agent_id: 'alpha', status: 'completed', created_at: new Date(Date.now() + 1000).toISOString() }
    const lock = { created_at: manifest.created_at, candidate_sha256: digest(experimentId), git_version: { commit: plannedCommit, dirty: false }, program_origin: { commit: 'c'.repeat(40), dirty: false }, executor: 'api', review_mode: 'ai', dependency_env: {}, evaluation_cases: [] }
    write(join(base, 'inputs.lock.json'), JSON.stringify(lock))
    for (const [key, file, value] of [['results_sha256', 'results.jsonl', '{}\n'], ['analysis_sha256', 'analysis.json', '{}'], ['report_sha256', 'report.md', '# 原始报告\n完整结果。']]) { write(join(base, file), value); manifest[key] = hash(value) }
    write(join(base, 'run.yaml'), dump(manifest))
    write(join(base, 'evidence/U-ONE-001/trace.jsonl'), [{ session_log: 'root', event: { type: 'session', id: `session-${id.slice(4)}`, delegationDepth: 0, createdAt: Date.parse(manifest.created_at) + 10 } }, ...trace(calls)].map(row => JSON.stringify(row)).join('\n'))
    write(join(base, 'evidence/U-ONE-001/checks.json'), JSON.stringify({ trace_available: true }))
    const view = { run_id: id, manifest, missing: [], image: { image_build_fingerprint: 'same-build', local_image_id: 'same-image' }, cases: [{ case_id: 'U-ONE-001', frozen: { case_id: 'U-ONE-001', title: '查询状态', inputs: ['查询模拟资产状态。'], expected_behavior: '准确返回状态。' }, trials: [{ execution_status: 'completed', verdict: 'passed' }], review: { reviewed_verdict: 'passed' }, actual_routes: [{ provider: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'off' }], tool_calls: [{ name: 'mock_status', status: 'ok' }], load_observation: { session_id: `session-${id.slice(4)}`, preset_matches: true, workspace_matches: true }, evidence: [{ path: `evolution/experiments/${experimentId}/runs/${id}/report.md`, present: true }] }] }
    write(join(base, 'evidence/dsh-image.json'), JSON.stringify(view.image))
    write(join(base, 'evidence/U-ONE-001/response.json'), JSON.stringify({ assistant_texts: ['模拟资产状态正常。'], turns: [{ route: view.cases[0].actual_routes[0] }] }))
    write(join(base, 'evidence/U-ONE-001/tools.jsonl'), trace(calls).filter(row => row.event.type.startsWith('tool/')).map(JSON.stringify).join('\n'))
    runs.set(id, view)
    return { base, lock, view }
  }
  const left = addRun(parentRun, parent, 2), right = addRun(variantRun, variant, 1)
  return { root, path, handler, body, created, left, right, parentCommit, setReadHook: hook => { readHook = hook } }
}
async function withFixture(task, planOverrides = {}) { const fx = await fixture(planOverrides); try { await task(fx) } finally { rmSync(fx.root, { recursive: true, force: true }) } }

test('固定完整父版、冻结范围、双Run比较和人工确认 end 闭环', () => withFixture(async fx => {
  assert.equal(readFileSync(join(fx.path(parent), 'candidate/AGENTS.md'), 'utf8'), readFileSync(join(fx.path(variant), 'candidate/AGENTS.md'), 'utf8'))
  assert.equal(fx.created.plan.model_change, null)
  const compared = success(await fx.handler('compare', fx.body))
  assert.deepEqual(compared.comparability.limits, [])
  assert.equal(compared.resources.total_tokens.parent, 220)
  assert.equal(compared.resources.total_tokens.variant, 110)
  assert.equal(compared.eligible_for_end, true)
  assert.equal((await fx.handler('confirm', { ...fx.body, decision: 'end', comparison_sha256: compared.comparison_sha256, reason: '完整核对通过。' })).ok, false)
  const confirmed = success(await fx.handler('confirm', { ...fx.body, decision: 'end', human_confirmed: true, comparison_sha256: compared.comparison_sha256, reason: '已核对所有原始输出和工具结果；仅限该冻结查询任务。' }))
  assert.equal(confirmed.variant_kind, 'end')
  const change = load(readFileSync(join(fx.path(variant), 'change.yaml'), 'utf8'))
  assert.equal(change.end_confirmed, true); assert.equal(change.outcome, 'adopt')
  assert.equal(change.resource_evidence_refs.length, 2)
  assert.match(readFileSync(join(fx.path(variant), 'decision.md'), 'utf8'), /仅限冻结任务范围/)
}))

test('缺少 token 保持 unknown，质量通过不代表资源证据充分', () => withFixture(async fx => {
  const rows = trace(1); delete rows.find(row => row.event.type === 'assistant/message').event.data.usage
  write(join(fx.right.base, 'evidence/U-ONE-001/trace.jsonl'), rows.map(JSON.stringify).join('\n'))
  const value = success(await fx.handler('compare', fx.body))
  assert.equal(value.resources.total_tokens.variant, null)
  assert.equal(value.quality.passed, true); assert.equal(value.eligible_for_end, false)
  assert.ok(value.resource_evidence.limits.some(item => item.includes('token')))
  assert.equal((await fx.handler('confirm', { ...fx.body, decision: 'end', human_confirmed: true, comparison_sha256: value.comparison_sha256, reason: '试图确认' })).ok, false)
  assert.equal(success(await fx.handler('confirm', { ...fx.body, decision: 'inconclusive', human_confirmed: true, comparison_sha256: value.comparison_sha256, reason: '缺少资源数据。' })).variant_kind, 'exploratory')
}))

test('事后计划、模型更换、口径变化与装载缺失分别阻断可比性', () => withFixture(async fx => {
  fx.right.lock.created_at = '2000-01-01T00:00:00Z'
  write(join(fx.right.base, 'inputs.lock.json'), JSON.stringify(fx.right.lock))
  fx.right.view.cases[0].actual_routes[0].model = 'other-model'
  const rows = trace(1); rows.find(row => row.event.type === 'request/header').event.data.header.config.model = 'other-model'
  write(join(fx.right.base, 'evidence/U-ONE-001/trace.jsonl'), rows.map(JSON.stringify).join('\n'))
  fx.right.view.cases[0].frozen.inputs = ['不同输入']
  fx.right.view.cases[0].load_observation.preset_matches = false
  const value = success(await fx.handler('compare', fx.body))
  for (const fragment of ['早于冻结计划', '模型路由差异', '冻结 Case', '装载观察']) assert.ok(value.comparability.limits.some(item => item.includes(fragment)), fragment)
  assert.equal(value.eligible_for_end, false)
}))

test('封存证据变化使人工确认摘要过期，不写 end', () => withFixture(async fx => {
  const value = success(await fx.handler('compare', fx.body))
  write(join(fx.right.base, 'evidence/U-ONE-001/trace.jsonl'), trace(2).map(JSON.stringify).join('\n'))
  const result = await fx.handler('confirm', { ...fx.body, decision: 'end', human_confirmed: true, comparison_sha256: value.comparison_sha256, reason: '旧结论' })
  assert.equal(result.ok, false); assert.equal(result.error.code, 'conflict')
  assert.equal(load(readFileSync(join(fx.path(variant), 'change.yaml'), 'utf8')).variant_kind, 'exploratory')
}))

test('功能回归、未固定Candidate与虚假重复不能获得 end', () => withFixture(async fx => {
  fx.right.view.cases[0].review.reviewed_verdict = 'failed'
  fx.right.view.cases[0].trials.push({ execution_status: 'completed', verdict: 'passed' })
  write(join(fx.path(variant), 'candidate/AGENTS.md'), '尚未评测的修改。')
  const value = success(await fx.handler('compare', fx.body))
  assert.equal(value.quality.passed, false)
  assert.ok(value.comparability.limits.some(item => item.includes('Candidate')))
  assert.ok(value.comparability.limits.some(item => item.includes('一次')))
  assert.equal(value.eligible_for_end, false)
}))

test('两侧全失败即使通过率相同，也不能声明业务近似等效', () => withFixture(async fx => {
  fx.left.view.cases[0].review.reviewed_verdict = 'failed'
  fx.right.view.cases[0].review.reviewed_verdict = 'failed'
  const value = success(await fx.handler('compare', fx.body))
  assert.equal(value.quality.passed, false); assert.equal(value.eligible_for_end, false)
}, { critical_case_ids: [] }))

test('复制另一 Run 的 Session 轨迹不能伪装独立重复证据', () => withFixture(async fx => {
  const path = join(fx.right.base, 'evidence/U-ONE-001/trace.jsonl')
  const rows = readFileSync(path, 'utf8').split('\n').map(JSON.parse)
  rows[0].event.id = fx.left.view.cases[0].load_observation.session_id
  fx.right.view.cases[0].load_observation.session_id = rows[0].event.id
  write(path, rows.map(JSON.stringify).join('\n'))
  const value = success(await fx.handler('compare', fx.body))
  assert.ok(value.comparability.limits.some(item => item.includes('重用了已选 Session')))
  assert.equal(value.eligible_for_end, false)
}))

test('只读预览明确模型继承，Case变化后拒绝按旧摘要创建', () => withFixture(async fx => {
  const body = { parent_experiment_id: parent, parent_ref: `git:${fx.parentCommit}`, strategy: '保留完整结果并减少重复调用。', case_ids: ['U-ONE-001'] }
  const status = git(fx.root, ['status', '--porcelain'])
  const preview = success(await fx.handler('preview', body))
  assert.equal(preview.model_configuration, 'inherited_from_fixed_parent')
  assert.equal(preview.plan.model_change, null)
  assert.equal(git(fx.root, ['status', '--porcelain']), status)
  const evaluation = join(fx.root, 'agents/alpha/evaluation.md')
  write(evaluation, readFileSync(evaluation, 'utf8').replace('准确返回状态。', '准确返回状态和来源。'))
  const result = await fx.handler('create', { ...body, expected_preview_sha256: preview.preview_sha256 })
  assert.equal(result.ok, false); assert.equal(result.error.code, 'conflict')
}))

test('原生工具冻结的多Case参数可预览，归一化不修改调用方顺序', () => withFixture(async fx => {
  const evaluation = join(fx.root, 'agents/alpha/evaluation.md')
  write(evaluation, readFileSync(evaluation, 'utf8') + '\n#### U-TWO-001 查询摘要\n\n**用户输入**\n\n> 查询模拟资产摘要。\n\n**预期**\n\n准确返回摘要。\n')
  const chosen = Object.freeze(['U-TWO-001', 'U-ONE-001'])
  const body = Object.freeze({ parent_experiment_id: parent, parent_ref: `git:${fx.parentCommit}`, strategy: '保留两类任务输出并减少重复调用。', case_ids: chosen, critical_case_ids: chosen })
  const preview = success(await fx.handler('preview', body))
  assert.deepEqual(Object.keys(preview.plan.case_hashes), ['U-ONE-001', 'U-TWO-001'])
  assert.deepEqual(preview.plan.critical_case_ids, ['U-ONE-001', 'U-TWO-001'])
  assert.deepEqual(body.case_ids, ['U-TWO-001', 'U-ONE-001'])
}))

test('旧 Session 改装到新 Run 仍不能作为预冻结后的执行', () => withFixture(async fx => {
  const path = join(fx.right.base, 'evidence/U-ONE-001/trace.jsonl')
  const rows = readFileSync(path, 'utf8').split('\n').map(JSON.parse)
  rows[0].event.createdAt = 1000
  write(path, rows.map(JSON.stringify).join('\n'))
  const value = success(await fx.handler('compare', fx.body))
  assert.ok(value.comparability.limits.some(item => item.includes('原始 Session 早于')))
  assert.equal(value.eligible_for_end, false)
}))

test('汇总工具列表为空也不能隐藏原始工具失败或缺失的tools文件', () => withFixture(async fx => {
  const path = join(fx.right.base, 'evidence/U-ONE-001/trace.jsonl')
  const rows = readFileSync(path, 'utf8').split('\n').map(JSON.parse)
  rows.find(row => row.event.type === 'tool/result').event.data.message.isError = true
  write(path, rows.map(JSON.stringify).join('\n'))
  rmSync(join(fx.right.base, 'evidence/U-ONE-001/tools.jsonl'))
  fx.right.view.cases[0].tool_calls = []
  const value = success(await fx.handler('compare', fx.body))
  assert.ok(value.comparability.limits.some(item => item.includes('tools.jsonl 原始证据缺失')))
  assert.ok(value.comparability.limits.some(item => item.includes('原始工具回执失败')))
  assert.equal(value.eligible_for_end, false)
}))

test('response原始字节变化即使汇总没变也使确认摘要失效', () => withFixture(async fx => {
  const compared = success(await fx.handler('compare', fx.body))
  const path = join(fx.right.base, 'evidence/U-ONE-001/response.json')
  write(path, readFileSync(path, 'utf8') + '\n')
  const result = await fx.handler('confirm', { ...fx.body, decision: 'end', human_confirmed: true, comparison_sha256: compared.comparison_sha256, reason: '旧页面确认' })
  assert.equal(result.ok, false); assert.equal(result.error.code, 'conflict')
}))

test('比较过程中Candidate更改并提交，末端仍拒绝把旧Run用于新Candidate', () => withFixture(async fx => {
  const compared = success(await fx.handler('compare', fx.body))
  fx.setReadHook(id => {
    if (id !== variantRun) return
    write(join(fx.path(variant), 'candidate/AGENTS.md'), '比较期间修改的新资产。')
    git(fx.root, ['add', `evolution/experiments/${variant}/candidate`]); git(fx.root, ['commit', '-m', 'concurrent candidate update'])
  })
  const result = await fx.handler('confirm', { ...fx.body, decision: 'end', human_confirmed: true, comparison_sha256: compared.comparison_sha256, reason: '旧页面确认' })
  assert.equal(result.ok, false); assert.equal(result.error.code, 'conflict')
  assert.equal(load(readFileSync(join(fx.path(variant), 'change.yaml'), 'utf8')).variant_kind, 'exploratory')
}))

test('轨迹按模型响应统计，配置头不增调用，重试/缺采集完整性不伪造费用', () => {
  const rows = trace(2)
  rows.push({ session_log: 'root', event: { type: 'request/header', data: {} } })
  assert.equal(computeTraceMetrics(rows, true).values.model_calls, 2)
  assert.equal(computeTraceMetrics(rows, false).values.model_calls, null)
  rows.push({ session_log: 'root', event: { type: 'assistant/attempt', data: { stream: [] } } })
  assert.equal(computeTraceMetrics(rows, true).values.model_calls, null)
  assert.equal(computeTraceMetrics(rows, true).values.total_tokens, null)
})

test.after(() => rmSync(buildRoot, { recursive: true, force: true }))
