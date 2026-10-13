import assert from 'node:assert/strict'
import test from 'node:test'
import { createSecurityOperationsGuard } from '../dsh/managed/security-operations-guard.mjs'
import { setEmergencyConfirmationTurn } from '../dsh/managed/emergency-action-guard.mjs'

test('巡检 Skill 锁定本轮能力，策略和应急工具不能越界', () => {
  const guard = createSecurityOperationsGuard()
  const agent = { session: { header: { delegationDepth: 0 } } }
  const decide = (name, args = {}) => guard.decide({ agent, name, arguments: args })

  guard.beginTurn(agent, '只列出巡检项')
  assert.match(decide('mcp__policy-configuration__get_policy_configuration_status'), /必须先加载/)
  assert.equal(decide('skill', { name: 'security-inspection' }), undefined)
  assert.equal(decide('mcp__inspection__list_executable_inspections'), undefined)
  assert.match(decide('mcp__inspection__inspection_capabilities_list'), /不允许|不能|未列入/)
  assert.match(decide('mcp__policy-configuration__get_policy_configuration_status'), /必须先加载/)
  assert.match(decide('mcp__emergency-action__list_emergency_actions'), /必须先加载/)

  guard.beginTurn(agent, '新增网络访问策略')
  assert.equal(decide('skill', { name: 'policy-configuration' }), undefined)
  assert.equal(decide('mcp__policy-configuration__get_policy_configuration_status'), undefined)
  assert.match(decide('mcp__inspection__list_executable_inspections'), /不能调用其他业务能力/)
  assert.match(decide('skill', { name: 'security-inspection' }), /不能跨能力/)
})

test('应急确认轮次仍能查询当前操作结果', () => {
  const guard = createSecurityOperationsGuard()
  const agent = { session: { header: { delegationDepth: 0 } } }
  const operationId = `op_${'a'.repeat(32)}`
  guard.beginTurn(agent, '确认执行')
  setEmergencyConfirmationTurn(agent, true, operationId)
  try {
    assert.equal(guard.decide({ agent, name: 'mcp__emergency-action__get_emergency_action_result', arguments: { operationId } }), undefined)
  } finally {
    setEmergencyConfirmationTurn(agent, false)
  }
})
