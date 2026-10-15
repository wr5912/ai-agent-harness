/** 用锁定 Runtime 的真实 SDK 构造请求，网络边界截获载荷，不调用模型。 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { streamSimple } = await import(pathToFileURL(process.argv[2]).href)
let networkRequests = 0
const originalFetch = globalThis.fetch
const captures = []
globalThis.fetch = async () => { networkRequests++; throw new Error('probe must not send HTTP') }
const base = { id: 'probe-model', name: 'probe', provider: 'probe', api: 'openai-completions', baseUrl: 'https://example.invalid/v1',
  contextWindow: 8192, maxTokens: 256, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, reasoning: true }
const capture = async (format, reasoning, map = {}) => {
  const model = { ...base, thinkingLevelMap: map, compat: { thinkingFormat: format, maxTokensField: 'max_tokens' } }
  const stream = streamSimple(model, { messages: [{ role: 'user', content: '仅输出摘要', timestamp: Date.now() }] }, {
    apiKey: 'probe', reasoning, maxTokens: 128,
    onPayload(payload) { captures.push(payload); throw new Error('captured before network') },
  })
  for await (const _ of stream) {}
  return captures.at(-1)
}
try {
  const deepseek = await capture('deepseek')
  const qwenCloud = await capture('qwen')
  const qwenLocal = await capture('qwen-chat-template')
  const main = await capture('qwen-chat-template', 'xhigh', { xhigh: 'xhigh' })
  const effort = await capture(undefined, undefined, { off: 'none' })
  assert.equal(deepseek.thinking.type, 'disabled')
  assert.equal(qwenCloud.enable_thinking, false)
  assert.equal(qwenLocal.chat_template_kwargs.enable_thinking, false)
  assert.equal(main.chat_template_kwargs.enable_thinking, true)
  assert.equal(effort.reasoning_effort, 'none')
  assert.equal(captures.length, 5)
  assert.equal(networkRequests, 0)
  assert.ok(captures.every(payload => payload.max_tokens === 128))
  assert.equal(deepseek.enable_thinking, undefined)
  assert.equal(qwenLocal.thinking, undefined)
  // 官方 DeepSeek 路由使用 Messages API；同时验证其真实序列化器。
  const { DeepSeekAdapter } = await import(pathToFileURL(process.argv[3] + '/index.js').href)
  const connection = { models: [{ id: 'deepseek-flash' }], maxTokens: 8192, defaultContextWindow: 8192,
    baseURL: 'https://example.invalid', streamIdleTimeoutMs: 10000,
    defaults: { thinking: 'enabled', reasoningEffort: 'high' } }
  const options = { provider: 'deepseek-official', model: 'deepseek-flash', system: '仅输出摘要',
    messages: [{ role: 'user', content: [{ type: 'text', text: '风险尚未排除' }] }] }
  const adapter = new DeepSeekAdapter({ options: () => connection,
    resolveAuth: async () => ({ headers: { 'x-api-key': 'probe' } }),
    resolveUserId: () => 'probe',
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) })
  const info = await adapter.resolveModel(options.provider, options.model)
  assert.equal(info.reasoning.efforts[0].id, 'off')
  assert.equal(info.reasoning.defaultEffort, 'high')
  const nativeCaptures = []
  globalThis.fetch = async (_, init) => { nativeCaptures.push(JSON.parse(init.body)); throw new Error('captured before network') }
  for (const request of [{ ...options, reasoningEffort: 'off', maxTokens: 128 }, options]) {
    const count = nativeCaptures.length
    try { for await (const _ of adapter.stream(request)) {} } catch (error) { if (nativeCaptures.length === count) throw error }
  }
  assert.equal(nativeCaptures.length, 2)
  const [nativeSummary, nativeMain] = nativeCaptures
  assert.equal(nativeSummary.thinking.type, 'disabled')
  assert.equal(nativeSummary.max_tokens, 128)
  assert.equal(nativeSummary.output_config, undefined)
  assert.equal(nativeMain.thinking.type, 'enabled')
  assert.equal(nativeMain.output_config.effort, 'high')
  console.log(JSON.stringify({ deepseekDisabled: true, qwenCloudDisabled: true, qwenLocalDisabled: true,
    nativeDeepseekDisabled: true, nativeMainThinkingPreserved: true, mainThinkingPreserved: true,
    genericNoneSupported: true, boundedOutput: true, noMixedVendorFields: true, networkRequests }))
} finally { globalThis.fetch = originalFetch }
