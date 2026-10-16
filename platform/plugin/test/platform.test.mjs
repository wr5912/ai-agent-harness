import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createPlatformHandler } from '../lib/index.js'

test('模块分派保留认证 peer、取消信号与负载；未知操作不触发模块', async () => {
  const calls = []
  const handler = createPlatformHandler('/unused', Object.fromEntries(['agents', 'instances', 'mcp'].map(domain =>
    [domain, async (...args) => { calls.push({ domain, args }); return { ok: true, value: domain } }])))
  const signal = new AbortController().signal
  const peer = { id: 'authenticated-peer' }
  const payload = { name: 'selected' }
  for (const domain of ['agents', 'instances', 'mcp']) {
    assert.equal((await handler(`${domain}/list`, payload, signal, peer)).value, domain)
    assert.deepEqual(calls.at(-1), { domain, args: ['list', payload, signal, peer] })
  }
  assert.equal((await handler('other/list', {}, signal, peer)).error.code, 'not_found')
  const cancelled = new AbortController()
  cancelled.abort()
  assert.equal((await handler('instances/delete', {}, cancelled.signal, peer)).error.code, 'aborted')
  assert.equal(calls.length, 3)
})

test('首页按冻结 Run 创建时间排序，保留失败状态，不以目录编号或文件时间推断最近结果', async t => {
  const root = mkdtempSync(join(tmpdir(), 'harness-home-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'agents/test-agent'), { recursive: true })
  const records = [
    ['EXP-test-agent-001', 'run-00000000-0000-4000-8000-000000000001', '2026-10-13T01:00:00Z', 'failed'],
    ['EXP-test-agent-099', 'run-00000000-0000-4000-8000-000000000099', '2026-10-12T01:00:00Z', 'completed'],
  ]
  for (const [experiment, id, created, status] of records) {
    const path = join(root, 'evolution/experiments', experiment)
    mkdirSync(join(path, 'runs', id), { recursive: true })
    writeFileSync(join(path, 'change.yaml'), `status: active\n`)
    writeFileSync(join(path, 'runs', id, 'run.yaml'), `run_id: ${id}\ncreated_at: ${created}\nstatus: ${status}\n`)
    if (status === 'completed') writeFileSync(join(path, 'runs', id, 'summary.json'), JSON.stringify({ effective_verdict: 'failed' }))
  }
  const handler = createPlatformHandler(root, {
    instances: async () => ({ ok: false, error: { message: 'Docker 暂不可用' } }),
    mcp: async () => ({ ok: true, value: { connections: [] } }),
  })
  const signal = new AbortController().signal
  const response = await handler('home', {}, signal)
  assert.equal(response.ok, true)
  assert.equal(response.value.recent_runs[0].experiment_id, 'EXP-test-agent-001')
  assert.equal(response.value.recent_runs[0].status, 'failed')
  assert.equal(response.value.recent_runs[0].agent_id, 'test-agent')
  assert.equal(response.value.recent_runs[1].status, 'completed')
  assert.equal(response.value.recent_runs[1].effective_verdict, 'failed')
  assert.equal(response.value.instances.ok, false)
  assert.equal(response.value.mcp.value.connections.length, 0)
  assert.equal((await handler('home', { root: '/etc' }, signal)).error.code, 'invalid_request')
})
