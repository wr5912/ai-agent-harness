import { useEffect, useMemo, useRef, useState } from 'react'
import { CHANNEL } from '../protocol.ts'
import type { PlatformNavigation, PlatformPageProps } from '../protocol.ts'
import type { PlatformUpdates } from '../realtime/client.ts'
import { instanceWebUrl } from '../instances/url.ts'
import { AssetDiffPanel } from './asset-diff-client.tsx'
import { CreateAgentDialog } from './create-agent-client.tsx'

type RpcResult = { ok: true; value: any } | { ok: false; error: { code: string; message: string; details?: any } }
type AgentRow = { id: string; name?: string; manifest?: Record<string, any>; active_experiment?: string | null; version_count?: number; latest_experiment_status?: string | null; instance_state?: string }
type PreviewState = { path: string; body: string; before: string; diff: string; dry: any }
type AssetNode = { name: string; path: string; kind: string; children?: AssetNode[] }

function AssetTree({ nodes, selected, onSelect }: { nodes: AssetNode[]; selected: string; onSelect(path: string): void }) {
  return <ul className="harness-asset-tree">{nodes.map(node => <li key={node.path}>
    {node.children ? <details open={node.name === 'candidate'}><summary><button type="button" aria-pressed={selected === node.path} onClick={() => onSelect(node.path)}>{node.name}/</button></summary>
      <AssetTree nodes={node.children} selected={selected} onSelect={onSelect} /></details>
      : <button type="button" aria-pressed={selected === node.path} onClick={() => onSelect(node.path)}>{node.name}</button>}
  </li>)}</ul>
}

function Fields({ items }: { items: [string, unknown][] }) {
  return <dl className="harness-fields">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{Array.isArray(value) ? value.join('、') || '无' : typeof value === 'string' || typeof value === 'number' ? value : '未知'}</dd></div>)}</dl>
}

const panel = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  border: '1px solid var(--dsw-alias-border-l4, #d1d5db)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
} as const

function text(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}


function researchStatus(status?: string | null) {
  return ({ active: '研究中', completed: '已完成研究', archived: '已归档', adopted: '已采纳', rejected: '已拒绝' } as Record<string, string>)[status ?? ''] ?? status ?? '状态未记录'
}

const field = { display: 'grid', minWidth: 0, gap: 4 } as const
const tabs = [
  { id: 'overview', label: '概览' },
  { id: 'assets', label: 'Harness 资产' },
  { id: 'capabilities', label: '能力状态' },
  { id: 'runtime', label: '运行情况' },
] as const

export function AgentsPage({ rpc, updates, onContext, onAssistant, target, onNavigate, active = true }: PlatformPageProps & { target?: PlatformNavigation; onNavigate?(target: PlatformNavigation): void; active?: boolean; updates?: PlatformUpdates; onContext?(context: Record<string, unknown>): void; onAssistant?(task: string, context: Record<string, unknown>): Promise<void> }) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [selectedExperiment, setSelectedExperiment] = useState('')
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('overview')
  const [detail, setDetail] = useState<any>(null)
  const [error, setError] = useState('')
  const [editPath, setEditPath] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editHash, setEditHash] = useState('')
  const [editPreview, setEditPreview] = useState<PreviewState | null>(null)
  const [editMessage, setEditMessage] = useState('')
  const [assetInfo, setAssetInfo] = useState<any>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const editDialog = useRef<HTMLDialogElement>(null)
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionGoal, setVersionGoal] = useState('')
  const [versionParent, setVersionParent] = useState('')
  const [versionInventory, setVersionInventory] = useState<any>(null)
  const [versionProposal, setVersionProposal] = useState<any>(null)
  const [featureProposal, setFeatureProposal] = useState<any>(null)
  const [launch, setLaunch] = useState<any>(null)
  const [launchName, setLaunchName] = useState('')
  const [launchPort, setLaunchPort] = useState('')
  const [launchMessage, setLaunchMessage] = useState('')
  const [launchBusy, setLaunchBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const detailRequest = useRef(0)
  const selectionRequest = useRef(0)
  const versionPreviewRequest = useRef(0)
  const launchRequest = useRef(0)
  const editRequest = useRef(0)
  const selectedAgent = useMemo(() => agents.find(agent => agent.id === selected), [agents, selected])
  const pendingSelectionNavigation = useRef(false)
  const navigation = useRef({ active, target, onNavigate, tab })
  navigation.current = { active, target, onNavigate, tab }

  function navigateSelection(agentId: string, experimentId: string | undefined, nextTab = tab, replace = false) {
    const current = navigation.current
    if (!current.active || !agentId || !experimentId) return
    if (current.target?.page === 'agents' && current.target.agent_id === agentId
      && current.target.experiment_id === experimentId && current.target.tab === nextTab) return
    current.onNavigate?.({ page: 'agents', agent_id: agentId, experiment_id: experimentId, tab: nextTab, ...(replace ? { replace: true } : {}) })
  }

  function selectTab(nextTab: (typeof tabs)[number]['id']) {
    setTab(nextTab)
    navigateSelection(selected, detail?.experiment?.id, nextTab)
  }

  function selectVersion(agentId: string, experimentId = '', notify = true) {
    if (agentId === selected && (!experimentId || experimentId === selectedExperiment)) {
      if (notify) navigateSelection(agentId, detail?.experiment?.id)
      return true
    }
    if (!discardAssetDraft()) return false
    detailRequest.current++
    selectionRequest.current++
    versionPreviewRequest.current++
    launchRequest.current++
    pendingSelectionNavigation.current = notify && !experimentId
    const nextTab = agentId !== selected ? 'overview' : tab
    setTab(nextTab)
    setSelected(agentId)
    setSelectedExperiment(experimentId)
    setDetail(null)
    setVersionOpen(false)
    setVersionInventory(null)
    setVersionProposal(null)
    setFeatureProposal(null)
    setLaunch(null)
    setDiffOpen(false)
    setLaunchBusy(false)
    selectEditFile('')
    if (notify && experimentId) navigateSelection(agentId, experimentId, nextTab)
    return true
  }

  function selectEditFile(path: string) {
    editRequest.current++
    setEditPath(path)
    setEditBody('')
    setEditHash('')
    setEditPreview(null)
    setEditMessage('')
    setAssetInfo(null)
    setEditOpen(false)
  }

  async function call(operation: string, payload: Record<string, unknown> = {}) {
    const result = await rpc.call(CHANNEL, `agents/${operation}`, payload) as RpcResult
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  async function refreshList() {
    setError('')
    try {
      const value = await call('list')
      setAgents(value.agents ?? [])
      setSelected(current => current || value.agents?.[0]?.id || '')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function refreshDetail(agentId = selected, experimentId = selectedExperiment) {
    if (!agentId) return
    const request = ++detailRequest.current
    setError('')
    try {
      const payload = experimentId ? { agent_id: agentId, experiment_id: experimentId } : { agent_id: agentId }
      const value = await call('detail', payload)
      if (request !== detailRequest.current) return
      setDetail(value)
      if (!experimentId) setSelectedExperiment(current => current || value.experiment.id)
      // 默认版本必须使用服务端实际解析结果，不能用登记版本填充地址。
      navigateSelection(agentId, value.experiment.id, navigation.current.tab, !pendingSelectionNavigation.current)
      pendingSelectionNavigation.current = false
      const containsPath = (nodes: AssetNode[]): boolean => nodes.some(node => node.path === editPath || (node.children && containsPath(node.children)))
      if (!containsPath(value.assets ?? []) && !editOpen) selectEditFile(value.assets?.[0]?.path ?? '')
    } catch (err) {
      if (request === detailRequest.current) setError((err as Error).message)
    }
  }

  async function loadEditFile(path = editPath) {
    if (!detail || !path) return false
    const request = ++editRequest.current
    setError('')
    try {
      const value = await call('edit/read', { experiment_id: detail.experiment.id, path })
      if (request !== editRequest.current) return false
      setEditPath(value.path)
      setAssetInfo(value)
      setEditBody(value.content ?? '')
      setEditHash(value.sha256 ?? '')
      setEditPreview(null)
      setEditMessage('')
      return true
    } catch (err) {
      if (request === editRequest.current) setError((err as Error).message)
      return false
    }
  }

  useEffect(() => { void refreshList() }, [])
  useEffect(() => { void refreshDetail(selected, selectedExperiment) }, [selected, selectedExperiment])
  useEffect(() => {
    if (active) onContext?.({ page: 'agents', agent_id: selected || undefined, experiment_id: detail?.experiment?.id, tab })
  }, [active, selected, detail?.experiment?.id, tab, onContext])
  useEffect(() => {
    if (!active || !target || target.page !== 'agents') return
    if (target.agent_id && !selectVersion(target.agent_id, target.experiment_id, false)) {
      // 浏览器已更新地址；用户保留草稿时同步恢复当前对象与标签。
      navigateSelection(selected, detail?.experiment?.id, tab, true)
      return
    }
    const nextTab = tabs.find(item => item.id === target.tab)?.id ?? 'overview'
    setTab(nextTab)
    if ((!target.agent_id || target.agent_id === selected)
      && (!target.experiment_id || target.experiment_id === selectedExperiment)) {
      navigateSelection(selected, detail?.experiment?.id, nextTab, true)
    }
  }, [active, target?.page, target?.agent_id, target?.experiment_id, target?.tab])
  useEffect(() => {
    if (!editOpen || !assetDirty) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [editOpen, editBody, assetInfo?.content])
  useEffect(() => {
    const selection = selectionRequest.current
    if (selected) void call('fusion/proposal', { agent_id: selected }).then(value => {
      if (selection === selectionRequest.current) setVersionProposal(value.proposal)
    }).catch(() => undefined)
    if (detail?.experiment?.id) void call('features/proposal', { experiment_id: detail.experiment.id }).then(value => {
      if (selection === selectionRequest.current) setFeatureProposal(value.proposal)
    }).catch(() => undefined)
  }, [selected, detail?.experiment?.id])
  useEffect(() => updates?.subscribe(() => {
    const snapshot = updates.getSnapshot()
    if (!snapshot.domains.some(domain => ['agents', 'instances', 'catalog'].includes(domain))) return
    const selection = selectionRequest.current
    void refreshList()
    void refreshDetail(selected, selectedExperiment)
    if (selected) void call('fusion/proposal', { agent_id: selected }).then(value => { if (selection === selectionRequest.current) setVersionProposal(value.proposal) }).catch(() => undefined)
    if (detail?.experiment?.id) void call('features/proposal', { experiment_id: detail.experiment.id }).then(value => { if (selection === selectionRequest.current) setFeatureProposal(value.proposal) }).catch(() => undefined)
    if (editOpen && detail?.experiment?.id && editPath && editHash) {
      const request = editRequest.current
      void call('edit/read', { experiment_id: detail.experiment.id, path: editPath }).then(value => { if (request === editRequest.current && value.sha256 !== editHash) setEditMessage('文件已被其他任务修改，编辑草稿已保留；保存前请核对最新内容。') }).catch(() => undefined)
    }
  }), [updates, selected, selectedExperiment, detail?.experiment?.id, editOpen, editPath, editHash])
  useEffect(() => { void loadEditFile(editPath) }, [detail?.experiment?.id, editPath])
  useEffect(() => {
    if (editOpen && active) editDialog.current?.showModal()
    else editDialog.current?.close()
  }, [editOpen, active])

  async function previewVersion() {
    if (!detail || !versionGoal.trim()) return
    const selection = selectionRequest.current
    const request = ++versionPreviewRequest.current
    try {
      const value = await call('fusion/preview', {
        agent_id: selected,
        parent_ref: versionParent,
        parent_experiment_id: detail.experiment.id,
        research_question: versionGoal,
      })
      if (selection !== selectionRequest.current || request !== versionPreviewRequest.current) return
      setVersionInventory(value)
      setVersionProposal(null)
    } catch (err) { if (selection === selectionRequest.current && request === versionPreviewRequest.current) setError((err as Error).message) }
  }

  async function askVersionPlan() {
    if (!versionInventory || !onAssistant) return
    await onAssistant(`为当前智能体创建新版本。改进目标：${versionGoal.trim()}`, { page: 'agents', agent_id: selected, experiment_id: detail.experiment.id, fusion_request: versionInventory })
  }

  async function confirmVersion() {
    if (!versionProposal) return
    const selection = selectionRequest.current
    try {
      const { value } = await confirmBusinessProposal('fusion/confirm', versionProposal)
      await refreshList()
      if (selection === selectionRequest.current) selectVersion(selected, value.experiment_id)
    } catch (err) { setError((err as Error).message) }
  }

  async function confirmFeatures() {
    if (!featureProposal) return
    const selection = selectionRequest.current
    try {
      await confirmBusinessProposal('features/apply', featureProposal)
      if (selection !== selectionRequest.current) return
      setFeatureProposal(null)
      await refreshDetail()
    } catch (err) { setError((err as Error).message) }
  }

  async function confirmBusinessProposal(action: string, proposal: any): Promise<{ value: any; resumed: boolean }> {
    if (proposal.assistant_session_id) {
      const status = await rpc.call(CHANNEL, 'assistant/status', { session_id: proposal.assistant_session_id }) as RpcResult
      if (!status.ok) throw new Error(status.error.message)
      const pending = status.value.proposals.find((item: any) => item.domain === 'agents' && item.action === action && item.input?.preview_id === proposal.preview_id)
      if (pending) {
        const response = await rpc.call(CHANNEL, 'assistant/confirm', { session_id: proposal.assistant_session_id, proposal_id: pending.id }) as RpcResult
        if (!response.ok) throw new Error(response.error.message)
        const receipt = response.value.result
        if (response.value.state !== 'completed' || !receipt?.ok) throw new Error(receipt?.error?.message || '尚未收到完整执行回执，请在同一会话核对状态。')
        return { value: receipt.value, resumed: response.value.continuation === 'resumed' }
      }
    }
    return { value: await call(action, { preview_id: proposal.preview_id, confirmed: true }), resumed: false }
  }

  async function instanceCall(endpoint: string, payload: Record<string, unknown> = {}) {
    const result = await rpc.call(CHANNEL, `instances/${endpoint}`, payload) as RpcResult
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }

  function changeLaunch(value: any) { launchRequest.current++; setLaunchBusy(false); setLaunch(value) }
  function resetVersionPreview() { versionPreviewRequest.current++; setVersionInventory(null); setVersionProposal(null) }

  async function launchVersion() {
    if (!detail) return
    const selection = selectionRequest.current
    const request = ++launchRequest.current
    setLaunchBusy(true)
    setLaunchMessage('')
    try {
      const value = await instanceCall('list')
      if (selection !== selectionRequest.current || request !== launchRequest.current) return
      const instances = value.instances.filter((item: any) => item.source_id === `experiment:${detail.experiment.id}`)
      setLaunch({ experiment_id: detail.experiment.id, instances, selected: instances[0]?.name ?? '', preview: null, url: null })
      setLaunchName(`${selected}-${detail.experiment.id.match(/-(\d{3})(?:-|$)/)?.[1] ?? 'new'}-${Date.now().toString().slice(-5)}`)
      setLaunchPort('')
    } catch (err) { if (selection === selectionRequest.current && request === launchRequest.current) setLaunchMessage((err as Error).message) }
    finally { if (selection === selectionRequest.current && request === launchRequest.current) setLaunchBusy(false) }
  }

  async function previewLaunch() {
    if (!launch) return
    const selection = selectionRequest.current
    const requestId = ++launchRequest.current
    setLaunchBusy(true)
    try {
      const item = launch.instances.find((item: any) => item.name === launch.selected)
      if (item?.state === 'running') {
        const value = await instanceCall('url', { name: item.name })
        if (selection !== selectionRequest.current || requestId !== launchRequest.current) return
        setLaunch({ ...launch, url: instanceWebUrl(value, window.location.hostname) })
      } else {
        const request = { operation: item ? 'start' : 'create', name: item?.name ?? launchName, source: `experiment:${launch.experiment_id}`, ...(launchPort ? { port: Number(launchPort) } : {}) }
        const preview = await instanceCall('preview', request)
        if (selection !== selectionRequest.current || requestId !== launchRequest.current) return
        setLaunch({ ...launch, request, preview, url: null })
      }
    } catch (err) { if (selection === selectionRequest.current && requestId === launchRequest.current) setLaunchMessage((err as Error).message) }
    finally { if (selection === selectionRequest.current && requestId === launchRequest.current) setLaunchBusy(false) }
  }

  async function confirmLaunch() {
    if (!launch?.request) return
    const selection = selectionRequest.current
    const request = ++launchRequest.current
    setLaunchBusy(true)
    try {
      const receipt = await instanceCall('run', launch.request)
      if (!receipt.ok) throw new Error(receipt.error?.message || '启动失败')
      const value = await instanceCall('url', { name: launch.request.name })
      if (selection !== selectionRequest.current || request !== launchRequest.current) return
      setLaunch({ ...launch, preview: null, url: instanceWebUrl(value, window.location.hostname) })
      setLaunchMessage('实例已启动，可打开智能体对话。')
      await refreshDetail()
    } catch (err) { if (selection === selectionRequest.current && request === launchRequest.current) setLaunchMessage((err as Error).message) }
    finally { if (selection === selectionRequest.current && request === launchRequest.current) setLaunchBusy(false) }
  }

  async function doPreview() {
    if (!detail || !editPath || !editHash) return
    const request = editRequest.current
    setEditBusy(true)
    setEditMessage('')
    try {
      const value = await call('edit/preview', {
        experiment_id: detail.experiment.id,
        edits: [{ path: editPath, content: editBody, expected_sha256: editHash }],
      })
      if (request !== editRequest.current) return
      const row = value.edits?.[0]
      setEditPreview({ path: row.path, body: editBody, before: row.before_sha256, diff: row.diff || '无变化', dry: value.dry_run })
      setEditMessage('dry 校验通过，原文件尚未修改。')
    } catch (err) {
      if (request === editRequest.current) { setEditPreview(null); setEditMessage((err as Error).message) }
    } finally { setEditBusy(false) }
  }

  async function doApply() {
    if (!detail || !editHash) return
    const request = detailRequest.current
    const edit = editRequest.current
    setEditBusy(true)
    setEditMessage('正在进行 dry 校验…')
    try {
      const value = await call('edit/apply', {
        experiment_id: detail.experiment.id,
        edits: [{ path: editPath, content: editBody, expected_sha256: editHash }],
      })
      if (request !== detailRequest.current || edit !== editRequest.current) return
      setEditPreview(null)
      if (!await loadEditFile(editPath) || request !== detailRequest.current) return
      const currentEdit = editRequest.current
      const refresh = detailRequest.current + 1
      await refreshDetail()
      if (refresh !== detailRequest.current || currentEdit !== editRequest.current) return
      const missing = value.dry_run.missing_env_names ?? []
      setEditMessage(`dry 校验通过，已保存 ${value.written?.[0]?.path}${missing.length ? `；实际运行前需补齐环境变量：${missing.join('、')}` : ''}`)
    } catch (err) {
      if (request === detailRequest.current && edit === editRequest.current) setEditMessage(`${(err as Error).message}；草稿已保留。`)
    } finally { setEditBusy(false) }
  }

  const assetDirty = assetInfo?.kind === 'text' && editBody !== assetInfo.content
  const visibleAgents = agents.filter(agent => `${agent.name ?? agent.manifest?.name ?? ''} ${agent.id}`.toLowerCase().includes(search.trim().toLowerCase()))
  const instances = detail?.loaded_instance?.instances ?? []
  const versionRuns = detail?.verification?.runs ?? []

  function discardAssetDraft() {
    return !assetDirty || window.confirm('当前资产有未保存修改。确认放弃草稿？')
  }

  function closeEditor() {
    if (!editBusy && discardAssetDraft()) {
      setEditBody(assetInfo?.content ?? '')
      setEditOpen(false)
    }
  }

  function openEvaluation(nextTab = 'runs', runId?: string) {
    onNavigate?.({ page: 'evaluation', agent_id: selected, experiment_id: detail?.experiment?.id, tab: nextTab, ...(runId ? { run_id: runId } : {}) })
  }

  return <main className="harness-agents">
    <div style={{ minWidth: 0, display: 'grid', gap: 16 }}>
      <header className="agent-page-heading">
        <div><h1>智能体管理</h1><p>管理研究版本与 Harness 资产，查看能力证据和运行情况。</p></div>
        <div className="agent-actions"><button type="button" onClick={() => setCreateOpen(true)}>新建智能体</button><button type="button" onClick={() => { void refreshList(); void refreshDetail() }}>刷新</button></div>
      </header>
      {error && <p role="alert" className="agent-error">{error}</p>}
      <section className="harness-agent-layout">
        <aside className="harness-agent-list" style={panel}>
          <div className="agent-list-heading"><h2>智能体列表</h2><span>{agents.length}</span></div>
          <label className="agent-search"><span>搜索智能体</span><input type="search" placeholder="名称或 Agent ID" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <div className="harness-agent-list-options">
            {visibleAgents.map(agent => <button key={agent.id} type="button" className="agent-list-card" onClick={() => selectVersion(agent.id)} aria-pressed={agent.id === selected}>
              <span className="agent-list-card-title"><strong>{agent.name || agent.manifest?.name || agent.id}</strong><span className="agent-badge">{researchStatus(agent.latest_experiment_status)}</span></span>
              <span className="agent-id">{agent.id}</span>
              {agent.manifest?.description && <span className="agent-list-description">{agent.manifest.description}</span>}
              <span className="agent-list-meta">{typeof agent.version_count === 'number' ? `${agent.version_count} 个研究版本` : '版本数量未读取'} · {agent.instance_state || '实例未观察'}</span>
            </button>)}
            {agents.length > 0 && !visibleAgents.length && <p className="agent-empty">没有匹配的智能体。</p>}
            {!agents.length && !error && <p className="agent-empty">尚无智能体资产。</p>}
          </div>
        </aside>
        <section className="harness-agent-detail" style={{ display: 'grid', minWidth: 0, gap: 16 }}>
          {!detail && selected && !error && <p role="status">正在读取智能体…</p>}
          {detail && <section className="agent-identity" style={panel}>
            <div className="agent-identity-top">
              <div className="agent-identity-title"><span className="agent-avatar" aria-hidden="true">◇</span><div><h2>{detail.agent.name || detail.agent.manifest.name || selectedAgent?.name || selected}</h2><p className="agent-id">Agent ID · {selected}</p></div></div>
              <div className="agent-actions"><button type="button" disabled={!onNavigate} onClick={() => openEvaluation()}>评测此版本</button><button type="button" onClick={() => { setVersionOpen(true); setVersionParent(detail.repo_commit ? `git:${detail.repo_commit}` : ''); resetVersionPreview() }}>新建研究版本</button><button type="button" className="agent-primary" disabled={launchBusy} onClick={() => void launchVersion()}>启动智能体</button></div>
            </div>
            <div className="agent-version-bar"><label>所选研究版本<select aria-label="版本" value={selectedExperiment || detail.experiment.id} onChange={event => selectVersion(selected, event.target.value)}>{detail.versions.map((version: any) => <option key={version.id} value={version.id}>{version.id}</option>)}</select></label><div><span>登记版本</span><strong>{selectedAgent?.active_experiment || '未登记'}</strong></div></div>
            {detail.creation && <p role="status" className="agent-notice">{detail.creation.status === 'completed' ? '新版本创建成功' : '融合中：等待资产集成与约定验证'}{detail.creation.status !== 'completed' && <button type="button" disabled={!onAssistant} onClick={() => void onAssistant?.('继续完成当前版本的融合。', { page: 'agents', agent_id: selected, experiment_id: detail.experiment.id, session_id: detail.creation.assistant_session_id })}>继续融合</button>}</p>}
          </section>}
          {versionOpen && detail && <section style={panel} aria-label="新建智能体版本">
            <h2>新建 {selected} 版本</h2>
            <label style={field}>改进目标<textarea value={versionGoal} onChange={event => { setVersionGoal(event.target.value); resetVersionPreview() }} rows={3} /></label>
            <label style={field}>主父版固定 Git 引用<input value={versionParent} onChange={event => { setVersionParent(event.target.value); resetVersionPreview() }} /></label>
            <p>当前主父版：{detail.experiment.id}。先核对未继承的并行能力及取舍，确认后再建立新版本。</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" disabled={!versionGoal.trim()} onClick={() => void previewVersion()}>盘点继承来源</button><button type="button" onClick={() => { versionPreviewRequest.current++; setVersionOpen(false) }}>关闭</button></div>
            {versionInventory && <><h3>主父版尚未覆盖的来源</h3>{versionInventory.inventory.sources.length ? <ul>{versionInventory.inventory.sources.map((source: any) => <li key={source.experiment_id}><strong>{source.experiment_id}</strong> · {source.status === 'recommended' ? '建议继承' : source.status === 'excluded' ? '默认排除' : '待判断'}<p>{source.reason}</p></li>)}</ul> : <p>没有发现尚未覆盖的并行来源。</p>}
              <button type="button" disabled={!onAssistant} onClick={() => void askVersionPlan()}>请 AI 整理融合方案</button></>}
            {versionProposal && versionProposal.parent_experiment_id === detail.experiment.id && versionProposal.parent_ref === versionParent && versionProposal.research_question === versionGoal && <>
              <h3>待确认方案</h3><p>{versionProposal.research_question}</p>
              <h4>继承来源与取舍</h4><ul>{versionProposal.plan.sources.map((source: any) => <li key={source.experiment_id}>{source.experiment_id}：{source.decision === 'inherit' ? '继承' : '舍弃'} · {source.reason}<p>{source.ref}</p></li>)}</ul>
              <h4>新版本特性</h4><ul>{versionProposal.plan.features.map((feature: any) => <li key={feature.id}><strong>{feature.title}</strong><p>{feature.description}</p><p>{feature.change || '保留来源能力'} · {feature.source_refs.join('、') || '来源待说明'}</p></li>)}</ul>
              <h4>冲突处理</h4>{versionProposal.plan.conflicts.length ? <ul>{versionProposal.plan.conflicts.map((conflict: any, index: number) => <li key={index}>{conflict.description}：{conflict.resolution}</li>)}</ul> : <p>方案未发现需要业务取舍的冲突。</p>}
              <h4>验证范围</h4><ul>{versionProposal.plan.checks.map((check: any) => <li key={check.id}>{check.id}：{check.kind === 'build' ? `构建 ${check.command.join(' ')}` : check.kind === 'load' ? '实际 DSH Session 装载证据' : `能力评测 ${check.case_ids.join('、')}`}</li>)}</ul>
              <button type="button" onClick={() => void confirmVersion()}>确认方案并创建版本</button>
            </>}
          </section>}
          {launch && <section style={panel} aria-label="启动选中版本"><h2>启动 {launch.experiment_id}</h2>
            {launch.instances.length > 0 && <label style={field}>实例<select value={launch.selected} onChange={event => { changeLaunch({ ...launch, selected: event.target.value, preview: null, url: null }); setLaunchMessage('') }}>{launch.instances.map((item: any) => <option key={item.name} value={item.name}>{item.name} · {item.state}</option>)}<option value="">新建实例</option></select></label>}
            {!launch.selected && <><label style={field}>实例名称<input value={launchName} onChange={event => { setLaunchName(event.target.value); changeLaunch({ ...launch, preview: null }) }} /></label><label style={field}>端口（可留空自动分配）<input inputMode="numeric" value={launchPort} onChange={event => { setLaunchPort(event.target.value); changeLaunch({ ...launch, preview: null }) }} /></label></>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button type="button" disabled={launchBusy} onClick={() => void previewLaunch()}>{launch.instances.find((item: any) => item.name === launch.selected)?.state === 'running' ? '获取对话入口' : '预览启动'}</button><button type="button" onClick={() => changeLaunch(null)}>关闭</button></div>
            {launch.preview && <><pre className="harness-asset-content">{text(launch.preview)}</pre><button type="button" disabled={launchBusy} onClick={() => void confirmLaunch()}>确认启动</button></>}
            {launch.url && <p><a href={launch.url} target="_blank" rel="noreferrer">打开智能体对话</a></p>}
          </section>}
          {launchMessage && <p role="status">{launchMessage}</p>}
          {detail && <div role="tablist" aria-label="智能体详情" className="harness-agent-tabs" onKeyDown={event => {
            const index = tabs.findIndex(item => item.id === tab)
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
            if (next === undefined) return
            event.preventDefault()
            selectTab(tabs[next].id)
            document.getElementById(`agent-tab-${tabs[next].id}`)?.focus()
          }}>
            {tabs.map(item => <button key={item.id} type="button" role="tab" id={`agent-tab-${item.id}`}
              aria-controls={`agent-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
              onClick={() => selectTab(item.id)}>{item.label}</button>)}
          </div>}
          {detail && <section role="tabpanel" id="agent-panel-overview" aria-labelledby="agent-tab-overview" hidden={tab !== 'overview'} style={panel}>
            <div className="agent-section-heading"><h2>智能体概览</h2><button type="button" disabled={!onAssistant} onClick={() => void onAssistant?.('整理当前版本的用途与特性。', { page: 'agents', agent_id: selected, experiment_id: detail.experiment.id })}>请 AI 整理特性</button></div>
            <p>{detail.agent.manifest.description || detail.experiment.change.research_question || '用途尚未整理。'}</p>
            <div className="agent-stat-grid"><article><span>研究版本</span><strong>{detail.versions.length}</strong></article><article><span>所选版本 Run</span><strong>{versionRuns.length}</strong></article><article><span>所选版本实例</span><strong>{detail.loaded_instance.status === 'observed' ? instances.length : '—'}</strong><small>{detail.loaded_instance.status === 'observed' ? '最近一次实际观察' : '尚未取得实例观察'}</small></article></div>
            <h3>当前版本特性</h3>
            {detail.features?.length ? <div className="agent-feature-list">{detail.features.map((feature: any) => <article key={feature.id}><h4>{feature.title}</h4><p>{feature.description}</p>{feature.change && <p>本版本变化：{feature.change}</p>}<small>来源：{feature.source_refs.join('、') || '未记录'}</small></article>)}</div> : <p className="agent-empty">此版本尚未整理特性，可由 AI 根据当前资产和证据整理后确认保存。</p>}
            {featureProposal && featureProposal.experiment_id === detail.experiment.id && <section className="agent-notice" aria-label="确认智能体特性"><h3>待确认特性</h3><ul>{featureProposal.features.map((feature: any) => <li key={feature.id}><strong>{feature.title}</strong><p>{feature.description}</p><p>{feature.source_refs.join('、') || '未记录来源'} · {feature.evidence_refs.length ? feature.evidence_refs.join('、') : '尚无验证证据'}</p></li>)}</ul><button type="button" onClick={() => void confirmFeatures()}>确认并保存特性</button></section>}
            <h3>版本来源与继承</h3><Fields items={[
              ['所选研究版本', detail.experiment.id], ['研究状态', researchStatus(detail.experiment.status)], ['Baseline', detail.baseline.ref || '未知'], ['主父版本', detail.baseline.parent_experiment_id || '无'],
              ['融合来源', detail.fusion.experiments?.length ? detail.fusion.experiments : detail.fusion.status === 'unknown' ? '未声明融合来源' : detail.fusion.status], ['相关引用', detail.related_references ?? []],
            ]} />
          </section>}
          {detail && <section role="tabpanel" id="agent-panel-capabilities" aria-labelledby="agent-tab-capabilities" hidden={tab !== 'capabilities'} style={panel}>
            <div className="agent-section-heading"><h2>能力状态</h2><button type="button" disabled={!onNavigate} onClick={() => openEvaluation()}>查看评测证据</button></div>
            <p className="agent-muted">分别查看资产声明、实例装载观察和 Run 证据，按实际证据判断能力。</p>
            <div className="agent-evidence-stages"><article><span className="agent-badge">资产声明</span><h3>{detail.declared.source_contract.status === 'unavailable' ? '来源无法解析' : '已解析来源合同'}</h3><p>{detail.declared.source_contract.source_id || `experiment:${detail.experiment.id}`}</p></article><article><span className="agent-badge">实例装载</span><h3>{detail.loaded_instance.status === 'observed' ? `已观察 ${instances.length} 个实例` : '尚无装载观察'}</h3><p>{detail.loaded_instance.note || detail.loaded_instance.reason || '挂载观察不证明当前 Session 已调用能力。'}</p></article><article><span className="agent-badge">调用证据</span><h3>{versionRuns.length ? `${versionRuns.length} 条 Run 记录` : '尚无 Run'}</h3><p>具体能力与执行结果请在报告及轨迹中复核。</p></article></div>
            <h3>特性与关联证据</h3>{detail.features?.length ? <div className="agent-feature-list">{detail.features.map((feature: any) => <article key={feature.id}><h4>{feature.title}</h4><p>{feature.verification}</p>{feature.evidence.length ? <ul>{feature.evidence.map((evidence: any) => <li key={evidence.ref}><code>{evidence.ref}</code> · {evidence.present ? '引用存在，效果需复核' : '未找到证据'}</li>)}</ul> : <p>尚未记录验证证据。</p>}</article>)}</div> : <p>尚无已整理的特性。</p>}
            <details className="agent-source-details"><summary>来源与 Runtime 配置</summary><Fields items={[
              ['Candidate', detail.declared.catalog_source?.candidate_root], ['Profile', detail.declared.catalog_source?.profile], ['Preset', detail.declared.catalog_source?.preset],
              ['Patch', detail.declared.catalog_source?.patch], ['Guard', detail.declared.catalog_source?.guard ?? '无'], ['Runtime 版本', detail.declared.source_contract.image?.cli_version],
              ['镜像', detail.declared.source_contract.image?.local_image_tag], ['环境变量名称', detail.declared.catalog_source?.required_env_names],
            ]} /></details>
          </section>}
          {detail && <section role="tabpanel" id="agent-panel-runtime" aria-labelledby="agent-tab-runtime" hidden={tab !== 'runtime'} style={panel}>
            <div className="agent-section-heading"><h2>关联实例</h2><button type="button" disabled={!onNavigate} onClick={() => onNavigate?.({ page: 'instances', agent_id: selected, experiment_id: detail.experiment.id })}>实例管理</button></div>
            {detail.loaded_instance.status !== 'observed' && <p role="status">{detail.loaded_instance.note || detail.loaded_instance.reason || '尚未取得实际实例观察。'}</p>}
            {instances.length ? <div className="harness-table-scroll"><table aria-label="所选版本实例"><thead><tr><th>实例</th><th>观察状态</th><th>端口</th><th>镜像</th></tr></thead><tbody>{instances.map((instance: any) => <tr key={instance.name}><td>{instance.name}</td><td>{instance.state || '未知'}</td><td>{instance.port ?? '未记录'}</td><td>{instance.image_tag || '未记录'}</td></tr>)}</tbody></table></div> : detail.loaded_instance.status === 'observed' && <p className="agent-empty">未观察到所选版本的实例。</p>}
            <div className="agent-section-heading"><h2>近期 Run</h2><button type="button" disabled={!onNavigate} onClick={() => openEvaluation()}>进入评测中心</button></div>
            {versionRuns.length ? <div className="harness-table-scroll"><table aria-label="所选版本 Run"><thead><tr><th>Run</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{versionRuns.map((run: any) => <tr key={run.id ?? run.run_id}><td>{run.id ?? run.run_id}</td><td>{run.status || '未记录'}</td><td>{run.created_at ? new Date(run.created_at).toLocaleString() : '未记录'}</td><td><button type="button" disabled={!onNavigate} onClick={() => openEvaluation('runs', run.id ?? run.run_id)}>查看报告</button></td></tr>)}</tbody></table></div> : <p className="agent-empty">所选版本暂无 Run 记录。</p>}
          </section>}
          {detail && <section role="tabpanel" id="agent-panel-assets" aria-labelledby="agent-tab-assets" hidden={tab !== 'assets'} style={panel}>
            <div className="agent-section-heading"><h2 style={{ fontSize: 16, margin: '0 0 12px' }}>智能体资产</h2><button type="button" onClick={() => setDiffOpen(value => !value)}>{diffOpen ? '收起资产差异' : '查看资产差异'}</button></div>
            {diffOpen && <AssetDiffPanel key={detail.experiment.id} rpc={rpc} experimentId={detail.experiment.id} versions={detail.versions} baseline={detail.baseline} onClose={() => setDiffOpen(false)} />}
            <div className="harness-asset-layout">
              <nav aria-label="智能体资产目录"><AssetTree nodes={detail.assets ?? []} selected={editPath} onSelect={path => { if (path !== editPath && discardAssetDraft()) selectEditFile(path) }} /></nav>
              <article><h3>资产详情</h3><p>{editPath || '请选择资产'}</p>{/(^|\/)evaluation(?:\.md|\/|$)/.test(editPath) && <p><button type="button" disabled={!onNavigate} onClick={() => openEvaluation('cases')}>到评测中心管理用例</button></p>}{/(^|\/)decision\.md$/.test(editPath) && <p><button type="button" disabled={!onNavigate} onClick={() => openEvaluation('compare')}>到评测中心比较结果与记录决策</button></p>}
                {assetInfo && <>
                  <Fields items={[['类型', assetInfo.kind === 'directory' ? '目录' : assetInfo.kind === 'text' ? '文本' : '二进制或大文件（只读）'], ['大小（字节）', assetInfo.size], ['SHA-256', assetInfo.sha256]]} />
                  {assetInfo.kind === 'text' && <><button type="button" disabled={!editHash} onClick={() => { setEditMessage(''); setEditOpen(true) }}>编辑</button><pre className="harness-asset-content">{assetInfo.content || '空文件'}</pre></>}
                  {assetInfo.kind === 'directory' && <p>展开左侧目录后选择文件。</p>}
                </>}
                {editMessage && <p role="status">{editMessage}</p>}
              </article>
            </div>
          </section>}
          <dialog ref={editDialog} className="harness-asset-dialog" aria-labelledby="asset-edit-title" onCancel={event => { event.preventDefault(); closeEditor() }}>
            <h2 id="asset-edit-title">编辑资产</h2><p>{editPath}</p>
            <p>应用保存会先进行 dry 校验，再核对文件是否被他人修改。dry 不执行模型、业务工具或 Candidate 代码。</p>
            <label style={field}>编辑正文
              <textarea value={editBody} disabled={!editHash || editBusy} onChange={event => { editRequest.current++; setEditBody(event.target.value); setEditPreview(null); setEditMessage('') }} rows={12} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => { if (discardAssetDraft()) void loadEditFile() }} disabled={editBusy}>重读文件</button>
              <button type="button" onClick={() => void doPreview()} disabled={!editHash || editBusy}>dry 校验与预览</button>
              <button type="button" onClick={() => void doApply()} disabled={!editHash || editBusy}>应用保存</button>
              <button type="button" onClick={closeEditor} disabled={editBusy}>关闭</button>
            </div>
            {editBusy && <p role="status">正在进行 dry 校验…</p>}
            {editMessage && <p role="status">{editMessage}</p>}
            {editPreview && <><p>校验通过：{editPreview.dry.checks.join('、')} · 评测用例 {editPreview.dry.case_ids.length} 个。</p>
              {editPreview.dry.missing_env_names?.length > 0 && <p>运行前需补齐环境变量：{editPreview.dry.missing_env_names.join('、')}。当前 dry 可继续。</p>}
              <pre className="harness-asset-content">{editPreview.diff}</pre></>}
          </dialog>
        </section>
      </section>
      {createOpen && <CreateAgentDialog rpc={rpc} active={active} onClose={() => setCreateOpen(false)} onCreated={() => { void refreshList() }} onSelect={receipt => { if (selectVersion(receipt.agent_id, receipt.experiment_id)) setCreateOpen(false) }} />}
    </div>
  </main>
}
