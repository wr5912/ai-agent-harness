import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownDelegateProvider, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { CaseCreationDialog } from './cases-editor.tsx'
import { RunTraceView } from './trace-view.tsx'
import { DecisionDatasetView } from './dataset-view.tsx'
import { RunComparisonFacts } from './comparison-view.tsx'
import { CHANNEL } from '../protocol.ts'
import type { PlatformNavigation, PlatformPageProps } from '../protocol.ts'
import type { PlatformUpdates } from '../realtime/client.ts'

type Tab = 'cases' | 'runs' | 'compare'
type RunTab = 'report' | 'results' | 'trace' | 'files' | 'datasets'
type RpcResult = { ok: true; value: any } | { ok: false; error: { code: string; message: string } }
type Agent = { id: string; active_experiment?: string | null }
type Run = { run_id: string; experiment_id: string; agent_id: string; status?: string; created_at?: string }
type CaseDraft = { title: string; inputs: string[]; expected_behavior: string; fast: boolean }
type CaseDocument = { case: { id: string; title: string; inputs: string[]; expected_behavior: string; scene?: string; tier?: string; fast?: boolean }; sha256: string; path: string }
type RunFile = { path: string; size: number; kind: 'text' | 'binary' }
type EvaluationPageProps = PlatformPageProps & {
  updates?: PlatformUpdates
  onAssistant?(task: string, context: Record<string, unknown>): Promise<void>
  onContext?(context: Record<string, unknown>): void
  target?: PlatformNavigation
  onNavigate?(target: PlatformNavigation): void
  active?: boolean
}
const tabs: { id: Tab; label: string }[] = [{ id: 'cases', label: '测试用例' }, { id: 'runs', label: '评测运行' }, { id: 'compare', label: '结果比较' }]
const markdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' }
const statusLabels: Record<string, string> = { planned: '计划中', running: '运行中', cancelling: '正在取消', completed: '已完成', failed: '失败', cancelled: '已取消', passed: '通过', inconclusive: '无法判定', error: '执行错误', skipped: '已跳过', not_requested: '未请求', pending: '等待中' }
const label = (value: unknown) => typeof value === 'string' ? statusLabels[value] ?? value : '未记录'
const json = (value: unknown) => JSON.stringify(value, null, 2) ?? '未记录'
const time = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : '未记录'
const tabValue = (value?: string): Tab => tabs.some(item => item.id === value) ? value as Tab : 'runs'
const isFinal = (status?: string) => ['completed', 'failed', 'cancelled'].includes(status ?? '')
const draftFor = (document: CaseDocument): CaseDraft => ({ title: document.case.title ?? '', inputs: [...(document.case.inputs ?? [])], expected_behavior: document.case.expected_behavior ?? '', fast: document.case.fast ?? document.case.tier === 'fast' })

function Raw({ value, title = '原始记录' }: { value: unknown; title?: string }) {
  return <details className="harness-eval-raw"><summary>{title}</summary><pre>{json(value)}</pre></details>
}
function Facts({ items }: { items: [string, unknown][] }) {
  return <dl className="harness-eval-facts">{items.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{typeof value === 'string' || typeof value === 'number' ? value || '未记录' : value === true ? '是' : value === false ? '否' : '未记录'}</dd></div>)}</dl>
}
function Empty({ children }: { children: React.ReactNode }) { return <div className="harness-eval-empty">{children}</div> }
function RunCase({ item, onEvidence }: { item: any; onEvidence(path: string): void }) {
  const frozen = item.frozen
  return <article className="harness-eval-case-result">
    <div className="harness-eval-section-heading"><h3>{item.case_id} {frozen?.title}</h3><span className="harness-eval-badge">{item.review ? `复核：${label(item.review.reviewed_verdict)}` : '未记录证据复核'}</span></div>
    {item.contract_changed === true && <p className="harness-eval-note">当前用例定义已修改；本结果保留运行时的冻结输入与判定标准。</p>}
    {frozen ? <><h4>冻结输入</h4><ol className="harness-eval-turns">{(frozen.inputs ?? []).map((input: string, index: number) => <li key={index}>{input}</li>)}</ol><h4>预期行为</h4><p className="harness-eval-preserve">{frozen.expected_behavior || '未记录'}</p></> : <p>历史 Run 未冻结用例定义。</p>}
    <h4>智能体回答</h4>{Array.isArray(item.output) && item.output.length ? item.output.map((output: unknown, index: number) => <div key={index} className="harness-eval-answer"><small>第 {index + 1} 轮</small><MarkdownText text={typeof output === 'string' ? output : json(output)} labels={markdownLabels} /></div>) : <p>未采集到回答。</p>}
    <h4>机器结果</h4>{item.trials?.length ? item.trials.map((trial: any, index: number) => <div key={trial.trial_id ?? index} className="harness-eval-observation"><span className="harness-eval-badge" data-state={trial.verdict}>{label(trial.execution_status)} · {label(trial.verdict)}</span><p>{trial.observation}</p>{trial.failure_reason && <p role="alert">{trial.failure_reason}</p>}</div>) : <p>尚无 Trial 结果。</p>}
    {item.review && <><h4>证据复核</h4><p>{label(item.review.reviewed_verdict)} · {item.review.reason}</p></>}
    <h4>实际工具调用</h4>{item.tool_calls?.length ? <ul>{item.tool_calls.map((tool: any, index: number) => <li key={index}>{tool.name || '未记录名称'} · {label(tool.status)}{tool.error_code ? ` · ${tool.error_code}` : ''}</li>)}</ul> : <p>未记录工具调用。</p>}
    <div className="harness-eval-actions">{(item.evidence ?? []).map((file: any) => <button key={file.path} type="button" disabled={!file.present} onClick={() => onEvidence(file.path)}>{file.path.split('/').pop()}{!file.present ? '（缺失）' : ''}</button>)}</div>
    <Raw value={item} title="用例原始记录、装载观察与证据引用" />
  </article>
}

export function EvaluationPage({ rpc, updates, onAssistant, onContext, target, onNavigate, active = true }: EvaluationPageProps) {
  const [tab, setTab] = useState<Tab>(tabValue(target?.tab))
  const [agentId, setAgentId] = useState(target?.agent_id ?? '')
  const [experimentId, setExperimentId] = useState(target?.experiment_id ?? '')
  const [agents, setAgents] = useState<Agent[]>([])
  const [agentsError, setAgentsError] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [detailError, setDetailError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [runsLoading, setRunsLoading] = useState(false)
  const [runsError, setRunsError] = useState('')
  const [runStatus, setRunStatus] = useState('')
  const [runSearch, setRunSearch] = useState('')
  const [caseSearch, setCaseSearch] = useState('')
  const [sceneFilter, setSceneFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [selectedCases, setSelectedCases] = useState<string[]>([])
  const [caseId, setCaseId] = useState(target?.case_id ?? '')
  const [caseDocument, setCaseDocument] = useState<CaseDocument | null>(null)
  const [caseDraft, setCaseDraft] = useState<CaseDraft | null>(null)
  const [caseEditing, setCaseEditing] = useState(false)
  const [caseBusy, setCaseBusy] = useState(false)
  const [caseMessage, setCaseMessage] = useState('')
  const [caseConflict, setCaseConflict] = useState(false)
  const [runId, setRunId] = useState(target?.run_id ?? '')
  const [runDetail, setRunDetail] = useState<any>(null)
  const [runError, setRunError] = useState('')
  const [runLoading, setRunLoading] = useState(false)
  const [report, setReport] = useState<any>(null)
  const [reportError, setReportError] = useState('')
  const [runFiles, setRunFiles] = useState<any>(null)
  const [filesError, setFilesError] = useState('')
  const [newCase, setNewCase] = useState<{ agent: string; experiment: string; source?: { run_id: string; case_id: string } } | null>(null)
  const [newCaseDirty, setNewCaseDirty] = useState(false)
  const [newCaseBusy, setNewCaseBusy] = useState(false)
  const [datasetDirty, setDatasetDirty] = useState(false)
  const [datasetBusy, setDatasetBusy] = useState(false)
  const [datasetEpoch, setDatasetEpoch] = useState(0)
  const [extractError, setExtractError] = useState('')
  const [extractBusy, setExtractBusy] = useState(false)
  const [runTab, setRunTab] = useState<RunTab>('report')
  const [resultCaseId, setResultCaseId] = useState('')
  const [fileSearch, setFileSearch] = useState('')
  const [filePath, setFilePath] = useState('')
  const [filePreview, setFilePreview] = useState<any>(null)
  const [fileError, setFileError] = useState('')
  const pendingEvidence = useRef<{ run: string; path: string } | null>(null)
  const [leftRun, setLeftRun] = useState('')
  const [rightRun, setRightRun] = useState('')
  const [comparison, setComparison] = useState<any>(null)
  const [compareCaseId, setCompareCaseId] = useState('')
  const [compareError, setCompareError] = useState('')
  const [compareBusy, setCompareBusy] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [mode, setMode] = useState('fast')
  const [executor, setExecutor] = useState('api')
  const [review, setReview] = useState('none')
  const [evalPreview, setEvalPreview] = useState<any>(null)
  const [evalError, setEvalError] = useState('')
  const [evalBusy, setEvalBusy] = useState(false)
  const [job, setJob] = useState<any>(null)
  const [jobError, setJobError] = useState('')
  const jobNavigation = useRef<{ job_id: string; run_id?: string; agent_id: string; experiment_id: string; initial_run_id: string; run_selection_version: number } | null>(null)
  const runSelectionVersion = useRef(0)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [decisionTarget, setDecisionTarget] = useState({ agent: '', experiment: '' })
  const [decision, setDecision] = useState({ body: '', hash: '', saved: '' })
  const [decisionBusy, setDecisionBusy] = useState(false)
  const [decisionMessage, setDecisionMessage] = useState('')
  const [decisionConflict, setDecisionConflict] = useState(false)
  const configDialog = useRef<HTMLDialogElement>(null)
  const decisionDialog = useRef<HTMLDialogElement>(null)
  const listRequest = useRef(0), runsRequest = useRef(0), detailRequest = useRef(0), caseRequest = useRef(0), runRequest = useRef(0), fileRequest = useRef(0), compareRequest = useRef(0), evalRequest = useRef(0), decisionRequest = useRef(0)
  const caseDirty = !!caseDocument && !!caseDraft && JSON.stringify(caseDraft) !== JSON.stringify(draftFor(caseDocument))
  const decisionDirty = decision.body !== decision.saved
  const current = useRef({ caseDirty, decisionDirty, datasetDirty, datasetBusy, newCaseDirty, newCaseBusy, caseBusy, decisionBusy, agentId, experimentId, tab, runId, caseId, active })
  current.current = { caseDirty, decisionDirty, datasetDirty, datasetBusy, newCaseDirty, newCaseBusy, caseBusy, decisionBusy, agentId, experimentId, tab, runId, caseId, active }
  const cases: any[] = detail?.evaluation?.cases ?? []

  async function call(operation: string, payload: Record<string, unknown> = {}) {
    const result = await rpc.call(CHANNEL, `agents/${operation}`, payload) as RpcResult
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    return result.value
  }
  function location(overrides: Partial<PlatformNavigation> = {}): PlatformNavigation {
    return { page: 'evaluation', tab, agent_id: agentId || undefined, experiment_id: experimentId || undefined, run_id: runId || undefined, case_id: caseId || undefined, ...overrides }
  }
  function leaveDrafts() {
    if (current.current.caseBusy || current.current.decisionBusy || current.current.datasetBusy || current.current.newCaseBusy) return false
    const confirmed = !(current.current.caseDirty || current.current.decisionDirty || current.current.datasetDirty || current.current.newCaseDirty) || window.confirm('当前有未保存的用例、样本或研究决策。离开将丢弃草稿，是否继续？')
    if (confirmed && current.current.datasetDirty) { setDatasetEpoch(value => value + 1); setDatasetDirty(false) }
    if (confirmed && current.current.newCaseDirty) setNewCase(null)
    return confirmed
  }
  function resetScope(nextAgent: string, nextExperiment: string) {
    detailRequest.current++; caseRequest.current++; evalRequest.current++; compareRequest.current++; decisionRequest.current++
    setNewCase(null); setAgentId(nextAgent); setExperimentId(nextExperiment); setDetail(null); setCaseId(''); setCaseDocument(null); setCaseDraft(null); setCaseEditing(false); setSelectedCases([]); setCaseMessage(''); setCaseConflict(false)
    setDecisionOpen(false); setDecision({ body: '', hash: '', saved: '' }); setConfigOpen(false); setEvalPreview(null); setEvalError(''); setEvalBusy(false)
    setComparison(null); setCompareCaseId(''); setCompareError(''); setCompareBusy(false); setLeftRun(''); setRightRun(''); setSceneFilter(''); setTierFilter(''); setRunId('')
  }
  function changeScope(nextAgent: string, nextExperiment = '') {
    if (nextAgent === agentId && nextExperiment === experimentId) return
    if (!leaveDrafts()) return
    resetScope(nextAgent, nextExperiment)
    onNavigate?.(location({ agent_id: nextAgent || undefined, experiment_id: nextExperiment || undefined, case_id: undefined, run_id: undefined }))
  }
  function chooseCase(id: string) {
    if (id === caseId || !leaveDrafts()) return
    caseRequest.current++; setCaseId(id); setCaseDocument(null); setCaseDraft(null); setCaseEditing(false); setCaseMessage(''); setCaseConflict(false)
    onNavigate?.(location({ case_id: id }))
  }
  function chooseRun(id: string, nextTab: Tab = tab, automatic = false) {
    if (id !== runId && !leaveDrafts()) return
    if (!automatic) runSelectionVersion.current++
    if (id !== runId) {
      runRequest.current++; fileRequest.current++; setRunId(id); setResultCaseId(''); setFilePath(''); setFilePreview(null)
    }
    setTab(nextTab); setRunTab('report')
    onNavigate?.(location({ tab: nextTab, run_id: id, case_id: undefined, replace: automatic || undefined }))
  }
  function chooseTab(next: Tab) {
    current.current = { ...current.current, tab: next }
    setTab(next); onNavigate?.(location({ tab: next }))
  }
  async function loadAgents() {
    const request = ++listRequest.current
    try { const value = await call('list'); if (request === listRequest.current) { setAgents(value.agents ?? []); setAgentsError('') } }
    catch (error) { if (request === listRequest.current) setAgentsError((error as Error).message) }
  }
  async function loadRuns() {
    const request = ++runsRequest.current
    setRunsLoading(true); setRunsError('')
    const results = await Promise.allSettled(agents.map(async agent => {
      const value = await call('runs/index', { agent_id: agent.id })
      return (value.experiments ?? []).flatMap((experiment: any) => (experiment.runs ?? []).map((run: any) => ({ ...run, run_id: run.run_id ?? run.id, experiment_id: experiment.experiment_id ?? experiment.id, agent_id: agent.id }))) as Run[]
    }))
    if (request !== runsRequest.current) return
    setRuns(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')))
    setRunsError(results.flatMap((result, index) => result.status === 'rejected' ? [`${agents[index].id}：${result.reason.message}`] : []).join('；')); setRunsLoading(false)
  }
  async function loadDetail() {
    const request = ++detailRequest.current
    if (!agentId) { setDetail(null); setDetailLoading(false); return }
    setDetailLoading(true); setDetailError('')
    try {
      const value = await call('detail', { agent_id: agentId, ...(experimentId ? { experiment_id: experimentId } : {}) })
      if (request !== detailRequest.current) return
      setDetail(value)
      if (!experimentId && (tab === 'cases' || configOpen)) setExperimentId(value.experiment.id)
      setSelectedCases(current => current.filter(id => value.evaluation.cases.some((item: any) => item.id === id)))
    } catch (error) { if (request === detailRequest.current) setDetailError((error as Error).message) }
    finally { if (request === detailRequest.current) setDetailLoading(false) }
  }
  async function loadCase() {
    const request = ++caseRequest.current
    if (!experimentId || !caseId) return
    setCaseMessage('正在读取用例…')
    try {
      const value = await call('cases/read', { experiment_id: experimentId, case_id: caseId }) as CaseDocument
      if (request !== caseRequest.current) return
      if (current.current.caseDirty) { if (caseDocument?.sha256 !== value.sha256) setCaseConflict(true); return }
      setCaseDocument(value); setCaseDraft(draftFor(value)); setCaseMessage(''); setCaseConflict(false)
    } catch (error) { if (request === caseRequest.current) setCaseMessage((error as Error).message) }
  }
  async function saveCase() {
    if (!caseDraft || !caseDocument || caseBusy) return
    const request = caseRequest.current
    setCaseBusy(true); setCaseMessage('正在校验并保存…')
    try {
      const value = await call('cases/update', { experiment_id: experimentId, case_id: caseId, ...caseDraft, expected_sha256: caseDocument.sha256 }) as CaseDocument
      if (request !== caseRequest.current) return
      setCaseDocument(value); setCaseDraft(draftFor(value)); setCaseEditing(false); setCaseConflict(false); setCaseMessage('已保存。后续评测立即使用新定义；已启动的 Run 保留冻结口径。'); setEvalPreview(null)
      await loadDetail()
    } catch (error) { if (request === caseRequest.current) { setCaseMessage(`${(error as Error).message}；草稿已保留。`); if ((error as Error).message.startsWith('conflict:')) setCaseConflict(true) } }
    finally { setCaseBusy(false) }
  }
  async function loadRun(id = runId) {
    const request = ++runRequest.current
    if (runDetail?.run_id !== id) { setRunDetail(null); setReport(null); setRunFiles(null); setFilePreview(null); setFilePath('') }
    setRunError(''); setReportError(''); setFilesError('')
    if (!id) { setRunLoading(false); return }
    setRunLoading(true)
    const results = await Promise.allSettled([call('runs/show', { run_id: id }), call('runs/report', { run_id: id }), call('runs/files', { run_id: id })])
    if (request !== runRequest.current || current.current.runId !== id) return
    const [view, document, files] = results
    if (view.status === 'fulfilled') { setRunDetail(view.value); setResultCaseId(current => view.value.cases?.some((item: any) => item.case_id === current) ? current : view.value.cases?.[0]?.case_id ?? '') } else setRunError(view.reason.message)
    if (document.status === 'fulfilled') setReport(document.value); else setReportError(document.reason.message)
    if (files.status === 'fulfilled') setRunFiles(files.value); else setFilesError(files.reason.message)
    setRunLoading(false)
  }
  async function openFile(path: string) {
    // Markdown 的本地链接仅能命中本次 Run 文件目录；目录链接展开为目录筛选。
    const files: RunFile[] = runFiles?.files ?? []
    const prefix = runDetail?.run_path ? `${runDetail.run_path}/` : ''
    let decoded: string
    try { decoded = decodeURIComponent(path).replace(/^\.\//, '').replace(/#.*$/, '') } catch { decoded = path }
    const match = files.find(file => file.path === decoded || file.path === `${prefix}${decoded}`)
    setRunTab('files')
    if (!match) {
      const folder = decoded.replace(/\/$/, '')
      if (files.some(file => file.path.startsWith(`${prefix}${folder}/`) || file.path.startsWith(`${folder}/`))) { setFileSearch(folder); setFileError(''); return }
      setFileError('此链接未对应当前 Run 中已保存的文件。请从文件清单选择。'); return
    }
    const request = ++fileRequest.current
    const selectedRun = runId
    setFilePath(match.path); setFilePreview(null); setFileError('')
    if (match.kind === 'binary') return
    try { const value = await call('runs/read-file', { run_id: runId, path: match.path }); if (request === fileRequest.current && current.current.runId === selectedRun) setFilePreview(value) }
    catch (error) { if (request === fileRequest.current && current.current.runId === selectedRun) setFileError((error as Error).message) }
  }
  function download(kind: 'archive' | 'report' | 'file', path?: string) {
    const url = new URL('api/harness-platform/runs/download', document.baseURI)
    url.searchParams.set('run_id', runId); url.searchParams.set('kind', kind)
    if (path) url.searchParams.set('path', path)
    return url.href
  }
  async function compareRuns() {
    if (!leftRun || !rightRun || leftRun === rightRun) return
    const request = ++compareRequest.current
    setCompareBusy(true); setCompareError(''); setComparison(null)
    try {
      const [value, left, right] = await Promise.all([call('runs/compare', { left: leftRun, right: rightRun }), call('runs/show', { run_id: leftRun }), call('runs/show', { run_id: rightRun })])
      if (request !== compareRequest.current) return
      setComparison({ ...value, left_view: left, right_view: right }); setCompareCaseId(value.cases?.[0]?.case_id ?? '')
    } catch (error) { if (request === compareRequest.current) setCompareError((error as Error).message) }
    finally { if (request === compareRequest.current) setCompareBusy(false) }
  }
  function evalPayload() { return { source: `experiment:${experimentId}`, mode, executor, review, ...(selectedCases.length ? { cases: selectedCases } : {}) } }
  function clearPreview() { evalRequest.current++; setEvalPreview(null); setEvalError('') }
  async function previewEvaluation() {
    if (!experimentId) return
    const request = ++evalRequest.current
    setEvalBusy(true); setEvalError(''); setEvalPreview(null)
    try { const value = await call('eval/preview', evalPayload()); if (request === evalRequest.current) setEvalPreview(value.result ?? value) }
    catch (error) { if (request === evalRequest.current) setEvalError((error as Error).message) }
    finally { setEvalBusy(false) }
  }
  async function startEvaluation() {
    if (!experimentId) return
    const request = ++evalRequest.current
    const initialRunSelection = runSelectionVersion.current
    setEvalBusy(true); setEvalError('')
    try {
      const value = await call('eval/start', evalPayload())
      if (request !== evalRequest.current) return
      jobNavigation.current = { job_id: value.job_id, agent_id: agentId, experiment_id: experimentId, initial_run_id: runId, run_selection_version: initialRunSelection }
      setJob({ ...value, agent_id: agentId, experiment_id: experimentId }); setJobError(''); setConfigOpen(false)
      const state = current.current
      if (state.active && state.agentId === agentId && state.experimentId === experimentId && state.tab === tab && state.runId === runId && runSelectionVersion.current === initialRunSelection) chooseTab('runs')
      void statusEvaluation(value.job_id)
    } catch (error) { if (request === evalRequest.current) setEvalError((error as Error).message) }
    finally { setEvalBusy(false) }
  }
  async function statusEvaluation(jobId = job?.job_id) {
    if (!jobId) return
    try {
      const value = await call('eval/status', { job_id: jobId })
      const navigation = jobNavigation.current
      if (!navigation || navigation.job_id !== jobId) return
      setJob((previous: any) => previous?.job_id === jobId ? { ...previous, ...value } : previous); setJobError('')
      const id = value.result?.run_id ?? value.run_id
      if (id && navigation.run_id !== id) {
        // 首次观察到 ID 后即记住，离开工作区也不在返回时补跳。
        navigation.run_id = id
        const state = current.current
        if (state.active && state.agentId === navigation.agent_id && state.experimentId === navigation.experiment_id
          && state.tab === 'runs' && state.runId === navigation.initial_run_id && runSelectionVersion.current === navigation.run_selection_version) chooseRun(id, 'runs', true)
      }
      if (isFinal(value.status)) { void loadRuns(); if (id && current.current.runId === id) void loadRun(id) }
    } catch (error) { setJobError((error as Error).message) }
  }
  async function cancelEvaluation() {
    if (!job?.job_id || job.status === 'cancelling' || isFinal(job.status)) return
    try { await call('eval/cancel', { job_id: job.job_id }); await statusEvaluation() }
    catch (error) { setJobError((error as Error).message) }
  }
  async function openDecision() {
    const experiment = runDetail?.manifest?.experiment_id ?? experimentId
    const agent = runDetail?.manifest?.agent_id ?? agentId
    if (!experiment || !agent) return
    if (decisionDirty && decisionTarget.experiment === experiment) { setDecisionOpen(true); return }
    if (!leaveDrafts()) return
    const request = ++decisionRequest.current
    setDecisionOpen(true); setDecisionTarget({ agent, experiment }); setDecision({ body: '', hash: '', saved: '' }); setDecisionMessage('正在读取研究决策…'); setDecisionConflict(false)
    try {
      const value = await call('detail', { agent_id: agent, experiment_id: experiment })
      if (request !== decisionRequest.current) return
      setDecision({ body: value.decision.content ?? '', hash: value.decision.sha256, saved: value.decision.content ?? '' }); setDecisionMessage('')
    } catch (error) { if (request === decisionRequest.current) setDecisionMessage((error as Error).message) }
  }
  async function saveDecision() {
    const request = decisionRequest.current
    const body = decision.body
    setDecisionBusy(true); setDecisionMessage('正在保存…')
    try {
      const value = await call('decision/update', { experiment_id: decisionTarget.experiment, content: body, expected_sha256: decision.hash })
      if (request !== decisionRequest.current) return
      setDecision(previous => ({ ...previous, hash: value.sha256, saved: body })); setDecisionConflict(false); setDecisionMessage('研究决策已保存。')
    } catch (error) { if (request === decisionRequest.current) { setDecisionMessage(`${(error as Error).message}；草稿已保留。`); if ((error as Error).message.startsWith('conflict:')) setDecisionConflict(true) } }
    finally { setDecisionBusy(false) }
  }
  function closeDecision() { if (decisionBusy || !leaveDrafts()) return; setDecisionOpen(false); setDecision({ body: '', hash: '', saved: '' }); decisionRequest.current++ }

  useEffect(() => { void loadAgents(); return () => { listRequest.current++; runsRequest.current++; detailRequest.current++; caseRequest.current++; runRequest.current++; fileRequest.current++; compareRequest.current++; evalRequest.current++; decisionRequest.current++ } }, [])
  useEffect(() => { if (agents.length) void loadRuns(); else setRuns([]) }, [agents.map(agent => agent.id).join(',')])
  useEffect(() => { void loadDetail() }, [agentId, experimentId, tab, configOpen])
  useEffect(() => { void loadCase() }, [experimentId, caseId])
  useEffect(() => { void loadRun() }, [runId])
  useEffect(() => {
    if (pendingEvidence.current?.run !== runId || !runFiles || runDetail?.run_id !== runId) return
    const path = pendingEvidence.current.path
    pendingEvidence.current = null
    void openFile(path)
  }, [runId, runFiles, runDetail?.run_id])
  useEffect(() => {
    if (active) onContext?.({ page: 'evaluation', agent_id: agentId || undefined, experiment_id: experimentId || undefined, run_id: runId || undefined, case_id: tab === 'cases' ? caseId || undefined : resultCaseId || undefined, tab })
  }, [active, agentId, experimentId, runId, caseId, resultCaseId, tab, onContext])
  useEffect(() => {
    if (target?.page !== 'evaluation') return
    const state = current.current
    const nextTab = tabValue(target.tab), nextAgent = target.agent_id ?? '', nextExperiment = target.experiment_id ?? '', nextRun = target.run_id ?? '', nextCase = target.case_id ?? ''
    const scopeChanged = nextAgent !== state.agentId || nextExperiment !== state.experimentId
    const caseChanged = nextTab === 'cases' && nextCase !== state.caseId
    if ((scopeChanged || caseChanged || nextRun !== state.runId) && !leaveDrafts()) { onNavigate?.({ page: 'evaluation', tab: state.tab, agent_id: state.agentId || undefined, experiment_id: state.experimentId || undefined, run_id: state.runId || undefined, case_id: state.caseId || undefined }); return }
    if (scopeChanged) resetScope(nextAgent, nextExperiment)
    setTab(nextTab); setRunId(nextRun)
    if (nextTab === 'cases') { setCaseId(nextCase); if (caseChanged) { setCaseDocument(null); setCaseDraft(null); setCaseEditing(false) } }
    else if (nextCase) setResultCaseId(nextCase)
  }, [target?.page, target?.agent_id, target?.experiment_id, target?.run_id, target?.case_id, target?.tab])
  useEffect(() => {
    if (active || !(current.current.caseDirty || current.current.decisionDirty || current.current.datasetDirty || current.current.newCaseDirty || current.current.datasetBusy || current.current.newCaseBusy || current.current.caseBusy || current.current.decisionBusy)) return
    if (!leaveDrafts()) { onNavigate?.(location()); return }
    setCaseDraft(caseDocument ? draftFor(caseDocument) : null); setCaseEditing(false); setDecisionOpen(false); setDecision({ body: '', hash: '', saved: '' })
  }, [active])
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (current.current.caseDirty || current.current.decisionDirty || current.current.datasetDirty || current.current.newCaseDirty || current.current.datasetBusy || current.current.newCaseBusy || current.current.caseBusy || current.current.decisionBusy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [])
  useEffect(() => { if (active && configOpen) configDialog.current?.showModal(); else configDialog.current?.close() }, [active, configOpen])
  useEffect(() => { if (active && decisionOpen) decisionDialog.current?.showModal(); else decisionDialog.current?.close() }, [active, decisionOpen])
  useEffect(() => updates?.subscribe(() => {
    if (!updates.getSnapshot().domains.some(domain => ['agents', 'catalog'].includes(domain))) return
    void loadAgents(); void loadRuns(); void loadDetail()
    if (caseId && experimentId && !caseBusy) void loadCase()
    if (runId) void loadRun()
    if (job?.job_id && !isFinal(job.status)) void statusEvaluation()
    if (decisionOpen && decisionTarget.experiment && decision.hash) void call('detail', { agent_id: decisionTarget.agent, experiment_id: decisionTarget.experiment }).then(value => {
      if (value.decision.sha256 !== decision.hash) { if (current.current.decisionDirty) setDecisionConflict(true); else setDecision({ body: value.decision.content ?? '', hash: value.decision.sha256, saved: value.decision.content ?? '' }) }
    }).catch(() => undefined)
  }), [updates, agents, agentId, experimentId, caseId, caseBusy, runId, job?.job_id, job?.status, decisionOpen, decisionTarget.experiment, decision.hash])
  useEffect(() => {
    if (!job?.job_id || isFinal(job.status)) return
    const timer = window.setInterval(() => void statusEvaluation(), 2500)
    return () => window.clearInterval(timer)
  }, [job?.job_id, job?.status])

  const runExperiments = useMemo(() => [...new Set(runs.filter(run => !agentId || run.agent_id === agentId).map(run => run.experiment_id))], [runs, agentId])
  const filteredRuns = runs.filter(run => (!agentId || run.agent_id === agentId) && (!experimentId || run.experiment_id === experimentId) && (!runStatus || run.status === runStatus) && (!runSearch || `${run.run_id} ${run.agent_id} ${run.experiment_id}`.toLowerCase().includes(runSearch.toLowerCase())))
  const filteredCases = cases.filter(item => (!caseSearch || `${item.id} ${item.title} ${item.input_preview ?? ''}`.toLowerCase().includes(caseSearch.toLowerCase())) && (!sceneFilter || item.scene === sceneFilter) && (!tierFilter || item.tier === tierFilter))
  const sceneOptions = [...new Set(cases.map(item => item.scene).filter(Boolean))]
  const tierOptions = [...new Set(cases.map(item => item.tier).filter(Boolean))]
  const compareRunsOptions = runs.filter(run => isFinal(run.status) && (!agentId || run.agent_id === agentId))
  const leftAgent = runs.find(run => run.run_id === leftRun)?.agent_id
  const selectedResult = runDetail?.cases?.find((item: any) => item.case_id === resultCaseId)
  const selectedComparison = comparison?.cases?.find((item: any) => item.case_id === compareCaseId)
  const selectedFile = runFiles?.files?.find((file: RunFile) => file.path === filePath)
  const sealed = runFiles?.sealed ?? isFinal(runDetail?.manifest?.status)
  const versions: string[] = [...new Set([...(detail?.versions ?? []).map((version: any) => version.id), ...runExperiments])]

  return <main className="harness-evaluation" aria-label="评测中心">
    <header className="harness-page-heading"><div><p>维护测试用例，运行评测，阅读报告与比较完整证据。</p></div><div className="harness-eval-actions"><button type="button" onClick={() => { void loadAgents(); void loadRuns(); if (agentId) void loadDetail(); if (runId) void loadRun() }}>刷新</button><button type="button" className="harness-primary" onClick={() => { setConfigOpen(true); clearPreview() }}>＋ 新建评测</button></div></header>
    {agentsError && <p role="alert">{agentsError}</p>}
    <div role="tablist" aria-label="评测工作区" className="harness-eval-tabs" onKeyDown={event => {
      const index = tabs.findIndex(item => item.id === tab)
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
      if (next < 0) return
      event.preventDefault(); chooseTab(tabs[next].id); document.getElementById(`evaluation-tab-${tabs[next].id}`)?.focus()
    }}>{tabs.map(item => <button key={item.id} id={`evaluation-tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`evaluation-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => chooseTab(item.id)}>{item.label}{item.id === 'runs' && <span>{runs.length}</span>}{item.id === 'cases' && agentId && <span>{cases.length}</span>}</button>)}</div>
    <div className="harness-eval-filters harness-card"><label>智能体<select aria-label="评测智能体" value={agentId} onChange={event => changeScope(event.target.value)}><option value="">全部智能体</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.id}</option>)}</select></label><label>研究版本<select aria-label="评测研究版本" value={experimentId} disabled={!agentId} onChange={event => changeScope(agentId, event.target.value)}><option value="">全部版本</option>{versions.map(id => <option key={id} value={id}>{id}</option>)}</select></label>{detailLoading && <span role="status" className="harness-eval-muted">读取版本中…</span>}{detailError && <p role="alert">{detailError}</p>}</div>
    {job && <section className="harness-eval-job harness-card" aria-label="当前评测任务"><div><strong>评测任务 · {label(job.status)}</strong><small>{job.experiment_id} · {job.job_id}</small>{job.result?.run_id && <button type="button" onClick={() => chooseRun(job.result.run_id, 'runs')}>查看本次报告</button>}{job.error && <p role="alert">{job.error}</p>}{jobError && <p role="alert">{jobError}</p>}</div><div className="harness-eval-actions"><button type="button" onClick={() => void statusEvaluation()}>刷新状态</button><button type="button" disabled={isFinal(job.status) || job.status === 'cancelling'} onClick={() => void cancelEvaluation()}>取消评测</button></div><details><summary>执行日志（显示内容可能截断）</summary><pre>{job.stdout || '等待输出…'}{job.stderr ? `\n${job.stderr}` : ''}</pre></details></section>}
    <section role="tabpanel" id="evaluation-panel-cases" aria-labelledby="evaluation-tab-cases" hidden={tab !== 'cases'}>
      {!agentId || !experimentId ? <Empty>选择智能体和具体研究版本后维护用例或运行评测。</Empty> : <>
        <p className="harness-eval-note">用例由 <strong>{agentId}</strong> 的所有研究版本共用。保存后对后续评测立即生效；正在执行和历史 Run 保留各自冻结的用例定义。</p>
        <div className="harness-eval-workbench">
          <section className="harness-card harness-eval-list-card" aria-label="测试用例列表"><div className="harness-eval-section-heading"><h2>测试用例 <span>{cases.length}</span></h2><div className="harness-eval-actions"><span className="harness-eval-muted">已选 {selectedCases.length} 个</span><button onClick={() => setNewCase({ agent: agentId, experiment: experimentId })}>＋ 新增用例</button></div></div>
            <div className="harness-eval-filters"><input aria-label="搜索测试用例" placeholder="搜索用例 ID、名称或输入" value={caseSearch} onChange={event => setCaseSearch(event.target.value)} /><select aria-label="筛选用例场景" value={sceneFilter} onChange={event => setSceneFilter(event.target.value)}><option value="">全部场景</option>{sceneOptions.map(scene => <option key={scene} value={scene}>{scene}</option>)}</select><select aria-label="筛选用例档位" value={tierFilter} onChange={event => setTierFilter(event.target.value)}><option value="">全部档位</option>{tierOptions.map(tier => <option key={tier} value={tier}>{tier}</option>)}</select></div>
            <div className="harness-table-scroll"><table className="harness-eval-case-table"><thead><tr><th><input type="checkbox" aria-label="选择当前筛选的全部用例" checked={filteredCases.length > 0 && filteredCases.every(item => selectedCases.includes(item.id))} onChange={event => { setSelectedCases(current => event.target.checked ? [...new Set([...current, ...filteredCases.map(item => item.id)])] : current.filter(id => !filteredCases.some(item => item.id === id))); clearPreview() }} /></th><th>用例</th><th>场景 / 档位</th></tr></thead><tbody>{filteredCases.map(item => <tr key={item.id} data-selected={caseId === item.id} onClick={() => chooseCase(item.id)}><td onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`执行 ${item.id}`} checked={selectedCases.includes(item.id)} onChange={event => { setSelectedCases(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); clearPreview() }} /></td><td><button type="button" className="harness-eval-row-link" aria-pressed={caseId === item.id} onClick={event => { event.stopPropagation(); chooseCase(item.id) }}><strong>{item.id}</strong><span>{item.title || '未命名用例'}</span></button></td><td><span>{item.scene || '未分组'}</span><small>{item.tier || '未记录'}</small></td></tr>)}</tbody></table></div>{!filteredCases.length && <Empty>没有匹配的用例。</Empty>}
            <div className="harness-eval-list-footer"><span>复选框用于执行范围；点击用例阅读与编辑。</span><button type="button" disabled={!selectedCases.length} onClick={() => { setSelectedCases([]); clearPreview() }}>清空选择</button></div>
          </section>
          <section className="harness-card harness-eval-case-detail" aria-label="用例详情">{!caseId ? <Empty>从列表选择一个用例，查看输入与预期行为。</Empty> : <><div className="harness-eval-section-heading"><div><h2>{caseId}</h2><small className="harness-eval-muted">{caseDocument?.path}</small></div>{caseDocument && !caseEditing && <button type="button" onClick={() => { setCaseEditing(true); setCaseMessage('') }}>编辑用例</button>}</div>{caseConflict && <p role="alert">用例文件已被其他任务修改，草稿已保留。请取消编辑并重读后合并修改。</p>}{caseMessage && <p role="status">{caseMessage}</p>}{caseDraft && caseDocument && (caseEditing ? <div className="harness-eval-editor"><label>名称<input aria-label="用例名称" disabled={caseBusy} value={caseDraft.title} onChange={event => setCaseDraft({ ...caseDraft, title: event.target.value })} /></label><h3>多轮输入</h3>{caseDraft.inputs.map((input, index) => <div className="harness-eval-input-turn" key={index}><label>第 {index + 1} 轮<textarea aria-label={`第 ${index + 1} 轮输入`} disabled={caseBusy} rows={4} value={input} onChange={event => setCaseDraft({ ...caseDraft, inputs: caseDraft.inputs.map((value, at) => at === index ? event.target.value : value) })} /></label><button type="button" disabled={caseBusy || caseDraft.inputs.length === 1} onClick={() => setCaseDraft({ ...caseDraft, inputs: caseDraft.inputs.filter((_, at) => at !== index) })}>移除第 {index + 1} 轮</button></div>)}<button type="button" disabled={caseBusy} onClick={() => setCaseDraft({ ...caseDraft, inputs: [...caseDraft.inputs, ''] })}>＋ 添加一轮输入</button><label>预期行为<textarea aria-label="用例预期行为" disabled={caseBusy} rows={5} value={caseDraft.expected_behavior} onChange={event => setCaseDraft({ ...caseDraft, expected_behavior: event.target.value })} /></label><label className="harness-eval-check"><input type="checkbox" disabled={caseBusy} checked={caseDraft.fast} onChange={event => setCaseDraft({ ...caseDraft, fast: event.target.checked })} />纳入快速评测（fast）</label><div className="harness-eval-actions"><button type="button" className="harness-primary" disabled={caseBusy || !caseDirty} onClick={() => void saveCase()}>{caseBusy ? '保存中…' : '保存用例'}</button><button type="button" disabled={caseBusy} onClick={() => { if (caseDirty && !window.confirm('取消编辑并丢弃当前用例草稿？')) return; setCaseDraft(draftFor(caseDocument)); setCaseEditing(false); setCaseMessage(''); void loadCase() }}>取消编辑</button></div></div> : <><h3>{caseDocument.case.title}</h3><Facts items={[["场景", caseDocument.case.scene], ["评测档位", caseDraft.fast ? 'fast / full' : 'full']]} /><h4>多轮输入</h4><ol className="harness-eval-turns">{caseDocument.case.inputs.map((input, index) => <li key={index}>{input}</li>)}</ol><h4>预期行为</h4><p className="harness-eval-preserve">{caseDocument.case.expected_behavior}</p></>)}</> }</section>
        </div>
      </>}
    </section>
    <section role="tabpanel" id="evaluation-panel-runs" aria-labelledby="evaluation-tab-runs" hidden={tab !== 'runs'}>
      <section className="harness-card harness-eval-run-list"><div className="harness-eval-section-heading"><h2>评测运行 <span>{filteredRuns.length}</span></h2>{runsLoading && <span role="status">读取 Run…</span>}</div><div className="harness-eval-filters"><input aria-label="搜索评测运行" placeholder="搜索 Run、智能体或版本" value={runSearch} onChange={event => setRunSearch(event.target.value)} /><select aria-label="筛选运行状态" value={runStatus} onChange={event => setRunStatus(event.target.value)}><option value="">全部状态</option>{['planned', 'running', 'completed', 'failed', 'cancelled'].map(status => <option key={status} value={status}>{label(status)}</option>)}</select></div>{runsError && <p role="alert">部分 Run 列表读取失败：{runsError}</p>}<div className="harness-table-scroll"><table className="harness-eval-run-table" aria-label="评测运行列表"><thead><tr><th>Run / 智能体</th><th>研究版本</th><th>状态</th><th>创建时间</th></tr></thead><tbody>{filteredRuns.map(run => <tr key={run.run_id} data-selected={runId === run.run_id} onClick={() => chooseRun(run.run_id)}><td data-label="Run / 智能体"><button type="button" className="harness-eval-row-link" title={run.run_id} aria-pressed={runId === run.run_id} onClick={event => { event.stopPropagation(); chooseRun(run.run_id) }}>{run.run_id}</button><small title={run.agent_id}>{run.agent_id}</small></td><td data-label="研究版本"><span className="harness-eval-identifier" title={run.experiment_id}>{run.experiment_id}</span></td><td data-label="状态"><span className="harness-eval-badge" data-state={run.status}>{label(run.status)}</span></td><td data-label="创建时间"><time className="harness-eval-timestamp" dateTime={run.created_at}>{time(run.created_at)}</time></td></tr>)}</tbody></table></div>{!runsLoading && !filteredRuns.length && <Empty>当前筛选范围暂无 Run。可新建评测，或选择其他智能体与版本。</Empty>}</section>
      <section className="harness-card harness-eval-run-detail" aria-label="Run 详情">{!runId ? <Empty>点击一条 Run，直接阅读报告与逐例证据。</Empty> : <><div className="harness-eval-section-heading"><div><h2>{runId}</h2><small className="harness-eval-muted">{runDetail?.manifest?.agent_id} · {runDetail?.manifest?.experiment_id}</small></div><div className="harness-eval-actions">{report?.present && <a className="harness-eval-download" href={download('report')} download>下载报告</a>}{sealed ? <a className="harness-eval-download harness-eval-download-primary" href={download('archive')} download>下载完整 Run ZIP</a> : <span className="harness-eval-muted">完整包在 Run 封存后提供</span>}<button type="button" disabled={!runDetail?.manifest?.experiment_id} onClick={() => void openDecision()}>记录研究决策</button><button type="button" className="harness-primary" disabled={!onAssistant || extractBusy || !sealed || !runDetail?.manifest?.experiment_id || runDetail?.run_id !== runId} onClick={async () => {
          const context = { page: 'evaluation', run_id: runId, agent_id: runDetail.manifest.agent_id, experiment_id: runDetail.manifest.experiment_id, skill: 'decision-sample-extraction' }
          setExtractBusy(true); setExtractError('')
          try { await onAssistant?.('请读取并使用 decision-sample-extraction Skill，从固定任务上下文的 Run 抽取有证据的原子决策样本。先通过 datasets/source 核对业务目标轨迹和决策分页，再以 datasets/preview 提交候选供确认保存。不要修改 Run；AI 标签只是建议。无法支持时概括主要限制，逐条原因保留在候选记录中，允许零条。', context) }
          catch (error) { setExtractError((error as Error).message) }
          finally { setExtractBusy(false) }
        }}>{extractBusy ? '正在打开 AI…' : '请 AI 抽取决策样本'}</button><button onClick={() => setRunTab('datasets')}>查看决策样本</button></div></div>{extractError && <p role="alert">{extractError}</p>}{runLoading && <p role="status">正在加载报告与运行记录…</p>}{runError && <p role="alert">{runError}</p>}{runDetail && <><Facts items={[["运行状态", label(runDetail.manifest.status)], ["有效结论", label(runDetail.summary?.effective_verdict ?? runDetail.summary?.overall_verdict)], ["机器结论", label(runDetail.summary?.machine_overall_verdict ?? runDetail.summary?.overall_verdict)], ["开始时间", time(runDetail.manifest.created_at)], ["执行器", runDetail.source?.executor], ["复核", label(runDetail.summary?.review_status)]]} />{runDetail.missing?.length > 0 && <details className="harness-eval-limits"><summary>记录与采集缺口（{runDetail.missing.length}）</summary><ul>{runDetail.missing.map((value: string) => <li key={value}>{value}</li>)}</ul></details>}</>}
        <div role="tablist" aria-label="Run 内容" className="harness-eval-subtabs" onKeyDown={event => { const ids: RunTab[] = ['report', 'results', 'trace', 'files', 'datasets']; const index = ids.indexOf(runTab); const next = event.key === 'ArrowRight' ? (index + 1) % ids.length : event.key === 'ArrowLeft' ? (index + ids.length - 1) % ids.length : -1; if (next < 0) return; event.preventDefault(); setRunTab(ids[next]); document.getElementById(`evaluation-run-tab-${ids[next]}`)?.focus() }}>{([{ id: 'report', title: '评测报告' }, { id: 'results', title: '逐例结果' }, { id: 'trace', title: '结构化轨迹' }, { id: 'files', title: '轨迹文件' }, { id: 'datasets', title: '决策样本' }] as const).map(item => <button type="button" key={item.id} role="tab" id={`evaluation-run-tab-${item.id}`} aria-selected={runTab === item.id} aria-controls={`evaluation-run-panel-${item.id}`} tabIndex={runTab === item.id ? 0 : -1} onClick={() => setRunTab(item.id)}>{item.title}</button>)}</div>
        <div role="tabpanel" id="evaluation-run-panel-report" aria-labelledby="evaluation-run-tab-report" hidden={runTab !== 'report'}>{reportError && <p role="alert">报告读取失败：{reportError}</p>}{report?.present ? <div className="harness-eval-report"><MarkdownDelegateProvider openFile={path => void openFile(path)}><MarkdownText text={report.content} labels={markdownLabels} /></MarkdownDelegateProvider></div> : !runLoading && !reportError && <Empty>{sealed ? '此历史 Run 未保存 report.md。可查看逐例结果并下载已保存的证据。' : '评测尚未封存，报告将在运行结束后生成。可先查看逐例结果与任务日志。'}</Empty>}{runDetail && <Raw value={runDetail} title="Run 原始结构化记录" />}</div>
        <div role="tabpanel" id="evaluation-run-panel-results" aria-labelledby="evaluation-run-tab-results" hidden={runTab !== 'results'}>{runDetail?.cases?.length ? <><label className="harness-eval-field">选择 Case<select aria-label="Run 结果用例" value={resultCaseId} onChange={event => { setResultCaseId(event.target.value); onNavigate?.(location({ case_id: event.target.value })) }}>{runDetail.cases.map((item: any) => <option key={item.case_id} value={item.case_id}>{item.case_id} · {item.frozen?.title || '未记录标题'}</option>)}</select></label>{selectedResult && <><button disabled={!runDetail?.manifest?.experiment_id} onClick={() => setNewCase({ agent: runDetail.manifest.agent_id, experiment: runDetail.manifest.experiment_id, source: { run_id: runId, case_id: selectedResult.case_id } })}>从此 Run 创建用例草稿</button><RunCase item={selectedResult} onEvidence={path => void openFile(path)} /></>}</> : <Empty>此 Run 尚无逐例记录。</Empty>}</div>
        <div role="tabpanel" id="evaluation-run-panel-trace" aria-labelledby="evaluation-run-tab-trace" hidden={runTab !== 'trace'}>{runTab === 'trace' && <RunTraceView send={call} runId={runId} onEvidence={path => void openFile(path)}/>}</div>
        <div role="tabpanel" id="evaluation-run-panel-datasets" aria-labelledby="evaluation-run-tab-datasets" hidden={runTab !== 'datasets'}><DecisionDatasetView key={datasetEpoch} rpc={rpc} runId={runId} active={active && tab === 'runs' && runTab === 'datasets'} updates={updates} onDirty={setDatasetDirty} onBusy={setDatasetBusy}/></div>
        <div role="tabpanel" id="evaluation-run-panel-files" aria-labelledby="evaluation-run-tab-files" hidden={runTab !== 'files'}>{filesError && <p role="alert">{filesError}</p>}<p className="harness-eval-note">文件清单来自实际保存的 Run 目录。文本预览最多显示前 64 KiB；下载保留完整内容并脱敏。</p>{runFiles?.coverage && <Raw value={runFiles.coverage} title="导出覆盖与采集限制" />}<input aria-label="筛选轨迹文件" placeholder="搜索路径、Case 或文件名" value={fileSearch} onChange={event => setFileSearch(event.target.value)} /><div className="harness-eval-files-layout"><div className="harness-eval-file-list" aria-label="轨迹文件列表">{(runFiles?.files ?? []).filter((file: RunFile) => file.path.toLowerCase().includes(fileSearch.toLowerCase())).map((file: RunFile) => <button type="button" key={file.path} aria-pressed={filePath === file.path} onClick={() => void openFile(file.path)}><span>{runDetail?.run_path ? file.path.replace(`${runDetail.run_path}/`, '') : file.path}</span><small>{file.size.toLocaleString()} 字节 · {file.kind === 'text' ? '文本' : '二进制'}</small></button>)}</div><article className="harness-eval-file-preview">{fileError && <p role="alert">{fileError}</p>}{filePath ? <><div className="harness-eval-section-heading"><strong>{filePath.split('/').pop()}</strong><a className="harness-eval-download" href={download('file', filePath)} download>下载完整文件</a></div>{selectedFile?.kind === 'binary' ? <p>二进制文件请下载查看。</p> : filePreview ? <>{filePreview.truncated && <p role="status">仅预览前 64 KiB。下载完整文件不受预览限制。</p>}<pre>{filePreview.content || '空文件'}</pre></> : !fileError && <p role="status">正在读取文件…</p>}</> : <Empty>选择文件查看轨迹、工具事件、检查或归因证据。</Empty>}</article></div></div>
      </>}</section>
    </section>
    <section role="tabpanel" id="evaluation-panel-compare" aria-labelledby="evaluation-tab-compare" hidden={tab !== 'compare'}>
      <section className="harness-card"><div className="harness-eval-section-heading"><h2>两次 Run 对照</h2><span className="harness-eval-muted">同一智能体 · 已封存 Run</span></div><div className="harness-eval-compare-controls"><label>左侧 Run<select aria-label="左侧 Run" value={leftRun} onChange={event => { compareRequest.current++; setLeftRun(event.target.value); setRightRun(''); setComparison(null); setCompareBusy(false) }}><option value="">选择基准 Run</option>{compareRunsOptions.map(run => <option key={run.run_id} value={run.run_id}>{run.agent_id} · {run.run_id}</option>)}</select></label><label>右侧 Run<select aria-label="右侧 Run" value={rightRun} disabled={!leftRun} onChange={event => { compareRequest.current++; setRightRun(event.target.value); setComparison(null); setCompareBusy(false) }}><option value="">选择对照 Run</option>{compareRunsOptions.filter(run => run.agent_id === leftAgent && run.run_id !== leftRun).map(run => <option key={run.run_id} value={run.run_id}>{run.experiment_id} · {run.run_id}</option>)}</select></label><button type="button" className="harness-primary" disabled={!leftRun || !rightRun || compareBusy} onClick={() => void compareRuns()}>{compareBusy ? '比较中…' : '开始比较'}</button></div><p className="harness-eval-note">观察性对照需结合输入、模型、执行器与环境判断；记录差异不能单独证明 Harness 导致效果变化。</p>{compareError && <p role="alert">{compareError}</p>}{comparison && <><RunComparisonFacts comparison={comparison} onNavigate={onNavigate}/><div className="harness-eval-compare-grid">{[['左侧', comparison.left_view], ['右侧', comparison.right_view]].map(([name, value]) => <article key={name as string} className="harness-eval-comparison-summary"><h3>{name as string} · {(value as any).run_id}</h3><Facts items={[["版本", (value as any).manifest.experiment_id], ["状态", label((value as any).manifest.status)], ["结论", label((value as any).summary?.effective_verdict ?? (value as any).summary?.overall_verdict)], ["执行器", (value as any).source.executor], ["预期模型", (value as any).source.model], ["Git", (value as any).source.git_version?.commit], ["工作树含未提交改动", (value as any).source.git_version?.dirty]]} /></article>)}</div><p>仅左侧用例：{comparison.left_only?.join('、') || '无'}；仅右侧用例：{comparison.right_only?.join('、') || '无'}。</p>{comparison.limits?.length > 0 && <div className="harness-eval-limits"><strong>对照限制</strong><ul>{comparison.limits.map((value: string) => <li key={value}>{value}</li>)}</ul></div>}<label className="harness-eval-field">共同 Case<select aria-label="对照用例" value={compareCaseId} onChange={event => setCompareCaseId(event.target.value)}>{comparison.cases?.map((item: any) => <option key={item.case_id} value={item.case_id}>{item.case_id} · {item.observed_change}</option>)}</select></label>{selectedComparison ? <><p><strong>{selectedComparison.observed_change}</strong> · 冻结用例口径{selectedComparison.frozen_contract_same ? '相同' : '不同'}</p><div className="harness-eval-compare-grid">{[comparison.left_view, comparison.right_view].map((value: any) => { const item = value.cases.find((entry: any) => entry.case_id === compareCaseId); return <article key={value.run_id} className="harness-eval-comparison-side"><h3>{value.run_id}</h3>{item && <RunCase item={item} onEvidence={path => { pendingEvidence.current = { run: value.run_id, path }; chooseRun(value.run_id, 'runs'); if (runId === value.run_id) { pendingEvidence.current = null; void openFile(path) } }} />}</article> })}</div></> : <Empty>这两次 Run 没有可对照的共同 Case。</Empty>}<Raw value={comparison} title="完整对照记录与来源条件" /></>}</section>
    </section>
    {newCase && <CaseCreationDialog rpc={rpc} active={active} onDirty={setNewCaseDirty} onBusy={setNewCaseBusy} agentId={newCase.agent} experimentId={newCase.experiment} sourceRun={newCase.source} onClose={() => setNewCase(null)} onSaved={document => {
      resetScope(newCase.agent, newCase.experiment); setTab('cases'); setCaseId(document.case.id); setCaseDocument(document); setCaseDraft(draftFor(document)); setCaseMessage('已新增用例，后续评测立即使用；历史 Run 冻结口径保持。')
      onNavigate?.({ page: 'evaluation', tab: 'cases', agent_id: newCase.agent, experiment_id: newCase.experiment, case_id: document.case.id })
      updates?.invalidate(['agents', 'catalog'])
    }}/>}
    <dialog ref={configDialog} className="harness-eval-drawer" aria-labelledby="evaluation-config-title" onCancel={event => { if (evalBusy) event.preventDefault(); else setConfigOpen(false) }}><div className="harness-eval-section-heading"><h2 id="evaluation-config-title">新建评测</h2><button type="button" disabled={evalBusy} onClick={() => setConfigOpen(false)}>关闭</button></div><div className="harness-eval-dialog-body"><p className="harness-eval-muted">选择研究版本、执行范围和评审方式，再启动独立 Run。</p><div className="harness-eval-editor"><label>智能体<select aria-label="新建评测智能体" disabled={evalBusy} value={agentId} onChange={event => { changeScope(event.target.value); setConfigOpen(true) }}><option value="">请选择</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.id}</option>)}</select></label><label>研究版本<select aria-label="新建评测版本" disabled={!agentId || detailLoading || evalBusy} value={experimentId} onChange={event => { changeScope(agentId, event.target.value); setConfigOpen(true) }}><option value="">请选择具体版本</option>{versions.map(id => <option key={id} value={id}>{id}</option>)}</select></label><label>模式<select value={mode} disabled={evalBusy} onChange={event => { setMode(event.target.value); clearPreview() }}><option value="fast">快速评测（fast）</option><option value="full">完整评测（full）</option></select></label><label>执行器<select value={executor} disabled={evalBusy} onChange={event => { setExecutor(event.target.value); clearPreview() }}><option value="api">API</option><option value="browser">浏览器</option></select></label><label>评审<select value={review} disabled={evalBusy} onChange={event => { setReview(event.target.value); clearPreview() }}><option value="none">不请求 AI 复核</option><option value="ai">AI 证据复核</option></select></label></div><p>{selectedCases.length ? `显式选中 ${selectedCases.length} 个用例：${selectedCases.join('、')}` : `未显式勾选用例，将按 ${mode} 模式选择。`}</p>{caseDirty && <p role="alert">用例草稿尚未保存，本次评测将使用已保存的定义。</p>}{detailError && <p role="alert">{detailError}</p>}{evalError && <p role="alert">{evalError}</p>}{evalPreview && <section className="harness-eval-preview"><h3>执行预览</h3><Facts items={[["用例数量", evalPreview.case_ids?.length], ["模式", evalPreview.mode], ["执行器", evalPreview.executor]]} />{evalPreview.case_ids?.length > 0 && <p>{evalPreview.case_ids.join('、')}</p>}{evalPreview.missing_env_names?.length > 0 && <p role="alert">缺少环境变量：{evalPreview.missing_env_names.join('、')}</p>}<Raw value={evalPreview} title="预览完整配置" /></section>}</div><div className="harness-eval-actions harness-eval-dialog-footer"><button type="button" disabled={!experimentId || evalBusy || detailLoading} onClick={() => void previewEvaluation()}>执行预览</button><button type="button" className="harness-primary" disabled={!experimentId || evalBusy || detailLoading} onClick={() => void startEvaluation()}>{evalBusy ? '处理中…' : '启动评测'}</button></div></dialog>
    <dialog ref={decisionDialog} className="harness-eval-decision-dialog" aria-labelledby="evaluation-decision-title" onCancel={event => { event.preventDefault(); closeDecision() }}><div className="harness-eval-section-heading"><h2 id="evaluation-decision-title">记录研究决策</h2><button type="button" disabled={decisionBusy} onClick={closeDecision}>关闭</button></div><div className="harness-eval-dialog-body"><p>绑定研究版本：<strong>{decisionTarget.experiment}</strong></p><label className="harness-eval-field">Decision 正文<textarea aria-label="Decision 正文" rows={16} disabled={decisionBusy || !decision.hash} value={decision.body} onChange={event => setDecision({ ...decision, body: event.target.value })} /></label>{decisionConflict && <p role="alert">Decision 已被其他任务修改，当前草稿已保留。关闭并重新读取后核对合并。</p>}{decisionMessage && <p role="status">{decisionMessage}</p>}</div><div className="harness-eval-actions harness-eval-dialog-footer"><button type="button" className="harness-primary" disabled={decisionBusy || !decision.hash || !decisionDirty} onClick={() => void saveDecision()}>{decisionBusy ? '保存中…' : '保存研究决策'}</button></div></dialog>
  </main>
}
