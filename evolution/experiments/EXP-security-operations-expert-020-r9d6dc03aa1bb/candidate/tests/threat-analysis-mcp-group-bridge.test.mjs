import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOGICAL_MAPPINGS,
  MANUAL_REQUIRED,
  PENDING_REQUIRED,
  startMcpGroupBridge,
} from '../dsh/managed/threat-analysis/mcp-group-bridge.mjs'
import {
  pythonEnvironment,
  pythonRuntimeConfig,
  runtimeGroupConnection,
} from '../dsh/managed/threat-analysis.mjs'

function discovery(selected = LOGICAL_MAPPINGS) {
  const tools = []
  const resources = []
  const resourceTemplates = []
  for (const item of selected) {
    if (item.target.kind === 'tool') tools.push({ name: item.target.name, inputSchema: { type: 'object' } })
    else if (item.target.kind === 'resource') resources.push({
      name: item.target.name, uri: `https://soc.example/resources/${item.target.name}`,
    })
    else resourceTemplates.push({ name: item.target.name,
      uriTemplate: `https://soc.example/resources/${item.target.name}/${item.target.variables.map(name => `{${name}}`).join('/')}` })
  }
  return { tools, resources, resourceTemplates }
}

function fakeClient(source, options = {}) {
  const calls = []
  const discoveryCalls = []
  let closed = 0
  return {
    calls, discoveryCalls,
    get closed() { return closed },
    async listTools() { discoveryCalls.push('tools'); return { tools: source.tools } },
    async listResources() {
      discoveryCalls.push('resources')
      if (options.resourceDiscoveryError) throw new Error('resource discovery unavailable')
      return { resources: source.resources }
    },
    async listResourceTemplates() {
      discoveryCalls.push('resourceTemplates')
      if (options.resourceDiscoveryError) throw new Error('resource template discovery unavailable')
      return { resourceTemplates: source.resourceTemplates }
    },
    async callTool(request) {
      calls.push(['tool', request.name, request.arguments])
      if (options.toolError) return { isError: true,
        _meta: { 'io.deepseek.dsh/openapi-response': { status: 409 } },
        content: [{ type: 'text', text: '{"message":"claimed"}' }] }
      return { content: [{ type: 'text', text: '{"code":200,"data":{"judgementId":"judgement-1"}}' }] }
    },
    async readResource(request) {
      calls.push(['resource', request.uri])
      return { contents: [{ uri: request.uri, mimeType: 'application/json',
        text: '{"code":200,"data":{"incidentId":"INC-20261010-000001"}}' }] }
    },
    async close() { closed += 1 },
  }
}

async function open(mode, source, clientOptions) {
  const client = fakeClient(source, clientOptions)
  const factoryCalls = []
  const bridge = await startMcpGroupBridge({
    groupUrl: 'http://127.0.0.1:3094/mcp/groups/threat-analysis-runtime',
    token: 'shared-token', mode,
    async clientFactory(options) { factoryCalls.push(options); return client },
  })
  return { bridge, client, factoryCalls }
}

async function invoke(bridge, body, key = bridge.key) {
  const response = await fetch(`${bridge.url}/invoke`, { method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

test('手工预检固定为 18 项 SOC，报告工具缺失不阻断', async () => {
  assert.equal(MANUAL_REQUIRED.length, 18)
  assert.equal(PENDING_REQUIRED.length, 1)
  const source = discovery(LOGICAL_MAPPINGS.filter(item => item.resource !== 'report-write'))
  const { bridge, client, factoryCalls } = await open('manual', source)
  try {
    assert.equal(factoryCalls[0].groupUrl,
      'http://127.0.0.1:3094/mcp/groups/threat-analysis-runtime')
    assert.equal(factoryCalls[0].token, 'shared-token')

    const claim = await invoke(bridge, { resource: 'ai_soc_correlate',
      tool: 'ai_soc_correlate__create_incident_judgement_claim', args: { incidentId: 'INC-20261010-000001' } })
    assert.deepEqual(claim, { status: 200, body: { status: 'success', status_code: 200,
      result: { code: 200, data: { judgementId: 'judgement-1' } } } })

    const incident = await invoke(bridge, { resource: 'ai_soc_correlate',
      tool: 'ai_soc_correlate__get_correlate_incident_by_incident_id',
      args: { incidentId: 'INC/20261010 000001' } })
    assert.equal(incident.body.status, 'success')
    assert.match(client.calls.at(-1)[1], /INC%2F20261010%20000001$/)

    const report = await invoke(bridge, { resource: 'report-write',
      tool: 'save_persistence_result', args: { businessId: 'run-1' } })
    assert.deepEqual(report, { status: 200, body: {
      status: 'error', status_code: 503, error_type: 'McpMappingUnavailable',
    } })

    assert.equal((await invoke(bridge, { resource: 'ai_soc_correlate',
      tool: 'ai_soc_correlate__create_incident_judgement_claim', args: {} }, 'wrong-key')).status, 403)
  } finally {
    await bridge.close()
  }
  assert.equal(client.closed, 1)
})

test('pending 运行只预检待研判入口，手工运行缺少任一 SOC 映射即失败', async () => {
  const pending = LOGICAL_MAPPINGS.filter(item => item.tool.endsWith('__get_correlate_incident_judge_pending'))
  const active = await open('pending', discovery(pending), { resourceDiscoveryError: true })
  assert.deepEqual(active.client.discoveryCalls, ['tools'])
  await active.bridge.close()
  assert.equal(active.client.closed, 1)

  const source = discovery(LOGICAL_MAPPINGS.filter(item =>
    item.tool !== 'ai_soc_event__search_event' && item.resource !== 'report-write'))
  const client = fakeClient(source)
  await assert.rejects(startMcpGroupBridge({
    groupUrl: 'http://127.0.0.1:3094/mcp/groups/threat-analysis-runtime',
    token: 'shared-token', mode: 'manual', clientFactory: async () => client,
  }), /ai_soc_event__search_event/)
  assert.equal(client.closed, 1)
})

test('MCP tool error 优先使用结构化 OpenAPI meta 保留 409', async () => {
  const active = await open('pending', discovery(LOGICAL_MAPPINGS), { toolError: true })
  try {
    const value = await invoke(active.bridge, { resource: 'ai_soc_correlate',
      tool: 'ai_soc_correlate__get_correlate_incident_judge_pending', args: {} })
    assert.deepEqual(value, { status: 200, body: { status: 'error', status_code: 409,
      result: { message: 'claimed' }, error_type: 'Error' } })
  } finally {
    await active.bridge.close()
  }
})

test('DSH 分组地址由本实例端口派生，传给 Python 的配置不含 sharedToken', () => {
  const config = { keep: 'value', connections: { runtimeGroup: {
    id: 'threat-analysis-runtime', token: 'secret-shared-token',
  } } }
  assert.deepEqual(runtimeGroupConnection({ webServer: { port: 3094 } }, config), {
    groupUrl: 'http://127.0.0.1:3094/mcp/groups/threat-analysis-runtime',
    token: 'secret-shared-token',
  })
  const value = pythonRuntimeConfig(config, { url: 'http://127.0.0.1:41234', key: 'run-key' }, {
    baseURL: 'http://127.0.0.1:42345', model: 'Qwen3.8-27B', apiKeyEnv: 'THREAT_MODEL_BRIDGE_KEY',
  })
  assert.equal(JSON.stringify(value).includes('secret-shared-token'), false)
  assert.deepEqual(value.connections, { runtime: {
    bridgeUrl: 'http://127.0.0.1:41234', bridgeKey: 'run-key',
  } })
  assert.equal(value.keep, 'value')
  assert.deepEqual(pythonEnvironment({ EXTRA: 'kept' }, {
    PATH: '/bin', THREAT_ANALYSIS_MCP_TOKEN: 'secret-shared-token',
  }), { PATH: '/bin', EXTRA: 'kept' })
})
