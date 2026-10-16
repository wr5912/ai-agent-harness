import { z } from 'zod'

export const automaticTaskCaseIds = ['U-IDENTITY-001', 'U-ROLE-001'] as const
const caseText = z.string().trim().min(1).max(24000)
  .refine(value => Buffer.byteLength(value, 'utf8') <= 24000, '业务用例正文不能超过 24000 字节')
  .refine(value => !/\bsk-[A-Za-z0-9_-]{12,}\b|(?:api[_-]?key|password|secret|authorization|cookie|token)["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{12,}/i.test(value), '业务用例正文包含凭据样式，请移除后再提交')
export const taskCaseSchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9-]*$/).refine(id => !automaticTaskCaseIds.some(value => value === id), 'U-IDENTITY-001 和 U-ROLE-001 由平台自动创建；业务用例不能重新定义'),
  title: z.string().trim().min(1).max(240).refine(value => !/\r|\n/.test(value), '业务用例标题必须为单行'),
  inputs: caseText,
  expected_behavior: caseText.refine(value => !/^#{1,6}\s/m.test(value), '业务用例预期正文不能包含额外 Markdown 标题'),
  fast: z.boolean().default(false),
}).strict()
/** 确认任务和实际创建共用同一可执行用例合同，避免确认后才发现无法保存。 */
export const taskBusinessCasesSchema = z.array(taskCaseSchema).min(1).max(30)
  .refine(cases => new Set(cases.map(item => item.id)).size === cases.length, '业务用例 ID 不得重复')
export const taskPlanSchema = z.object({
  goal: z.string().trim().min(1).max(12000),
  agent_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  source: z.string().regex(/^experiment:EXP-[a-z0-9-]+$/).optional(),
  evaluation_case_ids: z.array(z.string().min(1)).min(1),
  allowed_actions: z.array(z.object({ domain: z.enum(['agents', 'instances']), action: z.string() })).min(1),
  budget: z.object({
    max_repair_rounds: z.number().int().min(0).max(3).default(3),
    max_model_calls: z.number().int().min(1).max(120).default(60),
    timeout_minutes: z.number().int().min(1).max(60).default(30),
  }).default({ max_repair_rounds: 3, max_model_calls: 60, timeout_minutes: 30 }),
  instance_name: z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/).optional(),
  deliverables: z.array(z.string().min(1)).min(1),
  artifact_paths: z.array(z.string().regex(/^artifacts\/[a-zA-Z0-9_./-]+$/).refine(path => !path.split('/').includes('..'))).min(1).optional(),
  required_tool_names: z.array(z.string().min(1)).default([]),
  kind: z.enum(['inspection', 'training', 'business', 'compute-variant']).default('business'),
  compute_variant: z.object({ parent_experiment_id: z.string().regex(/^EXP-[a-z0-9-]+$/), parent_ref: z.string().regex(/^git:[a-f0-9]{40}$/) }).strict().optional(),
  inspection: z.object({ expected_device_ids: z.array(z.string().min(1)).min(1) }).strict().optional(),
  new_agent: z.object({ name: z.string().min(1), description: z.string().min(1), role: z.string().min(1), evaluation_cases: taskBusinessCasesSchema }).strict().optional(),
}).strict()
export type TaskPlan = z.infer<typeof taskPlanSchema>
export interface TaskExecution {
  id: string
  owner_session_id: string
  plan: TaskPlan
  state: 'running' | 'paused' | 'cancelled' | 'budget_exhausted' | 'unknown' | 'completed'
  started_at: string
  deadline_at: string
  repair_rounds: number
  model_calls: number
  assistant_model_calls?: number
  evaluation_usage?: Record<string, { observed_model_calls: number; complete: boolean }>
  evaluation_sha256?: string
  source_ref?: string
  target_source?: string
  goal_id?: string
  operations: { id: string; domain: string; action: string; state: string; input: Record<string, any>; receipt?: any }[]
  delivery?: any
  reason?: string
}

const continuousActions = new Set(['agents:new', 'agents:create', 'agents:tasks/assembly-apply', 'agents:edit/apply', 'agents:compute-variants/build', 'agents:eval/start', 'agents:eval/cancel', 'instances:run'])
export function parseTaskPlan(value: unknown): TaskPlan {
  const plan = taskPlanSchema.parse(value)
  if (!plan.source && !plan.new_agent) throw new Error('请选择固定目标来源，或在提案中提供待建智能体及业务测试')
  if (plan.source && plan.new_agent) throw new Error('待建智能体不能同时指定已有目标来源')
  if (plan.new_agent && plan.evaluation_case_ids.some(id => !automaticTaskCaseIds.some(value => value === id) && !plan.new_agent!.evaluation_cases.some(item => item.id === id))) throw new Error('首次业务测试与约定范围不一致')
  if (plan.kind !== 'training' && plan.budget.timeout_minutes > 30) throw new Error('普通任务总时限最多 30 分钟')
  if (plan.kind !== 'compute-variant' && plan.budget.max_model_calls > 60) throw new Error('普通任务模型调用上限为 60 次；代码变体需在任务提案中明确确认较大额度')
  if (plan.kind === 'inspection' && !plan.inspection?.expected_device_ids.length) throw new Error('巡检任务必须固定预期设备集合，不能在交付时缩小范围')
  if (new Set(plan.evaluation_case_ids).size !== plan.evaluation_case_ids.length) throw new Error('任务评测用例 ID 不得重复')
  if (plan.kind === 'inspection' && !plan.required_tool_names.length) throw new Error('巡检任务必须指定实际业务工具，不能只凭文字报告交付')
  if (plan.kind === 'compute-variant' && (!plan.source || !plan.compute_variant || plan.new_agent || plan.allowed_actions.some(item => item.action === 'new' || item.action === 'create'))) throw new Error('代码变体任务须绑定已派生的目标、固定父版和原比较用例，不能另建智能体或再次派生')
  if (plan.kind !== 'compute-variant' && (plan.compute_variant || plan.allowed_actions.some(item => item.action === 'compute-variants/build'))) throw new Error('代码变体构建只适用于固定来源的算力变体任务')
  if (plan.allowed_actions.some(item => !continuousActions.has(`${item.domain}:${item.action}`))) throw new Error('任务授权包含不支持连续执行的动作；配置工具、改评判口径或删除实例需单独确认')
  return plan
}

export function assertTaskBudget(task: TaskExecution, now = Date.now()) {
  if (task.state !== 'running') throw new Error(`任务当前不可执行：${task.reason ?? task.state}`)
  if (now >= Date.parse(task.deadline_at)) throw new Error('任务总时限已耗尽，暂停和重启不会重置额度')
  if (task.model_calls >= task.plan.budget.max_model_calls) throw new Error('任务模型调用额度已耗尽')
  if (task.operations.some(item => item.state === 'running' || item.state === 'unknown')) throw new Error('存在未完成或回执未知的操作，请先核对实际状态')
}

/** 编辑器的三种 Candidate 路径统一为 candidate/...，授权与回退共用该身份。 */
export function taskCandidatePath(task: TaskExecution, path: unknown): string | undefined {
  if (typeof path !== 'string' || !task.target_source || path.includes('\\')) return undefined
  if (path.split('/').some(part => !part || part === '.' || part === '..')) return undefined
  const prefix = `evolution/experiments/${task.target_source.slice(11)}/`
  if (path.startsWith(prefix)) {
    const relative = path.slice(prefix.length)
    return relative.startsWith('candidate/') ? relative : undefined
  }
  // 这些路径由真实编辑器定位到 Candidate 之外，不可改写成 Candidate 内同名文件。
  if (path.startsWith('evolution/') || path.startsWith('agents/') || path === 'evaluation.md' || path === 'decision.md') return undefined
  return path.startsWith('candidate/') ? path : `candidate/${path}`
}

/** 授权只覆盖当前目标，来源与用例由服务端重新绑定；不允许靠更换参数扩大任务。 */
export function taskAllows(task: TaskExecution, domain: string, action: string, input: Record<string, any>): boolean {
  if (!task.plan.allowed_actions.some(item => item.domain === domain && item.action === action)) return false
  const target = task.target_source
  if (input.agent_id && input.agent_id !== task.plan.agent_id) return false
  if (domain === 'agents' && ['new', 'create'].includes(action)) return !target && input.agent_id === task.plan.agent_id
  if (domain === 'agents' && action === 'tasks/assembly-apply') return Boolean(target && input.target_source === target)
  if (domain === 'agents' && action === 'compute-variants/build') return Boolean(task.plan.kind === 'compute-variant' && target && `experiment:${input.experiment_id}` === target)
  if (domain === 'agents' && action === 'edit/apply') {
    return Boolean(target && `experiment:${input.experiment_id}` === target && Array.isArray(input.edits) && input.edits.length
      && input.edits.every((edit: any) => taskCandidatePath(task, edit.path) !== undefined))
  }
  if (domain === 'agents' && action === 'eval/start') return Boolean(target && (input.source === target || task.plan.kind === 'compute-variant' && input.source === `experiment:${task.plan.compute_variant?.parent_experiment_id}`) && Array.isArray(input.cases)
    && input.cases.length === task.plan.evaluation_case_ids.length && task.plan.evaluation_case_ids.every(id => input.cases.includes(id)))
  if (domain === 'agents' && action === 'eval/cancel') return task.operations.some(item => item.action === 'eval/start' && item.receipt?.value?.job_id === input.job_id)
  if (domain === 'instances' && action === 'run') return Boolean(task.plan.instance_name && input.name === task.plan.instance_name
    && input.source === target && ['create', 'start', 'restart'].includes(input.operation))
  return false
}
