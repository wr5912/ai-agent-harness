import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocketServer } from 'ws'
import { createRemoteAsrRuntime } from '../src/asr-remote.ts'
import { checkServiceConnections } from '../src/service-check.ts'
import { RemoteTtsEngine } from '../src/tts-remote.ts'

const calls = []
let slowStarted
let cancelled
const slowRequest = new Promise((resolve) => { slowStarted = resolve })
const cancelRequest = new Promise((resolve) => { cancelled = resolve })
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  calls.push(`${request.method} ${url.pathname}${url.search}`)
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (url.pathname === '/voice/custom/transcribe') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ text: '自定义识别' }))
    return
  }
  if (url.pathname === '/voice/custom/speak') {
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (body.text === 'slow') {
      slowStarted(body.generationId)
      setTimeout(() => { if (!response.writableEnded) response.end() }, 3000).unref()
      return
    }
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(Buffer.alloc(4))
    return
  }
  if (url.pathname.startsWith('/voice/custom/stop/')) {
    cancelled(url.pathname.slice('/voice/custom/stop/'.length))
    response.writeHead(200).end()
    return
  }
  response.writeHead(404).end()
})
const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url, 'http://127.0.0.1').pathname !== '/voice/custom/asr') {
    socket.destroy()
    return
  }
  sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client))
})
sockets.on('connection', (client) => {
  client.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    if (message.type === 'start') client.send(JSON.stringify({ type: 'started' }))
  })
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')
const port = server.address().port
const base = `http://127.0.0.1:${port}`
const batchUrl = `${base}/voice/custom/transcribe?source=plugin`
const ttsStreamUrl = `${base}/voice/custom/speak?mode=stream`
const ttsCancelUrl = `${base}/voice/custom/stop/{generationId}?source=plugin`
try {
  const checked = await checkServiceConnections({
    asrStreamUrl: `ws://127.0.0.1:${port}/voice/custom/asr`,
    asrBatchUrl: batchUrl,
    asrModel: 'test-model',
    ttsStreamUrl,
    ttsCancelUrl,
    wakeWord: '', alwaysListen: false, sendCommands: [], approvalVoice: true,
  })
  assert.ok(Object.values(checked).every((item) => item.ok), JSON.stringify(checked))

  const asr = createRemoteAsrRuntime({
    streamUrl: () => 'ws://127.0.0.1:1/unavailable',
    batchUrl: () => batchUrl,
    model: () => 'test-model',
    broadcast: () => {},
  })
  try {
    const result = await asr.feed('custom-endpoints', new Float32Array(3200).fill(0.2), true, 0, 1)
    assert.equal(result.text, '自定义识别')
  } finally { asr.dispose() }

  const tts = new RemoteTtsEngine(() => ttsStreamUrl, () => ttsCancelUrl)
  try {
    assert.equal((await tts.synthesize('normal')).toString('ascii', 0, 4), 'RIFF')
    const slow = tts.synthesize('slow').catch((error) => error)
    const generationId = await slowRequest
    tts.interrupt()
    assert.ok(await slow instanceof Error)
    assert.equal(await cancelRequest, generationId)
  } finally { await tts.close() }

  assert.ok(calls.includes('POST /voice/custom/transcribe?source=plugin'))
  assert.ok(calls.includes('POST /voice/custom/speak?mode=stream'))
  assert.ok(calls.some((call) => call.startsWith('POST /voice/custom/stop/') && call.endsWith('?source=plugin')))
  console.log('四个完整接口地址：自定义路径、批量接管、合成与取消通过')
} finally {
  for (const client of sockets.clients) client.terminate()
  sockets.close()
  server.closeAllConnections()
  server.close()
}
