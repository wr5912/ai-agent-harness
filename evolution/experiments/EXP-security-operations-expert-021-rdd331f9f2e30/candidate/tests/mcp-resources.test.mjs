// 在锁定 Runtime 容器中执行，使用真实 SDK 生命周期和本地受控上游。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { apply, listAll, resourceOwner, snapshot } from '../dsh/managed/mcp-manager/index.mjs'
import { callOpenApiTool, OPENAPI_RESPONSE_META_KEY } from '../dsh/managed/mcp-manager/openapi.mjs'

const require = createRequire(process.env.DSH_MCP_CLIENT_ANCHOR || '/opt/dsh/packages/mcp/mcp-client/package.json')
const { Client, StreamableHTTPClientTransport, isCallToolResult } = require('@modelcontextprotocol/client')
const { McpServer, createMcpHandler } = require('@modelcontextprotocol/server')
const { toNodeHandler } = require('@modelcontextprotocol/node')
const token = randomBytes(32).toString('hex')
const configOf = (servers, groups) => ({
  servers: { get: () => servers }, groups: { get: () => groups }, sharedToken: { get: () => token },
})
const member = (extra = {}) => ({ serverId: 'fixture', names: [], resourceUris: [], resourceTemplates: [], ...extra })
const server = { id: 'fixture', enabled: true, url: 'http://127.0.0.1:1/mcp', tools: { mode: 'all', names: [] } }

test('实际新实例seed可通过manager snapshot，未配置资源的成员不会阻断插件激活', () => {
  const { load } = require('js-yaml')
  const seed = load(readFileSync(new URL('../dsh/managed/web-profile.seed.patch.yml', import.meta.url), 'utf8'))
  const config = seed.flatMap(item => item.insert ?? []).find(item => item.id === 'mcp-session-manager').config
  const value = snapshot({ servers: { get: () => config.servers }, groups: { get: () => config.groups }, sharedToken: { get: () => config.sharedToken } })
  const runtime = value.groups.find(group => group.id === 'threat-analysis-runtime')
  assert.ok(runtime)
  assert.ok(runtime.members.every(member => [member.names, member.resourceUris ?? [], member.resourceTemplates ?? []].some(items => items.length)))
  assert.ok(runtime.members.some(member => member.serverId === 'ai-soc-correlate'))
  assert.ok(!runtime.members.some(member => ['ai-soc-detect', 'ai-soc-master', 'ai-soc-ingest'].includes(member.serverId)))
})

test('OpenAPI 工具结果在成功和失败时都保留结构化 HTTP 状态', async () => {
  const http = createServer((req, res) => {
    if (req.url === '/created') {
      res.writeHead(201, { 'content-type': 'application/json' })
      return res.end('{"result":"created"}')
    }
    res.writeHead(409, { 'content-type': 'application/json' })
    res.end('{"message":"claimed by another worker"}')
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const base = new URL(`http://127.0.0.1:${http.address().port}`)
  const operation = path => ({ method: 'post', path, parameters: [], raw: {} })
  const source = {
    base,
    server: { id: 'openapi-fixture', apiKey: '', authType: '' },
    readable: [],
    operations: new Map([
      ['created', operation('/created')],
      ['conflict', operation('/conflict')],
    ]),
  }
  try {
    const created = await callOpenApiTool(source, 'created', {})
    assert.equal(isCallToolResult(created), true)
    assert.equal(created.isError, false)
    assert.deepEqual(created._meta, { [OPENAPI_RESPONSE_META_KEY]: { status: 201 } })
    assert.equal(created.content[0].text, '{"result":"created"}')

    const conflict = await callOpenApiTool(source, 'conflict', {})
    assert.equal(isCallToolResult(conflict), true)
    assert.equal(conflict.isError, true)
    assert.deepEqual(conflict._meta, { [OPENAPI_RESPONSE_META_KEY]: { status: 409 } })
    assert.equal(conflict.content[0].text, '{"message":"claimed by another worker"}')
  } finally {
    await new Promise(resolve => http.close(resolve))
  }
})

test('完整分页及重复游标拒绝', async () => {
  const calls = []
  const client = { async listResources(params) {
    calls.push(params?.cursor)
    return params?.cursor ? { resources: [{ uri: 'fixture://second' }] }
      : { resources: [{ uri: 'fixture://first' }], nextCursor: 'page-2' }
  } }
  assert.equal((await listAll(client, 'listResources', 'resources')).resources.length, 2)
  assert.deepEqual(calls, [undefined, 'page-2'])
  await assert.rejects(listAll({ listResources: async () => ({ resources: [], nextCursor: 'repeat' }) },
    'listResources', 'resources'), /分页游标重复/)
})

test('旧分组兼容，资源独立分组与范围验证', () => {
  assert.equal(snapshot(configOf([server], [{ id: 'old', members: [{ serverId: 'fixture', names: ['lookup'] }] }])).groups.length, 1)
  const target = { kind: 'group', servers: [server], group: { id: 'data', members: [
    member({ resourceUris: ['fixture://selected'], resourceTemplates: ['fixture://record/{id}'] }),
  ] } }
  assert.equal(snapshot(configOf([server], [target.group])).groups.length, 1)
  assert.equal(resourceOwner(target, 'fixture://selected').id, 'fixture')
  assert.equal(resourceOwner(target, 'fixture://record/42').id, 'fixture')
  assert.throws(() => resourceOwner(target, 'fixture://private'), /不属于/)
  assert.throws(() => resourceOwner({ ...target, servers: [{ ...server, enabled: false }] }, 'fixture://selected'), /不属于/)
  assert.throws(() => snapshot(configOf([server], [{ id: 'bad', members: [member()] }])), /成员无效/)
  assert.throws(() => snapshot(configOf([server], [{ id: 'bad', members: [member({ resourceUris: ['same', 'same'] })] }])), /选择重复/)
  assert.throws(() => snapshot(configOf([server], [{ id: 'bad', members: [member({ names: ['lookup'] }), member({ names: ['other'] })] }])), /成员无效/)
  assert.throws(() => resourceOwner({ ...target, servers: [server, { ...server, id: 'second' }],
    group: { members: [...target.group.members, member({ serverId: 'second', resourceUris: ['fixture://selected'] })] } },
    'fixture://selected'), /匹配多个来源/)
})

test('真实 MCP 分组发现、成员失败隔离、分页、工具调用、资源及模板读取', async () => {
  const receipts = []
  const upstream = createMcpHandler(() => {
    const mcp = new McpServer({ name: 'fixture', version: '1' }, { capabilities: { tools: {}, resources: {} } })
    mcp.server.setRequestHandler('tools/list', async request => request.params?.cursor
      ? { tools: [{ name: 'hidden', inputSchema: { type: 'object' } }] }
      : { tools: [{ name: 'lookup', inputSchema: { type: 'object' } }], nextCursor: 'tools-2' })
    mcp.server.setRequestHandler('tools/call', async request => {
      receipts.push(request.params.name)
      return { content: [{ type: 'text', text: 'lookup receipt' }] }
    })
    mcp.server.setRequestHandler('resources/list', async request => request.params?.cursor
      ? { resources: [{ uri: 'fixture://selected', name: 'Selected' }] }
      : { resources: [{ uri: 'fixture://private', name: 'Private' }], nextCursor: 'resources-2' })
    mcp.server.setRequestHandler('resources/templates/list', async () => ({
      resourceTemplates: [{ uriTemplate: 'fixture://record/{id}', name: 'Record' }],
    }))
    mcp.server.setRequestHandler('resources/read', async request => {
      receipts.push(request.params.uri)
      return { contents: [{ uri: request.params.uri, mimeType: 'text/plain', text: 'fixture data 42' }] }
    })
    return mcp
  })
  const routes = []
  const http = createServer((req, res) => {
    const route = routes.find(route => req.url.split('?')[0].startsWith(route.path))
    if (route) void route.handler(req, res)
    else void toNodeHandler(upstream)(req, res)
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${http.address().port}`
  const groups = [
    { id: 'mixed', members: [member({ names: ['lookup'], resourceUris: ['fixture://selected'], resourceTemplates: ['fixture://record/{id}'] })] },
    { id: 'data', members: [member({ resourceUris: ['fixture://selected'] })] },
    { id: 'resilient', members: [member({ names: ['lookup'] }), member({ serverId: 'unavailable', names: ['missing'] })] },
  ]
  apply({ effect: fn => fn(), provide() {}, webServer: { register: route => routes.push(route) },
    connection: { requestRejection: () => undefined }, on: () => {} },
    configOf([{ ...server, url: url + '/upstream' },
      { ...server, id: 'unavailable', url: 'http://127.0.0.1:1/mcp' }], groups))
  const connect = async id => {
    const client = new Client({ name: 'test', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp/groups/' + id),
      { requestInit: { headers: { authorization: 'Bearer ' + token } } }))
    return client
  }
  const clients = []
  const { Context } = require('@deepseek-ai/cordis')
  const ctx = new Context()
  try {
    assert.equal((await fetch(url + '/mcp/groups/mixed')).status, 401)
    const discovered = await fetch(url + '/api/mcp-manager', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverId: 'fixture', action: 'test' }) }).then(r => r.json())
    assert.equal(discovered.tools.length, 2)
    assert.equal(discovered.resources.resources.length, 2)
    assert.equal(discovered.resourceTemplates.resourceTemplates.length, 1)
    const client = await connect('mixed'); clients.push(client)
    assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['mcp__fixture__lookup'])
    assert.deepEqual((await client.listResources()).resources.map(r => r.uri), ['fixture://selected'])
    assert.equal((await client.listResourceTemplates()).resourceTemplates[0].uriTemplate, 'fixture://record/{id}')
    assert.equal((await client.callTool({ name: 'mcp__fixture__lookup', arguments: {} })).content[0].text, 'lookup receipt')
    assert.equal((await client.readResource({ uri: 'fixture://selected' })).contents[0].text, 'fixture data 42')
    assert.equal((await client.readResource({ uri: 'fixture://record/42' })).contents[0].text, 'fixture data 42')
    await assert.rejects(client.readResource({ uri: 'fixture://private' }), /不属于/)
    await assert.rejects(client.callTool({ name: 'mcp__fixture__hidden', arguments: {} }), /不属于/)
    const data = await connect('data'); clients.push(data)
    assert.deepEqual((await data.listTools()).tools, [])
    assert.equal((await data.readResource({ uri: 'fixture://selected' })).contents.length, 1)

    const resilient = await connect('resilient'); clients.push(resilient)
    assert.deepEqual((await resilient.listTools()).tools.map(tool => tool.name), ['mcp__fixture__lookup'])
    await assert.rejects(resilient.callTool({ name: 'mcp__unavailable__missing', arguments: {} }))
    assert.deepEqual(receipts, ['lookup', 'fixture://selected', 'fixture://record/42', 'fixture://selected'])

    // 通过锁定 DSH 的模型工具执行器读取同一个真实分组，而非只验证协议客户端。
    await ctx.plugin(require('@deepseek-ai/dsh-system-prompt').default)
    await ctx.plugin(require('@deepseek-ai/dsh-tools').default, { mode: 'native' })
    await ctx.plugin(require('@deepseek-ai/dsh-mcp-resources').default)
    await ctx.plugin(require('@deepseek-ai/dsh-mcp-client'), {
      transport: 'streamable-http', serverName: 'group-data', url: url + '/mcp/groups/mixed',
      headers: { authorization: 'Bearer ' + token }, toolCallTimeoutMs: 5000, failOnStartupError: true,
      reconnect: { enabled: false },
    })
    const agent = { session: { header: { delegationDepth: 0 } } }
    const { createSecurityOperationsGuard } = await import('../dsh/managed/security-operations-guard.mjs')
    const guard = createSecurityOperationsGuard()
    ctx.tools.guard(exec => guard.decide(exec))
    const call = (name, args) => ctx.tools.execute({ name, arguments: args, agent,
      callId: 'resource-fixture', signal: new AbortController().signal })
    const listed = await call('list_mcp_resources', { server: 'group-data' })
    assert.equal(listed.isError, false, JSON.stringify(listed))
    assert.equal(listed.value.resources[0].uri, 'fixture://selected')
    const templates = await call('list_mcp_resource_templates', { server: 'group-data' })
    assert.equal(templates.isError, false, JSON.stringify(templates))
    assert.equal(templates.value.resourceTemplates[0].uriTemplate, 'fixture://record/{id}')
    const read = await call('read_mcp_resource', { server: 'group-data', uri: 'fixture://record/42' })
    assert.equal(read.isError, false, JSON.stringify(read))
    assert.equal(read.value.contents[0].text, 'fixture data 42')
    assert.equal((await call('read_mcp_resource', { server: 'group-data', uri: 'fixture://private' })).isError, true)
    assert.equal((await call('read_mcp_resource', { server: 'missing', uri: 'fixture://selected' })).isError, true)
    assert.equal(receipts.at(-1), 'fixture://record/42')
  } finally {
    await ctx.fiber.dispose()
    await Promise.all(clients.map(client => client.close()))
    await upstream.close()
    await new Promise(resolve => http.close(resolve))
  }
})
