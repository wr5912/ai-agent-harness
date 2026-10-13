import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export const name = 'threat-analysis'
export const inject = ['tools', 'llm']
export const TOOL_ROUTES = { tools: ['analyze_threat_incident', 'analyze_pending_threat_incidents'] }
const executeFile = promisify(execFile)
const runner = fileURLToPath(new URL('./threat-analysis/dsh_runner.py', import.meta.url))
const automationProvider = 'threat-analysis-automation'
const automationTool = 'analyze_pending_threat_incidents'
const continuousBatchSize = 1
const manualToolTimeoutMs = 36 * 60 * 1000
const automationToolTimeoutMs = 45 * 60 * 1000
const heartbeatSeconds = 120
const pendingTimeoutMs = 2 * 60 * 1000

export function apply(ctx, config = {}) {
  // 让 Runtime 正常持久化助手回复；此专用路由只回放固定摘要，不访问模型服务。
  const deliveryProvider = 'threat-analysis-delivery'
  const pending = new Map()
  const automation = new Map()
  let activeAutomation
  let lastAutomationFinishedAt = 0
  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const config = await next()
    const events = agent.session.snapshotEvents()
    const markdown = deliveryMarkdown(events, turn)
    if (typeof markdown === 'string') {
      pending.set(agent.id, markdown)
      return { provider: deliveryProvider, model: 'fixed-summary' }
    }
    pending.delete(agent.id)
    const batch = scheduledBatch(events)
    if (batch !== undefined) {
      automation.set(agent.id, batch)
      return { provider: automationProvider, model: 'scheduled-batch' }
    }
    automation.delete(agent.id)
    // 后续用户消息继续使用原模型，不能继承上一轮的本地交付路由。
    if ([deliveryProvider, automationProvider].includes(config.provider)) {
      const original = events.findLast(event => event.type === 'request/header'
        && ![deliveryProvider, automationProvider].includes(event.data.header.config.provider))?.data.header.config
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
  ctx.llm.registerAdapter([automationProvider], {
    providerInfo: provider => ({ id: provider, name: '威胁自动研判（本地固定调用）' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async () => [],
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    async prepareCall(provider, model) {
      return { model: await this.resolveModel(provider, model), stream: request => this.stream(request) }
    },
    async *stream(request) {
      const batch = automation.get(request.sessionId)
      if (batch === undefined) throw new Error('missing scheduled threat-analysis batch')
      automation.delete(request.sessionId)
      const id = `scheduled-threat-${randomUUID()}`
      const args = JSON.stringify({ batch_size: batch.batchSize })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: automationTool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: automationTool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    },
  })
  ctx.on('agent/disposed', ({ agent }) => { pending.delete(agent.id); automation.delete(agent.id) })
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
    timeoutMs: manualToolTimeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!/^INC-\d{8}-\d{6}$/.test(args.incident_id)) throw new Error('invalid incident ID')
      return runIncident(ctx, config, exec, args.incident_id, deliveryProvider)
    },
  })
  ctx.tools.register({
    name: automationTool,
    description: '仅由受信 Schedule 桥触发：每次只处理一个待研判事件。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { batch_size: { type: 'integer', const: continuousBatchSize } },
      required: ['batch_size'],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: batchMarkdown(value) }],
      presentationMeta: (_args, value) => ({ threat_analysis_batch: value }),
    },
    timeoutMs: automationToolTimeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (args.batch_size !== continuousBatchSize) throw new Error('invalid batch size')
      const events = exec.agent?.session.snapshotEvents() ?? []
      const expected = scheduledBatch(events)
      if (expected?.batchSize !== args.batch_size) throw new Error('trusted Schedule trigger required')
      const occurrenceAt = scheduledOccurrenceAt(events)
      const occurrenceTime = occurrenceAt === undefined ? undefined : Date.parse(occurrenceAt)
      if (Number.isFinite(occurrenceTime)
        && occurrenceTime <= Math.max(lastAutomationFinishedAt, Date.now() - heartbeatSeconds * 2 * 1000)) {
        return batchResult('skipped_stale', args.batch_size, 'stale')
      }
      if (activeAutomation) {
        return { ...batchResult('skipped_busy', args.batch_size, 'busy'),
          ...(activeAutomation.incidentId ? { active_incident_id: activeAutomation.incidentId } : {}) }
      }
      activeAutomation = {}
      try {
        let incidentIds
        try {
          incidentIds = pendingIncidentIds(await fetchPending(config, exec.signal))
        } catch (error) {
          return { ...batchResult('failed', args.batch_size, 'pending_fetch_failed'), failed: 1,
            error_type: error?.constructor?.name ?? 'Error' }
        }
        const results = []
        let attempted = 0
        let stoppedReason = incidentIds.length === 0 ? 'empty' : 'drained'
        for (const incidentId of incidentIds) {
          exec.signal.throwIfAborted()
          if (attempted >= args.batch_size) { stoppedReason = 'max_events'; break }
          try {
            activeAutomation.incidentId = incidentId
            const result = await runIncident(ctx, config, exec, incidentId, deliveryProvider)
            if (result.status === 'claim_failed' && Number(result.error_code) === 409) {
              results.push({ incident_id: incidentId, status: 'skipped_locked', run_id: result.run_id })
              continue
            }
            attempted += 1
            results.push({ incident_id: incidentId, status: result.status, run_id: result.run_id })
          } catch (error) {
            attempted += 1
            results.push({ incident_id: incidentId, status: 'execution_failed',
              error_type: error?.constructor?.name ?? 'Error' })
          }
        }
        const completed = results.filter(item => item.status === 'completed').length
        const skippedLocked = results.filter(item => item.status === 'skipped_locked').length
        return { schema_version: '1.1', status: 'completed', requested: args.batch_size,
          found: incidentIds.length, attempted, completed, skipped_locked: skippedLocked,
          failed: attempted - completed, stopped_reason: stoppedReason, results }
      } finally {
        activeAutomation = undefined
        lastAutomationFinishedAt = Date.now()
      }
    },
  })
}

function originalRoute(exec, deliveryProvider) {
  const events = exec.agent?.session.snapshotEvents() ?? []
  const route = events.findLast(event => event.type === 'request/header'
    && ![deliveryProvider, automationProvider].includes(event.data.header.config.provider))?.data.header.config ?? exec.agent?.options
  if (!route?.provider || !route?.model) throw new Error('missing DSH model route')
  return route
}

async function runIncident(ctx, config, exec, incidentId, deliveryProvider) {
  const route = originalRoute(exec, deliveryProvider)
  const bridge = await modelBridge(ctx, route, exec.signal)
  try {
    const { stdout } = await executeFile('python3', [runner, incidentId], {
      signal: exec.signal, maxBuffer: 2 * 1024 * 1024,
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
}

async function fetchPending(config, signal) {
  const { stdout } = await executeFile('python3', [runner, '--pending'], {
    signal, timeout: pendingTimeoutMs, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
      THREAT_ANALYSIS_CONFIG: JSON.stringify(config) },
  })
  return JSON.parse(stdout)
}

function batchResult(status, requested, stoppedReason) {
  return { schema_version: '1.1', status, requested, found: 0, attempted: 0,
    completed: 0, skipped_locked: 0, failed: 0, stopped_reason: stoppedReason, results: [] }
}

export function scheduledBatch(events) {
  const event = events.findLast(item => item.type === 'user/message' && item.data?.source?.kind === 'schedule')
  if (!event || events.findLast(item => item.type === 'user/message') !== event) return undefined
  const text = event.data.content?.filter(item => item.type === 'text').map(item => item.text).join('')
  const lines = text?.split('\n') ?? []
  const single = lines.find(item => item.startsWith('reminder_prompt_json: '))
  const recurring = lines.find(item => item.startsWith('reminders_json: '))
  try {
    let prompt
    if (single) prompt = JSON.parse(single.slice('reminder_prompt_json: '.length))
    else if (recurring) {
      const reminders = JSON.parse(recurring.slice('reminders_json: '.length))
      if (!Array.isArray(reminders) || reminders.length === 0) return undefined
      const matches = reminders.filter(item => isExactAutomationPrompt(item?.reminder_prompt))
      // 不劫持混合批次；其他提醒仍交给原模型处理。
      if (matches.length !== reminders.length) return undefined
      prompt = matches.at(-1).reminder_prompt
    } else return undefined
    return automationPayload(prompt)
  } catch { return undefined }
}

function automationPayload(prompt) {
  const value = JSON.parse(prompt)
  if (value?.type !== 'threat-analysis.pending' || value.version !== 1
    || value.batchSize !== continuousBatchSize
    || Object.keys(value).sort().join(',') !== 'batchSize,type,version') return undefined
  return value
}

function isExactAutomationPrompt(prompt) {
  try { return automationPayload(prompt) !== undefined } catch { return false }
}

export function scheduledOccurrenceAt(events) {
  const event = events.findLast(item => item.type === 'user/message' && item.data?.source?.kind === 'schedule')
  if (!event || events.findLast(item => item.type === 'user/message') !== event) return undefined
  const text = event.data.content?.filter(item => item.type === 'text').map(item => item.text).join('')
  const recurring = text?.split('\n').find(item => item.startsWith('reminders_json: '))
  if (!recurring) return undefined
  try {
    const reminders = JSON.parse(recurring.slice('reminders_json: '.length))
    if (!Array.isArray(reminders) || reminders.length === 0) return undefined
    if (reminders.some(item => !isExactAutomationPrompt(item?.reminder_prompt))) return undefined
    const occurrences = reminders.map(item => item?.occurrence_at)
      .filter(item => typeof item === 'string' && Number.isFinite(Date.parse(item)))
    return occurrences.sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1)
  } catch { return undefined }
}

export function pendingIncidentIds(value) {
  const candidates = [value?.data?.rows, value?.data?.records, value?.data?.items, value?.data?.list, value?.data,
    value?.records, value?.items, value?.list, value]
  const rows = candidates.find(Array.isArray)
  if (rows === undefined) throw new Error('invalid pending incident response')
  return [...new Set(rows.map(row => row?.incidentId ?? row?.incident_id ?? row?.id)
    .filter(id => typeof id === 'string' && /^INC-\d{8}-\d{6}$/.test(id)))]
}

function batchMarkdown(value) {
  if (value.status === 'skipped_stale') return '自动威胁研判旧心跳已跳过：上一条研判期间累计的投递不会补跑。'
  if (value.status === 'skipped_busy') return `自动威胁研判心跳已跳过：${value.active_incident_id
    ? `事件 ${value.active_incident_id} 仍在研判中` : '上一轮仍在读取待研判事件'}，没有新增排队任务。`
  if (value.status === 'failed') return `自动威胁研判未开始：待研判事件读取失败（${value.error_type}）。`
  const details = value.results.map(item => `- ${item.incident_id}：${item.status}${item.run_id ? `（${item.run_id}）` : ''}`)
  return [`自动威胁研判批次完成：发现 ${value.found} 条，尝试 ${value.attempted} 条，完成 ${value.completed} 条，锁定跳过 ${value.skipped_locked} 条，未完成 ${value.failed} 条。`, ...details].join('\n')
}

// 从已持久化的专用工具结果交付；不依赖进程内父子映射，刷新和恢复仍可核对。
export function deliveryMarkdown(events, turn) {
  const last = events.findLast(event => ['tool/result', 'assistant/message', 'user/message'].includes(event.type))
  if (last?.type !== 'tool/result' || last.data.turn !== turn) return undefined
  const direct = last.data.meta?.threat_analysis?.delivery?.markdown
  if (typeof direct === 'string') return direct
  const batch = last.data.meta?.threat_analysis_batch
  if (batch !== undefined) return batchMarkdown(batch)
  const block = last.data.message
  if (block?.role !== 'tool') return undefined
  const call = events.findLast(event => event.type === 'tool/call' && event.data.callId === block.toolCallId)
  if (call?.data.name === automationTool && block.isError) {
    return '自动威胁研判本次心跳执行失败，没有重试同一投递；请核对运行日志并等待下一次新鲜心跳。'
  }
  if (block.isError) return undefined
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
