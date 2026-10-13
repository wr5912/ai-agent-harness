import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Catalog } from './catalog.ts'
import type { PlatformPageProps } from './protocol.ts'
import type { RecentRun } from './dashboard.ts'
import { CHANNEL } from './protocol.ts'
import logo from '../assets/harness-logo.svg'

export type PageId = 'home' | 'agents' | 'instances' | 'mcp'
type Observation<T> = { ok: true; value: T } | { ok: false; error: { message: string } }
interface Dashboard {
  recent_runs: RecentRun[]
  instances: Observation<{ instances: { state: string }[] }>
  mcp: Observation<{ connections: unknown[] }>
}
const card: CSSProperties = { border: '1px solid var(--dsw-alias-border-l4, #d1d5db)',
  borderRadius: 12, padding: 20, background: 'var(--dsw-alias-bg-layer-1, transparent)' }

export function PlatformLogo({ size = 56 }: { size?: number }) {
  return <img src={logo} width={size} height={size} alt="Harness工程平台标识" />
}

export function HomePage({ catalog, rpc, navigate }: PlatformPageProps & { catalog: Catalog; navigate: (page: PageId) => void }) {
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const [runs, setRuns] = useState<RecentRun[]>()
  const [dashboard, setDashboard] = useState<Dashboard>()
  const [runError, setRunError] = useState('')
  const [refresh, setRefresh] = useState(0)
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
  }, [rpc, refresh])
  const assets = state.inventory
  return <main style={{ height: '100%', overflow: 'auto', padding: '32px clamp(16px, 4vw, 48px)', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 24 }}>
        <PlatformLogo />
        <div style={{ flex: 1 }}><h1 style={{ margin: 0, fontSize: 26 }}>Harness工程平台</h1>
          <p style={{ margin: '5px 0', opacity: 0.65 }}>Harness Engineering Platform</p></div>
        <button type="button" disabled={state.status === 'loading'} onClick={() => setRefresh(value => value + 1)}>
          {state.status === 'loading' ? '刷新中…' : '刷新首页'}</button>
      </header>
      <p>创建和改进智能体，管理 DSH 实例，核对评估证据与 MCP 工具。</p>
      {state.status === 'error' && <p role="alert">{state.error}{assets && ' 保留上次查询结果。'}</p>}
      {!assets && state.status !== 'error' && <p role="status">正在读取仓库…</p>}
      {assets && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, margin: '24px 0' }}>
          {([['智能体', assets.agents.length, 'agents'], ['研究版本', assets.experiments.length, 'agents'], ['评估 Run', assets.runs.length, 'agents']] as const)
            .map(([label, count, page]) => <button type="button" key={label} onClick={() => navigate(page)}
              style={{ ...card, color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span>{label}</span><strong style={{ display: 'block', fontSize: 32, marginTop: 10 }}>{count}</strong>
            </button>)}
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
          <button type="button" onClick={() => navigate('instances')}>实例：{dashboard?.instances.ok
            ? `${dashboard.instances.value.instances.length} 个，${dashboard.instances.value.instances.filter(item => item.state === 'running').length} 个运行中`
            : '尚未确认'}</button>
          <button type="button" onClick={() => navigate('mcp')}>MCP / OpenAPI 连接：{dashboard?.mcp.ok ? dashboard.mcp.value.connections.length : '尚未确认'}</button>
        </div>
        {dashboard && !dashboard.instances.ok && <p role="alert">实例观察失败：{dashboard.instances.error.message}</p>}
        {dashboard && !dashboard.mcp.ok && <p role="alert">MCP 查询失败：{dashboard.mcp.error.message}</p>}
        <section style={card}><h2 style={{ marginTop: 0, fontSize: 18 }}>工作入口</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => navigate('agents')}>智能体与评估</button>
            <button type="button" onClick={() => navigate('instances')}>实例管理</button>
            <button type="button" onClick={() => navigate('mcp')}>MCP 管理</button>
          </div></section>
        <section style={{ ...card, marginTop: 20 }}><h2 style={{ marginTop: 0, fontSize: 18 }}>最近创建的 Run</h2>
          {runError && <p role="alert">{runError}{runs && ' 保留上次查询结果。'}</p>}
          {!runs && !runError && <p role="status">正在读取 Run 记录…</p>}
          {runs?.length === 0 && <p>尚无 Run。进入智能体页面选择 Case 并执行评估。</p>}
          {runs && runs.length > 0 && <ul style={{ paddingLeft: 20 }}>{runs.map(run => <li key={`${run.experiment_id}/${run.id}`} style={{ margin: '12px 0', overflowWrap: 'anywhere' }}>
            <strong>{run.id}</strong> · {run.status ?? '状态未记录'}
            <div>{run.agent_id} / {run.experiment_id}</div>
            <small>{run.created_at ? new Date(run.created_at).toLocaleString() : '创建时间未记录'}</small>
          </li>)}</ul>}
        </section>
        <p style={{ opacity: 0.65, fontSize: 12, overflowWrap: 'anywhere' }}>来源：{assets.root}<br />观察时间：{new Date(assets.observed_at).toLocaleString()}</p>
      </>}
    </div>
  </main>
}
