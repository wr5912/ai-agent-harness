import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TOOL_ROUTES, createSecurityOperationsGuard, visibleToolsForDepth } from '../../evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/security-operations-guard.mjs'

test('EXP-007 自动化任务只由主 Agent 使用', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  for (const name of TOOL_ROUTES.schedule) {
    // Schedule 在根 Agent scope 注册，不能列入全局 tools.restrict() 名单。
    assert.ok(!visibleToolsForDepth(0).includes(name))
    assert.ok(!visibleToolsForDepth(1).includes(name))
    assert.equal(guard.decide({ name, agent: { session: { header: { delegationDepth: 0 } } } }), undefined)
    assert.match(guard.decide({ name, agent: { session: { header: { delegationDepth: 1 } } } }), /主 Agent/)
  }
})
