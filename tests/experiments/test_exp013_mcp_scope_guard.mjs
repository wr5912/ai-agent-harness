import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply } from '../../evolution/experiments/EXP-security-operations-expert-013/candidate/dsh/managed/security-operations-guard.mjs'

test('EXP-013 Guard 使用 Agent 视角检查 Preset 中的 MCP 工具', () => {
  const tools = new Set(['mcp__inspection__inspection_capabilities_list', 'mcp__sec-ops__get_event_by_id'])
  let created
  apply({
    on(event, callback) { if (event === 'agent/created') created = callback },
    tools: {
      guard() {},
      get(name, agent) { return agent && tools.has(name) ? {} : undefined },
    },
  })
  for (const [depth, expected] of [
    [0, ['mcp__inspection__inspection_capabilities_list']],
    [1, ['mcp__sec-ops__get_event_by_id']],
  ]) {
    let allowed
    const agent = { session: { header: { delegationDepth: depth } }, ctx: { tools: { restrict({ allow }) { allowed = allow } } } }
    created({ agent })
    assert.deepEqual(allowed, expected)
  }
})
