import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { workspaceIdentity, workspaceOwnsCwd } from '../workspace.ts'

// 保留已落盘的策略标识，保证旧 Session 的同一步重试额度可恢复。
export const TOOL_INPUT_JSON_RETRY_POLICY = 'harness-platform/decision-extraction-json/v1'
export const toolInputJsonRetrySchema = z.object({
  turn: z.number().int().nonnegative(), step: z.number().int().nonnegative(),
  provider: z.string(), retry: z.number().int().nonnegative(), retryId: z.string(),
})

/** 仅重新生成尚未执行的失败请求；不修补参数，也不重放已经执行的工具。 */
export function createToolInputRecovery(root: string, projections: SessionProjectionRegistry, lifetime?: AbortSignal) {
  return async (event: any, next: () => Promise<any>) => {
    const signal = lifetime ? AbortSignal.any([event.signal, lifetime]) : event.signal
    const downstream = await next()
    if (signal.aborted) return
    if (downstream) return downstream
    if (event.failure?.code !== 'MALFORMED_RESPONSE'
      || event.failure.message !== 'DeepSeek Messages stream: tool input is invalid JSON') return
    const state = projections.stateOf(event.agent.session, 'harnessPlatformAssistant')
    if (!state?.active || !workspaceOwnsCwd(root, event.agent?.session?.header?.cwd)
      || state.workspace_id && state.workspace_id !== workspaceIdentity(root).id) return
    const previous = state.extraction_json_retry
    const current = previous && previous.turn === event.turn && previous.step === event.step && previous.provider === event.provider ? previous : undefined
    if ((current?.retry ?? 0) >= 2) return
    const retry = (current?.retry ?? 0) + 1
    const retryId = current?.retryId ?? randomUUID()
    const delayMs = 500 * retry
    event.agent.session.append('llm/retry', {
      retryId, turn: event.turn, step: event.step, provider: event.provider,
      mode: 'normal', policyKey: TOOL_INPUT_JSON_RETRY_POLICY, maxRetries: 2, retry, delayMs, failure: event.failure,
    })
    try { await delay(delayMs, undefined, { signal }) }
    catch (error) { if (signal.aborted) return; throw error }
    if (signal.aborted) return
    event.agent.session.append('llm/retry-started', { retryId, turn: event.turn, step: event.step, retry })
    return { kind: 'retry' }
  }
}
