// Generated from inspection-code-variant.ts; edit the TypeScript source.
import { createHash, randomUUID } from 'node:crypto'

export const name = 'inspection-code-variant'
export const inject = ['llm']

const provider = 'inspection-code'
const toolNames = {
  list: 'mcp__inspection__list_executable_inspections',
  start: 'mcp__inspection__start_inspection',
  get: 'mcp__inspection__get_inspection_result',
}





export function classify(text        )                     {
  if (!text.includes('巡检')) return undefined
  if (/(创建|新建)/.test(text)) return { kind: /(每\s*\d+|定时|周期)/.test(text) ? 'schedule' : 'create', text }
  if (/(继续|查询).*(刚才|上次).*(巡检|结果)/.test(text)) return { kind: 'resume', text }
  if (/(列出|查看|查询).*(可用|巡检项|巡检任务|巡检模板)/.test(text)) return { kind: 'list', text }
  if (!/(执行|发起|做一次).*巡检/.test(text)) return undefined
  const ids = [...text.matchAll(/\bA-\d+\b/g)].map(match => match[0])
  if (ids.length > 1) return undefined
  return { kind: 'start', text, ...(ids.length ? { assetId: ids[0] } : {}) }
}

function currentUser(events         , turn        )                     {
  const start = events.findLastIndex(event => event.type === 'turn/start' && event.data.turn === turn)
  const message = events.slice(start + 1).find(event => event.type === 'user/message' && event.data.source?.kind === 'user')?.data
  return message?.content?.filter((item     ) => item.type === 'text').map((item     ) => item.text).join('')
}

function callResult(events         , turn        , name        )                                                   {
  const call = events.find(event => event.type === 'tool/call' && event.data.turn === turn && event.data.name === name)
  if (!call) return { called: false }
  const result = events.find(event => event.type === 'tool/result' && event.data.message?.toolCallId === call.data.callId)
  if (!result) return { called: true, error: '工具调用回执未确认；为避免重复操作，已停止自动重试。' }
  const message = result.data.message
  if (message.isError) return { called: true, error: '巡检工具返回错误；本轮未取得可信结果。' }
  try {
    const text = message.content.filter((item     ) => item.type === 'text').map((item     ) => item.text).join('')
    return { called: true, value: JSON.parse(text) }
  } catch {
    return { called: true, error: '巡检工具回执不是有效 JSON；本轮未取得可信结果。' }
  }
}

function pickTask(catalog     , intent        )                  {
  if (!Array.isArray(catalog)) return undefined
  const tasks = catalog.filter(item => item && typeof item.taskId === 'string' && typeof item.definitionVersion === 'string')
  const named = tasks.filter(item => (typeof item.name === 'string' && intent.text.includes(item.name))
    || (Array.isArray(item.matchPhrases) && item.matchPhrases.some((phrase        ) => intent.text.includes(phrase))))
  const selected = named.length ? named : /常规巡检|匹配的巡检/.test(intent.text) ? tasks.filter(item => item.defaultForChat === true) : []
  return selected.length === 1 && !selected[0].runtimeInputSchema?.required?.length ? selected[0] : undefined
}

function resultText(value     )         {
  if (!value || typeof value.runId !== 'string') return '巡检结果缺少运行标识，无法确认本轮状态。'
  const lines = [`巡检运行标识：${value.runId}`, `状态：${value.status ?? '未知'}`]
  if (value.status === 'RUNNING' || value.status === 'PENDING') return [...lines, '巡检仍在运行，报告尚未就绪；请稍后继续查询。'].join('\n')
  if (value.conclusionStatus) lines.push(`结论：${value.conclusionStatus}`)
  const summary = value.businessSummary
  const count = summary?.devices?.observedCount
  lines.push(Number.isSafeInteger(count) ? `已观察设备数量：${count}` : '设备数量：服务未提供，无法核实。')
  if (Array.isArray(summary?.items)) {
    for (const item of summary.items) {
      if (!item?.name) continue
      lines.push(`- ${item.name}：${item.conclusion ?? '未给出结论'}`)
      if (Array.isArray(item.reasons)) lines.push(...item.reasons.map((reason        ) => `  证据：${reason}`))
      if (Array.isArray(item.recommendations)) lines.push(...item.recommendations.map((recommendation        ) => `  建议：${recommendation}`))
    }
  }
  if (value.status === 'PARTIAL' || value.resultStatus === 'PARTIAL') lines.push('结果为 PARTIAL，仍有证据缺口，不能视为全部正常。')
  if (typeof value.errorMessage === 'string' && value.errorMessage) lines.push(`失败说明：${value.errorMessage}`)
  if (typeof value.reportMarkdown === 'string' && value.reportMarkdown) {
    const excerpt = value.reportMarkdown.slice(0, 6000)
    lines.push(`报告内容${excerpt.length < value.reportMarkdown.length ? '（前 6000 字；完整内容请查看服务报告）' : ''}：\n${excerpt}`)
  }
  if (['COMPLETED', 'PARTIAL'].includes(value.status) && typeof value.reportMarkdown === 'string'
    && value.reportMarkdown && /^https?:\/\//.test(value.reportDownloadUrl ?? '')) {
    lines.push(`报告地址：${value.reportDownloadUrl}`)
  } else {
    lines.push('报告尚未就绪，暂无可确认的下载地址。')
  }
  return lines.join('\n')
}

export function decide(intent        , events         , turn        , sessionId        )         {
  if (intent.kind === 'create') return { kind: 'text', text: '当前巡检工具只能列出可执行模板、发起一次巡检和查询结果，不能创建任务。您是想执行已有任务，还是另行配置新任务？' }
  if (intent.kind === 'schedule') return { kind: 'text', text: '当前巡检工具没有周期任务创建接口，无法创建定时巡检任务；尚未创建任务。' }
  if (intent.kind === 'resume') {
    const prior = events.filter(event => event.type === 'tool/result' && event.data.turn < turn).reverse()
      .find(event => events.some(call => call.type === 'tool/call' && call.data.name === toolNames.start && call.data.callId === event.data.message?.toolCallId))
    if (!prior) return { kind: 'text', text: '当前会话没有可确认的上次巡检运行标识。' }
    let runId
    try {
      runId = JSON.parse(prior.data.message.content[0].text).runId
    } catch {
      return { kind: 'text', text: '上次巡检回执无法解析，不能猜测运行标识。' }
    }
    if (typeof runId !== 'string' || !runId) return { kind: 'text', text: '上次巡检没有返回有效运行标识。' }
    return nextResult(events, turn, runId)
  }
  const listed = callResult(events, turn, toolNames.list)
  if (!listed.called) return { kind: 'tool', name: toolNames.list, arguments: {} }
  if (listed.error) return { kind: 'text', text: listed.error }
  if (!Array.isArray(listed.value) || listed.value.length === 0) return { kind: 'text', text: '本轮未查到可执行巡检模板，未发起巡检。' }
  if (intent.kind === 'list') {
    return { kind: 'text', text: '当前可执行巡检模板及巡检项：\n' + listed.value.map((item     ) => `- ${item.name}：${(item.inspectionItems ?? []).join('、')}`).join('\n') }
  }
  const task = pickTask(listed.value, intent)
  if (!task) return { kind: 'text', text: '目录中没有唯一匹配的可执行巡检任务，请指定任务名称；未发起巡检。' }
  const started = callResult(events, turn, toolNames.start)
  if (!started.called) {
    const requestId = createHash('sha256').update(`${sessionId}:${turn}`).digest('hex').slice(0, 24)
    return { kind: 'tool', name: toolNames.start, arguments: {
      taskId: task.taskId, definitionVersion: task.definitionVersion, requestId: `inspection-${requestId}`,
      ...(intent.assetId ? { scope: { type: 'ASSET_IDS', assetIds: [intent.assetId] } } : {}),
    } }
  }
  if (started.error) return { kind: 'text', text: started.error }
  const runId = started.value?.runId
  if (typeof runId !== 'string' || !runId) return { kind: 'text', text: '发起回执没有有效运行标识，不能查询或重复发起。' }
  return nextResult(events, turn, runId)
}

function nextResult(events         , turn        , runId        )         {
  const found = callResult(events, turn, toolNames.get)
  if (!found.called) return { kind: 'tool', name: toolNames.get, arguments: { runId } }
  if (!found.error && found.value?.runId !== runId) return { kind: 'text', text: '查询回执的运行标识与本轮巡检不一致，不能交付该结果。' }
  return { kind: 'text', text: found.error ?? resultText(found.value) }
}

export function apply(ctx     ) {
  const intents = new Map                ()
  const actions = new Map                ()
  ctx.on('agent/pre-step', ({ agent, messages, step }     , next     ) => {
    if (step === 1 && (agent.session.header?.delegationDepth ?? 0) === 0) {
      const user = messages.filter((message     ) => message.source?.kind === 'user').at(-1)
      const text = user?.content?.filter((item     ) => item.type === 'text').map((item     ) => item.text).join('') ?? ''
      const intent = classify(text)
      if (intent) intents.set(agent.id, intent)
      else intents.delete(agent.id)
    }
    return next()
  })
  ctx.on('agent/request', async ({ agent, turn }     , next     ) => {
    const config = await next()
    const events = agent.session.snapshotEvents()
    const intent = intents.get(agent.id) ?? classify(currentUser(events, turn) ?? '')
    if (intent && (agent.session.header?.delegationDepth ?? 0) === 0) {
      actions.set(agent.id, decide(intent, events, turn, agent.session.id))
      return { provider, model: 'deterministic-inspection' }
    }
    actions.delete(agent.id)
    if (config.provider !== provider) return config
    const original = agent.options?.provider && agent.options.provider !== provider && agent.options?.model
      ? { provider: agent.options.provider, model: agent.options.model,
        ...(agent.options.reasoningEffort === undefined ? {} : { reasoningEffort: agent.options.reasoningEffort }),
        ...(agent.options.maxTokens === undefined ? {} : { maxTokens: agent.options.maxTokens }) }
      : events.findLast((event       ) => event.type === 'request/header' && event.data.header.config.provider !== provider)?.data.header.config
    if (!original) throw new Error('missing original inspection model route')
    return original
  })
  ctx.llm.registerAdapter([provider], {
    providerInfo: (id        ) => ({ id, name: '巡检代码路径' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async () => [],
    resolveModel: async (id        , model        ) => ({ provider: id, id: model, name: model }),
    async prepareCall(id        , model        , signal             ) {
      return { model: await this.resolveModel(id, model, signal), stream: (request     ) => this.stream(request) }
    },
    async *stream(request     ) {
      const action = actions.get(request.sessionId)
      if (!action) throw new Error('missing inspection action')
      actions.delete(request.sessionId)
      request.signal?.throwIfAborted()
      if (action.kind === 'text') {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: action.text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: action.text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } else {
        const id = `call_${randomUUID()}`
        const args = JSON.stringify(action.arguments)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: action.name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: action.name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      }
    },
  })
  ctx.on('agent/disposed', ({ agent }     ) => { intents.delete(agent.id); actions.delete(agent.id) })
}
