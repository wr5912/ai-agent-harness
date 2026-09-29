import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, deliveryMarkdown, inferFrozen, modelBridge } from '../../evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis.mjs'
import { TOOL_ROUTES, createSecurityOperationsGuard, visibleToolsForDepth } from '../../evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/security-operations-guard.mjs'

test('父角色只能委派，子角色可研判但不能递归，插件不覆盖其他角色工具', () => {
  const guard = createSecurityOperationsGuard()
  const exec = (name, depth) => ({ name, arguments: {}, agent: { session: { header: { delegationDepth: depth } } } })
  assert.equal(guard.decide(exec('delegate_threat_analysis', 0)), undefined)
  assert.ok(guard.decide(exec('analyze_threat_incident', 0)))
  assert.equal(guard.decide(exec('analyze_threat_incident', 1)), undefined)
  assert.ok(guard.decide(exec('delegate_threat_analysis', 1)))
  assert.ok(!visibleToolsForDepth(0).includes('analyze_threat_incident'))
  assert.ok(visibleToolsForDepth(0).includes('delegate_inspection'))
  const hooks = []
  apply({ tools: { register() {} }, llm: { registerAdapter() {} }, on(event) { hooks.push(event) } })
  assert.ok(!hooks.includes('agent/created'))
})

test('父会话只逐字交付本轮成功的专用委派，错误与其他路由不被劫持', () => {
  const result = { type: 'tool/result', data: { turn: 2, message: { role: 'tool', toolCallId: 'call-1', content: [{ type: 'text', text: '固定摘要' }] } } }
  const call = { type: 'tool/call', data: { callId: 'call-1', name: 'delegate_threat_analysis' } }
  assert.equal(deliveryMarkdown([call, result], 2), '固定摘要')
  assert.equal(deliveryMarkdown([call, result], 3), undefined)
  assert.equal(deliveryMarkdown([{ ...call, data: { ...call.data, name: 'delegate_inspection' } }, result], 2), undefined)
  result.data.message.isError = true
  assert.equal(deliveryMarkdown([call, result], 2), undefined)
})

test('完整研判使用当前 DSH 模型且只传固定提示词和冻结输入，不混入会话历史', async () => {
  let actual
  const ctx = { llm: { async prepareCall(config) { return { config, async *stream(options) { actual = options; yield { type: 'text-delta', text: '{"verdict":"可疑"}' }; yield { type: 'finish', reason: { kind: 'stop' } } } } } } }
  const route = { provider: 'selected-provider', model: 'selected-model' }
  const value = await inferFrozen(ctx, route, { messages: [{ role: 'system', content: '固定提示词' }, { role: 'user', content: '冻结输入' }], temperature: .1 }, new AbortController().signal)
  assert.equal(actual.provider, route.provider)
  assert.equal(actual.model, route.model)
  assert.equal(actual.system, '固定提示词')
  assert.deepEqual(actual.messages, [{ role: 'user', content: [{ type: 'text', text: '冻结输入' }] }])
  assert.equal(actual.tools, undefined)
  assert.equal(value.model, route.model)
  assert.equal(value.choices[0].message.content, '{"verdict":"可疑"}')
})

test('本地正式回复逐字交付，隔离会话，并在新一轮恢复模型路由', async () => {
  const hooks = new Map()
  let adapter
  apply({ tools: { register() {} }, llm: { registerAdapter(providers, value) { assert.deepEqual(providers, ['threat-analysis-delivery']); adapter = value } }, on(event, callback) { hooks.set(event, callback) } })
  assert.equal(typeof hooks.get('agent/request'), 'function')
  assert.ok(adapter, '必须注册路由，否则下一轮 RPC 会拒绝未知模型')
  assert.equal((await adapter.resolveModel('threat-analysis-delivery', 'fixed-summary')).id, 'fixed-summary')
  const request = hooks.get('agent/request')
  const stream = options => adapter.stream(options)
  const base = { provider: 'local-qwen', model: 'Qwen3.8-27B' }
  const events = [{ type: 'request/header', data: { header: { config: base } } }]
  const agent = { id: 'session-test', session: { snapshotEvents: () => events } }
  async function collect(iter) { const result = []; for await (const item of iter) result.push(item); return result }
  for (const status of ['completed', 'contract_failed']) {
    events.push({ type: 'tool/result', data: { turn: 1, meta: { threat_analysis: { status, delivery: { markdown: '### 正式摘要\n\n' + status } } } } })
    const config = await request({ agent, turn: 1 }, async () => base)
    assert.equal(config.provider, 'threat-analysis-delivery')
    const prepared = await adapter.prepareCall(config.provider, config.model)
    const chunks = await collect(prepared.stream({ ...config, sessionId: agent.id }))
    assert.equal(chunks.find(c => c.type === 'text-delta').text, '### 正式摘要\n\n' + status)
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    events.push({ type: 'request/header', data: { header: { config } } })
    events.push({ type: 'assistant/message', data: { turn: 1 } })
    assert.deepEqual(await request({ agent, turn: 2 }, async () => config), base)
  }
  const other = { id: 'other-session', session: { snapshotEvents: () => [] } }
  assert.deepEqual(await request({ agent: other, turn: 1 }, async () => base), base)
  await assert.rejects(collect(stream({ provider: 'threat-analysis-delivery', sessionId: 'missing' })), /missing/)
  events.push({ type: 'tool/result', data: { turn: 3, meta: { threat_analysis: { delivery: { markdown: '不可串会话' } } } } })
  await request({ agent, turn: 3 }, async () => base)
  await assert.rejects(collect(stream({ sessionId: 'other-session' })), /missing/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(collect(stream({ sessionId: agent.id, signal: controller.signal })), { name: 'AbortError' })
  await request({ agent, turn: 3 }, async () => base)
  hooks.get('agent/disposed')({ agent })
  await assert.rejects(collect(stream({ sessionId: agent.id })), /missing/)
})


test('模型不完整或空响应不得伪装成功', async () => {
  for (const chunks of [[], [{ type: 'finish', reason: { kind: 'stop' } }], [{ type: 'text-delta', text: '{}' }, { type: 'finish', reason: { kind: 'length' } }]]) {
    const ctx = { llm: { async prepareCall(config) { return { config, async *stream() { yield* chunks } } } } }
    await assert.rejects(inferFrozen(ctx, { provider: 'p', model: 'm' }, { messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }] }, new AbortController().signal), /empty|incomplete/)
  }
})


test('既有巡检、故障、策略、调度和响应规划权限保持基线行为', async () => {
  const { execFileSync } = await import('node:child_process')
  const source = execFileSync('git', ['show', '3b64e7de45e29ba759281aca581ddae1a58b7c00:evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/security-operations-guard.mjs'], { encoding: 'utf8' })
  const baseline = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
  for (const name of Object.values(baseline.TOOL_ROUTES).flat()) {
    for (const depth of [0, 1, 2]) {
      const exec = { name, arguments: {}, agent: { session: { header: { delegationDepth: depth } } } }
      assert.deepEqual(createSecurityOperationsGuard().decide(exec), baseline.createSecurityOperationsGuard().decide(exec), `${name} depth=${depth}`)
    }
  }
  assert.ok(TOOL_ROUTES.delegates.includes('delegate_threat_analysis'))
})


test('HTTP 模型桥接保留跨字节块的中文冻结输入', async () => {
  const { request } = await import('node:http')
  let actual
  const ctx = { llm: { async prepareCall(config) { return { config, async *stream(options) { actual = options; yield { type: 'text-delta', text: '{}' }; yield { type: 'finish', reason: { kind: 'stop' } } } } } } }
  const bridge = await modelBridge(ctx, { provider: 'p', model: 'm' })
  try {
    const payload = Buffer.from(JSON.stringify({ messages: [{ role: 'system', content: '中文规则' }, { role: 'user', content: '冻结证据' }] }))
    const split = payload.indexOf(Buffer.from('中')) + 1
    await new Promise((resolve, reject) => {
      const req = request(bridge.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${bridge.key}` } }, response => { response.resume(); response.on('end', resolve) })
      req.on('error', reject)
      req.write(payload.subarray(0, split))
      setTimeout(() => req.end(payload.subarray(split)), 30)
    })
    assert.equal(actual.system, '中文规则')
    assert.equal(actual.messages[0].content[0].text, '冻结证据')
  } finally { bridge.close() }
})


test('研判工具声明对象合同并在启动取证前拒绝非法事件 ID', async () => {
  let definition
  apply({ tools: { register(value) { definition = value } }, llm: { registerAdapter() {} }, on() {} })
  assert.equal(definition.parameters.type, 'object')
  assert.deepEqual(definition.parameters.required, ['incident_id'])
  assert.equal(definition.output.schema.type, 'object')
  await assert.rejects(definition.execute({ incident_id: 'bad;id' }, {}), /invalid incident ID/)
})

test('工具只展示执行状态；保留原始结果并继续进入本地正式回复', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'threat-terminal-'))
  const oldPath = process.env.PATH
  let definition
  apply({ tools: { register(value) { definition = value } }, llm: { registerAdapter() {} }, on() {} }, { connections: { report: { url: 'http://example.invalid/mcp/report' } } })
  const result = { verdict: '误报', matches: [{ source: 'alert_whitelist', entry_id: 'wl-test', entity_value: '192.0.2.1', evidence_refs: Array.from({ length: 414 }, (_, i) => `evidence-${i}`), list_version: null, queried_at: '2026-09-27' }] }
  try {
    process.env.PATH = `${dir}:${oldPath}`
    for (const [route, status] of [['fast_classification', 'completed'], ['fast_classification', 'evidence_failed'], ['five_source', 'completed'], ['five_source', 'contract_failed']]) {
      const value = { route, status, run_id: 'test-run', delivery: { markdown: '### 研判摘要\n\n摘要保存：待接入' }, ...(status === 'completed' ? { result } : {}) }
      await writeFile(join(dir, 'python3'), `#!/bin/sh\nnode -e 'const c=JSON.parse(process.env.THREAT_ANALYSIS_CONFIG); if(c.connections.report.url!=="http://example.invalid/mcp/report" || c.analysisModel.model!=="test-model" || !c.analysisModel.baseURL.startsWith("http://127.0.0.1:") || c.analysisModel.apiKeyEnv!=="THREAT_MODEL_BRIDGE_KEY" || !process.env.THREAT_MODEL_BRIDGE_KEY) process.exit(1)' || exit 1\ncat <<'RESULT' \n${JSON.stringify(value)}\nRESULT\n`, { mode: 0o755 })
      let concluded = 0
      assert.deepEqual(await definition.execute({ incident_id: 'INC-20260917-000001' }, { agent: { options: { provider: 'test', model: 'test-model' }, session: { snapshotEvents: () => [] } }, concludeTurn() { concluded++ } }), value)
      assert.equal(concluded, 0)
      const content = definition.output.render({}, value)
      assert.notEqual(content[0].text, value.delivery.markdown)
      assert.deepEqual(definition.output.presentationMeta({}, value), { threat_analysis: value })
    }
  } finally {
    process.env.PATH = oldPath
    await rm(dir, { recursive: true, force: true })
  }
})
