import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** 主模型完成一次正文后，供语音消费者使用的独立摘要。 */
export interface SpeechSummaryEvent {
  type: 'speech-summary'
  sessionId: string
  sourceMessageId: string
  turn: number
  step: number
  text: string
  targetTabId: string
  generationMs: number
}

export type VoiceStatusData = Record<string, string | number | boolean | null>
export type VoiceEvent = SpeechSummaryEvent | {
  type: 'voice-status'
  event: string
  data: VoiceStatusData
}

/** 音频和状态复用 DSH 的 remote.mux 连接；不写入 Session 历史。 */
export class VoiceModeRemote extends TypertRemoteService {
  constructor(ctx: Context, private readonly subscribe: (tabId: string, send: (event: VoiceEvent) => void) => () => void) {
    super(ctx, 'voiceMode')
  }

  @Remote({ mode: 'stream' })
  async *follow(tabId: string, signal: AbortSignal): AsyncIterable<VoiceEvent> {
    if (!tabId || tabId.length > 64) throw new Error('标签页无效')
    signal.throwIfAborted()
    const pending: VoiceEvent[] = []
    let wake: (() => void) | undefined
    const stop = this.subscribe(tabId, (event) => {
      pending.push(event)
      wake?.()
    })
    const abort = (): void => { stop(); wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (!pending.length) await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
        while (!signal.aborted && pending.length) yield pending.shift()!
      }
    } finally {
      signal.removeEventListener('abort', abort)
      stop()
    }
  }
}
