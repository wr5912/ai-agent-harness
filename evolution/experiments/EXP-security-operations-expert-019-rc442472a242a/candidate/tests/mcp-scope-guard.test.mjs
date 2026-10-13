import assert from 'node:assert/strict'
import test from 'node:test'
import { apply, createSecurityOperationsGuard } from '../dsh/managed/security-operations-guard.mjs'

test('业务 Guard 按 Agent 作用域识别 Web MCP 工具', () => {
  const resources = ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']
  const tools = new Set([...resources, 'mcp__inspection__list_executable_inspections', 'mcp__sec-ops__get_event_by_id'])
  let created
  apply({
    on(event, callback) { if (event === 'agent/created') created = callback },
    tools: {
      guard() {},
      get(name, agent) { return agent && tools.has(name) ? {} : undefined },
    },
  })
  for (const [depth, expected] of [
    [0, [...resources, 'mcp__inspection__list_executable_inspections']],
    [1, [...resources, 'mcp__sec-ops__get_event_by_id']],
  ]) {
    let allowed
    const agent = { session: { header: { delegationDepth: depth } }, ctx: { tools: { restrict({ allow }) { allowed = allow } } } }
    created({ agent })
    assert.deepEqual(allowed, expected)
  }
})

test('资源工具可调用，业务工具限制继续生效', () => {
  const guard = createSecurityOperationsGuard()
  for (const delegationDepth of [0, 1]) {
    const agent = { session: { header: { delegationDepth } } }
    for (const name of ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']) {
      assert.equal(guard.decide({ name, agent, arguments: { server: 'fixture', uri: 'fixture://data' } }), undefined)
    }
    assert.ok(guard.decide({ name: 'mcp__unknown__write', agent, arguments: {} }))
    assert.ok(guard.decide({ name: 'bash', agent, arguments: {} }))
  }
})
