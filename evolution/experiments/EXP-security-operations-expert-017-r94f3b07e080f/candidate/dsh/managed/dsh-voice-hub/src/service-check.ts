import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import type { ServiceConfig } from './service-config.ts'

export interface ConnectionResult {
  ok: boolean
  ms: number
  message: string
}

async function measure(check: () => Promise<string>): Promise<ConnectionResult> {
  const start = Date.now()
  try {
    const message = await check()
    return { ok: true, ms: Date.now() - start, message }
  }
  catch (error) {
    const message = error instanceof Error && ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
      ? '连接失败或超时，请检查地址和服务状态'
      : error instanceof Error ? error.message : '连接失败，请检查服务地址和运行状态'
    return { ok: false, ms: Date.now() - start,
      message }
  }
}

async function checkStream(url: string): Promise<string> {
  const socket = new WebSocket(url, { handshakeTimeout: 8000 })
  try {
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接超时，请检查流式识别服务')), 8000)
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve('WebSocket（实时连接）握手和 ASR 启动成功')
      }
      socket.once('open', () => socket.send(JSON.stringify({
        type: 'start', requestId: randomUUID(), sessionId: 'voice-service-check',
        turnId: randomUUID(), generationId: randomUUID().replaceAll('-', ''), traceId: randomUUID(),
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      })))
      socket.on('message', (data) => {
        let event: { type?: string; error?: { message?: string } }
        try { event = JSON.parse(String(data)) as typeof event } catch { return }
        if (event.type === 'started') finish()
        if (event.type === 'error') finish(new Error(`ASR（语音识别）启动失败：${event.error?.message ?? '服务返回错误'}`))
      })
      socket.once('error', () => finish(new Error('连接失败，请检查流式识别地址和服务状态')))
      socket.once('close', () => finish(new Error('服务在启动前关闭连接')))
    })
  } finally { socket.terminate() }
}

async function checkBatch(config: ServiceConfig): Promise<string> {
  const wav = Buffer.alloc(44 + 32000) // 1 秒、16 kHz、单声道、16 位静音
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16000, 24)
  wav.writeUInt32LE(32000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(wav.length - 44, 40)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'check.wav')
  form.append('model', config.asrModel)
  const response = await fetch(config.asrBatchUrl, {
    method: 'POST', body: form, signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`服务返回 HTTP（请求状态）${response.status}`)
  const body = await response.json() as { text?: unknown }
  if (typeof body.text !== 'string') throw new Error('服务响应缺少转写文本字段')
  return '转写接口已处理测试音频（静音结果为空属正常）'
}

async function checkTts(config: ServiceConfig): Promise<string> {
  const response = await fetch(config.ttsStreamUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好，这是语音连接测试。', generationId: randomUUID().replaceAll('-', '') }),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`服务返回 HTTP（请求状态）${response.status}`)
  const audio = await response.arrayBuffer()
  if (audio.byteLength < 2 || audio.byteLength % 2) throw new Error('语音合成返回空音频或无效音频')
  return '语音合成接口已返回音频'
}

/** 使用设置页当前输入值检查流式识别、批量识别与语音合成；取消接口只校验地址格式。 */
export async function checkServiceConnections(config: ServiceConfig): Promise<Record<'stream' | 'batch' | 'tts', ConnectionResult>> {
  const [stream, batch, tts] = await Promise.all([
    measure(() => checkStream(config.asrStreamUrl)),
    measure(() => checkBatch(config)),
    measure(() => checkTts(config)),
  ])
  return { stream, batch, tts }
}
