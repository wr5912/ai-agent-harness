import { resolve, sep } from 'node:path'

export const name = 'policy-configuration-guard'
export const inject = ['tools']

const WORKSPACE = '/work/harness/workspace'
export const TOOL_ROUTES = Object.freeze({
  workspace: Object.freeze(['read', 'glob', 'grep', 'skill']),
  policy: Object.freeze([
    'mcp__policy-configuration__resolve_policy_endpoints',
    'mcp__policy-configuration__choose_ambiguous_policy_endpoints',
    'mcp__policy-configuration__prepare_policy_configuration',
    'mcp__policy-configuration__get_policy_configuration_status',
    'mcp__policy-configuration__select_policy_configuration_candidate',
    'mcp__policy-configuration__get_policy_configuration_result',
  ]),
  inspection: Object.freeze([]),
  faultAnalysis: Object.freeze([]),
  delegates: Object.freeze([]),
  denied: Object.freeze([
    'mcp__policy-configuration__confirm_policy_configuration',
    'mcp__policy-configuration__decide_policy_configuration',
    'mcp__sec-ops__prepare_policy_configuration',
    'mcp__sec-ops__select_policy_configuration_candidate',
    'mcp__sec-ops__decide_policy_configuration',
  ]),
})

const ALLOWED = Object.freeze([...TOOL_ROUTES.workspace, ...TOOL_ROUTES.policy])
const ALLOWED_SET = new Set(ALLOWED)
const DENIED_SET = new Set(TOOL_ROUTES.denied)
const confirmationTurns = new WeakSet()
const deviceConstraints = new WeakMap()
const actionConstraints = new WeakMap()
export function setPolicyAction(agent, action) {
  if (!['ALLOW', 'DENY'].includes(action)) throw new Error('invalid selected policy action')
  actionConstraints.set(agent, action)
}
const cancelledBindings = new WeakMap()
const activeRequests = new WeakMap()
export function cancelPolicyBinding(agent, binding) {
  const bindings = cancelledBindings.get(agent) ?? new Set()
  bindings.add(binding)
  cancelledBindings.set(agent, bindings)
}
export function setPolicyConfirmationTurn(agent, active) {
  if (active) confirmationTurns.add(agent)
  else confirmationTurns.delete(agent)
}
export function isPolicyConfirmationTurn(agent) {
  return confirmationTurns.has(agent)
}
export function deviceConstraintFromText(text) {
  if (typeof text !== 'string') return null
  const structured = text.match(/\bdevice_query\s*[=:：]\s*["'“‘]?([^\s,"'”’}]{1,80})/i)
  if (structured) return structured[1]
  const labeledOnDevice = text.match(/(?:请)?在\s*(?:防火墙|设备)\s+([^\s,，。；;]{1,80}?)\s*上(?:[，,\s]|放通|开通|新增|配置|$)/)
  if (labeledOnDevice) return labeledOnDevice[1]
  const deviceBeforeType = text.match(/(?:请)?在\s*([^\s,，。；;]{1,80}?)\s*(?:防火墙|设备)\s*上(?:[，,\s]|放通|开通|新增|配置|$)/)
  if (deviceBeforeType) return deviceBeforeType[1]
  const onDevice = text.match(/(?:请)?在\s*([^\s,，。；;]{1,80}?)\s*上(?:[，,\s]|放通|开通|新增|配置|$)/)
  if (onDevice) return onDevice[1]
  const named = text.match(/(?:指定|使用)(?:的)?(?:防火墙|设备)(?:名称|ID|管理IP)?\s*[:：]?\s*([^\s,，。；;]{1,80})/i)
  return named?.[1] ?? null
}
export function actionConstraintFromText(text) {
  if (typeof text !== 'string') return null
  const deny = /阻断|拒绝|禁止(?:访问)?|\bDENY\b/i.test(text)
  const allow = /放行|允许(?:访问)?|\bALLOW\b/i.test(text)
  if (deny && allow) return 'CONFLICT'
  if (deny) return 'DENY'
  return allow || /开通|放通/.test(text) ? 'ALLOW' : null
}
/** 先识别配置命令及其参数，再识别查询命令；资产名称不充当命令。 */
export function policyCommandKind(text) {
  if (typeof text !== 'string') return 'other'
  const command = text.trim().replace(/^(?:(?:我(?:想要|希望|需要|想|要)|想要|希望|需要|请|麻烦|帮我|帮忙|现在|再)\s*)+/, '')
  const slots = /(?:到|至|->|→)|source_query|destination_query/.test(text)
  if (/^(?:新增|添加|配置|开通|放通|允许|放行|阻断|禁止|拒绝|在\s*[^\n]{1,100}?(?:上|防火墙))/.test(command)
      && slots && /新增|添加|配置|开通|放通|允许|放行|阻断|禁止|拒绝/.test(command)) return 'configure'
  if (/^(?:将|把)?[^\n]{0,60}?(?:改为|改成|修改|调整)/.test(command)
      && /动作|端口|TCP|UDP|阻断|放行|允许|禁止|目的|源|设备|防火墙/i.test(command)) return 'revise'
  if (/^(?:查询|查一下|查看|核实|检查|刷新)/.test(command)
      || /^(?:本次|当前|刚才|上一个|前一个|这个|之前|那(?:个|些))?(?:策略|任务|操作|草稿)[\s\S]*(?:状态如何|进度如何|结果如何|完成了吗|成功了吗|执行了吗|怎么样)[？?。！!]*$/.test(command)) return 'query'
  if (/^(?:确认执行|执行|提交|批准)(?:当前|本次|这个|刚才|上一个|前一个)?(?:有效的|的)?(?:策略|任务|草稿)/.test(command)) return 'execute'
  return 'other'
}
export function isPolicyHistoryQuery(text) {
  return policyCommandKind(text) === 'query'
}
export function isNewPolicyRequest(text) {
  return ['configure', 'revise'].includes(policyCommandKind(text))
}
export function setPolicyUserRequest(agent, text) {
  const command = policyCommandKind(text)
  const isRequest = ['configure', 'revise'].includes(command)
  const device = deviceConstraintFromText(text)
  const action = actionConstraintFromText(text)
  // 冷恢复只从本会话成功工具事件恢复请求；历史查询与确切候选文字不作废它。
  if (!activeRequests.has(agent)) {
    const calls = new Map()
    for (const event of agent.session?.snapshotEvents?.() ?? []) {
      if (event.type === 'tool/call') calls.set(event.data?.callId, event.data)
      if (event.type !== 'tool/result' || event.data?.message?.isError === true ||
          event.data?.message?.content?.some(block => block.isError === true)) continue
      const call = calls.get(event.data?.message?.source?.callId)
      if (![RESOLVE_ENDPOINTS, SELECT_ENDPOINTS, PREPARE].includes(call?.name)) continue
      let args
      try { args = JSON.parse(call.arguments) } catch { continue }
      if (typeof args?.body?.request_id === 'string') {
        activeRequests.set(agent, args.body.request_id)
        const intent = args.body.intent ?? args.body
        if (['ALLOW', 'DENY'].includes(intent.action)) actionConstraints.set(agent, intent.action)
        deviceConstraints.set(agent, intent.device_query ?? null)
      }
    }
  }
  if (isPolicyHistoryQuery(text)) return
  if (isRequest) {
    const previous = activeRequests.get(agent)
    if (previous) cancelPolicyBinding(agent, previous)
    activeRequests.delete(agent)
  }
  if (isRequest && /(?:到|至|->|→)|source_query|destination_query/.test(text) || device) deviceConstraints.set(agent, device)
  if (command === 'configure' || action) actionConstraints.set(agent, action ?? 'UNSPECIFIED')
}
export function setPolicySelectedDevice(agent, device) {
  if (typeof device !== 'string' || !device.trim()) throw new Error('invalid selected policy device')
  deviceConstraints.set(agent, device)
}

const PREPARE = 'mcp__policy-configuration__prepare_policy_configuration'
const RESOLVE_ENDPOINTS = 'mcp__policy-configuration__resolve_policy_endpoints'
const SELECT_ENDPOINTS = 'mcp__policy-configuration__choose_ambiguous_policy_endpoints'
const SUPPORTED_INTENT_FIELDS = new Set([
  'schema_version', 'policy_kind', 'operation', 'action', 'source', 'destination',
  'protocol', 'destination_port', 'target_external_id', 'device_query', 'validity', 'change_reason',
])
const ENDPOINT_FIELDS = new Set([
  'contract_version', 'request_id', 'operation', 'action', 'source_query',
  'destination_query', 'protocol', 'destination_port', 'device_query',
])
const ENDPOINT_SELECTION_FIELDS = new Set([
  ...ENDPOINT_FIELDS, 'candidate_set_digest',
  'selected_source_candidate_id', 'selected_destination_candidate_id',
])
const ENDPOINT_PROOF_FIELDS = new Set([
  'source_query', 'destination_query', 'candidate_set_digest',
  'selected_source_candidate_id', 'selected_destination_candidate_id',
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value, maximum) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

function sha256Digest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/i.test(value)
}

function exactFields(value, allowed, required) {
  return isRecord(value)
    && Object.keys(value).every(field => allowed.has(field))
    && required.every(field => Object.hasOwn(value, field))
}

function validateEndpointRequest(body, selection = false) {
  const fields = selection ? ENDPOINT_SELECTION_FIELDS : ENDPOINT_FIELDS
  const required = [
    'contract_version', 'request_id', 'operation', 'source_query',
    'destination_query', 'protocol', 'destination_port',
  ]
  if (selection) {
    required.push('candidate_set_digest', 'selected_source_candidate_id',
      'selected_destination_candidate_id')
  }
  if (selection && (!isRecord(body) ||
      !sha256Digest(body.candidate_set_digest) ||
      !sha256Digest(body.selected_source_candidate_id) ||
      !sha256Digest(body.selected_destination_candidate_id))) {
    return '端点选择不能作为首步；必须先调用 resolve_policy_endpoints，只有解析返回 SELECTION_REQUIRED 才可携带冻结候选集摘要调用选择工具'
  }
  if (!exactFields(body, fields, required) ||
      body.contract_version !== 'workbench-policy-endpoint-resolution/v1' ||
      !nonEmptyString(body.request_id, 128) || body.operation !== 'ADD' ||
      (body.action !== undefined && !['ALLOW', 'DENY'].includes(body.action)) ||
      !nonEmptyString(body.source_query, 255) ||
      !nonEmptyString(body.destination_query, 255) ||
      !['TCP', 'UDP'].includes(body.protocol) ||
      !Number.isInteger(body.destination_port) ||
      body.destination_port < 1 || body.destination_port > 65535 ||
      (Object.hasOwn(body, 'device_query') && !nonEmptyString(body.device_query, 255))) {
    return '端点解析参数不完整或无效'
  }
  return undefined
}

function validEndpointProof(value) {
  return exactFields(value, ENDPOINT_PROOF_FIELDS, [...ENDPOINT_PROOF_FIELDS]) &&
    nonEmptyString(value.source_query, 255) &&
    nonEmptyString(value.destination_query, 255) &&
    sha256Digest(value.candidate_set_digest) &&
    sha256Digest(value.selected_source_candidate_id) &&
    sha256Digest(value.selected_destination_candidate_id)
}

function validIpv4Host(selector) {
  if (!selector || selector.selector_type !== 'IP' || typeof selector.value !== 'string') return false
  return validIpv4(selector.value)
}

function validIpv4(value) {
  const octets = value.split('.')
  return octets.length === 4 && octets.every(octet =>
    /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
}

function validIpv4Cidr(value) {
  if (typeof value !== 'string') return false
  const match = value.match(/^(.+)\/(0|[1-9]\d?)$/)
  if (!match || !validIpv4(match[1])) return false
  const prefix = Number(match[2])
  if (prefix > 32) return false
  const raw = match[1].split('.').reduce((result, octet) =>
    ((result << 8) | Number(octet)) >>> 0, 0)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return raw === ((raw & mask) >>> 0)
}

function validEndpointSelector(selector) {
  return validIpv4Host(selector)
    || (selector?.selector_type === 'CIDR' && validIpv4Cidr(selector.value))
}

function depthOf(exec) {
  return exec?.agent?.session?.header?.delegationDepth ?? 0
}

function insideWorkspace(path) {
  const target = resolve(WORKSPACE, path)
  return target === WORKSPACE || target.startsWith(WORKSPACE + sep)
}

export function visibleToolsForDepth(depth) {
  return depth === 0 ? ALLOWED : []
}

export function createSecurityOperationsGuard() {
  return {
    decide(exec) {
      // 容错：DSH 内核把 arguments 深冻结（tools 内核 deepFreeze），无法就地修改。
      // 因此改用浅拷贝构造归一化后的 exec：当模型把 body 传成 JSON 字符串时先解析为对象再校验。
      // 正确调用（body 为对象）行为完全不变；只读校验逻辑不变。
      const normalizedBody = normalizeJsonArgument(exec?.arguments?.body)
      if (normalizedBody !== exec?.arguments?.body)
        exec = { ...exec, arguments: { ...exec?.arguments, body: normalizedBody } }
      const tool = exec?.name
      if (DENIED_SET.has(tool)) return '策略确认、决策和旧策略路由永久禁用'
      if (!exec?.agent) return '工具调用缺少 Agent 运行身份'
      if (confirmationTurns.has(exec.agent)) return '策略确认轮次禁止模型继续调用工具'
      if (depthOf(exec) !== 0) return '策略能力只允许主 Agent 调用'
      if (!ALLOWED_SET.has(tool)) return '未列入策略角色授权集合的工具被拒绝'
      if ([RESOLVE_ENDPOINTS, SELECT_ENDPOINTS, PREPARE, 'mcp__policy-configuration__select_policy_configuration_candidate'].includes(tool) &&
          cancelledBindings.get(exec.agent)?.has(exec.arguments?.body?.request_id ?? exec.arguments?.operationId)) {
        return tool === PREPARE ? '策略准备前置校验：必须先调用 resolve_policy_endpoints，当前请求已作废，请使用新 request_id 重新解析' : '当前策略选择已取消或作废，请使用新请求重新解析'
      }
      if ((tool === SELECT_ENDPOINTS || tool === PREPARE) &&
          activeRequests.get(exec.agent) !== exec.arguments?.body?.request_id) {
        return '策略准备前置校验：必须先调用 resolve_policy_endpoints，并使用当前请求的冻结解析结果；旧请求不能替代本轮任务'
      }
      if (tool === RESOLVE_ENDPOINTS || tool === SELECT_ENDPOINTS || tool === PREPARE) {
        const action = tool === PREPARE ? exec.arguments?.body?.intent?.action : exec.arguments?.body?.action
        const requiredAction = actionConstraints.get(exec.agent)
        if (requiredAction === 'UNSPECIFIED') return '用户尚未明确允许或阻断动作，请先选择策略动作'
        if (requiredAction === 'CONFLICT') return '用户同时指定允许和阻断，请先澄清策略动作'
        if (requiredAction && (action ?? 'ALLOW') !== requiredAction) {
          return `策略动作必须与用户要求一致：${requiredAction === 'DENY' ? '阻断' : '允许'}`
        }
      }
      if (tool === RESOLVE_ENDPOINTS || tool === SELECT_ENDPOINTS) {
        const reason = validateEndpointRequest(exec.arguments?.body, tool === SELECT_ENDPOINTS)
        if (reason) return reason
        const requiredDevice = deviceConstraints.get(exec.agent)
        if (requiredDevice && exec.arguments.body.device_query !== requiredDevice) {
          return `用户指定设备必须原样传入 device_query：${requiredDevice}`
        }
      }
      if (tool === PREPARE) {
        const proof = exec.arguments?.body?.endpoint_resolution
        if (proof === undefined) {
          return '策略准备前置校验：必须先调用 resolve_policy_endpoints，并将其返回的 prepare_body 原样传给 prepare_policy_configuration'
        }
        if (!validEndpointProof(proof)) {
          return '端点解析证明无效，停止本次准备'
        }
        const intent = exec.arguments?.body?.intent
        if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
          return '策略意图结构无效'
        }
        if (Object.keys(intent).some(field => !SUPPORTED_INTENT_FIELDS.has(field))) {
          return '不支持的意图字段，停止本次准备'
        }
        if (intent.action !== undefined && !['ALLOW', 'DENY'].includes(intent.action)) return '策略动作只允许 ALLOW 或 DENY'
        if (intent.operation !== 'ADD') {
          return '当前策略角色只允许新增策略，停止本次准备'
        }
        if (!validEndpointSelector(intent.source) || !validEndpointSelector(intent.destination) ||
            !['TCP', 'UDP'].includes(intent.protocol) ||
            !Number.isInteger(intent.destination_port) ||
            intent.destination_port < 1 || intent.destination_port > 65535) {
          return '策略参数不完整或无效，先补齐源和目的 IPv4/规范 IPv4 CIDR、TCP/UDP 协议及目的端口'
        }
        if (Object.hasOwn(intent, 'device_query') &&
            (typeof intent.device_query !== 'string' ||
              !intent.device_query.trim() || intent.device_query.length > 80)) {
          return '指定设备线索无效，停止本次准备'
        }
        const requiredDevice = deviceConstraints.get(exec.agent)
        if (requiredDevice && intent.device_query !== requiredDevice) {
          return `用户指定设备必须原样传入 intent.device_query：${requiredDevice}`
        }
      }
      if (TOOL_ROUTES.workspace.includes(tool)) {
        const args = exec.arguments ?? {}
        for (const key of ['file_path', 'path', 'directory', 'cwd']) {
          const path = args[key]
          if (typeof path !== 'string') continue
          if (!insideWorkspace(path) || /(?:^|[/\\])\.env(?:$|[/\\.])/.test(path)) {
            return '文件读取仅限当前工作区的非凭据文件'
          }
        }
      }
      if (tool === RESOLVE_ENDPOINTS) activeRequests.set(exec.agent, exec.arguments.body.request_id)
      return undefined
    },
  }
}

export function apply(ctx) {
  const guard = createSecurityOperationsGuard()
  ctx.on('agent/pre-step', ({ agent, messages, step }, next) => {
    if (step !== 1) return next()
    const latestUser = messages.filter(message => message.source?.kind === 'user').at(-1)
    if (latestUser) {
      const text = latestUser.content?.filter(item => item.type === 'text').map(item => item.text).join('') ?? ''
      setPolicyUserRequest(agent, text)
    }
    return next()
  })
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: visibleToolsForDepth(agent?.session?.header?.delegationDepth ?? 0) })
  })
  ctx.tools.guard(exec => guard.decide(exec))
}


// 若入参是形如 JSON 对象/数组的字符串，则解析为对象；否则原样返回（不抛错）。
function normalizeJsonArgument(value) {
    if (typeof value !== 'string')
        return value
    const trimmed = value.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
        return value
    try {
        return JSON.parse(trimmed)
    }
    catch {
        return value
    }
}
