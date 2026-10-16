import { useEffect, useRef, useState } from 'react'
import { CHANNEL, type PlatformPageProps } from '../protocol.ts'
import type { PlatformUpdates } from '../realtime/client.ts'

type Draft = { question: string; basis: string; group: string; split: string; decisionTimeReviewed: boolean }
const draftOf = (record: any): Draft => ({ question: JSON.stringify(record.questions.decision, null, 2), basis: record._meta.label_basis, group: record._meta.group_id, split: record._meta.split, decisionTimeReviewed: record._meta.decision_time_reviewed === true })
const status: Record<string, string> = { suggested: '待复核', reviewed: '已复核', rejected: '已排除' }
const time = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString()
export function DecisionDatasetView({ rpc, runId, active, updates, onDirty, onBusy }: PlatformPageProps & { runId: string; active: boolean; updates?: PlatformUpdates; onDirty?(dirty: boolean): void; onBusy?(busy: boolean): void }) {
  const [list, setList] = useState<any[]>([]), [id, setId] = useState(''), [document, setDocument] = useState<any>(null), [recordId, setRecordId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0), refreshSequence = useRef(0), current = useRef({ runId, id, recordId, dirty: false, busy: false, sha256: '' })
  const record = document?.dataset?.records?.find((entry: any) => entry._meta.id === recordId)
  const dirty = !!record && !!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(record))
  current.current = { runId, id, recordId, dirty, busy, sha256: document?.sha256 ?? '' }
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false) }, [dirty])
  useEffect(() => { onBusy?.(busy); return () => onBusy?.(false) }, [busy])
  async function call(action: string, input: Record<string, unknown>) {
    const result = await rpc.call(CHANNEL, `agents/datasets/${action}`, input) as any
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  async function refresh() {
    const target = current.current.runId
    const refreshId = ++refreshSequence.current
    const request = generation.current, selectedId = current.current.id
    try {
      const value = await call('list', { run_id: target })
      if (current.current.runId !== target || request !== generation.current || refreshId !== refreshSequence.current) return
      setList(value.datasets)
      if (selectedId && !current.current.busy) {
        const latest = await call('read', { dataset_id: selectedId })
        if (current.current.runId !== target || request !== generation.current || refreshId !== refreshSequence.current || current.current.id !== selectedId || current.current.busy) return
        if (current.current.dirty) { if (latest.sha256 !== current.current.sha256) setError('样本已在其他窗口修改；当前草稿保留。请核对后重新读取本批次。'); return }
        const selected = latest.dataset.records.find((entry: any) => entry._meta.id === current.current.recordId) ?? latest.dataset.records[0]
        setDocument(latest); setRecordId(selected?._meta.id ?? ''); setDraft(selected ? draftOf(selected) : null)
      }
    }
    catch (e) { if (current.current.runId === target && request === generation.current && refreshId === refreshSequence.current) setError((e as Error).message) }
  }
  useEffect(() => { generation.current++; setId(''); setDocument(null); setRecordId(''); setDraft(null); setList([]); setError(''); setMessage(''); return () => { generation.current++ } }, [runId])
  useEffect(() => { if (active && runId) void refresh() }, [active, runId])
  useEffect(() => updates?.subscribe(() => { if (active && updates.getSnapshot().domains.includes('agents')) void refresh() }), [updates, active, runId])
  async function open(next: string) {
    if (busy || dirty && !window.confirm('样本有未保存的修改，丢弃后切换？')) return
    const request = ++generation.current
    setId(next); setDocument(null); setDraft(null); setError(''); setMessage('')
    if (!next) return
    try { const value = await call('read', { dataset_id: next }); if (request !== generation.current) return; setDocument(value); const first = value.dataset.records[0]; setRecordId(first?._meta.id ?? ''); setDraft(first ? draftOf(first) : null) }
    catch (e) { if (request === generation.current) setError((e as Error).message) }
  }
  async function save(labelStatus: string) {
    if (!draft || !record || busy || labelStatus === 'reviewed' && !draft.decisionTimeReviewed) return
    setError(''); setBusy(true); setMessage('')
    const request = ++generation.current
    try {
      const question = JSON.parse(draft.question)
      const value = await call('update', { dataset_id: id, expected_sha256: document.sha256, record_id: recordId, question, label_basis: draft.basis, group_id: draft.group, split: draft.split, label_status: labelStatus, decision_time_reviewed: draft.decisionTimeReviewed })
      if (request !== generation.current) return
      setDocument(value); setDraft(draftOf(value.dataset.records.find((entry: any) => entry._meta.id === recordId))); setMessage(labelStatus === 'reviewed' ? '本条已复核并核对决策时点；训练下载还需满足数据用途和分组条件。' : labelStatus === 'rejected' ? '本条已排除。' : '修改已保存，需要重新复核。'); void refresh()
    } catch (e) { if (request === generation.current) setError(`${(e as Error).message}；草稿已保留。`) }
    finally { setBusy(false) }
  }
  async function download(kind: string) {
    setError('')
    const request = generation.current
    try {
      const value = await call('export', { dataset_id: id, kind })
      if (request !== generation.current) return
      const url = URL.createObjectURL(new Blob([value.content], { type: 'application/x-ndjson;charset=utf-8' }))
      const link = window.document.createElement('a'); link.href = url; link.download = value.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage(`已下载 ${value.count} 条${kind === 'candidates' ? '候选' : '已复核训练'}样本。`)
    } catch (e) { if (request === generation.current) setError((e as Error).message) }
  }
  return <section className="harness-eval-dataset" aria-label="决策样本工作区">
    <div className="harness-eval-section-heading"><div><h3>决策样本</h3><p className="harness-eval-muted">AI 抽取后先保存候选，再逐条核对问题、标签和原始证据。训练导出仅包含已复核样本。</p></div><button onClick={() => void refresh()}>刷新样本</button></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label className="harness-eval-field">样本批次<select aria-label="样本批次" value={id} disabled={busy} onChange={event => void open(event.target.value)}><option value="">选择已保存的批次</option>{list.map(item => <option key={item.id} value={item.id}>{time(item.created_at)} · {item.count} 条 · 已复核 {item.reviewed}</option>)}</select></label>
    {!list.length && <p className="harness-eval-empty">此 Run 尚无样本。点击上方“请 AI 抽取决策样本”，在对话中的预览卡确认保存后刷新。</p>}
    {document && <><div className="harness-eval-actions"><button disabled={busy} onClick={() => void open(id)}>重新读取本批次</button><button onClick={() => void download('candidates')}>下载候选 JSONL</button><button disabled={!document.dataset.records.some((entry: any) => entry._meta.label_status === 'reviewed' && entry._meta.decision_time_reviewed === true && ['train', 'unassigned'].includes(entry._meta.split))} onClick={() => void download('training')}>下载已复核训练 JSONL</button></div><p className="harness-eval-note">导出读取已保存内容；未保存修改不进入下载。训练下载要求人员核对决策时点，并排除开发、校准、测试分组及其同组记录。相同任务或事件的重跑需使用同一分组。当前支持资料指定版本的 Kev 文本决策格式。</p>
    <div className="harness-eval-files-layout"><div className="harness-eval-file-list">{document.dataset.records.map((entry: any, index: number) => <button key={entry._meta.id} disabled={busy} aria-pressed={recordId === entry._meta.id} onClick={() => { if (dirty && !window.confirm('丢弃本条未保存修改并切换？')) return; setRecordId(entry._meta.id); setDraft(draftOf(entry)); setError(''); setMessage('') }}><span>{index + 1}. {entry.questions.decision.instructions}</span><small>{status[entry._meta.label_status]}</small></button>)}</div>
    {record && draft && <article className="harness-eval-file-preview"><span className="harness-eval-badge">{status[record._meta.label_status]}</span><div className="harness-eval-decision-context" aria-label="样本决策时点"><strong>当前决策 · 原始轨迹第 {record._meta.cutoff?.line ?? '未知'} 行</strong><p className="harness-eval-note">{record._meta.cutoff?.session_log ?? 'Session 未记录'} · {record._meta.trace_path ?? '来源未记录'}</p><pre>{JSON.stringify(record._meta.observed_action ?? null, null, 2)}</pre></div><details open><summary>决策前输入</summary><pre>{JSON.stringify(record.state, null, 2)}</pre></details><label className="harness-eval-field">问题与标签 JSON<textarea aria-label="决策问题 JSON" rows={15} disabled={busy} value={draft.question} onChange={event => setDraft({ ...draft, question: event.target.value, decisionTimeReviewed: false })}/></label><label className="harness-eval-field">标签依据<textarea aria-label="决策标签依据" rows={3} disabled={busy} value={draft.basis} onChange={event => setDraft({ ...draft, basis: event.target.value, decisionTimeReviewed: false })}/></label><label className="harness-eval-field">任务分组<input aria-label="决策任务分组" disabled={busy} value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })}/></label><label className="harness-eval-field">数据用途<select aria-label="决策数据用途" disabled={busy} value={draft.split} onChange={event => setDraft({ ...draft, split: event.target.value })}>{[['unassigned', '未分配'], ['train', '训练'], ['development', '开发'], ['calibration', '校准'], ['test', '测试']].map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
    <label className="harness-eval-review-check"><input type="checkbox" aria-label="已核对决策时点与题目一致" disabled={busy} checked={draft.decisionTimeReviewed} onChange={event => setDraft({ ...draft, decisionTimeReviewed: event.target.checked })}/>我已核对：题目对应上方当前决策，问题和候选中的已知事实均来自决策前输入，没有让模型回忆已完成的动作；标签依据已区分实际动作与推荐判断。</label><p className="harness-eval-note">这是人员复核声明；平台只固定输入时点，不自动证明自然语言题目和标签正确。修改问题、标签或依据后需重新核对。</p>
    <div className="harness-eval-actions"><button disabled={busy || !dirty} onClick={() => void save('suggested')}>保存修改，待复核</button><button className="harness-primary" disabled={busy || !draft.decisionTimeReviewed} onClick={() => void save('reviewed')}>确认标签并复核本条</button><button disabled={busy} onClick={() => void save('rejected')}>排除本条</button></div><details><summary>实际动作与证据定位</summary><pre>{JSON.stringify(record._meta, null, 2)}</pre></details></article>}</div><details><summary>抽取来源与跳过原因</summary><pre>{JSON.stringify({ extractor: document.dataset.extractor, path: document.dataset.path, source_sha256: document.dataset.source_sha256, skipped: document.dataset.skipped }, null, 2)}</pre></details></>}
  </section>
}
