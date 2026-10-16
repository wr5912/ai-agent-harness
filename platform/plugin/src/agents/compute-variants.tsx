import { useEffect, useRef, useState } from 'react'
import { CHANNEL, type PlatformPageProps } from '../protocol.ts'
import { navigationHash } from '../navigation.ts'
import type { ComputeMetric, ComputePlan } from './compute-variants.ts'

type Result = { ok: true; value: any } | { ok: false; error: { code: string; message: string } }
type Context = {
  experiment_id: string; agent_id: string; parent_ref: string; parent_experiment_id: string | null; fixed_parent_ref: string | null
  plan: ComputePlan | null; variant_kind: string; decision: string
  cases: { case_id: string; title: string }[]
  runs: { run_id: string; experiment_id: string; status: string; created_at: string }[]
}
const labels: Record<ComputeMetric, string> = { model_calls: '已记录模型响应次数', input_tokens: '输入 token（含缓存）', output_tokens: '输出 token', total_tokens: '总 token', elapsed_ms: '主 Session 耗时（毫秒）' }
const display = (value: number | null | undefined) => value === null || value === undefined ? '未知' : Number.isInteger(value) ? String(value) : value.toFixed(2)
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id]

export function ComputeVariantsPanel({ rpc, agentId, experimentId, versions, onCreated, onChanged, onAssistant }: PlatformPageProps & {
  agentId: string; experimentId: string; versions: Array<{ id: string }>; onCreated?: (experimentId: string) => void; onChanged?: () => void
  onAssistant?(task: string, context: Record<string, unknown>): Promise<void>
}) {
  const generation = useRef(0)
  const [context, setContext] = useState<Context | null>(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [manualPreview, setManualPreview] = useState<{ input: Record<string, unknown>; value: any } | null>(null)
  const [createOpen, setCreateOpen] = useState(false), [parent, setParent] = useState(experimentId), [parentRef, setParentRef] = useState('')
  const [strategy, setStrategy] = useState(''), [selectedCases, setSelectedCases] = useState<string[]>([]), [critical, setCritical] = useState<string[]>([])
  const [minimum, setMinimum] = useState(2), [drop, setDrop] = useState(0), [metric, setMetric] = useState<ComputeMetric>('total_tokens'), [reduction, setReduction] = useState(10)
  const [modelChange, setModelChange] = useState(false), [model, setModel] = useState('deepseek-flash'), [reasoning, setReasoning] = useState('off')
  const [parentRuns, setParentRuns] = useState<string[]>([]), [variantRuns, setVariantRuns] = useState<string[]>([])
  const [comparison, setComparison] = useState<any>(null), [humanConfirmed, setHumanConfirmed] = useState(false), [reason, setReason] = useState('')
  async function invoke(method: string, body: Record<string, unknown>) {
    const result = await rpc.call(CHANNEL, `agents/compute-variants/${method}`, body) as Result
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  useEffect(() => {
    const request = ++generation.current
    setBusy(true); setContext(null); setComparison(null); setParentRuns([]); setVariantRuns([]); setParent(experimentId); setError(''); setMessage(''); setCreateOpen(false); setManualPreview(null); setHumanConfirmed(false)
    invoke('context', { experiment_id: experimentId }).then(value => {
      if (request !== generation.current) return
      setContext(value); setParentRef(value.parent_ref); setSelectedCases(value.cases.map((item: any) => item.case_id)); setCritical([])
    }).catch(error => { if (request === generation.current) setError(error.message) })
      .finally(() => { if (request === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [rpc, experimentId])
  async function action(task: () => Promise<void>) {
    const request = generation.current
    setBusy(true); setError(''); setMessage('')
    try { await task() } catch (error) { if (request === generation.current) setError(error instanceof Error ? error.message : '算力变体操作失败') }
    finally { if (request === generation.current) setBusy(false) }
  }
  function changeRuns(side: 'parent' | 'variant', id: string) {
    if (side === 'parent') setParentRuns(values => toggle(values, id)); else setVariantRuns(values => toggle(values, id))
    setComparison(null); setHumanConfirmed(false)
  }
  const comparisonBody = { experiment_id: experimentId, parent_run_ids: parentRuns, variant_run_ids: variantRuns }
  return <section aria-label="算力变体" className="compute-variant-panel">
    <header className="compute-heading"><div><h3>算力变体</h3><p>比较任务效果与资源投入，寻找适合当前业务的运行方案。</p></div><button className="compute-refresh" aria-label="刷新计划与 Run" title="更新当前计划和封存 Run 列表" disabled={busy} onClick={() => void action(async () => {
      const request = generation.current, value = await invoke('context', { experiment_id: experimentId })
      if (request !== generation.current) return
      if (!context) { setParentRef(value.parent_ref); setSelectedCases(value.cases.map((item: any) => item.case_id)); setCritical([]) }
      setContext(value); setComparison(null); setHumanConfirmed(false); setMessage('已更新计划与封存 Run 列表。')
    })}>刷新</button></header>
    <div className="compute-guidance"><div><h4>{context?.plan ? '围绕已有计划继续研究' : '从一份可比较的方案开始'}</h4><p>{context?.plan ? '让 AI 分析已有证据与差异，明确下一步需要补充的实验。' : 'AI 结合固定父版、任务和运行证据制定方案；预览并确认后，才创建探索性变体。'}</p></div><div className="compute-actions">
    <button type="button" className="compute-primary" disabled={busy || !context || !onAssistant} onClick={() => void action(async () => {
      await onAssistant?.(context?.plan
        ? '请使用 compute-variant-research 分析当前算力变体的冻结计划、实际资产和已有 Run；解释效果与资源差异、可比性和缺口，提出下一步。先只读取证，不修改计划、不运行评测，不替我确认近似等效或 end。'
        : '请使用 compute-variant-research，为当前版本策划不同算力需求、效果近似等效的 Harness 变体。读取真实固定父版、任务和已有证据，分析主要资源消耗，提出最小优化策略，并用真实 Case 生成比较计划预览。默认保持 deepseek-flash/off，先只读策划，等待我确认创建。',
      { page: 'agents', tab: 'compute-variants', agent_id: agentId, experiment_id: experimentId, skill: 'compute-variant-research', workflow: 'compute-variants',
        ...(context?.plan ? { parent_run_ids: parentRuns, variant_run_ids: variantRuns } : {}) })
    })}>{context?.plan ? '请 AI 分析算力变体' : '请 AI 策划算力变体'}</button>
      <button type="button" className="compute-secondary" aria-expanded={createOpen} aria-controls="compute-manual-plan" disabled={busy || !context} onClick={() => { setCreateOpen(value => !value); setManualPreview(null) }}>{createOpen ? '收起手动计划' : context?.plan ? '手动派生新变体' : '手动制定计划'}</button>
    </div></div>
    {!context?.plan && <ol className="compute-workflow" aria-label="算力变体研究流程"><li>制定比较计划</li><li>确认并创建变体</li><li>实现策略与评测</li><li>比较并复核结论</li></ol>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!context && !error && <p>正在读取计划与 Run…</p>}
    {createOpen && context && <fieldset id="compute-manual-plan" className="compute-form" disabled={busy} onChange={() => setManualPreview(null)}>
      <legend>手动制定比较计划</legend>
      <p className="agent-muted">与 AI 策划使用同一派生流程。填写后先检查预览，再确认创建。</p>
      <div className="harness-fields">
        <label className="agent-field">完整父版<select value={parent} onChange={event => setParent(event.target.value)}>{versions.map(version => <option key={version.id} value={version.id}>{version.id}</option>)}</select></label>
        <label className="agent-field">可恢复的 Git 父版引用<input value={parentRef} onChange={event => setParentRef(event.target.value)} placeholder="git:<40 位提交>" /></label>
        <label className="agent-field agent-field-wide">策略与研究问题<textarea aria-label="策略与研究问题" value={strategy} onChange={event => setStrategy(event.target.value)} placeholder="例如减少重复查询和上下文，完整保留查询结果；说明哪些行为允许变化。" rows={3} /></label>
      </div>
      <div className="compute-case-table"><table><thead><tr><th>任务范围</th><th>关键任务</th><th>Case</th></tr></thead><tbody>{context.cases.map(item => <tr key={item.case_id}>
        <td><input aria-label={`纳入 ${item.case_id}`} type="checkbox" checked={selectedCases.includes(item.case_id)} onChange={() => { setSelectedCases(values => toggle(values, item.case_id)); setCritical(values => values.filter(value => value !== item.case_id)) }} /></td>
        <td><input aria-label={`关键 ${item.case_id}`} type="checkbox" disabled={!selectedCases.includes(item.case_id)} checked={critical.includes(item.case_id)} onChange={() => setCritical(values => toggle(values, item.case_id))} /></td>
        <td>{item.case_id} · {item.title}</td>
      </tr>)}</tbody></table></div>
      <div className="harness-fields">
        <label className="agent-field">每 Case 每侧最少独立 Run<input type="number" min={1} max={100} value={minimum} onChange={event => setMinimum(Number(event.target.value))} /></label>
        <label className="agent-field">允许通过率下降（百分点）<input type="number" min={0} max={100} value={drop} onChange={event => setDrop(Number(event.target.value))} /></label>
        <label className="agent-field">目标资源指标<select value={metric} onChange={event => setMetric(event.target.value as ComputeMetric)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="agent-field">最低资源改善（%）<input type="number" min={0.01} max={100} step={0.01} value={reduction} onChange={event => setReduction(Number(event.target.value))} /></label>
      </div>
      <label><input type="checkbox" checked={modelChange} onChange={event => setModelChange(event.target.checked)} /> 显式允许模型或推理强度变化</label>
      {modelChange && <div className="harness-fields"><label className="agent-field">目标模型<input value={model} onChange={event => setModel(event.target.value)} /></label><label className="agent-field">目标推理强度<input value={reasoning} onChange={event => setReasoning(event.target.value)} /></label></div>}
      <p className="agent-muted">派生会完整继承固定父版。默认 deepseek-flash / off；此计划不会自动修改模型或业务资产。创建后在 Harness 资产中实现策略，将数据仓库中的计划与 Candidate 提交到 Git，再分别评测父版和变体。已有旧 Run 可查看，但不能追认为预先冻结的比较。</p>
      <div className="compute-actions"><button className="compute-primary" disabled={!strategy.trim() || !selectedCases.length || !parentRef.trim()} onClick={() => void action(async () => {
        const request = generation.current
        const input = { agent_id: agentId, parent_experiment_id: parent, parent_ref: parentRef, strategy, case_ids: selectedCases, critical_case_ids: critical, min_runs_per_case: minimum, max_pass_rate_drop_pp: drop, resource_metric: metric, min_resource_reduction_pct: reduction, allow_model_change: modelChange, variant_model: model, variant_reasoning_effort: reasoning }
        const value = await invoke('preview', input)
        if (request === generation.current) setManualPreview({ input, value })
      })}>预览派生计划</button></div>
      {manualPreview && <div className="compute-plan-preview" role="region" aria-label="派生计划预览">
        <h4>确认这次派生</h4>
        <p>父版：{manualPreview.value.parent_experiment_id}</p>
        <p>任务 {Object.keys(manualPreview.value.plan.case_hashes).length} 项，每侧至少 {manualPreview.value.plan.min_runs_per_case} 次独立 Run；{labels[manualPreview.value.plan.resource_metric as ComputeMetric]} 目标改善 {manualPreview.value.plan.min_resource_reduction_pct}%。</p>
        <p className="agent-muted">将完整继承固定父版并保存研究计划。创建后仍需实现优化策略和独立评测。</p>
        <button className="compute-primary" onClick={() => void action(async () => {
          const request = generation.current
          const value = await invoke('create', { ...manualPreview.input, expected_preview_sha256: manualPreview.value.preview_sha256 })
          if (request !== generation.current) return
          setMessage(`已创建探索变体 ${value.experiment_id}。请实现策略并固定计划后评测。`); setCreateOpen(false); setManualPreview(null); onCreated?.(value.experiment_id); onChanged?.()
        })}>确认创建探索性变体</button>
      </div>}
    </fieldset>}
    {context?.plan && <>
      <p>当前：{context.variant_kind} · Decision {context.decision}；父版：{context.parent_experiment_id}（{context.fixed_parent_ref}）</p>
      <p>{context.plan.strategy}</p>
      <p className="agent-muted">范围：{Object.keys(context.plan.case_hashes).join('、')}；关键任务：{context.plan.critical_case_ids.join('、') || '未指定'}；每侧至少 {context.plan.min_runs_per_case} 次独立 Run；允许下降 {context.plan.max_pass_rate_drop_pp} 个百分点；{labels[context.plan.resource_metric]} 至少改善 {context.plan.min_resource_reduction_pct}%。</p>
      <p className="agent-muted">评测前需在数据仓库提交冻结计划。确认 end 前还需提交当前 Candidate。通过现有“运行评测”分别执行两侧相同 Case；旧 Run 或不足的重复次数会明确显示限制。</p>
      <div className="harness-fields">{(['parent', 'variant'] as const).map(side => {
        const rows = context.runs.filter(run => run.experiment_id === (side === 'parent' ? context.parent_experiment_id : experimentId))
        const selected = side === 'parent' ? parentRuns : variantRuns
        return <fieldset key={side} disabled={busy} className="compute-run-group"><legend>{side === 'parent' ? '父版封存 Run' : '变体封存 Run'}</legend>
          <div className="compute-run-list">{rows.length ? rows.map(run => <label key={run.run_id}><input aria-label={`${side} ${run.run_id}`} type="checkbox" checked={selected.includes(run.run_id)} onChange={() => changeRuns(side, run.run_id)} />{run.run_id} · {run.status}<span className="agent-muted"> {run.created_at}</span></label>) : <p className="agent-muted">尚无封存 Run，请从现有评测入口运行。</p>}</div>
        </fieldset>
      })}</div>
      <button disabled={busy || !parentRuns.length || !variantRuns.length} onClick={() => void action(async () => { const request = generation.current; const value = await invoke('compare', comparisonBody); if (request === generation.current) { setComparison(value); setHumanConfirmed(false) } })}>比较实际效果与资源</button>
    </>}
    {comparison && <div className="compute-comparison">
      <details><summary>打开所选 Run 的完整报告与工具证据</summary><ul>{[...parentRuns, ...variantRuns].map(runId => <li key={runId}><a href={navigationHash({ page: 'evaluation', tab: 'runs', agent_id: agentId, experiment_id: context?.runs.find(run => run.run_id === runId)?.experiment_id, run_id: runId })} target="_blank" rel="noopener noreferrer">{runId}</a></li>)}</ul></details>
      <p role="status">功能质量：{comparison.quality.passed ? '满足预定观察指标' : '未满足或证据不足'}；资源目标：{comparison.resource_evidence.passed ? '满足' : '未满足或未知'}；可比性：{comparison.comparability.passed ? '记录条件一致' : '存在限制'}。</p>
      <div className="compute-table-scroll"><table><thead><tr><th>Case</th><th>独立 Run 父 / 变体</th><th>通过率父 / 变体</th><th>关键任务</th><th>质量</th></tr></thead><tbody>{comparison.quality.cases.map((row: any) => <tr key={row.case_id}><td>{row.case_id}</td><td>{row.parent_runs} / {row.variant_runs}</td><td>{display(row.parent_pass_rate)}% / {display(row.variant_pass_rate)}%</td><td>{row.critical ? '是' : '否'}</td><td>{row.quality_passed ? '满足' : '未满足'}</td></tr>)}</tbody></table></div>
      <div className="compute-table-scroll"><table><thead><tr><th>资源指标（各 Case 等权平均）</th><th>父版</th><th>变体</th><th>改善率</th></tr></thead><tbody>{Object.entries(labels).map(([key, label]) => { const value = comparison.resources[key]; return <tr key={key}><td>{label}</td><td>{display(value.parent)}</td><td>{display(value.variant)}</td><td>{value.reduction_pct === null ? '未知' : `${display(value.reduction_pct)}%`}</td></tr> })}</tbody></table></div>
      {!!comparison.comparability.limits.length && <details open><summary>阻断可比性的证据缺口</summary><ul>{comparison.comparability.limits.map((limit: string) => <li key={limit}>{limit}</li>)}</ul></details>}
      {!!comparison.resource_evidence.limits.length && <details open><summary>资源记录限制</summary><ul>{comparison.resource_evidence.limits.map((limit: string) => <li key={limit}>{limit}</li>)}</ul></details>}
      <div className="agent-muted">{comparison.notes.map((note: string) => <p key={note}>{note}</p>)}</div>
      <label><input aria-label="已审阅完整效果与工具结果" type="checkbox" checked={humanConfirmed} disabled={busy} onChange={event => setHumanConfirmed(event.target.checked)} />我已在评测中心核对所选 Run 的完整输出、工具结果、任务效果和比较限制。</label>
      <label className="agent-field">研究结论及限制<textarea aria-label="变体研究结论" value={reason} onChange={event => setReason(event.target.value)} rows={3} disabled={busy} /></label>
      <div className="agent-actions">{(['continue', 'inconclusive', 'end'] as const).map(decision => <button key={decision} disabled={busy || !humanConfirmed || !reason.trim() || decision === 'end' && !comparison.eligible_for_end} onClick={() => void action(async () => {
        const request = generation.current
        const value = await invoke('confirm', { ...comparisonBody, decision, human_confirmed: humanConfirmed, reason, comparison_sha256: comparison.comparison_sha256 })
        if (request !== generation.current) return
        setMessage(`已记录 Decision ${value.decision}，版本类型 ${value.variant_kind}。`); setComparison(null); setHumanConfirmed(false); const refreshed = await invoke('context', { experiment_id: experimentId }); if (request === generation.current) { setContext(refreshed); onChanged?.() }
      })}>{decision === 'end' ? '确认近似等效并标记 end' : decision === 'continue' ? '记录继续研究' : '记录证据不足'}</button>)}</div>
    </div>}
  </section>
}
