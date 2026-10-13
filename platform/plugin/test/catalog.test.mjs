import assert from 'node:assert/strict'
import test from 'node:test'
import { createCatalog } from '../src/catalog.ts'

const assets = (id = 'test-agent') => ({
  schema_version: '1.0', root: '/fixture', observed_at: '2026-10-12T00:00:00.000Z',
  agents: id ? [{ id, path: `agents/${id}` }] : [], experiments: [], runs: [],
})

test('首次查询与刷新经过 RPC；失败保留之前成功清单并可恢复', async () => {
  let response = { ok: true, value: assets() }
  const calls = []
  const catalog = createCatalog({ call: async (...args) => { calls.push(args); return response } })
  let notifications = 0
  const dispose = catalog.subscribe(() => notifications++)
  await catalog.refresh()
  assert.deepEqual(calls[0], ['/harness-platform', 'inventory', {}])
  assert.equal(catalog.getSnapshot().status, 'ready')
  response = { ok: false, error: { code: 'asset_read_failed', message: '无法读取仓库资产', details: {} } }
  await catalog.refresh()
  assert.equal(catalog.getSnapshot().status, 'error')
  assert.equal(catalog.getSnapshot().error, '无法读取仓库资产')
  assert.equal(catalog.getSnapshot().inventory.agents[0].id, 'test-agent')
  response = { ok: true, value: assets('changed-agent') }
  await catalog.refresh()
  assert.equal(catalog.getSnapshot().status, 'ready')
  assert.equal(catalog.getSnapshot().inventory.agents[0].id, 'changed-agent')
  assert.equal(notifications, 6)
  dispose()
  await catalog.refresh()
  assert.equal(notifications, 6)
})

test('空清单保持成功状态；连接失败显示错误', async () => {
  const empty = createCatalog({ call: async () => ({ ok: true, value: assets('') }) })
  await empty.refresh()
  assert.equal(empty.getSnapshot().status, 'ready')
  assert.deepEqual(empty.getSnapshot().inventory.agents, [])
  const disconnected = createCatalog({ call: async () => { throw new Error('network') } })
  await disconnected.refresh()
  assert.equal(disconnected.getSnapshot().status, 'error')
  assert.equal(disconnected.getSnapshot().inventory, undefined)
  assert.match(disconnected.getSnapshot().error, /刷新重试/)
})

test('后发刷新先返回时，早期响应不能覆盖最新结果', async () => {
  const pending = []
  const catalog = createCatalog({ call: () => new Promise(resolve => pending.push(resolve)) })
  const first = catalog.refresh()
  const second = catalog.refresh()
  pending[1]({ ok: true, value: assets('latest-agent') })
  await second
  pending[0]({ ok: true, value: assets('stale-agent') })
  await first
  assert.equal(catalog.getSnapshot().inventory.agents[0].id, 'latest-agent')
})
