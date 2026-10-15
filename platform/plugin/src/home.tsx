import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Catalog } from './catalog.ts'
import type { PlatformPageProps } from './protocol.ts'
import type { RecentRun } from './dashboard.ts'
import { CHANNEL } from './protocol.ts'
import type { PlatformUpdates } from './realtime/client.ts'
import { PlatformLogo } from './logo.tsx'
export { PlatformLogo } from './logo.tsx'

export type PageId = 'home' | 'conversations' | 'agents' | 'instances' | 'mcp'
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

export function HomePage({ catalog, rpc, updates, navigate, startConversation }: PlatformPageProps & { catalog: Catalog; updates: PlatformUpdates; navigate: (page: PageId) => void; startConversation: (root: string, prompt: string) => Promise<void> }) {
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const revision = useSyncExternalStore(updates.subscribe, updates.getSnapshot).revision
  const [runs, setRuns] = useState<RecentRun[]>()
  const [dashboard, setDashboard] = useState<Dashboard>()
  const [runError, setRunError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [prompt, setPrompt] = useState('')
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
  const running = dashboard?.instances.ok ? dashboard.instances.value.instances.filter(item => item.state === 'running').length : undefined
  return <main className="harness-home">
    <section className="harness-hero">
      <HeroArt side="left"/><HeroArt side="right"/>
      <h1>您好，今天想让平台<br/><span>帮您完成什么？</span></h1>
      <p>让智能体研究、评估和日常运行，更直观、更高效。</p>
      <form className="harness-entry" onSubmit={async event => {
        event.preventDefault()
        if (sending || !assets || !prompt.trim()) return
        setSending(true)
        setEntryError('')
        try { await startConversation(assets.root, prompt.trim()); navigate('conversations') }
        catch (error) { setEntryError(error instanceof Error ? error.message : '无法进入管理对话，请重试。') }
        finally { setSending(false) }
      }}>
        <input type="text" aria-label="与平台管理智能体对话" placeholder="输入您想让平台完成的任务…" value={prompt} disabled={sending}
          onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }}/>
        <button className="harness-primary" type="submit" disabled={sending || !assets || !prompt.trim()}>{sending ? '正在进入…' : '发送 →'}</button>
      </form>
      {entryError && <p role="alert">{entryError}</p>}
      <div className="harness-shortcuts"><button onClick={() => navigate('agents')}>＋ 创建智能体版本</button><button onClick={() => navigate('agents')}>◷ 查看评估记录</button><button onClick={() => navigate('instances')}>▣ 管理实例</button><button onClick={() => navigate('mcp')}>◇ 配置 MCP 工具</button></div>
    </section>
    {state.status === 'error' && <p role="alert">{state.error}{assets && ' 保留上次查询结果。'}</p>}
    {!assets && state.status !== 'error' && <p role="status">正在读取仓库…</p>}
    <div className="harness-stats">
      {([{ label: '智能体', count: assets?.agents.length, page: 'agents', note: '研究与持续改进' },
        { label: '研究版本', count: assets?.experiments.length, page: 'agents', note: '完整继承与版本追溯' },
        { label: '评估 Run', count: assets?.runs.length, page: 'agents', note: '比较效果与评估证据' },
        { label: '运行实例', count: running, page: 'instances', note: dashboard?.instances.ok ? `共 ${dashboard.instances.value.instances.length} 个已登记实例` : '等待实时观察' }] as const)
        .map(item => <button className="harness-stat" key={item.label} onClick={() => navigate(item.page)}><span>{item.label}</span><strong>{item.count ?? '—'}</strong><small>{item.note}</small></button>)}
    </div>
    {dashboard && !dashboard.instances.ok && <p role="alert">实例观察失败：{dashboard.instances.error.message}</p>}
    {dashboard && !dashboard.mcp.ok && <p role="alert">MCP 查询失败：{dashboard.mcp.error.message}</p>}
    <div className="harness-home-columns">
      <section className="harness-card"><div className="harness-section-heading"><h2>最近评估记录</h2><button onClick={() => navigate('agents')}>查看全部 →</button></div>
        {runError && <p role="alert">{runError}</p>}{!runs && !runError && <p role="status">正在读取 Run 记录…</p>}
        {runs?.length === 0 && <p>尚无 Run。进入智能体页面选择 Case 并执行评估。</p>}
        {runs?.slice(0, 6).map(run => <div className="harness-run-row" key={`${run.experiment_id}/${run.id}`}><span className="harness-avatar">◷</span><div><strong>{run.id}</strong><small>{run.agent_id} · {run.experiment_id}</small><small>{run.created_at ? new Date(run.created_at).toLocaleString() : '创建时间未记录'}</small></div><span className="harness-run-state">{run.status ?? '未记录'}</span></div>)}
      </section>
      <section className="harness-card"><div className="harness-section-heading"><h2>平台能力</h2><button disabled={state.status === 'loading'} onClick={() => setRefresh(value => value + 1)}>刷新观察</button></div>
        <div className="harness-capabilities">{([{ icon: '◇', label: '智能体管理', note: '创建版本，查看特性与继承关系', page: 'agents' }, { icon: '◷', label: '评估与追溯', note: '运行评估，查看报告与 Trace', page: 'agents' }, { icon: '▣', label: '实例管理', note: '启停与批量操作，核对运行状态', page: 'instances' }, { icon: '⌘', label: 'MCP 管理', note: 'OpenAPI 接入、工具分组与资源', page: 'mcp' }] as const).map(item => <button className="harness-capability" key={item.label} onClick={() => navigate(item.page)}><span>{item.icon}</span><strong>{item.label}</strong><small>{item.note}</small></button>)}</div>
        <div className="harness-guide"><strong>开始一次可复现的改进</strong><br/>选择版本 → 修改与评估 → 查看 Run → 记录决策</div>
      </section>
    </div>
    {assets && <p className="harness-source">来源：{assets.root} · 观察时间：{new Date(assets.observed_at).toLocaleString()}</p>}
  </main>
}
