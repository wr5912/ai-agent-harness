import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, TOOL_ROUTES, visibleToolsForDepth } from '../../evolution/experiments/EXP-security-operations-expert-008/candidate/dsh/managed/security-operations-guard.mjs'

test('EXP-008 巡检工具只在主 Agent 开放，旧工具与委派被拒绝', () => {
  const hooks = new Map()
  let decide
  apply({
    on(event, callback) { hooks.set(event, callback) },
    tools: { guard(callback) { decide = callback }, get() { return {} } },
  })
  const allowed = depth => {
    let names
    const agent = { session: { header: { delegationDepth: depth } }, ctx: { tools: { restrict({ allow }) { names = allow } } } }
    hooks.get('agent/created')({ agent })
    return { agent, names }
  }
  const parent = allowed(0)
  const child = allowed(1)
  assert.deepEqual(TOOL_ROUTES.inspection, [
    'mcp__inspection__list_executable_inspections',
    'mcp__inspection__start_inspection',
    'mcp__inspection__get_inspection_result',
  ])
  assert.deepEqual(parent.names, visibleToolsForDepth(0))
  assert.deepEqual(child.names, visibleToolsForDepth(1))
  for (const name of TOOL_ROUTES.inspection) {
    assert.ok(parent.names.includes(name))
    assert.ok(!child.names.includes(name))
    assert.equal(decide({ name, agent: parent.agent }), undefined)
    assert.match(decide({ name, agent: child.agent }), /主 Agent/)
  }
  for (const name of ['delegate_inspection', 'mcp__inspection__inspection_runs_create']) {
    assert.ok(!parent.names.includes(name))
    assert.ok(decide({ name, agent: parent.agent }))
  }
})

test('未注册的可选 MCP 工具不阻断会话创建', () => {
  const hooks = new Map()
  const registered = new Set(visibleToolsForDepth(0).filter(name =>
    !name.startsWith('mcp__policy-configuration__') && !name.startsWith('mcp__emergency-action__')))
  apply({
    on(event, callback) { hooks.set(event, callback) },
    tools: { guard() {}, get(name) { return registered.has(name) ? {} : undefined } },
  })
  let allowed
  hooks.get('agent/created')({
    agent: { session: { header: { delegationDepth: 0 } }, ctx: { tools: { restrict({ allow }) { allowed = allow } } } },
  })
  assert.deepEqual(allowed, [...registered])
  assert.ok(TOOL_ROUTES.inspection.every(name => allowed.includes(name)))
})
