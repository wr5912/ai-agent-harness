import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, TOOL_ROUTES } from '../../evolution/experiments/EXP-security-operations-expert-012/candidate/dsh/managed/security-operations-guard.mjs'

test('EXP-012 只向主 Agent 注册服务现行四个巡检工具', () => {
  const names = [
    'mcp__inspection__inspection_capabilities_list',
    'mcp__inspection__inspection_runs_start_with_plan',
    'mcp__inspection__inspection_runs_collect_evidence',
    'mcp__inspection__inspection_runs_finalize',
  ]
  assert.deepEqual(TOOL_ROUTES.inspection, names)
  const hooks = new Map()
  let decide
  apply({
    on(event, callback) { hooks.set(event, callback) },
    tools: { guard(callback) { decide = callback }, get(name) { return names.includes(name) ? {} : undefined } },
  })
  for (const depth of [0, 1]) {
    let allowed
    const agent = { session: { header: { delegationDepth: depth } }, ctx: { tools: { restrict({ allow }) { allowed = allow } } } }
    hooks.get('agent/created')({ agent })
    assert.deepEqual(allowed, depth === 0 ? names : [])
    for (const name of names) assert.equal(decide({ name, agent }) === undefined, depth === 0)
  }
  assert.ok(decide({ name: 'mcp__inspection__start_inspection', agent: { session: { header: { delegationDepth: 0 } } } }))
})
