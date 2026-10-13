import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
for (const experiment of ['EXP-security-operations-expert-017-rb20b8c6b906f', 'EXP-security-operations-expert-017-r94f3b07e080f']) {
  const { callOpenApiTool, loadOpenApi, readOpenApiResource } = await import(`../../evolution/experiments/${experiment}/candidate/dsh/managed/mcp-manager/openapi.mjs`)

  test(`${experiment}: 公开规范匿名读取，业务请求仍用凭据且保留业务 403`, async () => {
    let origin
    const requests = []
    const spec = () => ({ openapi: '3.1.0', servers: [{ url: origin }], components: { schemas: {
      Work: { type: 'object', properties: { id: { type: 'integer', format: 'int64' },
        next: { $ref: '#/components/schemas/Work' } } },
    } }, paths: {
      '/ok': { get: { operationId: 'readOk' } },
      '/denied': { get: { operationId: 'readDenied' } },
      '/work': { post: { operationId: 'doWork', requestBody: { content: { 'application/json': {
        schema: { $ref: '#/components/schemas/Work' },
      } } } } },
    } })
    const server = createServer((req, res) => {
      requests.push({ path: req.url, key: req.headers['x-api-key'] })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/spec') {
        if (req.headers['x-api-key']) res.statusCode = 403
        res.end(JSON.stringify(spec()))
      } else {
        if (req.headers['x-api-key'] !== 'test-key' || req.url === '/denied') res.statusCode = 403
        res.end(JSON.stringify({ status: res.statusCode }))
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`
    try {
      const source = await loadOpenApi({ id: 'tee', specUrl: `${origin}/spec`, authType: 'credential', authHeader: 'X-API-Key', apiKey: 'test-key' })
      assert.equal(source.resources.length, 2)
      assert.deepEqual(source.tools[0].inputSchema.properties.body, { type: 'object', properties: {
        id: { type: 'integer' }, next: {},
      } })
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0], { path: '/spec', key: undefined })
      assert.match((await readOpenApiResource(source, `${origin}/ok`)).contents[0].text, /200/)
      assert.equal((await callOpenApiTool(source, 'doWork', {})).isError, false)
      await assert.rejects(readOpenApiResource(source, `${origin}/denied`), /Resource 读取失败：HTTP 403/)
      assert.deepEqual(requests.slice(1).map(({ key }) => key), ['test-key', 'test-key', 'test-key'])
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })

  test(`${experiment}: 受保护规范仅在 401/403 后授权重试，无凭据保持失败`, async () => {
    let origin
    const requests = []
    let protectedStatus = 403
    const server = createServer((req, res) => {
      requests.push(req.headers['x-api-key'])
      res.setHeader('content-type', 'application/json')
      if (protectedStatus === 500 || req.headers['x-api-key'] !== 'test-key') res.statusCode = protectedStatus
      res.end(JSON.stringify({ openapi: '3.1.0', servers: [{ url: origin }], paths: {} }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`
    try {
      for (protectedStatus of [401, 403]) {
        requests.length = 0
        await assert.rejects(loadOpenApi({ specUrl: `${origin}/spec` }), new RegExp(`HTTP ${protectedStatus}（匿名访问）`))
        assert.deepEqual(requests, [undefined])
        const config = { specUrl: `${origin}/spec`, authType: 'credential', authHeader: 'X-API-Key', apiKey: 'test-key' }
        await loadOpenApi(config)
        assert.deepEqual(requests, [undefined, undefined, 'test-key'])
        await assert.rejects(loadOpenApi({ ...config, apiKey: 'wrong-key' }), new RegExp(`HTTP ${protectedStatus}（凭据重试）`))
        assert.deepEqual(requests.slice(3), [undefined, 'wrong-key'])
      }
      protectedStatus = 500
      requests.length = 0
      await assert.rejects(loadOpenApi({ specUrl: `${origin}/spec`, apiKey: 'test-key' }), /HTTP 500（匿名访问）/)
      assert.deepEqual(requests, [undefined])
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })

  test(`${experiment}: 登录保护规范在匿名失败后登录，凭据复用到下次读取`, async () => {
    let origin
    let loginCount = 0
    const seen = []
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/login') {
        loginCount++
        res.end(JSON.stringify({ token: 'login-token' }))
        return
      }
      seen.push(req.headers.authorization)
      if (req.headers.authorization !== 'login-token') res.statusCode = 401
      res.end(JSON.stringify({ openapi: '3.1.0', servers: [{ url: origin }], paths: {} }))
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`
    try {
      const config = { id: 'login-spec', specUrl: `${origin}/spec`, authType: 'login',
        loginUrl: `${origin}/login`, loginUsername: 'operator', loginPassword: 'password' }
      await loadOpenApi(config)
      await loadOpenApi(config)
      assert.equal(loginCount, 1)
      assert.deepEqual(seen, [undefined, 'login-token', undefined, 'login-token'])
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })
}
