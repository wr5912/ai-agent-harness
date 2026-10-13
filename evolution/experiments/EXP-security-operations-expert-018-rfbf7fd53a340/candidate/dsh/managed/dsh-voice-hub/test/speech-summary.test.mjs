import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = mkdtempSync(join(tmpdir(), 'voice-summary-test-'))
await build({ entryPoints: ['src/speech-summary.ts'], outfile: join(dir, 'summary.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
const { SpeechSummaryQueue, summarySource, SUMMARY_DEFAULTS } = await import(pathToFileURL(join(dir, 'summary.mjs')).href)
rmSync(dir, { recursive: true })

const complete = { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }
const event = (content, overrides = {}) => ({
  type: 'assistant/message', surfaceOp: 'append',
  data: { message: { id: 'm1', source: { kind: 'model', provider: 'p', model: 'm' }, content }, stream: [complete], ...overrides },
})
assert.equal(summarySource(event([{ type: 'text', text: '先查证，再执行。' }])).text, '先查证，再执行。')
assert.equal(summarySource(event([{ type: 'reasoning', text: '思考' }, { type: 'tool-call', name: 'read' }])), null)
assert.equal(summarySource(event([{ type: 'text', text: '残缺' }], { interrupted: true })), null)
assert.equal(summarySource(event([{ type: 'text', text: '残缺' }], { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }] })), null)
assert.equal(summarySource({ ...event([{ type: 'text', text: '改写' }]), surfaceOp: { op: 'replace' } }), null)
assert.ok(summarySource(event([{ type: 'text', text: '查询中' }, { type: 'tool-call' }], { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'tool-calls' } } }] })))

const job = (id, settings = SUMMARY_DEFAULTS) => ({ sessionId: 's', sourceMessageId: id, turn: 1, step: Number(id), targetTabId: 'tab', text: `正文${id}`, provider: 'p', model: 'm', settings })
const waitFor = async (test) => { const end = Date.now() + 2000; while (!test()) { assert.ok(Date.now() < end, '队列未完成'); await new Promise(r => setTimeout(r, 5)) } }
const requests = [], emitted = [], spoken = [], failed = []
let release
let firstStarted = false
const queue = new SpeechSummaryQueue(async function* (options) {
  requests.push(options)
  if (requests.length === 1) { firstStarted = true; await new Promise(r => { release = r }) }
  yield { type: 'text-delta', text: options.messages[0].content[0].text + '摘要' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}, e => emitted.push(e), (sid, text) => spoken.push({ sid, text }), (sid, tab) => failed.push({ sid, tab }))
queue.enqueue(job('1'))
queue.enqueue(job('2', { ...SUMMARY_DEFAULTS, summaryLength: 45, summaryModel: { provider: 'q', model: 'n' } }))
await waitFor(() => firstStarted)
assert.equal(requests.length, 1, '同一回合工具后续步骤应排队，不能替换前一条')
release()
await waitFor(() => emitted.length === 2)
assert.deepEqual(emitted.map(e => e.sourceMessageId), ['1', '2'])
assert.deepEqual(spoken.map(e => e.text), emitted.map(e => e.text))
assert.equal(requests[0].provider, 'p')
assert.equal(requests[1].provider, 'q')
assert.match(requests[1].system, /45/)
assert.equal(requests[0].sessionId, undefined, '辅助调用不得成为主回合或递归来源')
queue.dispose()

let lateRelease, lateStarted = false
const late = new SpeechSummaryQueue(async function* (options) {
  lateStarted = true
  await new Promise(r => { lateRelease = r })
  assert.equal(options.signal.aborted, true)
  yield { type: 'text-delta', text: '迟到摘要' }
  yield { type: 'finish', reason: { kind: 'stop' } }
}, () => assert.fail('取消后发布迟到结果'), () => assert.fail('取消后合成'), () => assert.fail('取消后提示错误'))
late.enqueue(job('3'))
await waitFor(() => lateStarted)
late.cancel('s')
lateRelease()
await new Promise(r => setTimeout(r, 10))
const broken = new SpeechSummaryQueue(async function* () { throw new Error('失败') }, () => assert.fail(), () => assert.fail(), () => failed.push('error'))
broken.enqueue(job('4'))
await waitFor(() => failed.length === 1)
broken.dispose()
console.log('摘要来源、工具前正文、串行、模型配置、取消迟到结果与错误跳过：通过')
