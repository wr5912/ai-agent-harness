import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { AsrRuntime, ModelsStatus } from './asr-host.ts'

type Segment = {
  epoch: number
  fed: number
  pcm: Buffer[]
  socket: WebSocket | null
  opening: Promise<void> | null
  latest: string
  final: Promise<string> | null
  resolveFinal: ((text: string) => void) | null
  rejectFinal: ((error: Error) => void) | null
  generationId: string
  error: string | null
}

export interface RemoteAsrOptions {
  streamUrl: () => string
  batchUrl: () => string
  model: () => string
  broadcast: (event: string, payload: unknown) => void
}

export function pcm16(samples: Float32Array): Buffer {
  const out = Buffer.allocUnsafe(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0))
    out.writeInt16LE(Math.round(sample < 0 ? sample * 32768 : sample * 32767), i * 2)
  }
  return out
}

export function wav16(pcm: Buffer): Buffer {
  const wav = Buffer.allocUnsafe(44 + pcm.length)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + pcm.length, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcm.length, 40)
  pcm.copy(wav, 44)
  return wav
}

function speechIn(samples: Float32Array): boolean {
  if (!samples.length) return false
  let power = 0
  for (const s of samples) power += s * s
  return Math.sqrt(power / samples.length) > 0.014
}

export function createRemoteAsrRuntime(options: RemoteAsrOptions): AsrRuntime {
  const segments = new Map<string, Segment>()
  let lastError: string | null = null

  const close = (s: Segment): void => {
    if (s.socket?.readyState === WebSocket.OPEN) {
      try { s.socket.send(JSON.stringify({ type: 'cancel', generationId: s.generationId })) } catch { /* closing */ }
    }
    s.socket?.close()
    s.socket = null
    s.rejectFinal?.(new Error('ASR（语音识别）片段已取消'))
    s.resolveFinal = null
    s.rejectFinal = null
  }

  const open = async (s: Segment, sessionId: string): Promise<void> => {
    const ws = new WebSocket(options.streamUrl())
    s.socket = ws
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ASR（语音识别）WebSocket（实时连接）超时')), 5000)
      ws.onopen = () => ws.send(JSON.stringify({
        type: 'start', requestId: randomUUID(), sessionId, turnId: randomUUID(),
        generationId: s.generationId, traceId: randomUUID(),
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      }))
      ws.onmessage = (message) => {
        let event: Record<string, unknown>
        try { event = JSON.parse(String(message.data)) as Record<string, unknown> }
        catch { return }
        if (event.type === 'started') {
          clearTimeout(timer)
          resolve()
          return
        }
        if (event.type === 'error') {
          const detail = event.error as { message?: string; code?: string } | undefined
          const error = new Error(detail?.message ?? detail?.code ?? 'ASR（语音识别）服务失败')
          s.error = error.message
          s.rejectFinal?.(error)
          s.resolveFinal = null
          s.rejectFinal = null
          clearTimeout(timer)
          reject(error)
          return
        }
        if (event.generationId !== s.generationId) return
        if (event.type === 'asr.partial') s.latest = String(event.text ?? '')
        if (event.type === 'asr.final') {
          s.latest = String(event.text ?? '').trim()
          s.resolveFinal?.(s.latest)
          s.resolveFinal = null
          s.rejectFinal = null
        }
      }
      ws.onerror = () => {
        const error = new Error('ASR（语音识别）WebSocket（实时连接）不可用')
        s.error = error.message
        s.rejectFinal?.(error)
        clearTimeout(timer)
        reject(error)
      }
      ws.onclose = () => {
        if (s.resolveFinal) s.rejectFinal?.(new Error('ASR（语音识别）WebSocket（实时连接）在定稿前关闭'))
        s.resolveFinal = null
        s.rejectFinal = null
      }
    })
  }

  const batch = async (s: Segment): Promise<string> => {
    const pcm = Buffer.concat(s.pcm)
    if (!pcm.length) return ''
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav16(pcm))], { type: 'audio/wav' }), 'speech.wav')
    form.append('model', options.model())
    const res = await fetch(options.batchUrl(), {
      method: 'POST', body: form, signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`批量 ASR（语音识别）HTTP（请求状态）${res.status}`)
    const data = await res.json() as { text?: unknown }
    return String(data.text ?? '').trim()
  }

  const status = (): ModelsStatus => ({
    asr: { repo: options.streamUrl(), ready: !lastError, files: [], failLatchMs: 0 },
    vad: { repo: 'browser/energy', ready: true, size: 0, failLatchMs: 0 },
    sense: { repo: options.batchUrl(), ready: !lastError, size: 0, failLatchMs: 0, enabled: true },
    progress: null,
  })

  return {
    async feed(sessionId, samples, final, offset = 0, epoch = 0, manualPressed = false) {
      let s = segments.get(sessionId)
      if (s && s.epoch !== epoch) {
        close(s)
        segments.delete(sessionId)
        s = undefined
      }
      if (!s) {
        s = { epoch, fed: 0, pcm: [], socket: null, opening: null, latest: '', final: null,
          resolveFinal: null, rejectFinal: null, generationId: randomUUID().replaceAll('-', ''), error: null }
        segments.set(sessionId, s)
      }
      const fresh = samples.subarray(Math.max(0, s.fed - offset))
      if (fresh.length) {
        const bytes = pcm16(fresh)
        s.pcm.push(bytes)
        s.fed = Math.max(s.fed, offset + samples.length)
      }
      const isSpeech = speechIn(fresh)
      if (!s.opening && !s.error) s.opening = open(s, sessionId)
      if (s.opening && !s.error) {
        try {
          await s.opening
          const ws = s.socket
          if (ws?.readyState === WebSocket.OPEN && fresh.length) {
            const bytes = s.pcm[s.pcm.length - 1]!
            for (let i = 0; i < bytes.length; i += 32000) {
              const chunk = bytes.subarray(i, i + 32000)
              ws.send(JSON.stringify({ type: 'audio.append', generationId: s.generationId, byteLength: chunk.length }))
              ws.send(chunk)
            }
          }
        } catch (error) {
          s.error = error instanceof Error ? error.message : String(error)
          lastError = s.error
          options.broadcast('asr-service-warning', { message: s.error })
        }
      }
      if (!final) return { text: s.latest, isSpeech }
      let text = ''
      if (!s.error && s.socket?.readyState === WebSocket.OPEN) {
        try {
          s.final = new Promise<string>((resolve, reject) => { s!.resolveFinal = resolve; s!.rejectFinal = reject })
          s.socket.send(JSON.stringify({ type: 'commit', generationId: s.generationId }))
          text = await Promise.race([
            s.final,
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error('ASR（语音识别）定稿超时')), 8000)),
          ])
        } catch (error) {
          s.error = error instanceof Error ? error.message : String(error)
        }
      }
      if (!text) {
        try {
          text = await batch(s)
          if (lastError) options.broadcast('asr-service-restored', { sessionId })
          lastError = null
        }
        catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          options.broadcast('asr-service-error', { message: lastError })
          close(s)
          segments.delete(sessionId)
          throw error
        }
      }
      close(s)
      segments.delete(sessionId)
      if (lastError) options.broadcast('asr-service-restored', { sessionId })
      lastError = null
      return { text, isSpeech }
    },
    async detect(_sessionId, samples) { return { isSpeech: speechIn(samples) } },
    reset(sessionId) { const s = segments.get(sessionId); if (s) close(s); segments.delete(sessionId) },
    dispose() { for (const s of segments.values()) close(s); segments.clear() },
    modelStatus: status,
    async retryModel() { lastError = null; return true },
    warmup() {},
    async warmupSense() {},
    markStale() {},
  }
}
