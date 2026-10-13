import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export const name = 'threat-analysis'
export const inject = ['tools', 'llm']
export const TOOL_ROUTES = { tools: ['analyze_threat_incident'] }
const executeFile = promisify(execFile)
const runner = fileURLToPath(new URL('./threat-analysis/dsh_runner.py', import.meta.url))

export function apply(ctx, config = {}) {
  // 让 Runtime 正常持久化助手回复；此专用路由只回放固定摘要，不访问模型服务。
  const deliveryProvider = 'threat-analysis-delivery'
  const pending = new Map()
  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const config = await next()
    const events = agent.session.snapshotEvents()
    const markdown = deliveryMarkdown(events, turn)
    if (typeof markdown === 'string') {
      pending.set(agent.id, markdown)
      return { provider: deliveryProvider, model: 'fixed-summary' }
    }
    pending.delete(agent.id)
    // 后续用户消息继续使用原模型，不能继承上一轮的本地交付路由。
    if (config.provider === deliveryProvider) {
      const original = events.findLast(event => event.type === 'request/header'
        && event.data.header.config.provider !== deliveryProvider)?.data.header.config
      if (!original) throw new Error('missing original threat-analysis model route')
      return original
    }
    return config
  })
  // 注册原生适配器，使会话恢复和下一轮请求也能解析上一轮的交付来源。
  ctx.llm.registerAdapter([deliveryProvider], {
    providerInfo: provider => ({ id: provider, name: '研判摘要（本地固定输出）' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async () => [],
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    async prepareCall(provider, model, signal) {
      return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }
    },
    async *stream(request) {
      const text = pending.get(request.sessionId)
      if (typeof text !== 'string') throw new Error('missing threat-analysis delivery')
      pending.delete(request.sessionId)
      request.signal?.throwIfAborted()
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  ctx.on('agent/disposed', ({ agent }) => pending.delete(agent.id))
  ctx.tools.register({
    name: 'analyze_threat_incident',
    description: '输入 SOC 事件 ID，执行真实 MCP 取证、名单快速分类或五源融合及固定提示词模型研判，并返回输出契约状态。调用可能需要数分钟。',
    parameters: {
      type: 'object',
      properties: { incident_id: { type: 'string', description: 'SOC 威胁事件 ID，格式 INC-YYYYMMDD-NNNNNN。' } },
      required: ['incident_id'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: `研判执行状态：${value.status}\n运行 ID：${value.run_id}\n摘要或失败说明将在下方正式回复中展示。` }],
      presentationMeta: (_args, value) => ({ threat_analysis: value }),
    },
    timeoutMs: 900000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!/^INC-\d{8}-\d{6}$/.test(args.incident_id)) throw new Error('invalid incident ID')
      const events = exec.agent?.session.snapshotEvents() ?? []
      const route = events.findLast(event => event.type === 'request/header'
        && event.data.header.config.provider !== deliveryProvider)?.data.header.config ?? exec.agent?.options
      if (!route?.provider || !route?.model) throw new Error('missing DSH model route')
      const bridge = await modelBridge(ctx, route, exec.signal)
      try {
        const { stdout } = await executeFile('python3', [runner, args.incident_id], {
          signal: exec.signal, timeout: 900000, maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
            THREAT_MODEL_BRIDGE_KEY: bridge.key,
            THREAT_ANALYSIS_CONFIG: JSON.stringify({ ...config, analysisModel: {
              baseURL: bridge.url, model: route.model, apiKeyEnv: 'THREAT_MODEL_BRIDGE_KEY',
            } }) },
        })
        return JSON.parse(stdout)
      } finally {
        bridge.close()
      }
    },
  })
}

// 从已持久化的专用工具结果交付；不依赖进程内父子映射，刷新和恢复仍可核对。
export function deliveryMarkdown(events, turn) {
  const last = events.findLast(event => ['tool/result', 'assistant/message', 'user/message'].includes(event.type))
  if (last?.type !== 'tool/result' || last.data.turn !== turn) return undefined
  const direct = last.data.meta?.threat_analysis?.delivery?.markdown
  if (typeof direct === 'string') return direct
  const block = last.data.message
  if (block?.role !== 'tool' || block.isError) return undefined
  const call = events.findLast(event => event.type === 'tool/call' && event.data.callId === block.toolCallId)
  if (call?.data.name !== 'delegate_threat_analysis') return undefined
  if (!block.content?.every(item => item.type === 'text')) return undefined
  return block.content.map(item => item.text).join('') || undefined
}

export async function inferFrozen(ctx, route, payload, signal) {
  if (payload.messages?.length !== 2 || payload.messages[0].role !== 'system' || payload.messages[1].role !== 'user') {
    throw new Error('invalid frozen model input')
  }
  const prepared = await ctx.llm.prepareCall({
    provider: route.provider, model: route.model,
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
    temperature: payload.temperature,
  }, signal)
  let content = ''
  let finished = false
  for await (const chunk of prepared.stream({
    ...prepared.config, signal,
    system: payload.messages[0].content,
    messages: [{ role: 'user', content: [{ type: 'text', text: payload.messages[1].content }] }],
  })) {
    if (chunk.type === 'text-delta') content += chunk.text
    if (chunk.type === 'finish') {
      if (chunk.reason.kind !== 'stop') throw new Error('incomplete threat-analysis model response')
      finished = true
    }
  }
  if (!finished || !content.trim()) throw new Error('empty threat-analysis model response')
  return { model: prepared.config.model, choices: [{ message: { content } }] }
}

// 每次工具调用拥有独立的回环桥接。Python 只看冻结输入，连接及密钥由 DSH 适配器管理。
export async function modelBridge(ctx, route, signal) {
  const key = randomUUID()
  const controller = new AbortController()
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/chat/completions' || request.headers.authorization !== `Bearer ${key}`) {
      response.writeHead(403).end(); return
    }
    try {
      const chunks = []
      let bytes = 0
      for await (const chunk of request) {
        bytes += chunk.length
        if (bytes > 16 * 1024 * 1024) throw new Error('frozen input exceeds bridge limit')
        chunks.push(chunk)
      }
      const combined = AbortSignal.any([controller.signal, AbortSignal.timeout(300000), ...(signal ? [signal] : [])])
      const value = await inferFrozen(ctx, route, JSON.parse(Buffer.concat(chunks).toString('utf8')), combined)
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'DSH model inference failed' }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { key, url: `http://127.0.0.1:${server.address().port}`,
    close() { controller.abort(); server.closeAllConnections(); server.close() } }
}
