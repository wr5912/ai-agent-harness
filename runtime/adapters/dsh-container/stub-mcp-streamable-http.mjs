#!/usr/bin/env node
/**
 * 依赖为零的 Streamable HTTP MCP 桩服务。
 *
 * 用途：受控技术装载核验（C2）时，候选 Profile 以 fail-closed 方式声明了三个
 * `streamable-http` MCP 客户端；在缺少真实端点与凭据的环境里，容器会在启动阶段
 * 因 MCP 不可达而退出，导致"装载是否成立"无法被验证。本桩只提供到 `initialize`
 * 与 `tools/list` 的最小协议面，使 DSH 能完成 MCP 握手与工具注册。
 *
 * 边界（必须如实标注）：
 * - 桩没有业务语义、没有鉴权、没有状态机；`tools/call` 只回显桩标记。
 * - 桩的存在只证明"Profile/MCP 客户端/工具注册这条链路能装载"，
 *   绝不构成业务能力通过、评估通过或 Release 验收。
 * - 只监听回环地址，不暴露到非本机网络。
 *
 * 用法：
 *   node stub-mcp-streamable-http.mjs --port 3099 [--tools tools.json] [--log stub.log]
 *
 * tools.json 形如：
 *   { "servers": { "sec-ops": { "path": "/mcp/sec-ops", "tools": ["raw_tool_name"] } } }
 * 未提供 `--tools` 时，每个通过 `--server name=path` 声明的服务暴露一个通用 `echo` 工具。
 */

import { createServer } from 'node:http'
import { appendFileSync, readFileSync } from 'node:fs'

const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'dsh-verification-mcp-stub', version: '0.0.0' }

function parseArgs(argv) {
  const options = { host: '127.0.0.1', port: 0, tools: null, log: null, servers: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const value = argv[index + 1]
    switch (token) {
      case '--host':
        options.host = value
        index += 1
        break
      case '--port':
        options.port = Number.parseInt(value, 10)
        index += 1
        break
      case '--tools':
        options.tools = value
        index += 1
        break
      case '--log':
        options.log = value
        index += 1
        break
      case '--server': {
        const [name, path] = String(value).split('=')
        options.servers.push({ name, path: path || `/mcp/${name}` })
        index += 1
        break
      }
      case '--help':
      case '-h':
        process.stdout.write(
          'usage: stub-mcp-streamable-http.mjs --port <n> [--host 127.0.0.1] [--tools tools.json] [--log file] [--server name=path]\n',
        )
        process.exit(0)
        break
      default:
        process.stderr.write(`unknown argument: ${token}\n`)
        process.exit(2)
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    process.stderr.write('--port must be a valid TCP port\n')
    process.exit(2)
  }
  return options
}

function loadToolInventory(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const servers = new Map()
  for (const [name, entry] of Object.entries(parsed.servers || {})) {
    const tools = (entry.tools || []).map((tool) =>
      typeof tool === 'string' ? { name: tool } : tool,
    )
    for (const tool of tools) {
      if (!tool.name || typeof tool.name !== 'string') {
        process.stderr.write(`server ${name}: tool entry without a name\n`)
        process.exit(2)
      }
    }
    servers.set(name, { path: entry.path || `/mcp/${name}`, tools })
  }
  return servers
}

function defaultServers(declared) {
  const servers = new Map()
  for (const { name, path } of declared) {
    servers.set(name, {
      path,
      tools: [{ name: 'echo', description: 'stub echo tool (no business semantics)' }],
    })
  }
  return servers
}

const options = parseArgs(process.argv.slice(2))
const servers = options.tools ? loadToolInventory(options.tools) : defaultServers(options.servers)
if (servers.size === 0) {
  process.stderr.write('no MCP server declared; pass --tools or --server name=path\n')
  process.exit(2)
}

const byPath = new Map()
for (const [name, entry] of servers) {
  if (byPath.has(entry.path)) {
    process.stderr.write(`duplicate MCP path: ${entry.path}\n`)
    process.exit(2)
  }
  byPath.set(entry.path, { name, tools: entry.tools })
}

function logLine(record) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...record })
  if (options.log) {
    appendFileSync(options.log, `${line}\n`)
  }
  process.stderr.write(`${line}\n`)
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function handleMessage(message, endpoint) {
  if (message === null || typeof message !== 'object' || typeof message.method !== 'string') {
    return { kind: 'error', payload: rpcError(message?.id ?? null, -32600, 'Invalid Request') }
  }
  const { method, id } = message
  const isRequest = id !== undefined && id !== null
  if (!isRequest) {
    // 通知（含 notifications/initialized）按 Streamable HTTP 规范回 202 无正文。
    return { kind: 'notification', method }
  }
  switch (method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion
      return {
        kind: 'result',
        payload: rpcResult(id, {
          protocolVersion: typeof requested === 'string' ? requested : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }),
      }
    }
    case 'ping':
      return { kind: 'result', payload: rpcResult(id, {}) }
    case 'tools/list':
      return {
        kind: 'result',
        payload: rpcResult(id, {
          tools: endpoint.tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? 'verification stub tool (no business semantics)',
            inputSchema: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: true },
          })),
        }),
      }
    case 'tools/call': {
      const name = message.params?.name
      return {
        kind: 'result',
        payload: rpcResult(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ stub: true, server: endpoint.name, tool: name ?? null }),
            },
          ],
          isError: false,
        }),
      }
    }
    case 'resources/list':
      return { kind: 'result', payload: rpcResult(id, { resources: [] }) }
    case 'prompts/list':
      return { kind: 'result', payload: rpcResult(id, { prompts: [] }) }
    default:
      return { kind: 'error', payload: rpcError(id, -32601, `Method not found: ${method}`) }
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${options.host}`)
  const endpoint = byPath.get(url.pathname)
  const authPresent = Boolean(request.headers.authorization)
  if (request.method !== 'POST') {
    logLine({ event: 'http', method: request.method, path: url.pathname, status: 405, authorization_present: authPresent })
    response.writeHead(405, { 'content-type': 'application/json', allow: 'POST' })
    response.end(JSON.stringify({ error: 'stub supports POST only; SSE stream is not implemented' }))
    return
  }
  if (!endpoint) {
    logLine({ event: 'http', method: 'POST', path: url.pathname, status: 404, authorization_present: authPresent })
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: `unknown MCP path: ${url.pathname}` }))
    return
  }
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    let parsed
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      logLine({ event: 'rpc', server: endpoint.name, path: url.pathname, status: 400, reason: 'invalid json' })
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify(rpcError(null, -32700, 'Parse error')))
      return
    }
    const batch = Array.isArray(parsed)
    const messages = batch ? parsed : [parsed]
    const outcomes = messages.map((message) => ({ message, outcome: handleMessage(message, endpoint) }))
    for (const { message, outcome } of outcomes) {
      logLine({
        event: 'rpc',
        server: endpoint.name,
        path: url.pathname,
        method: message?.method ?? null,
        id: message?.id ?? null,
        kind: outcome.kind,
        tool: message?.params?.name ?? null,
        authorization_present: authPresent,
      })
    }
    const requests = outcomes.filter(({ message, outcome }) => outcome.kind !== 'notification' && message?.id !== undefined && message?.id !== null)
    if (requests.length === 0) {
      response.writeHead(202)
      response.end()
      return
    }
    const payloads = requests.map(({ outcome }) => outcome.payload)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(batch ? payloads : payloads[0]))
  })
})

server.listen(options.port, options.host, () => {
  const endpoints = {}
  for (const [name, entry] of servers) {
    endpoints[name] = `http://${options.host}:${options.port}${entry.path}`
  }
  logLine({ event: 'listen', host: options.host, port: options.port, endpoints, tool_counts: Object.fromEntries([...servers].map(([name, entry]) => [name, entry.tools.length])) })
  process.stdout.write(`${JSON.stringify({ endpoints, tool_counts: Object.fromEntries([...servers].map(([name, entry]) => [name, entry.tools.length])) })}\n`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logLine({ event: 'shutdown', signal })
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 2000).unref()
  })
}
