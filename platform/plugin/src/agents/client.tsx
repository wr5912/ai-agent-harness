import { useEffect, useMemo, useRef, useState } from 'react'
import { CHANNEL } from '../protocol.ts'
import type { PlatformPageProps } from '../protocol.ts'

type RpcResult = { ok: true; value: any } | { ok: false; error: { code: string; message: string; details?: any } }
type AgentRow = { id: string; active_experiment?: string | null }
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

const field = { display: 'grid', minWidth: 0, gap: 4 } as const
const tabs = [
  { id: 'overview', label: '基本信息' },
  { id: 'assets', label: '资产' },
  { id: 'evaluation', label: '评测' },
] as const

export function AgentsPage({ rpc }: PlatformPageProps) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [selected, setSelected] = useState('')
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
  const [mode, setMode] = useState('fast')
  const [executor, setExecutor] = useState('api')
  const [review, setReview] = useState('none')
  const [selectedCases, setSelectedCases] = useState<string[]>([])
  const [evalResult, setEvalResult] = useState('')
  const [jobId, setJobId] = useState('')
  const [runId, setRunId] = useState('')
  const [caseId, setCaseId] = useState('')
  const [evidenceFile, setEvidenceFile] = useState('trace.jsonl')
  const [leftRun, setLeftRun] = useState('')
  const [rightRun, setRightRun] = useState('')
  const [runs, setRuns] = useState<any[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState('')
  const [runCases, setRunCases] = useState<string[]>([])
  const runsRequest = useRef(0)
  const runRequest = useRef(0)
  const [decisionBody, setDecisionBody] = useState('')
  const [decisionHash, setDecisionHash] = useState('')
  const detailRequest = useRef(0)
  const editRequest = useRef(0)
  const selectedAgent = useMemo(() => agents.find(agent => agent.id === selected), [agents, selected])

  function selectVersion(agentId: string, experimentId = '') {
    if (agentId === selected && experimentId === selectedExperiment) return
    detailRequest.current++
    if (agentId !== selected) setTab('overview')
    setSelected(agentId)
    setSelectedExperiment(experimentId)
    setDetail(null)
    selectEditFile('')
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
      setDecisionBody(value.decision?.content ?? '')
      setDecisionHash(value.decision?.sha256 ?? '')
      setSelectedCases((current) => current.filter(caseItem => value.evaluation.cases.some((item: any) => item.id === caseItem)))
      const containsPath = (nodes: AssetNode[]): boolean => nodes.some(node => node.path === editPath || (node.children && containsPath(node.children)))
      if (!containsPath(value.assets ?? [])) selectEditFile(value.assets?.[0]?.path ?? '')
      setEditMessage('')
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
  useEffect(() => { void loadEditFile(editPath) }, [detail?.experiment?.id, editPath])
  useEffect(() => {
    if (editOpen) editDialog.current?.showModal()
    else editDialog.current?.close()
  }, [editOpen])

  async function createExperiment() {
    if (!selectedAgent?.active_experiment || !detail) return
    const parent = window.prompt('父版本 git:<40位commit> 或 release:<id>')
    if (!parent) return
    const researchQuestion = window.prompt('真实用户研究问题')
    if (!researchQuestion) return
    const request = detailRequest.current
    try {
      const value = await call('create', {
        agent_id: selected,
        parent_ref: parent,
        parent_experiment_id: detail.experiment.id,
        catalog_sha256: detail.declared?.source_catalog_sha256,
        research_question: researchQuestion,
      })
      if (request !== detailRequest.current) return
      await refreshList()
      if (request !== detailRequest.current) return
      selectVersion(selected, value.experiment_id)
      setEditMessage(`已创建 ${value.experiment_id}`)
    } catch (err) {
      if (request === detailRequest.current) setError((err as Error).message)
    }
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

  function evalPayload() {
    return {
      source: `experiment:${detail.experiment.id}`,
      mode,
      executor,
      review,
      cases: selectedCases.length ? selectedCases : undefined,
    }
  }

  async function evalPreview() {
    if (!detail) return
    try {
      const value = await call('eval/preview', evalPayload())
      setEvalResult(text(value.result))
    } catch (err) {
      setEvalResult((err as Error).message)
    }
  }

  async function evalStart() {
    if (!detail) return
    try {
      const value = await call('eval/start', evalPayload())
      setJobId(value.job_id)
      setEvalResult(text(value))
    } catch (err) {
      setEvalResult((err as Error).message)
    }
  }

  async function evalStatus() {
    if (!jobId) return
    try {
      const value = await call('eval/status', { job_id: jobId })
      setEvalResult(text(value))
    } catch (err) {
      setEvalResult((err as Error).message)
    }
  }

  async function evalCancel() {
    if (!jobId) return
    try {
      const value = await call('eval/cancel', { job_id: jobId })
      setEvalResult(text(value))
    } catch (err) {
      setEvalResult((err as Error).message)
    }
  }

  async function loadRuns() {
    const request = ++runsRequest.current
    if (!selected) return
    setRunsLoading(true)
    setRunsError('')
    try {
      const value = await call('runs/index', { agent_id: selected })
      if (request !== runsRequest.current) return
      setRuns((value.experiments ?? []).flatMap((experiment: any) =>
        (experiment.runs ?? []).map((run: any) => ({ ...run, experiment_id: experiment.experiment_id ?? experiment.id }))))
    } catch (err) {
      if (request === runsRequest.current) setRunsError((err as Error).message)
    } finally {
      if (request === runsRequest.current) setRunsLoading(false)
    }
  }

  useEffect(() => {
    setRuns([])
    setRunId('')
    setCaseId('')
    setRunCases([])
    setEvalResult('')
    runRequest.current++
    void loadRuns()
    return () => { runsRequest.current++; runRequest.current++ }
  }, [selected])

  function chooseRun(id: string) {
    runRequest.current++
    setRunId(id)
    setCaseId('')
    setRunCases([])
    setEvalResult('')
  }

  async function showRun() {
    if (!runId) return
    const request = ++runRequest.current
    try {
      const value = await call('runs/show', { run_id: runId })
      if (request !== runRequest.current) return
      const ids = (value.cases ?? []).map((item: any) => item.case_id)
      setRunCases(ids)
      setCaseId(current => ids.includes(current) ? current : ids[0] ?? '')
      setEvalResult(text(value))
    } catch (err) {
      if (request === runRequest.current) setEvalResult((err as Error).message)
    }
  }

  async function showEvidence() {
    const request = ++runRequest.current
    try {
      const value = await call('runs/evidence', { run_id: runId, case_id: caseId, filename: evidenceFile })
      if (request !== runRequest.current) return
      setEvalResult(`${value.path}${value.truncated ? '（仅显示前 64 KiB）' : ''}\n${value.content}`)
    } catch (err) {
      if (request === runRequest.current) setEvalResult((err as Error).message)
    }
  }

  async function compareRuns() {
    if (!leftRun || !rightRun) return
    const request = ++runRequest.current
    try {
      const value = await call('runs/compare', { left: leftRun, right: rightRun, case_id: caseId || undefined })
      if (request === runRequest.current) setEvalResult(text(value))
    } catch (err) {
      if (request === runRequest.current) setEvalResult((err as Error).message)
    }
  }

  async function saveDecision() {
    if (!detail) return
    const request = detailRequest.current
    try {
      const value = await call('decision/update', { experiment_id: detail.experiment.id, content: decisionBody, expected_sha256: decisionHash })
      if (request !== detailRequest.current) return
      setDecisionHash(value.sha256)
      await refreshDetail()
    } catch (err) {
      if (request === detailRequest.current) setError((err as Error).message)
    }
  }

  const runOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const run of runs) ids.add(run.run_id ?? run.id)
    for (const version of detail?.versions ?? []) for (const run of version.runs ?? []) ids.add(run.run_id ?? run.id)
    for (const run of detail?.verification?.runs ?? []) ids.add(run.id)
    return [...ids].filter(Boolean).sort()
  }, [detail, runs])

  return <main className="harness-agents">
    <div style={{ minWidth: 0, display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, margin: 0, overflowWrap: 'anywhere' }}>智能体研究版本</h1>
        <button type="button" onClick={() => void refreshList()}>刷新</button>
      </header>
      {error && <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #c2410c)', margin: 0 }}>{error}</p>}
      <section className="harness-agent-layout">
        <aside className="harness-agent-list" style={panel}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Agent</h2>
          <div className="harness-agent-list-options">
            {agents.map(agent => <button key={agent.id} type="button" onClick={() => selectVersion(agent.id)}
              aria-pressed={agent.id === selected}
              style={{ textAlign: 'left', padding: 10, borderRadius: 6, border: agent.id === selected ? '2px solid currentColor' : '1px solid var(--dsw-alias-border-l3, #d1d5db)', background: 'transparent', color: 'inherit' }}>
              <strong>{agent.id}</strong>
            </button>)}
          </div>
        </aside>
        <section className="harness-agent-detail" style={{ display: 'grid', minWidth: 0, gap: 16 }}>
          {!detail && !error && <p role="status">正在读取智能体与评估…</p>}
          {detail && <section style={panel}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 18, overflowWrap: 'anywhere' }}>{detail.experiment.id}</h2>
                <select aria-label="版本" style={{ maxWidth: '100%' }} value={selectedExperiment || detail.experiment.id} onChange={event => selectVersion(selected, event.target.value)}>
                  {detail.versions.map((version: any) => <option key={version.id} value={version.id}>{version.id}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => void createExperiment()}>新建 Experiment</button>
            </div>
          </section>}
          {detail && <div role="tablist" aria-label="智能体详情" className="harness-agent-tabs" onKeyDown={event => {
            const index = tabs.findIndex(item => item.id === tab)
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
            if (next === undefined) return
            event.preventDefault()
            setTab(tabs[next].id)
            document.getElementById(`agent-tab-${tabs[next].id}`)?.focus()
          }}>
            {tabs.map(item => <button key={item.id} type="button" role="tab" id={`agent-tab-${item.id}`}
              aria-controls={`agent-panel-${item.id}`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}>{item.label}</button>)}
          </div>}
          {detail && <section role="tabpanel" id="agent-panel-overview" aria-labelledby="agent-tab-overview" hidden={tab !== 'overview'} style={panel}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>智能体基本信息</h2>
            <div style={{ opacity: 0.75 }}>Baseline：{detail.baseline.ref || '未知'} · Parent：{detail.baseline.parent_experiment_id || '无'}</div>
            <div style={{ opacity: 0.75 }}>Fusion：{detail.fusion.status}{detail.fusion.experiments?.length ? ` ${detail.fusion.experiments.join(', ')}` : ''}</div>
            <div style={{ opacity: 0.75 }}>相关引用：{detail.related_references?.join(', ') || '无'} · 实例装载：{detail.loaded_instance.status}</div>
            <div style={{ opacity: 0.75 }}>登记版本：{selectedAgent?.active_experiment || '未登记'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 12, marginTop: 14 }}>
              <article><h3>来源与 Runtime</h3><Fields items={[
                ['来源', detail.declared.source_contract.source_id || `experiment:${detail.experiment.id}`],
                ['合同状态', detail.declared.source_contract.status === 'unavailable' ? '无法解析' : '已解析'],
                ['Candidate', detail.declared.catalog_source?.candidate_root],
                ['Profile', detail.declared.catalog_source?.profile], ['Preset', detail.declared.catalog_source?.preset],
                ['Patch', detail.declared.catalog_source?.patch], ['Guard', detail.declared.catalog_source?.guard ?? '无'],
                ['Runtime 版本', detail.declared.source_contract.image?.cli_version], ['镜像', detail.declared.source_contract.image?.local_image_tag],
                ['环境变量', detail.declared.catalog_source?.required_env_names],
              ]} /></article>
              <article><h3>实例观察</h3><p>{detail.loaded_instance.status === 'observed' ? '已查询' : detail.loaded_instance.status === 'not_queried' ? '尚未查询' : '观察失败，状态未知'}</p>
                {(detail.loaded_instance.instances ?? []).map((instance: any) => <Fields key={instance.name} items={[
                  ['实例', instance.name], ['状态', instance.state], ['镜像', instance.image_tag], ['端口', instance.port],
                  ['只读挂载', Object.entries(instance.mount_modes ?? {}).map(([name, mode]) => `${name}：${mode}`)],
                ]} />)}
                {detail.loaded_instance.status === 'observed' && !detail.loaded_instance.instances?.length && <p>未观察到该版本的实例。</p>}
                <p>{detail.loaded_instance.note || detail.loaded_instance.reason}</p>
              </article>
              <article><h3>Run 证据</h3>{detail.verification.runs.length ? <ul>{detail.verification.runs.map((run: any) => <li key={run.id}><button type="button" onClick={() => { setTab('evaluation'); setRunId(run.id) }}>{run.id}</button></li>)}</ul> : <p>暂无 Run 记录。</p>}
                <p>可在评测页查看原始记录；来源声明和实例挂载不证明能力已生效。</p></article>
            </div>
          </section>}
          {detail && <section role="tabpanel" id="agent-panel-assets" aria-labelledby="agent-tab-assets" hidden={tab !== 'assets'} style={panel}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>智能体资产</h2>
            <div className="harness-asset-layout">
              <nav aria-label="智能体资产目录"><AssetTree nodes={detail.assets ?? []} selected={editPath} onSelect={path => { if (path !== editPath) selectEditFile(path) }} /></nav>
              <article><h3>资产详情</h3><p>{editPath || '请选择资产'}</p>
                {assetInfo && <>
                  <Fields items={[['类型', assetInfo.kind === 'directory' ? '目录' : assetInfo.kind === 'text' ? '文本' : '二进制或大文件（只读）'], ['大小（字节）', assetInfo.size], ['SHA-256', assetInfo.sha256]]} />
                  {assetInfo.kind === 'text' && <><button type="button" disabled={!editHash} onClick={() => { setEditMessage(''); setEditOpen(true) }}>编辑</button><pre className="harness-asset-content">{assetInfo.content || '空文件'}</pre></>}
                  {assetInfo.kind === 'directory' && <p>展开左侧目录后选择文件。</p>}
                </>}
                {editMessage && <p role="status">{editMessage}</p>}
              </article>
            </div>
          </section>}
          <dialog ref={editDialog} className="harness-asset-dialog" aria-labelledby="asset-edit-title" onCancel={event => { if (editBusy) event.preventDefault(); else setEditOpen(false) }}>
            <h2 id="asset-edit-title">编辑资产</h2><p>{editPath}</p>
            <p>应用保存会先进行 dry 校验，再核对文件是否被他人修改。dry 不执行模型、业务工具或 Candidate 代码。</p>
            <label style={field}>编辑正文
              <textarea value={editBody} disabled={!editHash || editBusy} onChange={event => { editRequest.current++; setEditBody(event.target.value); setEditPreview(null); setEditMessage('') }} rows={12} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => void loadEditFile()} disabled={editBusy}>重读文件</button>
              <button type="button" onClick={() => void doPreview()} disabled={!editHash || editBusy}>dry 校验与预览</button>
              <button type="button" onClick={() => void doApply()} disabled={!editHash || editBusy}>应用保存</button>
              <button type="button" onClick={() => setEditOpen(false)} disabled={editBusy}>关闭</button>
            </div>
            {editBusy && <p role="status">正在进行 dry 校验…</p>}
            {editMessage && <p role="status">{editMessage}</p>}
            {editPreview && <><p>校验通过：{editPreview.dry.checks.join('、')} · 评测用例 {editPreview.dry.case_ids.length} 个。</p>
              {editPreview.dry.missing_env_names?.length > 0 && <p>运行前需补齐环境变量：{editPreview.dry.missing_env_names.join('、')}。当前 dry 可继续。</p>}
              <pre className="harness-asset-content">{editPreview.diff}</pre></>}
          </dialog>
          {detail && <section role="tabpanel" id="agent-panel-evaluation" aria-labelledby="agent-tab-evaluation" hidden={tab !== 'evaluation'} style={panel}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>评测</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <label style={field}>模式
                <select value={mode} onChange={event => setMode(event.target.value)}>
                  <option value="fast">fast</option>
                  <option value="full">full</option>
                </select>
              </label>
              <label style={field}>执行器
                <select value={executor} onChange={event => setExecutor(event.target.value)}>
                  <option value="api">api</option>
                  <option value="browser">browser</option>
                </select>
              </label>
              <label style={field}>评审
                <select value={review} onChange={event => setReview(event.target.value)}>
                  <option value="none">none</option>
                  <option value="ai">ai</option>
                </select>
              </label>
              <button type="button" onClick={evalPreview}>执行预览</button>
              <button type="button" onClick={evalStart}>启动评测</button>
              <button type="button" onClick={evalStatus} disabled={!jobId}>刷新状态</button>
              <button type="button" onClick={evalCancel} disabled={!jobId}>取消</button>
              <button type="button" onClick={loadRuns} disabled={runsLoading}>{runsLoading ? '读取 Run…' : '刷新 Run 记录'}</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {detail.evaluation.cases.map((item: any) => <label key={item.id} style={{ border: '1px solid var(--dsw-alias-border-l3, #d1d5db)', borderRadius: 6, padding: '4px 8px' }}>
                <input type="checkbox" checked={selectedCases.includes(item.id)} onChange={event => setSelectedCases(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /> {item.id}
              </label>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 8 }}>
              <label style={field}>Run
                <input value={runId} onChange={event => chooseRun(event.target.value)} list="run-options" placeholder="run-..." />
              </label>
              <label style={field}>Case
                <select aria-label="Run Case" value={caseId} onChange={event => setCaseId(event.target.value)} disabled={!runCases.length}>
                  <option value="">先读取 Run</option>{runCases.map(id => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
              <button type="button" onClick={showRun}>查看 Run/Case</button>
              <label style={field}>轨迹文件
                <select value={evidenceFile} onChange={event => setEvidenceFile(event.target.value)}>
                  {['trace.jsonl', 'tools.jsonl', 'judge-trace.jsonl', 'response.json', 'checks.json', 'judge.json'].map(name => <option key={name}>{name}</option>)}
                </select>
              </label>
              <button type="button" onClick={showEvidence} disabled={!runId || !caseId}>查看轨迹</button>
              <label style={field}>左侧 Run
                <input value={leftRun} onChange={event => setLeftRun(event.target.value)} list="run-options" placeholder="left run" />
              </label>
              <label style={field}>右侧 Run
                <input value={rightRun} onChange={event => setRightRun(event.target.value)} list="run-options" placeholder="right run" />
              </label>
              <button type="button" onClick={compareRuns}>左右对照</button>
            </div>
            <datalist id="run-options">{runOptions.map(id => <option key={id} value={id} />)}</datalist>
            {runsError && <p role="alert">{runsError}</p>}
            {!runsLoading && !runsError && runs.length === 0 && <p>此智能体尚无 Run 记录。</p>}
            {runs.length > 0 && <div className="harness-table-scroll"><table aria-label="Run 记录"><thead><tr><th>Run</th><th>研究版本</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>{runs.map(run => <tr key={run.id ?? run.run_id}>
                <td>{run.id ?? run.run_id}</td><td>{run.experiment_id}</td><td>{run.status ?? '未记录'}</td>
                <td>{run.created_at ? new Date(run.created_at).toLocaleString() : '未记录'}</td>
                <td><button type="button" onClick={() => chooseRun(run.id ?? run.run_id)}>选择 Run</button></td>
              </tr>)}</tbody></table></div>}
            {evalResult && <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{evalResult}</pre>}
            <h2 style={{ fontSize: 16, margin: '20px 0 12px' }}>Decision</h2>
            <label style={field}>Decision 正文
              <textarea value={decisionBody} onChange={event => setDecisionBody(event.target.value)} rows={8} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
            </label>
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={saveDecision}>保存 Decision</button>
            </div>
          </section>}
        </section>
      </section>
    </div>
  </main>
}
