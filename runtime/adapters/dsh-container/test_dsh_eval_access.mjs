import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { test } from 'node:test'

test('API 评测执行器支持免认证入口并保留历史 Token 握手校验', async () => {
  let mode = 'plain', rpcCalls = 0
  const server = createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) {
      rpcCalls += 1
      assert.equal(request.headers.cookie || '', mode === 'token' ? 'dsh=test-only' : '')
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks))
      assert.equal(body.method, 'workspace/create')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ result: { ok: true, value: { workspace: { workspaceId: 'test-workspace', path: '/work/harness/workspace' } } } }))
      return
    }
    response.statusCode = mode === 'denied' ? 403 : ['token', 'missing-cookie'].includes(mode) ? 303 : 200
    if (mode === 'token') response.setHeader('set-cookie', 'dsh=test-only; Path=/')
    response.end('test-only')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    for (mode of ['plain', 'token', 'missing-cookie', 'denied', 'token-without-redirect']) {
      rpcCalls = 0
      const child = spawn(process.execPath, [new URL('./dsh-eval-api.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = '', stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.stdin.end(JSON.stringify({ auth_url: origin + (mode === 'plain' || mode === 'denied' ? '/' : '/?token=test-only'), workspace: '/work/harness/workspace', preset_id: 'test', judge_preset_id: 'test-judge', evidence_root: '/tmp/unused-eval-access-evidence', cases: [], timeout_ms: 1000 }))
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
      assert.equal(code, ['plain', 'token'].includes(mode) ? 0 : 2, mode + ': ' + stderr)
      assert.equal(rpcCalls, ['plain', 'token'].includes(mode) ? 1 : 0, mode)
      if (code === 0) assert.deepEqual(JSON.parse(stdout).rows, [])
    }
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
