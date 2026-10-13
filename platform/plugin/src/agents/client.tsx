import { useEffect, useMemo, useState } from 'react'
import { CHANNEL } from '../protocol.ts'
import type { PlatformPageProps } from '../protocol.ts'

type RpcResult = { ok: true; value: any } | { ok: false; error: { code: string; message: string; details?: any } }
type AgentRow = { id: string; active_experiment?: string | null }
type PreviewState = { path: string; body: string; before: string; diff: string }

const panel = {
  border: '1px solid var(--dsw-alias-border-l4, #d1d5db)',
  borderRadius: 8,
  padding: 16,
  background: 'var(--dsw-alias-bg-layer-1, transparent)',
} as const

function text(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

const field = { display: 'grid', gap: 4 } as const

export function AgentsPage({ rpc }: PlatformPageProps) {
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [selected, setSelected] = useState('')
  const [selectedExperiment, setSelectedExperiment] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [error, setError] = useState('')
  const [editPath, setEditPath] = useState('')
  const [editBody, setEditBody] = useState('')
  const [editHash, setEditHash] = useState('')
  const [editPreview, setEditPreview] = useState<PreviewState | null>(null)
  const [editMessage, setEditMessage] = useState('')
  const [mode, setMode] = useState('fast')
  const [executor, setExecutor] = useState('api')
  const [review, setReview] = useState('none')
  const [selectedCases, setSelectedCases] = useState<string[]>([])
  const [evalResult, setEvalResult] = useState('')
  const [jobId, setJobId] = useState('')
  const [runId, setRunId] = useState('')
  const [caseId, setCaseId] = useState('')
  const [leftRun, setLeftRun] = useState('')
  const [rightRun, setRightRun] = useState('')
  const [runsIndex, setRunsIndex] = useState('')
  const [decisionBody, setDecisionBody] = useState('')
  const [decisionHash, setDecisionHash] = useState('')
  const selectedAgent = useMemo(() => agents.find(agent => agent.id === selected), [agents, selected])

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
    setError('')
    try {
      const payload = experimentId ? { agent_id: agentId, experiment_id: experimentId } : { agent_id: agentId }
      const value = await call('detail', payload)
      setDetail(value)
      setSelectedExperiment(value.experiment.id)
      setDecisionBody(value.decision?.content ?? '')
      setDecisionHash(value.decision?.sha256 ?? '')
      setSelectedCases((current) => current.filter(caseItem => value.evaluation.cases.some((item: any) => item.id === caseItem)))
      if (!editPath || !value.editable_files.includes(editPath)) setEditPath(value.editable_files[0] ?? '')
      setEditMessage('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function loadEditFile(path = editPath) {
    if (!detail || !path) return
    setError('')
    try {
      const value = await call('edit/read', { experiment_id: detail.experiment.id, path })
      setEditPath(value.path)
      setEditBody(value.content)
      setEditHash(value.sha256)
      setEditPreview(null)
      setEditMessage('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => { void refreshList() }, [])
  useEffect(() => { void refreshDetail(selected, selectedExperiment) }, [selected, selectedExperiment])
  useEffect(() => { void loadEditFile(editPath) }, [detail?.experiment?.id, editPath])

  async function createExperiment() {
    if (!selectedAgent?.active_experiment || !detail) return
    const parent = window.prompt('父版本 git:<40位commit> 或 release:<id>')
    if (!parent) return
    const researchQuestion = window.prompt('真实用户研究问题')
    if (!researchQuestion) return
    try {
      const value = await call('create', {
        agent_id: selected,
        parent_ref: parent,
        parent_experiment_id: detail.experiment.id,
        catalog_sha256: detail.declared?.source_catalog_sha256,
        research_question: researchQuestion,
      })
      await refreshList()
      setSelectedExperiment(value.experiment_id)
      await refreshDetail(selected, value.experiment_id)
      setEditMessage(`已创建 ${value.experiment_id}`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doPreview() {
    if (!detail || !editPath) return
    try {
      const value = await call('edit/preview', {
        experiment_id: detail.experiment.id,
        edits: [{ path: editPath, content: editBody, expected_sha256: editHash }],
      })
      const row = value.edits?.[0]
      setEditPreview({ path: row.path, body: editBody, before: row.before_sha256, diff: row.diff || '无变化' })
      setEditMessage('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doApply() {
    if (!detail || !editPreview) return
    if (editPreview.body !== editBody || editPreview.path !== editPath) {
      setError('正文已变更，请重新预览后写入')
      return
    }
    try {
      const value = await call('edit/apply', {
        experiment_id: detail.experiment.id,
        edits: [{ path: editPath, content: editBody, expected_sha256: editPreview.before }],
      })
      setEditMessage(`已写入 ${value.written?.[0]?.path}`)
      setEditPreview(null)
      await refreshDetail()
      await loadEditFile(editPath)
    } catch (err) {
      setError((err as Error).message)
    }
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
    if (!selected) return
    try {
      const value = await call('runs/index', { agent_id: selected })
      setRunsIndex(text(value))
    } catch (err) {
      setRunsIndex((err as Error).message)
    }
  }

  async function showRun() {
    if (!runId) return
    try {
      const value = await call('runs/show', { run_id: runId, case_id: caseId || undefined })
      setEvalResult(text(value))
    } catch (err) {
      setEvalResult((err as Error).message)
    }
  }

  async function compareRuns() {
    if (!leftRun || !rightRun) return
    try {
      const value = await call('runs/compare', { left: leftRun, right: rightRun, case_id: caseId || undefined })
      setEvalResult(text(value))
    } catch (err) {
      setEvalResult((err as Error).message)
    }
  }

  async function saveDecision() {
    if (!detail) return
    try {
      const value = await call('decision/update', { experiment_id: detail.experiment.id, content: decisionBody, expected_sha256: decisionHash })
      setDecisionHash(value.sha256)
      await refreshDetail()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const runOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const version of detail?.versions ?? []) for (const run of version.runs ?? []) ids.add(run.run_id ?? run.id)
    for (const run of detail?.verification?.runs ?? []) ids.add(run.id)
    return [...ids].filter(Boolean).sort()
  }, [detail])

  return <main style={{ height: '100%', overflow: 'auto', padding: '24px clamp(16px, 3vw, 36px)', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gap: 16 }}>
      <header style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, margin: 0, overflowWrap: 'anywhere' }}>智能体研究版本</h1>
        <button type="button" onClick={() => void refreshList()}>刷新</button>
      </header>
      {error && <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #c2410c)', margin: 0 }}>{error}</p>}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 16 }}>
        <aside style={panel}>
          <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Agent</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {agents.map(agent => <button key={agent.id} type="button" onClick={() => { setSelected(agent.id); setSelectedExperiment('') }}
              style={{ textAlign: 'left', padding: 10, borderRadius: 6, border: agent.id === selected ? '2px solid currentColor' : '1px solid var(--dsw-alias-border-l3, #d1d5db)', background: 'transparent', color: 'inherit' }}>
              <strong>{agent.id}</strong>
              <small style={{ display: 'block', opacity: 0.7 }}>{agent.active_experiment || '无 active_experiment'}</small>
            </button>)}
          </div>
        </aside>
        <section style={{ display: 'grid', gap: 16 }}>
          {detail && <section style={panel}>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: '0 0 6px', fontSize: 18, overflowWrap: 'anywhere' }}>{detail.experiment.id}</h2>
                <select aria-label="版本" value={selectedExperiment} onChange={event => setSelectedExperiment(event.target.value)}>
                  {detail.versions.map((version: any) => <option key={version.id} value={version.id}>{version.id}</option>)}
                </select>
                <div style={{ opacity: 0.75, marginTop: 8 }}>Baseline：{detail.baseline.ref || '未知'} · Parent：{detail.baseline.parent_experiment_id || '无'}</div>
                <div style={{ opacity: 0.75 }}>Fusion：{detail.fusion.status}{detail.fusion.experiments?.length ? ` ${detail.fusion.experiments.join(', ')}` : ''}</div>
                <div style={{ opacity: 0.75 }}>相关引用：{detail.related_references?.join(', ') || '无'} · 实例装载：{detail.loaded_instance.status}</div>
              </div>
              <button type="button" onClick={() => void createExperiment()}>新建 Experiment</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 14 }}>
              <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', margin: 0 }}>Features{'\n'}{text(detail.features)}</pre>
              <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', margin: 0 }}>Declared{'\n'}{text(detail.declared)}</pre>
              <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', margin: 0 }}>Loaded{'\n'}{text(detail.loaded_instance)}</pre>
              <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', margin: 0 }}>Run 证据{'\n'}{text(detail.verification.runs)}</pre>
            </div>
          </section>}
          {detail && <section style={panel}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>资产编辑</h2>
            <label style={field}>编辑文件
              <select value={editPath} onChange={event => setEditPath(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }}>
                {detail.editable_files.map((file: string) => <option key={file} value={file}>{file}</option>)}
              </select>
            </label>
            <label style={field}>编辑正文
              <textarea value={editBody} onChange={event => { setEditBody(event.target.value); setEditPreview(null); setEditMessage('') }} rows={10} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" onClick={() => void loadEditFile()}>重读</button>
              <button type="button" onClick={() => void doPreview()}>预览差异</button>
              <button type="button" onClick={() => void doApply()} disabled={!editPreview}>写入</button>
            </div>
            {editMessage && <p>{editMessage}</p>}
            {editPreview && <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{editPreview.diff}</pre>}
          </section>}
          {detail && <section style={panel}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>评测与 Run</h2>
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
              <button type="button" onClick={loadRuns}>Run 索引</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              {detail.evaluation.cases.map((item: any) => <label key={item.id} style={{ border: '1px solid var(--dsw-alias-border-l3, #d1d5db)', borderRadius: 6, padding: '4px 8px' }}>
                <input type="checkbox" checked={selectedCases.includes(item.id)} onChange={event => setSelectedCases(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} /> {item.id}
              </label>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              <label style={field}>Run
                <input value={runId} onChange={event => setRunId(event.target.value)} list="run-options" placeholder="run-..." />
              </label>
              <label style={field}>Case
                <input value={caseId} onChange={event => setCaseId(event.target.value)} placeholder="Case ID" />
              </label>
              <button type="button" onClick={showRun}>查看 Run/Case</button>
              <label style={field}>左侧 Run
                <input value={leftRun} onChange={event => setLeftRun(event.target.value)} list="run-options" placeholder="left run" />
              </label>
              <label style={field}>右侧 Run
                <input value={rightRun} onChange={event => setRightRun(event.target.value)} list="run-options" placeholder="right run" />
              </label>
              <button type="button" onClick={compareRuns}>左右对照</button>
            </div>
            <datalist id="run-options">{runOptions.map(id => <option key={id} value={id} />)}</datalist>
            {runsIndex && <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{runsIndex}</pre>}
            {evalResult && <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto' }}>{evalResult}</pre>}
          </section>}
          {detail && <section style={panel}>
            <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Decision</h2>
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
