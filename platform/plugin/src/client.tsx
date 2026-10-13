import { useEffect, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createCatalog } from './catalog.ts'
import type { Catalog } from './catalog.ts'
import type { Asset, RunAsset } from './protocol.ts'

export const name = 'harness-platform-client'
export const inject = ['connection', 'slots', 'layout']
const PANEL_ID = 'harness-assets' as MainPanelId
type ClientContext = Omit<Context, 'connection'> & { connection: ConnectionHandle }

const sectionStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l4, #d1d5db)', borderRadius: 12,
  padding: '18px 20px', background: 'var(--dsw-alias-bg-layer-1, transparent)',
}

function AssetList({ title, items }: { title: string; items: (Asset | RunAsset)[] }) {
  return <section style={sectionStyle}>
    <h2 style={{ margin: '0 0 16px', fontSize: 18 }}>{title} <span style={{ opacity: 0.6 }}>({items.length})</span></h2>
    {items.length === 0 ? <p style={{ opacity: 0.65, margin: 0 }}>暂无{title}记录。</p> :
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map(item => <li key={item.path} style={{ padding: '12px 0', borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)' }}>
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.id}</div>
          {'experiment_id' in item && <div style={{ fontSize: 13, marginTop: 5 }}>所属 Experiment：{item.experiment_id}</div>}
          <code style={{ display: 'block', fontSize: 12, opacity: 0.65, marginTop: 5, overflowWrap: 'anywhere' }}>{item.path}</code>
        </li>)}
      </ul>}
  </section>
}

function AssetsPage({ catalog }: { catalog: Catalog }) {
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  useEffect(() => { void catalog.refresh() }, [catalog])
  const assets = state.inventory
  return <main style={{ height: '100%', overflow: 'auto', padding: '32px clamp(20px, 4vw, 48px)', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, margin: '0 0 8px' }}>研究资产</h1>
          <p style={{ opacity: 0.65, margin: 0 }}>查看当前仓库的 Agent、Experiment 和 Run。</p>
        </div>
        <button type="button" onClick={() => { void catalog.refresh() }} disabled={state.status === 'loading'}
          style={{ border: '1px solid var(--dsw-alias-border-l4, #d1d5db)', borderRadius: 8, padding: '9px 16px', background: 'transparent', color: 'inherit', cursor: 'pointer', flexShrink: 0 }}>
          {state.status === 'loading' ? '刷新中…' : '刷新'}
        </button>
      </header>
      {state.status === 'error' && <p role="alert" style={{ color: 'var(--dsw-alias-state-error-primary, #c2410c)', padding: 16, border: '1px solid currentColor', borderRadius: 8 }}>
        资产查询失败：{state.error}{assets && ' 下方保留上次成功查询的清单。'}
      </p>}
      {!assets && state.status !== 'error' && <p role="status">正在读取仓库资产…</p>}
      {assets && <>
        <section style={{ ...sectionStyle, marginBottom: 20 }}>
          <div style={{ fontSize: 13, opacity: 0.65, marginBottom: 6 }}>仓库来源</div>
          <code style={{ overflowWrap: 'anywhere' }}>{assets.root}</code>
          <div style={{ fontSize: 13, opacity: 0.65, marginTop: 10 }}>查询时间：{new Date(assets.observed_at).toLocaleString()}</div>
          <p style={{ margin: '14px 0 0' }}>Agent {assets.agents.length} · Experiment {assets.experiments.length} · Run {assets.runs.length}</p>
        </section>
        <div style={{ display: 'grid', gap: 20 }}>
          <AssetList title="Agent" items={assets.agents} />
          <AssetList title="Experiment" items={assets.experiments} />
          <AssetList title="Run" items={assets.runs} />
        </div>
      </>}
    </div>
  </main>
}

function AssetsIcon({ size }: SidebarPanelIconOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <path d="M14 17.5h7m-3.5-3.5v7" />
  </svg>
}

export function apply(ctx: ClientContext) {
  const catalog = createCatalog(ctx.connection.rpc)
  ctx.on('connection/reset', () => { void catalog.refresh() })
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ catalog }) }, AssetsPage)
    ctx.layout.selectPanel(PANEL_ID)
    return dispose
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 0, label: '研究资产',
  }, AssetsIcon))
}
