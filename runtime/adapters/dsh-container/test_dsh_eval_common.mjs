import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeCase, turnsFromTrace, saveSessionTrace } from './dsh-eval-common.mjs'

const user = (id, text) => ({
  type: 'user/message',
  data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] },
})
const header = tools => ({
  type: 'request/header',
  data: { header: { config: { provider: 'test', model: 'model' }, tools } },
})
const assistant = text => ({
  type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } },
})
const end = turn => ({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
const archive = root => ({
  root,
  trace: root.map(event => ({ session_log: 'session.jsonl', event })),
})

const multiTurnArchive = archive([
  user('u1', '执行一次常规巡检。'), header([{ name: 'inspection.run' }]),
  assistant('共 39 台，报告：https://example/report'), end(1),
  user('u2', '只分析。'), header([{ name: 'inspection.analyze' }]),
  assistant('分析完成。'), end(2),
])

const turns = turnsFromTrace(multiTurnArchive, ['执行一次常规巡检。', '只分析。'])
assert.deepEqual(turns.map(turn => turn.assistant_text), [
  '共 39 台，报告：https://example/report', '分析完成。',
])
const inheritedHeaderTurns = turnsFromTrace(archive([
  user('u1', '首次分析。'), header([{ name: 'read' }]), assistant('首次完成。'), end(1),
  user('u2', '修正格式。'), assistant('修正完成。'), end(2),
]), ['首次分析。', '修正格式。'])
assert.deepEqual(inheritedHeaderTurns[1].route, { provider: 'test', model: 'model' })
assert.deepEqual(inheritedHeaderTurns[1].tool_names, ['read'])
assert.throws(
  () => turnsFromTrace(multiTurnArchive, ['执行一次常规巡检。']),
  /evidence-cross-turn/,
)

const targetArchive = archive([
  user('u1', '执行一次常规巡检。'), header([{ name: 'inspection.run' }]),
  { type: 'tool/call', data: { name: 'inspection.run' } },
  { type: 'tool/result', data: { result: { total: 39, report_url: 'https://example/report' } } },
  assistant('共 39 台，报告：https://example/report'), end(1),
])
const targetTurns = turnsFromTrace(targetArchive, ['执行一次常规巡检。'])
const item = {
  case_id: 'U-INS-001',
  inputs: ['执行一次常规巡检。'],
  expected_behavior: '设备数量和报告链接必须来自真实工具返回。',
}
const judged = await judgeCase(item, {
  assistant_texts: [targetTurns[0].assistant_text],
  turns: [...targetTurns, { ...targetTurns[0], route: null }],
}, targetArchive,
  async input => {
    const request = JSON.parse(input)
    assert.equal(request.evidence.tool_events.length, 2)
    return {
      session: { session_id: 'judge-session' },
      archive: archive([
        user('judge-user', input), header([]),
        assistant('{"verdict":"passed","reason":"回答与同一 Session 工具结果一致"}'), end(1),
      ]),
    }
  })
assert.equal(judged.available, true)
assert.equal(judged.response.verdict, 'passed')
assert.deepEqual(judged.checks.tools, [])
assert.equal(judged.checks.same_route_as_target, true)

const extraJudgeField = await judgeCase(item, {
  assistant_texts: [targetTurns[0].assistant_text], turns: targetTurns,
}, targetArchive, async input => ({
  session: { session_id: 'judge-session' },
  archive: archive([
    user('judge-user', input), header([]),
    assistant('{"verdict":"passed","reason":"回执与回答一致","reason_note":"附加说明"}'), end(1),
  ]),
}))
assert.deepEqual(extraJudgeField.response, { verdict: 'passed', reason: '回执与回答一致' })

const englishReply = await judgeCase({ ...item, expected_behavior: '用中文指出证据缺口。' }, {
  assistant_texts: ['Please provide the evidence.'],
  turns: targetTurns,
}, targetArchive, async input => ({
  session: { session_id: 'judge-session' },
  archive: archive([
    user('judge-user', input), header([]),
    assistant('{"verdict":"passed","reason":"内容符合要求"}'), end(1),
  ]),
}))
assert.equal(englishReply.response.verdict, 'failed')
assert.equal(englishReply.checks.model_verdict, 'passed')
assert.equal(englishReply.checks.deterministic_check, 'language-mismatch')

const evidenceDirectory = await mkdtemp(join(tmpdir(), 'dsh-eval-common-trace-'))
try {
  const successChecks = { completed: true }
  await saveSessionTrace(evidenceDirectory, targetArchive, successChecks)
  assert.deepEqual(JSON.parse(await readFile(join(evidenceDirectory, 'checks.json'), 'utf8')), { completed: true, trace_available: true })
  assert.equal(successChecks.trace_available, undefined, '持久化回执不修改调用方对象')
  await saveSessionTrace(evidenceDirectory, archive([user('partial', '未完成输入')]), { completed: false })
  assert.deepEqual(JSON.parse(await readFile(join(evidenceDirectory, 'checks.json'), 'utf8')), { completed: false, trace_available: true }, '有轨迹不等于执行完成')
  await saveSessionTrace(evidenceDirectory, null, { completed: false, trace_available: true })
  assert.equal(JSON.parse(await readFile(join(evidenceDirectory, 'checks.json'), 'utf8')).trace_available, false)
  assert.equal(await readFile(join(evidenceDirectory, 'trace.jsonl'), 'utf8'), '')
} finally { await rm(evidenceDirectory, { recursive: true, force: true }) }

console.log(JSON.stringify({ status: 'dsh-eval-common-tests-passed', cases: 9 }))
