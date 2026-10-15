import type { GenerateOptions, StreamChunk, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SpeechSummaryEvent } from './voice-remote.ts'

export const DEFAULT_SUMMARY_PROMPT = '将下面的助手正文改写为约 {length} 字的中文口语播报。只说核心结论或当前进展，保留否定、风险和未完成状态，不添加原文没有的事实。不要 Markdown、代码、链接、开场白或解释，只输出播报文字。'
export interface SummarySettings {
  summaryLength: number
  summaryPrompt: string
  summaryModel: { provider: string; model: string } | null
}
export const SUMMARY_DEFAULTS: SummarySettings = {
  summaryLength: 30,
  summaryPrompt: DEFAULT_SUMMARY_PROMPT,
  summaryModel: null,
}

// 这些适配器只消费当前主回合的一次性结果或工具调用，不能作为独立摘要模型。
const LOCAL_DELIVERY_PROVIDERS = new Set([
  'threat-analysis-delivery', 'security-operation-delivery', 'threat-analysis-automation',
])

/** 只接受主回合已提交且正常结束的可见正文，包括工具调用前的正文。 */
export function summarySource(event: SessionEvent, events: readonly SessionEvent[] = [], fallbackRoute?: { provider: string; model: string }): {
  text: string; provider?: string; model?: string
} | null {
  if (event.type !== 'assistant/message' || typeof event.surfaceOp === 'object' || event.data.interrupted) return null
  const source = event.data.message.source
  if (source.kind !== 'model') return null
  const finish = [...event.data.stream].reverse().find((record) => record.type === 'chunk' && record.chunk.type === 'finish')
  if (!finish || finish.type !== 'chunk' || finish.chunk.type !== 'finish'
    || !['stop', 'tool-calls'].includes(finish.chunk.reason.kind)) return null
  const text = event.data.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
  if (!text) return null
  const previous = events.findLast(item => item.type === 'request/header'
    && !LOCAL_DELIVERY_PROVIDERS.has(item.data.header.config.provider))
  const route = !LOCAL_DELIVERY_PROVIDERS.has(source.provider) ? source
    : fallbackRoute && !LOCAL_DELIVERY_PROVIDERS.has(fallbackRoute.provider) ? fallbackRoute
    : previous?.type === 'request/header' ? previous.data.header.config : undefined
  // 没有原生路由时仍保留正文，允许显式 summaryModel；默认调用则受控失败。
  return { text, ...(route ? { provider: route.provider, model: route.model } : {}) }
}

interface SummaryJob {
  sessionId: string
  sourceMessageId: string
  turn: number
  step: number
  targetTabId: string
  text: string
  provider?: string
  model?: string
  settings: SummarySettings
}

export const SUMMARY_TIMEOUT_MS = 15000

/** 档位顺序由适配器声明；没有能力信息时不猜测厂商参数。 */
export function summaryReasoning(model?: LlmResolvedModelInfo): {
  reasoningEffort?: GenerateOptions['reasoningEffort']
  reasoningMode: 'off-requested' | 'minimum' | 'unknown'
} {
  const efforts = model?.reasoning?.efforts ?? []
  const off = efforts.find(effort => ['off', 'none'].includes(effort.id))
  const selected = off ?? efforts[0]
  return selected
    ? { reasoningEffort: selected.id, reasoningMode: off ? 'off-requested' : 'minimum' }
    : { reasoningMode: 'unknown' }
}

/** 按会话串行生成；每项含排队的总时限独立于上游是否及时响应取消。 */
export class SpeechSummaryQueue {
  private readonly sessions = new Map<string, { controller: AbortController; tail: Promise<void> }>()
  constructor(
    private readonly stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
    private readonly emit: (event: SpeechSummaryEvent) => void,
    private readonly speak: (sessionId: string, text: string, sourceMessageId: string) => void,
    private readonly failed: (sessionId: string, targetTabId: string, reason: string) => void,
    private readonly resolveModel?: (provider: string, model: string, signal: AbortSignal) => Promise<LlmResolvedModelInfo>,
  ) {}

  enqueue(job: SummaryJob): void {
    let state = this.sessions.get(job.sessionId)
    if (!state) {
      state = { controller: new AbortController(), tail: Promise.resolve() }
      this.sessions.set(job.sessionId, state)
    }
    const { controller } = state
    const queuedAt = performance.now()
    state.tail = state.tail.then(async () => {
      if (controller.signal.aborted) return
      const started = performance.now()
      const request = new AbortController()
      const cancel = (): void => request.abort(controller.signal.reason)
      controller.signal.addEventListener('abort', cancel, { once: true })
      const timer = setTimeout(() => request.abort(new Error('摘要生成或排队超时')), Math.max(0, SUMMARY_TIMEOUT_MS - (started - queuedAt)))
      let onAbort: () => void = () => {}
      try {
        if (started - queuedAt >= SUMMARY_TIMEOUT_MS) throw new Error('摘要排队超时')
        const aborted = new Promise<never>((_, reject) => {
          onAbort = () => reject(request.signal.reason)
          request.signal.addEventListener('abort', onAbort, { once: true })
        })
        const generated = new Promise<{ text: string; reasoningMode: 'off-requested' | 'minimum' | 'unknown'; effort?: string; reasoningObserved: boolean; reasoningTokens?: number; firstTextMs?: number }>((resolve, reject) => {
          void (async () => {
            const route = job.settings.summaryModel ?? job
            if (!route.provider || !route.model) throw new Error('缺少当前会话的摘要模型路由')
            const model = await this.resolveModel?.(route.provider, route.model, request.signal)
            request.signal.throwIfAborted()
            const { reasoningEffort, reasoningMode } = summaryReasoning(model)
            let text = ''
            let reasoningObserved = false
            let reasoningTokens: number | undefined
            let firstTextMs: number | undefined
            for await (const chunk of this.stream({
              provider: route.provider, model: route.model, signal: request.signal,
              ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
              maxTokens: Math.min(model?.defaultMaxTokens ?? Infinity, Math.max(128, job.settings.summaryLength * 4)),
              system: job.settings.summaryPrompt.replaceAll('{length}', String(job.settings.summaryLength)),
              messages: [{ role: 'user', content: [{ type: 'text', text: job.text }] }],
            })) {
              request.signal.throwIfAborted()
              if (chunk.type === 'reasoning-delta' && chunk.text.trim()) reasoningObserved = true
              if (chunk.type === 'usage') reasoningTokens = chunk.usage.reasoningTokens
              if (chunk.type === 'text-delta') {
                firstTextMs ??= performance.now() - started
                text += chunk.text
              }
              if (chunk.type === 'finish') {
                text = text.trim()
                if (chunk.reason.kind !== 'stop' || !text) throw new Error('摘要未正常完成')
                // finish 已是协议终点；不要把迭代器/连接清理时间加到发布等待中。
                resolve({ text, reasoningMode, effort: reasoningEffort, reasoningObserved, reasoningTokens, firstTextMs })
                return
              }
            }
            throw new Error('摘要缺少完成状态')
          })().catch(reject)
        })
        const result = await Promise.race([generated, aborted])
        if (controller.signal.aborted) return
        this.emit({
          type: 'speech-summary', sessionId: job.sessionId, sourceMessageId: job.sourceMessageId,
          turn: job.turn, step: job.step, targetTabId: job.targetTabId, text: result.text,
          generationMs: performance.now() - started, queueWaitMs: started - queuedAt,
          reasoningMode: result.reasoningMode, reasoningObserved: result.reasoningObserved,
          ...(result.reasoningTokens === undefined ? {} : { reasoningTokens: result.reasoningTokens }),
          ...(result.firstTextMs === undefined ? {} : { firstTextMs: result.firstTextMs }),
          ...(result.effort === undefined ? {} : { reasoningEffort: result.effort }),
        })
        this.speak(job.sessionId, result.text, job.sourceMessageId)
      } catch (error) {
        if (!controller.signal.aborted) this.failed(job.sessionId, job.targetTabId, error instanceof Error && error.message.includes('超时') ? '摘要生成或排队超时' : '摘要生成失败')
      } finally {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', cancel)
        request.signal.removeEventListener('abort', onAbort)
        request.abort()
      }
    }).catch(() => { /* 消费者通知失败也不能锁死后续摘要。 */ })
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.controller.abort()
    this.sessions.delete(sessionId)
  }
  dispose(): void {
    for (const sessionId of this.sessions.keys()) this.cancel(sessionId)
  }
}
