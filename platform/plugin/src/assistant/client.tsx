import { useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CHANNEL } from '../protocol.ts'
import type { TaskExecution } from './task.ts'
import { instanceWebUrl } from '../instances/url.ts'

type SessionId = Parameters<Context['sessions']['binding']>[0]
type SessionReference = ReturnType<Context['sessions']['retain']>
export type AssistantContext = Record<string, unknown>

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { harnessAssistant: unknown }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'harness.assistant.conversation': { kind: 'single'; scope: 'session-maybe' }
  }
}

interface AssistantSnapshot {
  sessionId?: SessionId
  reference?: SessionReference
  platformContext?: boolean
  busy: boolean
  error: string
  status?: { running?: boolean; execution?: TaskExecution; proposals?: { id: string; state: OperationMeta['state']; domain: string; action: string; preview?: unknown; result?: unknown; error?: string }[] }
}

/** 浏览器只保留当前会话引用，任务与业务结果由原生 Session 和后端维护。 */
export function createAssistant(ctx: Pick<Context, 'sessions' | 'uiSession' | 'uiWorkspace' | 'workspaces'>, rpc: ClientConnectionRpc, getRoot: () => string | undefined, getLegacyRoots: () => string[] = () => []) {
  let snapshot: AssistantSnapshot = { busy: false, error: '' }
  let context: AssistantContext = { page: 'home' }
  let generation = 0
  let refreshGeneration = 0
  let contextPending = false
  let contextSyncing = false
  let selecting = false
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<AssistantSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach(listener => listener())
  }
  const isProjectSession = (sessionId: SessionId) => {
    const root = getRoot()
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    return Boolean(root && cwd && [root, ...getLegacyRoots()].includes(cwd))
  }
  const refresh = async () => {
    const sessionId = snapshot.sessionId
    if (!sessionId || snapshot.platformContext === false || disposed) return
    const current = generation
    const request = ++refreshGeneration
    try {
      const response = await rpc.call(CHANNEL, 'assistant/status', { session_id: sessionId })
      if (!disposed && generation === current && request === refreshGeneration && response.ok) publish({ status: response.value as AssistantSnapshot['status'] })
    } catch { /* 原生连接重连和下一次失效通知会重新读取。 */ }
  }
  async function syncContext() {
    contextPending = true
    if (contextSyncing) return
    contextSyncing = true
    try {
      while (contextPending && !disposed) {
        contextPending = false
        const sessionId = snapshot.sessionId
        const next = context
        if (!sessionId || snapshot.platformContext === false) continue
        try {
          const response = await rpc.call(CHANNEL, 'assistant/context', { session_id: sessionId, context: next })
          if (!response.ok && snapshot.sessionId === sessionId && context === next) publish({ error: response.error.message })
        } catch { if (snapshot.sessionId === sessionId && context === next) publish({ error: '页面上下文同步失败，请检查连接。' }) }
      }
    } finally { contextSyncing = false }
  }
  const select = async (sessionId: SessionId, navigate = true) => {
    if (snapshot.sessionId === sessionId && snapshot.reference) {
      if (navigate) ctx.uiWorkspace.openSession(sessionId)
      await refresh()
      return
    }
    const current = ++generation
    selecting = true
    try {
      const reference = ctx.sessions.retain(sessionId, { source: 'harnessAssistant' })
      snapshot.reference?.release()
      publish({ sessionId, reference, platformContext: navigate || isProjectSession(sessionId), status: undefined, error: '' })
      void syncContext()
      await reference.ready
      if (current === generation && !disposed) { if (navigate) ctx.uiWorkspace.openSession(sessionId); await refresh() }
    }
    catch (error) {
      if (current === generation && !disposed) publish({ error: error instanceof Error ? error.message : '无法读取助手会话，请重试。' })
      if (navigate) throw error
    } finally { if (current === generation) selecting = false }
  }
  const restore = () => {
    if (disposed || selecting || snapshot.busy) return
    const sessionId = ctx.uiSession.adapter.current.getSnapshot().key as SessionId | undefined
    if (!sessionId && snapshot.sessionId) {
      generation++
      snapshot.reference?.release()
      publish({ sessionId: undefined, reference: undefined, platformContext: false, status: undefined, error: '' })
    }
    if (sessionId && snapshot.sessionId !== sessionId) void select(sessionId, false)
    else if (sessionId && snapshot.platformContext !== isProjectSession(sessionId)) {
      publish({ platformContext: isProjectSession(sessionId), status: undefined, error: '' })
      void syncContext()
      void refresh()
    }
  }
  const subscriptions = [ctx.uiSession.adapter.current.subscribe(restore), ctx.sessions.list.subscribe(restore)]
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    select,
    refresh,
    restore,
    reveal() { if (snapshot.sessionId) ctx.uiWorkspace.openSession(snapshot.sessionId) },
    async create(task?: string, taskContext: AssistantContext = context) {
      publish({ busy: true, error: '' })
      try {
        const sessionIdToResume = typeof taskContext.session_id === 'string' ? taskContext.session_id : undefined
        const root = getRoot()
        if (!root) throw new Error('项目工作区尚未就绪，请稍后重试。')
        let resumeCwd: string | undefined
        if (sessionIdToResume) {
          resumeCwd = ctx.sessions.list.getSnapshot().byId[sessionIdToResume as SessionId]?.cwd
          if (!resumeCwd) {
            const status = await rpc.call(CHANNEL, 'assistant/status', { session_id: sessionIdToResume })
            if (!status.ok) throw new Error(status.error.message)
            resumeCwd = (status.value as { workspace?: { session_cwd?: string } }).workspace?.session_cwd
          }
          if (!resumeCwd || ![root, ...getLegacyRoots()].includes(resumeCwd)) throw new Error('助手会话不属于当前工作区')
        }
        const workspace = sessionIdToResume ? undefined : await ctx.workspaces.create({ path: root })
        // 原生 create/adopt 会在返回前登记客户端身份，不依赖异步列表通知到达顺序。
        const preparedSessionId = await ctx.sessions.create(sessionIdToResume
          ? { sessionId: sessionIdToResume as SessionId, cwd: resumeCwd }
          : { workspaceId: workspace!.workspaceId })
        await ctx.sessions.using(preparedSessionId, { source: 'harnessAssistant' }, async () => {
          if (disposed) return
          const response = await rpc.call(CHANNEL, 'assistant/session', {
            task, context: taskContext, session_id: preparedSessionId,
          })
          if (!response.ok) throw new Error(response.error.message)
          const sessionId = (response.value as { session_id: SessionId }).session_id
          if (!sessionId) throw new Error('助手未返回会话标识，请重试。')
          if (sessionId !== preparedSessionId) throw new Error('助手返回的会话与已建立的会话不一致，请重试。')
          if (!disposed) await select(sessionId)
        })
      } catch (error) {
        if (!disposed) publish({ error: error instanceof Error ? error.message : '无法创建助手会话。' })
        throw error
      } finally { if (!disposed) publish({ busy: false }) }
    },
    updateContext(next: AssistantContext) {
      if (JSON.stringify(context) === JSON.stringify(next)) return
      context = next
      void syncContext()
    },
    async reconnect() {
      const sessionId = snapshot.sessionId
      if (!sessionId || disposed) return
      snapshot.reference?.release()
      publish({ reference: undefined })
      await select(sessionId, false)
    },
    dispose() { disposed = true; generation++; subscriptions.forEach(dispose => dispose()); snapshot.reference?.release(); listeners.clear() },
  }
}
export type Assistant = ReturnType<typeof createAssistant>

function ChatView({ renderSlot }: ConversationViewsProps) {
  return <>{renderSlot('conversation.session', { view: 'chat' })}</>
}

/** Factory 复用原生消息、附件、问答、权限确认及 Composer。 */
export function AssistantConversation({ useSession, useConversation, renderFactorySlot }: PropsRuntime<'harness.assistant.conversation'> & PropsRenderFactories) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const active = Boolean(session && (session.running || !session.blank || session.promptAttempted)) || Boolean(conversation?.activeTargets.size)
  const hero = !active
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase: hero ? 'hero' : 'active', hero }, { slots: { views: ChatView } })
}

const domainLabels: Record<string, string> = { agents: '智能体与评测', instances: '实例', mcp: 'MCP', task: '智能体交付任务' }
const labels: Record<string, string> = {
  agent_id: '智能体', experiment_id: '版本', baseline: '主父版', sources: '关联来源', features: '特性',
  action: '操作', operation: '操作', name: '名称', instance: '实例', instance_name: '实例', source: '来源',
  title: '说明', goal: '目标', validation: '验证', warnings: '提示', summary: '摘要', status: '状态',
  success: '成功', failed: '失败', ok: '成功', message: '说明', result: '回执', receipts: '逐项回执',
  description: '说明', input: '修改内容', ops: '配置修改', op: '修改方式', path: '配置位置', value: '内容',
  revision: '配置版本', before: '原有特性', source_refs: '特性来源', evidence_refs: '验证依据', change: '本版变化',
  compositionId: '工具组合', versionId: '固定发布版本', toolName: '工具名称',
}
const internalFields = new Set(['preview_id', 'proposal_id', 'assistant_session_id', 'catalog_hash', 'plan_ready', 'requires_confirmation', 'evaluation_sha256', 'candidate_sha256', 'source_sha256'])
const technicalFields = new Set(['command', 'argv', 'cwd', 'stdout', 'stderr', 'logs', 'trace'])
const actionLabels: Record<string, string> = { start: '开始交付任务', create: '从固定父版派生', 'tasks/assembly-apply': '装配复用能力', saveConfiguration: '保存 MCP 配置', callPublishedComposition: '执行固定版本工具组合', 'fusion/confirm': '新建融合版本', 'features/apply': '保存版本特性', 'datasets/apply': '保存待复核决策样本', 'cases/create': '新增测试用例', new: '新建智能体', 'edit/apply': '保存资产修改', 'eval/start': '执行评测', 'eval/cancel': '取消评测', run: '实例操作', batch: '批量实例操作' }

function unwrap(value: unknown): unknown {
  if (value && typeof value === 'object' && 'ok' in value && 'value' in value && value.ok === true) return value.value
  return value
}

function Details({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>未提供</span>
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>
  if (Array.isArray(value)) return value.length ? <ul>{value.map((item, index) => <li key={index}><Details value={item}/></li>)}</ul> : <span>无</span>
  if (typeof value === 'object') return <dl>{Object.entries(value).filter(([key]) => !internalFields.has(key)).map(([key, item]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{technicalFields.has(key) ? <details><summary>查看技术详情</summary><Details value={item}/></details> : <Details value={item}/>}</dd></div>)}</dl>
  return <span>{String(value)}</span>
}

function BusinessPreview({ value }: { value: unknown }) {
  const dataset = unwrap(value) as any
  if (dataset?.plan?.goal && Array.isArray(dataset.plan.evaluation_case_ids)) {
    const plan = dataset.plan
    return <div className="harness-task-preview">
      <p><strong>{plan.goal}</strong></p>
      <p>{plan.new_agent ? `新建${plan.new_agent.name}` : `改进${plan.agent_id}`}，交付：{plan.deliverables.join('、')}。</p>
      <p>初测后最多修复 {plan.budget.max_repair_rounds} 轮，总时限 {plan.budget.timeout_minutes} 分钟，模型调用额度 {plan.budget.max_model_calls} 次。暂停和重启不会重置额度。</p>
      <p>确认后在本方案范围内连续办理；扩大任务、改验收标准或新增外部操作会单独确认。</p>
      <details><summary>查看能力、测试和允许操作</summary>
        {plan.new_agent && <><p>{plan.new_agent.description}</p><ul>{plan.new_agent.evaluation_cases.map((item: any) => <li key={item.id}><strong>{item.title}</strong><p>{item.expected_behavior}</p></li>)}</ul></>}
        <p>评测：{plan.evaluation_case_ids.join('、')}</p><p>允许操作：{plan.allowed_actions.map((item: any) => actionLabels[item.action] ?? item.action).join('、')}</p>
        {plan.source && <p>来源：{plan.source}</p>}
      </details>
      {dataset.note && <small>{dataset.note}</small>}
    </div>
  }
  if (dataset?.status === 'suggested' && Array.isArray(dataset.records)) return <div>
    <p>从 Run <strong>{dataset.run_id}</strong> 提取了 {dataset.count} 条待复核候选。确认保存后，在 Run 的“决策样本”中逐条复核。</p>
    {dataset.records.map((record: any) => <article key={record._meta.id}><strong>{record.questions.decision.instructions}</strong><p>建议标签：{String(record.questions.decision.label)}</p><p>{record._meta.label_basis}</p><details><summary>输入、候选与证据</summary><Details value={record}/></details></article>)}
    {dataset.skipped?.length > 0 && <details><summary>跳过原因</summary><Details value={dataset.skipped}/></details>}
  </div>
  const data = unwrap(value) as {
    action?: string; input?: { revision?: number; ops?: { op: string; path: (string | number)[]; value?: unknown }[] }
    agent_id?: string; parent_experiment_id?: string; parent_ref?: string; research_question?: string
    plan?: {
      sources?: { experiment_id: string; ref: string; decision: string; reason: string }[]
      features?: { title: string; description: string; source_refs?: string[] }[]
      conflicts?: { description: string; resolution: string }[]
      checks?: { kind: string; case_ids?: string[]; command?: string[]; cwd?: string }[]
    }
  } | undefined
  if (data?.action === 'saveConfiguration' && Array.isArray(data.input?.ops)) return <div>
    <p>确认保存以下 MCP 配置修改：</p><ul>{data.input.ops.map((operation, index) => <li key={index}><strong>{({ replace: '修改', add: '新增', remove: '删除' } as Record<string, string>)[operation.op] ?? operation.op} {Array.isArray(operation.path) ? operation.path.join('.') : String(operation.path ?? '未指定配置位置')}</strong>{operation.op !== 'remove' && <Details value={operation.value}/>}</li>)}</ul>
    <small>基于配置版本 {data.input.revision}</small>
  </div>
  if (!data?.parent_experiment_id || !data.plan) return <Details value={unwrap(value)}/>
  return <div className="harness-fusion-confirmation">
    <p><strong>改进目标：</strong>{data.research_question}</p>
    <dl><div><dt>智能体</dt><dd>{data.agent_id}</dd></div><div><dt>主父版</dt><dd>{data.parent_experiment_id}<small>{data.parent_ref}</small></dd></div></dl>
    <h4>来源取舍</h4><ul>{data.plan.sources?.map(source => <li key={source.experiment_id}><strong>{source.decision === 'inherit' ? '继承' : '舍弃'} {source.experiment_id}</strong><p>{source.reason}</p><small>{source.ref}</small></li>)}</ul>
    <h4>新版本特性</h4><ul>{data.plan.features?.map((feature, index) => <li key={index}><strong>{feature.title}</strong><p>{feature.description}</p>{feature.source_refs?.length ? <small>来源：{feature.source_refs.join('、')}</small> : null}</li>)}</ul>
    <h4>冲突与取舍</h4>{data.plan.conflicts?.length ? <ul>{data.plan.conflicts.map((conflict, index) => <li key={index}><p>{conflict.description}</p><p>处理：{conflict.resolution}</p></li>)}</ul> : <p>未列出语义冲突。</p>}
    <h4>验证范围</h4><ul>{data.plan.checks?.map((check, index) => <li key={index}>{({ build: '构建', load: '实际装载', capability: '能力验证' } as Record<string, string>)[check.kind] ?? check.kind}{check.case_ids?.length ? `：${check.case_ids.join('、')}` : ''}{check.command?.length ? <details><summary>查看执行命令</summary><code>{check.command.join(' ')}</code>{check.cwd && <p>工作目录：{check.cwd}</p>}</details> : null}</li>)}</ul>
  </div>
}

interface OperationMeta {
  kind: 'platform-operation'
  domain: string
  action: string
  proposal_id?: string
  preview?: unknown
  result?: unknown
  state: 'awaiting_confirmation' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
}

interface OperationProps {
  meta?: OperationMeta
  phase: string
  toolName: string
  sessionId: SessionId
  rpc: ClientConnectionRpc
  assistant: Assistant
}
function OperationCard(props: OperationProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const assistantState = useSyncExternalStore(props.assistant.subscribe, props.assistant.getSnapshot)
  const meta = props.meta
  const proposal = assistantState.sessionId === props.sessionId ? assistantState.status?.proposals?.find(item => item.id === meta?.proposal_id) : undefined
  const state = proposal?.state ?? meta?.state
  const result = proposal?.result ?? meta?.result
  return <section className="harness-operation-card" aria-label="平台操作回执">
    <header><strong>{domainLabels[meta?.domain ?? ''] ?? '平台操作'}</strong><span>{meta?.action ? actionLabels[meta.action] ?? meta.action : props.toolName}</span></header>
    {!meta || meta.kind !== 'platform-operation' ? <p role="status">{props.phase === 'result' ? '操作已返回，请查看会话说明。' : '正在读取与处理…'}</p> : <>
      <p className="harness-operation-state">{state === 'completed' ? '已返回操作结果' : state === 'failed' ? '操作失败' : state === 'cancelled' ? '操作已取消' : state === 'unknown' ? '未收到完整回执，请核对实际状态' : state === 'running' ? '已确认，正在执行' : '请确认以下操作方案'}</p>
      {meta.preview !== undefined && <BusinessPreview value={meta.preview}/>}
      {result !== undefined && <details className="harness-operation-result"><summary>查看实际操作回执</summary><Details value={unwrap(result)}/></details>}
      {proposal?.error && <p role="alert">{proposal.error}</p>}
      {state === 'awaiting_confirmation' && meta.proposal_id && <button className="harness-primary" disabled={busy} onClick={async () => {
        setBusy(true); setError(''); setNotice('')
        try {
          const response = await props.rpc.call(CHANNEL, 'assistant/confirm', { session_id: props.sessionId, proposal_id: meta.proposal_id })
          if (!response.ok) throw new Error(response.error.message)
          if ((response.value as { continuation?: string }).continuation === 'requires_user_message') setNotice('操作已确认执行。原会话运行已结束，请发送后续消息继续。')
          await props.assistant.refresh()
        } catch (failure) { setError(failure instanceof Error ? failure.message : '确认失败，请重试。') }
        finally { setBusy(false) }
      }}>{busy ? '正在确认…' : '确认并执行'}</button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}

/** 原生工具结果携带的真实提案可以在原会话内确认。 */
export function PlatformOperationCard(props: ToolCallViewProps & { rpc: ClientConnectionRpc; assistant: Assistant }) {
  return <OperationCard {...props} meta={props.phase === 'result' ? props.block.meta as OperationMeta | undefined : undefined}/>
}

/** 原生轨迹默认折叠；待确认操作直接出现在 Composer 上方。 */
export function AssistantOperations({ assistant, rpc, sessionId }: PropsRuntime<'conversation.input.dock'> & { rpc: ClientConnectionRpc; assistant: Assistant }) {
  const state = useSyncExternalStore(assistant.subscribe, assistant.getSnapshot)
  if (state.sessionId !== sessionId) return null
  const proposals = state.status?.proposals ?? []
  const pending = proposals.filter(item => ['awaiting_confirmation', 'running', 'unknown'].includes(item.state))
  const shown = pending.length ? pending : proposals.slice(-1)
  const execution = state.status?.execution
  if (!shown.length && !execution) return null
  return <div className="harness-assistant-proposals-dock">{execution && <TaskCard task={execution} assistant={assistant} rpc={rpc} sessionId={sessionId}/>}{shown.length > 0 && <details className="harness-assistant-proposals" open={pending.length > 0}>
    <summary>{pending.length ? '平台操作确认与进度' : '最近操作回执'}</summary>
    <div>{shown.map(proposal => <OperationCard key={proposal.id} assistant={assistant} rpc={rpc} sessionId={sessionId}
      phase="result" toolName={`platform_${proposal.domain}`} meta={{ ...proposal, kind: 'platform-operation', proposal_id: proposal.id }}/>)}</div>
  </details>}</div>
}

function TaskCard({ task, assistant, rpc, sessionId }: { task: TaskExecution; assistant: Assistant; rpc: ClientConnectionRpc; sessionId: SessionId }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const statuses = { running: '正在执行', paused: '已暂停', cancelled: '已取消', budget_exhausted: '额度已用尽', unknown: '需要核对操作状态', completed: '已验证并交付' }
  const act = async (action: string) => {
    setBusy(true); setError('')
    try {
      const response = await rpc.call(CHANNEL, `assistant/task/${action}`, { session_id: sessionId })
      if (!response.ok) throw new Error(response.error.message)
      await assistant.refresh()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '任务操作失败') }
    finally { setBusy(false) }
  }
  return <section className="harness-operation-card" aria-label="智能体交付任务">
    <header><strong>{statuses[task.state]}</strong><span>{task.plan.new_agent?.name ?? task.plan.agent_id}</span></header>
    <p>{task.plan.goal}</p>
    <p>修复 {task.repair_rounds}/{task.plan.budget.max_repair_rounds} 轮 · 已观测模型调用 {task.model_calls}/{task.plan.budget.max_model_calls} 次 · 截止 {new Date(task.deadline_at).toLocaleTimeString()}</p>
    <small>含助手 {task.assistant_model_calls ?? task.model_calls} 次，业务、评审与重试按实际轨迹累计；在途或缺失统计不按零计。外部容器调用不能实时硬封顶。</small>
    {task.reason && <p role="status">{task.reason}</p>}
    {task.operations.some(item => ['running', 'unknown'].includes(item.state)) && <button disabled={busy} onClick={() => void act('checkpoint')}>核对运行状态</button>}
    {task.state === 'running' && <button disabled={busy} onClick={() => void act('pause')}>暂停任务</button>}
    {task.state === 'paused' && <button disabled={busy} onClick={() => void act('resume')}>恢复任务</button>}
    {task.source_ref && task.operations.some(item => item.action === 'edit/apply' && item.state === 'completed') && task.state !== 'completed' && <button disabled={busy} onClick={() => void act('rollback')}>恢复任务前版本</button>}
    {!['completed', 'cancelled'].includes(task.state) && <button disabled={busy} onClick={() => void act('cancel')}>取消任务</button>}
    {task.delivery && <><p>业务测试、目标实例及产物已核验。</p>
      {task.delivery.entry && <p><a href={instanceWebUrl(task.delivery.entry, window.location.hostname)} target="_blank" rel="noreferrer">打开智能体</a></p>}
      {(task.delivery.artifacts ?? []).map((artifact: any) => <p key={artifact.path}><a href={(() => { const url = new URL('api/harness-platform/runs/download', document.baseURI); url.searchParams.set('run_id', task.delivery.run_id); url.searchParams.set('kind', 'file'); url.searchParams.set('path', artifact.run_path); return url.href })()} download>下载 {artifact.run_path?.split('/').at(-1) ?? '业务产物'}</a></p>)}
      {(task.delivery.probe?.downloads ?? []).map((artifact: any) => <p key={artifact.format}><a href={instanceWebUrl({ ...task.delivery.entry, url: artifact.url }, window.location.hostname)} target="_blank" rel="noreferrer" download>{artifact.format === 'csv' ? '下载设备 CSV' : '下载 Markdown'}</a></p>)}
      <details><summary>查看验证结果与限制</summary><Details value={task.delivery}/></details></>}
    {error && <p role="alert">{error}</p>}
  </section>
}
