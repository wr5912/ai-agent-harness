import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repository = fileURLToPath(new URL('../../../../../', import.meta.url))
process.env.DSH_MCP_CLIENT_ANCHOR ??= join(repository, 'platform/plugin/package.json')
const runtimeRequire = createRequire(process.env.DSH_MCP_CLIENT_ANCHOR)
const { Client, StreamableHTTPClientTransport } = runtimeRequire('@modelcontextprotocol/client')
const { startMockSocResources } = await import('./mock-soc-resources.ts')
const { LOGICAL_MAPPINGS, resolveMappings, assertPreflight } = await import('../../candidate/dsh/managed/threat-analysis/mcp-group-bridge.ts')

async function isolatedMock() {
  const reserve = createServer()
  await new Promise(done => reserve.listen(0, '127.0.0.1', done))
  const port = reserve.address().port
  await new Promise(done => reserve.close(done))
  const root = process.env.MOCK_SERVICE_ROOT ?? join(repository, '../mock_service')
  const child = spawn(process.env.MOCK_SERVICE_PYTHON ?? join(root, '.venv/bin/python3'),
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port), '--log-level', 'error', '--no-access-log'],
    { cwd: root, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  let spawnFailed = false
  child.on('error', () => { spawnFailed = true })
  const backendUrl = `http://127.0.0.1:${port}`
  async function close() {
    if (child.exitCode !== null || spawnFailed) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
  }
  for (let index = 0; index < 100; index++) {
    if (spawnFailed || child.exitCode !== null) break
    try {
      if ((await fetch(backendUrl + '/health', { signal: AbortSignal.timeout(250) })).ok) return { backendUrl, close }
    } catch { /* 仅等待本测试新建的进程，不探测现有 Mock。 */ }
    await new Promise(done => setTimeout(done, 100))
  }
  await close()
  throw new Error('Isolated Mock app did not become ready')
}

test('真实 MCP 分组准确发现20项，资源和报告转发独立 Mock，409保留上游HTTP状态', { timeout: 30_000 }, async () => {
  const backend = await isolatedMock()
  let fixture
  const clients = new Map()
  try {
    fixture = await startMockSocResources({ backendUrl: backend.backendUrl, port: 0 })
    const discovery = { tools: [], resources: [], resourceTemplates: [] }
    for (const role of new Set(LOGICAL_MAPPINGS.map(item => item.resource.replaceAll('_', '-')))) {
      const client = new Client({ name: 'eval-fixture-protocol-test', version: '1' }, { versionNegotiation: { mode: 'auto' } })
      clients.set(role, client)
      await client.connect(new StreamableHTTPClientTransport(new URL(`/mcp/${role}/`, fixture.origin)))
      const tools = (await client.listTools()).tools
      discovery.tools.push(...tools.map(tool => ({ ...tool, name: `mcp__${role}__${tool.name}` })))
      discovery.resources.push(...(await client.listResources()).resources)
      discovery.resourceTemplates.push(...(await client.listResourceTemplates()).resourceTemplates)
    }
    assert.equal(discovery.tools.length, 10)
    assert.equal(discovery.resources.length, 1)
    assert.equal(discovery.resourceTemplates.length, 9)
    const mapped = resolveMappings(discovery)
    assert.equal(mapped.size, 20)
    assertPreflight(mapped, 'manual')
    assertPreflight(mapped, 'pending')

    const incident = await clients.get('ai-soc-correlate').readResource({ uri: 'mock-soc://ai-soc-correlate/get_correlate_incident_by_incident_id/INC-20261015-000001' })
    assert.equal(JSON.parse(incident.contents[0].text).data.incidentId, 'INC-20261015-000001')
    const asset = await clients.get('ai-soc-master').readResource({ uri: 'mock-soc://ai-soc-master/get_soc_asset_by_asset_id/9106' })
    assert.equal(JSON.parse(asset.contents[0].text).data.assetId, 9106)
    const whitelist = await clients.get('ai-soc-detect').readResource({ uri: 'mock-soc://ai-soc-detect/list_detect_whitelist' })
    assert.equal(JSON.parse(whitelist.contents[0].text).code, 200)
    await assert.rejects(() => clients.get('ai-soc-master').readResource({ uri: 'mock-soc://ai-soc-master/get_soc_asset_by_asset_id/9999' }), /HTTP 404/)

    const correlate = clients.get('ai-soc-correlate')
    const args = { incidentId: 'INC-20261015-000001' }
    const claimed = await correlate.callTool({ name: 'create_incident_judgement_claim', arguments: args })
    assert.equal(claimed.isError, false)
    assert.equal(claimed.structuredContent.code, 200)
    const duplicate = await correlate.callTool({ name: 'create_incident_judgement_claim', arguments: args })
    assert.equal(duplicate.isError, true)
    assert.equal(duplicate._meta['io.deepseek.dsh/openapi-response'].status, 409)
    const spec = await (await fetch(backend.backendUrl + '/api/v1/security-operations/openapi.json')).json()
    const [claimPath] = Object.entries(spec.paths).find(([, methods]) => methods.post?.operationId === 'ai_soc_correlate__create_incident_judgement_claim')
    const direct = await fetch(backend.backendUrl + claimPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arguments: args }) })
    assert.equal(direct.status, 409, '冲突必须来自真实 Mock app 的 HTTP 状态')
    assert.deepEqual(duplicate.structuredContent, await direct.json())

    const report = await clients.get('report-write').callTool({ name: 'save_persistence_result', arguments: {
      businessId: 'fixture-basic', sourceModule: 'threat-analysis', revision: 1,
      resultType: 'report', contentType: 'text/html', fileName: 'fixture-basic.html',
      fileContentBase64: Buffer.from('<html><body><p>基本模拟报告。</p></body></html>').toString('base64'),
    } })
    const saved = report.structuredContent
    assert.equal(saved.code, 200)
    const url = new URL(saved.data.downloadUrl)
    assert.equal(url.origin, backend.backendUrl)
    assert.equal((await fetch(url)).status, 200)
    await assert.rejects(() => startMockSocResources({ backendUrl: 'http://127.0.0.1:53001', port: 0 }), /isolated loopback/)
  } finally {
    await Promise.all([...clients.values()].map(client => client.close()))
    await fixture?.close()
    await backend.close()
  }
})
