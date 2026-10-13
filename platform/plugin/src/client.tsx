import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SidebarPanelIconOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createCatalog, type Catalog } from './catalog.ts'
import type { PlatformPageProps } from './protocol.ts'
import { HomePage, PlatformLogo, type PageId } from './home.tsx'
import { AgentsPage } from './agents/client.tsx'
import { InstancesPage } from './instances/client.tsx'
import { McpPage } from './mcp/client.tsx'

export const name = 'harness-platform-client'
export const inject = ['connection', 'slots', 'layout']
const PANEL_ID = 'harness-assets' as MainPanelId
type ClientContext = Omit<Context, 'connection'> & { connection: ConnectionHandle }
const pages: { id: PageId; label: string }[] = [
  { id: 'home', label: '首页' }, { id: 'agents', label: '智能体与评估' },
  { id: 'instances', label: '实例管理' }, { id: 'mcp', label: 'MCP 管理' },
]

function PlatformPage({ catalog, rpc }: PlatformPageProps & { catalog: Catalog }) {
  const [page, setPage] = useState<PageId>('home')
  return <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
    <nav aria-label="平台导航" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--dsw-alias-border-l4, #d1d5db)' }}>
      {pages.map(item => <button key={item.id} type="button" aria-current={page === item.id ? 'page' : undefined}
        onClick={() => setPage(item.id)} style={{ padding: '8px 14px', color: 'inherit', borderRadius: 8,
          border: page === item.id ? '1px solid currentColor' : '1px solid transparent', background: 'transparent' }}>{item.label}</button>)}
    </nav>
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {page === 'home' && <HomePage catalog={catalog} rpc={rpc} navigate={setPage} />}
      {page === 'agents' && <AgentsPage rpc={rpc} />}
      {page === 'instances' && <InstancesPage rpc={rpc} />}
      {page === 'mcp' && <McpPage rpc={rpc} />}
    </div>
  </div>
}

function PlatformIcon({ size }: SidebarPanelIconOwnerProps) {
  return <PlatformLogo size={size} />
}

export function apply(ctx: ClientContext) {
  const catalog = createCatalog(ctx.connection.rpc)
  ctx.on('connection/reset', () => { void catalog.refresh() })
  ctx.slots.inject('main', () => {
    const dispose = ctx.slots.register({ name: 'main', key: PANEL_ID,
      inject: () => ({ catalog, rpc: ctx.connection.rpc }) }, PlatformPage)
    ctx.layout.selectPanel(PANEL_ID)
    return dispose
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: PANEL_ID, order: 0, label: 'Harness工程平台',
  }, PlatformIcon))
}
