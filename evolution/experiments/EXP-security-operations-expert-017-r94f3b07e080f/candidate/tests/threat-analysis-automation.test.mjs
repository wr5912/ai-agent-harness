import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  apply,
  deliveryMarkdown,
  pendingIncidentIds,
  scheduledBatch,
  scheduledOccurrenceAt,
} from '../dsh/managed/threat-analysis.mjs'
import {
  createSecurityOperationsGuard,
  visibleToolsForDepth,
} from '../dsh/managed/security-operations-guard.mjs'

const prompt = JSON.stringify({ type: 'threat-analysis.pending', version: 1, batchSize: 1 })

function scheduleEvent(value) {
  return { type: 'user/message', data: { source: { kind: 'schedule' }, content: [
    { type: 'text', text: `[SCHEDULE REMINDER]\nreminder_prompt_json: ${JSON.stringify(value)}` },
  ] } }
}

function recurringEvent(values, occurrenceAt = new Date().toISOString()) {
  const reminders = values.map((value, index) => ({
    schedule_id: `schedule-${index}`,
    occurrence_at: occurrenceAt,
    reminder_prompt: value,
  }))
  return { type: 'user/message', data: { source: { kind: 'schedule' }, content: [
    { type: 'text', text: `[SCHEDULE REMINDER BATCH]\nreminders_json: ${JSON.stringify(reminders)}` },
  ] } }
}

function harness(events) {
  const definitions = new Map()
  const adapters = new Map()
  const hooks = new Map()
  apply({
    tools: { register(definition) { definitions.set(definition.name, definition) } },
    llm: { registerAdapter(providers, adapter) {
      for (const provider of providers) adapters.set(provider, adapter)
    } },
    on(event, callback) { hooks.set(event, callback) },
  })
  const agent = {
    id: 'session-test',
    options: { provider: 'local-qwen', model: 'Qwen3.8-27B' },
    session: { header: { delegationDepth: 0 }, snapshotEvents: () => events },
  }
  const execute = callId => ({
    agent,
    callId,
    rootCallId: callId,
    token: Symbol(callId),
    signal: new AbortController().signal,
  })
  return { adapters, agent, definitions, execute, hooks }
}

test('只接受最新 Schedule 消息中的精确自动研判合同', () => {
  assert.deepEqual(scheduledBatch([scheduleEvent(prompt)]), {
    type: 'threat-analysis.pending', version: 1, batchSize: 1,
  })
  assert.deepEqual(scheduledBatch([recurringEvent([prompt])]), {
    type: 'threat-analysis.pending', version: 1, batchSize: 1,
  })
  assert.equal(scheduledOccurrenceAt([recurringEvent([prompt], '2026-10-11T00:00:00.000Z')]),
    '2026-10-11T00:00:00.000Z')
  assert.equal(scheduledBatch([recurringEvent([prompt, '普通提醒'])]), undefined)
  assert.deepEqual(scheduledBatch([recurringEvent([prompt, prompt])]), {
    type: 'threat-analysis.pending', version: 1, batchSize: 1,
  })
  assert.equal(scheduledBatch([scheduleEvent('普通提醒')]), undefined)
  assert.equal(scheduledBatch([scheduleEvent(JSON.stringify({
    type: 'threat-analysis.pending', version: 1, batchSize: 10,
  }))]), undefined)
  assert.equal(scheduledBatch([
    scheduleEvent(prompt),
    { type: 'user/message', data: { source: { kind: 'user' }, content: [] } },
  ]), undefined)
})

test('Schedule 桥固定生成单条批处理调用且批次结果逐字交付', async () => {
  const events = [scheduleEvent(prompt)]
  const { adapters, agent, hooks } = harness(events)
  const route = await hooks.get('agent/request')({ agent, turn: 1 }, async () => ({
    provider: 'deepseek-official', model: 'deepseek-flash',
  }))
  assert.deepEqual(route, { provider: 'threat-analysis-automation', model: 'scheduled-batch' })
  const adapter = adapters.get(route.provider)
  const prepared = await adapter.prepareCall(route.provider, route.model)
  const chunks = []
  for await (const chunk of prepared.stream({ sessionId: agent.id })) chunks.push(chunk)
  assert.equal(chunks[1].name, 'analyze_pending_threat_incidents')
  assert.equal(chunks[1].argumentsDelta, '{"batch_size":1}')

  const batch = { status: 'completed', found: 1, attempted: 1, completed: 1,
    skipped_locked: 0, failed: 0,
    results: [{ incident_id: 'INC-20261010-000001', status: 'completed', run_id: 'run-test' }] }
  assert.match(deliveryMarkdown([{ type: 'tool/result', data: {
    turn: 2, meta: { threat_analysis_batch: batch },
  } }], 2), /INC-20261010-000001：completed（run-test）/)

  const failedEvents = [scheduleEvent(prompt),
    { type: 'tool/call', data: { callId: 'failed-call', name: 'analyze_pending_threat_incidents' } },
    { type: 'tool/result', data: { turn: 3, message: {
      role: 'tool', toolCallId: 'failed-call', isError: true, content: [{ type: 'text', text: 'timeout' }],
    } } }]
  assert.match(deliveryMarkdown(failedEvents, 3), /没有重试同一投递/)
  const failed = harness(failedEvents)
  const failedRoute = await failed.hooks.get('agent/request')({ agent: failed.agent, turn: 3 }, async () => ({
    provider: 'local-qwen', model: 'Qwen3.8-27B',
  }))
  assert.deepEqual(failedRoute, { provider: 'threat-analysis-delivery', model: 'fixed-summary' })
})

test('待研判列表按 Gateway data.rows 提取合法 ID 并去重', () => {
  assert.deepEqual(pendingIncidentIds({ data: { rows: [
    { incidentId: 'INC-20261010-000001' },
    { incident_id: 'INC-20261010-000001' },
    { id: 'INC-20261010-000002' },
    { incidentId: 'bad' },
  ] } }), ['INC-20261010-000001', 'INC-20261010-000002'])
  assert.throws(() => pendingIncidentIds({ data: { total: 1 } }), /invalid pending incident response/)
})

test('Guard 只把自动研判入口暴露给主 Agent', () => {
  assert.ok(visibleToolsForDepth(0).includes('analyze_pending_threat_incidents'))
  assert.ok(!visibleToolsForDepth(1).includes('analyze_pending_threat_incidents'))
  const guard = createSecurityOperationsGuard({ environment: {} })
  const exec = depth => ({ name: 'analyze_pending_threat_incidents', arguments: { batch_size: 1 },
    agent: { session: { header: { delegationDepth: depth } } } })
  assert.equal(guard.decide(exec(0)), undefined)
  assert.match(guard.decide(exec(1)), /主 Agent/)
})

test('工具超时为 30 分钟分析留出失败回写余量', () => {
  const { definitions } = harness([])
  assert.equal(definitions.get('analyze_threat_incident').timeoutMs, 36 * 60 * 1000)
  assert.equal(definitions.get('analyze_pending_threat_incidents').timeoutMs, 45 * 60 * 1000)
})

test('后续普通消息不继承自动或交付专用路由', async () => {
  const original = { provider: 'local-qwen', model: 'Qwen3.8-27B' }
  const events = [
    { type: 'request/header', data: { header: { config: original } } },
    scheduleEvent(prompt),
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续核查' }] } },
  ]
  for (const special of [
    { provider: 'threat-analysis-automation', model: 'scheduled-batch' },
    { provider: 'threat-analysis-delivery', model: 'fixed-summary' },
  ]) {
    const { agent, hooks } = harness(events)
    const route = await hooks.get('agent/request')({ agent, turn: 4 }, async () => special)
    assert.deepEqual(route, original)
  }
})

test('自然语言创建与删除任务所需固定合同写在唯一业务指令中', async () => {
  const { readFile } = await import('node:fs/promises')
  const instructions = await readFile(new URL('../dsh/workspace/AGENTS.md', import.meta.url), 'utf8')
  assert.match(instructions, /不要求用户提供标题、内部 prompt、JSON、周期或批量参数/)
  assert.match(instructions, /固定设置标题 `自动威胁研判`、`every_seconds: 120`/)
  assert.match(instructions, /`\{"type":"threat-analysis\.pending","version":1,"batchSize":1\}`/)
  assert.match(instructions, /上一条仍在运行时跳过本次心跳、不排队/)
  assert.match(instructions, /必须先调用 `schedule_list`/)
  assert.match(instructions, /直接使用其 ID 调用 `schedule_delete`/)
  assert.match(instructions, /删除只停止后续心跳/)
})

test('空列表、并发心跳、旧心跳和认领冲突遵守串行合同', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'threat-automation-'))
  const executable = join(directory, 'python3')
  const previousPath = process.env.PATH
  const previousMode = process.env.THREAT_AUTOMATION_TEST_MODE
  await writeFile(executable, `#!/bin/sh
if [ "$2" = "--pending" ]; then
  if [ "$THREAT_AUTOMATION_TEST_MODE" = "busy" ]; then sleep 0.2; fi
  if [ "$THREAT_AUTOMATION_TEST_MODE" = "locked" ]; then
    printf '%s\\n' '{"schema_version":"1.0","data":{"rows":[{"incidentId":"INC-20261010-000001"},{"incidentId":"INC-20261010-000002"}]}}'
  else
    printf '%s\\n' '{"schema_version":"1.0","data":{"rows":[]}}'
  fi
elif [ "$2" = "INC-20261010-000001" ]; then
  printf '%s\\n' '{"status":"claim_failed","error_code":409,"run_id":"run-locked"}'
elif [ "$2" = "INC-20261010-000002" ]; then
  printf '%s\\n' '{"status":"completed","run_id":"run-completed"}'
else
  exit 2
fi
`)
  await chmod(executable, 0o755)
  process.env.PATH = `${directory}:${previousPath}`
  try {
    process.env.THREAT_AUTOMATION_TEST_MODE = 'empty'
    let events = [scheduleEvent(prompt), { type: 'request/header', data: {
      header: { config: { provider: 'local-qwen', model: 'Qwen3.8-27B' } },
    } }]
    let instance = harness(events)
    let tool = instance.definitions.get('analyze_pending_threat_incidents')
    assert.deepEqual(await tool.execute({ batch_size: 1 }, instance.execute('empty')),
      { schema_version: '1.1', status: 'completed', requested: 1, found: 0,
        attempted: 0, completed: 0, skipped_locked: 0, failed: 0,
        stopped_reason: 'empty', results: [] })

    process.env.THREAT_AUTOMATION_TEST_MODE = 'busy'
    instance = harness(events)
    tool = instance.definitions.get('analyze_pending_threat_incidents')
    const first = tool.execute({ batch_size: 1 }, instance.execute('first'))
    await new Promise(resolve => setTimeout(resolve, 20))
    const overlapping = await tool.execute({ batch_size: 1 }, instance.execute('overlapping'))
    assert.equal(overlapping.status, 'skipped_busy')
    assert.equal(overlapping.stopped_reason, 'busy')
    assert.equal((await first).status, 'completed')

    process.env.THREAT_AUTOMATION_TEST_MODE = 'locked'
    instance = harness(events)
    tool = instance.definitions.get('analyze_pending_threat_incidents')
    const value = await tool.execute({ batch_size: 1 }, instance.execute('locked'))
    assert.equal(value.found, 2)
    assert.equal(value.attempted, 1)
    assert.equal(value.skipped_locked, 1)
    assert.deepEqual(value.results.map(item => [item.incident_id, item.status, item.run_id]), [
      ['INC-20261010-000001', 'skipped_locked', 'run-locked'],
      ['INC-20261010-000002', 'completed', 'run-completed'],
    ])

    events = [recurringEvent([prompt], new Date(Date.now() - 10 * 60 * 1000).toISOString())]
    instance = harness(events)
    tool = instance.definitions.get('analyze_pending_threat_incidents')
    const stale = await tool.execute({ batch_size: 1 }, instance.execute('stale'))
    assert.equal(stale.status, 'skipped_stale')
    assert.equal(stale.stopped_reason, 'stale')

    events = [{ type: 'user/message', data: { source: { kind: 'user' }, content: [
      { type: 'text', text: prompt },
    ] } }]
    instance = harness(events)
    tool = instance.definitions.get('analyze_pending_threat_incidents')
    await assert.rejects(tool.execute({ batch_size: 1 }, instance.execute('untrusted')),
      /trusted Schedule trigger required/)
  } finally {
    process.env.PATH = previousPath
    if (previousMode === undefined) delete process.env.THREAT_AUTOMATION_TEST_MODE
    else process.env.THREAT_AUTOMATION_TEST_MODE = previousMode
    await rm(directory, { recursive: true, force: true })
  }
})
