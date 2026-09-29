import { resolve, sep } from 'node:path'

export const name = 'emergency-action-guard'
export const inject = ['tools']

const WORKSPACE = '/work/harness/workspace'
const WORKSPACE_TOOLS = ['read', 'glob', 'grep', 'skill']
const ACTION_TOOLS = [
  'prepare_emergency_action', 'revise_emergency_action',
  'get_emergency_action', 'list_emergency_actions',
  'get_emergency_action_result', 'cancel_emergency_action',
].map(operation => `mcp__emergency-action__${operation}`)
export const ALLOWED_TOOLS = Object.freeze([...WORKSPACE_TOOLS, ...ACTION_TOOLS])
export const TOOL_ROUTES = Object.freeze({
  workspace: WORKSPACE_TOOLS,
  policy: [],
  inspection: [],
  faultAnalysis: [],
  delegates: ACTION_TOOLS,
  readOnly: ACTION_TOOLS.slice(2, 5),
  mutations: [...ACTION_TOOLS.slice(0, 2), ACTION_TOOLS[5]],
})
const ALLOWED = new Set(ALLOWED_TOOLS)
const confirmationTurns = new WeakMap()

export function setEmergencyConfirmationTurn(agent, active, operationId = null) {
  if (active) confirmationTurns.set(agent, operationId)
  else confirmationTurns.delete(agent)
}
export function emergencyConfirmationOperation(agent) {
  return confirmationTurns.has(agent) ? confirmationTurns.get(agent) : undefined
}

function inWorkspace(path) {
  const target = resolve(WORKSPACE, path)
  return target === WORKSPACE || target.startsWith(WORKSPACE + sep)
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value, keys) {
  return isObject(value) && Object.keys(value).every(key => keys.includes(key))
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function validVersion(value) {
  return Number.isInteger(value) && value >= 1
}

export function createGuard() {
  return {
    decide(exec) {
      if (!exec?.agent) return '缺少 Agent 运行身份'
      if (confirmationTurns.has(exec.agent) &&
          (!(exec.name === 'mcp__emergency-action__get_emergency_action' ||
             exec.name === 'mcp__emergency-action__get_emergency_action_result') ||
           exec.arguments?.operationId !== confirmationTurns.get(exec.agent))) {
        return '确认轮次仅允许查询当前操作结果'
      }
      if ((exec.agent.session?.header?.delegationDepth ?? 0) !== 0) return '应急工具只允许主 Agent 调用'
      const tool = exec.name
      if (!ALLOWED.has(tool)) return '工具不在应急角色授权集合'
      const args = exec.arguments ?? {}
      if (WORKSPACE_TOOLS.includes(tool)) {
        for (const key of ['file_path', 'path', 'directory', 'cwd']) {
          const path = args[key]
          if (typeof path === 'string' && (!inWorkspace(path) || /(?:^|[/\\])\.env(?:$|[/\\.])/.test(path))) {
            return '文件读取仅限工作区非凭据文件'
          }
        }
      }
      if (tool.startsWith('mcp__emergency-action__')) {
        const operation = tool.slice('mcp__emergency-action__'.length)
        const topKeys = operation === 'prepare_emergency_action' ? ['body']
          : operation === 'revise_emergency_action' || operation === 'cancel_emergency_action' ? ['operationId', 'body']
          : operation === 'list_emergency_actions' ? ['limit', 'cursor'] : ['operationId']
        if (!onlyKeys(args, topKeys)) return '应急工具参数含未授权字段'
        if (operation === 'prepare_emergency_action' &&
            !onlyKeys(args.body, ['request_id', 'intent', 'action_key', 'params', 'target_hint'])) return '准备请求字段无效'
        if (operation === 'revise_emergency_action' &&
            !onlyKeys(args.body, ['request_id', 'expected_version', 'intent', 'action_key', 'params', 'target_hint'])) return '修订请求字段无效'
        if (operation === 'cancel_emergency_action' &&
            !onlyKeys(args.body, ['request_id', 'expected_version'])) return '取消请求字段无效'
        if (operation === 'prepare_emergency_action' || operation === 'revise_emergency_action') {
          if (!nonemptyString(args.body.request_id) || !nonemptyString(args.body.intent)) {
            return '准备或修订缺少请求号或意图'
          }
        }
        if (operation === 'revise_emergency_action' || operation === 'cancel_emergency_action') {
          if (!nonemptyString(args.operationId) || !/^op_[a-f0-9]{32}$/.test(args.operationId) ||
              !nonemptyString(args.body.request_id) || !validVersion(args.body.expected_version)) {
            return '操作号、请求号或版本无效'
          }
        }
        if ((operation === 'get_emergency_action' || operation === 'get_emergency_action_result') &&
            (!nonemptyString(args.operationId) || !/^op_[a-f0-9]{32}$/.test(args.operationId))) {
          return '操作号无效'
        }
        if (Object.hasOwn(args, 'body') && isObject(args.body) &&
            Object.hasOwn(args.body, 'params') && !isObject(args.body.params)) return '动作参数结构无效'
      }
      return undefined
    },
  }
}

export function apply(ctx) {
  const guard = createGuard()
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: (agent.session?.header?.delegationDepth ?? 0) === 0 ? ALLOWED_TOOLS : [] })
  })
  ctx.tools.guard(exec => guard.decide(exec))
}
