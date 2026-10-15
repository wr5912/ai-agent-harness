import assert from 'node:assert/strict'
import { generateKeyPairSync, verify } from 'node:crypto'
import { createServer } from 'node:http'
import test from 'node:test'
import * as selection from '../dsh/managed/policy-selection-runtime.mjs'
import * as delivery from '../dsh/managed/operation-result-delivery.mjs'
import * as policy from '../dsh/managed/policy-confirmation-runtime.mjs'
import * as emergency from '../dsh/managed/emergency-confirmation-runtime.mjs'

const operationId = `op_${'1'.repeat(32)}`
const digest = `sha256:${'a'.repeat(64)}`
const candidateId = letter => `sha256:${letter.repeat(64)}`
const future = () => new Date(Date.now() + 600_000).toISOString()
const policyDraft = () => ({ operationId, candidateDigest: digest, version: 2, confirmationExpiresAt: future(), resultMarkdown: '基础访问策略草稿' })
const emergencyDraft = () => ({ operationId, snapshotDigest: digest, version: 2, expiresAt: future() })
const envelope = data => ({ code: '200', data })
const answer = (question, label, custom) => ({ answers: [{ id: question.id, selected: [label], ...(custom ? { custom } : {}) }] })
const takeStream = async stream => { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }

function environment(t, values) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
}

async function platform(t, reply) {
  const calls = []
  const server = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      calls.push({ method: request.method, path: request.url, body })
      const result = await reply(calls.at(-1), calls.length)
      response.writeHead(result.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(result.value))
    } catch { response.writeHead(500).end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  environment(t, { AI_PLATFORM_URL: `http://127.0.0.1:${server.address().port}` })
  return calls
}

function fixtureRuntime(ask) {
  const hooks = new Map(), adapters = new Map(), steered = []
  const agent = { id: `policy-basic-${crypto.randomUUID()}`, session: { header: { delegationDepth: 0 }, snapshotEvents: () => [] }, steer: message => steered.push(message) }
  const ctx = { on: (name, hook) => hooks.set(name, hook), userQuestions: { ask }, logger: { warn() {} }, llm: { registerAdapter: (names, adapter) => names.forEach(name => adapters.set(name, adapter)) } }
  selection.apply(ctx); delivery.apply(ctx)
  return { hooks, adapters, agent, steered }
}

const endpointBody = { request_id: 'basic-endpoint-request', operation: 'ADD', action: 'ALLOW', source_query: '基础主机', destination_query: '基础服务', protocol: 'TCP', ports: [443] }
function endpoints() {
  return { request_id: endpointBody.request_id, resolution_status: 'SELECTION_REQUIRED', candidate_set_digest: digest, result_markdown: '基础主机有两个候选，请选择本次端点。',
    source: { candidates: [{ candidate_id: candidateId('b'), label: '基础主机一', ip: '192.0.2.10' }, { candidate_id: candidateId('c'), label: '基础主机二', ip: '192.0.2.20' }] },
    destination: { candidates: [{ candidate_id: candidateId('d'), label: '基础服务', ip: '192.0.2.30' }] } }
}

test('实际端点工具回执先固定交付，再经原生选择与HTTP接续冻结prepare对象', async t => {
  const prepare = { ...endpointBody, source_query: '192.0.2.20', destination_query: '192.0.2.30' }
  const calls = await platform(t, () => ({ value: envelope({ request_id: endpointBody.request_id, resolution_status: 'RESOLVED', prepare_body: prepare, result_markdown: '本次端点已明确' }) }))
  const emitted = [], signal = new AbortController().signal
  let questions = 0
  const runtime = fixtureRuntime(async input => {
    questions++
    assert.strictEqual(input.signal, signal)
    assert.ok(emitted.some(chunk => chunk.type === 'text-delta' && chunk.text === endpoints().result_markdown), '问题面板只能在原草稿已进入正文后开启')
    return answer(input.questions[0], input.questions[0].options[1].label)
  })
  const exec = { name: 'mcp__policy-configuration__resolve_policy_endpoints', agent: runtime.agent, arguments: { body: endpointBody }, signal }
  assert.deepEqual(await runtime.hooks.get('tools/post-execute')(exec, { value: envelope(endpoints()) }, async () => ({ kind: 'accept' })), { kind: 'accept' })
  const originalRoute = { provider: 'fixture-provider', model: 'basic-model' }
  const route = await runtime.hooks.get('agent/request')({ agent: runtime.agent, turn: 1, signal }, async () => originalRoute)
  assert.equal(route.provider, 'security-operation-delivery')
  for await (const chunk of runtime.adapters.get(route.provider).stream({ sessionId: runtime.agent.id, signal })) emitted.push(chunk)
  assert.equal(questions, 1, '单候选目的端无需重复询问')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/api/v1/policy-configurations/endpoint-resolution/selection')
  assert.deepEqual(calls[0].body, { ...endpointBody, candidate_set_digest: digest, selected_source_candidate_id: candidateId('c'), selected_destination_candidate_id: candidateId('d') })
  assert.equal(runtime.steered.length, 1)
  assert.ok(runtime.steered[0].content[0].text.includes(JSON.stringify(prepare)))
  assert.match(runtime.steered[0].content[0].text, /这不是执行授权/)
  assert.equal(emitted.filter(chunk => chunk.type === 'finish').length, 1)
  assert.deepEqual(await runtime.hooks.get('agent/request')({ agent: runtime.agent, turn: 1, signal }, async () => route), originalRoute)
})

test('原生取消端点选择不请求平台、不准备策略，漂移请求不能成为可选候选', async t => {
  const calls = await platform(t, () => ({ value: envelope({}) }))
  const signal = new AbortController().signal
  const runtime = fixtureRuntime(async input => answer(input.questions[0], '取消本次配置'))
  await runtime.hooks.get('tools/post-execute')({ name: 'mcp__policy-configuration__resolve_policy_endpoints', agent: runtime.agent, arguments: { body: endpointBody } }, { value: envelope(endpoints()) }, async () => ({ kind: 'accept' }))
  assert.match(await delivery.runPostDeliveryInteraction(runtime.agent.id, signal), /已取消本次策略配置/)
  assert.deepEqual(calls, [])
  assert.deepEqual(runtime.steered, [])
  assert.equal(selection.endpointChoice({ ...endpoints(), request_id: 'different-request' }, endpointBody), null)
  assert.equal(selection.endpointChoice({ ...endpoints(), candidate_set_digest: 'missing' }, endpointBody), null)
  assert.equal(selection.endpointChoice(endpoints(), { ...endpointBody, action: 'ADD' }), null)
})

test('端点选择响应身份漂移时不接续prepare，也不产生虚假成功', async t => {
  const calls = await platform(t, () => ({ value: envelope({ request_id: 'different-request', resolution_status: 'RESOLVED', prepare_body: endpointBody }) }))
  const runtime = fixtureRuntime(async input => answer(input.questions[0], input.questions[0].options[0].label))
  await runtime.hooks.get('tools/post-execute')({ name: 'mcp__policy-configuration__resolve_policy_endpoints', agent: runtime.agent, arguments: { body: endpointBody } }, { value: envelope(endpoints()) }, async () => ({ kind: 'accept' }))
  const result = await delivery.runPostDeliveryInteraction(runtime.agent.id, new AbortController().signal)
  assert.match(result, /处理结果：未完成/)
  assert.equal(calls.length, 1)
  assert.deepEqual(runtime.steered, [])
})

test('原生替代设备选择后先读取新的冻结版本，旧版本回执不得继续准备或确认', async t => {
  const first = { candidate_id: candidateId('b'), label: '基础设备二', device_query: 'basic-device-2' }
  const second = { candidate_id: candidateId('c'), label: '基础设备三', device_query: 'basic-device-3' }
  const frozen = { operation_id: operationId, stage_code: 'awaiting_candidate_selection', candidate: {
    candidate_set_digest: digest, intent_digest: candidateId('d'), business_revision: 1, replacement_required: true,
    original_device_query: 'basic-device-1', candidates: [first, second],
  } }
  let revision = 2
  const calls = await platform(t, request => ({ value: envelope(request.method === 'POST' ? { operation_id: operationId } : {
    operation_id: operationId, candidate: { ...frozen.candidate, business_revision: revision, intent_digest: candidateId('e'), replacement_required: false, original_device_query: second.device_query },
    selection: { selected_candidate_id: second.candidate_id },
  }) }))
  for (const fresh of [true, false]) {
    revision = fresh ? 2 : 1
    const runtime = fixtureRuntime(async input => answer(input.questions[0], input.questions[0].options[1].label))
    await runtime.hooks.get('tools/post-execute')({ name: 'mcp__policy-configuration__get_policy_configuration_status', agent: runtime.agent, arguments: { operationId } }, { value: envelope(frozen) }, async () => ({ kind: 'accept' }))
    const result = await delivery.runPostDeliveryInteraction(runtime.agent.id, new AbortController().signal)
    if (fresh) {
      assert.equal(runtime.steered.length, 1)
      assert.match(runtime.steered[0].content[0].text, /policy-device-selection\/v1/)
      assert.match(runtime.steered[0].content[0].text, /只续查当前 operationId/)
    } else {
      assert.deepEqual(runtime.steered, [])
      assert.match(result, /冻结版本或生效目标尚未核验/)
    }
  }
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'POST', 'GET'])
  assert.ok(calls.every(call => call.path === `/api/v1/policy-configurations/${operationId}${call.method === 'POST' ? '/candidate-selection' : ''}`))
  assert.deepEqual(calls[0].body.ranked_candidate_ids, [second.candidate_id, first.candidate_id])
  assert.deepEqual(calls[0].body.reason_codes, ['user_confirmed_device_replacement'])
})

test('候选与策略确认均绑定当前面板；自由补充和不明确选择不成为执行授权', async () => {
  const candidates = endpoints().source.candidates
  const question = selection.nativeCandidateQuestion('basic-session\nrequest-a', 'source', candidates)
  const newer = selection.nativeCandidateQuestion('basic-session\nrequest-b', 'source', candidates)
  assert.notEqual(question.id, newer.id)
  assert.equal(selection.nativeCandidateDecision(answer(question, question.options[0].label), newer, candidates).kind, 'skip')
  assert.equal(selection.nativeCandidateDecision(answer(question, question.options[0].label, '请重新核对基础主机'), question, candidates).kind, 'custom')
  const draft = policyDraft(), panel = policy.nativePolicyQuestion(draft).questions[0]
  assert.equal(policy.nativePolicyDecision(answer(panel, '执行'), draft).kind, 'execute')
  assert.equal(policy.nativePolicyDecision(answer(panel, '执行', '请先调整端口'), draft).kind, 'custom')
  assert.equal(policy.nativePolicyDecision(answer(panel, '执行'), { ...draft, version: 3 }).kind, 'skip')
  assert.equal(policy.nativePolicyDecision({ answers: [{ id: panel.id, selected: ['执行', '取消执行'] }] }, draft).kind, 'skip')
})

test('策略与应急的原生明确确认仅调用受信回调一次，补充和取消不走确认', async () => {
  const exec = { agent: { id: 'basic-confirm-session' } }
  const draft = policyDraft(), panel = policy.nativePolicyQuestion(draft).questions[0]
  let policyCalls = 0
  const confirmed = await policy.handleNativePolicyDecision(exec, draft, answer(panel, '执行'), async (agent, actual) => {
    assert.strictEqual(agent, exec.agent); assert.strictEqual(actual, draft); policyCalls++
    return { resultMarkdown: '基础模拟策略请求已受理，执行结果待核实' }
  })
  assert.equal(policyCalls, 1)
  assert.match(confirmed.markdown, /执行结果待核实/)
  const emergencyPanel = emergency.nativeEmergencyQuestion(emergencyDraft()).questions[0]
  let emergencyCalls = 0
  const confirmEmergency = async () => { emergencyCalls++; return { message: '基础模拟应急请求已受理，执行结果待核实' } }
  const emergencyResult = await emergency.handleNativeEmergencyDecision(exec, emergencyDraft(), answer(emergencyPanel, '确认执行'), confirmEmergency)
  assert.match(emergencyResult.markdown, /待核实/)
  await emergency.handleNativeEmergencyDecision(exec, emergencyDraft(), answer(emergencyPanel, '取消执行'), confirmEmergency)
  await emergency.handleNativeEmergencyDecision(exec, emergencyDraft(), answer(emergencyPanel, '确认执行', '请调整基础目标'), confirmEmergency)
  assert.equal(emergencyCalls, 1)
})

function eventsFor(name, data) {
  return [
    { type: 'tool/call', seq: 1, data: { callId: 'basic-call', name, arguments: JSON.stringify({ operationId, body: { request_id: 'basic-request' } }) } },
    { type: 'tool/result', seq: 2, data: { message: { source: { kind: 'tool', callId: 'basic-call' }, content: [{ type: 'text', text: JSON.stringify(envelope(data)) }] } } },
  ]
}

test('旧确认恢复只接受会话中最新真实草稿；普通补充、过期与新版本阻止旧确认', () => {
  const policyData = { operation_id: operationId, task_status: 'DRAFT', confirmation_required: true, result_code: 'DRAFT_READY', candidate_digest: digest, version: 2, confirmation_expires_at: future(), result_markdown: '基础策略草稿' }
  const policyEvents = eventsFor('mcp__policy-configuration__get_policy_configuration_result', policyData)
  assert.equal(policy.latestDraft(policyEvents).version, 2)
  assert.equal(policy.latestDraft([...policyEvents, { type: 'user/message', seq: 3, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '请调整基础端口' }] } }]), null)
  const drifted = eventsFor('mcp__policy-configuration__get_policy_configuration_result', { ...policyData, candidate_digest: candidateId('b') }).map(event => ({ ...event, seq: event.seq + 2 }))
  assert.equal(policy.latestDraft([...policyEvents, ...drifted]), null)
  const emergencyData = { operation_id: operationId, phase: 'READY', execution_status: 'NOT_SUBMITTED', version: 2, snapshot_digest: digest, expires_at: future(), snapshot: { action_name: '基础模拟动作', target_name: '基础主机' } }
  const emergencyEvents = eventsFor('mcp__emergency-action__get_emergency_action', emergencyData)
  assert.equal(emergency.latestDraft(emergencyEvents, 'not-yet-visible').version, 2)
  assert.equal(emergency.latestDraft(eventsFor('mcp__emergency-action__get_emergency_action', { ...emergencyData, expires_at: '2000-01-01T00:00:00Z' }), 'not-yet-visible'), null)
  assert.equal(emergency.latestDraft([...emergencyEvents, { type: 'tool/call', seq: 3, data: { name: 'mcp__emergency-action__revise_emergency_action' } }], 'not-yet-visible'), null)
})

test('临时签名绑定同一草稿且确认窗口受限，不读取或落盘真实凭据', t => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  environment(t, { AI_PLATFORM_URL: 'http://127.0.0.1:1', PLATFORM_CONFIRMATION_ISSUER: 'basic-test-issuer', EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'), EMERGENCY_CONFIRMATION_ACTOR_ID: 'basic-test-user', AI_WORKBENCH_EMERGENCY_TENANT_ID: 'basic-test-tenant', AI_WORKBENCH_EMERGENCY_WORKSPACE_ID: 'basic-test-workspace' })
  const now = Date.now(), draft = { ...policyDraft(), confirmationExpiresAt: new Date(now + 30_000).toISOString() }
  const request = policy.confirmationArguments('basic-session', draft, now)
  const [encoded, signature] = request.body.proof.split('.')
  assert.equal(verify('sha256', Buffer.from(encoded, 'ascii'), publicKey, Buffer.from(signature, 'base64url')), true)
  const payload = JSON.parse(Buffer.from(encoded, 'base64url'))
  assert.equal(payload.operation_id, operationId); assert.equal(payload.candidate_digest, digest); assert.equal(payload.version, 2)
  assert.ok(payload.expires_at <= Math.floor(Date.parse(draft.confirmationExpiresAt) / 1000))
  assert.throws(() => policy.confirmationArguments('basic-session', { ...draft, confirmationExpiresAt: '2000-01-01T00:00:00Z' }, now), /过期/)
  assert.throws(() => policy.confirmationPrivateKey({}), /配置缺失/)
  const emergencyRequest = emergency.confirmationRequest('basic-session', emergencyDraft(), now)
  const [emergencyEncoded, emergencySignature] = emergencyRequest.proof.split('.')
  assert.equal(verify('sha256', Buffer.from(emergencyEncoded, 'ascii'), publicKey, Buffer.from(emergencySignature, 'base64url')), true)
  assert.equal(emergencyRequest.expected_version, 2)
  assert.equal(JSON.parse(Buffer.from(emergencyEncoded, 'base64url')).snapshot_digest, digest)
})

test('真实确认HTTP仅在明确503重试同一载荷，拒绝与回执漂移不标成功', async t => {
  environment(t, { PLATFORM_CONFIRMATION_ISSUER: 'basic-test-issuer', EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64: 'ephemeral-not-used-by-this-stub', EMERGENCY_CONFIRMATION_ACTOR_ID: 'basic-test-user', AI_WORKBENCH_EMERGENCY_TENANT_ID: 'basic-test-tenant', AI_WORKBENCH_EMERGENCY_WORKSPACE_ID: 'basic-test-workspace' })
  const joint = { operation_id: operationId, candidate_digest: digest, confirmation: { accepted: true, approval_receipt_id: 'basic-receipt' }, execution: { result_code: 'EXECUTION_IN_PROGRESS' }, failure_scope: 'NONE', result_markdown: '基础模拟请求已受理，执行结果待核实' }
  const calls = await platform(t, (_request, count) => count === 1 ? { status: 503, value: { code: '503' } } : { value: envelope(joint) })
  const request = { operationId, body: { request_id: 'basic-confirm-request', candidate_digest: digest, proof: 'basic-stub-proof' } }
  const accepted = await policy.invokeConfirmation(request, policyDraft())
  assert.equal(accepted.execution.result_code, 'EXECUTION_IN_PROGRESS')
  assert.equal(calls.length, 2)
  assert.ok(calls.every(call => call.path === `/api/v1/policy-configurations/${operationId}/confirmation`))
  assert.deepEqual(calls[0].body, calls[1].body)
  assert.throws(() => policy.validateConfirmation({ ...joint, operation_id: `op_${'2'.repeat(32)}` }, policyDraft()), /不一致/)
  let rejected = 0
  await assert.rejects(() => policy.invokeConfirmation(request, policyDraft(), async () => { rejected++; throw new Error('受控拒绝') }), /受控拒绝/)
  assert.equal(rejected, 1)
})

test('确认已受理后只读取当前权威结果，执行失败与未知保持原状态和原摘要', async t => {
  environment(t, { AI_PLATFORM_URL: 'http://127.0.0.1:1' })
  const draft = policyDraft()
  const confirmation = { execution: { result_code: 'EXECUTION_IN_PROGRESS' }, result_markdown: '基础模拟请求已受理' }
  for (const resultCode of ['FAILED', 'EXECUTION_UNKNOWN']) {
    let calls = 0
    const markdown = `基础模拟执行状态：${resultCode}`
    const result = await policy.settleConfirmation(confirmation, draft, { sleep: async () => {}, fetchImpl: async url => {
      calls++; assert.ok(url.endsWith(`/api/v1/policy-configurations/${operationId}/result`))
      return { ok: true, status: 200, json: async () => envelope({ operation_id: operationId, candidate_digest: digest, version: 2, result_code: resultCode, task_status: 'TERMINAL', result_markdown: markdown }) }
    } })
    assert.equal(calls, 1)
    assert.equal(result.execution.result_code, resultCode)
    assert.equal(result.result_markdown, markdown)
    assert.equal(result.execution.result_unknown, resultCode === 'EXECUTION_UNKNOWN')
  }
})
