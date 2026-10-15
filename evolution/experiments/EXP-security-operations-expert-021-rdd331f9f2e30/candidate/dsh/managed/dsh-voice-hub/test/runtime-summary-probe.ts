import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-host-webserver'

// 仅用于隔离实例的确定性模型和测试音频，不验证真实模型或语音质量。
export const inject = ['llm', 'webServer', 'workspaceController']
const body = '我已完成第一轮分析，发现可疑登录活动，尚未确认入侵，需要继续核对日志和账户权限。'
const summary = '已发现可疑登录，尚未确认入侵，下一步核对日志与权限。'
export async function apply(ctx: Context): Promise<void> {
  await (ctx.get('workspaceController') as { create(value: { path: string }): Promise<unknown> }).create({ path: '/work/harness/workspace' })
  const calls: { main: boolean; model: string; system: unknown; messages: unknown; reasoningEffort: string | null; maxTokens: number | null; aborted: boolean; finished: boolean }[] = []
  const audio: string[] = []
  const tts: { complete: boolean; cancelled: boolean }[] = []
  const heldTts: (() => void)[] = []
  let holdTts = false
  let delayMs = 0, fail = false
  class Adapter extends LlmAdapter {
    async listModels() { return ['main', 'summary'].map(id => ({ provider: 'voice-probe', id, name: id })) }
    async resolveModel(provider: string, id: string) {
      return { provider, id, name: id, reasoning: {
        efforts: ['off', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })),
        defaultEffort: ReasoningEffortId('high'),
      } }
    }
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const main = !!options.sessionId
      const call = { main, model: options.model, system: main ? null : options.system, messages: main ? null : options.messages, reasoningEffort: options.reasoningEffort ?? null, maxTokens: options.maxTokens ?? null, aborted: false, finished: false }
      calls.push(call)
      const abort = (): void => { if (!call.finished) call.aborted = true }
      options.signal?.addEventListener('abort', abort, { once: true })
      try {
        if (!main) {
          const wait = delayMs, error = fail
          delayMs = 0; fail = false
          // 故意不响应取消，以验证插件会丢弃迟到结果。
          if (wait) await new Promise(resolve => setTimeout(resolve, wait))
          if (error) throw new Error('受控摘要失败')
        }
        const text = main ? body : summary
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        call.finished = true
        yield { type: 'finish', reason: { kind: 'stop' } }
      } finally { options.signal?.removeEventListener('abort', abort) }
    }
  }
  ctx.llm.registerAdapter(['voice-probe'], new Adapter())
  ctx.webServer.register({ kind: 'exact', path: '/voice-probe/results', handler: (_req, res) => {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ calls, audio, tts }))
  } })
  ctx.webServer.register({ kind: 'exact', path: '/voice-probe/unload', handler: async (req, res) => {
    if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
    const fibers = [...ctx.registry.values()].filter(runtime => runtime.name === 'voice-mode').flatMap(runtime => [...runtime.fibers])
    if (fibers.length !== 1) { res.statusCode = 409; res.end('expected one isolated voice plugin'); return }
    await fibers[0].dispose()
    res.end('{}')
  } })
  ctx.webServer.register({ kind: 'exact', path: '/voice-probe/control', handler: async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const value = JSON.parse(Buffer.concat(chunks).toString()) as { delayMs?: number; fail?: boolean; holdTts?: boolean }
    if (!Number.isInteger(value.delayMs ?? 0) || (value.delayMs ?? 0) < 0 || (value.delayMs ?? 0) > 5000 || typeof (value.fail ?? false) !== 'boolean' || typeof (value.holdTts ?? false) !== 'boolean') {
      res.statusCode = 400; res.end('invalid control'); return
    }
    delayMs = value.delayMs ?? 0; fail = value.fail ?? false; holdTts = value.holdTts ?? false; res.end('{}')
  } })
  ctx.webServer.register({ kind: 'exact', path: '/voice-probe/tts', handler: async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    const value = JSON.parse(Buffer.concat(chunks).toString()) as { text: string }
    audio.push(value.text)
    const pcm = Buffer.alloc(24000)
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(1000 * Math.sin(i * 2 * Math.PI * 440 / 24000)), i * 2)
    const status = { complete: false, cancelled: false }
    tts.push(status)
    res.on('close', () => { if (!status.complete) status.cancelled = true })
    res.setHeader('content-type', 'application/octet-stream')
    if (holdTts) {
      holdTts = false
      res.write(pcm.subarray(0, 4800))
      heldTts.push(() => { status.complete = true; res.end(pcm.subarray(4800)) })
    } else { status.complete = true; res.end(pcm) }
  } })
  ctx.webServer.register({ kind: 'exact', path: '/voice-probe/tts-release', handler: (_req, res) => {
    for (const release of heldTts.splice(0)) release()
    res.end('{}')
  } })
  ctx.webServer.register({ kind: 'prefix', path: '/voice-probe/cancel/', handler: (_req, res) => { res.end('{}') } })
}
