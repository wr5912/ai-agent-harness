import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as plugin from '../lib/index.js'

test('原生认证保护三个写入域与 MCP 生命周期，卸载同时移除 RPC 和网关', async t => {
  const root = new Context()
  const assetRoot = mkdtempSync(join(tmpdir(), 'harness-native-auth-'))
  const previous = process.env.HARNESS_ASSET_ROOT
  process.env.HARNESS_ASSET_ROOT = assetRoot
  t.after(async () => {
    await root.fiber.dispose()
    rmSync(assetRoot, { recursive: true, force: true })
    if (previous === undefined) delete process.env.HARNESS_ASSET_ROOT
    else process.env.HARNESS_ASSET_ROOT = previous
  })
  mkdirSync(join(assetRoot, 'agents/auth-agent'), { recursive: true })
  // 仅替换认证记录的存储，签名 Cookie、认证交接及 HTTP/RPC/Fetch 均运行原生实现。
  class Credentials extends Service {
    records = new Map()
    constructor(ctx) { super(ctx, 'credentials') }
    async modifyRecord(key, update) {
      const next = await update(this.records.get(key))
      if (next) this.records.set(key, next)
      return this.records.get(key)
    }
  }
  await root.plugin({ name: 'test-credentials', apply(ctx) { new Credentials(ctx) } })
  await root.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await root.plugin(Connection)
  const loaded = root.plugin(plugin)
  await loaded
  assert.equal(loaded.state, 2)
  const base = `http://127.0.0.1:${root.webServer.port}`
  root.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
    if (root.connection.authorizeIndex(req, res)) res.end('index')
  } })
  const request = (path, body, cookie) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  const envelope = method => ({ type: 'client-request', rpcId: 'test-request', method, payload: {} })
  for (const method of ['agents/create', 'instances/run', 'mcp/registerOpenApi']) {
    assert.equal((await request(`/harness-platform/${method}`, envelope(method))).status, 401)
  }
  const gateway = '/api/harness-platform/mcp'
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'native-test', version: '1' },
  } }
  assert.equal((await request(gateway, initialize)).status, 401)
  const handoff = await fetch(root.connection.authenticatedUrl(base + '/'), { redirect: 'manual' })
  assert.equal(handoff.status, 303)
  const cookie = handoff.headers.get('set-cookie').split(';')[0]
  const inventory = await request('/harness-platform/inventory', envelope('inventory'), cookie)
  assert.equal((await inventory.json()).result.value.root, assetRoot)
  const init = await request(gateway, initialize, cookie)
  assert.equal(init.status, 200)
  assert.equal((await init.json()).result.protocolVersion, '2025-06-18')
  assert.equal((await request(gateway, { jsonrpc: '2.0', method: 'notifications/initialized' }, cookie)).status, 202)
  const tools = await request(gateway, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, cookie)
  const list = (await tools.json()).result.tools
  assert.equal(list.length, 1)
  const call = await request(gateway, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: list[0].name, arguments: {} } }, cookie)
  const failed = await call.json()
  assert.ok(failed.error || failed.result?.isError)
  await loaded.dispose()
  assert.equal((await request('/harness-platform/inventory', envelope('inventory'), cookie)).status, 404)
  assert.equal((await request(gateway, initialize, cookie)).status, 404)
})
