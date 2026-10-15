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

/** 流式与整句接口共用同一个远程请求实现。 */
export class RemoteTtsEngine implements TtsEngine {
  readonly mime = 'audio/wav'
  private readonly active = new Map<string, AbortController>()
  private lastError: string | undefined

  private readonly streamUrl: () => string
  private readonly cancelUrl: () => string

  constructor(streamUrl: () => string, cancelUrl: () => string) {
    this.streamUrl = streamUrl
    this.cancelUrl = cancelUrl
  }

  updateVoice(): void {
    // talk-sdk 当前没有音色和语速入参。
  }

  async synthesize(text: string, options: { signal?: AbortSignal } = {}): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of this.synthesizeStream(text, options)) chunks.push(chunk.audio)
    return pcm24ToWav(Buffer.concat(chunks))
  }

  async *synthesizeStream(text: string, options: { signal?: AbortSignal } = {}): AsyncIterable<import('./tts-queue.ts').TtsPcmChunk> {
    const id = randomUUID().replaceAll('-', '')
    const abort = new AbortController()
    const cancel = (): void => abort.abort(options.signal?.reason)
    const cancelRemote = (): void => {
      const url = this.cancelUrl()
      if (url) void fetch(url.replace('{generationId}', encodeURIComponent(id)), {
        method: 'POST', signal: AbortSignal.timeout(3000),
      }).catch(() => {})
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    abort.signal.addEventListener('abort', cancelRemote, { once: true })
    if (options.signal?.aborted) cancel()
    this.active.set(id, abort)
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort.abort(new Error('语音合成首包超时')), 10000)
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let complete = false
    let received = 0
    let carry = Buffer.alloc(0)
    try {
      const res = await fetch(this.streamUrl(), {
        // PCM 流不做 HTTP 压缩，避免 gzip 等中间层缓存首段直到整句结束。
        method: 'POST', headers: { 'content-type': 'application/json', 'accept-encoding': 'identity' },
        body: JSON.stringify({ text, generationId: id }), signal: abort.signal,
      })
      if (!res.ok || !res.body) throw new Error(`语音合成 HTTP ${res.status}`)
      reader = res.body.getReader()
      while (true) {
        const result = await reader.read()
        abort.signal.throwIfAborted()
        if (result.done) break
        if (!result.value.length) continue
        clearTimeout(timer)
        const pcm = Buffer.concat([carry, Buffer.from(result.value)])
        const aligned = pcm.length - pcm.length % 2
        carry = Buffer.from(pcm.subarray(aligned))
        // 每帧至多 100ms，已有对齐采样立即转发，不等整句或凑满一帧。
        for (let offset = 0; offset < aligned; offset += 4800) {
          const audio = Buffer.from(pcm.subarray(offset, Math.min(offset + 4800, aligned)))
          received += audio.length
          yield { audio, encoding: 'pcm-s16le', sampleRate: 24000 }
        }
        timer = setTimeout(() => abort.abort(new Error('语音合成数据流超时')), received ? 5000 : 10000)
      }
      if (!received || carry.length) throw new Error('语音合成返回空音频或不完整的 PCM 采样')
      complete = true
      this.lastError = undefined
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : '语音合成失败'
      throw error
    } finally {
      clearTimeout(timer)
      if (!complete && !abort.signal.aborted) abort.abort()
      options.signal?.removeEventListener('abort', cancel)
      abort.signal.removeEventListener('abort', cancelRemote)
      void reader?.cancel().catch(() => {})
      this.active.delete(id)
    }
  }

  interrupt(): void {
    for (const abort of this.active.values()) abort.abort()
  }

  status(): TtsEngineStatus {
    return { engine: 'remote', ready: !this.lastError, loading: !!this.active.size, error: this.lastError }
  }

  async close(): Promise<void> {
    this.interrupt()
  }
}
