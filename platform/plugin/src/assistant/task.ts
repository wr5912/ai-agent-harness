import { z } from 'zod'

export const taskCaseSchema = z.object({ id: z.string().regex(/^[A-Z][A-Z0-9-]*$/), title: z.string().trim().min(1).max(240), inputs: z.string().trim().min(1).max(24000), expected_behavior: z.string().trim().min(1).max(24000), fast: z.boolean().default(false) }).strict()
export const taskPlanSchema = z.object({
  goal: z.string().trim().min(1).max(12000),
  agent_id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  source: z.string().regex(/^experiment:EXP-[a-z0-9-]+$/).optional(),
  evaluation_case_ids: z.array(z.string().min(1)).min(1),
  allowed_actions: z.array(z.object({ domain: z.enum(['agents', 'instances']), action: z.string() })).min(1),
  budget: z.object({
    max_repair_rounds: z.number().int().min(0).max(3).default(3),
    max_model_calls: z.number().int().min(1).max(60).default(60),
    timeout_minutes: z.number().int().min(1).max(60).default(30),
  }).default({ max_repair_rounds: 3, max_model_calls: 60, timeout_minutes: 30 }),
  instance_name: z.string().regex(/^[a-z0-9][a-z0-9_.-]*$/).optional(),
  deliverables: z.array(z.string().min(1)).min(1),
  artifact_paths: z.array(z.string().regex(/^artifacts\/[a-zA-Z0-9_./-]+$/).refine(path => !path.split('/').includes('..'))).min(1).optional(),
  required_tool_names: z.array(z.string().min(1)).default([]),
  kind: z.enum(['inspection', 'training', 'business']).default('business'),
  inspection: z.object({ expected_device_ids: z.array(z.string().min(1)).min(1) }).strict().optional(),
  new_agent: z.object({ name: z.string().min(1), description: z.string().min(1), role: z.string().min(1), evaluation_cases: z.array(taskCaseSchema).min(1) }).strict().optional(),
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
  evaluation_sha256?: string
  source_ref?: string
  target_source?: string
  goal_id?: string
  operations: { id: string; domain: string; action: string; state: string; input: Record<string, any>; receipt?: any }[]
  delivery?: any
  reason?: string
}

const continuousActions = new Set(['agents:new', 'agents:create', 'agents:tasks/assembly-apply', 'agents:edit/apply', 'agents:eval/start', 'agents:eval/cancel', 'instances:run'])
export function parseTaskPlan(value: unknown): TaskPlan {
  const plan = taskPlanSchema.parse(value)
  if (!plan.source && !plan.new_agent) throw new Error('请选择固定目标来源，或在提案中提供待建智能体及业务测试')
  if (plan.source && plan.new_agent) throw new Error('待建智能体不能同时指定已有目标来源')
  if (plan.new_agent && (new Set(plan.new_agent.evaluation_cases.map(item => item.id)).size !== plan.new_agent.evaluation_cases.length || plan.evaluation_case_ids.some(id => !plan.new_agent!.evaluation_cases.some(item => item.id === id)))) throw new Error('首次业务测试 ID 重复或与约定范围不一致')
  if (plan.kind !== 'training' && plan.budget.timeout_minutes > 30) throw new Error('普通任务总时限最多 30 分钟')
  if (plan.kind === 'inspection' && !plan.inspection?.expected_device_ids.length) throw new Error('巡检任务必须固定预期设备集合，不能在交付时缩小范围')
  if (new Set(plan.evaluation_case_ids).size !== plan.evaluation_case_ids.length) throw new Error('任务评测用例 ID 不得重复')
  if (plan.kind === 'inspection' && !plan.required_tool_names.length) throw new Error('巡检任务必须指定实际业务工具，不能只凭文字报告交付')
  if (plan.allowed_actions.some(item => !continuousActions.has(`${item.domain}:${item.action}`))) throw new Error('任务授权包含不支持连续执行的动作；配置工具、改评判口径或删除实例需单独确认')
  return plan
}

export function assertTaskBudget(task: TaskExecution, now = Date.now()) {
  if (task.state !== 'running') throw new Error(`任务当前不可执行：${task.reason ?? task.state}`)
  if (now >= Date.parse(task.deadline_at)) throw new Error('任务总时限已耗尽，暂停和重启不会重置额度')
  if (task.model_calls >= task.plan.budget.max_model_calls) throw new Error('任务模型调用额度已耗尽')
  if (task.operations.some(item => item.state === 'running' || item.state === 'unknown')) throw new Error('存在未完成或回执未知的操作，请先核对实际状态')
}

/** 授权只覆盖当前目标，来源与用例由服务端重新绑定；不允许靠更换参数扩大任务。 */
export function taskAllows(task: TaskExecution, domain: string, action: string, input: Record<string, any>): boolean {
  if (!task.plan.allowed_actions.some(item => item.domain === domain && item.action === action)) return false
  const target = task.target_source
  if (input.agent_id && input.agent_id !== task.plan.agent_id) return false
  if (domain === 'agents' && ['new', 'create'].includes(action)) return !target && input.agent_id === task.plan.agent_id
  if (domain === 'agents' && action === 'tasks/assembly-apply') return Boolean(target && input.target_source === target)
  if (domain === 'agents' && action === 'edit/apply') {
    return Boolean(target && `experiment:${input.experiment_id}` === target && Array.isArray(input.edits) && input.edits.length
      && input.edits.every((edit: any) => typeof edit.path === 'string' && edit.path.startsWith('candidate/') && !edit.path.includes('..')))
  }
  if (domain === 'agents' && action === 'eval/start') return Boolean(target && input.source === target && Array.isArray(input.cases)
    && input.cases.length === task.plan.evaluation_case_ids.length && task.plan.evaluation_case_ids.every(id => input.cases.includes(id)))
  if (domain === 'agents' && action === 'eval/cancel') return task.operations.some(item => item.action === 'eval/start' && item.receipt?.value?.job_id === input.job_id)
  if (domain === 'instances' && action === 'run') return Boolean(task.plan.instance_name && input.name === task.plan.instance_name
    && input.source === target && ['create', 'start', 'restart'].includes(input.operation))
  return false
}
