/** 本轮评估的外部协议夹具；业务数据和状态始终来自独立 Mock app。 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOGICAL_MAPPINGS } from '../../candidate/dsh/managed/threat-analysis/mcp-group-bridge.ts'

const runtimeRequire = createRequire(process.env.DSH_MCP_CLIENT_ANCHOR
  || '/opt/dsh/packages/mcp/mcp-client/package.json')
const { McpServer, createMcpHandler } = runtimeRequire('@modelcontextprotocol/server')
const { toNodeHandler } = runtimeRequire('@modelcontextprotocol/node')
const { Client, StreamableHTTPClientTransport } = runtimeRequire('@modelcontextprotocol/client')
const RESPONSE_META = 'io.deepseek.dsh/openapi-response'
const TIMEOUT = 120_000
type Json = Record<string, any>
type Mapping = (typeof LOGICAL_MAPPINGS)[number]

const roleOf = (item: Mapping) => item.resource.replaceAll('_', '-')
const rawToolName = (item: Mapping) => item.target.name.replace(`mcp__${roleOf(item)}__`, '')
const resourceUri = (item: Mapping) => `mock-soc://${roleOf(item)}/${item.target.name}`
const templateUri = (item: Mapping) => resourceUri(item)
  + (item.target.kind === 'template' ? '/' + item.target.variables.map(name => `{${name}}`).join('/') : '')

export async function startMockSocResources(options: {
  backendUrl?: string; host?: string; port?: number
} = {}) {
  const backend = new URL(options.backendUrl ?? 'http://127.0.0.1:53002')
  // 独立评估夹具不允许误接本机共享 Mock。
  if (backend.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(backend.hostname)
    || backend.port === '53001') throw new Error('fixture backend must use an isolated loopback Mock app')
  const specResponse = await fetch(new URL('/api/v1/security-operations/openapi.json', backend), { signal: AbortSignal.timeout(TIMEOUT) })
  if (!specResponse.ok) throw new Error('Mock SOC OpenAPI is unavailable')
  const spec = await specResponse.json() as Json
  const operations = new Map<string, { path: string; schema: Json }>()
  for (const [path, methods] of Object.entries(spec.paths ?? {}) as [string, Json][]) {
    const operation = methods.post
    if (operation?.operationId) operations.set(operation.operationId, {
      path, schema: operation.requestBody?.content?.['application/json']?.schema?.properties?.arguments,
    })
  }
  for (const item of LOGICAL_MAPPINGS.filter(item => item.resource !== 'report-write')) {
    const operation = operations.get(item.tool)
    if (!operation?.schema || operation.schema.type !== 'object') throw new Error(`Mock SOC operation is missing: ${item.tool}`)
  }

  const report = new Client({ name: 'eval-report-forwarder', version: '1' }, { versionNegotiation: { mode: 'auto' } })
  const protocols: any[] = []
  let server: ReturnType<typeof createServer> | undefined
  try {
    await report.connect(new StreamableHTTPClientTransport(new URL('/mcp/report/', backend)), { timeout: TIMEOUT })
    const reportTool = (await report.listTools()).tools.find((tool: Json) => tool.name === 'save_persistence_result')
    if (!reportTool) throw new Error('Mock report tool is missing')

    async function invokeSoc(item: Mapping, args: Json, signal: AbortSignal) {
      const operation = operations.get(item.tool)!
      const response = await fetch(new URL(operation.path, backend), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ arguments: args }), signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]),
      })
      const payload = await response.json()
      return { status: response.status, ok: response.ok, payload: response.ok ? payload.result : payload }
    }
    const routes = new Map<string, any>()
    for (const role of new Set(LOGICAL_MAPPINGS.map(roleOf))) {
      const mappings = LOGICAL_MAPPINGS.filter(item => roleOf(item) === role)
      const tools = mappings.filter(item => item.target.kind === 'tool')
      const resources = mappings.filter(item => item.target.kind === 'resource')
      const templates = mappings.filter(item => item.target.kind === 'template')
      const protocol = createMcpHandler(() => {
        const mcp = new McpServer({ name: role, version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } })
        mcp.server.setRequestHandler('tools/list', async () => ({ tools: tools.map(item => ({
          name: rawToolName(item), description: '转发独立 Mock 的基本模拟接口。',
          inputSchema: item.resource === 'report-write' ? reportTool.inputSchema : operations.get(item.tool)!.schema,
        })) }))
        mcp.server.setRequestHandler('resources/list', async () => ({ resources: resources.map(item => ({
          name: item.target.name, uri: resourceUri(item), mimeType: 'application/json',
        })) }))
        mcp.server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: templates.map(item => ({
          name: item.target.name, uriTemplate: templateUri(item), mimeType: 'application/json',
        })) }))
        mcp.server.setRequestHandler('tools/call', async (request: any, context: any) => {
          const item = tools.find(item => rawToolName(item) === request.params.name)
          if (!item) throw new Error('Unknown fixture tool')
          if (item.resource === 'report-write') return report.callTool({ name: item.tool, arguments: request.params.arguments ?? {} },
            { signal: context.mcpReq.signal, timeout: TIMEOUT })
          const result = await invokeSoc(item, request.params.arguments ?? {}, context.mcpReq.signal)
          return { content: [{ type: 'text', text: JSON.stringify(result.payload) }],
            structuredContent: result.payload, isError: !result.ok,
            _meta: { [RESPONSE_META]: { status: result.status } } }
        })
        mcp.server.setRequestHandler('resources/read', async (request: any, context: any) => {
          let selected: Mapping | undefined
          const args: Json = {}
          for (const item of [...resources, ...templates]) {
            if (item.target.kind === 'resource' && request.params.uri === resourceUri(item)) { selected = item; break }
            if (item.target.kind !== 'template') continue
            const prefix = resourceUri(item) + '/'
            if (!request.params.uri.startsWith(prefix)) continue
            const values = request.params.uri.slice(prefix.length).split('/').map(decodeURIComponent)
            if (values.length !== item.target.variables.length) continue
            for (const [index, name] of item.target.variables.entries()) {
              const type = operations.get(item.tool)!.schema.properties?.[name]?.type
              args[name] = type === 'integer' ? Number(values[index]) : values[index]
            }
            selected = item
            break
          }
          if (!selected) throw new Error('Unknown fixture resource')
          const result = await invokeSoc(selected, args, context.mcpReq.signal)
          if (!result.ok) throw new Error(`Mock resource HTTP ${result.status}`)
          return { contents: [{ uri: request.params.uri, mimeType: 'application/json', text: JSON.stringify(result.payload) }] }
        })
        return mcp
      })
      protocols.push(protocol)
      routes.set(`/mcp/${role}/`, toNodeHandler(protocol))
    }
    server = createServer((request, response) => {
      const route = routes.get(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
      if (!route) { response.writeHead(404).end(); return }
      Promise.resolve(route(request, response)).catch(() => response.destroy())
    })
    await new Promise<void>((done, reject) => {
      server!.once('error', reject)
      server!.listen(options.port ?? 53003, options.host ?? '127.0.0.1', done)
    })
    const origin = `http://127.0.0.1:${(server.address() as any).port}`
    return { origin, endpoints: [...routes.keys()].map(path => origin + path), async close() {
      server!.closeAllConnections()
      await new Promise<void>(done => server!.close(() => done()))
      await Promise.all(protocols.map(protocol => protocol.close()))
      await report.close()
    } }
  } catch (error) {
    server?.closeAllConnections()
    server?.close()
    await Promise.all(protocols.map(protocol => protocol.close()))
    await report.close().catch(() => undefined)
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const fixture = await startMockSocResources({ backendUrl: option('--backend'), host: option('--host'),
    port: option('--port') ? Number(option('--port')) : undefined })
  console.log(JSON.stringify({ fixture: 'basic-soc-resources', endpoints: fixture.endpoints }))
  const stop = () => void fixture.close().then(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
