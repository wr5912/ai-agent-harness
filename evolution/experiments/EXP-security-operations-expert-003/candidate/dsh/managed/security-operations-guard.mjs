/**
 * security-operations-expert 的 DSH 原生单调 Guard。
 *
 * 本插件只会拒绝调用或阻断不合格的响应规划结果，绝不授予权限。
 * MCP 服务端仍须独立强制执行身份、租户、对象、参数、幂等、审批和审计。
 */

import { createHash } from 'node:crypto'
import { isAbsolute, resolve, sep } from 'node:path'

export const name = 'security-operations-guard'
export const inject = ['tools']

const WORKSPACE_ROOT = '/work/harness/workspace'
export const TOOL_ROUTES = Object.freeze({
  workspace: Object.freeze([
    'read',
    'write',
    'edit',
    'glob',
    'grep',
    'skill',
  ]),
  policy: Object.freeze([
    'mcp__sec-ops__prepare_policy_configuration',
    'mcp__sec-ops__get_policy_configuration_status',
    'mcp__sec-ops__get_policy_configuration_result',
  ]),
  inspection: Object.freeze([
    'mcp__inspection__inspection_capabilities_list',
  ]),
  faultAnalysis: Object.freeze([
    'mcp__sec-ops__search_graph_assets',
    'mcp__sec-ops__get_graph_resolve_ip_host',
    'mcp__sec-ops__get_soc_asset_by_asset_id',
    'mcp__sec-ops__list_soc_asset',
    'mcp__sec-ops__get_soc_asset_biz_systems',
    'mcp__sec-ops__get_soc_asset_vulnerabilities',
    'mcp__sec-ops__get_ingest_devices_by_asset_by_asset_id',
    'mcp__sec-ops__get_graph_node_detail',
    'mcp__sec-ops__get_graph_path_query',
    'mcp__sec-ops__get_reachability_path_by_ip',
    'mcp__sec-ops__get_graph_flow_host_pair_ports',
    'mcp__sec-ops__get_reachability_cross_signal',
    'mcp__sec-ops__get_graph_compliance_violations',
    'mcp__sec-ops__get_graph_coverage',
    'mcp__sec-ops__get_event_by_id',
  ]),
  delegates: Object.freeze([
    'delegate_fault_analysis',
    'delegate_response_planning',
  ]),
  denied: Object.freeze([
    'mcp__sec-ops__select_policy_configuration_candidate',
    'mcp__sec-ops__decide_policy_configuration',
    'mcp__inspection__inspection_runs_start_with_plan',
    'mcp__inspection__inspection_runs_collect_evidence',
    'mcp__inspection__inspection_runs_finalize',
  ]),
})

const DELEGATE_TOOLS = new Set(TOOL_ROUTES.delegates)
const POLICY_TOOLS = new Set(TOOL_ROUTES.policy)
const INSPECTION_TOOLS = new Set(TOOL_ROUTES.inspection)
const FAULT_TOOLS = new Set(TOOL_ROUTES.faultAnalysis)
const WORKSPACE_TOOLS = new Set(TOOL_ROUTES.workspace.filter(tool => tool !== 'skill'))
const ROOT_VISIBLE_TOOLS = Object.freeze([
  ...TOOL_ROUTES.workspace,
  ...TOOL_ROUTES.policy,
  ...TOOL_ROUTES.inspection,
  ...TOOL_ROUTES.delegates,
])
const CHILD_VISIBLE_TOOLS = Object.freeze([...TOOL_ROUTES.faultAnalysis])
const NO_VISIBLE_TOOLS = Object.freeze([])
const PERMANENTLY_DENIED = new Set([
  'bash',
  'pwsh',
  'run_code',
  'web_search',
  'web_fetch',
  'subagent',
  'subagent_fork',
  'send_message',
  'interrupt_agent',
  'list_agents',
  ...TOOL_ROUTES.denied,
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function nonEmptyString(value, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function uniqueArray(value, maximum, validator) {
  if (!Array.isArray(value) || value.length > maximum || !value.every(validator)) return false
  return new Set(value.map(item => JSON.stringify(item))).size === value.length
}

function parameter(value) {
  return exactKeys(value, ['name', 'value']) && nonEmptyString(value.name, 128)
}

export function validateResponsePlanInput(value) {
  if (!exactKeys(value, [
    'schema_version', 'request_id', 'incident_summary', 'confirmed_evidence', 'constraints', 'requested_output',
  ])) return '响应规划输入的顶层字段不符合 response-plan-input/v1'
  if (value.schema_version !== 'response-plan-input/v1'
    || value.requested_output !== 'response-plan-output/v1'
    || !nonEmptyString(value.request_id, 128)
    || !nonEmptyString(value.incident_summary, 4000)) return '响应规划输入身份或摘要无效'
  if (!uniqueArray(value.confirmed_evidence, 256, item => isRecord(item)
    && Object.keys(item).every(key => ['evidence_ref', 'statement', 'source'].includes(key))
    && Object.prototype.hasOwnProperty.call(item, 'evidence_ref')
    && Object.prototype.hasOwnProperty.call(item, 'statement')
    && nonEmptyString(item.evidence_ref, 256)
    && nonEmptyString(item.statement, 2000)
    && (item.source === undefined || item.source === null || nonEmptyString(item.source, 512)))) {
    return '响应规划证据集合无效'
  }
  const constraints = value.constraints
  if (!exactKeys(constraints, [
    'mode', 'eligible_published_candidates', 'eligible_temporary_actions', 'success_criteria',
  ])) return '响应规划约束字段无效'
  if (!['published_semantic_selection', 'temporary_action_composition'].includes(constraints.mode)) {
    return '响应规划模式无效'
  }
  if (!uniqueArray(constraints.eligible_published_candidates, 256, item => exactKeys(item, ['playbook_id', 'summary'])
    && nonEmptyString(item.playbook_id, 256) && nonEmptyString(item.summary, 2000))) {
    return '已发布候选集合无效'
  }
  if (!uniqueArray(constraints.eligible_temporary_actions, 256, item => exactKeys(item, ['action_key', 'target', 'parameters'])
    && nonEmptyString(item.action_key, 256) && nonEmptyString(item.target, 512)
    && uniqueArray(item.parameters, 256, parameter))) return '临时动作候选集合无效'
  if (!uniqueArray(constraints.success_criteria, 256, item => nonEmptyString(item, 1000))) {
    return '成功标准集合无效'
  }
  return undefined
}

function validatePlanStep(step, input) {
  if (!exactKeys(step, ['action_key', 'target', 'parameters', 'reason'])
    || !nonEmptyString(step.action_key, 256)
    || !nonEmptyString(step.target, 512)
    || !nonEmptyString(step.reason, 500)
    || !uniqueArray(step.parameters, 256, parameter)) return false
  return input.constraints.eligible_temporary_actions.some(candidate =>
    candidate.action_key === step.action_key
    && candidate.target === step.target
    && JSON.stringify(candidate.parameters) === JSON.stringify(step.parameters))
}

export function validateResponsePlanOutput(value, input) {
  if (!exactKeys(value, ['schema_version', 'request_id', 'plan', 'assumptions', 'risks', 'evidence_refs'])) {
    return '响应规划输出的顶层字段不符合 response-plan-output/v1'
  }
  if (value.schema_version !== 'response-plan-output/v1' || value.request_id !== input.request_id) {
    return '响应规划输出身份未与冻结输入绑定'
  }
  if (!uniqueArray(value.assumptions, 256, item => nonEmptyString(item, 1000))
    || !uniqueArray(value.risks, 256, item => nonEmptyString(item, 1000))
    || !uniqueArray(value.evidence_refs, 256, item => nonEmptyString(item, 256))) {
    return '响应规划输出的假设、风险或证据引用无效'
  }
  const plan = value.plan
  if (!exactKeys(plan, ['resolution', 'decision_reason', 'selected_playbook_id', 'steps'])
    || !['published_reuse', 'temporary', 'needs_human_review'].includes(plan.resolution)
    || !nonEmptyString(plan.decision_reason, 500)
    || !Array.isArray(plan.steps)
    || plan.steps.length > 256) return '响应规划 plan 无效'
  if (plan.resolution === 'published_reuse') {
    if (!nonEmptyString(plan.selected_playbook_id, 256) || plan.steps.length !== 0) {
      return '复用已发布剧本时选择或步骤无效'
    }
    if (!input.constraints.eligible_published_candidates.some(candidate =>
      candidate.playbook_id === plan.selected_playbook_id)) return '输出选择了冻结集合之外的剧本'
  } else if (plan.resolution === 'temporary') {
    if (plan.selected_playbook_id !== null || plan.steps.length < 1
      || !plan.steps.every(step => validatePlanStep(step, input))) {
      return '临时响应计划包含冻结候选集合之外的动作'
    }
  } else if (plan.selected_playbook_id !== null || plan.steps.length !== 0) {
    return '人工复核输出不得携带剧本或动作'
  }
  return undefined
}

function textOutput(value) {
  if (!isRecord(value) || value.kind !== 'foreground' || !Array.isArray(value.output)) return undefined
  const blocks = value.output
  if (!blocks.every(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string')) return undefined
  return blocks.map(block => block.text).join('')
}

function delegationDepth(agent) {
  const value = agent?.session?.header?.delegationDepth
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function depthOf(exec) {
  return delegationDepth(exec?.agent)
}

export function visibleToolsForDepth(depth) {
  if (depth === 0) return ROOT_VISIBLE_TOOLS
  if (depth === 1) return CHILD_VISIBLE_TOOLS
  return NO_VISIBLE_TOOLS
}

function pathArguments(args) {
  if (!isRecord(args)) return []
  return ['file_path', 'path', 'directory', 'cwd']
    .map(key => args[key])
    .filter(value => typeof value === 'string')
}

function outsideWorkspace(value) {
  const target = resolve(WORKSPACE_ROOT, value)
  return target !== WORKSPACE_ROOT && !target.startsWith(WORKSPACE_ROOT + sep)
}

function sensitivePath(value) {
  const normalized = isAbsolute(value) ? resolve(value) : resolve(WORKSPACE_ROOT, value)
  return normalized === '/var/lib/dsh'
    || normalized.startsWith('/var/lib/dsh/')
    || normalized === '/opt/dsh-managed'
    || normalized.startsWith('/opt/dsh-managed/')
    || normalized === '/opt/dsh-presets'
    || normalized.startsWith('/opt/dsh-presets/')
    || /(?:^|[/\\])\.env(?:$|[/\\.])/.test(value)
}

function responseInput(exec, environment) {
  if (environment.DSH_SEC_OPS_RESPONSE_PLANNING_ENABLED !== 'true') {
    return { error: '响应规划受信 Gate 未开启，默认拒绝' }
  }
  if (!isRecord(exec.arguments) || typeof exec.arguments.prompt !== 'string') {
    return { error: '响应规划必须使用裸 JSON prompt' }
  }
  let input
  try {
    input = JSON.parse(exec.arguments.prompt)
  } catch {
    return { error: '响应规划 prompt 不是有效 JSON' }
  }
  const validation = validateResponsePlanInput(input)
  if (validation !== undefined) return { error: validation }
  const expected = environment.DSH_SEC_OPS_RESPONSE_INPUT_SHA256
  if (!/^[0-9a-f]{64}$/i.test(expected ?? '')) return { error: '响应规划缺少受信输入摘要' }
  const actual = createHash('sha256').update(exec.arguments.prompt, 'utf8').digest('hex')
  if (actual.toLowerCase() !== expected.toLowerCase()) return { error: '响应规划输入摘要与受信绑定不一致' }
  return { input }
}

export function createSecurityOperationsGuard(options = {}) {
  const environment = options.environment ?? process.env
  const mode = environment.DSH_HARNESS_MODE === 'authoring' ? 'authoring' : 'verification'
  const responseInputs = new WeakMap()

  const decide = (exec) => {
    const tool = exec?.name
    if (typeof tool !== 'string') return '缺少有效工具身份'
    if (PERMANENTLY_DENIED.has(tool)) return '该能力在 security-operations-expert 中永久禁用'
    const agent = exec.agent
    if (!isRecord(agent)) return '模型工具调用缺少 Agent 运行身份'
    const depth = depthOf(exec)
    if (depth > 0 && DELEGATE_TOOLS.has(tool)) return '子 Agent 不得再次委派'

    if (WORKSPACE_TOOLS.has(tool)) {
      const paths = pathArguments(exec.arguments)
      if (paths.some(sensitivePath)) return '不得访问 DSH 数据、凭据或 managed/preset 平面'
      if (paths.some(outsideWorkspace)) return '文件能力仅限当前 Candidate workspace'
      if (tool === 'write' || tool === 'edit') {
        if (mode !== 'authoring') return '验证或 Release 模式中的 Harness 为只读'
        if (paths.length === 0) return '写操作缺少可验证的 workspace 路径'
      }
      return undefined
    }

    if (tool === 'skill') return depth > 0 ? '角色子 Agent 不得加载额外 Skill 扩大能力' : undefined
    if (DELEGATE_TOOLS.has(tool)) {
      if (depth !== 0) return '子 Agent 不得再次委派'
      if (tool !== 'delegate_response_planning') return undefined
      const result = responseInput(exec, environment)
      if (result.error !== undefined) return result.error
      responseInputs.set(exec, result.input)
      return undefined
    }
    if (POLICY_TOOLS.has(tool)) {
      if (depth > 0) return '策略能力只允许主 Agent 按显式路由调用'
      return undefined
    }
    if (INSPECTION_TOOLS.has(tool)) {
      if (depth > 0) return '巡检能力目录只允许主 Agent 查询'
      return undefined
    }
    if (FAULT_TOOLS.has(tool)) return depth === 1 ? undefined : 'SOC 故障取证工具只能由故障分析子 Agent 调用'

    if (tool.startsWith('mcp__')) return '未列入当前角色授权集合的 MCP 工具被拒绝'
    return '未列入 security-operations-expert 显式工具集合的能力被拒绝'
  }

  const validateResponseResult = (exec, result) => {
    if (exec.name !== 'delegate_response_planning' || result.isError) return undefined
    const input = responseInputs.get(exec)
    responseInputs.delete(exec)
    if (input === undefined) return '响应规划结果缺少冻结输入绑定'
    const text = textOutput(result.value)
    if (text === undefined) return '响应规划必须以前台纯文本返回裸 JSON'
    let output
    try {
      output = JSON.parse(text)
    } catch {
      return '响应规划输出不是裸 JSON object'
    }
    return validateResponsePlanOutput(output, input)
  }

  return { decide, validateResponseResult, mode }
}

export function apply(ctx) {
  const guard = createSecurityOperationsGuard()
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: visibleToolsForDepth(delegationDepth(agent)) })
  })
  ctx.tools.guard((exec) => {
    const reason = guard.decide(exec)
    if (reason !== undefined) ctx.logger?.warn?.(`security guard denied tool=${exec.name} call=${String(exec.callId)} reason=${reason}`)
    return reason
  })
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const reason = guard.validateResponseResult(exec, result)
    if (reason === undefined) return next()
    return { kind: 'block', feedback: [{ type: 'text', text: reason }] }
  })
}
