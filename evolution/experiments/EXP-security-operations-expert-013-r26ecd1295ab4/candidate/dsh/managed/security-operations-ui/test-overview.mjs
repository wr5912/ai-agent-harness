import assert from 'node:assert/strict'
import { apply } from './index.js'

const records = new Map()
const activities = new Map()
const handlers = new Map()
let route
let dispose
let listFails = false
const sessions = [
  { sessionId: 'parent-1', running: true, blank: false, updatedAt: 10 },
  { sessionId: 'child-1', parentSessionId: 'parent-1', running: false, blank: false, updatedAt: 9 },
  { sessionId: 'child-2', parentSessionId: 'parent-1', running: false, blank: false, updatedAt: 8 },
]
const ctx = {
  logger: { error() {} },
  effect: async callback => { dispose = await callback() },
  on: (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name) },
  storageDomain: { open: async spec => {
    assert.equal(spec.name, 'security_operations_overview')
    return { table: name => ({
      get: key => (name === 'calls' ? records : activities).get(key),
      put: async (key, value) => { (name === 'calls' ? records : activities).set(key, spec.tables[name].valueSchema.parse(value)) },
      delete: async key => { (name === 'calls' ? records : activities).delete(key) },
      entries: () => (name === 'calls' ? records : activities).entries(),
    }), close: async () => {} }
  } },
  connection: { fetch: { register: options => {
    route = options.fetch
    assert.deepEqual(options.methods, ['GET'])
    return () => {}
  } } },
  sessionController: { list: async () => {
    if (listFails) throw new Error('list unavailable')
    return { items: sessions }
  } },
}

await apply(ctx)
const read = async () => {
  const response = await route()
  assert.equal(response.status, 200)
  return response.json()
}
let overview = await read()
assert.equal(overview.parent.active, 1)
assert.equal(overview.parent.sessions, 1)
assert.equal(overview.roles.length, 3)
assert(overview.roles.every(role => role.state === 'idle'))
assert.deepEqual([overview.parent.toolCalls, overview.parent.skillLoads], [0, 0])
assert(overview.roles.every(role => role.toolCalls === 0 && role.skillLoads === 0))

const exec = (name, callId, sessionId = 'parent-1') => ({ name, callId, agent: { session: { id: sessionId } } })
activities.set('old', { sessionId: 'parent-1', at: Date.now() - 25 * 3_600_000, toolCalls: 1, skillLoads: 1 })
await handlers.get('tools/execute')(exec('delegate_threat_analysis', 'call-1'), async () => {
  handlers.get('subagent/start')({ runId: 'run-1', id: 'child-1' })
  handlers.get('subagent/end')({ runId: 'run-1', stopReason: 'completed' })
})
handlers.get('tools/result')(exec('delegate_threat_analysis', 'call-1'), { isError: false })
overview = await read()
assert.equal(overview.roles[0].completed, 1)
assert.equal(overview.roles[0].recent[0].childSessionId, 'child-1')
assert.deepEqual([overview.parent.toolCalls, overview.parent.skillLoads], [1, 0])
assert.equal(activities.has('old'), false)

handlers.get('tools/result')(exec('skill', 'skill-1', 'child-1'), { isError: false })
handlers.get('tools/result')(exec('skill', 'skill-2', 'child-1'), { isError: true })
handlers.get('tools/result')(exec('read_file', 'read-1', 'child-1'), { isError: false })
handlers.get('session/event')({ id: 'child-1' }, {
  type: 'user/message', seq: 12, time: Date.now(), data: { source: { kind: 'skill-invocation', name: 'incident-response' } },
})
handlers.get('session/event')({ id: 'child-1' }, {
  type: 'user/message', seq: 13, time: Date.now(), data: { source: { kind: 'user' } },
})
handlers.get('tools/result')(exec('skill', 'skill-main'), { isError: false })
handlers.get('tools/result')({ name: 'unowned', callId: 'no-agent' }, { isError: false })
overview = await read()
assert.deepEqual([overview.parent.toolCalls, overview.parent.skillLoads], [2, 1])
assert.deepEqual([overview.roles[0].toolCalls, overview.roles[0].skillLoads], [3, 2])
assert(overview.roles.slice(1).every(role => role.toolCalls === 0 && role.skillLoads === 0))

await handlers.get('tools/execute')(exec('delegate_fault_analysis', 'call-2'), async () => {
  handlers.get('subagent/start')({ runId: 'run-2', id: 'child-2' })
})
handlers.get('tools/result')(exec('delegate_fault_analysis', 'call-2'), { isError: false })
overview = await read()
assert.equal(overview.roles[1].unknown, 1)
handlers.get('subagent/end')({ runId: 'run-2', stopReason: 'completed' })
overview = await read()
assert.equal(overview.roles[1].completed, 1)
handlers.get('tools/result')(exec('read_file', 'read-2', 'child-2'), { isError: false })
overview = await read()
assert.deepEqual([overview.roles[0].toolCalls, overview.roles[1].toolCalls], [3, 1])

await handlers.get('tools/execute')(exec('delegate_threat_analysis', 'call-3'), async () => {
  handlers.get('subagent/start')({ runId: 'run-3', id: 'child-1' })
})
handlers.get('tools/result')(exec('delegate_threat_analysis', 'call-3'), { isError: true })
handlers.get('subagent/end')({ runId: 'run-3', stopReason: 'completed' })
overview = await read()
assert.equal(overview.roles[0].failed, 1)

handlers.get('tools/result')(exec('delegate_response_planning', 'blocked'), { isError: true })
overview = await read()
assert.equal(overview.roles[2].noChild, 1)
assert.equal(overview.roles[2].recent[0].childSessionId, undefined)
assert.equal(JSON.stringify([...records.values()]).includes('prompt'), false)
assert.equal(JSON.stringify([...activities.values()]).includes('incident-response'), false)

listFails = true
assert.equal((await route()).status, 503)
listFails = false
await dispose()
assert.equal(handlers.size, 0)
console.log('运行概览采集、持久记录、事件顺序、失败状态通过')
