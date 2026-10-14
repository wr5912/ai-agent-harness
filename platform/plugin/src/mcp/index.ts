import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { readFile } from 'node:fs/promises'
import { COMPOSITION_TOOL_NAME } from './definition.ts'
import { createRegistry, executeComposition, compositionVersion, saveRegistry, type McpRegistry } from './executor.ts'
import { callOpenApiOperation, limitedText, loadOpenApi, normalizeConnection, publicConnection, validateSpecUrl, type CredentialRef } from './openapi.ts'

const SERVER_INFO = { name: 'harness-platform-mcp-composition', version: '0.1.0' }
const PROTOCOL_VERSION = '2025-06-18'

function failure(code: string, message: string, details = {}): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message, details } }
}

function success<T>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value }
}

function listState(registry: McpRegistry, assetRoot: string) {
  return {
    connections: [
      ...[...registry.openapi.values()].map(connection => ({
        ...publicConnection(connection),
        status: registry.status.get(connection.id) ?? { registered: true, specLoaded: false, toolCallSucceeded: false },
      })),
      ...[...registry.mcp.values()].map(connection => ({
        kind: 'mcp-http',
        id: connection.id,
        name: connection.name ?? connection.id,
        endpointUrl: connection.endpointUrl,
        credential_configured: Boolean(connection.credentialRef),
        status: registry.status.get(connection.id) ?? { registered: true, specLoaded: 'unknown', toolCallSucceeded: 'unknown' },
      })),
    ],
    composition: compositionVersion(assetRoot),
  }
}

function totalSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(20_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function statusOf(registry: McpRegistry, id: string) {
  const status = registry.status.get(id) ?? { registered: true, specLoaded: 'unknown' as const, toolCallSucceeded: 'unknown' as const }
  registry.status.set(id, status)
  return status
}

function normalizeMcpConnection(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP 连接配置无效')
  const input = value as Record<string, any>
  const id = String(input.id ?? '')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('连接 ID 无效')
  let credentialRef: CredentialRef | undefined
  if (input.credentialRef !== undefined) {
    if (!input.credentialRef || input.credentialRef.kind !== 'file' || typeof input.credentialRef.path !== 'string') throw new Error('凭据只能使用专用文件引用')
    credentialRef = { kind: 'file', path: input.credentialRef.path }
  }
  return {
    id,
    name: typeof input.name === 'string' && input.name ? input.name.slice(0, 80) : undefined,
    endpointUrl: validateSpecUrl(String(input.endpointUrl ?? input.url ?? '')),
    credentialRef,
    authHeader: typeof input.authHeader === 'string' ? input.authHeader : undefined,
  }
}

async function mcpAuthHeaders(connection: any) {
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json,text/event-stream' })
  if (connection.credentialRef) {
    const value = (await readFile(connection.credentialRef.path, 'utf8')).trim()
    if (value) {
      const header = connection.authHeader ?? 'Authorization'
      headers.set(header, header.toLowerCase() === 'authorization' && !value.startsWith('Bearer ') ? `Bearer ${value}` : value)
    }
  }
  return headers
}

async function mcpSecret(connection: any) {
  return connection.credentialRef ? (await readFile(connection.credentialRef.path, 'utf8')).trim() : undefined
}

function redactLiteral(text: string, secret?: string) {
  return secret ? text.replaceAll(secret, '[redacted]') : text
}

function redactValue(value: any, secret?: string): any {
  if (typeof value === 'string') return redactLiteral(value, secret)
  if (Array.isArray(value)) return value.map(item => redactValue(item, secret))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secret)]))
}

function parseSseJsonRpc(text: string, id: unknown, secret?: string) {
  let sawData = false
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (!data || data === '[DONE]') continue
    sawData = true
    let body: any
    try { body = JSON.parse(redactLiteral(data, secret)) } catch { throw new Error('MCP SSE 响应无法解析，当前仅支持有限 JSON-RPC data 事件') }
    if (body?.id === id) return body
  }
  throw new Error(sawData ? 'MCP SSE 未返回匹配请求 id 的 JSON-RPC 结果' : 'MCP SSE 响应为空')
}

async function mcpJsonRpc(connection: any, message: any, session?: { id?: string; protocolVersion?: string }, signal?: AbortSignal) {
  const headers = await mcpAuthHeaders(connection)
  if (session?.id) headers.set('Mcp-Session-Id', session.id)
  if (session?.protocolVersion) headers.set('MCP-Protocol-Version', session.protocolVersion)
  const response = await fetch(connection.endpointUrl, { method: 'POST', headers, body: JSON.stringify(message), signal })
  const secret = await mcpSecret(connection)
  if (!response.ok) throw new Error(`MCP 请求失败：HTTP ${response.status}`)
  const text = await limitedText(response, 512 * 1024)
  const contentType = response.headers.get('content-type') ?? ''
  let body: any
  if (contentType.includes('text/event-stream')) body = parseSseJsonRpc(text, message.id, secret)
  else {
    try { body = JSON.parse(redactLiteral(text, secret)) } catch { throw new Error('MCP 响应不是 JSON') }
  }
  if (body.error) throw new Error(String(redactValue(body.error.message ?? 'MCP 返回错误', secret)))
  if (message.method === 'initialize') {
    session ??= {}
    session.id = response.headers.get('Mcp-Session-Id') ?? session.id
    session.protocolVersion = typeof body.result?.protocolVersion === 'string' ? body.result.protocolVersion : PROTOCOL_VERSION
  }
  return redactValue(body.result, secret)
}

async function listMcpTools(connection: any, signal?: AbortSignal) {
  const session = {}
  const runSignal = totalSignal(signal)
  await mcpJsonRpc(connection, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'harness-platform', version: '0.1.0' } } }, session, runSignal)
  const headers = await mcpAuthHeaders(connection)
  if ((session as any).id) headers.set('Mcp-Session-Id', (session as any).id)
  if ((session as any).protocolVersion) headers.set('MCP-Protocol-Version', (session as any).protocolVersion)
  const notified = await fetch(connection.endpointUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }), signal: runSignal })
  if (!notified.ok) throw new Error(`MCP initialized 通知失败：HTTP ${notified.status}`)
  return await mcpJsonRpc(connection, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session, runSignal)
}

async function callMcpTool(connection: any, name: string, args: any, signal?: AbortSignal) {
  const session = {}
  const runSignal = totalSignal(signal)
  await mcpJsonRpc(connection, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'harness-platform', version: '0.1.0' } } }, session, runSignal)
  const headers = await mcpAuthHeaders(connection)
  if ((session as any).id) headers.set('Mcp-Session-Id', (session as any).id)
  if ((session as any).protocolVersion) headers.set('MCP-Protocol-Version', (session as any).protocolVersion)
  const notified = await fetch(connection.endpointUrl, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }), signal: runSignal })
  if (!notified.ok) throw new Error(`MCP initialized 通知失败：HTTP ${notified.status}`)
  await mcpJsonRpc(connection, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, session, runSignal)
  return await mcpJsonRpc(connection, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args ?? {} } }, session, runSignal)
}

export function createMcpHandler(assetRoot: string, options: { stateFile?: string; servers?: () => any[]; native?: McpRegistry['native'] } = {}): ConnectionRpcHandler {
  const registry = options.servers ? createRegistry() : createRegistry(assetRoot, options.stateFile)
  registry.native = options.native
  return async (endpoint, payload, signal) => {
    try {
      if (options.servers) {
        registry.openapi.clear()
        registry.mcp.clear()
        for (const server of options.servers().filter(item => item.enabled !== false)) {
          if (server.specUrl) registry.openapi.set(server.id, { id: server.id, name: server.serverName || server.id, specUrl: server.specUrl })
          else registry.mcp.set(server.id, { id: server.id, endpointUrl: server.url })
        }
        if (['registerOpenApi', 'registerMcp', 'deleteConnection', 'refreshSpec', 'callTool'].includes(endpoint)) {
          return failure('use_mcp_manager', '请通过 MCP 配置管理页面操作服务器、工具与资源')
        }
      }
      if (endpoint === 'list') return success(listState(registry, assetRoot))
      if (endpoint === 'registerOpenApi') {
        const connection = normalizeConnection(payload)
        registry.openapi.set(connection.id, connection)
        registry.mcp.delete(connection.id)
        registry.status.set(connection.id, { registered: true, specLoaded: false, toolCallSucceeded: false })
        saveRegistry(registry)
        return success({ connection: publicConnection(connection), status: registry.status.get(connection.id) })
      }
      if (endpoint === 'registerMcp') {
        const connection = normalizeMcpConnection(payload)
        registry.mcp.set(connection.id, connection)
        registry.openapi.delete(connection.id)
        registry.status.set(connection.id, { registered: true, specLoaded: false, toolCallSucceeded: false })
        saveRegistry(registry)
        return success({ connection: { kind: 'mcp-http', id: connection.id, endpointUrl: connection.endpointUrl, credential_configured: Boolean(connection.credentialRef) }, status: registry.status.get(connection.id) })
      }
      if (endpoint === 'deleteConnection') {
        const id = String((payload as any)?.connectionId ?? '')
        const removed = registry.openapi.delete(id) || registry.mcp.delete(id)
        registry.status.delete(id)
        if (removed) saveRegistry(registry)
        return removed ? success({ deleted: true }) : failure('not_found', '连接不存在')
      }
      if (endpoint === 'refreshSpec') {
        const id = String((payload as any)?.connectionId ?? '')
        const connection = registry.openapi.get(id)
        const mcp = registry.mcp.get(id)
        if (!connection && !mcp) return failure('not_found', '连接不存在')
        const status = statusOf(registry, id)
        const runSignal = totalSignal(signal)
        const tools = connection ? (await loadOpenApi(connection, runSignal)).tools : (await listMcpTools(mcp, runSignal)).tools
        status.specLoaded = true
        registry.status.set(id, status)
        return success({ tools, status })
      }
      if (endpoint === 'callTool') {
        const id = String((payload as any)?.connectionId ?? '')
        const name = String((payload as any)?.toolName ?? '')
        const connection = registry.openapi.get(id)
        const mcp = registry.mcp.get(id)
        if (!connection && !mcp) return failure('not_found', '连接不存在')
        const runSignal = totalSignal(signal)
        const result = connection
          ? await callOpenApiOperation(await loadOpenApi(connection, runSignal), name, (payload as any)?.arguments ?? {}, runSignal)
          : await callMcpTool(mcp, name, (payload as any)?.arguments ?? {}, runSignal)
        const status = statusOf(registry, id)
        status.specLoaded = true
        status.toolCallSucceeded = connection ? result.ok : !result?.isError
        if (connection && !result.ok) status.lastError = `HTTP ${result.status}`
        registry.status.set(id, status)
        return success({ ...result, status })
      }
      if (endpoint === 'executeComposition') return success(await executeComposition(registry, assetRoot, (payload as any) ?? {}, signal))
      return failure('not_found', '未知的 MCP 管理操作')
    } catch (error) {
      return failure('mcp_failed', error instanceof Error ? error.message : String(error))
    }
  }
}

async function bodyOf(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('请求超过 64 KiB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleMcpMessage(handler: ConnectionRpcHandler, assetRoot: string, message: any, signal?: AbortSignal) {
  if (!message || typeof message.method !== 'string') return rpcError(message?.id ?? null, -32600, 'Invalid Request')
  if (message.id === undefined || message.id === null) return null
  if (message.method === 'initialize') {
    return rpcResult(message.id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO })
  }
  if (message.method === 'tools/list') {
    const version = compositionVersion(assetRoot)
    return rpcResult(message.id, { tools: [{
      name: COMPOSITION_TOOL_NAME,
      description: '固定两步只读组合：查询资产后查询相关告警',
      inputSchema: version.definition.inputSchema,
      annotations: { readOnlyHint: true },
    }] })
  }
  if (message.method === 'tools/call') {
    if (message.params?.name !== COMPOSITION_TOOL_NAME) return rpcError(message.id, -32602, 'Unknown tool')
    const result = await handler('executeComposition', message.params?.arguments ?? {}, signal ?? new AbortController().signal, undefined as never)
    if (!result.ok) return rpcResult(message.id, { content: [{ type: 'text', text: result.error.message }], isError: true })
    const value = result.value as { ok: boolean } & Record<string, unknown>
    return rpcResult(message.id, { content: [{ type: 'text', text: JSON.stringify(value) }], isError: !value.ok })
  }
  return rpcError(message.id, -32601, `Method not found: ${message.method}`)
}

export function createMcpGatewayRequestHandler(assetRoot: string, handler = createMcpHandler(assetRoot)) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end()
        return
      }
      const parsed = await bodyOf(req)
      if (Array.isArray(parsed)) throw new Error('JSON-RPC batch 不受支持')
      const replies = (await Promise.all([parsed].map(message => handleMcpMessage(handler, assetRoot, message)))).filter(Boolean)
      if (!replies.length) {
        res.writeHead(202).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify(replies[0]))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify(rpcError(null, -32603, error instanceof Error ? error.message : String(error))))
    }
  }
}

export function createMcpGatewayFetchHandler(assetRoot: string, handler = createMcpHandler(assetRoot)) {
  return async (request: Request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
    try {
      const parsed = JSON.parse(await limitedText(new Response(request.body), 64 * 1024))
      if (Array.isArray(parsed)) throw new Error('JSON-RPC batch 不受支持')
      const replies = (await Promise.all([parsed].map(message => handleMcpMessage(handler, assetRoot, message, request.signal)))).filter(Boolean)
      if (!replies.length) return new Response(null, { status: 202 })
      return Response.json(replies[0], { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
      return Response.json(rpcError(null, -32603, error instanceof Error ? error.message : String(error)), { status: 400 })
    }
  }
}

export function applyMcpGateway(ctx: Context, assetRoot: string, handler: ConnectionRpcHandler) {
  const fetch = createMcpGatewayFetchHandler(assetRoot, handler)
  ctx.connection.fetch.register({ path: '/api/harness-platform/mcp', methods: ['POST'], requestBody: 'buffered', fetch })
}
