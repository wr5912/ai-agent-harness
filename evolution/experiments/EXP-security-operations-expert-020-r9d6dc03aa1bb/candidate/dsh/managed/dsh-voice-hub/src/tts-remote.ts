import { randomUUID } from 'node:crypto'
import type { TtsEngine, TtsEngineStatus } from './tts-queue.ts'

/** talk-sdk 的可取消流输出是 24 kHz、单声道、16 位 little-endian PCM。 */
export function pcm24ToWav(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2) throw new Error('TTS（语音合成）返回空音频或未按 PCM（原始音频）16 位对齐')
  const wav = Buffer.allocUnsafe(44 + pcm.length)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + pcm.length, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcm.length, 40)
  pcm.copy(wav, 44)
  return wav
}

export class RemoteTtsEngine implements TtsEngine {
  readonly mime = 'audio/wav'
  private readonly streamUrl: () => string
  private readonly cancelUrl: () => string
  private inFlight: { id: string; abort: AbortController } | null = null
  private lastError: string | undefined

  constructor(streamUrl: () => string, cancelUrl: () => string) {
    this.streamUrl = streamUrl
    this.cancelUrl = cancelUrl
  }

  updateVoice(): void {
    // talk-sdk 当前没有音色和语速入参；设置页在远端模式下不展示这两个控件。
  }

  async synthesize(text: string): Promise<Buffer> {
    const id = randomUUID().replaceAll('-', '')
    const abort = new AbortController()
    this.inFlight = { id, abort }
    try {
      const res = await fetch(this.streamUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, generationId: id }),
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(`TTS（语音合成）HTTP（请求状态）${res.status}`)
      const pcm = Buffer.from(await res.arrayBuffer())
      const wav = pcm24ToWav(pcm)
      this.lastError = undefined
      return wav
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (this.inFlight?.id === id) this.inFlight = null
    }
  }

  interrupt(): void {
    const active = this.inFlight
    if (!active) return
    active.abort.abort()
    this.inFlight = null
    const cancelUrl = this.cancelUrl()
    if (!cancelUrl) return
    void fetch(cancelUrl.replace('{generationId}', encodeURIComponent(active.id)), {
      method: 'POST', signal: AbortSignal.timeout(3000),
    }).catch((error) => console.warn(`[dsh-voice-hub] TTS（语音合成）取消失败：${String(error)}`))
  }

  status(): TtsEngineStatus {
    return { engine: 'remote', ready: !this.lastError, loading: !!this.inFlight, error: this.lastError }
  }

  async close(): Promise<void> {
    this.interrupt()
  }
}
