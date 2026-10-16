import { workspaceIdentity, workspaceOwnsCwd } from '../workspace.ts'

const allowedNames = new Set(['skill', 'platform_agents'])
export function isDecisionExtraction(root: string, agent: any, state: any) {
  return belongsToTask(root, agent, state, 'decision-sample-extraction')
}
export function isComputeVariantResearch(root: string, agent: any, state: any) {
  return belongsToTask(root, agent, state, 'compute-variant-research')
}
function belongsToTask(root: string, agent: any, state: any, skill: string) {
  return workspaceOwnsCwd(root, agent?.session?.header?.cwd) && (!state?.workspace_id || state.workspace_id === workspaceIdentity(root).id) && state?.task_context?.skill === skill
}
export const createExtractionScope = () => createTaskScope('decision-sample-extraction', '决策样本任务')
export const createComputeVariantScope = () => createTaskScope('compute-variant-research', '算力变体研究')

/** 两个专用任务复用 Runtime 工具作用域；动作与写入确认仍由各自平台接口负责。 */
function createTaskScope(skill: string, label: string) {
  const scopes = new Map<any, (() => void)[]>()
  return {
    apply(agent: any) {
      if (scopes.has(agent)) return
      const tools = agent.ctx?.tools
      if (!tools?.restrict || !tools?.guard || !tools?.presentAs) throw new Error(`当前 Runtime 缺少${label}所需的工具作用域能力`)
      const cleanup: (() => void)[] = []
      try {
        cleanup.push(tools.restrict({ allow: [...allowedNames] }))
        cleanup.push(tools.presentAs('native'))
        cleanup.push(tools.guard((execution: any) => allowedNames.has(execution.name) && (execution.name !== 'skill' || execution.arguments?.name === skill) ? undefined : `${label}仅允许读取指定技能和通过平台办理业务`))
        scopes.set(agent, cleanup)
      } catch (error) {
        for (const stop of cleanup.reverse()) stop()
        throw error
      }
    },
    release(agent: any) { const cleanup = scopes.get(agent); if (cleanup) { for (const stop of cleanup.reverse()) stop(); scopes.delete(agent) } },
    dispose() { for (const cleanup of scopes.values()) for (const stop of cleanup.reverse()) stop(); scopes.clear() },
  }
}
