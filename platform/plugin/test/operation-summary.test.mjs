import assert from 'node:assert/strict'
import test from 'node:test'
import { operationSummary } from '../src/assistant/operation-summary.ts'

test('代码变体完成回执只说明生成和比较已核对，不声称业务实例已交付或自动end', () => {
  const value = operationSummary({ kind: 'platform-operation', domain: 'task', action: 'deliver', state: 'completed', result: { state: 'completed', plan: { kind: 'compute-variant' }, delivery: { end_confirmed: false } } })
  assert.equal(value.title, '核对代码变体与比较证据')
  assert.match(value.outcome, /end 仍需用户复核/)
  assert.doesNotMatch(value.outcome, /实际实例与业务产物已核验/)
})

const meta = overrides => ({ kind: 'platform-operation', domain: 'agents', action: 'detail', state: 'completed', ...overrides })
test('变体操作摘要使用独立名称，改名回执只说明名称保存', () => {
  const input = { experiment_id: 'EXP-alpha-002', variant_name: '资产告警轻量版', strategy: '将资产查询和告警查询固化为固定工作流，并保留字段与异常语义' }
  const value = operationSummary(meta({ action: 'compute-variants/rename', input, result: { ok: true, value: { experiment_id: input.experiment_id, variant_name: input.variant_name } } }))
  assert.equal(value.title, '修改变体名称：资产告警轻量版')
  assert.equal(value.outcome, '已保存变体名称：资产告警轻量版')
  assert.equal(operationSummary(meta({ action: 'compute-variants/rename', input, state: 'awaiting_confirmation' })).outcome, '等待确认')
  assert.equal(operationSummary(meta({ action: 'compute-variants/create', input, result: { ok: true, value: { experiment_id: input.experiment_id, variant_name: input.variant_name } } })).title, '创建探索性算力变体：资产告警轻量版')
  assert.doesNotMatch(value.title + value.outcome, /工作流|end|等效|验证通过/)
})

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

test('真实嵌套CLI回执保留实例预览、容器观察及分组运行数量', () => {
  const wrapped = value => ({ kind: 'platform-operation', state: 'completed', result: { ok: true, value } })
  const preview = operationSummary(meta({ domain: 'instances', action: 'preview', input: { name: 'inspection', operation: 'create' }, result: wrapped({ name: 'inspection', operation: 'create', plan: { source_id: 'experiment:EXP-daily-003-r123456789abc', port: 3110 } }) }))
  assert.equal(preview.title, '核对实例操作范围：inspection')
  assert.match(preview.outcome, /版本 003.*端口 3110.*尚未执行/)
  const receipt = { name: 'inspection', operation: 'create', ok: true, value: { json_objects: [{ name: 'inspection', dsh_running: true, port: 3110 }, { hint: '需要注册工作区' }], value: { hint: '需要注册工作区' } } }
  const started = operationSummary(meta({ domain: 'instances', action: 'run', input: { name: 'inspection', operation: 'create' }, result: wrapped(receipt) }))
  assert.equal(started.title, '创建实例：inspection')
  assert.match(started.outcome, /正在运行.*3110.*业务效果仍需核验/)
  receipt.value.json_objects[0].dsh_running = false
  assert.match(operationSummary(meta({ domain: 'instances', action: 'run', result: wrapped(receipt) })).outcome, /当前未运行/)
  receipt.value.json_objects = [{ name: 'other', dsh_running: true }]
  assert.match(operationSummary(meta({ domain: 'instances', action: 'run', input: { operation: 'create' }, result: wrapped(receipt) })).outcome, /最终状态需查询/)
  const runs = operationSummary(meta({ action: 'runs/index', result: wrapped({ experiments: [{ runs: [{}, {}] }, { runs: [] }] }) }))
  assert.equal(runs.outcome, '查到 2 个版本、2 条运行记录')
  assert.equal(operationSummary(meta({ action: 'edit/preview', result: wrapped({ dry_run: true, edits: [{}] }) })).outcome, '已核对 1 份文件修改；尚未写入')
  assert.equal(operationSummary(meta({ domain: 'task', action: 'context', result: { workspace: {}, task_context: {} } })).outcome, '已读取当前工作区与固定任务目标')
  assert.match(operationSummary(meta({ domain: 'task', action: 'status', result: { state: 'not_started' } })).outcome, /任务还未开始/)
  assert.match(operationSummary(meta({ domain: 'task', action: 'rollback', result: { state: 'rolled_back', result: { ok: true, value: { restored: [{}, {}], deleted: [{}] } } } })).outcome, /恢复 2 份原文件.*移除 1 份.*预算与记录保留/)
})
