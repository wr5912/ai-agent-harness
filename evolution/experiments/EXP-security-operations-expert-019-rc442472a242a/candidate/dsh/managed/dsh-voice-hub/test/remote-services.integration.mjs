/** 真实服务闭环：TTS 产出音频 → 16 kHz PCM → 流式 ASR → 定稿文字。 */
import assert from 'node:assert/strict'
import { RemoteTtsEngine } from '../src/tts-remote.ts'
import { createRemoteAsrRuntime } from '../src/asr-remote.ts'

const ttsUrl = process.env.DSHVM_TTS_STREAM_URL ?? 'http://127.0.0.1:8003/tts/stream/cancellable'
const asrStreamUrl = process.env.DSHVM_ASR_STREAM_URL ?? 'ws://127.0.0.1:8012/v1/asr/stream'
const asrBatchUrl = process.env.DSHVM_ASR_BATCH_URL ?? 'http://127.0.0.1:8002/v1/audio/transcriptions'
const phrase = '你好，这是语音测试。'
const engine = new RemoteTtsEngine(() => ttsUrl, () => '')
const wav = await engine.synthesize(phrase)
assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
assert.equal(wav.readUInt32LE(24), 24000)
assert.ok(wav.length > 2044, 'TTS audio is unexpectedly short')

const pcm = wav.subarray(44)
const source = new Float32Array(pcm.length / 2)
for (let i = 0; i < source.length; i++) source[i] = pcm.readInt16LE(i * 2) / 32768
const input = new Float32Array(Math.floor(source.length * 2 / 3))
for (let i = 0; i < input.length; i++) {
  const at = i * 1.5
  const a = Math.floor(at)
  input[i] = source[a] * (1 - (at - a)) + (source[a + 1] ?? source[a]) * (at - a)
}

const events = []
const asr = createRemoteAsrRuntime({
  streamUrl: () => asrStreamUrl,
  batchUrl: () => asrBatchUrl,
  model: () => 'Qwen3-ASR',
  broadcast: (event, data) => events.push({ event, data }),
})
let partial = ''
let firstPartialMs = null
const startedAt = Date.now()
for (let offset = 0; offset < input.length; offset += 3200) {
  const result = await asr.feed('integration-session', input.subarray(offset, offset + 3200), false, offset, 1)
  if (result.text) {
    partial = result.text
    firstPartialMs ??= Date.now() - startedAt
  }
  // 按真实语音速率送入，否则测试会在模型产出第一个 partial 前就提交整段。
  await new Promise(resolve => setTimeout(resolve, 200))
}
const commitAt = Date.now()
const final = await asr.feed('integration-session', new Float32Array(0), true, input.length, 1)
assert.ok(partial.length > 0, '流式 ASR 未在说话期间返回实时文字')
assert.ok(final.text.length > 0, `ASR returned no text; events=${JSON.stringify(events)}`)
console.log(JSON.stringify({ ttsBytes: wav.length, partial, firstPartialMs, finalAfterCommitMs: Date.now() - commitAt, final: final.text, events }, null, 2))
asr.dispose()
await engine.close()
