import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createRequire } from 'node:module'
import { callOpenApiTool, loadOpenApi, readOpenApiResource, validateAuthHeader, validateSpecUrl } from './openapi.mjs'

const runtimeRequire = createRequire(process.env.DSH_MCP_CLIENT_ANCHOR || '/opt/dsh/packages/mcp/mcp-client/package.json')
const z = runtimeRequire('@deepseek-ai/schemastery')
const { Client, StreamableHTTPClientTransport, UriTemplate } = runtimeRequire('@modelcontextprotocol/client')
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
  authType: z.string(),
  authHeader: z.string(),
  loginUrl: z.string(),
  loginUsername: z.string(),
  loginPassword: z.string(),
  loginTokenPath: z.string(),
  url: z.string(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  managementUrl: z.string(),
  tools: toolPolicy,
})
const groupSchema = z.object({
  id: key,
  members: z.array(z.object({ serverId: key, names: z.array(z.string()).default([]),
    resourceUris: z.array(z.string()).default([]), resourceTemplates: z.array(z.string()).default([]) })).default([]),
})
export const Config = z.object({
  servers: z.array(serverSchema).default([]).volatile(),
  groups: z.array(groupSchema).default([]).volatile(),
  sharedToken: z.string().default('').volatile(),
})

const namePattern = /^[A-Za-z0-9_-]{1,32}$/
const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const MAX_BODY = 64 * 1024
const MAX_RESPONSE = 1024 * 1024

function validateUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('MCP 地址须为不含凭据、查询参数和片段的 HTTP(S) URL')
  }
  return url.href
}

export function snapshot(config: any) {
  const servers = structuredClone(config.servers.get()) as any[]
  const groups = structuredClone(config.groups.get()) as any[]
  const sharedToken = config.sharedToken.get() as string
  if (sharedToken && !/^[0-9a-f]{64}$/.test(sharedToken)) throw new Error('统一 Token 格式无效；请在工具与资源分组页重新生成')
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
      if (server.url || server.managementUrl || server.headers?.length) throw new Error(`${server.id}: OpenAPI 与现成 MCP 连接不能混用`)
      if (server.authType === 'login') {
        if (server.enabled && (!server.loginUrl || !server.loginUsername || !server.loginPassword || !server.loginTokenPath)) throw new Error(`${server.id}: 登录授权信息不完整`)
        if (server.loginUrl) validateSpecUrl(server.loginUrl)
        if (server.loginTokenPath && !server.loginTokenPath.split('.').every((part: string) => /^[A-Za-z_][\w-]*$/.test(part))) throw new Error(`${server.id}: 凭据字段路径无效`)
      } else if (server.authType === 'credential') {
        validateAuthHeader(server.authHeader ?? 'Authorization')
      } else if (server.authType) throw new Error(`${server.id}: 不支持的授权方式`)
      continue
    }
    if (server.url) validateUrl(server.url)
    if (server.managementUrl) validateUrl(server.managementUrl)
    if (server.enabled && !server.url) throw new Error(`${server.id}: 缺少 MCP URL`)
    const headerNames = new Set<string>()
    for (const header of server.headers ?? []) {
      const name = header.name?.toLowerCase()
      if (!headerNamePattern.test(header.name) || (server.enabled && !header.value) || /[\r\n]/.test(header.value) || headerNames.has(name)) {
        throw new Error(`${server.id}: 请求 Header 无效或重复`)
      }
      headerNames.add(name)
    }
    if (server.tools.mode === 'selected' && new Set(server.tools.names).size !== server.tools.names.length) {
      throw new Error(`${server.id}: 工具名重复`)
    }
  }
  const groupIds = new Set<string>()
  for (const group of groups) {
    if (!namePattern.test(group.id) || groupIds.has(group.id)) throw new Error('MCP 分组 ID 重复/无效')
    groupIds.add(group.id)
    const memberIds = new Set<string>()
    for (const member of group.members) {
      const selections = [member.names, member.resourceUris ?? [], member.resourceTemplates ?? []]
      if (!ids.has(member.serverId) || memberIds.has(member.serverId) || !selections.some(items => items.length)
        || selections.some(items => new Set(items).size !== items.length || items.some((item: string) => !item.trim()))) {
        throw new Error(`${group.id}: 分组成员无效或工具与资源选择重复`)
      }
      memberIds.add(member.serverId)
      for (const template of member.resourceTemplates ?? []) new UriTemplate(template)
    }
  }
  return { servers, groups, sharedToken }
}

function resolvedUrl(server: any): string | undefined {
  return server.url ? validateUrl(server.url) : undefined
}

function serverName(server: any): string { return server.serverName || server.id }

async function serverTools(server: any): Promise<any[]> {
  if (server.specUrl) return (await loadOpenApi(server)).tools
  return withClient(server, async client => client.getServerCapabilities()?.tools
    ? (await listAll(client, 'listTools', 'tools', server.signal)).tools : [])
}

export async function listAll(client: any, method: string, field: string, signal?: AbortSignal): Promise<any> {
  const items: any[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client[method](cursor ? { cursor } : undefined, { signal })
    items.push(...page[field])
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor)) throw new Error('MCP 分页游标重复')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return { [field]: items }
}

async function discover(server: any): Promise<any> {
  if (server.specUrl) {
    const source = await loadOpenApi(server)
    return { tools: source.tools, resources: { resources: source.resources },
      resourceTemplates: { resourceTemplates: source.resourceTemplates } }
  }
  return withClient(server, async client => ({
    tools: client.getServerCapabilities()?.tools ? (await listAll(client, 'listTools', 'tools', server.signal)).tools : [],
    resources: await listAll(client, 'listResources', 'resources', server.signal)
      .catch((error: Error) => ({ resources: [], unavailable: true, error: error.message })),
    resourceTemplates: await listAll(client, 'listResourceTemplates', 'resourceTemplates', server.signal)
      .catch((error: Error) => ({ resourceTemplates: [], unavailable: true, error: error.message })),
  }))
}

async function withClient<T>(server: any, run: (client: any) => Promise<T>): Promise<T> {
  const url = resolvedUrl(server)
  if (!url) throw new Error(`${server.id}: MCP URL 未配置`)
  const client = new Client({ name: 'dsh-web-mcp-manager', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: Object.fromEntries((server.headers ?? []).map(({ name, value }: any) => [name, value])) },
  })
  try {
    await client.connect(transport, { signal: server.signal })
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

function bearerAccepted(req: any, sharedToken: string): boolean {
  if (!sharedToken) return false
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice(7))
  const expected = Buffer.from(sharedToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

type Target = { kind: 'agent'; server: any } | { kind: 'group'; group: any; servers: any[] }
export const GROUP_TARGET_META_KEY = 'io.deepseek.dsh/mcp-group-target'

export function groupTargetDigest(target: Extract<Target, { kind: 'group' }>): string {
  const members = target.group.members.map((member: any) => {
    const server = target.servers.find(item => item.id === member.serverId)
    let endpoint = server?.specUrl || server?.url || ''
    if (endpoint) {
      const url = new URL(endpoint)
      url.username = ''; url.password = ''
      for (const key of [...url.searchParams.keys()]) if (/token|secret|password|credential|authorization|api[-_]?key/i.test(key)) url.searchParams.delete(key)
      url.searchParams.sort(); endpoint = url.href
    }
    return { serverId: member.serverId, serverName: server && serverName(server), enabled: server?.enabled,
      kind: server?.specUrl ? 'openapi' : 'mcp', endpoint,
      names: [...member.names].sort(), resourceUris: [...(member.resourceUris ?? [])].sort(), resourceTemplates: [...(member.resourceTemplates ?? [])].sort() }
  }).sort((a: any, b: any) => a.serverId.localeCompare(b.serverId))
  return createHash('sha256').update(JSON.stringify({ id: target.group.id, members })).digest('hex')
}

async function toolsFor(target: Target): Promise<any[]> {
  if (target.kind === 'agent') {
    const tools = await serverTools(target.server)
    return tools.filter((tool: any) => target.server.specUrl || target.server.tools.mode === 'all'
      || target.server.tools.names.includes(tool.name))
  }
  const result: any[] = []
  for (const member of target.group.members) {
    if (!member.names.length) continue
    const server = target.servers.find(item => item.id === member.serverId && item.enabled)
    if (!server) continue
    // 分组发现是最大努力汇总；调用方再根据必需工具集判定是否可执行。
    const tools = await serverTools(server).catch(() => [])
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

export function resourceOwner(target: Target, uri: string): any {
  if (target.kind === 'agent') return target.server
  const owners = target.group.members.filter((member: any) =>
    (member.resourceUris ?? []).includes(uri)
    || (member.resourceTemplates ?? []).some((template: string) => new UriTemplate(template).match(uri)))
    .map((member: any) => target.servers.find(server => server.id === member.serverId && server.enabled))
    .filter(Boolean)
  if (owners.length !== 1) throw new Error(owners.length ? '资源 URI 匹配多个来源' : '资源不属于当前 MCP 范围')
  return owners[0]
}

async function groupResources(target: Extract<Target, { kind: 'group' }>, templates: boolean): Promise<any> {
  const field = templates ? 'resourceTemplates' : 'resources'
  const selectedField = templates ? 'resourceTemplates' : 'resourceUris'
  const identity = templates ? 'uriTemplate' : 'uri'
  const items: any[] = []
  for (const member of target.group.members) {
    const selected = member[selectedField] ?? []
    const server = target.servers.find(item => item.id === member.serverId && item.enabled)
    if (!server || !selected.length) continue
    const available = server.specUrl ? (await loadOpenApi(server))[field]
      : (await withClient(server, client => listAll(client, templates ? 'listResourceTemplates' : 'listResources', field, server.signal)))[field]
    items.push(...available.filter((item: any) => selected.includes(item[identity])))
  }
  return { [field]: items }
}

async function serveMcp(req: any, res: any, target: Target, currentGroup?: () => Extract<Target, { kind: 'group' }> | undefined): Promise<void> {
  const digest = target.kind === 'group' ? groupTargetDigest(target) : undefined
  const assertTarget = (request?: any) => {
    const expected = request?.params?._meta?.[GROUP_TARGET_META_KEY]?.digest
    if (target.kind === 'group' && ((expected !== undefined && expected !== digest)
      || (currentGroup && (!currentGroup() || groupTargetDigest(currentGroup()!) !== digest)))) throw new Error('threat_connection_conflict')
  }
  const listed = async (result: Promise<any>) => {
    const value = await result
    assertTarget()
    return digest ? { ...value, _meta: { ...value._meta, [GROUP_TARGET_META_KEY]: { digest } } } : value
  }
  const scoped = (extra: any): Target => {
    const signal = extra.mcpReq.signal
    return target.kind === 'agent' ? { ...target, server: { ...target.server, signal } }
      : { ...target, servers: target.servers.map(server => ({ ...server, signal })) }
  }
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: target.kind === 'group' ? target.group.id : serverName(target.server),
      version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } })
    mcp.server.setRequestHandler('tools/list', async (_request: any, extra: any) => listed(toolsFor(scoped(extra)).then(tools => ({ tools }))))
    mcp.server.setRequestHandler('tools/call', async (request: any, extra: any) => {
      assertTarget(request)
      const owner = toolOwner(scoped(extra), request.params.name)
      if (!owner) throw new Error('工具不属于当前 MCP 范围')
      if (owner.server.specUrl) {
        const source = await loadOpenApi(owner.server)
        assertTarget(request)
        return callOpenApiTool(source, owner.rawName, request.params.arguments ?? {})
      }
      return withClient(owner.server, client => {
        assertTarget(request)
        return client.callTool({ ...request.params, name: owner.rawName }, { signal: owner.server.signal })
      })
    })
    mcp.server.setRequestHandler('resources/list', async (_request: any, extra: any) => {
      const selected = scoped(extra)
      return selected.kind === 'group' ? listed(groupResources(selected, false)) : selected.server.specUrl
        ? { resources: (await loadOpenApi(selected.server)).resources }
        : withClient(selected.server, client => listAll(client, 'listResources', 'resources', selected.server.signal))
    })
    mcp.server.setRequestHandler('resources/templates/list', async (_request: any, extra: any) => {
      const selected = scoped(extra)
      return selected.kind === 'group' ? listed(groupResources(selected, true)) : selected.server.specUrl
        ? { resourceTemplates: (await loadOpenApi(selected.server)).resourceTemplates }
        : withClient(selected.server, client => listAll(client, 'listResourceTemplates', 'resourceTemplates', selected.server.signal))
    })
    mcp.server.setRequestHandler('resources/read', async (request: any, extra: any) => {
      assertTarget(request)
      const server = resourceOwner(scoped(extra), request.params.uri)
      if (server.specUrl) {
        const source = await loadOpenApi(server)
        assertTarget(request)
        return readOpenApiResource(source, request.params.uri)
      }
      return withClient(server, client => { assertTarget(request); return client.readResource(request.params, { signal: server.signal }) })
    })
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
  const agentToken = randomBytes(32).toString('hex')
  const mounted = new Map<object, { version: string; ready: Promise<any[]>; users: number }>()
  snapshot(config)
  const currentGroup = (id: string) => {
    const current = snapshot(config), group = current.groups.find(item => item.id === id)
    return group ? { kind: 'group' as const, group, servers: current.servers } : undefined
  }
  ctx.provide('mcpSessionManager', { currentGroup(id: string) {
    const target = currentGroup(id)
    return target ? { id, token: config.sharedToken.get(), targetDigest: groupTargetDigest(target) } : undefined
  } })

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/mcp/groups', handler: async (req: any, res: any) => {
    if (!bearerAccepted(req, config.sharedToken.get())) return send(res, 401, { error: 'Bearer token required' })
    const id = new URL(req.url, 'http://localhost').pathname.split('/')[3]
    try {
      const current = snapshot(config)
      const group = current.groups.find(item => item.id === id)
      if (!group) return send(res, 404, { error: 'group not found' })
      await serveMcp(req, res, { kind: 'group', group, servers: current.servers }, () => currentGroup(id))
    } catch (error) { if (!res.headersSent) send(res, 502, { error: String(error) }); else res.destroy() }
  } }), 'mcp-manager.groups')

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/mcp/agents', handler: async (req: any, res: any) => {
    if (!bearerAccepted(req, agentToken)) return send(res, 401, { error: 'Bearer token required' })
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
        tokenConfigured: Boolean(current.sharedToken),
      })
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
      const request = await bodyOf(req)
      const server = current.servers.find(item => item.id === request.serverId)
      if (!server) return send(res, 404, { error: 'MCP server not found' })
      if (request.action === 'test') {
        return send(res, 200, await discover(server))
      }
      if (request.action === 'resources' || request.action === 'resourceTemplates' || request.action === 'readResource') {
        if (server.specUrl) {
          const source = await loadOpenApi(server)
          const result = request.action === 'resources' ? { resources: source.resources }
            : request.action === 'resourceTemplates' ? { resourceTemplates: source.resourceTemplates }
              : await readOpenApiResource(source, request.uri)
          return send(res, 200, result)
        }
        const result = await withClient(server, client => request.action === 'resources' ? listAll(client, 'listResources', 'resources')
          : request.action === 'resourceTemplates' ? listAll(client, 'listResourceTemplates', 'resourceTemplates')
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
    const version = JSON.stringify([current.servers, current.sharedToken])
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
              url: `http://127.0.0.1:${ctx.webServer.port}${ctx.webServer.publicPath?.(`/mcp/agents/${id}`) ?? `/mcp/agents/${id}`}`,
              headers: { Authorization: `Bearer ${agentToken}` },
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
