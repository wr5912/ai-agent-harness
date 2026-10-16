import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationHash, readNavigation } from '../src/navigation.ts'

test('页面定位保留精确 Agent、版本、Run 与用例，未知地址回首页', () => {
  const target = { page: 'evaluation', agent_id: 'test01', experiment_id: 'EXP-test01-002', run_id: 'run-11111111-1111-4111-8111-111111111111', case_id: 'U-IDENTITY-001', tab: 'runs' }
  assert.deepEqual(readNavigation(navigationHash(target)), target)
  assert.deepEqual(readNavigation('#/unknown'), { page: 'home' })
  assert.deepEqual(readNavigation('#/agents?agent_id=../../outside&tab=assets'), { page: 'agents', tab: 'assets' })
})

test('智能体列表视图独立于右侧详情页签并随地址往返恢复', () => {
  for (const list_view of ['agents', 'variants']) {
    const target = { page: 'agents', agent_id: 'test01', experiment_id: 'EXP-test01-002', list_view, tab: 'compute-variants' }
    assert.deepEqual(readNavigation(navigationHash(target)), target)
  }
})

test('旧链接保留原样，非法列表视图在读取和写入时均忽略', () => {
  const target = { page: 'agents', agent_id: 'test01', tab: 'assets' }
  assert.equal(navigationHash(target), '#/agents?agent_id=test01&tab=assets')
  assert.deepEqual(readNavigation(navigationHash(target)), target)
  for (const list_view of ['all', 'VARIANTS', '', '../../outside']) {
    assert.deepEqual(readNavigation(`#/agents?agent_id=test01&tab=assets&list_view=${encodeURIComponent(list_view)}`), target)
    assert.equal(navigationHash({ ...target, list_view }), navigationHash(target))
  }
})
