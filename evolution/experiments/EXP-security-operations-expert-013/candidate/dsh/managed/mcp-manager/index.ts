import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { callOpenApiTool, loadOpenApi, readOpenApiResource, validateSpecUrl } from './openapi.mjs'

const runtimeRequire = createRequire('/opt/dsh/packages/mcp/mcp-client/package.json')
const z = runtimeRequire('@deepseek-ai/schemastery')
const { Client, StreamableHTTPClientTransport } = runtimeRequire('@modelcontextprotocol/client')
const { McpServer, createMcpHandler } = runtimeRequire('@modelcontextprotocol/server')
const { toNodeHandler } = runtimeRequire('@modelcontextprotocol/node')
const { createScope, scopeParentOf } = await import(runtimeRequire.resolve('@deepseek-ai/dsh-scope'))
const McpClient = await import(runtimeRequire.resolve('@deepseek-ai/dsh-mcp-client'))

export const name = 'mcp-session-manager'
export const inject = ['agents', 'webServer', 'connection']

const key = z.string().required().pattern(/^[A-Za-z0-9_-]{1,32}$/)
const toolPolicy = z.object({
  mode: z.union([z.const('all'), z.const('selected')]).default('all'),
  names: z.array(z.string()).default([]),
})
const serverSchema = z.object({
  id: key,
  serverName: z.string(),
  description: z.string(),
  enabled: z.boolean().default(true),
  specUrl: z.string(),
  apiKey: z.string(),
  url: z.string(),
  urlEnv: z.string(),
  tokenEnv: z.string(),
  managementUrl: z.string(),
  tools: toolPolicy,
})
const groupSchema = z.object({
  id: key,
  members: z.array(z.object({ serverId: key, names: z.array(z.string()).default([]) })).default([]),
})
export const Config = z.object({
  servers: z.array(serverSchema).default([]).volatile(),
  groups: z.array(groupSchema).default([]).volatile(),
})

const sharedToken = process.env.DSH_WEB_MCP_SHARED_TOKEN || 'change-me'
const namePattern = /^[A-Za-z0-9_-]{1,32}$/
const MAX_BODY = 64 * 1024
const MAX_RESPONSE = 1024 * 1024

function validateUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('MCP 地址须为不含凭据、查询参数和片段的 HTTP(S) URL')
  }
  return url.href
}

function snapshot(config: any) {
  const servers = structuredClone(config.servers.get()) as any[]
  const groups = structuredClone(config.groups.get()) as any[]
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const server of servers) {
    const serverName = server.serverName || server.id
    if (!namePattern.test(server.id) || !namePattern.test(serverName)
      || ids.has(server.id) || names.has(serverName)) throw new Error('MCP 服务器 ID 或名称重复/无效')
    ids.add(server.id)
    names.add(serverName)
    if (server.specUrl) {
      validateSpecUrl(server.specUrl)
      if (server.url || server.urlEnv || server.managementUrl) throw new Error(`${server.id}: OpenAPI 与现成 MCP 连接不能混用`)
      continue
    }
    if (server.url) validateUrl(server.url)
    if (server.managementUrl) validateUrl(server.managementUrl)
    if (server.url && server.urlEnv) throw new Error(`${server.id}: 地址和环境变量来源只能设置一个`)
    if (!server.url && !server.urlEnv) throw new Error(`${server.id}: 缺少地址或环境变量来源`)
    if (server.tools.mode === 'selected' && new Set(server.tools.names).size !== server.tools.names.length) {
      throw new Error(`${server.id}: 工具名重复`)
    }
  }
  const groupIds = new Set<string>()
  for (const group of groups) {
    if (!namePattern.test(group.id) || groupIds.has(group.id)) throw new Error('MCP 分组 ID 重复/无效')
    groupIds.add(group.id)
    for (const member of group.members) {
      if (!ids.has(member.serverId) || !member.names.length || new Set(member.names).size !== member.names.length) {
        throw new Error(`${group.id}: 分组成员无效或工具名重复`)
      }
    }
  }
  return { servers, groups }
}

function resolvedUrl(server: any): string | undefined {
  const raw = server.url || process.env[server.urlEnv]
  return raw ? validateUrl(raw) : undefined
}

function resolvedToken(server: any): string | undefined {
  return server.tokenEnv ? process.env[server.tokenEnv] : undefined
}

function serverName(server: any): string { return server.serverName || server.id }

async function serverTools(server: any): Promise<any[]> {
  if (server.specUrl) return (await loadOpenApi(server)).tools
  return (await withClient(server, client => client.listTools())).tools
}

async function withClient<T>(server: any, run: (client: any) => Promise<T>): Promise<T> {
  const url = resolvedUrl(server)
  if (!url) throw new Error(`${server.id}: MCP 地址环境变量未配置`)
  const token = resolvedToken(server)
  if (server.tokenEnv && !token) throw new Error(`${server.id}: MCP 凭据环境变量未配置`)
  const client = new Client({ name: 'dsh-web-mcp-manager', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  })
  try {
    await client.connect(transport)
    return await run(client)
  } finally {
    await client.close()
  }
}

function send(res: any, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function bodyOf(req: any): Promise<any> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求超过 64 KiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function bearerAccepted(req: any): boolean {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice(7))
  const expected = Buffer.from(sharedToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

type Target = { kind: 'agent'; server: any } | { kind: 'group'; group: any; servers: any[] }

async function toolsFor(target: Target): Promise<any[]> {
  if (target.kind === 'agent') {
    const tools = await serverTools(target.server)
    return tools.filter((tool: any) => target.server.specUrl || target.server.tools.mode === 'all'
      || target.server.tools.names.includes(tool.name))
  }
  const result: any[] = []
  for (const member of target.group.members) {
    const server = target.servers.find(item => item.id === member.serverId && item.enabled)
    if (!server) continue
    const tools = await serverTools(server)
    for (const tool of tools) {
      if (member.names.includes(tool.name)) result.push({ ...tool, name: `mcp__${serverName(server)}__${tool.name}` })
    }
  }
  return result
}

function toolOwner(target: Target, name: string): { server: any; rawName: string } | undefined {
  if (target.kind === 'agent') {
    if (!target.server.specUrl && target.server.tools.mode === 'selected' && !target.server.tools.names.includes(name)) return
    return { server: target.server, rawName: name }
  }
  for (const member of target.group.members) {
    const server = target.servers.find(item => item.id === member.serverId && item.enabled)
    if (!server) continue
    const prefix = `mcp__${serverName(server)}__`
    if (name.startsWith(prefix) && member.names.includes(name.slice(prefix.length))) {
      return { server, rawName: name.slice(prefix.length) }
    }
  }
}

async function serveMcp(req: any, res: any, target: Target): Promise<void> {
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: target.kind === 'group' ? target.group.id : serverName(target.server),
      version: '0.1.0' }, { capabilities: target.kind === 'agent' ? { tools: {}, resources: {} } : { tools: {} } })
    mcp.server.setRequestHandler('tools/list', async () => ({ tools: await toolsFor(target) }))
    mcp.server.setRequestHandler('tools/call', async (request: any) => {
      const owner = toolOwner(target, request.params.name)
      if (!owner) throw new Error('工具不属于当前 MCP 范围')
      if (owner.server.specUrl) return callOpenApiTool(await loadOpenApi(owner.server), owner.rawName, request.params.arguments ?? {})
      return withClient(owner.server, client => client.callTool({ ...request.params, name: owner.rawName }))
    })
    if (target.kind === 'agent') {
      mcp.server.setRequestHandler('resources/list', async () => target.server.specUrl
        ? { resources: (await loadOpenApi(target.server)).resources }
        : withClient(target.server, client => client.listResources()))
      mcp.server.setRequestHandler('resources/templates/list', async () => target.server.specUrl
        ? { resourceTemplates: (await loadOpenApi(target.server)).resourceTemplates }
        : withClient(target.server, client => client.listResourceTemplates()))
      mcp.server.setRequestHandler('resources/read', async (request: any) => target.server.specUrl
        ? readOpenApiResource(await loadOpenApi(target.server), request.params.uri)
        : withClient(target.server, client => client.readResource(request.params)))
    }
    return mcp
  })
  try {
    await toNodeHandler(handler)(req, res)
  } finally {
    await handler.close()
  }
}

async function upstream(server: any, method: string, path: string, data?: unknown): Promise<any> {
  if (!server.managementUrl) throw new Error(`${server.id}: 未设置 OpenAPI 管理地址`)
  const root = validateUrl(server.managementUrl)
  const response = await fetch(new URL(path, root.endsWith('/') ? root : `${root}/`), {
    method,
    headers: data === undefined ? {} : { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  })
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) throw new Error('上游响应超过 1 MiB')
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_RESPONSE) throw new Error('上游响应超过 1 MiB')
  let parsed: any
  try { parsed = text ? JSON.parse(text) : {} } catch { throw new Error('上游返回非 JSON') }
  if (!response.ok) throw new Error(`上游 HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 500)}`)
  return parsed
}

async function manage(server: any, request: any): Promise<any> {
  const { action, sourceId, toolName } = request
  const source = typeof sourceId === 'string' && /^[0-9a-fA-F-]{36}$/.test(sourceId) ? sourceId : undefined
  const tool = typeof toolName === 'string' && /^[A-Za-z0-9_.-]{1,160}$/.test(toolName) ? toolName : undefined
  const prefix = '/api/v1/mcp-resources'
  if (action === 'sources') return upstream(server, 'GET', prefix)
  if (action === 'create' && typeof request.name === 'string' && typeof request.specUrl === 'string') {
    return upstream(server, 'POST', prefix, { name: request.name, spec_url: validateUrl(request.specUrl) })
  }
  if (!source) throw new Error('OpenAPI 来源 ID 无效')
  if (action === 'refresh') return upstream(server, 'POST', `${prefix}/${source}/refresh`)
  if (action === 'toggle' && typeof request.enabled === 'boolean') {
    return upstream(server, 'PATCH', `${prefix}/${source}`, { enabled: request.enabled })
  }
  if (action === 'components') return upstream(server, 'GET', `${prefix}/${source}/components`)
  if (action === 'logs') return upstream(server, 'GET', `${prefix}/${source}/logs`)
  if ((action === 'preview' || action === 'invoke') && tool) {
    return upstream(server, 'POST', `${prefix}/${source}/tools/${tool}/${action}`, { arguments: request.arguments ?? {} })
  }
  throw new Error('不支持的 OpenAPI 管理操作')
}

export function apply(ctx: any, config: any): void {
  const agents = new Map<string, Target>()
  const mounted = new Map<object, { version: string; ready: Promise<any[]>; users: number }>()
  snapshot(config)

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/mcp/groups', handler: async (req: any, res: any) => {
    if (!bearerAccepted(req)) return send(res, 401, { error: 'Bearer token required' })
    const id = new URL(req.url, 'http://localhost').pathname.split('/')[3]
    try {
      const current = snapshot(config)
      const group = current.groups.find(item => item.id === id)
      if (!group) return send(res, 404, { error: 'group not found' })
      await serveMcp(req, res, { kind: 'group', group, servers: current.servers })
    } catch (error) { if (!res.headersSent) send(res, 502, { error: String(error) }); else res.destroy() }
  } }), 'mcp-manager.groups')

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/mcp/agents', handler: async (req: any, res: any) => {
    if (!bearerAccepted(req)) return send(res, 401, { error: 'Bearer token required' })
    const id = new URL(req.url, 'http://localhost').pathname.split('/')[3]
    const target = agents.get(id)
    if (!target) return send(res, 404, { error: 'agent MCP endpoint not found' })
    try { await serveMcp(req, res, target) }
    catch (error) { if (!res.headersSent) send(res, 502, { error: String(error) }); else res.destroy() }
  } }), 'mcp-manager.agents')

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/mcp-manager', handler: async (req: any, res: any) => {
    const rejected = ctx.connection.requestRejection(req)
    if (rejected) return send(res, rejected, { error: 'unauthorized' })
    try {
      const current = snapshot(config)
      if (req.method === 'GET') return send(res, 200, {
        servers: current.servers.map(server => ({ id: server.id, enabled: server.enabled,
          addressConfigured: Boolean(server.specUrl || resolvedUrl(server)), managementConfigured: Boolean(server.managementUrl) })),
        groupPaths: current.groups.map(group => ({ id: group.id, path: `/mcp/groups/${group.id}` })),
        tokenEnv: 'DSH_WEB_MCP_SHARED_TOKEN',
      })
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      const request = await bodyOf(req)
      const server = current.servers.find(item => item.id === request.serverId)
      if (!server) return send(res, 404, { error: 'MCP server not found' })
      if (request.action === 'test') {
        if (server.specUrl) {
          const source = await loadOpenApi(server)
          return send(res, 200, { tools: source.tools.map(({ name, description }: any) => ({ name, description })),
            resources: { resources: source.resources }, resourceTemplates: { resourceTemplates: source.resourceTemplates } })
        }
        const result = await withClient(server, async client => ({
          tools: (await client.listTools()).tools,
          resources: await client.listResources().catch(() => ({ resources: [] })),
        }))
        return send(res, 200, result)
      }
      if (request.action === 'resources' || request.action === 'resourceTemplates' || request.action === 'readResource') {
        if (server.specUrl) {
          const source = await loadOpenApi(server)
          const result = request.action === 'resources' ? { resources: source.resources }
            : request.action === 'resourceTemplates' ? { resourceTemplates: source.resourceTemplates }
              : await readOpenApiResource(source, request.uri)
          return send(res, 200, result)
        }
        const result = await withClient(server, client => request.action === 'resources' ? client.listResources()
          : request.action === 'resourceTemplates' ? client.listResourceTemplates()
            : client.readResource({ uri: request.uri }))
        return send(res, 200, result)
      }
      return send(res, 200, await manage(server, request))
    } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : String(error) }) }
  } }), 'mcp-manager.admin')

  ctx.on('agent/created', async ({ agent }: any) => {
    const preset = scopeParentOf(agent)
    if (!preset) return
    const current = snapshot(config)
    const version = JSON.stringify(current.servers)
    let entry = mounted.get(preset)
    if (!entry || entry.version !== version) {
      const previous = entry
      entry = { version, users: 0, ready: (async () => {
        if (previous) await Promise.all((await previous.ready.catch(() => [])).map(scope => scope.dispose()))
        const scopes: any[] = []
        try {
          for (const server of current.servers) {
            if (!server.enabled || !(server.specUrl || resolvedUrl(server))) continue
            const id = randomUUID()
            const scope = createScope(ctx, preset)
            scopes.push(scope)
            agents.set(id, { kind: 'agent', server })
            scope.ctx.effect(() => () => { agents.delete(id) }, 'mcp-manager.agent-endpoint')
            await scope.ctx.plugin(McpClient, McpClient.Config({
              transport: 'streamable-http',
              serverName: serverName(server),
              url: `http://127.0.0.1:${ctx.webServer.port}/mcp/agents/${id}`,
              headers: { Authorization: `Bearer ${sharedToken}` },
              failOnStartupError: true,
              reconnect: { enabled: false },
            }))
          }
          return scopes
        } catch (error) {
          await Promise.all(scopes.map(scope => scope.dispose()))
          throw error
        }
      })() }
      mounted.set(preset, entry)
    }
    entry.users++
    try { await entry.ready }
    catch (error) {
      entry.users--
      if (mounted.get(preset) === entry) mounted.delete(preset)
      throw error
    }
    agent.ctx.effect(() => async () => {
      entry.users--
      if (entry.users === 0) {
        if (mounted.get(preset) === entry) mounted.delete(preset)
        await Promise.all((await entry.ready).map(scope => scope.dispose()))
      }
    }, 'mcp-manager.agent')
  }, { prepend: true })
}
