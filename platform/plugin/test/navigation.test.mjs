import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationHash, readNavigation } from '../src/navigation.ts'

test('页面定位保留精确 Agent、版本、Run 与用例，未知地址回首页', () => {
  const target = { page: 'evaluation', agent_id: 'test01', experiment_id: 'EXP-test01-002', run_id: 'run-11111111-1111-4111-8111-111111111111', case_id: 'U-IDENTITY-001', tab: 'runs' }
  assert.deepEqual(readNavigation(navigationHash(target)), target)
  assert.deepEqual(readNavigation('#/unknown'), { page: 'home' })
  assert.deepEqual(readNavigation('#/agents?agent_id=../../outside&tab=assets'), { page: 'agents', tab: 'assets' })
})
