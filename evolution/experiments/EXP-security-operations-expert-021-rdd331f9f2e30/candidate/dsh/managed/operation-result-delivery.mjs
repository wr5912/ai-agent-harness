import { randomUUID } from 'node:crypto'
import { currentPolicyStatus, isPolicyStatusQuery } from './policy-selection-runtime.mjs'

export const name = 'operation-result-delivery'
export const inject = ['llm']

const DELIVERY_PROVIDER = 'security-operation-delivery'
export const CONTROLLED_OUTPUT_MARKER = '[security-operation-controlled-output/v1]'
const POLICY_PREFIX = 'mcp__policy-configuration__'
const EMERGENCY_PREFIX = 'mcp__emergency-action__'
const POLICY_PREFLIGHT_TOOLS = new Set([
  `${POLICY_PREFIX}resolve_policy_endpoints`,
  `${POLICY_PREFIX}choose_ambiguous_policy_endpoints`,
])
const POLICY_PREPARE = `${POLICY_PREFIX}prepare_policy_configuration`
const POLICY_STATUS = `${POLICY_PREFIX}get_policy_configuration_status`
const POLICY_RESULT = `${POLICY_PREFIX}get_policy_configuration_result`
const POLICY_SEQUENCE_RETRY = '策略准备前置校验：必须先调用 resolve_policy_endpoints'
const CONFIRMATION_SOURCES = new Set([
  'policy-confirmation-runtime',
  'policy-selection-runtime',
  'emergency-confirmation-runtime',
])
const queuedOutputs = new Map()
const modelContinuations = new Set()
const postDeliveryInteractions = new Map()
const originalRoutes = new Map()

/** 首轮固定交付前尚无原生请求头；只读复用同一模块捕获的实际路由。 */
export function getOriginalRoute(sessionId) {
  const route = originalRoutes.get(sessionId)
  return route ? { provider: route.provider, model: route.model } : undefined
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function compactText(value, maximum = 180) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

function line(label, value) {
  const text = compactText(value, 256)
  return text ? `${label}：${text}` : null
}

function operationLine(operationId) {
  return /^op_[a-f0-9]{32}$/.test(operationId ?? '') ? `操作号：${operationId}` : null
}

function joinLines(...values) {
  return values.flat().filter(Boolean).join('\n')
}

function toolText(message) {
  if (!Array.isArray(message?.content)) return null
  const block = message.content.find(item => item?.type === 'tool-result')
  const content = Array.isArray(block?.content) ? block.content : message.content
  const text = content.find(item => item?.type === 'text')?.text
  return typeof text === 'string' ? text : null
}

function toolResult(events, event) {
  const message = event?.data?.message
  const callId = message?.source?.callId ?? message?.toolCallId
  const call = events.findLast(item => item.type === 'tool/call' && item.data?.callId === callId)
  if (!call || typeof call.data?.name !== 'string') return null
  let args = {}
  try { args = JSON.parse(call.data.arguments ?? '{}') } catch { /* Invalid args are represented as no trusted operation id. */ }
  const rawText = toolText(message)
  let value = null
  try { value = JSON.parse(rawText) } catch { /* Transport and tool errors are often plain text. */ }
  return {
    name: call.data.name,
    args: record(args) ?? {},
    isError: message?.isError === true || message?.content?.some(item => item?.isError === true),
    rawText,
    value: record(value),
  }
}

function envelope(result) {
  if (!result?.value) return { data: null, code: null, message: null }
  if (Object.hasOwn(result.value, 'code')) {
    return {
      data: record(result.value.data),
      code: String(result.value.code),
      message: compactText(result.value.msg ?? result.value.message),
    }
  }
  return { data: result.value, code: '200', message: null }
}

function operationId(result, data) {
  return data?.operation_id ?? result.args?.operationId ?? null
}

function codeFailure(domain, code, operationIdValue) {
  const reasons = {
    '404': '未找到对应操作或当前账号无权读取。',
    '409': '操作状态已变化，当前请求无法继续。',
    '422': '请求参数或当前操作状态不符合要求。',
    '503': `${domain}服务暂时不可用。`,
  }
  return joinLines(
    '处理结果：未完成',
    `原因：${reasons[code] ?? `${domain}服务返回未识别错误。`}`,
    operationLine(operationIdValue),
  )
}

function toolFailure(domain, operationIdValue, rawText) {
  const timedOut = /\b(?:request\s+)?timed?\s*out\b|\btimeout\b/i.test(rawText ?? '')
  return joinLines(
    '处理结果：未完成',
    timedOut
      ? `原因：${domain}服务调用超时，未在等待时间内取得平台回执。`
      : `原因：未取得${domain}服务的有效回执。`,
    operationLine(operationIdValue),
    operationIdValue
      ? '下一步：请稍后只查询该操作，避免重复提交。'
      : '下一步：请稍后重试；当前没有可用于查账的操作号。',
  )
}

function authorityUnknown(operationIdValue) {
  return joinLines(
    '处理结果：无法确认',
    '原因：未获得完整的平台或安全运营系统权威事实。',
    operationLine(operationIdValue),
    operationIdValue ? '下一步：请稍后只查询该操作。' : '下一步：请核对服务状态后重试。',
  )
}

function sameEndpointProof(left, right) {
  const fields = [
    'source_query', 'destination_query', 'candidate_set_digest',
    'selected_source_candidate_id', 'selected_destination_candidate_id',
  ]
  return fields.every(field => typeof left?.[field] === 'string'
    && left[field] === right?.[field])
}

function samePreparedIntent(left, right) {
  return left?.operation === right?.operation
    && (left?.action ?? 'ALLOW') === (right?.action ?? 'ALLOW')
    && left?.source?.selector_type === right?.source?.selector_type
    && left?.source?.value === right?.source?.value
    && left?.destination?.selector_type === right?.destination?.selector_type
    && left?.destination?.value === right?.destination?.value
    && left?.protocol === right?.protocol
    && left?.destination_port === right?.destination_port
    && (left?.device_query ?? null) === (right?.device_query ?? null)
}

function currentDeviceUnderstanding(markdown, events, operationIdValue, verifiedStatus) {
  if (verifiedStatus === null) return markdown.replace(/^- \*\*指定执行设备\*\*：.*$/m, '- **指定执行设备**：当前生效设备约束需按最新状态核验')
  // 替代后的设备约束来自受信原生选择及同操作的当前冻结状态，而非最初 prepare_body。
  const statusEvent = events.findLast(event => event.type === 'tool/result'
    && toolResult(events, event)?.name === POLICY_STATUS
    && envelope(toolResult(events, event)).data?.operation_id === operationIdValue)
  const status = statusEvent ? toolResult(events, statusEvent) : null
  const cached = envelope(status)
  const data = verifiedStatus ?? cached.data
  if (verifiedStatus === undefined && (cached.code !== '200' || status?.args?.operationId !== operationIdValue)) return markdown
  const frozen = data?.candidate
  let hasReplacement = false
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'policy-selection-runtime') continue
    const text = event.data.content?.find(block => block.type === 'text')?.text ?? ''
    if (!text.startsWith('[policy-device-selection/v1]\n')) continue
    let selected
    try { selected = JSON.parse(text.split('\n')[1]) } catch { continue }
    if (selected.operation_id !== operationIdValue) continue
    hasReplacement = true
    if (!Number.isInteger(selected.business_revision) || !Number.isInteger(frozen?.business_revision) ||
        selected.business_revision > frozen?.business_revision ||
        selected.intent_digest !== frozen?.intent_digest || typeof selected.label !== 'string' || !selected.label.trim()) continue
    const device = selected.label.replace(/[，,]\s*资产\s*\d+/g, '').trim()
    const line = `- **指定执行设备**：${device}（已明确选择替代设备）`
    return /^- \*\*指定执行设备\*\*：.*$/m.test(markdown)
      ? markdown.replace(/^- \*\*指定执行设备\*\*：.*$/m, line)
      : `${markdown}\n${line}`
  }
  return hasReplacement ? markdown.replace(/^- \*\*指定执行设备\*\*：.*$/m, '- **指定执行设备**：当前生效设备约束需按最新状态核验') : markdown
}

/** Return only the resolver markdown that is transitively bound to this operation. */
export function policyUnderstandingMarkdown(events, operationIdValue, verifiedStatus) {
  if (typeof operationIdValue !== 'string' || !operationIdValue) return undefined
  let prepare
  let prepareIndex = -1
  for (let index = events.length - 1; index >= 0; index--) {
    if (events[index]?.type !== 'tool/result') continue
    const result = toolResult(events, events[index])
    if (result?.name !== POLICY_PREPARE) continue
    const { data, code } = envelope(result)
    if (code === '200' && data?.operation_id === operationIdValue) {
      prepare = result
      prepareIndex = index
      break
    }
  }
  const prepareBody = record(prepare?.args?.body)
  const prepareProof = record(prepareBody?.endpoint_resolution)
  const prepareIntent = record(prepareBody?.intent)
  if (!prepareBody || !prepareProof || !prepareIntent
      || typeof prepareBody.request_id !== 'string') return undefined

  for (let index = prepareIndex - 1; index >= 0; index--) {
    const event = events[index]
    // 原生选择通过可信 HTTP 接续；本会话受信来源保存原始权威解析投影。
    if (event?.type === 'user/message' && event.data?.source?.kind === 'policy-selection-runtime') {
      const text = event.data.content?.find(block => block.type === 'text')?.text ?? ''
      if (text.startsWith('[policy-endpoint-resolution/v1]\n')) {
        let data
        try { data = JSON.parse(text.split('\n')[1]) } catch { continue }
        if (data?.resolution_status === 'RESOLVED' && data.request_id === prepareBody.request_id &&
            data.prepare_body?.request_id === prepareBody.request_id &&
            data.candidate_set_digest === prepareProof.candidate_set_digest &&
            sameEndpointProof(data.prepare_body?.endpoint_resolution, prepareProof) &&
            samePreparedIntent(data.prepare_body?.intent, prepareIntent) &&
            typeof data.result_markdown === 'string' && data.result_markdown.trim().startsWith('### 需求理解')) {
          return currentDeviceUnderstanding(data.result_markdown.trim(), events, operationIdValue, verifiedStatus)
        }
      }
    }
    if (event?.type !== 'tool/result') continue
    const result = toolResult(events, events[index])
    if (!POLICY_PREFLIGHT_TOOLS.has(result?.name)) continue
    const { data, code } = envelope(result)
    const resolvedBody = record(data?.prepare_body)
    const resolvedProof = record(resolvedBody?.endpoint_resolution)
    const resolvedIntent = record(resolvedBody?.intent)
    const markdown = data?.result_markdown
    if (code === '200' && data?.resolution_status === 'RESOLVED'
        && data.request_id === prepareBody.request_id
        && resolvedBody?.request_id === prepareBody.request_id
        && data.candidate_set_digest === prepareProof.candidate_set_digest
        && sameEndpointProof(resolvedProof, prepareProof)
        && samePreparedIntent(resolvedIntent, prepareIntent)
        && typeof markdown === 'string' && markdown.trim().startsWith('### 需求理解')) {
      return currentDeviceUnderstanding(markdown.trim(), events, operationIdValue, verifiedStatus)
    }
  }
  return undefined
}

function containsPrivatePolicyDetail(markdown) {
  return /配置预览|renderedCommands|bodyJson|\/api\/firewall\/|```\s*json/i.test(markdown)
}

function containsMachinePolicyStatus(markdown) {
  return /ADD permit|EXECUTION_IN_PROGRESS|\bDRAFT\b|\bSUCCESS\b|\bFAILED\b|\bCANCELLED\b/i.test(markdown)
}

function safePolicyDraft(data, operationIdValue) {
  return joinLines(
    '策略草稿已生成',
    Number.isInteger(data?.task_id) ? `任务编号：${data.task_id}` : null,
    '当前状态：草稿，尚未提交、审批或执行',
    operationLine(operationIdValue),
    '内部配置内容已从用户视图隐藏。',
  )
}

function safePolicyResult(data, operationIdValue) {
  const labels = {
    SUCCESS: '成功',
    SUCCEEDED: '成功',
    FAILED: '失败',
    CANCELLED: '已取消',
    CANCELED: '已取消',
    EXECUTION_IN_PROGRESS: '执行中',
    RUNNING: '执行中',
  }
  const machineStatus = [
    data?.result_code,
    data?.task_status,
    data?.operation_status,
    data?.stage_status,
  ].filter(value => typeof value === 'string').map(value => value.toUpperCase())
    .find(value => Object.hasOwn(labels, value))
  const status = labels[machineStatus] ?? '待核实'
  return joinLines(
    `执行结果：${status}`,
    Number.isInteger(data?.task_id) ? `任务编号：${data.task_id}` : null,
    operationLine(operationIdValue),
  )
}

function publicPolicyMarkdown(markdown, data, operationIdValue, draft = false) {
  if (containsPrivatePolicyDetail(markdown) || containsMachinePolicyStatus(markdown)) {
    return draft
      ? safePolicyDraft(data, operationIdValue)
      : safePolicyResult(data, operationIdValue)
  }
  return markdown.trim()
}

function policyDelivery(result, events, verifiedStatus) {
  const { data, code } = envelope(result)
  const op = operationId(result, data)
  // Endpoint resolution is read-only and may legitimately require a corrected
  // first call or a user choice. Keep such feedback in the model loop instead
  // of converting it into a terminal fixed-operation message.
  if (POLICY_PREFLIGHT_TOOLS.has(result.name)
      && (result.isError || !result.value || code !== '200')) return undefined
  if (result.name === POLICY_PREPARE && result.isError
      && result.rawText?.includes(POLICY_SEQUENCE_RETRY)) return undefined
  if (result.isError || !result.value) return toolFailure('策略', op, result.rawText)
  if (code !== '200' || !data) return codeFailure('策略', code, op)

  // result 是统一的用户结果合同：正文与当前操作必须同时有效，不按业务结果码枚举截断新结论。
  if (result.name === POLICY_RESULT) {
    if (!/^op_[a-f0-9]{32}$/.test(op ?? '') || result.args?.operationId !== data.operation_id ||
        typeof data.result_code !== 'string' || !data.result_code || typeof data.result_markdown !== 'string' ||
        !/[\u3400-\u9fff]/.test(data.result_markdown)) return authorityUnknown(result.args?.operationId)
    const draft = data.result_code === 'DRAFT_READY' && data.task_status === 'DRAFT'
    const markdown = publicPolicyMarkdown(data.result_markdown, data, op, draft)
    const understanding = (draft || data.result_code.startsWith('POLICY_')) ? policyUnderstandingMarkdown(events, op, verifiedStatus) : undefined
    return understanding && !markdown.startsWith('### 需求理解')
      ? `${understanding}\n\n---\n\n${markdown}` : markdown
  }
  // 状态回执不是用户结果正文；普通待确认态须保留真实 RESULT 工具触发原生确认的链路。
  if (result.name === POLICY_STATUS) return result.args?.operationId === data.operation_id
    ? undefined : authorityUnknown(result.args?.operationId)

  const coverageCodes = ['POLICY_ALREADY_COVERED', 'POLICY_PARTIALLY_COVERED', 'POLICY_BLOCKED', 'POLICY_COVERAGE_UNKNOWN']
  if (result.name === POLICY_PREPARE
      && (coverageCodes.includes(data.result_code ?? data.outcome_code) || data.stage_code === 'terminal')) return undefined

  const authoritativeMarkdown = data.result_markdown ?? data.error?.result_markdown
  if (typeof authoritativeMarkdown === 'string' && authoritativeMarkdown.trim()) {
    const isTerminal = ['failed', 'cancelled'].includes(data.operation_status)
      || ['failed', 'cancelled'].includes(data.stage_status)
      || data.stage_code === 'terminal'
    if (isTerminal) return publicPolicyMarkdown(authoritativeMarkdown, data, op)
  }

  if (['failed', 'cancelled'].includes(data.operation_status)
      || ['failed', 'cancelled'].includes(data.stage_status)
      || data.stage_code === 'terminal') {
    return joinLines(
      `处理结果：${data.operation_status === 'cancelled' ? '已取消' : '未完成'}`,
      line('原因', data.error?.summary ?? data.error?.message ?? data.outcome_message),
      operationLine(op),
      data.error?.manual_review_required === true ? '下一步：需要人工复核。' : null,
    )
  }

  if (data.operation_status === 'WAITING_EXTERNAL' || data.stage_code === 'waiting_external') {
    return joinLines('当前进度：等待外部系统', operationLine(op), '下一步：请稍后只查询该操作，避免重复提交。')
  }

  const intermediate = ['created', 'running'].includes(data.operation_status)
    || data.selection?.status === 'PENDING'
    || data.stage_code === 'awaiting_candidate_selection'
    || data.result_code === 'DRAFT_READY'
  if (intermediate) return undefined

  return undefined
}

export function formatEmergencyStatus(state, view) {
  if (!view || (!state?.phase && view.phase === 'READY')) {
    return state?.message ?? joinLines('执行结果：待核实', '原因：未取得平台或安全运营系统权威执行结果。')
  }
  const socStatus = view.soc_observation?.evidence?.status
  let result
  if (socStatus === 'SUCCESS') result = '执行结果：成功'
  else if (socStatus === 'FAILED' || socStatus === 'BLOCKED') result = '执行结果：失败'
  else if (socStatus === 'REJECTED') result = '执行结果：审批已拒绝，未执行'
  else if (socStatus === 'RUNNING') result = '当前进度：执行中'
  else if (socStatus === 'AWAITING_APPROVAL') result = '当前进度：待审批'
  else if (view.execution_status === 'SUCCEEDED') result = '执行结果：成功'
  else if (view.execution_status === 'FAILED') result = '执行结果：失败'
  else if (view.approval_status === 'REJECTED') result = '执行结果：审批已拒绝，未执行'
  else if (view.execution_status === 'RUNNING') result = '当前进度：执行中'
  else if (view.approval_status === 'PENDING') result = '当前进度：待审批'
  else if (view.phase === 'SUBMISSION_UNKNOWN') result = '当前进度：提交结果待核实'
  else result = '当前进度：处理中'
  const ids = [operationLine(view.operation_id)]
  if (compactText(view.soc_execution_id, 128)) {
    ids.push(`安全运营系统执行号：${compactText(view.soc_execution_id, 128)}`)
  }
  return joinLines(result, ids)
}

function snapshotValue(snapshot, keys) {
  for (const key of keys) {
    const value = compactText(snapshot?.[key], 160)
    if (value) return value
  }
  return null
}

function emergencySnapshot(data) {
  const envelope = record(data?.snapshot) ?? {}
  return record(envelope.content) ?? envelope
}

/** Fail closed when Platform freezes the opposite of the user's block/unblock intent. */
export function emergencyDraftConflict(data) {
  const snapshot = emergencySnapshot(data)
  const intent = snapshotValue(snapshot, ['intent'])?.toLowerCase() ?? ''
  const actionKey = snapshotValue(snapshot, ['action_key', 'action'])?.toLowerCase() ?? ''
  if (!intent || !actionKey) return null
  const wantsUnblock = /解除.{0,80}封禁|取消.{0,80}封禁|解封|unblock|remove.{0,40}block/i.test(intent)
  const wantsBlock = !wantsUnblock && /封禁|阻断|拉黑|\bblock\b/i.test(intent)
  const isUnblock = actionKey.includes('unblock')
  const isBlock = actionKey.includes('block') && !isUnblock
  if (wantsUnblock && !isUnblock) return `用户意图是解除封禁，但冻结动作是 ${actionKey}`
  if (wantsBlock && !isBlock) return `用户意图是封禁，但冻结动作是 ${actionKey}`
  const params = record(snapshot.params) ?? {}
  if (snapshotValue(params, ['port']) && /^host-(?:un)?block-ip$/.test(actionKey)) {
    return `用户指定了端口，但冻结动作 ${actionKey} 不包含端口`
  }
  return null
}

export function emergencyDraftMarkdown(data, nativeQuestion = false) {
  const op = data?.operation_id
  const snapshot = emergencySnapshot(data)
  const actionKey = snapshotValue(snapshot, ['action_key', 'action'])
  const actionNames = {
    'host-block-ip': '封禁源 IP',
    'host-block-ip-port': '封禁源 IP 的指定端口',
    'host-unblock-ip': '解除源 IP 封禁',
    'host-unblock-ip-port': '解除源 IP 的指定端口封禁',
  }
  const action = snapshotValue(snapshot, ['action_name']) ?? actionNames[actionKey] ?? actionKey
  const targetLabel = snapshotValue(snapshot, ['target_name', 'target_label', 'asset_name'])
  const targetHint = snapshotValue(snapshot, ['target_hint', 'target'])
  const target = targetLabel && targetHint && targetLabel !== targetHint
    ? `${targetLabel}（${targetHint}）`
    : targetLabel ?? targetHint
  const params = record(snapshot.params) ?? {}
  const parameters = [
    snapshotValue(params, ['src_ip']) ? `源 IP \`${snapshotValue(params, ['src_ip'])}\`` : null,
    snapshotValue(params, ['port']) ? `端口 \`${snapshotValue(params, ['port'])}\`` : null,
    snapshotValue(params, ['user']) ? `用户 \`${snapshotValue(params, ['user'])}\`` : null,
  ].filter(Boolean).join('；')
  const execution = [
    line('- **用户意图**', snapshot.intent),
    line('- **动作**', action),
    line('- **目标**', target),
    line('- **参数**', parameters),
  ].filter(Boolean).join('\n')
  const impact = [
    line('- **影响**', snapshot.impact),
    line('- **恢复方式**', snapshot.recovery),
  ].filter(Boolean).join('\n')
  const tracking = operationLine(op)?.replace(/^操作号：/, '- **操作号**：`').concat('`')
  return [
    '### 应急指令草案',
    '**状态**：已生成，尚未执行',
    execution ? `#### 执行内容\n${execution}` : null,
    impact ? `#### 影响与恢复\n${impact}` : null,
    tracking ? `#### 操作信息\n${tracking}` : null,
    nativeQuestion
      ? '> 请在下方选择“确认执行”或“取消执行”，也可以输入更多内容。'
      : '> 请在下方选择操作；若选项不可用，仍可在当前会话单独回复“确认执行”。',
  ].filter(Boolean).join('\n\n')
}

function emergencyDelivery(result) {
  const { data, code } = envelope(result)
  const op = operationId(result, data)
  if (result.isError || !result.value) return toolFailure('应急', op, result.rawText)
  if (code !== '200' || !data) return codeFailure('应急', code, op)

  const next = String(data.required_next_action ?? '').toUpperCase()
  if (next === 'CLARIFY' || next === 'SELECT_TARGET') {
    return joinLines(
      '处理结果：需要补充信息',
      line('需要补充', data.clarification_question ?? data.message ?? data.reason),
      operationLine(op),
    )
  }
  if (next === 'UNAVAILABLE' || data.phase === 'UNAVAILABLE') {
    return joinLines(
      '处理结果：未完成',
      line('原因', data.message ?? data.reason ?? data.error?.summary)
        ?? '原因：当前环境不具备该应急动作所需能力。',
      operationLine(op),
    )
  }

  if (data.phase === 'READY' && data.execution_status === 'NOT_SUBMITTED') {
    const conflict = emergencyDraftConflict(data)
    if (conflict) return joinLines(
      '处理结果：未完成',
      `原因：${conflict}，已拒绝进入确认。`,
      operationLine(op),
      '下一步：请重新生成与用户意图一致的应急指令草案。',
    )
    return emergencyDraftMarkdown(data)
  }
  if (['QUEUED', 'SUBMISSION_UNKNOWN', 'ACCEPTED', 'WAIT', 'TERMINAL'].includes(data.phase)) {
    return formatEmergencyStatus(null, data)
  }
  if (['CANCELLED', 'CANCELED'].includes(data.phase)
      || ['cancelled', 'canceled'].includes(data.operation_status)) {
    return joinLines('处理结果：已取消', operationLine(op))
  }
  if (['FAILED', 'REJECTED', 'BLOCKED'].includes(data.phase)
      || ['failed', 'rejected'].includes(data.operation_status)) {
    return joinLines(
      '处理结果：未完成',
      line('原因', data.message ?? data.reason ?? data.error?.summary),
      operationLine(op),
    )
  }
  if (['CREATED', 'RUNNING', 'RESOLVING'].includes(data.phase)) return undefined
  if (result.name === `${EMERGENCY_PREFIX}get_emergency_action`
      || result.name === `${EMERGENCY_PREFIX}get_emergency_action_result`) return authorityUnknown(op)
  return undefined
}

function controlledContext(event) {
  const message = event?.data
  if (event?.type !== 'user/message' || !CONFIRMATION_SOURCES.has(message?.source?.kind)) return undefined
  const text = message.content?.filter(item => item.type === 'text').map(item => item.text).join('') ?? ''
  if (!text.startsWith(CONTROLLED_OUTPUT_MARKER)) return undefined
  const markdown = text.slice(CONTROLLED_OUTPUT_MARKER.length).replace(/^\s+/, '')
  return markdown || undefined
}

export function controlledOutput(markdown) {
  return `${CONTROLLED_OUTPUT_MARKER}\n${markdown}`
}

export function queueControlledOutput(agentId, markdown) {
  if (typeof agentId !== 'string' || !agentId || typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('invalid controlled operation output')
  }
  queuedOutputs.set(agentId, markdown)
}

/** Let one operation-result turn continue through the configured model route. */
export function continueWithModel(agentId) {
  if (typeof agentId !== 'string' || !agentId) throw new Error('invalid model continuation agent')
  modelContinuations.add(agentId)
}

/**
 * Run a trusted UI interaction after the fixed draft has reached the middle
 * transcript, while the same assistant stream is still live. This is the
 * native DSH boundary where the composer can be taken over without moving the
 * draft itself into the question panel.
 */
export function queuePostDeliveryInteraction(agentId, interaction) {
  if (typeof agentId !== 'string' || !agentId || typeof interaction !== 'function') {
    throw new Error('invalid post-delivery interaction')
  }
  postDeliveryInteractions.set(agentId, interaction)
}

export async function runPostDeliveryInteraction(agentId, signal) {
  const interaction = postDeliveryInteractions.get(agentId)
  postDeliveryInteractions.delete(agentId)
  if (interaction) return interaction(signal)
  return undefined
}

export function deliveryMarkdown(events, turn) {
  const last = events.findLast(event => ['tool/result', 'assistant/message', 'user/message'].includes(event.type))
  const context = controlledContext(last)
  if (context) return context
  if (last?.type !== 'tool/result' || last.data?.turn !== turn) return undefined
  const result = toolResult(events, last)
  if (!result) return undefined
  if (result.name === `${POLICY_PREFIX}get_policy_configuration_result`) {
    const batch = new Map()
    for (const event of events) {
      if (event.type !== 'tool/result' || event.data?.turn !== turn || event.data?.step !== last.data?.step) continue
      const item = toolResult(events, event)
      if (item?.name !== `${POLICY_PREFIX}get_policy_configuration_result`) continue
      const { data } = envelope(item)
      const op = operationId(item, data)
      if (!/^op_[a-f0-9]{32}$/.test(op ?? '') || item.args?.operationId !== op) continue
      const markdown = policyDelivery(item, events)
      if (typeof markdown === 'string') batch.set(op, markdown)
    }
    if (batch.size > 1) return [...batch].map(([op, markdown], index) =>
      `### 策略操作 ${index + 1}\n\n${operationLine(op)}\n\n${markdown}`).join('\n\n---\n\n')
  }
  if (result.name.startsWith(POLICY_PREFIX)) return policyDelivery(result, events)
  if (result.name.startsWith(EMERGENCY_PREFIX)) return emergencyDelivery(result)
  return undefined
}

function policyBatchMarkdown(batch) {
  if (batch.size === 1) return [...batch.values()][0]
  return [...batch].map(([op, markdown], index) =>
    `### 策略操作 ${index + 1}\n\n${operationLine(op)}\n\n${markdown}`).join('\n\n---\n\n')
}

/** 原生替代已核验新版本；真实 RESULT 可能直接接续，不能继续使用选择前的 STATUS。 */
async function verifiedPolicyDeviceStatus(result, events, signal, logger) {
  const { data, code } = envelope(result)
  const op = result.args?.operationId
  if (result.isError || code !== '200' || data?.operation_id !== op) return undefined
  let selected
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event.type !== 'user/message' || event.data?.source?.kind !== 'policy-selection-runtime') continue
    const text = event.data.content?.find(block => block.type === 'text')?.text ?? ''
    if (!text.startsWith('[policy-device-selection/v1]\n')) continue
    let marker
    try { marker = JSON.parse(text.split('\n')[1]) } catch { continue }
    if (marker?.operation_id !== op) continue
    selected = marker
    break
  }
  if (!selected) return undefined
  if (!Number.isInteger(data.version) || data.version < 1 ||
      !Number.isInteger(selected.business_revision) || selected.business_revision < 1 ||
      selected.business_revision > data.version || !/^sha256:[a-f0-9]{64}$/.test(selected.intent_digest ?? '') ||
      typeof selected.label !== 'string' || !selected.label.trim()) return null
  const statusEvent = events.findLast(event => event.type === 'tool/result'
    && toolResult(events, event)?.name === POLICY_STATUS
    && toolResult(events, event)?.args?.operationId === op
    && envelope(toolResult(events, event)).data?.operation_id === op)
  const cached = envelope(statusEvent ? toolResult(events, statusEvent) : null)
  if (cached.code === '200' && cached.data?.candidate?.business_revision === data.version) return undefined
  try {
    const current = await currentPolicyStatus(op, signal)
    const valid = current?.operation_id === op && current.candidate?.business_revision === data.version
      && current.candidate?.intent_digest === selected.intent_digest
    logger?.info?.(`policy device status read operation=${op} version=${String(current?.candidate?.business_revision ?? '')} verified=${valid}`)
    return valid ? current : null
  } catch (error) {
    if (signal?.aborted) throw error
    logger?.warn?.(`policy device status read failed operation=${op}`)
    return null
  }
}

/** 状态工具给状态及记录引用；在同一步真实读取各操作的结果合同后固定交付。 */
async function latestPolicyResults(events, turn, signal, logger, query) {
  const last = events.findLast(event => ['tool/result', 'assistant/message', 'user/message'].includes(event.type))
  if (last?.type !== 'tool/result' || last.data?.turn !== turn) return undefined
  if (![POLICY_STATUS, POLICY_RESULT].includes(toolResult(events, last)?.name)) return undefined
  const getters = new Map()
  for (const event of events) {
    if (event.type !== 'tool/result' || event.data?.turn !== turn || event.data?.step !== last.data?.step) continue
    const result = toolResult(events, event)
    if (![POLICY_STATUS, POLICY_RESULT].includes(result?.name) || !/^op_[a-f0-9]{32}$/.test(result.args?.operationId ?? '')) continue
    getters.set(result.args.operationId, result)
  }
  if (!getters.size) return undefined
  if (!query && [...getters.values()].some(result => {
    const { data, code } = envelope(result)
    return result.name === POLICY_STATUS && !result.isError && code === '200' && data?.operation_id === result.args.operationId
      && data.stage_code !== 'terminal' && !['completed', 'failed', 'cancelled'].includes(data.operation_status)
  })) return undefined
  const batch = new Map(await Promise.all([...getters].map(async ([op, result]) => {
    if (result.name === POLICY_RESULT) {
      const verifiedStatus = await verifiedPolicyDeviceStatus(result, events, signal, logger)
      return [op, policyDelivery(result, events, verifiedStatus) ?? authorityUnknown(op)]
    }
    const { data, code } = envelope(result)
    if (result.isError || code !== '200' || !data) return [op, policyDelivery(result, events) ?? authorityUnknown(op)]
    if (data.operation_id !== op) return [op, authorityUnknown(op)]
    const base = process.env.AI_PLATFORM_URL
    if (!base) return [op, authorityUnknown(op)]
    try {
      signal?.throwIfAborted()
      const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/policy-configurations/${op}/result`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      })
      const value = await response.json().catch(() => null)
      logger?.info?.(`policy result read operation=${op} http=${response.status} code=${String(value?.code ?? '')} result=${String(value?.data?.result_code ?? '')}`)
      if (!response.ok) return [op, codeFailure('策略', String(response.status), op)]
      const actualResult = { name: POLICY_RESULT, args: { operationId: op }, value: record(value), isError: false, rawText: null }
      const verifiedStatus = await verifiedPolicyDeviceStatus(actualResult, events, signal, logger)
      return [op, policyDelivery(actualResult, events, verifiedStatus) ?? authorityUnknown(op)]
    } catch (error) {
      if (signal?.aborted) throw error
      logger?.warn?.(`policy result read failed operation=${op}: ${error?.message ?? String(error)}`)
      return [op, toolFailure('策略', op, error?.message)]
    }
  })))
  return policyBatchMarkdown(batch)
}

function modelRoute(config, events, captured) {
  if (config.provider !== DELIVERY_PROVIDER) return config
  const original = captured ?? events.findLast(event => event.type === 'request/header'
    && event.data.header.config.provider !== DELIVERY_PROVIDER)?.data.header.config
  if (!original) throw new Error('missing original operation-result model route')
  return original
}

export function apply(ctx) {
  const pending = new Map()
  ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
    const config = await next()
    // 首轮原生动作澄清会先交付 fixed，再产生首个模型调用；此时尚无原始 request/header。
    if (config.provider !== DELIVERY_PROVIDER) originalRoutes.set(agent.id, config)
    const events = agent.session.snapshotEvents()
    if (modelContinuations.delete(agent.id)) {
      pending.delete(agent.id)
      queuedOutputs.delete(agent.id)
      return modelRoute(config, events, originalRoutes.get(agent.id))
    }
    const queued = queuedOutputs.get(agent.id)
    queuedOutputs.delete(agent.id)
    const markdown = queued ?? await latestPolicyResults(events, turn, signal, ctx.logger, isPolicyStatusQuery(agent.id)) ?? deliveryMarkdown(events, turn)
    if (typeof markdown === 'string') {
      pending.set(agent.id, markdown)
      return { provider: DELIVERY_PROVIDER, model: 'fixed-operation-result' }
    }
    pending.delete(agent.id)
    return modelRoute(config, events, originalRoutes.get(agent.id))
  })
  ctx.llm.registerAdapter([DELIVERY_PROVIDER], {
    providerInfo: provider => ({ id: provider, name: '安全操作结果（本地固定输出）' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async () => [],
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    async prepareCall(provider, model, signal) {
      return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }
    },
    async *stream(request) {
      const initialText = pending.get(request.sessionId)
      if (typeof initialText !== 'string') throw new Error('missing controlled operation result')
      pending.delete(request.sessionId)
      request.signal?.throwIfAborted()
      let text = initialText
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      try {
        const appended = await runPostDeliveryInteraction(request.sessionId, request.signal)
        if (typeof appended === 'string' && appended.trim()) {
          const delta = `\n\n---\n\n${appended.trim()}`
          text += delta
          yield { type: 'text-delta', index: 0, text: delta }
        }
      } catch (error) {
        ctx.logger?.warn?.(`post-delivery interaction failed: ${error?.message ?? String(error)}`)
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  ctx.on('agent/disposed', ({ agent }) => {
    pending.delete(agent.id)
    originalRoutes.delete(agent.id)
    queuedOutputs.delete(agent.id)
    modelContinuations.delete(agent.id)
    postDeliveryInteractions.delete(agent.id)
  })
}

export function controlledContextMessage(source, markdown) {
  return {
    id: randomUUID(), role: 'user', source: { kind: source, form: 'result' },
    content: [{ type: 'text', text: controlledOutput(markdown) }],
  }
}
