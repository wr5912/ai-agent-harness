import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  TOOL_ROUTES,
  apply,
  createSecurityOperationsGuard,
  validateResponsePlanInput,
  validateResponsePlanOutput,
  visibleToolsForDepth,
} from '../../evolution/experiments/EXP-security-operations-expert-003/candidate/dsh/managed/security-operations-guard.mjs'

function agent(depth = 0) {
  return { session: { header: { delegationDepth: depth } } }
}

function execution(name, depth = 0, args = {}, owner = agent(depth)) {
  return { name, arguments: args, agent: owner, callId: `call-${name}` }
}

function frozenResponseInput() {
  return {
    schema_version: 'response-plan-input/v1',
    request_id: 'trusted-request-1',
    incident_summary: '受信事件摘要',
    confirmed_evidence: [{ evidence_ref: 'event:1', statement: '事件已登记' }],
    constraints: {
      mode: 'published_semantic_selection',
      eligible_published_candidates: [{ playbook_id: 'published:1', summary: '已发布剧本' }],
      eligible_temporary_actions: [],
      success_criteria: ['受控确认'],
    },
    requested_output: 'response-plan-output/v1',
  }
}

function frozenResponseOutput() {
  return {
    schema_version: 'response-plan-output/v1',
    request_id: 'trusted-request-1',
    plan: {
      resolution: 'published_reuse',
      decision_reason: '已发布候选满足冻结约束',
      selected_playbook_id: 'published:1',
      steps: [],
    },
    assumptions: [],
    risks: [],
    evidence_refs: ['event:1'],
  }
}

test('Agent 创建时按委派深度收缩真实工具视图', () => {
  const expected = [
    [...TOOL_ROUTES.workspace, ...TOOL_ROUTES.policy, ...TOOL_ROUTES.inspection, ...TOOL_ROUTES.delegates],
    [...TOOL_ROUTES.faultAnalysis],
    [],
  ]
  assert.deepEqual([0, 1, 2].map(visibleToolsForDepth), expected)

  const handlers = new Map()
  const ctx = {
    tools: { guard() {} },
    on(name, handler) { handlers.set(name, handler) },
  }
  apply(ctx)
  const created = handlers.get('agent/created')
  assert.equal(typeof created, 'function')
  for (const [depth, allow] of expected.entries()) {
    const actual = []
    const owner = agent(depth)
    owner.ctx = { tools: { restrict(filter) { actual.push(filter) } } }
    created({ agent: owner })
    assert.deepEqual(actual, [{ allow }])
  }
})

test('默认验证模式拒绝写入，并阻断 workspace 逃逸和受控目录读取', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  assert.match(guard.decide(execution('write', 0, { file_path: 'AGENTS.md' })), /只读/)
  assert.match(guard.decide(execution('read', 0, { file_path: '../managed/control.yaml' })), /workspace/)
  assert.match(guard.decide(execution('read', 0, { file_path: '/var/lib/dsh/credentials.json' })), /不得访问/)
  assert.equal(guard.decide(execution('read', 0, { file_path: 'AGENTS.md' })), undefined)
})

test('authoring 仅允许工作区写入，且写操作必须有可验证路径', () => {
  const guard = createSecurityOperationsGuard({ environment: { DSH_HARNESS_MODE: 'authoring' } })
  assert.equal(guard.decide(execution('write', 0, { file_path: '.agents/skills/new/SKILL.md' })), undefined)
  assert.match(guard.decide(execution('edit', 0, {})), /路径/)
  assert.match(guard.decide(execution('write', 0, { file_path: '/opt/dsh-managed/guard.mjs' })), /不得访问/)
})

test('矩阵导出的 MCP 路由按父子深度精确执行', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  for (const tool of TOOL_ROUTES.policy) {
    assert.equal(guard.decide(execution(tool, 0)), undefined)
    assert.match(guard.decide(execution(tool, 1)), /主 Agent/)
  }
  for (const tool of TOOL_ROUTES.inspection) {
    assert.equal(guard.decide(execution(tool, 0)), undefined)
    assert.match(guard.decide(execution(tool, 1)), /主 Agent/)
  }
  for (const tool of TOOL_ROUTES.faultAnalysis) {
    assert.match(guard.decide(execution(tool, 0)), /故障分析子 Agent/)
    assert.equal(guard.decide(execution(tool, 1)), undefined)
  }
})

test('危险、未知、Shell 与二次委派调用始终拒绝', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  for (const tool of TOOL_ROUTES.denied) {
    assert.match(guard.decide(execution(tool, 0)), /永久禁用/)
    assert.match(guard.decide(execution(tool, 1)), /永久禁用/)
  }
  assert.match(guard.decide(execution('mcp__sec-ops__unknown_danger', 0)), /未列入/)
  assert.match(guard.decide(execution('bash', 0)), /永久禁用/)
  assert.match(guard.decide(execution('delegate_fault_analysis', 1)), /再次委派/)
  assert.match(guard.decide(execution('skill', 1)), /不得加载/)
  assert.equal(guard.decide(execution('delegate_fault_analysis', 0)), undefined)
})

test('响应规划默认拒绝；受信 Gate 与输入摘要须同时一致', () => {
  const input = frozenResponseInput()
  const prompt = JSON.stringify(input)
  const digest = createHash('sha256').update(prompt).digest('hex')
  const closed = createSecurityOperationsGuard({ environment: {} })
  assert.match(closed.decide(execution('delegate_response_planning', 0, { prompt })), /Gate/)
  const open = createSecurityOperationsGuard({ environment: {
    DSH_SEC_OPS_RESPONSE_PLANNING_ENABLED: 'true',
    DSH_SEC_OPS_RESPONSE_INPUT_SHA256: digest,
  } })
  assert.equal(open.decide(execution('delegate_response_planning', 0, { prompt })), undefined)
  assert.match(open.decide(execution('delegate_response_planning', 0, { prompt: prompt + ' ' })), /摘要/)
})

test('响应规划输出必须是裸 JSON 且只能选择冻结候选', () => {
  const input = frozenResponseInput()
  assert.equal(validateResponsePlanInput(input), undefined)
  const output = frozenResponseOutput()
  assert.equal(validateResponsePlanOutput(output, input), undefined)
  output.plan.selected_playbook_id = 'invented-playbook'
  assert.match(validateResponsePlanOutput(output, input), /冻结集合之外/)
  const extra = frozenResponseOutput()
  extra.unauthorized = true
  assert.match(validateResponsePlanOutput(extra, input), /顶层字段/)
})

test('post-execute 校验只接受纯文本 JSON，并把无效响应阻断为错误', () => {
  const input = frozenResponseInput()
  const prompt = JSON.stringify(input)
  const digest = createHash('sha256').update(prompt).digest('hex')
  const guard = createSecurityOperationsGuard({ environment: {
    DSH_SEC_OPS_RESPONSE_PLANNING_ENABLED: 'true',
    DSH_SEC_OPS_RESPONSE_INPUT_SHA256: digest,
  } })
  const exec = execution('delegate_response_planning', 0, { prompt })
  assert.equal(guard.decide(exec), undefined)
  const valid = { isError: false, value: {
    kind: 'foreground', output: [{ type: 'text', text: JSON.stringify(frozenResponseOutput()) }],
  } }
  assert.equal(guard.validateResponseResult(exec, valid), undefined)
  const second = execution('delegate_response_planning', 0, { prompt })
  assert.equal(guard.decide(second), undefined)
  assert.match(guard.validateResponseResult(second, {
    isError: false, value: { kind: 'foreground', output: [{ type: 'text', text: '```json\n{}\n```' }] },
  }), /裸 JSON/)
})

test('角色矩阵、Profile 与 Guard 的合同校验器通过', () => {
  const checker = fileURLToPath(new URL(
    '../../evolution/experiments/EXP-security-operations-expert-003/evaluation/tools/verify_mcp_contract.py',
    import.meta.url,
  ))
  for (const args of [[], ['--self-test']]) {
    const completed = spawnSync('python3', [checker, ...args], { encoding: 'utf8' })
    assert.equal(completed.status, 0, completed.stderr)
  }
})
