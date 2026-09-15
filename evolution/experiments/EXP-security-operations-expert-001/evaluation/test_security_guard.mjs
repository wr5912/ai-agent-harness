import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  createSecurityOperationsGuard,
  validateResponsePlanInput,
  validateResponsePlanOutput,
} from '../candidate/dsh/managed/security-operations-guard.mjs'

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

test('角色 MCP 只能由委派子 Agent 调用；未知 MCP 和 Shell 永久拒绝', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  assert.match(guard.decide(execution('mcp__inspection__inspection_service__get_inspection_task', 0)), /巡检子 Agent/)
  assert.equal(guard.decide(execution('mcp__inspection__inspection_service__get_inspection_task', 1)), undefined)
  assert.match(guard.decide(execution('mcp__sec-ops__soc_api__execute', 0)), /永久禁用/)
  assert.match(guard.decide(execution('mcp__sec-ops__unknown__danger', 0)), /未列入/)
  assert.match(guard.decide(execution('bash', 0)), /永久禁用/)
  assert.match(guard.decide(execution('delegate_fault_analysis', 1)), /再次委派/)
})

test('故障分析同一运行单次启动、单次收口、最多三次状态查询', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  const owner = agent(1)
  const start = execution('mcp__sec-ops__fault_diagnosis__fault_analysis_start', 1, {}, owner)
  assert.equal(guard.decide(start), undefined)
  guard.observeResult(start, { isError: false })
  assert.match(guard.decide(execution(start.name, 1, {}, owner)), /只能创建一次/)
  const submit = execution('mcp__sec-ops__fault_diagnosis__fault_analysis_submit_tool_result', 1, {}, owner)
  assert.equal(guard.decide(submit), undefined)
  guard.observeResult(submit, { isError: false })
  const finalize = execution('mcp__sec-ops__fault_diagnosis__fault_analysis_finalize', 1, {}, owner)
  assert.equal(guard.decide(finalize), undefined)
  guard.observeResult(finalize, { isError: false })
  assert.match(guard.decide(execution(finalize.name, 1, {}, owner)), /只能收口一次/)
  for (let index = 0; index < 3; index += 1) {
    const status = execution('mcp__sec-ops__fault_diagnosis__fault_analysis_get_status', 1, {}, owner)
    assert.equal(guard.decide(status), undefined)
    guard.observeResult(status, { isError: false })
  }
  assert.match(guard.decide(execution('mcp__sec-ops__fault_diagnosis__fault_analysis_get_status', 1, {}, owner)), /三次/)
  assert.match(guard.decide(execution('mcp__sec-ops__fault_diagnosis__fault_analysis_get_trace', 1, {}, owner)), /永久禁用/)
})

test('策略只可 prepare/status，巡检 execute 默认拒绝并要求受信摘要绑定', () => {
  const guard = createSecurityOperationsGuard({ environment: {} })
  assert.equal(guard.decide(execution('mcp__sec-ops__ai_workbench_policy__prepare_policy_configuration')), undefined)
  assert.match(guard.decide(execution('mcp__sec-ops__ai_workbench_policy__execute_policy_configuration')), /未列入/)
  assert.match(guard.decide(execution('mcp__inspection__inspection_service__execute_inspection', 1, {})), /UUIDv4/)
  const key = 'f7b9b9bd-94fb-42eb-9266-b44e5c268e41'
  assert.match(guard.decide(execution('mcp__inspection__inspection_service__execute_inspection', 1, {
    idempotencyKey: key,
  })), /Gate/)
  const bound = createSecurityOperationsGuard({ environment: {
    DSH_SEC_OPS_INSPECTION_EXECUTION_ENABLED: 'true',
    DSH_SEC_OPS_INSPECTION_KEY_SHA256: createHash('sha256').update(key).digest('hex'),
  } })
  assert.equal(bound.decide(execution('mcp__inspection__inspection_service__execute_inspection', 1, {
    idempotencyKey: key,
  })), undefined)
  assert.match(bound.decide(execution('mcp__inspection__inspection_service__execute_inspection', 1, {
    idempotencyKey: 'a9d40d9a-381a-4943-a1a0-645ad86dcd4b',
  })), /未与受信 Runtime 绑定/)
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
