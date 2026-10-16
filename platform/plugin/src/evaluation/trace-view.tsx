import { useEffect, useRef, useState } from 'react'
import type { DecisionSlice, TraceEvent, TraceSource } from './trace.ts'

interface TracePage {
  files: TraceSource[]
  path?: string
  source_sha256?: string
  events: TraceEvent[]
  decisions: DecisionSlice[]
  total_lines: number
  next_cursor: number | null
  warnings: string[]
}
export interface RunTraceViewProps {
  send(endpoint: string, payload: Record<string, unknown>): Promise<any>
  runId: string
  onEvidence?(path: string): void
  focus?: { path: string; line: number; source_sha256?: string }
}
const roleLabels = { target: '目标智能体', judge: '评审智能体', analysis: '场景归因', unknown: '角色未知' }
const text = (value: unknown) => JSON.stringify(value, null, 2)

/** 使用同一份真实 JSONL 证据分页浏览，不把父子会话拼成虚假的全局时间线。 */
export function RunTraceView({ send, runId, onEvidence, focus }: RunTraceViewProps) {
  const [page, setPage] = useState<TracePage | null>(null)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [decisions, setDecisions] = useState<DecisionSlice[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const generation = useRef(0)
  const currentRun = useRef(runId)
  const sendRef = useRef(send)
  currentRun.current = runId; sendRef.current = send
  async function load(path?: string, append = false, anchorLine?: number, sourceSha256?: string) {
    const request = ++generation.current
    const target = runId
    setBusy(true); setError('')
    try {
      const response = await sendRef.current('runs/trace', { run_id: target, ...(path ? { path } : {}),
        ...(!append && sourceSha256 ? { source_sha256: sourceSha256 } : {}),
        ...(append ? { cursor: page?.next_cursor, source_sha256: page?.source_sha256 } : anchorLine ? { cursor: anchorLine - 1 } : {}) })
      if (request !== generation.current || currentRun.current !== target) return
      if (response?.ok === false) throw new Error(response.error?.message ?? '轨迹读取失败')
      const next: TracePage = response?.ok === true ? response.value : response
      setPage(next)
      setEvents(old => append ? [...old, ...next.events] : next.events)
      setDecisions(old => append ? [...old, ...next.decisions] : next.decisions)
      if (!append) setSelectedSession(null)
    } catch (failure) { if (request === generation.current && currentRun.current === target) setError(failure instanceof Error ? failure.message : '轨迹读取失败') }
    finally { if (request === generation.current && currentRun.current === target) setBusy(false) }
  }
  useEffect(() => {
    setPage(null); setEvents([]); setDecisions([]); setSelectedSession(null)
    if (runId) void load(focus?.path, false, focus?.line, focus?.source_sha256)
    return () => { generation.current++ }
  }, [runId, focus?.path, focus?.line, focus?.source_sha256])
  useEffect(() => {
    if (focus && events.some(row => row.ref.path === focus.path && row.ref.line === focus.line) && typeof document !== 'undefined') document.getElementById('harness-trace-focused-source')?.scrollIntoView({ block: 'nearest' })
  }, [events, focus?.path, focus?.line])
  const sessions = [...new Set(events.map(row => row.ref.session_log ?? ''))]
  const groups = sessions.filter(session => selectedSession === null || session === selectedSession)
  return <section className="harness-run-trace" aria-label="结构化运行轨迹">
    <div className="harness-eval-section-heading"><div><h3>结构化运行轨迹</h3><p className="harness-eval-muted">按 Session 查看真实事件和决策前缀；父子会话分别展示。后继结果单列，避免进入决策时输入。</p></div><button type="button" disabled={!runId || busy} onClick={() => void load(page?.path ?? focus?.path, false, (page?.path ?? focus?.path) === focus?.path ? focus?.line : undefined, (page?.path ?? focus?.path) === focus?.path ? focus?.source_sha256 : undefined)}>刷新轨迹</button></div>
    {page?.files.length ? <div className="harness-eval-filters"><label>轨迹来源<select aria-label="结构化轨迹来源" value={page.path ?? ''} disabled={busy} onChange={event => void load(event.target.value)}>{page.files.map(file => <option key={file.path} value={file.path}>{roleLabels[file.role]} · {file.path.split('/evidence/')[1] ?? file.path}</option>)}</select></label><label>Session<select aria-label="结构化轨迹 Session" value={selectedSession ?? '__all__'} onChange={event => setSelectedSession(event.target.value === '__all__' ? null : event.target.value)}><option value="__all__">全部已加载 Session</option>{sessions.map(session => <option key={session} value={session}>{session || '未记录 Session'}</option>)}</select></label></div> : null}
    {focus && <p className="harness-eval-note">样本来源定位：{focus.path} · 第 {focus.line} 行。当前决策的实际动作和后继结果仅用于审核，不属于决策前输入。</p>}
    {error && <p role="alert">{error}</p>}
    {page?.warnings.map(warning => <p key={warning} className="harness-eval-note">{warning}</p>)}
    {busy && <p role="status">正在读取轨迹…</p>}
    {!busy && !error && !events.length && <p>该 Run 没有可展示的 Session 轨迹。</p>}
    {groups.map(session => <section key={session} aria-label={`Session ${session || '未记录'}`}><h4>{session || '未记录 Session'}</h4><ol className="harness-trace-events">{events.filter(row => (row.ref.session_log ?? '') === session).map(row => {
      const decision = decisions.find(item => item.anchor.line === row.ref.line && item.anchor.path === row.ref.path)
      const focused = row.ref.path === focus?.path && row.ref.line === focus?.line
      return <li key={`${row.ref.path}:${row.ref.line}`} id={focused ? 'harness-trace-focused-source' : undefined} data-focused={focused || undefined}><details open={focused || undefined}><summary>第 {row.ref.line} 行 · {row.type}{row.ref.seq !== null ? ` · seq ${row.ref.seq}` : ''}{decision ? ` · 决策点${decision.eligible ? '' : '（仅供复核）'}` : ''}</summary>
        {row.warning && <p>{row.warning}</p>}
        {decision && <div><p>{decision.context_mode === 'actual_request' ? '使用已保存的实际模型请求。' : '使用当前请求之前的可观察历史重建，实际模型上下文可能不同。'}</p><details><summary>查看决策当时的输入</summary><pre>{text(decision.state)}</pre></details><details><summary>查看实际动作与后继结果</summary><pre>{text({ observed_action: decision.observed_action, outcome: decision.outcome })}</pre></details><ul>{decision.limitations.map(item => <li key={item}>{item}</li>)}</ul></div>}
        {row.event && <details><summary>原始事件（脱敏副本）</summary><pre>{text(row.event)}</pre></details>}
        <details><summary>证据定位与原始摘要</summary><pre>{text(row.ref)}</pre>{onEvidence && <button type="button" onClick={() => onEvidence(row.ref.path)}>查看来源文件</button>}</details>
      </details></li>
    })}</ol></section>)}
    {page && <p className="harness-eval-muted">已加载 {events.length} 条记录，源文件共 {page.total_lines} 行。未知或损坏事件会保留定位并标明，不补造内容。</p>}
    {page?.next_cursor !== null && page?.next_cursor !== undefined && <button type="button" disabled={busy} onClick={() => void load(page.path, true)}>继续加载轨迹</button>}
  </section>
}
