import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ThreatBindings, ThreatServices } from './types.ts'

function decodedTool(value: any): any {
  if (value?.isError || value?.error) return { code: 502, data: null }
  if (Array.isArray(value?.content)) {
    const text = value.content.find((item: any) => item.type === 'text')?.text
    if (typeof text !== 'string') return { code: 502, data: null }
    try { return JSON.parse(text) } catch { return { code: 502, data: null } }
  }
  return value
}

function socEnvelope(value: any) {
  if (typeof value?.status === 'string' && value.result !== undefined) return value
  const body = decodedTool(value)
  if (typeof body?.status === 'string' && body.result !== undefined) return body
  if (body && typeof body === 'object' && 'code' in body) return {
    status: Number(body.code) === 200 ? 'success' : 'error', status_code: Number(body.code),
    result: { ...body, code: Number(body.code) },
  }
  return { status: 'success', status_code: 200, result: { code: 200, data: body } }
}

export async function createThreatBridge(catalogDir: string, bindings: ThreatBindings, services: ThreatServices, signal: AbortSignal) {
  const tools = new Map<string, string>()
  for (const file of await readdir(catalogDir)) if (/^\.current-ai_soc_.*-tools\.local\.json$/.test(file)) {
    const document = JSON.parse(await readFile(join(catalogDir, file), 'utf8'))
    const entries = document.items ?? Object.values(document)
    for (const tool of entries) tools.set(tool.name, tool.resource_id)
  }
  const capability = randomUUID(), key = randomUUID()
  const controller = new AbortController()
  const bridgeSignal = AbortSignal.any([signal, controller.signal])
  const prefix = `/${capability}`
  const server = createServer(async (request, response) => {
    const send = (code: number, value?: any) => { response.writeHead(code, { 'content-type': 'application/json' }); response.end(value === undefined ? undefined : JSON.stringify(value)) }
    try {
      if (request.method !== 'POST' || !request.url?.startsWith(prefix + '/')) { send(404, { error: 'not_found' }); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const raw of request) { const chunk = Buffer.from(raw); size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('request_too_large'); chunks.push(chunk) }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const path = request.url.slice(prefix.length)
      const soc = /^\/soc\/api\/v1\/mcp-resources\/([^/]+)\/tools\/([^/]+)\/invoke$/.exec(path)
      if (soc) {
        const name = decodeURIComponent(soc[2]!)
        if (tools.get(name) !== soc[1] || !body.arguments || typeof body.arguments !== 'object') { send(422, { status: 'error', status_code: 422 }); return }
        const timeout = /judgement|judge_pending/.test(name) ? 30_000 : 120_000
        send(200, socEnvelope(await services.invoke(bindings.socConnectionId, name, body.arguments, AbortSignal.any([bridgeSignal, AbortSignal.timeout(timeout)])))); return
      }
      if (path === '/model/chat/completions') {
        if (request.headers.authorization !== `Bearer ${key}` || body.messages?.length !== 2 || body.messages[0]?.role !== 'system' || body.messages[1]?.role !== 'user') { send(403, { error: 'invalid_frozen_request' }); return }
        send(200, await services.inferFrozen(body, bindings.model, AbortSignal.any([bridgeSignal, AbortSignal.timeout(300_000)]))); return
      }
      if (path === '/report') {
        if (body.method === 'initialize') { send(200, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'platform-threat-report', version: '1' } } }); return }
        if (body.method === 'notifications/initialized') { send(202); return }
        if (body.method !== 'tools/call' || body.params?.name !== 'save_persistence_result') { send(200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'method_not_found' } }); return }
        let result = await services.invoke(bindings.reportConnectionId, 'save_persistence_result', body.params.arguments, AbortSignal.any([bridgeSignal, AbortSignal.timeout(30_000)]))
        if (!Array.isArray(result?.content)) {
          const value = typeof result?.status === 'string' && result.result !== undefined ? result.result : result
          result = { content: [{ type: 'text', text: JSON.stringify(value) }] }
        }
        send(200, { jsonrpc: '2.0', id: body.id, result }); return
      }
      send(404, { error: 'not_found' })
    } catch { send(502, { status: 'error', status_code: 502, error: 'platform_upstream_failed' }) }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('threat_bridge_unavailable')
  const base = `http://127.0.0.1:${address.port}${prefix}`
  return { key, soc: `${base}/soc`, report: `${base}/report`, model: `${base}/model`,
    close: () => { controller.abort(); server.closeAllConnections(); server.close() } }
}
