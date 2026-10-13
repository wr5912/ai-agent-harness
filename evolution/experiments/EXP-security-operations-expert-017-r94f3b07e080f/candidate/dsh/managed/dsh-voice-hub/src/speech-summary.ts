import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
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

/** 只接受主回合已提交且正常结束的可见正文，包括工具调用前的正文。 */
export function summarySource(event: SessionEvent): { text: string; provider: string; model: string } | null {
  if (event.type !== 'assistant/message' || typeof event.surfaceOp === 'object' || event.data.interrupted) return null
  const source = event.data.message.source
  if (source.kind !== 'model') return null
  const finish = [...event.data.stream].reverse().find((record) => record.type === 'chunk' && record.chunk.type === 'finish')
  if (!finish || finish.type !== 'chunk' || finish.chunk.type !== 'finish'
    || !['stop', 'tool-calls'].includes(finish.chunk.reason.kind)) return null
  const text = event.data.message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
  return text ? { text, provider: source.provider, model: source.model } : null
}

interface SummaryJob {
  sessionId: string
  sourceMessageId: string
  turn: number
  step: number
  targetTabId: string
  text: string
  provider: string
  model: string
  settings: SummarySettings
}

/** 按会话串行生成；取消时旧请求及其迟到结果一起作废。 */
export class SpeechSummaryQueue {
  private readonly sessions = new Map<string, { controller: AbortController; tail: Promise<void> }>()
  constructor(
    private readonly stream: (options: GenerateOptions) => AsyncIterable<StreamChunk>,
    private readonly emit: (event: SpeechSummaryEvent) => void,
    private readonly speak: (sessionId: string, text: string) => void,
    private readonly failed: (sessionId: string, targetTabId: string) => void,
  ) {}

  enqueue(job: SummaryJob): void {
    let state = this.sessions.get(job.sessionId)
    if (!state) {
      state = { controller: new AbortController(), tail: Promise.resolve() }
      this.sessions.set(job.sessionId, state)
    }
    const { controller } = state
    state.tail = state.tail.then(async () => {
      if (controller.signal.aborted) return
      const started = Date.now()
      try {
        const route = job.settings.summaryModel ?? job
        let text = ''
        let finished = false
        for await (const chunk of this.stream({
          provider: route.provider, model: route.model, signal: controller.signal,
          system: job.settings.summaryPrompt.replaceAll('{length}', String(job.settings.summaryLength)),
          messages: [{ role: 'user', content: [{ type: 'text', text: job.text }] }],
        })) {
          if (controller.signal.aborted) return
          if (chunk.type === 'text-delta') text += chunk.text
          if (chunk.type === 'finish') finished = chunk.reason.kind === 'stop'
        }
        if (controller.signal.aborted) return
        text = text.trim()
        if (!finished || !text) throw new Error('摘要未正常完成')
        this.emit({
          type: 'speech-summary', sessionId: job.sessionId, sourceMessageId: job.sourceMessageId,
          turn: job.turn, step: job.step, targetTabId: job.targetTabId, text,
          generationMs: Date.now() - started,
        })
        this.speak(job.sessionId, text)
      } catch {
        if (!controller.signal.aborted) this.failed(job.sessionId, job.targetTabId)
      }
    })
  }

  cancel(sessionId: string): void {
    this.sessions.get(sessionId)?.controller.abort()
    this.sessions.delete(sessionId)
  }
  dispose(): void {
    for (const sessionId of this.sessions.keys()) this.cancel(sessionId)
  }
}
