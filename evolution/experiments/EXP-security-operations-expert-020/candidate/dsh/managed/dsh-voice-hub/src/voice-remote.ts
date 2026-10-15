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
  queueWaitMs?: number
  reasoningMode?: 'off-requested' | 'minimum' | 'unknown'
  reasoningEffort?: string
  reasoningObserved?: boolean
  reasoningTokens?: number
  firstTextMs?: number
}

/** 音频帧由两端共享；PCM 在 final 之前即可起播，其他格式保持整句解码。 */
export interface TtsChunkFrame {
  sessionId: string
  sentenceId: number
  chunkId: number
  final: boolean
  text?: string
  audio: string
  mime?: string
  sourceMessageId?: string
  epoch?: number
  encoding?: 'pcm-s16le'
  sampleRate?: number
  failed?: boolean
  queueWaitMs?: number
  firstAudioMs?: number
  targetTabId?: string | null
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
