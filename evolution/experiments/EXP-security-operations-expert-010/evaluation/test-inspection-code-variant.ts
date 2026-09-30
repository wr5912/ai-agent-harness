import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { classify, decide, apply } from '../candidate/dsh/managed/inspection-code-variant.mjs'

const source = '../candidate/dsh/managed/inspection-code-variant'
assert.equal(readFileSync(new URL(source + '.mjs', import.meta.url), 'utf8'),
  '// Generated from inspection-code-variant.ts; edit the TypeScript source.\n'
    + stripTypeScriptTypes(readFileSync(new URL(source + '.ts', import.meta.url), 'utf8')).replace(/[ \t]+$/gm, ''))

const catalog = [{ taskId: 'dynamic-task', definitionVersion: 'V3', name: '设备综合巡检',
  defaultForChat: true, matchPhrases: ['执行一次常规巡检'], inspectionItems: ['在线状态', '漏洞'], runtimeInputSchema: {} }]
const events: any[] = []
const add = (turn: number, step: number, name: string, args: object, value: unknown, isError = false) => {
  const callId = `call-${events.length}`
  events.push({ type: 'tool/call', data: { turn, step, callId, name, arguments: JSON.stringify(args) } })
  events.push({ type: 'tool/result', data: { turn, step, message: { toolCallId: callId,
    content: [{ type: 'text', text: JSON.stringify(value) }], isError } } })
}
const list = 'mcp__inspection__list_executable_inspections'
const start = 'mcp__inspection__start_inspection'
const get = 'mcp__inspection__get_inspection_result'
const regular = classify('执行一次常规巡检。')!
assert.equal(decide(regular, events, 1, 'session-1').name, list)
add(1, 1, list, {}, catalog)
const first = decide(regular, events, 1, 'session-1')
assert.equal(first.name, start)
assert.equal(first.arguments.taskId, 'dynamic-task')
assert.equal('scope' in first.arguments, false)
assert.deepEqual(decide(regular, events, 1, 'session-1'), first)
add(1, 2, start, first.arguments, { runId: 'run-1', status: 'RUNNING' })
assert.deepEqual(decide(regular, events, 1, 'session-1'), { kind: 'tool', name: get, arguments: { runId: 'run-1' } })
add(1, 3, get, { runId: 'run-1' }, { runId: 'run-1', status: 'RUNNING' })
const running = decide(regular, events, 1, 'session-1')
assert.equal(running.kind, 'text')
assert.match(running.text, /仍在运行/)
assert.doesNotMatch(running.text, /报告地址/)
const resume = classify('请继续查询刚才的巡检结果。')!
assert.deepEqual(decide(resume, events, 2, 'session-1'), { kind: 'tool', name: get, arguments: { runId: 'run-1' } })
add(2, 1, get, { runId: 'run-1' }, { runId: 'run-1', status: 'PARTIAL', resultStatus: 'PARTIAL',
  conclusionStatus: 'ABNORMAL', businessSummary: { devices: { observedCount: 1 },
    items: [{ name: '在线状态', conclusion: '需核实', reasons: ['上游未返回证据'], recommendations: ['补查设备'] }] },
  reportMarkdown: '# 巡检报告', reportDownloadUrl: 'https://example.test/report' })
const finished = decide(resume, events, 2, 'session-1')
assert.match(finished.text, /已观察设备数量：1/)
assert.match(finished.text, /PARTIAL/)
assert.match(finished.text, /建议：补查设备/)
assert.match(finished.text, /报告内容：\n# 巡检报告/)
assert.match(finished.text, /https:\/\/example.test\/report/)
assert.equal(events.filter(event => event.type === 'tool/call' && event.data.name === start).length, 1)

const asset = classify('对资产标识 A-001 执行匹配的巡检。')!
const assetEvents: any[] = []
assetEvents.push({ type: 'tool/call', data: { turn: 1, callId: 'list-asset', name: list, arguments: '{}' } },
  { type: 'tool/result', data: { turn: 1, message: { toolCallId: 'list-asset', content: [{ type: 'text', text: JSON.stringify(catalog) }] } } })
assert.deepEqual(decide(asset, assetEvents, 1, 'session-asset').arguments.scope, { type: 'ASSET_IDS', assetIds: ['A-001'] })
assert.equal(classify('请列出当前可用的巡检项，只查询目录，不要执行巡检。')?.kind, 'list')
assert.equal(classify('帮我创建巡检任务。')?.kind, 'create')
assert.equal(decide(classify('创建一个每 10 分钟执行一次的资产运行状态巡检任务。')!, [], 1, 'x').kind, 'text')
assert.equal(classify('请根据下面的巡检事实生成结构化辅助研判'), undefined)
assert.match(decide(regular, [{ type: 'tool/call', data: { turn: 1, callId: 'missing', name: list } }], 1, 'x').text,
  /避免重复操作/)
const missingStart = assetEvents.concat({ type: 'tool/call', data: { turn: 1, callId: 'missing', name: start } })
assert.match(decide(asset, missingStart, 1, 'session-asset').text, /避免重复操作/)
const mismatched = events.map(event => event.type === 'tool/result' && event.data.message.toolCallId === 'call-4'
  ? { ...event, data: { ...event.data, message: { ...event.data.message,
    content: [{ type: 'text', text: JSON.stringify({ runId: 'other-run', status: 'COMPLETED' }) }] } } }
  : event)
assert.match(decide(regular, mismatched, 1, 'session-1').text, /运行标识.*不一致/)

const handlers = new Map<string, Function>()
let adapter: any
apply({ on: (name: string, handler: Function) => handlers.set(name, handler),
  llm: { registerAdapter: (_providers: string[], value: any) => { adapter = value } } })
const agent = { id: 'session-test', options: { provider: 'deepseek-official', model: 'deepseek-flash' },
  session: { id: 'session-test', header: {}, snapshotEvents: () => [] } }
await handlers.get('agent/pre-step')!({ agent, step: 1, messages: [{ source: { kind: 'user' },
  content: [{ type: 'text', text: '帮我创建巡检任务。' }] }] }, async () => undefined)
assert.equal((await handlers.get('agent/request')!({ agent, turn: 1 }, async () => agent.options)).provider, 'inspection-code')
const chunks: any[] = []
for await (const chunk of adapter.stream({ sessionId: 'session-test' })) chunks.push(chunk)
assert.equal(chunks.at(-1).reason.kind, 'stop')
assert.match(chunks.find(chunk => chunk.type === 'text-delta').text, /不能创建任务/)
await handlers.get('agent/pre-step')!({ agent, step: 1, messages: [{ source: { kind: 'user' },
  content: [{ type: 'text', text: '你好' }] }] }, async () => undefined)
assert.equal((await handlers.get('agent/request')!({ agent, turn: 2 }, async () => ({ provider: 'inspection-code', model: 'deterministic-inspection' }))).provider, 'deepseek-official')
console.log('inspection code variant: OK')
