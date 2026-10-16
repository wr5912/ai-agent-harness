import { useEffect, useRef, useState } from 'react'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { CHANNEL } from '../protocol.ts'
import type { CompositionConfig, CompositionEntry, CompositionStep, ThreatBindings, ThreatStage } from './compositions.ts'

export type RegisteredConnection = { id: string; name?: string; kind?: string }
const stages: { id: ThreatStage; title: string }[] = [
  { id: 'collect', title: '取证与路由' }, { id: 'infer', title: '模型研判' },
  { id: 'writeback', title: 'SOC 结果回写' }, { id: 'report', title: '报告保存' },
]
const conditions = { always: '始终', five_source: '需要五源研判', claimed: '已取得认领', completed: '研判已完成' }
export const threatEditorStyle = `
.harness-threat-editor{display:grid;gap:16px;min-width:0}
.harness-threat-editor label{display:grid;gap:8px;min-width:0}
.harness-threat-editor fieldset{border:1px solid var(--hep-border);border-radius:var(--hep-control-radius);padding:20px;display:grid;gap:16px;min-width:0;margin:0}
.harness-threat-editor legend{padding:0 8px;font-weight:500}
.harness-threat-editor input,.harness-threat-editor select,.harness-threat-editor textarea{box-sizing:border-box;width:100%;min-width:0}
.harness-threat-bindings{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:16px}
.harness-threat-step{border-top:1px solid var(--hep-border);padding-top:20px;display:grid;gap:16px;min-width:0}
.harness-threat-step header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.harness-threat-step textarea{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;min-height:100px;resize:vertical}
.harness-threat-run{display:grid;gap:16px;margin-top:24px}
.harness-threat-run p{margin:0}
.harness-threat-run pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}
.harness-threat-run dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:16px 24px;margin:0}
.harness-threat-run dl>div{min-width:0;padding-bottom:12px;border-bottom:1px solid var(--hep-border)}
.harness-threat-run dt{color:var(--hep-muted);font-size:12px}
.harness-threat-run dd{margin:6px 0 0;overflow-wrap:anywhere}
.harness-threat-run li{margin:12px 0;overflow-wrap:anywhere}
.harness-threat-run [role=alert]{color:var(--dsw-alias-danger-text,#9c312b)}
@media(max-width:680px){.harness-threat-editor fieldset{padding:16px}}
`

export function isThreatComposition(config?: CompositionConfig | null) { return config?.kind === 'threat-stage' || config?.kind === 'composite' }
export function compositionTestInput(config: CompositionConfig | undefined, value: string) {
  return isThreatComposition(config) ? { [config?.kind === 'threat-stage' && config.stage !== 'collect' ? 'run_id' : 'incident_id']: value.trim() } : { asset: value, limit: 5 }
}

function ConnectionField({ title, value, connections, change }: { title: string; value: string; connections: RegisteredConnection[]; change(value: string): void }) {
  return <label>{title}<select required value={value} onChange={event => change(event.target.value)}>
    <option value="">请选择已登记连接</option>
    {value && !connections.some(item => item.id === value) && <option value={value}>{value}（未登记）</option>}
    {connections.map(item => <option key={item.id} value={item.id}>{item.name || item.id}（{item.id}）</option>)}
  </select></label>
}

function BindingsFields({ value, change, connections, model = true }: { value: ThreatBindings; change(value: ThreatBindings): void; connections: RegisteredConnection[]; model?: boolean }) {
  return <fieldset><legend>已登记的外部连接{model && '与模型'}</legend><div className="harness-threat-bindings">
    <ConnectionField title="SOC 取证与回写连接" value={value.socConnectionId} connections={connections} change={socConnectionId => change({ ...value, socConnectionId })}/>
    <ConnectionField title="报告 MCP 连接" value={value.reportConnectionId} connections={connections} change={reportConnectionId => change({ ...value, reportConnectionId })}/>
  </div>{model && <><label>模型路由<select value={value.model ? 'explicit' : 'default'} onChange={event => change({ ...value, model: event.target.value === 'default' ? undefined : { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' } })}>
    <option value="default">使用平台默认模型</option><option value="explicit">指定模型</option>
  </select></label>{value.model ? <div className="harness-threat-bindings">
    <label>Provider<input required value={value.model.provider} onChange={event => change({ ...value, model: { ...value.model!, provider: event.target.value } })}/></label>
    <label>模型<input required value={value.model.model} onChange={event => change({ ...value, model: { ...value.model!, model: event.target.value } })}/></label>
    <label>推理强度<select value={value.model.reasoningEffort ?? 'off'} onChange={event => change({ ...value, model: { ...value.model!, reasoningEffort: event.target.value } })}>{['off', 'low', 'high', 'max'].map(effort => <option key={effort}>{effort}</option>)}</select></label>
  </div> : <p>首次模型研判时解析平台当前默认模型及推理强度，随后冻结；模型凭据由平台原生配置提供。</p>}</>}</fieldset>
}

export function ThreatSeedForm({ connections, busy, create, cancel }: { connections: RegisteredConnection[]; busy: boolean; create(bindings: ThreatBindings): void; cancel(): void }) {
  const [bindings, setBindings] = useState<ThreatBindings>({ socConnectionId: '', reportConnectionId: '' })
  return <form className="harness-threat-editor" onSubmit={event => { event.preventDefault(); create(bindings) }}>
    <h3>创建威胁分析样例草稿</h3><p>创建取证、研判、回写、报告四个子组合和一个总组合。先分别发布子组合，再为总组合选择固定的发布版本；本操作不会执行业务调用。模型设置仅用于研判子组合。</p>
    <BindingsFields value={bindings} change={setBindings} connections={connections}/>
    <div className="harness-mcp-actions"><button type="submit" disabled={busy}>创建五个草稿</button><button type="button" disabled={busy} onClick={cancel}>取消</button></div>
  </form>
}

function InputMapping({ value, change }: { value: Record<string, unknown>; change(value: Record<string, unknown>): void }) {
  const [text, setText] = useState(JSON.stringify(value, null, 2))
  const [error, setError] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(''); field.current?.setCustomValidity('') }, [value])
  return <label>输入映射 JSON<textarea ref={field} required aria-invalid={Boolean(error)} value={text} onChange={event => {
    setText(event.target.value)
    try {
      const parsed = JSON.parse(event.target.value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      event.currentTarget.setCustomValidity(''); setError(''); change(parsed)
    } catch { const message = '输入映射必须是 JSON 对象'; event.currentTarget.setCustomValidity(message); setError(message) }
  }}/>{error && <small role="alert">{error}</small>}</label>
}

export function ThreatConfigurationFields({ value, change, connections, entries, compositionId }: { value: CompositionConfig; change(value: CompositionConfig): void; connections: RegisteredConnection[]; entries: CompositionEntry[]; compositionId?: string }) {
  const updateStep = (index: number, patch: Partial<CompositionStep>) => change({ ...value, steps: value.steps!.map((step, at) => at === index ? { ...step, ...patch } : step) })
  return <div className="harness-threat-editor">
    {value.kind === 'threat-stage' ? <>
      <label>业务阶段<select required value={value.stage ?? ''} onChange={event => change({ ...value, stage: event.target.value as ThreatStage, bindings: value.bindings ? { ...value.bindings, model: event.target.value === 'infer' ? value.bindings.model : undefined } : undefined })}>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.title}</option>)}</select></label>
      <BindingsFields value={value.bindings ?? { socConnectionId: '', reportConnectionId: '' }} change={bindings => change({ ...value, bindings })} connections={connections} model={value.stage === 'infer'}/>
    </> : <fieldset><legend>调用已发布的子组合版本</legend><p>引用固定版本，不会随子组合再次发布自动变化。输入映射可使用 <code>$input.incident_id</code>、<code>$steps.collect.run_id</code> 或基本常量。</p>
      {(value.steps ?? []).map((step, index) => <section className="harness-threat-step" key={index}>
        <header><strong>步骤 {index + 1}</strong><div className="harness-mcp-actions"><button type="button" disabled={index === 0} onClick={() => { const steps = [...value.steps!]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; change({ ...value, steps }) }}>上移</button><button type="button" disabled={value.steps!.length === 1} onClick={() => change({ ...value, steps: value.steps!.filter((_, at) => at !== index) })}>移除</button></div></header>
        <div className="harness-threat-bindings"><label>步骤 ID<input required pattern="[A-Za-z][A-Za-z0-9_\-]*" maxLength={64} value={step.id} onChange={event => updateStep(index, { id: event.target.value })}/></label>
          <label>已发布子组合<select required value={step.compositionId} onChange={event => updateStep(index, { compositionId: event.target.value, versionId: '' })}><option value="">请选择子组合</option>{step.compositionId && !entries.some(entry => entry.id === step.compositionId && entry.versions?.length) && <option value={step.compositionId}>{step.compositionId}（尚未发布）</option>}{entries.filter(entry => entry.id !== compositionId && entry.versions?.length).map(entry => <option key={entry.id} value={entry.id}>{entry.published?.title ?? entry.id}</option>)}</select></label>
          <label>固定发布版本<select value={step.versionId} onChange={event => updateStep(index, { versionId: event.target.value })}><option value="">草稿可暂不选择，发布前须指定版本</option>{entries.find(entry => entry.id === step.compositionId)?.versions?.map(version => <option key={version.versionId} value={version.versionId}>{version.versionId.slice(0, 12)} · {version.publishedAt ?? '发布时间未记录'}</option>)}</select></label>
          <label>执行条件<select value={step.when ?? 'always'} onChange={event => updateStep(index, { when: event.target.value as CompositionStep['when'] })}>{Object.entries(conditions).map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select></label>
        </div><InputMapping value={step.inputMap} change={inputMap => updateStep(index, { inputMap })}/>
      </section>)}
      <button type="button" onClick={() => { const used = new Set(value.steps?.map(step => step.id)); let index = (value.steps?.length ?? 0) + 1; while (used.has(`step${index}`)) index++; change({ ...value, steps: [...(value.steps ?? []), { id: `step${index}`, compositionId: '', versionId: '', inputMap: {}, when: 'always' }] }) }}>增加子步骤</button>
    </fieldset>}
    <p>同一次运行须使用相同的 SOC、报告连接；模型只在首次研判时解析并冻结，取证阶段不调用模型。</p>
    <p>保存草稿后显示实际编译的节点与连线；发布前仍会校验连接、映射及固定版本。</p>
  </div>
}

function reportLink(value: unknown) {
  if (typeof value !== 'string') return undefined
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

export function ThreatRunResult({ rpc, execution }: { rpc: ClientConnectionRpc; execution: any }) {
  const initial = execution?.result
  const [run, setRun] = useState<any>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [artifact, setArtifact] = useState<{ filename: string; contentType: string; body: string } | null>(null)
  const [download, setDownload] = useState('')
  const request = useRef(0)
  useEffect(() => { request.current++; setRun(initial); setArtifact(null); setError(''); setBusy(false); return () => { request.current++ } }, [initial])
  useEffect(() => {
    if (!artifact) { setDownload(''); return }
    const url = URL.createObjectURL(new Blob([artifact.body], { type: artifact.contentType }))
    setDownload(url)
    return () => URL.revokeObjectURL(url)
  }, [artifact])
  async function read(endpoint: string, payload: Record<string, unknown>) {
    const id = ++request.current
    setBusy(true); setError('')
    try {
      const response = await rpc.call(CHANNEL, `mcp/${endpoint}`, payload)
      if (id !== request.current) return
      if (!response.ok) throw new Error(response.error.message)
      if (endpoint === 'compositionRun') setRun(response.value)
      else setArtifact(response.value as any)
    } catch (failure) { if (id === request.current) setError(failure instanceof Error ? failure.message : '无法读取运行产物') }
    finally { if (id === request.current) setBusy(false) }
  }
  const storage = run?.delivery?.storage ?? run?.storage
  const link = reportLink(storage?.report?.download_url)
  const traces = run?.trace ?? []
  return <section className="harness-threat-run" aria-label="威胁分析运行结果">
    <p role="status">阶段状态：{run?.phase_status ?? '未提供'} · 研判状态：{run?.status ?? '未提供'}</p>
    <p>阶段返回不代表整体研判、SOC 回写和报告保存均成功，请分别核对下列实际状态。</p>
    {run?.validation?.status === 'failed' && <p role="alert"><strong>输出校验未通过，以下模型内容需要人工复核，不能视为已核实结论。</strong></p>}
    {execution?.error && <p role="alert">{execution.error.message}</p>}
    {error && <p role="alert">{error}</p>}
    <dl>{[['事件 ID', run?.incident_id], ['运行 ID', run?.run_id], ['路由', run?.route], ['内层模型已调用', run?.llm_invoked === undefined ? undefined : String(run.llm_invoked)], ['模型', run?.model], ['输出校验', run?.validation?.status], ['SOC 摘要存储', storage?.summary?.status], ['报告存储', storage?.report?.status]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '未提供'}</dd></div>)}</dl>
    {run?.run_id && <button type="button" disabled={busy} onClick={() => void read('compositionRun', { run_id: run.run_id })}>刷新运行上下文</button>}
    {run?.delivery?.markdown && <details open><summary>本次程序摘要</summary><pre>{run.delivery.markdown}</pre></details>}
    {link && <a href={link} target="_blank" rel="noreferrer">下载已保存报告</a>}
    <h4>实际父子调用轨迹</h4>{traces.length ? <ol>{traces.map((trace: any, index: number) => <li key={index}><strong>{trace.title ?? trace.stage ?? trace.step ?? trace.compositionId ?? `节点 ${index + 1}`}</strong> · {trace.status ?? trace.phase_status ?? '未提供'}<details><summary>节点回执与参数</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details></li>)}</ol> : <p>尚无节点执行轨迹。</p>}
    {initial?.stepValues && <details><summary>父组合调用与各子组合原始结果</summary><pre>{JSON.stringify({ trace: initial.trace, stepValues: initial.stepValues }, null, 2)}</pre></details>}
    {run?.artifacts?.length > 0 && <><h4>冻结输入与运行产物</h4><ul>{run.artifacts.map((item: any) => <li key={item.id}><button type="button" disabled={busy} onClick={() => void read('compositionArtifact', { run_id: run.run_id, artifactId: item.id })}>{item.name ?? item.id}</button> · {item.content_type ?? ''} · {item.bytes ?? '未知'} 字节</li>)}</ul></>}
    {artifact && <details open><summary>{artifact.filename}</summary>{download && <a href={download} download={artifact.filename}>下载此产物</a>}<pre>{artifact.body}</pre></details>}
    <details><summary>完整运行状态与执行版本</summary><pre>{JSON.stringify({ run, receipts: execution?.receipts, version: execution?.version }, null, 2)}</pre></details>
  </section>
}
