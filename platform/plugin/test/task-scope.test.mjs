import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { parseTaskPlan, taskAllows, taskCandidatePath } from '../src/assistant/task.ts'

const target = 'EXP-inspection-001-r123456789abc'
const task = { target_source: `experiment:${target}`, plan: { agent_id: 'inspection', allowed_actions: [{ domain: 'agents', action: 'edit/apply' }] } }

test('编辑器接受的Candidate内相对路径、candidate前缀和仓库路径具有相同任务授权与回退身份', () => {
  for (const file of ['dsh/workspace/AGENTS.md', 'dsh/managed/security-operations-guard.mjs', 'dsh/managed/compute-workflow/index.ts', 'harness.yaml']) {
    const relative = `candidate/${file}`
    for (const path of [file, relative, `evolution/experiments/${target}/${relative}`]) {
      assert.equal(taskCandidatePath(task, path), relative)
      assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, edits: [{ path }] }), true)
      assert.equal(taskCandidatePath(task, path).slice(10), file, '回退快照查找固定父版文件使用同一Candidate内身份')
    }
  }
})

test('任务路径归一与真实编辑器读取指向同一文件，不由测试替身约定路径', async t => {
  const root = mkdtempSync(join(tmpdir(), 'task-editor-path-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, 'editor.mjs')
  await build({ entryPoints: [new URL('../src/agents/index.ts', import.meta.url).pathname], outfile: output, bundle: true, platform: 'node', format: 'esm' })
  const { createAgentsHandler } = await import(pathToFileURL(output).href)
  const handler = createAgentsHandler(root)
  const file = 'dsh/managed/workflow.ts'
  const repositoryPath = `evolution/experiments/${target}/candidate/${file}`
  mkdirSync(dirname(join(root, repositoryPath)), { recursive: true })
  writeFileSync(join(root, repositoryPath), 'export const value = true\n')
  writeFileSync(join(root, `evolution/experiments/${target}/change.yaml`), 'agent_id: inspection\n')
  for (const path of [file, `candidate/${file}`, repositoryPath]) {
    const read = await handler('edit/read', { experiment_id: target, path }, new AbortController().signal)
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.equal(read.value.path, repositoryPath)
    assert.equal(read.value.exists, true)
    assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, edits: [{ path }] }), true)
    assert.equal(`evolution/experiments/${target}/${taskCandidatePath(task, path)}`, read.value.path)
  }
})

test('路径归一不放行其他版本、评判口径或非规范路径', () => {
  for (const path of ['', 'evaluation.md', 'decision.md', '../evaluation.md', 'dsh/../evaluation.md', 'dsh//file', 'dsh/./file', 'candidate/../evaluation.md', 'candidate//file', 'candidate/./file', 'candidate\\file', '/candidate/file', '/dsh/file',
    `evolution/experiments/EXP-other-001/candidate/file`, `evolution/experiments/${target}/decision.md`, `evolution/experiments/${target}/candidate-other/file`, 'agents/inspection/evaluation.md']) {
    assert.equal(taskCandidatePath(task, path), undefined)
    assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, edits: [{ path }] }), false)
  }
  assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: 'EXP-other-001', edits: [{ path: 'candidate/file' }] }), false)
  assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, agent_id: 'other-agent', edits: [{ path: 'dsh/managed/guard.mjs' }] }), false)
  assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, edits: [{ path: 'dsh/managed/guard.mjs' }, { path: 'decision.md' }] }), false)
})

test('代码变体任务只允许目标构建和原父版/变体的同一组Case，Git冻结不能自动授权', () => {
  const plan = parseTaskPlan({ goal: '生成固定流程并比较', agent_id: 'inspection', source: `experiment:${target}`, kind: 'compute-variant',
    compute_variant: { parent_experiment_id: 'EXP-inspection-000', parent_ref: 'git:' + 'a'.repeat(40) }, evaluation_case_ids: ['U-ASSET-001'], deliverables: ['工作流与比较'],
    allowed_actions: [{ domain: 'agents', action: 'compute-variants/build' }, { domain: 'agents', action: 'eval/start' }] })
  const value = { target_source: `experiment:${target}`, plan }
  assert.equal(taskAllows(value, 'agents', 'compute-variants/build', { experiment_id: target }), true)
  assert.equal(taskAllows(value, 'agents', 'compute-variants/build', { experiment_id: 'EXP-other-001' }), false)
  for (const source of [value.target_source, 'experiment:EXP-inspection-000']) assert.equal(taskAllows(value, 'agents', 'eval/start', { source, cases: ['U-ASSET-001'] }), true)
  assert.equal(taskAllows(value, 'agents', 'eval/start', { source: value.target_source, cases: ['U-ASSET-OTHER'] }), false)
  assert.equal(taskAllows(value, 'agents', 'compute-variants/freeze', { experiment_id: target }), false)
  assert.throws(() => parseTaskPlan({ ...plan, allowed_actions: [{ domain: 'agents', action: 'compute-variants/freeze' }] }), /不支持连续执行/)
  assert.throws(() => parseTaskPlan({ ...plan, compute_variant: undefined }), /固定父版/)
  assert.equal(plan.budget.max_model_calls, 60, '代码变体也保留默认60，不自动提高已有预算')
  const extended = parseTaskPlan({ ...plan, budget: { ...plan.budget, max_model_calls: 120 } })
  assert.equal(extended.budget.max_model_calls, 120)
  assert.throws(() => parseTaskPlan({ ...plan, kind: 'business', compute_variant: undefined, allowed_actions: [{ domain: 'agents', action: 'eval/start' }], budget: { ...plan.budget, max_model_calls: 61 } }), /普通任务模型调用上限/)
  assert.throws(() => parseTaskPlan({ ...plan, budget: { ...plan.budget, max_model_calls: 121 } }))
})
