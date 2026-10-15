import { createHash, randomUUID } from 'node:crypto'
import { continueWithModel, queueControlledOutput, queuePostDeliveryInteraction } from './operation-result-delivery.mjs'
import { actionConstraintFromText, cancelPolicyBinding, policyCommandKind, setPolicyAction, setPolicySelectedDevice } from './policy-configuration-guard.mjs'

export const name = 'policy-selection-runtime'
export const inject = ['userQuestions']
const RESOLVE = 'mcp__policy-configuration__resolve_policy_endpoints'
const CHOOSE = 'mcp__policy-configuration__choose_ambiguous_policy_endpoints'
const STATUS = 'mcp__policy-configuration__get_policy_configuration_status'
const PREPARE = 'mcp__policy-configuration__prepare_policy_configuration'
const CANCEL = '取消本次配置'
const pending = new WeakMap<object, object>()
const policyTurns = new Map<string, { announced: boolean; query: boolean; transition: string }>()
export function isPolicyStatusQuery(agentId: string): boolean { return policyTurns.get(agentId)?.query === true }
const TRANSITION = '已进入策略配置流程，正在识别源、目的资产并核对五元组……'

type Candidate = { candidate_id: string; label?: string; name?: string; ip?: string; device_id?: string; device_query?: string; online_status?: string; status?: string; selectable?: boolean; reason_codes?: string[] }
type Question = { id: string; header: string; question: string; options: { label: string; description: string }[]; multiSelect: false }

function projection(result: any): any {
  if (!result || result.isError) return null
  let value = result.value
  if (String(value?.code) !== '200' || !value?.data) {
    const blocks = result.content?.flatMap((block: any) => block.type === 'tool-result' ? block.content ?? [] : [block]) ?? []
    try { value = JSON.parse(blocks.find((block: any) => block.type === 'text')?.text) } catch { return null }
  }
  return String(value?.code) === '200' && value.data && typeof value.data === 'object' ? value.data : null
}

const candidateLabel = (candidate: Candidate, index: number) => `${index + 1}. ${candidate.label ?? (candidate.name && candidate.ip ? `${candidate.name}（${candidate.ip}）` : candidate.name ?? candidate.ip ?? candidate.device_id ?? candidate.candidate_id)}`

/** 问题 ID 同时绑定会话、冻结请求、摘要和对象端，旧面板答案不能换到新任务。 */
export function nativeCandidateQuestion(binding: string, side: string, candidates: Candidate[], replacement = false): Question {
  if (!binding || !['source', 'destination', 'firewall', 'action'].includes(side) || !candidates.length ||
      candidates.some(candidate => typeof candidate.candidate_id !== 'string' || !candidate.candidate_id) ||
      new Set(candidates.map(candidate => candidate.candidate_id)).size !== candidates.length) throw new Error('invalid frozen policy candidates')
  const digest = createHash('sha256').update(`${binding}\n${side}\n${JSON.stringify(candidates)}`).digest('hex').slice(0, 24)
  const label = { source: '源设备', destination: '目的设备', firewall: '执行防火墙', action: '策略动作' }[side]
  return {
    id: `policy-choice-${side}-${digest}`, header: label,
    question: side === 'action' ? '本次新增策略要允许访问还是阻断访问？' : replacement ? '原指定防火墙不可用，请明确选择替代防火墙。' : `请选择本次策略的${label}。`,
    options: [...candidates.map((candidate, index) => ({
      label: candidateLabel(candidate, index),
      description: side === 'action' ? '只确定本次新增策略动作，后续核验和草稿确认后才能执行。' : side === 'firewall' ? '仅选择本次配置设备，后续重新核验；不提交或执行策略。' : '只确认本次端点，后续继续核验；不提交或执行策略。',
    })), { label: CANCEL, description: '停止本次选择，本次不准备或执行策略。' }],
    multiSelect: false,
  }
}

export function nativeCandidateDecision(answer: any, question: Question, candidates: Candidate[]): any {
  const item = answer?.answers?.find((value: any) => value?.id === question.id)
  const custom = typeof item?.custom === 'string' ? item.custom.trim() : ''
  // 文字兼容只接受当前冻结集的确切编号、IP、标签或 ID，任意补充不得当作选择。
  if (custom) {
    const matches = candidates.filter((candidate, index) => [String(index + 1), candidate.ip, candidate.label, candidate.candidate_id, candidateLabel(candidate, index)].includes(custom))
    return matches.length === 1 ? { kind: 'select', candidate: matches[0] } : { kind: 'custom', text: custom }
  }
  if (!Array.isArray(item?.selected) || item.selected.length !== 1) return { kind: 'skip' }
  if (item.selected[0] === CANCEL) return { kind: 'cancel' }
  const index = candidates.findIndex((candidate, index) => candidateLabel(candidate, index) === item.selected[0])
  return index >= 0 ? { kind: 'select', candidate: candidates[index] } : { kind: 'skip' }
}

async function ask(ctx: any, exec: any, binding: string, side: string, candidates: Candidate[], replacement = false): Promise<any> {
  const question = nativeCandidateQuestion(binding, side, candidates, replacement)
  try {
    const answer = await ctx.userQuestions.ask({ questions: [question], agent: exec.agent, signal: exec.signal })
    return nativeCandidateDecision(answer, question, candidates)
  } catch (error: any) {
    if (error?.code === 'ASK_ABORTED' || exec.signal?.aborted) return { kind: 'skip' }
    // 原生面不可用保留现有文字选择路线，不猜选设备。
    ctx.logger?.warn?.(`native policy choice unavailable: ${error?.message ?? String(error)}`)
    return { kind: 'unavailable' }
  }
}

async function post(path: string, body: any, signal: AbortSignal, purpose = '本次选择'): Promise<any> {
  signal?.throwIfAborted()
  const base = process.env.AI_PLATFORM_URL
  if (!base) throw new Error('策略实例地址未配置')
  const timeoutMs = /^\/api\/v1\/policy-configurations\/op_[0-9a-f]{32}\/candidate-selection$/.test(path) ? 90000 : 60000
  const response = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  })
  const value = await response.json().catch(() => null)
  if (!response.ok || String(value?.code) !== '200' || !value?.data) {
    const reason = typeof value?.msg === 'string' && /[\u3400-\u9fff]/.test(value.msg) ? value.msg.slice(0, 180) : ''
    throw new Error(`平台未接受${purpose}（接口状态：${response.status}）${reason ? `：${reason}` : ''}`)
  }
  return value.data
}

export async function currentPolicyStatus(operationId: string, signal: AbortSignal): Promise<any> {
  signal?.throwIfAborted()
  const base = process.env.AI_PLATFORM_URL
  if (!base) throw new Error('策略实例地址未配置')
  const response = await fetch(`${base.replace(/\/$/, '')}/api/v1/policy-configurations/${operationId}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
  })
  const value = await response.json().catch(() => null)
  if (!response.ok || String(value?.code) !== '200' || value.data?.operation_id !== operationId) throw new Error('尚未取得本次设备选择后的最新权威状态')
  return value.data
}

/** 只消费原生明确拒绝/修改；版本和摘要由当前权威投影提供，不开放模型决定工具。 */
export async function submitPolicyRejection(sessionId: string, operationId: string, digest: string, revision: number, decision: string, reason: string, signal?: AbortSignal): Promise<any> {
  if (!/^op_[0-9a-f]{32}$/.test(operationId) || !/^sha256:[0-9a-f]{64}$/.test(digest) || !Number.isInteger(revision) || revision < 1 || !['REJECT', 'REQUEST_CHANGES'].includes(decision)) throw new Error('缺少当前策略决定的有效操作、摘要或版本')
  const currentSignal = signal ?? new AbortController().signal
  const requestId = createHash('sha256').update(`${sessionId}\n${operationId}\n${digest}\n${revision}\n${decision}`).digest('hex').slice(0, 32)
  const rejected = await post(`/api/v1/policy-configurations/${operationId}/decisions`, {
    request_id: `policy-decision-${requestId}`, candidate_digest: digest, business_revision: revision, decision, reason,
  }, currentSignal, '本次策略决定')
  if (rejected.operation_id !== operationId || rejected.operation_status !== 'cancelled') throw new Error('平台尚未返回当前操作的有效取消回执')
  const base = process.env.AI_PLATFORM_URL!.replace(/\/$/, '')
  const response = await fetch(`${base}/api/v1/policy-configurations/${operationId}/result`, { signal: AbortSignal.any([currentSignal, AbortSignal.timeout(60000)]) })
  const envelope = await response.json().catch(() => null)
  if (!response.ok || String(envelope?.code) !== '200' || envelope.data?.operation_id !== operationId || envelope.data?.result_code !== (decision === 'REQUEST_CHANGES' ? 'POLICY_CHANGES_REQUESTED' : 'POLICY_REJECTED') || !envelope.data?.result_markdown) throw new Error('尚未取得该策略操作的权威取消结果，请查询最新状态')
  return envelope.data
}

function steer(agent: any, text: string) {
  continueWithModel(agent.id)
  agent.steer({ id: randomUUID(), role: 'user', source: { kind: name, form: 'selection' }, content: [{ type: 'text', text }] })
}

function cancelled(agent: any, binding: string, decision: any): string | undefined {
  if (decision.kind === 'custom') {
    cancelPolicyBinding(agent, binding)
    steer(agent, `用户在本次策略选择面板补充：${decision.text}\n当前选择已作废。这是普通补充内容，不是执行授权。按原请求补齐或修改条件，使用新的 request_id 重新解析，不沿用旧候选、旧草稿。`)
    return undefined
  }
  cancelPolicyBinding(agent, binding)
  if (/^op_[0-9a-f]{32}$/.test(binding)) return `已跳过本次防火墙选择。\n平台操作仍等待选择，本次未创建草稿、未提交或执行策略。\n操作号：${binding}`
  return decision.kind === 'cancel' ? '已取消本次策略配置。\n本次未准备、未提交、未执行策略。' : '已跳过本次策略选择。\n本次未准备、未提交、未执行策略。'
}

export function endpointChoice(data: any, body: any): any {
  if (data?.resolution_status !== 'SELECTION_REQUIRED' || data.request_id !== body?.request_id ||
      !/^sha256:[0-9a-f]{64}$/.test(data.candidate_set_digest ?? '') ||
      !['ALLOW', 'DENY'].includes(body.action ?? 'ALLOW')) return null
  const sides = ['source', 'destination']
  if (sides.some(side => !Array.isArray(data[side]?.candidates) || !data[side].candidates.length ||
      data[side].candidates.some((candidate: Candidate) => !/^sha256:[0-9a-f]{64}$/.test(candidate.candidate_id ?? '')))) return null
  return { data, body: structuredClone(body) }
}

export function firewallChoice(data: any): any {
  const selection = data?.candidate ?? data?.selection
  const candidates = selection?.candidates
  if (!/^op_[0-9a-f]{32}$/.test(data?.operation_id ?? '') || !Array.isArray(candidates) || !candidates.length ||
      !/^sha256:[0-9a-f]{64}$/.test(selection?.candidate_set_digest ?? '') ||
      candidates.some((candidate: Candidate) => !candidate.candidate_id) ||
      !(candidates.length > 1 || selection.replacement_required === true) ||
      !['awaiting_candidate_selection', 'selecting_candidate'].includes(data?.stage_code)) return null
  return { operationId: data.operation_id, selection, candidates }
}

/** 只处理明确策略轮的工具响应，模型无工具回答和必要澄清保持原样。 */
export async function* controlledPolicyStream(stream: AsyncIterable<any>, transition?: string, onTransition?: () => void): AsyncIterable<any> {
  const chunks: any[] = []
  for await (const chunk of stream) chunks.push(chunk)
  const hasTools = chunks.some(chunk => chunk.type === 'tool-call-delta' || chunk.type === 'block-end' && chunk.block?.type === 'tool-call')
  const controlledTools = chunks.some(chunk => {
    if (chunk.type !== 'block-end' || chunk.block?.type !== 'tool-call') return false
    if (chunk.block.name?.startsWith('mcp__policy-configuration__')) return true
    if (chunk.block.name !== 'skill') return false
    try { return JSON.parse(chunk.block.arguments).name === 'policy-configuration' } catch { return false }
  })
  if (!hasTools || !controlledTools) { yield* chunks; return }
  const textIndexes = new Set(chunks.filter(chunk => chunk.type === 'text-delta' || chunk.type === 'block-start' && chunk.blockType === 'text' || chunk.type === 'block-end' && chunk.block?.type === 'text').map(chunk => chunk.index))
  if (transition) {
    const index = Math.max(-1, ...chunks.map(chunk => Number.isInteger(chunk.index) ? chunk.index : -1)) + 1
    yield { type: 'block-start', index, blockType: 'text' }
    yield { type: 'text-delta', index, text: transition }
    yield { type: 'block-end', index, block: { type: 'text', text: transition } }
    onTransition?.()
  }
  for (const chunk of chunks) {
    if (textIndexes.has(chunk.index)) continue
    // 过滤正文后不沿用供应方含原正文的回放元数据；toolcall参数和用量不变。
    if (chunk.type === 'finish' && (textIndexes.size || transition)) {
      const { replayState, ...rest } = chunk
      yield rest
    } else yield chunk
  }
}

export function publicSelectionError(error: any): string {
  if (error?.name === 'TimeoutError' || /timeout|timed?\s*out/i.test(error?.message ?? '')) return '候选选择服务等待超时，尚未取得有效回执。'
  if (error?.name === 'AbortError' || /abort/i.test(error?.message ?? '')) return '本次候选选择已中止，尚未取得有效回执。'
  if (typeof error?.message === 'string' && /[\u3400-\u9fff]/.test(error.message)) return error.message
  return '无法连接候选选择服务，尚未取得有效回执。'
}

export function apply(ctx: any) {
  ctx.on('agent/pre-step', async ({ agent, step, messages }: any, next: any) => {
    const decision = await next()
    if (decision.kind !== 'enter' || step !== 1 || (agent.session?.header?.delegationDepth ?? 0) !== 0) return decision
    const user = messages.filter((message: any) => message.source?.kind === 'user').at(-1)
    if (!user) return decision
    pending.delete(agent)
    const text = user.content?.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('') ?? ''
    const prior = policyTurns.has(agent.id) || (agent.session?.snapshotEvents?.().findLast((event: any) => event.type === 'tool/call')?.data?.name ?? '').startsWith('mcp__policy-configuration__')
    const command = policyCommandKind(text)
    const query = command === 'query' || prior && command === 'execute'
    const policy = /策略|开通|放通/.test(text) || /(?:阻断|禁止访问|放行|允许)/.test(text) && /到|至/.test(text) && /(?:TCP|UDP)\s*\d+/i.test(text) ||
      prior && query && /任务|操作|草稿|刚才|前一个|上一个/.test(text) && !/巡检|威胁|研判|应急|故障/.test(text)
    if (policy) policyTurns.set(agent.id, { announced: false, query, transition: query ? '正在查询策略任务的最新状态……' : TRANSITION })
    else policyTurns.delete(agent.id)
    if (policy && query) return { ...decision, messages: [...decision.messages, { id: randomUUID(), role: 'user', source: { kind: name, form: 'latest-state-query' }, content: [{ type: 'text', text: '本轮需要核验策略任务最新状态。必须实际调用 get_policy_configuration_status 查询本会话对应 operation_id；不要 prepare、重新选择设备或调用模型确认工具。操作不明确时先用中文澄清要查询哪一项，平台结果由固定中文交付。' }] }] }
    const effect = actionConstraintFromText(text)
    if (!/(?:新增|添加|配置|开通).*(?:策略|访问)/.test(text) || !/到|至|source_query/.test(text) || (effect && effect !== 'CONFLICT')) return decision
    const token = {}
    const binding = `policy-action-${randomUUID()}`
    pending.set(agent, token)
    const choices = [{ candidate_id: 'ALLOW', label: '允许访问' }, { candidate_id: 'DENY', label: '阻断访问' }]
    queueControlledOutput(agent.id, effect === 'CONFLICT' ? '当前请求同时明确允许和阻断，请先确定本次策略动作。' : '已记录源、目的和访问条件，请先确定本次新增策略的动作。')
    queuePostDeliveryInteraction(agent.id, async (signal: AbortSignal) => {
      const answer = await ask(ctx, { agent, signal }, `${agent.id}\n${binding}`, 'action', choices)
      if (pending.get(agent) !== token || signal?.aborted) return
      pending.delete(agent)
      if (answer.kind === 'select') {
        setPolicyAction(agent, answer.candidate.candidate_id)
        steer(agent, `原用户请求：${text}\n用户在原生面板明确选择本次新增策略动作 ${answer.candidate.candidate_id}（${answer.candidate.label}），以此选择替代原有冲突或缺失动作；沿用源、目的、协议、端口与指定设备，不是执行授权。加载策略Skill并用新request_id调用resolve_policy_endpoints，action必须为${answer.candidate.candidate_id}。`)
        return
      }
      if (answer.kind === 'unavailable') { steer(agent, '原生动作选择面暂不可用，请用文字追问允许还是阻断；未明确动作前不得调用策略准备工具。'); return }
      return cancelled(agent, binding, answer)
    })
    return decision
  })
  ctx.on('llm/stream', (request: any, next: any) => {
    const state = policyTurns.get(request.sessionId)
    if (!state || request.purpose || request.provider === 'security-operation-delivery') return next()
    return controlledPolicyStream(next(), state.announced ? undefined : state.transition, () => { state.announced = true })
  })
  ctx.on('agent/disposed', ({ agent }: any) => { policyTurns.delete(agent.id); pending.delete(agent) })
  ctx.on('tools/post-execute', async (exec: any, result: any, next: any) => {
    const downstream = await next()
    if (downstream.kind !== 'accept' || (exec.agent?.session?.header?.delegationDepth ?? 0) !== 0) return downstream
    const data = projection(result)
    const endpoints = [RESOLVE, CHOOSE].includes(exec.name) ? endpointChoice(data, exec.arguments?.body) : null
    const firewall = [STATUS, PREPARE].includes(exec.name) ? firewallChoice(data) : null
    if (!endpoints && !firewall || firewall && isPolicyStatusQuery(exec.agent.id)) return downstream
    const token = {}
    pending.set(exec.agent, token)
    const binding = endpoints ? endpoints.body.request_id : firewall.operationId
    const markdown = data.result_markdown ?? (endpoints ? '同名设备对应多个地址，请选择本次端点。' : [
      firewall.selection.replacement_required ? `原指定防火墙“${firewall.selection.original_device_query}”不可用，需要明确选择替代设备。` : '发现多台候选防火墙，请选择本次配置设备。',
      ...(firewall.selection.directory ?? []).map((item: any) => `- ${item.label ?? item.device_id ?? item.asset_id}：${item.selectable ? '可选择' : '不可选择'}；${item.online_status === 'online' ? '在线' : item.online_status === 'offline' ? '离线' : '在线状态待核实'}${item.reason ? `；${item.reason}` : ''}`),
    ].join('\n'))
    queueControlledOutput(exec.agent.id, markdown)
    queuePostDeliveryInteraction(exec.agent.id, async (signal: AbortSignal) => {
      const live = () => pending.get(exec.agent) === token && !signal?.aborted
      const active = { ...exec, signal }
      try {
        if (endpoints) {
          const chosen: Record<string, string> = {}
          for (const side of ['source', 'destination']) {
            const candidates = endpoints.data[side].candidates
            const selected = endpoints.data[side].selected_candidate_id
            if (selected && candidates.some((candidate: Candidate) => candidate.candidate_id === selected)) { chosen[side] = selected; continue }
            if (candidates.length === 1) { chosen[side] = candidates[0].candidate_id; continue }
            const decision = await ask(ctx, active, `${exec.agent.id}\n${binding}\n${data.candidate_set_digest}`, side, candidates)
            if (!live()) return '本次候选选择已失效，请按当前任务继续。'
            if (decision.kind === 'unavailable') { steer(exec.agent, '原生候选面暂不可用，请列出本次冻结候选并等待用户用编号或IP明确选择；不得自动选择、prepare或执行。'); return }
            if (decision.kind !== 'select') return cancelled(exec.agent, binding, decision)
            chosen[side] = decision.candidate.candidate_id
          }
          if (!live()) return
          const selected = await post('/api/v1/policy-configurations/endpoint-resolution/selection', {
            ...endpoints.body, candidate_set_digest: data.candidate_set_digest,
            selected_source_candidate_id: chosen.source, selected_destination_candidate_id: chosen.destination,
          }, signal)
          if (!live()) return
          if (selected.resolution_status !== 'RESOLVED' || selected.request_id !== binding || !selected.prepare_body) throw new Error('平台未返回与当前请求绑定的已解析结果')
          steer(exec.agent, `[policy-endpoint-resolution/v1]\n${JSON.stringify(selected)}\n本次原生端点选择已完成，权威需求理解如下：\n${selected.result_markdown}\n请在本轮立即调用 prepare_policy_configuration，body 必须原样使用下列平台返回对象；这不是执行授权：\n${JSON.stringify(selected.prepare_body)}`)
          return
        }
        const decision = await ask(ctx, active, `${exec.agent.id}\n${binding}\n${firewall.selection.candidate_set_digest}`, 'firewall', firewall.candidates, firewall.selection.replacement_required)
        if (!live()) return '本次防火墙选择已失效，请按当前任务继续。'
        if (decision.kind === 'unavailable') { steer(exec.agent, '原生候选面暂不可用，请列出本次冻结候选并等待用户用编号或IP明确选择；不得自动选择、prepare或执行。'); return }
        if (decision.kind === 'cancel') {
          const rejected = await submitPolicyRejection(exec.agent.id, binding, firewall.selection.candidate_set_digest,
            firewall.selection.business_revision, 'REJECT', '用户在原生防火墙选择面板明确取消本次配置', signal)
          cancelPolicyBinding(exec.agent, binding)
          return rejected.result_markdown
        }
        if (decision.kind !== 'select') return cancelled(exec.agent, binding, decision)
        const selected = decision.candidate
        const updated = await post(`/api/v1/policy-configurations/${binding}/candidate-selection`, {
          candidate_set_digest: firewall.selection.candidate_set_digest,
          ranked_candidate_ids: [selected.candidate_id, ...firewall.candidates.filter((item: Candidate) => item.candidate_id !== selected.candidate_id).map((item: Candidate) => item.candidate_id)],
          reason_codes: [firewall.selection.replacement_required ? 'user_confirmed_device_replacement' : 'user_explicit_device_selection'],
        }, signal)
        if (!live()) return
        if (updated.operation_id !== binding) throw new Error('平台设备选择结果未绑定本次操作')
        let selectedContext = ''
        if (firewall.selection.replacement_required) {
          const current = await currentPolicyStatus(binding, signal)
          if (!live()) return
          const candidate = current.candidate
          const currentSelected = candidate?.candidates?.find((item: Candidate) => item.candidate_id === current.selection?.selected_candidate_id)
          if (!Number.isInteger(candidate?.business_revision) || candidate.business_revision <= firewall.selection.business_revision ||
              !/^sha256:[0-9a-f]{64}$/.test(candidate.intent_digest ?? '') || candidate.intent_digest === firewall.selection.intent_digest ||
              candidate.replacement_required === true || candidate.candidates && (currentSelected?.device_query !== selected.device_query || candidate.original_device_query !== selected.device_query)) {
            throw new Error('设备选择后的冻结版本或生效目标尚未核验，请查询最新状态')
          }
          setPolicySelectedDevice(exec.agent, selected.device_query)
          selectedContext = `[policy-device-selection/v1]\n${JSON.stringify({ operation_id: binding,
            device_query: selected.device_query, label: selected.label, business_revision: candidate.business_revision,
            intent_digest: candidate.intent_digest, candidate_set_digest: candidate.candidate_set_digest })}\n`
        }
        steer(exec.agent, `${selectedContext}用户已明确选择本次执行防火墙 ${selected.label ?? selected.device_id}，当前有效 device_query=${JSON.stringify(selected.device_query ?? selected.device_id)}；这仅替换原不可用的设备约束，不是策略执行授权。平台选择回执：${JSON.stringify(updated)}\n请只续查当前 operationId=${binding} 的 get_policy_configuration_status，按权威状态读取 result，不重做 prepare，不自动改选其他设备。`)
      } catch (error: any) {
        if (!live()) return
        ctx.logger?.warn?.(`native policy selection failed: ${error?.message ?? String(error)}`)
        const tracking = firewall ? `\n操作号：${binding}\n下一步：只查询该操作最新状态，避免重复提交。` : '\n下一步：重新核验本次端点候选；本次未确认或执行策略。'
        return `处理结果：未完成\n原因：${publicSelectionError(error)}${tracking}`
      } finally {
        if (pending.get(exec.agent) === token) pending.delete(exec.agent)
      }
    })
    return downstream
  })
}
