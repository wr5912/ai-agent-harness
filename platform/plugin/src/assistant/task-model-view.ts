import type { TaskExecution } from './task.ts'

/** 只精简已完成任务的模型阅读视图；持久记录、界面和恢复查询仍使用原对象。 */
export function completedTaskModelView(task: TaskExecution) {
  if (task.state !== 'completed') return task
  const delivery = task.delivery
  return {
    ...task,
    operations: task.operations.slice(-5).map(({ id, domain, action, state }) => ({ id, domain, action, state })),
    ...(delivery ? { delivery: {
      ...Object.fromEntries(['ready', 'instance', 'artifacts', 'run_id', 'note', 'entry', 'comparison', 'end_confirmed']
        .filter(key => delivery[key] !== undefined).map(key => [key, delivery[key]])),
      ...(Array.isArray(delivery.checks) ? { checks: delivery.checks.map((check: any) => check.ok === true ? { name: check.name, ok: true } : check) } : {}),
      ...(delivery.probe ? { probe: Object.fromEntries(['id', 'path', 'status', 'case_id', 'session_id', 'model_usage', 'downloads', 'report_sha256']
        .filter(key => delivery.probe[key] !== undefined).map(key => [key, delivery.probe[key]])) } : {}),
    } } : {}),
    model_usage_observation: '模型调用数截至本次状态读取；后续调用继续累计，最终累计以任务卡当前计数为准。',
  }
}
