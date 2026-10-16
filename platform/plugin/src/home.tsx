import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Catalog } from './catalog.ts'
import type { PageId, PlatformNavigation, PlatformPageProps } from './protocol.ts'
import type { RecentRun } from './dashboard.ts'
import { CHANNEL } from './protocol.ts'
import type { PlatformUpdates } from './realtime/client.ts'
import { PlatformLogo } from './logo.tsx'
import { BUILD_PLACEHOLDER, DEMO_AGENT, DEMO_BUILD_PROMPT, DEMO_CASE, HOME_MODES, HOME_SUBTITLE, homeTaskRequest, type HomeMode } from './home-entry.ts'
export { PlatformLogo } from './logo.tsx'

export type { PageId } from './protocol.ts'
type Observation<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
interface Dashboard {
  recent_runs: RecentRun[]
  instances: Observation<{ instances: { state: string }[] }>
  mcp: Observation<{ connections: unknown[] }>
}
function HeroArt({ side }: { side: string }) {
  return <svg className={`harness-hero-art ${side}`} viewBox="0 0 180 220" aria-hidden="true">
    <defs><linearGradient id={`cube-${side}`} x2="1" y2="1"><stop stopColor="#e0f5ff"/><stop offset="1" stopColor="#62b2ff"/></linearGradient></defs>
    <path d="M8 66h50v40h34v58h64M10 194h64v-32h82" fill="none" stroke="#bfdcff" strokeWidth="1.5"/>
    <path d="m36 75 53-30 53 30v63l-53 30-53-30z" fill={`url(#cube-${side})`} stroke="#80beff"/>
    <path d="m36 75 53 30 53-30M89 105v63" fill="none" stroke="#f2fbff" strokeWidth="2"/>
    <rect x="108" y="9" width="35" height="35" rx="10" fill="#e4f2ff"/><path d="m118 21 5 5-5 5m9 0h8" stroke="#58a1f2" fill="none" strokeWidth="2"/>
    <circle cx="22" cy="169" r="17" fill="#e5f3ff"/><path d="M15 169h14m-7-7v14" stroke="#64abed" strokeWidth="2"/>
  </svg>
}

export function HomePage({ catalog, rpc, updates, navigate, startConversation }: PlatformPageProps & { catalog: Catalog; updates: PlatformUpdates; navigate: (page: PageId | PlatformNavigation) => void; startConversation: (root: string, prompt: string, context?: Record<string, unknown>) => Promise<void> }) {
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const [revision, setRevision] = useState(0)
  useEffect(() => updates.subscribe(() => {
    const snapshot = updates.getSnapshot()
    if (snapshot.domains.some(domain => domain === 'catalog' || domain === 'agents' || domain === 'instances' || domain === 'mcp')) setRevision(snapshot.revision)
  }), [updates])
  const [runs, setRuns] = useState<RecentRun[]>()
  const [dashboard, setDashboard] = useState<Dashboard>()
  const [runError, setRunError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [mode, setMode] = useState<HomeMode>('build')
  const [drafts, setDrafts] = useState<Record<HomeMode, string>>({ build: '', evaluate: '', improve: '' })
  const prompt = drafts[mode]
  const promptRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = promptRef.current
    if (!input) return
    const resize = () => {
      input.style.height = 'auto'
      if (input.value) input.style.height = `${input.scrollHeight}px`
    }
    resize()
    let width = input.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const current = input.getBoundingClientRect().width
      if (current !== width) { width = current; resize() }
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [mode, prompt])
  const [exampleOpen, setExampleOpen] = useState(false)
  const [exampleLoading, setExampleLoading] = useState(false)
  const [exampleError, setExampleError] = useState('')
  const [exampleSources, setExampleSources] = useState<{ source: string; experiment_id: string; active: boolean }[]>([])
  const [exampleSource, setExampleSource] = useState('')
  const [sending, setSending] = useState(false)
  const [entryError, setEntryError] = useState('')
  useEffect(() => { void catalog.refresh() }, [catalog, refresh])
  useEffect(() => {
    let active = true
    setRunError('')
    void rpc.call(CHANNEL, 'home', {}).then(result => {
      if (!active) return
      if (result.ok) {
        const data = result.value as Dashboard
        setRuns(data.recent_runs)
        setDashboard(data)
      }
      else setRunError(result.error.message)
    }).catch(() => { if (active) setRunError('无法连接 Run 查询，请刷新重试。') })
    return () => { active = false }
  }, [rpc, refresh, revision])
  const assets = state.inventory
  const selectedExample = exampleSources.find(source => source.source === exampleSource)
  const runLabel = (run: RecentRun) => run.effective_verdict === 'failed' ? '业务未通过' : run.effective_verdict === 'inconclusive' ? '结果待核实' : ({ completed: '已完成', failed: '运行失败', cancelled: '已取消', running: '运行中', planned: '计划中' } as Record<string, string>)[run.status ?? ''] ?? '状态未记录'
  const versionName = (id: string) => '版本 ' + (/-([0-9]{3})(?:-r[0-9a-f]{12})?$/.exec(id)?.[1] ?? id)
  async function enterTask(request: ReturnType<typeof homeTaskRequest>) {
    if (!assets) throw new Error('工作区尚未读取完成，请稍后重试。')
    await startConversation(assets.root, request.prompt, request.context)
    navigate('conversations')
  }
  async function submitTask() {
    if (sending) return
    setEntryError(''); setSending(true)
    try {
      await enterTask(homeTaskRequest(mode, prompt))
    } catch (error) { setEntryError(error instanceof Error ? error.message : '无法开始任务，请重试。') }
    finally { setSending(false) }
  }
  async function showExample() {
    setExampleOpen(value => !value)
    if (exampleOpen || exampleLoading) return
    setExampleLoading(true); setExampleError(''); setExampleSources([]); setExampleSource('')
    try {
      if (!assets?.agents.some(agent => agent.id === DEMO_AGENT)) return
      const result = await rpc.call(CHANNEL, 'agents/tasks/capabilities', { agent_id: DEMO_AGENT })
      if (!result.ok) throw new Error(result.error.message)
      const found = ((result.value as any).sources ?? []).filter((source: any) => source.plugins?.some((plugin: any) => plugin.plugin_names?.some((name: string) => name.endsWith('/task-example-tools.mjs'))))
      const inspected = await Promise.all(found.map(async (source: any) => {
        const detail = await rpc.call(CHANNEL, 'agents/detail', { agent_id: DEMO_AGENT, experiment_id: source.experiment_id })
        if (!detail.ok) throw new Error(detail.error.message)
        const value = detail.value as any
        return value.evaluation?.cases?.some((item: any) => item.id === DEMO_CASE) ? { ...source, active: value.agent?.manifest?.active_experiment === source.experiment_id } : null
      }))
      const ready = inspected.filter(Boolean)
      setExampleSources(ready)
      if (ready.length) setExampleSource((ready.find(source => source.active) ?? ready[0]).source)
    } catch (error) { setExampleError(error instanceof Error ? error.message : '示例资产暂时无法读取。') }
    finally { setExampleLoading(false) }
  }
  async function launchExample() {
    if (sending) return
    setSending(true); setExampleError('')
    try {
      const source = exampleSources.find(item => item.source === exampleSource)
      if (!source) throw new Error('请选择实际已安装的示例版本。')
      const result = await rpc.call(CHANNEL, 'agents/detail', { agent_id: DEMO_AGENT, experiment_id: source.experiment_id })
      if (!result.ok) throw new Error(result.error.message)
      if (!(result.value as any).evaluation?.cases?.some((item: any) => item.id === DEMO_CASE)) throw new Error('示例版本缺少完整分页与报告的业务测试，请先在评测中心核对。')
      await enterTask({ prompt: '请体验当前工作区已经绑定的基础资产台账巡检示例：先核对实际来源和 Mock 服务，按约定业务测试读取全部分页，交付本轮实际生成的完整报告及下载。只使用基础模拟台账，不修改设备，也不称为真实设备健康检测；服务不可用时如实说明。',
        context: { page: 'home', skill: 'task-builder', workflow: 'example', entry_intent: 'example', agent_id: DEMO_AGENT, experiment_id: source.experiment_id,
          source: source.source, evaluation_case_ids: [DEMO_CASE], source_kind: 'basic_mock', max_repair_rounds: 3 } })
    } catch (error) { setExampleError(error instanceof Error ? error.message : '无法开始示例。') }
    finally { setSending(false) }
  }
  const running = dashboard?.instances.ok ? dashboard.instances.value.instances.filter(item => item.state === 'running').length : undefined
  return <main className="harness-home">
    <section className="harness-hero">
      <HeroArt side="left"/><HeroArt side="right"/>
      <h1>让AI帮您管理、评测和改进智能体</h1>
      <p>{HOME_SUBTITLE}</p>
      <div className="harness-task-composer">
        <div className="harness-entry-modes" role="group" aria-label="任务类型">{HOME_MODES.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} disabled={sending} onClick={() => { setMode(item.id); setEntryError('') }}>{item.label}</button>)}</div>
        <form className="harness-entry" onSubmit={event => { event.preventDefault(); void submitTask() }}>
          <textarea ref={promptRef} rows={1} aria-label="业务任务" placeholder={mode === 'build' ? BUILD_PLACEHOLDER : mode === 'evaluate' ? '描述要评测的智能体和业务能力，例如评测巡检助手能否完整统计全部设备。' : '描述希望改进或优化的任务，例如让巡检报告覆盖全部设备，或减少行业简报中的重复信息。'} value={prompt} disabled={sending}
            onChange={event => setDrafts(value => ({ ...value, [mode]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submitTask() } }}/>
          <div className="harness-entry-footer"><span>{mode === 'build' ? '先理解任务和复用能力，再确认执行范围。' : mode === 'evaluate' ? '先查询智能体和已有测试，确认范围后运行评测。' : '先查已有资产和记录，确认优化目标；最多修复 3 轮。'}</span><button className="harness-primary" type="submit" disabled={sending || !assets || mode === 'build' && !prompt.trim()}>{sending ? '正在进入…' : HOME_MODES.find(item => item.id === mode)!.action}</button></div>
        </form>
        {mode === 'evaluate' && assets && !assets.agents.length && <p>还没有业务智能体。<button type="button" onClick={() => setMode('build')}>先构建一个</button></p>}
        {entryError && <p role="alert">{entryError}</p>}
      </div>
      <button className="harness-example-toggle" type="button" aria-expanded={exampleOpen} disabled={!assets || exampleLoading} onClick={() => void showExample()}>体验示例 <span aria-hidden="true">→</span></button>
      {exampleOpen && <section className="harness-example" aria-label="基础资产巡检体验示例"><strong>基础资产台账巡检</strong><p>读取五台基础模拟资产，处理分页并生成报告。使用 Mock 台账数据，不代表连接或检测真实设备。</p>
        {exampleLoading ? <p role="status">正在核对当前工作区的示例资产…</p> : exampleSources.length ? <>{selectedExample && <p>将使用{versionName(selectedExample.experiment_id)}{selectedExample.active ? '（当前启用）' : ''}；开始后将核对服务和实际任务结果。</p>}{exampleSources.length > 1 && <details aria-label="可选示例版本"><summary>更换示例版本</summary><label>示例版本<select aria-label="巡检示例版本" value={exampleSource} onChange={event => setExampleSource(event.target.value)}>{exampleSources.map(source => <option key={source.source} value={source.source}>{versionName(source.experiment_id)}{source.active ? ' · 当前启用' : ''}</option>)}</select></label></details>}<button type="button" disabled={sending || !selectedExample} onClick={() => void launchExample()}>开始体验</button></> : exampleError ? <p>暂时无法核对示例资产，请稍后重新打开体验入口。</p> : <><p>当前工作区尚未安装带工具的巡检示例。可以先构建一个只整理用户给定模拟数据的智能体，或到智能体管理接入已有版本。</p><div><button type="button" onClick={() => { setMode('build'); setDrafts(value => ({ ...value, build: DEMO_BUILD_PROMPT })); setExampleOpen(false) }}>构建一个基础示例</button><button type="button" onClick={() => navigate('agents')}>查看智能体管理</button></div></>}
        {exampleError && <p role="alert">{exampleError}</p>}
      </section>}
    </section>
    {state.status === 'error' && <p role="alert">{state.error}{assets && ' 保留上次查询结果。'}</p>}
    {!assets && state.status !== 'error' && <p role="status">正在读取仓库…</p>}
    <div className="harness-stats">
      {([{ label: '智能体', count: assets?.agents.length, page: 'agents', note: '研究与持续改进' },
        { label: '研究版本', count: assets?.experiments.length, page: 'agents', note: '完整继承与版本追溯' },
        { label: '评估 Run', count: assets?.runs.length, page: 'evaluation', note: '比较效果与评估证据' },
        { label: '运行实例', count: running, page: 'instances', note: dashboard?.instances.ok ? `共 ${dashboard.instances.value.instances.length} 个已登记实例` : '等待实时观察' }] as const)
        .map(item => <button className="harness-stat" key={item.label} onClick={() => navigate(item.page)}><span>{item.label}</span><strong>{item.count ?? '—'}</strong><small>{item.note}</small></button>)}
    </div>
    {dashboard && !dashboard.instances.ok && <p role="alert">实例观察失败：{dashboard.instances.error.message}</p>}
    {dashboard && !dashboard.mcp.ok && <p role="alert">MCP 查询失败：{dashboard.mcp.error.message}</p>}
    <div className="harness-home-columns">
      <section className="harness-card"><div className="harness-section-heading"><h2>最近评估记录</h2><button onClick={() => navigate('evaluation')}>查看全部 →</button></div>
        {runError && <p role="alert">{runError}</p>}{!runs && !runError && <p role="status">正在读取 Run 记录…</p>}
        {runs?.length === 0 && <p>尚无 Run。进入评测中心选择用例并运行评测。</p>}
        {runs?.slice(0, 6).map(run => <div className="harness-run-row" key={`${run.experiment_id}/${run.id}`}><span className="harness-avatar">◷</span><div><button className="harness-run-link" onClick={() => navigate({ page: 'evaluation', tab: 'runs', agent_id: run.agent_id, experiment_id: run.experiment_id, run_id: run.id })}>{run.id}</button><small>{run.agent_id} · {run.experiment_id}</small><small>{run.created_at ? new Date(run.created_at).toLocaleString() : '创建时间未记录'}</small></div><span className="harness-run-state">{runLabel(run)}</span></div>)}
      </section>
      <section className="harness-card"><div className="harness-section-heading"><h2>平台能力</h2><button disabled={state.status === 'loading'} onClick={() => setRefresh(value => value + 1)}>刷新观察</button></div>
        <div className="harness-capabilities">{([{ icon: '◇', label: '智能体管理', note: '创建版本，查看特性与继承关系', page: 'agents' }, { icon: '◷', label: '评估与追溯', note: '运行评估，查看报告与 Trace', page: 'evaluation' }, { icon: '▣', label: '实例管理', note: '启停与批量操作，核对运行状态', page: 'instances' }, { icon: '⌘', label: 'MCP 管理', note: 'OpenAPI 接入、工具分组与资源', page: 'mcp' }] as const).map(item => <button className="harness-capability" key={item.label} onClick={() => navigate(item.page)}><span>{item.icon}</span><strong>{item.label}</strong><small>{item.note}</small></button>)}</div>
        <div className="harness-guide"><strong>开始一次可复现的改进</strong><br/>选择版本 → 修改与评估 → 查看 Run → 记录决策</div>
      </section>
    </div>
    {assets && <p className="harness-source">来源：{assets.root} · 观察时间：{new Date(assets.observed_at).toLocaleString()}</p>}
  </main>
}
