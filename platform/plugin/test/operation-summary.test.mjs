import assert from 'node:assert/strict'
import test from 'node:test'
import { operationSummary } from '../src/assistant/operation-summary.ts'

const meta = overrides => ({ kind: 'platform-operation', domain: 'agents', action: 'detail', state: 'completed', ...overrides })
test('回执使用真实对象、数量和阶段，不把返回或创建写成业务成功', () => {
  const result = operationSummary(meta({ input: { agent_id: 'daily-inspection-assistant', experiment_id: 'EXP-daily-inspection-assistant-003-r123456789abc' }, result: { ok: true, value: { agent: { name: '巡检助手' }, experiment: { id: 'EXP-daily-inspection-assistant-003-r123456789abc' }, evaluation: { cases: [{ id: 'A' }, { id: 'B' }] } } } }))
  assert.match(result.title, /巡检助手.*版本 003/); assert.match(result.outcome, /2 个测试用例/)
  assert.match(operationSummary(meta({ action: 'create', result: { ok: true, value: { experiment_id: 'EXP-new-001' } } })).outcome, /业务效果仍需评测/)
  assert.match(operationSummary(meta({ action: 'eval/status', result: { ok: true, value: { status: 'completed' } } })).outcome, /评测已结束/)
  assert.doesNotMatch(operationSummary(meta({ action: 'eval/status', result: { ok: true, value: { status: 'completed' } } })).outcome, /通过|成功/)
  assert.match(operationSummary(meta({ action: 'tasks/capabilities', result: { ok: true, value: { sources: [{}, {}], mcp: [] } } })).outcome, /2 个资产来源.*尚未验证/)
})
test('失败、未知、实际任务修复及未通过交付都明确说明，不臆测成功', () => {
  assert.equal(operationSummary(meta({ state: 'failed', result: { ok: false, error: { message: '来源已变化' } } })).outcome, '来源已变化')
  assert.match(operationSummary(meta({ state: 'unknown' })).outcome, /结果未知/)
  assert.equal(operationSummary(meta({ domain: 'task', action: 'begin-repair', result: { state: 'running', repair_rounds: 1 } })).outcome, '已预留第 1 轮修复')
  const failed = operationSummary(meta({ domain: 'task', action: 'deliver', result: { ready: false, checks: [{ ok: false, message: 'CSV 下载不一致' }] } }))
  assert.equal(failed.failed, true); assert.match(failed.outcome, /尚未交付.*CSV/)
  const wrapped = operationSummary(meta({ domain: 'task', action: 'deliver', state: 'failed', result: { state: 'verification_failed', result: { ok: true, value: { ready: false, checks: [{ ok: false, message: '业务报告缺少设备' }] } } } }))
  assert.equal(wrapped.outcome, '业务报告缺少设备')
  assert.equal(operationSummary(meta({ domain: 'mcp', action: 'list', result: { connections: [] } })).title, '查询 MCP 工具与组合')
})
