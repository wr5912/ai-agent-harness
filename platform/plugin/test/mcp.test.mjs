import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { build } from 'esbuild'

async function loadMcpModule() {
  const outdir = await mkdtemp(join(tmpdir(), 'mcp-module-'))
  const outfile = join(outdir, 'index.mjs')
  await build({
    entryPoints: ['src/mcp/index.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
  })
  return import(outfile)
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function jsonRpc(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : undefined }
}

async function withFixture(fn) {
  const calls = []
  let baseUrl = ''
  const spec = () => ({
    openapi: '3.0.0',
    info: { title: 'fixture', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/assets/{asset}': {
        get: {
          operationId: 'get_asset',
          parameters: [{ name: 'asset', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/alerts': {
        get: {
          operationId: 'list_alerts',
          parameters: [
            { name: 'assetId', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
        },
      },
    },
  })
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local')
    const authed = req.headers.authorization === 'Bearer secret-token'
    calls.push({ path: url.pathname, search: url.search, authed })
    if (url.pathname === '/openapi.json') {
      if (!authed) return res.writeHead(401).end('auth required')
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(spec()))
    }
    if (!authed) return res.writeHead(403).end('forbidden')
    if (url.pathname.startsWith('/assets/')) {
      const asset = decodeURIComponent(url.pathname.slice('/assets/'.length))
      if (asset === 'bad') return res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'missing' }))
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'asset-123', name: asset, echo: 'secret-token' }))
    }
    if (url.pathname === '/alerts') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        alerts: [
          { id: 'a1', assetId: url.searchParams.get('assetId') },
          { id: 'a2', assetId: url.searchParams.get('assetId') },
          { id: 'a3', assetId: url.searchParams.get('assetId') },
        ],
      }))
    }
    res.writeHead(404).end('not found')
  })
  const port = await listen(server)
  baseUrl = `http://127.0.0.1:${port}`
  try {
    await fn({ baseUrl, calls })
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function withServer(handler, fn) {
  const server = createServer(handler)
  const port = await listen(server)
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function setup(module, baseUrl) {
  const temp = await mkdtemp(join(tmpdir(), 'mcp-test-'))
  const credentialPath = join(temp, 'token.txt')
  await writeFile(credentialPath, 'secret-token\n', 'utf8')
  const handler = module.createMcpHandler(process.cwd(), { stateFile: join(temp, 'state.json') })
  const rpc = (endpoint, payload) => handler(endpoint, payload, new AbortController().signal, undefined)
  const registered = await rpc('registerOpenApi', {
    id: 'security-readonly-api',
    title: 'Security Readonly API',
    specUrl: `${baseUrl}/openapi.json`,
    credentialRef: { kind: 'file', path: credentialPath },
  })
  assert.equal(registered.ok, true)
  return { handler, rpc }
}

test('MCP 组合执行两次真实 HTTP 调用并映射参数', async () => {
  const module = await loadMcpModule()
  await withFixture(async ({ baseUrl, calls }) => {
    const { rpc } = await setup(module, baseUrl)
    const result = await rpc('executeComposition', { asset: 'host-a', limit: 2 })
    assert.equal(result.ok, true)
    assert.equal(result.value.ok, true)
    assert.equal(result.value.result.alerts.length, 2)
    assert.equal(result.value.result.trace[1].mappedArguments.assetId, 'asset-123')
    assert.equal(calls.filter(call => call.path === '/assets/host-a').length, 1)
    assert.equal(calls.filter(call => call.path === '/alerts' && call.search.includes('assetId=asset-123')).length, 1)
    assert.equal(JSON.stringify(result).includes('secret-token'), false)
  })
})

test('前置失败时停止第二步', async () => {
  const module = await loadMcpModule()
  await withFixture(async ({ baseUrl, calls }) => {
    const { rpc } = await setup(module, baseUrl)
    const result = await rpc('executeComposition', { asset: 'bad', limit: 2 })
    assert.equal(result.ok, true)
    assert.equal(result.value.ok, false)
    assert.equal(result.value.result.trace[1].status, 'skipped')
    assert.equal(calls.some(call => call.path === '/alerts'), false)
  })
})

test('Gateway 生命周期发现和调用使用同一执行入口与 digest', async () => {
  const module = await loadMcpModule()
  await withFixture(async ({ baseUrl }) => {
    const { handler, rpc } = await setup(module, baseUrl)
    const server = createServer(module.createMcpGatewayRequestHandler(process.cwd(), handler))
    const port = await listen(server)
    const url = `http://127.0.0.1:${port}`
    try {
      const init = await jsonRpc(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
      assert.equal(init.status, 200)
      assert.equal(init.body.result.serverInfo.name, 'harness-platform-mcp-composition')
      const notified = await jsonRpc(url, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
      assert.equal(notified.status, 202)
      const listed = await jsonRpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      assert.equal(listed.status, 200)
      assert.equal(listed.body.result.tools[0].name, 'query_asset_related_alerts')
      const gatewayCall = await jsonRpc(url, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'query_asset_related_alerts', arguments: { asset: 'host-a', limit: 2 } },
      })
      assert.equal(gatewayCall.status, 200)
      const gatewayValue = JSON.parse(gatewayCall.body.result.content[0].text)
      const guiValue = await rpc('executeComposition', { asset: 'host-a', limit: 2 })
      assert.equal(gatewayValue.ok, true)
      assert.equal(gatewayValue.version.digest, guiValue.value.version.digest)
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })
})

test('只读组合拒绝同名 POST 操作', async () => {
  const module = await loadMcpModule()
  await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local')
    if (url.pathname === '/openapi.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'fixture', version: '1.0.0' },
      servers: [{ url: `http://${req.headers.host}` }],
      paths: {
        '/assets': { post: { operationId: 'get_asset', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } } },
        '/alerts': { get: { operationId: 'list_alerts', parameters: [{ name: 'assetId', in: 'query', required: true, schema: { type: 'string' } }] } },
      },
    }))
    res.writeHead(500).end('should not call')
  }, async baseUrl => {
    const temp = await mkdtemp(join(tmpdir(), 'mcp-readonly-'))
    const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(temp, 'state.json') })
    assert.equal((await rpc('registerOpenApi', { id: 'security-readonly-api', specUrl: `${baseUrl}/openapi.json` })).ok, true)
    const result = await rpc('executeComposition', { asset: 'host-a' }, new AbortController().signal)
    assert.equal(result.ok, false)
    assert.match(result.error.message, /非 GET/)
  })
})

test('连接登记可重载和删除，重启后状态回到 unknown', async () => {
  const module = await loadMcpModule()
  await withFixture(async ({ baseUrl }) => {
    const temp = await mkdtemp(join(tmpdir(), 'mcp-state-'))
    const credentialPath = join(temp, 'secret-ref.txt')
    const stateFile = join(temp, 'state.json')
    await writeFile(credentialPath, 'secret-token\n', 'utf8')
    const first = module.createMcpHandler(process.cwd(), { stateFile })
    assert.equal((await first('registerOpenApi', { id: 'security-readonly-api', specUrl: `${baseUrl}/openapi.json`, credentialRef: { kind: 'file', path: credentialPath } })).ok, true)
    assert.equal((await readFile(stateFile, 'utf8')).includes('secret-token'), false)

    const second = module.createMcpHandler(process.cwd(), { stateFile })
    const listed = await second('list', {})
    assert.equal(listed.ok, true)
    assert.equal(listed.value.connections[0].status.specLoaded, 'unknown')
    assert.equal(listed.value.connections[0].status.toolCallSucceeded, 'unknown')

    assert.equal((await second('deleteConnection', { connectionId: 'security-readonly-api' })).ok, true)
    const afterDelete = await module.createMcpHandler(process.cwd(), { stateFile })('list', {})
    assert.equal(afterDelete.value.connections.length, 0)
  })
})

test('HTTP MCP 登记、发现 tools/list 与单工具试跑', async () => {
  const module = await loadMcpModule()
  const seen = []
  let sessionSeq = 0
  await withServer(async (req, res) => {
    let text = ''
    req.on('data', chunk => { text += chunk })
    req.on('end', () => {
      const body = JSON.parse(text)
      const session = req.headers['mcp-session-id']
      const protocol = req.headers['mcp-protocol-version']
      seen.push({ method: body.method, accept: req.headers.accept, session, protocol })
      if (!String(req.headers.accept).includes('application/json') || !String(req.headers.accept).includes('text/event-stream')) return res.writeHead(406).end('bad accept')
      if (body.method === 'initialize') {
        const issued = `session-${++sessionSeq}`
        return res.writeHead(200, { 'content-type': 'application/json', 'Mcp-Session-Id': issued }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } } }))
      }
      if (!session || protocol !== '2024-11-05') return res.writeHead(428).end('missing session or protocol')
      if (body.method === 'notifications/initialized') return res.writeHead(202).end()
      if (body.method === 'tools/list') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object', required: ['body'], properties: { body: { type: 'object' } } } }, { name: 'fail', inputSchema: { type: 'object' } }, { name: 'sse', inputSchema: { type: 'object' } }] } }))
      if (body.method === 'tools/call' && body.params.name === 'fail') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'failed' }], isError: true } }))
      if (body.method === 'tools/call' && body.params.name === 'sse') return res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(body.params.arguments) }] } })}\n\n`)
      if (body.method === 'tools/call') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(body.params.arguments) }] } }))
      res.writeHead(404).end()
    })
  }, async baseUrl => {
    const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(await mkdtemp(join(tmpdir(), 'mcp-http-state-')), 'state.json') })
    assert.equal((await rpc('registerMcp', { id: 'managed-mcp', endpointUrl: baseUrl })).ok, true)
    const listed = await rpc('refreshSpec', { connectionId: 'managed-mcp' }, new AbortController().signal)
    assert.equal(listed.ok, true)
    assert.equal(listed.value.tools[0].name, 'echo')
    const called = await rpc('callTool', { connectionId: 'managed-mcp', toolName: 'echo', arguments: { body: { ok: true } } }, new AbortController().signal)
    assert.equal(called.ok, true)
    assert.equal(called.value.status.toolCallSucceeded, true)
    const failed = await rpc('callTool', { connectionId: 'managed-mcp', toolName: 'fail', arguments: {} }, new AbortController().signal)
    assert.equal(failed.ok, true)
    assert.equal(failed.value.status.toolCallSucceeded, false)
    const sse = await rpc('callTool', { connectionId: 'managed-mcp', toolName: 'sse', arguments: { body: { ok: 'sse' } } }, new AbortController().signal)
    assert.equal(sse.ok, true)
    assert.equal(JSON.parse(sse.value.content[0].text).body.ok, 'sse')
    assert.deepEqual(seen.slice(0, 3).map(item => item.method), ['initialize', 'notifications/initialized', 'tools/list'])
    assert.equal(seen[1].session, 'session-1')
    assert.equal(seen[2].session, 'session-1')
    assert.equal(seen[1].protocol, '2024-11-05')
  })
})

test('MCP 自定义凭据 Header 保持原始 secret 且错误脱敏', async () => {
  const module = await loadMcpModule()
  const temp = await mkdtemp(join(tmpdir(), 'mcp-custom-header-'))
  const credentialPath = join(temp, 'token.txt')
  await writeFile(credentialPath, 'secret-token\n', 'utf8')
  const headers = []
  await withServer(async (req, res) => {
    let text = ''
    req.on('data', chunk => { text += chunk })
    req.on('end', () => {
      headers.push(req.headers['x-api-key'])
      const body = JSON.parse(text)
      if (req.headers['x-api-key'] !== 'secret-token') return res.writeHead(401).end('bad secret-token')
      if (body.method === 'initialize') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }))
      if (body.method === 'notifications/initialized') return res.writeHead(202).end()
      if (body.method === 'tools/list') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'upstream secret-token failed' } }))
      res.writeHead(404).end()
    })
  }, async baseUrl => {
    const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(temp, 'state.json') })
    assert.equal((await rpc('registerMcp', { id: 'custom-mcp', endpointUrl: baseUrl, authHeader: 'X-Api-Key', credentialRef: { kind: 'file', path: credentialPath } })).ok, true)
    const result = await rpc('refreshSpec', { connectionId: 'custom-mcp' }, new AbortController().signal)
    assert.equal(result.ok, false)
    assert.equal(headers.includes('secret-token'), true)
    assert.equal(JSON.stringify(result).includes('Bearer secret-token'), false)
    assert.equal(JSON.stringify(result).includes('secret-token'), false)
  })
})

test('OpenAPI 单工具试跑校验必填 header 和 body', async () => {
  const module = await loadMcpModule()
  await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local')
    if (url.pathname === '/openapi.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'fixture', version: '1.0.0' },
      servers: [{ url: `http://${req.headers.host}` }],
      paths: {
        '/needs-header': { get: { operationId: 'needs_header', parameters: [{ name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } }] } },
        '/needs-body': { post: { operationId: 'needs_body', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } } } },
      },
    }))
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
  }, async baseUrl => {
    const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(await mkdtemp(join(tmpdir(), 'mcp-required-')), 'state.json') })
    assert.equal((await rpc('registerOpenApi', { id: 'tool-api', specUrl: `${baseUrl}/openapi.json` })).ok, true)
    const missingHeader = await rpc('callTool', { connectionId: 'tool-api', toolName: 'needs_header', arguments: {} }, new AbortController().signal)
    assert.equal(missingHeader.ok, false)
    assert.match(missingHeader.error.message, /缺少参数：X-Tenant/)
    const missingBody = await rpc('callTool', { connectionId: 'tool-api', toolName: 'needs_body', arguments: {} }, new AbortController().signal)
    assert.equal(missingBody.ok, false)
    assert.match(missingBody.error.message, /缺少参数：body/)
  })
})

test('取消贯通规范加载，失败不写成成功状态', async () => {
  const module = await loadMcpModule()
  await withServer((req, res) => {
    setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'), 100)
  }, async baseUrl => {
    const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(await mkdtemp(join(tmpdir(), 'mcp-abort-')), 'state.json') })
    await rpc('registerOpenApi', { id: 'security-readonly-api', specUrl: `${baseUrl}/openapi.json` })
    const result = await rpc('refreshSpec', { connectionId: 'security-readonly-api' }, AbortSignal.timeout(1))
    assert.equal(result.ok, false)
    const listed = await rpc('list', {})
    assert.equal(listed.value.connections[0].status.specLoaded, false)
  })
})

test('原生 Gateway 只注册 connection.fetch，不重复注册 RPC，且 GET 不支持', async () => {
  const module = await loadMcpModule()
  const calls = { fetch: [], rpc: [] }
  module.applyMcpGateway({
    connection: {
      fetch: { register: config => calls.fetch.push(config) },
      rpc: { handle: (...args) => calls.rpc.push(args) },
    },
  }, process.cwd(), module.createMcpHandler(process.cwd(), { stateFile: join(await mkdtemp(join(tmpdir(), 'mcp-gateway-')), 'state.json') }))
  assert.equal(calls.rpc.length, 0)
  assert.equal(calls.fetch[0].path, '/api/harness-platform/mcp')
  assert.deepEqual(calls.fetch[0].methods, ['POST'])
  assert.equal(calls.fetch[0].requestBody, 'buffered')
  assert.equal((await calls.fetch[0].fetch(new Request('http://fixture.local/api/harness-platform/mcp'))).status, 405)
  const init = await calls.fetch[0].fetch(new Request('http://fixture.local/api/harness-platform/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 'bad-version' } }),
  }))
  assert.equal((await init.json()).result.protocolVersion, '2025-06-18')
  const notification = await calls.fetch[0].fetch(new Request('http://fixture.local/api/harness-platform/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  }))
  assert.equal(notification.status, 202)
  const batch = await calls.fetch[0].fetch(new Request('http://fixture.local/api/harness-platform/mcp', {
    method: 'POST',
    body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]),
  }))
  assert.equal(batch.status, 400)
})

test('凭据不进入规范 URL、错误或运行结果', async () => {
  const module = await loadMcpModule()
  const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(await mkdtemp(join(tmpdir(), 'mcp-leak-')), 'state.json') })
  const rejected = await rpc('registerOpenApi', { id: 'security-readonly-api', specUrl: 'http://127.0.0.1/openapi.json?token=secret-token' })
  assert.equal(rejected.ok, false)
  await withFixture(async ({ baseUrl }) => {
    const { rpc: authed } = await setup(module, baseUrl)
    const result = await authed('executeComposition', { asset: 'host-a', limit: 1 })
    assert.equal(JSON.stringify(result).includes('secret-token'), false)
  })
})

test('OpenAPI 自定义凭据 Header 不加 Bearer 且结果按 literal 脱敏', async () => {
  const module = await loadMcpModule()
  const temp = await mkdtemp(join(tmpdir(), 'mcp-openapi-custom-'))
  const credentialPath = join(temp, 'token.txt')
  await writeFile(credentialPath, 'secret-token\n', 'utf8')
  const seen = []
  await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.local')
    seen.push(req.headers['x-api-key'])
    if (req.headers['x-api-key'] !== 'secret-token') return res.writeHead(401).end('bad auth')
    if (url.pathname === '/openapi.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'fixture', version: '1.0.0' },
      servers: [{ url: `http://${req.headers.host}` }],
      paths: { '/echo': { get: { operationId: 'echo_secret' } } },
    }))
    if (url.pathname === '/echo') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ echoed: 'secret-token' }))
    res.writeHead(404).end()
  }, async baseUrl => {
    const rpc = module.createMcpHandler(process.cwd(), { stateFile: join(temp, 'state.json') })
    assert.equal((await rpc('registerOpenApi', { id: 'custom-openapi', specUrl: `${baseUrl}/openapi.json`, authHeader: 'X-Api-Key', credentialRef: { kind: 'file', path: credentialPath } })).ok, true)
    const result = await rpc('callTool', { connectionId: 'custom-openapi', toolName: 'echo_secret', arguments: {} }, new AbortController().signal)
    assert.equal(result.ok, true)
    assert.equal(seen.includes('secret-token'), true)
    assert.equal(JSON.stringify(result).includes('Bearer secret-token'), false)
    assert.equal(JSON.stringify(result).includes('secret-token'), false)
  })
})

test('同 ID 重新登记会排除另一种连接类型，默认状态写入 XDG state', async () => {
  const module = await loadMcpModule()
  const assetRoot = await mkdtemp(join(tmpdir(), 'mcp-asset-root-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'mcp-xdg-state-'))
  const previous = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = stateRoot
  try {
    await withServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://fixture.local')
      if (url.pathname === '/openapi.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ openapi: '3.0.0', info: { title: 'fixture', version: '1.0.0' }, paths: {} }))
      res.writeHead(404).end()
    }, async baseUrl => {
      const rpc = module.createMcpHandler(assetRoot)
      assert.equal((await rpc('registerOpenApi', { id: 'same-id', specUrl: `${baseUrl}/openapi.json` })).ok, true)
      assert.equal((await rpc('registerMcp', { id: 'same-id', endpointUrl: baseUrl })).ok, true)
      const listed = await rpc('list', {})
      assert.equal(listed.value.connections.length, 1)
      assert.equal(listed.value.connections[0].kind, 'mcp-http')
      const rootKey = createHash('sha256').update(assetRoot).digest('hex').slice(0, 16)
      assert.equal((await readdir(join(stateRoot, 'ai-agent-harness', 'platform', 'mcp', rootKey))).includes('connections.json'), true)
    })
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous
  }
})
