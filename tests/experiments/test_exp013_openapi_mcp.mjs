import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'

for (const experiment of ['EXP-security-operations-expert-013', 'EXP-security-operations-expert-014-r8b1bd54e8be7']) test(`${experiment} OpenAPI 规范生成工具与资源，携带 API Key 调用接口`, async () => {
  const { callOpenApiTool, loadOpenApi, readOpenApiResource } = await import(`../../evolution/experiments/${experiment}/candidate/dsh/managed/mcp-manager/openapi.mjs`)
  let origin
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/openapi?format=json') {
      res.end(JSON.stringify({ openapi: '3.1.0', servers: [{ url: origin }],
        components: { securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
          schemas: { Item: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
        security: [{ key: [] }], paths: {
          '/items': { get: { operationId: 'listItems' }, post: { operationId: 'createItem',
            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } } },
          '/items/{itemId}': { get: { operationId: 'getItem', parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }] } },
          '/search': { get: { operationId: 'searchItems', parameters: [{ name: 'term', in: 'query', required: true, schema: { type: 'string' } }] } },
        } }))
      return
    }
    if (req.headers['x-api-key'] !== 'fixture-key') { res.statusCode = 401; res.end('{}'); return }
    if (req.method === 'POST' && req.url === '/items') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      res.end(JSON.stringify({ created: JSON.parse(Buffer.concat(chunks).toString()) }))
      return
    }
    res.end(JSON.stringify({ method: req.method, url: req.url }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  try {
    const source = await loadOpenApi({ specUrl: `${origin}/openapi?format=json`, apiKey: 'fixture-key' })
    assert.deepEqual(source.tools.map(tool => tool.name), ['createItem', 'searchItems'])
    assert.deepEqual(source.resources.map(resource => resource.uri), [`${origin}/items`])
    assert.deepEqual(source.resourceTemplates.map(resource => resource.uriTemplate), [`${origin}/items/{itemId}`])
    assert.deepEqual(source.tools[0].inputSchema.$defs.Item.required, ['name'])
    assert.match((await readOpenApiResource(source, `${origin}/items`)).contents[0].text, /"url":"\/items"/)
    assert.match((await readOpenApiResource(source, `${origin}/items/123`)).contents[0].text, /"url":"\/items\/123"/)
    assert.match((await callOpenApiTool(source, 'searchItems', { term: 'alert' })).content[0].text, /"url":"\/search\?term=alert"/)
    assert.match((await callOpenApiTool(source, 'createItem', { body: { name: 'sample' } })).content[0].text, /"created":\{"name":"sample"\}/)
    await assert.rejects(readOpenApiResource(source, `${origin}/other`), /不属于当前 OpenAPI 范围/)
  } finally { server.close() }
})
