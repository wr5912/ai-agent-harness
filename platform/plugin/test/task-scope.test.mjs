import assert from 'node:assert/strict'
import test from 'node:test'
import { taskAllows, taskCandidatePath } from '../src/assistant/task.ts'

const target = 'EXP-inspection-001-r123456789abc'
const task = { target_source: `experiment:${target}`, plan: { agent_id: 'inspection', allowed_actions: [{ domain: 'agents', action: 'edit/apply' }] } }

test('实际编辑器返回的仓库路径与Candidate路径具有相同任务授权', () => {
  const relative = 'candidate/dsh/workspace/AGENTS.md'
  for (const path of [relative, `evolution/experiments/${target}/${relative}`]) {
    assert.equal(taskCandidatePath(task, path), relative)
    assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, edits: [{ path }] }), true)
  }
})

test('路径归一不放行其他版本、评判口径或非规范路径', () => {
  for (const path of ['evaluation.md', 'candidate/../evaluation.md', 'candidate//file', 'candidate/./file', 'candidate\\file', '/candidate/file', `evolution/experiments/EXP-other-001/candidate/file`]) {
    assert.equal(taskCandidatePath(task, path), undefined)
    assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: target, edits: [{ path }] }), false)
  }
  assert.equal(taskAllows(task, 'agents', 'edit/apply', { experiment_id: 'EXP-other-001', edits: [{ path: 'candidate/file' }] }), false)
})
