import { resolve, sep } from 'node:path'

export const name = 'policy-configuration-guard'
export const inject = ['tools']

const WORKSPACE = '/work/harness/workspace'
export const TOOL_ROUTES = Object.freeze({
  workspace: Object.freeze(['read', 'glob', 'grep', 'skill']),
  policy: Object.freeze([
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
const unsupportedWriteRequests = new WeakSet()
const unsupportedValidityRequests = new WeakSet()
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
  const onDevice = text.match(/(?:请)?在\s*([^\s,，。；;]{1,80}?)\s*上(?:[，,\s]|放通|开通|新增|配置|$)/)
  if (onDevice) return onDevice[1]
  const named = text.match(/(?:指定|使用)(?:的)?(?:防火墙|设备)(?:名称|ID|管理IP)?\s*[:：]?\s*([^\s,，。；;]{1,80})/i)
  return named?.[1] ?? null
}
export function setPolicyUserRequest(agent, text) {
  deviceConstraints.set(agent, deviceConstraintFromText(text))
  if (typeof text === 'string' && /阻断|拒绝|禁止(?:访问|通信|流量)|\b(?:deny|block)\b/i.test(text)) {
    unsupportedWriteRequests.add(agent)
  } else {
    unsupportedWriteRequests.delete(agent)
  }
  if (typeof text === 'string' && /有效期|持续\s*\d+\s*(?:天|日|小时|分钟)|到期|截止时间/.test(text)) {
    unsupportedValidityRequests.add(agent)
  } else {
    unsupportedValidityRequests.delete(agent)
  }
}
const PREPARE = 'mcp__policy-configuration__prepare_policy_configuration'
const SUPPORTED_INTENT_FIELDS = new Set([
  'schema_version', 'policy_kind', 'operation', 'source', 'destination',
  'protocol', 'destination_port', 'target_external_id', 'device_query', 'validity', 'change_reason',
])

function validIpv4Host(selector) {
  if (!selector || selector.selector_type !== 'IP' || typeof selector.value !== 'string') return false
  const octets = selector.value.split('.')
  return octets.length === 4 && octets.every(octet =>
    /^(0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
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
      const tool = exec?.name
      if (DENIED_SET.has(tool)) return '策略确认、决策和旧策略路由永久禁用'
      if (!exec?.agent) return '工具调用缺少 Agent 运行身份'
      if (confirmationTurns.has(exec.agent)) return '策略确认轮次禁止模型继续调用工具'
      if (depthOf(exec) !== 0) return '策略能力只允许主 Agent 调用'
      if (!ALLOWED_SET.has(tool)) return '未列入策略角色授权集合的工具被拒绝'
      if (tool === PREPARE) {
        if (unsupportedWriteRequests.has(exec.agent)) {
          return '阻断或拒绝访问不能解释为新增放行策略，停止本次准备'
        }
        if (unsupportedValidityRequests.has(exec.agent)) {
          return '本轮尚未验证限时策略的下发与到期语义，不能丢弃有效期生成普通策略'
        }
        const intent = exec.arguments?.body?.intent
        if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
          return '策略意图结构无效'
        }
        if (Object.keys(intent).some(field => !SUPPORTED_INTENT_FIELDS.has(field))) {
          return '不支持的意图字段，停止本次准备'
        }
        if (intent.operation !== 'ADD') {
          return '当前策略角色只允许新增策略，停止本次准备'
        }
        if (!validIpv4Host(intent.source) || !validIpv4Host(intent.destination) ||
            !['TCP', 'UDP'].includes(intent.protocol) ||
            !Number.isInteger(intent.destination_port) ||
            intent.destination_port < 1 || intent.destination_port > 65535) {
          return '策略参数不完整或无效，先补齐源和目的 IPv4、TCP/UDP 协议及目的端口'
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
      return undefined
    },
  }
}

export function apply(ctx) {
  const guard = createSecurityOperationsGuard()
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
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
