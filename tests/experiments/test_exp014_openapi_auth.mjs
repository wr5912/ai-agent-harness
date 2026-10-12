import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { callOpenApiTool, loadOpenApi } from '../../evolution/experiments/EXP-security-operations-expert-014-r8b1bd54e8be7/candidate/dsh/managed/mcp-manager/openapi.mjs'

test('OpenAPI 凭据 Header 与登录凭据缓存、401 重取', async () => {
  let origin
  let loginCount = 0
  let currentToken = 'token-1'
  const seen = []
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/login') {
      const body = []
      for await (const chunk of req) body.push(chunk)
      assert.deepEqual(JSON.parse(Buffer.concat(body).toString()), { username: 'operator', password: 'password' })
      loginCount++
      res.end(JSON.stringify({ data: { token: currentToken } }))
      return
    }
    const authorization = req.headers.authorization
    seen.push({ path: req.url, authorization, custom: req.headers['x-custom-token'] })
    if (!['plain-key', currentToken].includes(authorization) && req.headers['x-custom-token'] !== 'custom-key') {
      res.statusCode = 401
      res.end('{}')
      return
    }
    if (req.url === '/openapi') {
      res.end(JSON.stringify({ openapi: '3.1.0', servers: [{ url: origin }],
        security: [{ Authorization: [] }], components: { securitySchemes: { Authorization: { type: 'apiKey', in: 'header', name: 'Authorization' } } },
        paths: { '/work': { post: { operationId: 'doWork', parameters: [{ name: 'Authorization', in: 'header' }] } } } }))
      return
    }
    res.end(JSON.stringify({ credential: authorization || req.headers['x-custom-token'] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  try {
    const direct = await loadOpenApi({ id: 'direct', specUrl: `${origin}/openapi`, authType: 'credential', apiKey: 'plain-key' })
    assert.match((await callOpenApiTool(direct, 'doWork', { Authorization: 'wrong' })).content[0].text, /\[redacted\]/)
    const custom = await loadOpenApi({ id: 'custom', specUrl: `${origin}/openapi`, authType: 'credential', authHeader: 'X-Custom-Token', apiKey: 'custom-key' })
    assert.match((await callOpenApiTool(custom, 'doWork', {})).content[0].text, /\[redacted\]/)
    assert.equal(seen[0].authorization, 'plain-key')
    assert.equal(seen[2].custom, 'custom-key')

    const login = { id: 'login', specUrl: `${origin}/openapi`, authType: 'login',
      loginUrl: `${origin}/login`, loginUsername: 'operator', loginPassword: 'password', loginTokenPath: 'data.token' }
    const [source] = await Promise.all([loadOpenApi(login), loadOpenApi(login)])
    await Promise.all([callOpenApiTool(source, 'doWork', {}), callOpenApiTool(source, 'doWork', {})])
    assert.equal(loginCount, 1)
    assert.equal(seen.at(-1).authorization, 'token-1')
    currentToken = 'token-2'
    const retried = await Promise.all([callOpenApiTool(source, 'doWork', {}), callOpenApiTool(source, 'doWork', {})])
    for (const result of retried) {
      assert.equal(result.isError, false)
      assert.match(result.content[0].text, /\[redacted\]/)
    }
    assert.equal(loginCount, 2)
    await loadOpenApi(login)
    assert.equal(loginCount, 2)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
