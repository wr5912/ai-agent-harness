import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runDeliverySession } from './dsh-eval-api.mjs'

// 与平台相同，从平台包注入压缩能力，不给适配器源码目录增加依赖副本。
const { zipSync, strToU8, strFromU8, unzipSync } = createRequire(new URL('../../../platform/plugin/package.json', import.meta.url))('fflate')
const user = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const assistant = text => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })
const end = turn => ({ type: 'turn/end', data: { reason: { kind: 'completed' }, turn } })

for (const mode of ['abort', 'complete', 'mismatch']) test(`交付实例多轮 ${mode}：仅整段完成才记录成功，异常必须取消并保留部分证据`, async t => {
  const abortSecond = mode === 'abort', mismatch = mode === 'mismatch'
  const directory = await mkdtemp(join(tmpdir(), 'hep-delivery-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let prompts = 0, cancels = 0
  const controller = new AbortController()
  const server = createServer(async (request, response) => {
    if (request.url === '/assistant/') { response.end('ready'); return }
    const method = new URL(request.url, 'http://localhost').pathname.slice('/assistant/api/'.length)
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const args = chunks.length ? JSON.parse(Buffer.concat(chunks)).payload.args : null
    const reply = value => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ result: { ok: true, value } })) }
    if (method === 'workspace/create') return reply({ workspace: { workspaceId: 'workspace-review', path: '/work/harness/workspace' } })
    if (method === 'session/create') return reply({ sessionId: 'session-review', agentPreset: 'review' })
    if (method === 'session/rename') return reply({ title: args.request.title, seq: 1 })
    if (method === 'session/list') return reply({ items: [{ sessionId: 'session-review', cwd: '/work/harness/workspace', projections: { values: { agentPreset: 'review' } } }] })
    if (method === 'session/prompt') { prompts++; return reply({ accepted: true }) }
    if (method === 'session/cancel') { cancels++; return reply({ accepted: true }) }
    if (method === 'session.export') {
      const events = [{ type: 'session', id: 'session-review' }, user('第一轮'), assistant('第一轮完成'), end(1), ...(prompts === 2 ? [user(mismatch ? '其他会话的第二轮' : '第二轮'), ...(!abortSecond ? [assistant('第二轮完成'), end(2)] : [])] : [])]
      response.end(Buffer.from(zipSync({ 'session.jsonl': strToU8(events.map(event => JSON.stringify(event)).join('\n') + '\n') })))
      // 第二轮部分轨迹确已返回后触发暂停/总截止，避免只测到了尚未发起输入。
      if (abortSecond && prompts === 2) setTimeout(() => controller.abort(), 25)
      return
    }
    response.writeHead(404); response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const execute = () => runDeliverySession({ auth_url: `http://127.0.0.1:${server.address().port}/assistant/`, workspace: '/work/harness/workspace', preset_id: 'review', timeout_ms: 1500, evidence_root: directory },
    { case_id: 'U-MULTI-001', inputs: ['第一轮', '第二轮'] }, controller.signal, { unzipSync, strFromU8 })
  if (abortSecond) await assert.rejects(execute, /case-hard-timeout/)
  else if (mismatch) await assert.rejects(execute, /evidence-cross-turn/)
  else assert.equal((await execute()).checks.completed, true)
  const checks = JSON.parse(await readFile(join(directory, 'U-MULTI-001/checks.json'), 'utf8'))
  const response = JSON.parse(await readFile(join(directory, 'U-MULTI-001/response.json'), 'utf8'))
  assert.equal(prompts, 2); assert.equal(cancels, mode === 'complete' ? 0 : 1)
  assert.equal(checks.completed, mode === 'complete')
  assert.deepEqual(response.assistant_texts, mode === 'complete' ? ['第一轮完成', '第二轮完成'] : ['第一轮完成'])
  assert.match(await readFile(join(directory, 'U-MULTI-001/trace.jsonl'), 'utf8'), /第二轮/)
})
