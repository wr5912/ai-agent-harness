import assert from 'node:assert/strict'
import test from 'node:test'
import { measureModelUsage } from '../src/evaluation/model-usage.ts'

const usage = { inputTokens: 5, outputTokens: 2, totalTokens: 7 }
const event = (type, data = {}) => ({ type, data })
function trace(id, body, path = '/run/evidence/U-CASE-001/trace.jsonl', seeded = false) {
  return { path, rows: [{ session_log: 'session.v4.jsonl', event: { type: 'session', id, isSeeded: seeded } },
    ...body.map((item, seq) => ({ session_log: 'session.v4.jsonl', event: { ...item, seq } }))] }
}
function turn(turn = 1, steps = 1) {
  return [event('turn/start', { turn }), ...Array.from({ length: steps }, (_, index) => {
    const step = index + 1
    return [event('step/start', { turn, step }), ...(step === 1 ? [event('request/header')] : []),
      event('assistant/message', { turn, step, usage }), event('step/end', { turn, step })]
  }).flat(), event('turn/end', { turn })]
}

test('原生尝试结算覆盖多Step；相同配置头只有一次也能计数，重复导出不重复收费', () => {
  const input = trace('target', turn(1, 2))
  const result = measureModelUsage([input, input])
  assert.equal(result.actual_model_calls, 2)
  assert.equal(result.observed_model_calls, 2)
  assert.deepEqual(result.token_usage, { input_tokens: 10, output_tokens: 4, total_tokens: 14 })
  assert.equal(result.hard_cap_supported, false)
})

test('失败重试、业务与评审同名导出文件按真正Session ID分别统计', () => {
  const target = trace('target', [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
    event('assistant/attempt', { turn: 1, step: 1, stream: [{ chunk: { type: 'usage', usage } }] }),
    event('llm/retry', { turn: 1, step: 1 }), event('llm/retry-started', { turn: 1, step: 1 }),
    event('assistant/message', { turn: 1, step: 1, usage }), event('step/end', { turn: 1, step: 1 }), event('turn/end', { turn: 1 })])
  const judge = trace('judge', turn(), '/run/evidence/U-CASE-001/judge-trace.jsonl')
  const result = measureModelUsage([target, judge])
  assert.equal(result.actual_model_calls, 3)
  assert.equal(result.failed_model_calls, 1)
  assert.deepEqual(result.model_calls_by_role, { target: 2, judge: 1, analysis: 0 })
})

test('缺失失败结算或在途请求保留unknown，同时保留已观察请求下界', () => {
  const input = trace('target', [...turn(), event('turn/start', { turn: 2 }), event('step/start', { turn: 2, step: 1 })])
  const result = measureModelUsage([input])
  assert.equal(result.actual_model_calls, null)
  assert.equal(result.observed_model_calls, 1)
  assert.ok(result.model_calls_unknown_reasons.includes('request-lifecycle-in-progress'))
  const failed = trace('target', [event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 }),
    event('step/end', { turn: 1, step: 1 }), event('turn/end', { turn: 1 })])
  assert.equal(measureModelUsage([failed]).actual_model_calls, null)
})

test('明确标记的一次压缩请求计入，失败或未知压缩不猜测调用数', () => {
  const compact = trace('analysis', [event('compaction/start', { compactionId: 'compact' }),
    event('compaction/summary', { compactionId: 'compact', llmStreamCall: true, usage }),
    event('compaction/end', { compactionId: 'compact' }), ...turn()], '/run/evidence/analysis/scene-01/attempt-01/trace.jsonl')
  const result = measureModelUsage([compact])
  assert.equal(result.actual_model_calls, 2)
  assert.equal(result.model_calls_by_role.analysis, 2)
  const failed = trace('failed', [event('compaction/start', { compactionId: 'compact' }), event('compaction/end', { compactionId: 'compact', error: 'failed' })])
  assert.equal(measureModelUsage([failed]).actual_model_calls, null)
})

test('fork继承的历史请求不再次计数，缺Token用量不伪造费用', () => {
  const old = turn()
  const fresh = turn(2)
  const child = trace('child', [...old, event('session/end-seed', { inherited: true }), ...fresh], '/run/evidence/U-CASE-001/trace.jsonl', true)
  const result = measureModelUsage([trace('parent', old), child])
  assert.equal(result.actual_model_calls, 2)
  const noUsage = trace('no-usage', turn().map(item => item.type === 'assistant/message' ? event(item.type, { turn: 1, step: 1 }) : item))
  assert.equal(measureModelUsage([noUsage]).actual_model_calls, 1)
  assert.equal(measureModelUsage([noUsage]).token_usage, null)
})
