import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../dsh/managed/security-operations-guard.mjs'

test('业务 Guard 按 Agent 作用域识别 Web MCP 工具', () => {
  const tools = new Set(['mcp__inspection__list_executable_inspections', 'mcp__sec-ops__get_event_by_id'])
  let created
  apply({
    on(event, callback) { if (event === 'agent/created') created = callback },
    tools: {
      guard() {},
      get(name, agent) { return agent && tools.has(name) ? {} : undefined },
    },
  })
  for (const [depth, expected] of [
    [0, ['mcp__inspection__list_executable_inspections']],
    [1, ['mcp__sec-ops__get_event_by_id']],
  ]) {
    let allowed
    const agent = { session: { header: { delegationDepth: depth } }, ctx: { tools: { restrict({ allow }) { allowed = allow } } } }
    created({ agent })
    assert.deepEqual(allowed, expected)
  }
})
