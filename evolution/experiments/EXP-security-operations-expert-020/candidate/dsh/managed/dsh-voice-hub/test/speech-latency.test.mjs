import assert from 'node:assert/strict'
import { test, mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createGzip } from 'node:zlib'
import { build, transform } from 'esbuild'
import { RemoteTtsEngine } from '../src/tts-remote.ts'

const compiled = async (file, stub = false) => {
  const result = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: stub ? [{ name: 'edge-boundary', setup(b) { b.onLoad({ filter: /msedge-tts-compat\.ts$/ }, () => ({ contents: 'export class MsEdgeTTS {}\nexport const OUTPUT_FORMAT={}', loader: 'js' })) } }] : [] })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const { SpeechSummaryQueue, SUMMARY_DEFAULTS, summaryReasoning } = await compiled('src/speech-summary.ts')
const { TtsQueue } = await compiled('src/tts-queue.ts', true)
const job = (id) => ({ sessionId: 's', sourceMessageId: id, turn: 1, step: 1, targetTabId: 'tab', text: '尚未确认入侵，不得声称已经恢复。', provider: 'p', model: 'm', settings: SUMMARY_DEFAULTS })
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const waitFor = async (check) => { const end = Date.now() + 2000; while (!check()) { assert.ok(Date.now() < end, '行为等待超时'); await new Promise(r => setTimeout(r, 5)) } }
const model = (ids, cap) => ({ provider: 'p', id: 'm', name: 'model', defaultMaxTokens: cap, ...(ids ? { reasoning: { efforts: ids.map(id => ({ id, name: id })) } } : {}) })

test('摘要按公开能力选择 off/none 或最低档，未知能力不猜参数', async () => {
  assert.equal(summaryReasoning(model(['low', 'off'])).reasoningEffort, 'off')
  assert.equal(summaryReasoning(model(['none', 'high'])).reasoningMode, 'off-requested')
  assert.equal(summaryReasoning(model(['vendor-minimum', 'vendor-maximum'])).reasoningEffort, 'vendor-minimum')
  assert.deepEqual(summaryReasoning(model()), { reasoningMode: 'unknown' })
  const requests = [], emitted = []
  const queue = new SpeechSummaryQueue(async function* (options) {
    requests.push(options)
    yield { type: 'text-delta', text: '尚未确认入侵，恢复状态待核实。' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }, e => emitted.push(e), () => {}, () => assert.fail('摘要失败'), async () => model(['off', 'high'], 96))
  queue.enqueue(job('1'))
  await waitFor(() => emitted.length)
  assert.equal(requests[0].reasoningEffort, 'off')
  assert.equal(requests[0].maxTokens, 96)
  assert.equal(requests[0].sessionId, undefined)
  assert.equal(requests[0].tools, undefined)
  assert.equal(emitted[0].reasoningMode, 'off-requested')
  assert.ok(emitted[0].queueWaitMs >= 0)
  queue.dispose()
})

test('成功 finish 后发布摘要，慢连接清理不阻塞发布和下一项', async () => {
  let release, cleaning = false
  const emitted = []
  const queue = new SpeechSummaryQueue(async function* () {
    try {
      yield { type: 'text-delta', text: '风险尚未排除。' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } finally { cleaning = true; await new Promise(r => { release = r }) }
  }, e => emitted.push(e), () => {}, () => assert.fail())
  queue.enqueue(job('1'))
  queue.enqueue(job('2'))
  await waitFor(() => emitted.length === 2)
  assert.ok(cleaning)
  release()
  queue.dispose()
})

test('包含排队的独立超时释放队列，上游忽略取消也不会发布迟到摘要', async () => {
  let now = 0, release
  const requests = [], emitted = [], failures = []
  mock.timers.enable({ apis: ['setTimeout'] })
  mock.method(performance, 'now', () => now)
  const queue = new SpeechSummaryQueue(async function* (options) {
    requests.push(options)
    if (requests.length === 1) await new Promise(r => { release = r })
    yield { type: 'text-delta', text: '正常摘要' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }, e => emitted.push(e), () => {}, (...args) => failures.push(args))
  try {
    queue.enqueue(job('1')); await tick()
    now = 10000; queue.enqueue(job('2'))
    now = 15000; mock.timers.tick(15000); await tick()
    assert.equal(requests[0].signal.aborted, true)
    assert.equal(failures.length, 1)
    assert.deepEqual(emitted.map(x => x.sourceMessageId), ['2'])
    release(); await tick()
    assert.deepEqual(emitted.map(x => x.sourceMessageId), ['2'])
    assert.ok(emitted[0].queueWaitMs >= 5000)
  } finally { queue.dispose(); mock.restoreAll(); mock.timers.reset() }
})

test('HTTP 压缩不缓存 PCM 首包，响应结束前转发且半采样正确拼接', async () => {
  let finishResponse
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const compressed = req.headers['accept-encoding'] !== 'identity'
      res.writeHead(200, { 'content-type': 'application/octet-stream', ...(compressed ? { 'content-encoding': 'gzip' } : {}) })
      const output = compressed ? createGzip() : res
      if (compressed) output.pipe(res)
      output.write(Buffer.from([1, 0, 2]))
      finishResponse = () => output.end(Buffer.from([0, 3, 0]))
    })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const engine = new RemoteTtsEngine(() => `http://127.0.0.1:${server.address().port}`, () => '')
  const queue = new TtsQueue({ engine })
  const frames = []; queue.subscribe(frame => frames.push(frame))
  try {
    queue.enqueue('s', '未完成', undefined, 'source')
    await waitFor(() => frames.length)
    assert.equal(frames[0].final, false)
    assert.equal(frames[0].encoding, 'pcm-s16le')
    assert.equal(frames[0].sourceMessageId, 'source')
    assert.ok(frames[0].epoch > 0)
    assert.equal(frames.some(frame => frame.final), false)
    finishResponse()
    await waitFor(() => frames.some(frame => frame.final))
    assert.deepEqual(Buffer.concat(frames.filter(f => !f.final).map(f => Buffer.from(f.audio, 'base64'))), Buffer.from([1, 0, 2, 0, 3, 0]))
  } finally { await queue.close(); server.closeAllConnections(); server.close() }
})

test('流中失败不重播，取消只终止目标会话，后续请求正常推进', async () => {
  const calls = [], frames = [], skipped = [], gates = new Map()
  const engine = { mime: 'audio/wav', updateVoice() {}, async close() {}, async synthesize() { assert.fail('流式引擎不应走整句路径') },
    async *synthesizeStream(text, options) {
      calls.push({ text, signal: options.signal })
      yield { audio: Buffer.from([1, 0]), encoding: 'pcm-s16le', sampleRate: 24000 }
      if (text === 'broken') throw new Error('stream failed')
      if (text.startsWith('hold')) await new Promise(resolve => gates.set(text, resolve))
    } }
  const queue = new TtsQueue({ engine, onSkip: (_, text) => skipped.push(text) })
  queue.subscribe(f => frames.push(f))
  queue.enqueue('s', 'broken', undefined, 'm1')
  queue.enqueue('s', 'healthy', undefined, 'm2')
  await waitFor(() => frames.some(f => f.final && f.text === 'healthy'))
  assert.equal(calls.filter(c => c.text === 'broken').length, 1)
  assert.equal(frames.find(f => f.final && f.text === 'broken').failed, true)
  assert.deepEqual(skipped, ['broken'])
  queue.enqueue('s1', 'hold-one', undefined, 'm3')
  queue.enqueue('s2', 'hold-two', undefined, 'm4')
  await waitFor(() => gates.size === 2)
  const epoch = queue.cancel('s1')
  assert.equal(calls.find(c => c.text === 'hold-one').signal.aborted, true)
  assert.equal(calls.find(c => c.text === 'hold-two').signal.aborted, false)
  assert.ok(epoch > frames.find(f => f.text === 'hold-one').epoch)
  gates.get('hold-one')(); gates.get('hold-two')()
  await waitFor(() => frames.some(f => f.final && f.text === 'hold-two'))
  assert.ok(!frames.some(f => f.final && f.text === 'hold-one'))
  await queue.close()
})

const client = readFileSync('src/client.tsx', 'utf8')
const engineCode = client.slice(client.indexOf('function createAudioEngine('), client.indexOf('\nfunction createVoiceBus('))
const transformed = await transform("const fixtureRecorder={mark(){}};\n" + engineCode + '\nexport {createAudioEngine}', { loader: 'ts', format: 'esm' })
const { createAudioEngine } = await import('data:text/javascript;base64,' + Buffer.from(transformed.code).toString('base64'))

test('浏览器 PCM 无需整句解码即可调度，取消流清理在途源和计时器', async () => {
  const starts = [], buffers = [], stopped = [], played = []
  class AudioContext {
    state = 'running'; outputLatency = 0
    get currentTime() { return performance.now() / 1000 }
    destination = {}
    resume() { return Promise.resolve() }
    createGain() { return { gain: { value: 1 }, connect() {} } }
    createBuffer(_, size, rate) { const pcm = new Float32Array(size); const buf = { duration: size / rate, sampleRate: rate, getChannelData: () => pcm }; buffers.push(buf); return buf }
    decodeAudioData() { assert.fail('PCM 不得等待完整音频解码') }
    createBufferSource() { return { connect() {}, start(at) { starts.push({ at, source: this }) }, stop() { stopped.push(this) } } }
  }
  class Audio { paused = true; pause() {} }
  const oldAudio = globalThis.Audio; globalThis.Audio = Audio
  const oldWindow = globalThis.window; globalThis.window = { AudioContext }
  const engine = createAudioEngine(() => {}, frame => played.push(frame))
  try {
    const pcm = new Uint8Array(4800); new DataView(pcm.buffer).setInt16(0, 16384, true)
    engine.push({ sessionId: 's', seq: 1, text: '尚未确认', audio: pcm, encoding: 'pcm-s16le', sampleRate: 24000 })
    assert.equal(starts.length, 1, 'final 到达前必须已调度音频')
    assert.equal(buffers[0].getChannelData(0)[0], 0.5)
    await new Promise(r => setTimeout(r, 35))
    assert.equal(played.length, 1)
    engine.push({ sessionId: 's', seq: 1, text: '尚未确认', audio: pcm, encoding: 'pcm-s16le', sampleRate: 24000 })
    assert.equal(starts.length, 2)
    assert.ok(starts[1].at >= starts[0].at + 0.099)
    engine.finish('s', 1, true)
    assert.equal(stopped.length, 2)
  } finally { engine.skip(); globalThis.window = oldWindow; globalThis.Audio = oldAudio; mock.restoreAll() }
})

test('PCM 流按整句保持播放顺序，不同会话的分块不会交替拼成声音', async () => {
  const starts = []
  class AudioContext {
    state='running'; outputLatency=0; destination={}
    get currentTime(){return performance.now()/1000}
    resume(){return Promise.resolve()}
    createGain(){return {gain:{value:1},connect(){}}}
    createBuffer(_,size,rate){return {duration:size/rate,sampleRate:rate,getChannelData:()=>new Float32Array(size)}}
    createBufferSource(){return {connect(){},start(at){starts.push({at,source:this})},stop(){}}}
  }
  const previousAudio=globalThis.Audio, previousWindow=globalThis.window
  globalThis.Audio=class {paused=true;pause(){}}; globalThis.window={AudioContext}
  const engine=createAudioEngine(()=>{})
  const frame=(sessionId,seq)=>({sessionId,seq,text:'测试',audio:new Uint8Array(4800),encoding:'pcm-s16le',sampleRate:24000})
  try {
    engine.push(frame('s1',1)); await tick()
    engine.push(frame('s2',1)); await tick()
    assert.equal(starts.length,1,'第二条未完成的流不得插入第一条流中间')
    engine.push(frame('s1',1)); await tick()
    assert.equal(starts.length,2)
    engine.finish('s1',1);await tick();assert.equal(starts.length,3)
    assert.ok(starts[2].at>=starts[1].at+0.099)
    engine.finish('s2',1)
  } finally {engine.skip();globalThis.Audio=previousAudio;globalThis.window=previousWindow}
})

test('无 Web Audio 时 PCM 收齐后生成合法 WAV，播放未结束不提前报告完成', async () => {
  const audios=[], blobs=[], done=[]
  class Audio {paused=true;constructor(){audios.push(this)}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}}
  const previousAudio=globalThis.Audio, previousWindow=globalThis.window
  globalThis.Audio=Audio;globalThis.window={}
  mock.method(URL,'createObjectURL',blob=>{blobs.push(blob);return 'blob:test'})
  mock.method(URL,'revokeObjectURL',()=>{})
  const engine=createAudioEngine(()=>{},undefined,undefined,()=>done.push(true))
  try {
    engine.push({sessionId:'s',seq:1,text:'摘要',audio:new Uint8Array([1,0,2,0]),encoding:'pcm-s16le',sampleRate:24000})
    assert.equal(blobs.length,0)
    engine.finish('s',1)
    assert.equal(blobs.length,1)
    const wav=Buffer.from(await blobs[0].arrayBuffer())
    assert.equal(wav.toString('ascii',0,4),'RIFF')
    assert.equal(wav.readUInt32LE(24),24000)
    assert.deepEqual(wav.subarray(44),Buffer.from([1,0,2,0]))
    assert.equal(done.length,0)
    engine.push({sessionId:'next',seq:1,text:'后续摘要',audio:new Uint8Array([1,0]),encoding:'pcm-s16le',sampleRate:24000})
    audios[0].paused=true;audios[0].onended();assert.equal(done.length,0,'下一条 PCM 流尚未结束时不能报告全队列播完')
    engine.finish('next',1,true);assert.equal(done.length,1)
  } finally {engine.skip();globalThis.Audio=previousAudio;globalThis.window=previousWindow;mock.restoreAll()}
})

test('服务仍返回推理时记录实际观察，推理文本不进入摘要或语音', async () => {
  const events=[], spoken=[]
  const queue=new SpeechSummaryQueue(async function* () {
    yield {type:'reasoning-delta',text:'这段推理不应被播报'}
    yield {type:'text-delta',text:'尚未确认，需继续核查。'}
    yield {type:'usage',usage:{inputTokens:10,outputTokens:12,reasoningTokens:5}}
    yield {type:'finish',reason:{kind:'stop'}}
  },event=>events.push(event),(_,text)=>spoken.push(text),()=>assert.fail(),async()=>model(['off','high']))
  queue.enqueue(job('observed'))
  await waitFor(()=>events.length)
  assert.equal(events[0].reasoningMode,'off-requested')
  assert.equal(events[0].reasoningObserved,true)
  assert.equal(events[0].reasoningTokens,5)
  assert.deepEqual(spoken,['尚未确认，需继续核查。'])
  queue.dispose()
})
