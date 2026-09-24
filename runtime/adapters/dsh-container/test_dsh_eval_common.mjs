import assert from 'node:assert/strict'
import { judgeCase, turnsFromTrace } from './dsh-eval-common.mjs'

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
  assistant_texts: [targetTurns[0].assistant_text], turns: targetTurns,
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

console.log(JSON.stringify({ status: 'dsh-eval-common-tests-passed', cases: 3 }))
