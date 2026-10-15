import { resolve } from 'node:path'

const allowedNames = new Set(['skill', 'platform_agents'])
export function isDecisionExtraction(root: string, agent: any, state: any) {
  return typeof agent?.session?.header?.cwd === 'string' && resolve(agent.session.header.cwd) === resolve(root) && state?.task_context?.skill === 'decision-sample-extraction'
}

/** 复用 Runtime 自带作用域限制；分析轨迹无需 shell、子智能体或业务执行工具。 */
export function createExtractionScope() {
  const scopes = new Map<any, (() => void)[]>()
  return {
    apply(agent: any) {
      if (scopes.has(agent)) return
      const tools = agent.ctx?.tools
      if (!tools?.restrict || !tools?.guard || !tools?.presentAs) throw new Error('当前 Runtime 缺少决策样本任务所需的工具作用域能力')
      const cleanup: (() => void)[] = []
      try {
        cleanup.push(tools.restrict({ allow: [...allowedNames] }))
        cleanup.push(tools.presentAs('native'))
        cleanup.push(tools.guard((execution: any) => allowedNames.has(execution.name) && (execution.name !== 'skill' || execution.arguments?.name === 'decision-sample-extraction') ? undefined : '决策样本任务仅允许读取指定技能和通过平台取数'))
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
