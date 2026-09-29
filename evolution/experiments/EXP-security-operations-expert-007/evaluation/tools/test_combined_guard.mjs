import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSecurityOperationsGuard,
  visibleToolsForDepth,
} from '../../candidate/dsh/managed/security-operations-guard.mjs'
import { setPolicyConfirmationTurn } from '../../candidate/dsh/managed/policy-configuration-guard.mjs'
import { setEmergencyConfirmationTurn } from '../../candidate/dsh/managed/emergency-action-guard.mjs'
import { apply as policyRuntime, latestDraft as latestPolicyDraft } from '../../candidate/dsh/managed/policy-confirmation-runtime.mjs'
import { apply as emergencyRuntime, latestDraft as latestEmergencyDraft } from '../../candidate/dsh/managed/emergency-confirmation-runtime.mjs'

const root = () => ({ id: 'root', session: { header: { delegationDepth: 0 } } })
const child = () => ({ id: 'child', session: { header: { delegationDepth: 1 } } })
const call = (agent, name, args = {}) => ({ agent, name, arguments: args })
const policyIntent = device => ({
  operation: 'ADD', source: { selector_type: 'IP', value: '192.0.2.10' },
  destination: { selector_type: 'IP', value: '198.51.100.20' },
  protocol: 'TCP', destination_port: 443, device_query: device,
})
const policyPrepare = (agent, device = 'fw-1') => call(agent,
  'mcp__policy-configuration__prepare_policy_configuration', { body: { intent: policyIntent(device) } })
const emergencyPrepare = agent => call(agent,
  'mcp__emergency-action__prepare_emergency_action', { body: { request_id: 'req-1', intent: '隔离受影响终端' } })

test('确认器识别当前 DSH 的直接文本工具回执，并拒绝错误回执', () => {
  const operationId = `op_${'a'.repeat(32)}`
  const digest = `sha256:${'b'.repeat(64)}`
  const toolResult = (seq, callId, value, isError = false) => ({
    seq, type: 'tool/result', data: { message: {
      source: { kind: 'tool', callId }, isError,
      content: [{ type: 'text', text: JSON.stringify(value) }],
    } },
  })
  const emergencyEvents = [
    { seq: 1, type: 'tool/call', data: { callId: 'emergency-1',
      name: 'mcp__emergency-action__prepare_emergency_action',
      arguments: JSON.stringify({ body: { request_id: 'req-1' } }) } },
    toolResult(2, 'emergency-1', { operation_id: operationId, version: 1,
      snapshot_digest: digest, snapshot: { content: {} }, phase: 'READY',
      execution_status: 'NOT_SUBMITTED', expires_at: '2099-01-01T00:00:00Z' }),
    { seq: 3, type: 'user/message', data: { id: 'confirm-1', source: { kind: 'user' },
      content: [{ type: 'text', text: '确认执行' }] } },
  ]
  assert.equal(latestEmergencyDraft(emergencyEvents, 'confirm-1')?.operationId, operationId)
  assert.equal(latestEmergencyDraft(emergencyEvents.map(event => event.seq === 2
    ? { ...event, data: { message: { ...event.data.message, isError: true } } } : event), 'confirm-1'), null)

  const policyEvents = [
    { seq: 1, type: 'tool/call', data: { callId: 'policy-1',
      name: 'mcp__policy-configuration__get_policy_configuration_result',
      arguments: JSON.stringify({ operationId }) } },
    toolResult(2, 'policy-1', { code: '200', data: { operation_id: operationId,
      candidate_digest: digest, task_id: 303, task_status: 'DRAFT',
      confirmation_required: true, result_code: 'DRAFT_READY' } }),
    { seq: 3, type: 'user/message', data: { id: 'confirm-2', source: { kind: 'user' },
      content: [{ type: 'text', text: '执行' }] } },
  ]
  assert.equal(latestPolicyDraft(policyEvents)?.taskId, 303)
  assert.equal(latestPolicyDraft(policyEvents.map(event => event.seq === 2
    ? { ...event, data: { message: { ...event.data.message, isError: true } } } : event)), null)
})

test('单一主角色可见两类工具，子角色仍只有原有取证工具', () => {
  assert(visibleToolsForDepth(0).includes('mcp__policy-configuration__prepare_policy_configuration'))
  assert(visibleToolsForDepth(0).includes('mcp__emergency-action__prepare_emergency_action'))
  assert(!visibleToolsForDepth(1).some(name => name.includes('policy-configuration') || name.includes('emergency-action')))
  assert(visibleToolsForDepth(1).includes('mcp__inspection__inspection_runs_finalize'))
  assert(visibleToolsForDepth(1).includes('mcp__sec-ops__get_event_by_id'))
})

test('原有巡检、故障委派可在同一轮重复使用，响应规划仍默认拒绝', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  const agent = root()
  guard.beginTurn(agent, '调查并巡检')
  assert.equal(guard.decide(call(agent, 'delegate_inspection')), undefined)
  assert.equal(guard.decide(call(agent, 'delegate_fault_analysis')), undefined)
  assert.equal(guard.decide(call(agent, 'delegate_inspection')), undefined)
  assert.match(guard.decide(call(agent, 'delegate_response_planning')), /受信 Gate 未开启/)
  assert.equal(guard.decide(call(child(), 'mcp__inspection__inspection_runs_finalize')), undefined)
  assert.equal(guard.decide(call(child(), 'mcp__sec-ops__get_event_by_id')), undefined)
})

test('策略指定设备必须原样传入，策略与应急在每轮工具调用中隔离', () => {
  const guard = createSecurityOperationsGuard()
  const agent = root()
  guard.beginTurn(agent, 'device_query=fw-1 配置策略')
  assert.match(guard.decide(policyPrepare(agent, 'fw-2')), /指定设备/)
  assert.equal(guard.decide(policyPrepare(agent)), undefined)
  assert.match(guard.decide(emergencyPrepare(agent)), /不能跨能力/)
  assert.match(guard.decide(call(agent, 'delegate_inspection')), /不能调用其他业务能力/)
  guard.beginTurn(agent, '隔离终端')
  assert.equal(guard.decide(emergencyPrepare(agent)), undefined)
  assert.match(guard.decide(policyPrepare(agent)), /不能跨能力/)
})

test('新工具只给主 Agent，旧策略路由和模型直调确认继续拒绝', () => {
  const guard = createSecurityOperationsGuard()
  assert.match(guard.decide(policyPrepare(child())), /主 Agent/)
  assert.match(guard.decide(emergencyPrepare(child())), /主 Agent/)
  const agent = root()
  for (const tool of [
    'mcp__sec-ops__prepare_policy_configuration',
    'mcp__policy-configuration__confirm_policy_configuration',
    'mcp__emergency-action__confirm_emergency_action',
    'mcp__emergency-action__submit_emergency_action',
  ]) assert.match(guard.decide(call(agent, tool)), /永久禁用/)
})

test('确认轮次权限互不扩张，策略禁止全部模型工具，应急只能查询绑定操作', () => {
  const guard = createSecurityOperationsGuard()
  const agent = root()
  setPolicyConfirmationTurn(agent, true)
  assert.match(guard.decide(call(agent, 'mcp__emergency-action__get_emergency_action_result', { operationId: 'op_123' })), /策略确认轮次/)
  setPolicyConfirmationTurn(agent, false)
  const operationId = `op_${'a'.repeat(32)}`
  setEmergencyConfirmationTurn(agent, true, operationId)
  assert.equal(guard.decide(call(agent, 'mcp__emergency-action__get_emergency_action_result', { operationId })), undefined)
  assert.match(guard.decide(call(agent, 'mcp__emergency-action__get_emergency_action_result', { operationId: `op_${'b'.repeat(32)}` })), /应急确认轮次/)
  assert.match(guard.decide(policyPrepare(agent)), /应急确认轮次/)
  setEmergencyConfirmationTurn(agent, false)
})

function runtimeHook(apply) {
  let hook
  let reads = 0
  apply({
    on: (event, callback) => { if (event === 'agent/pre-step') hook = callback },
    sessionQuery: { readSession: async () => { reads++; return { events: [] } } },
  })
  return {
    run: async (agent, phrase) => hook({ agent, step: 1, messages: [{ id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text: phrase }] }] },
      async () => ({ kind: 'enter', messages: [] })),
    reads: () => reads,
  }
}

test('两个受信确认器使用不同精确词，子 Agent 不处理确认', async () => {
  const policy = runtimeHook(policyRuntime)
  const emergency = runtimeHook(emergencyRuntime)
  assert.equal((await policy.run(root(), '确认执行')).messages.length, 0)
  assert.equal((await emergency.run(root(), '执行')).messages.length, 0)
  assert.equal((await policy.run(root(), '执行')).messages.length, 0)
  assert.equal((await emergency.run(root(), '确认执行')).messages.length, 0)
  assert.equal((await policy.run(child(), '执行')).messages.length, 0)
  assert.equal((await emergency.run(child(), '确认执行')).messages.length, 0)
  assert.equal(policy.reads(), 1)
  assert.equal(emergency.reads(), 1)
})
