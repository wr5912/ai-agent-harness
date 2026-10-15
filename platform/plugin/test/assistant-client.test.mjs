import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

const output = await mkdtemp(join(tmpdir(), 'harness-assistant-client-'))
const file = join(output, 'assistant.mjs')
await build({ entryPoints: [new URL('../src/assistant/client.tsx', import.meta.url).pathname], outfile: file, bundle: true, platform: 'node', format: 'esm' })
const { createAssistant } = await import(`file://${file}`)
after(() => rm(output, { recursive: true, force: true }))

function fixture(call, selection, rows = {}, config = {}) {
  const retained = []
  const opened = []
  const references = []
  const nativeCreates = []
  const selectionListeners = new Set()
  const assistant = createAssistant({
    uiSession: { adapter: { current: { getSnapshot: () => ({ key: selection }), subscribe: listener => { selectionListeners.add(listener); return () => selectionListeners.delete(listener) } } } },
    workspaces: { create: async request => { assert.deepEqual(request, { path: '/repo' }); return { workspaceId: 'project' } } },
    sessions: { list: { getSnapshot: () => ({ byId: rows }), subscribe: () => () => {} }, async create(request) {
      nativeCreates.push(request)
      await config.beforeCreate?.(request)
      const id = request.sessionId ?? config.sessionIds?.[nativeCreates.length - 1] ?? `session-${nativeCreates.length}`
      rows[id] = { cwd: request.cwd ?? '/repo' }
      return id
    }, retain(id, options) {
      if (!rows[id]) throw new Error(`sessions.retain: unknown session ${id}`)
      retained.push([id, options.source])
      const reference = { sessionId: id, ready: config.ready?.(id) ?? Promise.resolve({}), released: 0, release() { this.released++ } }
      references.push(reference)
      return reference
    }, async using(id, options, operation) {
      const reference = this.retain(id, options)
      try { await reference.ready; return await operation(reference) }
      finally { reference.release() }
    } },
    uiWorkspace: { openSession: id => opened.push(id) },
  }, { call }, () => '/repo')
  return { assistant, retained, opened, references, nativeCreates, setSelection(id) { selection = id; selectionListeners.forEach(listener => listener()) } }
}

test('每个新任务使用独立 Session；融合确认可以续接原任务，切换后释放旧引用', async () => {
  const calls = []
  const f = fixture(async (channel, endpoint, body) => {
    calls.push([channel, endpoint, body])
    return { ok: true, value: endpoint === 'assistant/session' ? { session_id: body.session_id } : { proposals: [] } }
  })
  await f.assistant.create('检查版本', { page: 'agents', experiment_id: 'EXP-a' })
  await f.assistant.create('检查实例', { page: 'instances', instance_name: 'one' })
  assert.deepEqual(f.nativeCreates[0], { workspaceId: 'project' })
  assert.equal(calls[0][2].session_id, 'session-1')
  assert.equal(f.assistant.getSnapshot().sessionId, 'session-2')
  assert.equal(f.references[1].released, 1)
  await f.assistant.create('继续融合', { page: 'agents', session_id: 'session-1' })
  assert.equal(f.assistant.getSnapshot().sessionId, 'session-1')
  assert.deepEqual(f.opened, ['session-1', 'session-2', 'session-1'])
  assert.equal(calls.filter(([, endpoint]) => endpoint === 'assistant/session')[2][2].session_id, 'session-1')
  assert.deepEqual(f.nativeCreates[2], { sessionId: 'session-1', cwd: '/repo' })
  assert.equal(calls.some(([channel]) => channel !== '/harness-platform'), false)
  f.assistant.dispose()
  assert.ok(f.references.every(item => item.released === 1))
})

test('状态读取丢弃过时响应，重连恢复同会话，不创建或投递任务', async () => {
  const pending = []
  let creates = 0
  const f = fixture(async (_channel, endpoint) => {
    if (endpoint === 'assistant/session') { creates++; return { ok: true, value: { session_id: 'session-a' } } }
    if (pending.length < 1) return { ok: true, value: { proposals: [] } }
    return new Promise(resolve => pending.push(resolve))
  }, undefined, {}, { sessionIds: ['session-a'] })
  await f.assistant.create('检查')
  pending.push(null)
  const first = f.assistant.refresh()
  const second = f.assistant.refresh()
  pending[2]({ ok: true, value: { proposals: [{ id: 'p', state: 'completed' }] } })
  await second
  pending[1]({ ok: true, value: { proposals: [{ id: 'p', state: 'awaiting_confirmation' }] } })
  await first
  assert.equal(f.assistant.getSnapshot().status.proposals[0].state, 'completed')
  pending.splice(0)
  const retainedBeforeReconnect = f.retained.length
  await f.assistant.reconnect()
  assert.equal(creates, 1)
  assert.equal(f.retained.length, retainedBeforeReconnect + 1)
  assert.equal(f.retained.at(-1)[0], 'session-a')
  assert.equal(f.references[1].released, 1)
  f.assistant.dispose()
})

test('会话创建失败保留当前选择，错误可见；上下文同步不重新启动任务', async () => {
  let fail = false
  const contexts = []
  const f = fixture(async (_channel, endpoint, body) => {
    if (endpoint === 'assistant/session') return fail ? { ok: false, error: { message: '模型不可用' } } : { ok: true, value: { session_id: 'existing' } }
    if (endpoint === 'assistant/context') contexts.push(body)
    return { ok: true, value: { proposals: [] } }
  }, undefined, {}, { sessionIds: ['existing', 'next'] })
  await f.assistant.create('第一个任务')
  contexts.splice(0)
  f.assistant.updateContext({ page: 'mcp', composition_id: 'c' })
  await Promise.resolve()
  assert.deepEqual(contexts, [{ session_id: 'existing', context: { page: 'mcp', composition_id: 'c' } }])
  fail = true
  await assert.rejects(f.assistant.create('第二个任务'), /模型不可用/)
  assert.equal(f.assistant.getSnapshot().sessionId, 'existing')
  assert.equal(f.assistant.getSnapshot().error, '模型不可用')
  assert.equal(f.assistant.getSnapshot().busy, false)
  f.assistant.dispose()
})

test('快速切换页面时按顺序同步上下文，最终保留最后选中的对象', async () => {
  const writes = []
  let release
  const f = fixture(async (_channel, endpoint, body) => {
    if (endpoint === 'assistant/session') return { ok: true, value: { session_id: 'session-a' } }
    if (endpoint === 'assistant/context') {
      writes.push(body.context)
      if (body.context.page === 'agents') await new Promise(resolve => { release = resolve })
    }
    return { ok: true, value: { proposals: [] } }
  }, undefined, {}, { sessionIds: ['session-a'] })
  await f.assistant.create()
  writes.splice(0)
  f.assistant.updateContext({ page: 'agents', experiment_id: 'EXP-a' })
  f.assistant.updateContext({ page: 'instances', instance_name: 'one' })
  f.assistant.updateContext({ page: 'mcp', composition_id: 'latest' })
  assert.equal(writes.length, 1)
  release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(writes.at(-1), { page: 'mcp', composition_id: 'latest' })
  f.assistant.dispose()
})

test('刷新后跟随原生当前会话，其他工作区保留聊天且不注入平台上下文', async () => {
  for (const cwd of ['/repo', '/another-project']) {
    const endpoints = []
    const f = fixture(async (_channel, endpoint) => {
      endpoints.push(endpoint)
      return { ok: true, value: { proposals: [] } }
    }, 'last-session', { 'last-session': { cwd } })
    f.assistant.restore()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(f.assistant.getSnapshot().sessionId, 'last-session')
    assert.equal(f.assistant.getSnapshot().platformContext, cwd === '/repo')
    assert.equal(endpoints.includes('assistant/session'), false)
    if (cwd !== '/repo') {
      f.assistant.updateContext({ page: 'agents' })
      await f.assistant.refresh()
      assert.deepEqual(endpoints, [])
    }
    f.assistant.dispose()
  }
})

test('跟随原生侧栏选择且不重复导航，归档清空当前选择后释放浮窗引用', async () => {
  const f = fixture(async () => ({ ok: true, value: { proposals: [] } }), undefined, { 'native-session': { cwd: '/repo' } })
  f.setSelection('native-session')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.assistant.getSnapshot().sessionId, 'native-session')
  assert.deepEqual(f.opened, [])
  f.setSelection(undefined)
  assert.equal(f.assistant.getSnapshot().sessionId, undefined)
  assert.equal(f.assistant.getSnapshot().reference, undefined)
  assert.equal(f.references[0].released, 1)
  f.assistant.dispose()
})

test('列表通知未到时先完成原生登记与绑定，再向同一Session投递一次真实任务', async () => {
  let register, open, startedCreate, startedOpen
  const registration = new Promise(resolve => { register = resolve })
  const opening = new Promise(resolve => { open = resolve })
  const createStarted = new Promise(resolve => { startedCreate = resolve })
  const openStarted = new Promise(resolve => { startedOpen = resolve })
  const calls = []
  // fixture 刻意不发 Session list 通知；create 返回前按原生合同登记身份。
  const f = fixture(async (_channel, endpoint, body) => {
    calls.push([endpoint, body])
    return { ok: true, value: endpoint === 'assistant/session' ? { session_id: body.session_id } : { proposals: [] } }
  }, undefined, {}, {
    sessionIds: ['session-race'],
    beforeCreate() { startedCreate(); return registration },
    ready() { startedOpen(); return opening },
  })
  const creating = f.assistant.create('你好', { page: 'home' })
  await createStarted
  assert.deepEqual(calls, [])
  assert.deepEqual(f.retained, [])
  register()
  await openStarted
  assert.deepEqual(calls, [])
  assert.equal(f.retained[0][0], 'session-race')
  open()
  await creating
  assert.deepEqual(calls.filter(([endpoint]) => endpoint === 'assistant/session'), [
    ['assistant/session', { task: '你好', context: { page: 'home' }, session_id: 'session-race' }],
  ])
  assert.deepEqual(f.nativeCreates, [{ workspaceId: 'project' }])
  assert.equal(f.assistant.getSnapshot().sessionId, 'session-race')
  assert.equal(f.assistant.getSnapshot().error, '')
  assert.equal(f.assistant.getSnapshot().busy, false)
  f.assistant.dispose()
  assert.ok(f.references.every(item => item.released === 1))
})

test('新会话绑定失败不投递任务，保留已有选择和Host已登记的Session', async () => {
  const calls = []
  const rows = { existing: { cwd: '/repo' } }
  const f = fixture(async (_channel, endpoint) => {
    calls.push(endpoint)
    return { ok: true, value: { proposals: [] } }
  }, 'existing', rows, {
    sessionIds: ['created-but-unavailable'],
    ready: id => id === 'created-but-unavailable' ? Promise.reject(new Error('history open failed')) : Promise.resolve({}),
  })
  f.assistant.restore()
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(f.assistant.create('你好'), /history open failed/)
  assert.equal(calls.includes('assistant/session'), false)
  assert.equal(f.assistant.getSnapshot().sessionId, 'existing')
  assert.equal(f.assistant.getSnapshot().busy, false)
  assert.equal(f.references[0].released, 0)
  assert.equal(f.references[1].released, 1)
  assert.deepEqual(rows['created-but-unavailable'], { cwd: '/repo' })
  f.assistant.dispose()
})

test('retain同步失败后解除选择锁，原生恢复错误可见且后续选择仍能联动', async () => {
  const f = fixture(async () => ({ ok: true, value: { proposals: [] } }), undefined, { known: { cwd: '/repo' } })
  await assert.rejects(f.assistant.select('unknown'), /sessions.retain: unknown session/)
  f.setSelection('unknown-native')
  await new Promise(resolve => setImmediate(resolve))
  assert.match(f.assistant.getSnapshot().error, /unknown-native/)
  f.setSelection('known')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.assistant.getSnapshot().sessionId, 'known')
  assert.equal(f.assistant.getSnapshot().error, '')
  assert.deepEqual(f.opened, [])
  f.assistant.dispose()
})

test('组合确认卡片显示实际冻结版本与工具身份', async () => {
  const compiled = await build({ entryPoints: ['src/assistant/client.tsx'], write: false, bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime'] })
  const versionId = '1'.repeat(64)
  const proposal = { id: 'proposal-fixed', state: 'awaiting_confirmation', domain: 'mcp', action: 'callPublishedComposition',
    preview: { action: 'callPublishedComposition', compositionId: 'composition-fixed', versionId, toolName: 'basic_status', title: '基础状态' } }
  const assistant = { subscribe: () => () => {}, getSnapshot: () => ({ sessionId: 'session-fixed', status: { proposals: [proposal] } }) }
  const jsx = (type, props) => ({ type, props })
  const module = { exports: {} }
  runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require(name) {
    if (name === 'react') return { useState: initial => [initial, () => {}], useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    throw new Error(`unexpected import: ${name}`)
  } })
  const render = node => {
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node !== 'object') return String(node)
    if (Array.isArray(node)) return node.map(render).join(' ')
    if (typeof node.type === 'function') return render(node.type(node.props))
    return render(node.props?.children)
  }
  const text = render(module.exports.AssistantOperations({ assistant, rpc: { call() { assert.fail('渲染不能执行操作') } }, sessionId: 'session-fixed' }))
  assert.match(text, /固定发布版本/)
  assert.ok(text.includes(versionId))
  assert.ok(text.includes('composition-fixed') && text.includes('basic_status'))
  assert.match(text, /确认并执行/)
})
