import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { createPlatformUpdates, PLATFORM_DOMAINS } from '../src/realtime/client.ts'
import { createPlatformEvents } from '../src/realtime/index.ts'

const encoder = new TextEncoder()
const frame = (revision, domains, ids = []) => `data: ${JSON.stringify({ revision, domains, ids })}\n\n`

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await delay(1)
  }
  assert.fail('事件流未完成预期的状态转换')
}

function connection() {
  const requests = [], streams = []
  let generationListener, generationDisposals = 0
  const updates = createPlatformUpdates({ generation: { subscribe(listener) {
    generationListener = listener
    return () => { generationDisposals++; generationListener = undefined }
  } } }, { retryMs: 0, fetch: async (url, init) => {
    assert.equal(url, 'api/harness-platform/events')
    assert.equal(init.credentials, 'same-origin')
    assert.equal(init.method ?? 'GET', 'GET')
    assert.equal(init.body, undefined)
    let controller
    const body = new ReadableStream({ start(value) { controller = value } })
    // 与原生 fetch 一样，取消请求会打断挂起的 body.read。
    init.signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
    requests.push({ url, signal: init.signal })
    streams.push({ body, send: text => controller.enqueue(encoder.encode(text)), close: () => controller.close() })
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
  } })
  return { updates, requests, streams, generation: () => generationListener?.(), disposals: () => generationDisposals }
}

test('事件流跨 chunk 解析 CRLF 帧，忽略未知领域、非法标识和无效 JSON', async t => {
  const fixture = connection()
  const seen = []
  fixture.updates.subscribe(() => seen.push(fixture.updates.getSnapshot()))
  t.after(() => fixture.updates.stop())
  fixture.updates.start()
  await until(() => fixture.streams[0]?.body.locked)
  const stream = fixture.streams[0]
  const first = frame(1, ['agents'], ['EXP-mock-001']).replaceAll('\n', '\r\n')
  const boundary = first.indexOf('\r\n') + 1
  stream.send(first.slice(0, 13))
  stream.send(first.slice(13, boundary))
  assert.equal(fixture.updates.getSnapshot().connected, false)
  stream.send(first.slice(boundary))
  await until(() => fixture.updates.getSnapshot().connected)
  assert.deepEqual(seen[0].domains, PLATFORM_DOMAINS)
  assert.deepEqual(seen[0].ids, ['EXP-mock-001'])
  stream.send(': keepalive\n\n' + frame(2, ['unknown-domain'])
    + 'data: invalid-json\n\n' + frame(3, ['mcp'], ['invalid id'])
    + frame(4, ['mcp'], ['mock-soc-readonly']))
  await until(() => seen.length === 2)
  assert.deepEqual(seen[1].domains, ['mcp'])
  assert.deepEqual(seen[1].ids, ['mock-soc-readonly'])
  assert.equal(fixture.requests.length, 1)
})

test('事件流重连使所有页面失效，stop 中断读取、释放锁和订阅且不重试业务', async () => {
  const fixture = connection()
  const { updates, streams, requests } = fixture
  try {
    updates.start()
    await until(() => streams[0]?.body.locked)
    streams[0].send(frame(1, ['agents']))
    await until(() => updates.getSnapshot().connected)
    streams[0].send(frame(2, ['mcp']))
    await until(() => updates.getSnapshot().domains.length === 1)
    streams[0].close()
    await until(() => streams[1]?.body.locked)
    assert.equal(streams[0].body.locked, false)
    assert.equal(updates.getSnapshot().connected, false)
    streams[1].send(frame(3, ['instances'], ['mock-instance']))
    await until(() => updates.getSnapshot().connected)
    assert.deepEqual(updates.getSnapshot().domains, PLATFORM_DOMAINS)
    assert.deepEqual(updates.getSnapshot().ids, ['mock-instance'])
    fixture.generation()
    assert.deepEqual(updates.getSnapshot().domains, PLATFORM_DOMAINS)
    assert.equal(requests.length, 2)
    updates.stop()
    await until(() => !streams[1].body.locked)
    assert.equal(requests[1].signal.aborted, true)
    assert.equal(fixture.disposals(), 1)
    assert.equal(updates.getSnapshot().connected, false)
    await delay(5)
    assert.equal(requests.length, 2)
  } finally { updates.stop() }
})

test('服务端通知仅含领域与稳定 ID，请求取消后释放 SSE 监听', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const events = createPlatformEvents('/tmp/platform-events-readonly-test', { docker: false })
  t.after(() => events.dispose())
  const abort = new AbortController()
  const response = await events.fetch(new Request('http://fixture.local/api/harness-platform/events', { signal: abort.signal }))
  assert.match(response.headers.get('content-type'), /^text\/event-stream/)
  const reader = response.body.getReader()
  const decode = result => JSON.parse(new TextDecoder().decode(result.value).match(/^data: (.*)$/m)[1])
  assert.deepEqual(decode(await reader.read()).domains, PLATFORM_DOMAINS)
  const next = reader.read()
  events.notify(['mcp'], ['mock-soc-readonly', '../private-file', 'unreturned file content'])
  t.mock.timers.tick(100)
  assert.deepEqual(decode(await next), { revision: 1, domains: ['mcp'], ids: ['mock-soc-readonly'] })
  abort.abort()
  assert.equal((await reader.read()).done, true)
  // 若取消未移除监听，后续通知会向关闭的 controller 写入并抛错。
  events.notify(['instances'], ['mock-instance'])
  assert.doesNotThrow(() => t.mock.timers.tick(100))
  reader.releaseLock()
  assert.equal(response.body.locked, false)
})
