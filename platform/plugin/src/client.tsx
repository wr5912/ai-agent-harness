import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { EmptyWorkspaceOwnerProps, HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ConfigForm, SettingsLauncherOwnerProps, SettingsOnboardingOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCatalog, type Catalog } from './catalog.ts'
import type { PlatformPageProps } from './protocol.ts'
import { HomePage, PlatformLogo, type PageId } from './home.tsx'
import { AgentsPage } from './agents/client.tsx'
import { InstancesPage } from './instances/client.tsx'
import { McpPage } from './mcp/client.tsx'
import { platformTheme } from './theme.ts'
import { prepareConversation, startConversation } from './conversation.ts'

export const name = 'harness-platform-client'
export const inject = ['connection', 'slots', 'configForms', 'layout', 'workspaces', 'uiWorkspace', 'sessions', 'conversation']
type ClientContext = Omit<Context, 'connection'> & { connection: ConnectionHandle }
const pages: { id: PageId; label: string }[] = [
  { id: 'home', label: '首页' }, { id: 'conversations', label: '管理对话' }, { id: 'agents', label: '智能体与评估' },
  { id: 'instances', label: '实例管理' }, { id: 'mcp', label: 'MCP 管理' },
]

function PlatformPage({ catalog, rpc, mcpForm, enterConversation, startConversation }: PlatformPageProps & { catalog: Catalog; mcpForm: ConfigForm<any>; enterConversation: () => void; startConversation: (root: string, prompt: string) => Promise<void> }) {
  const [page, setPage] = useState<PageId>('home')
  const frame = useRef<HTMLDivElement>(null)
  const conversation = useRef<HTMLDivElement>(null)
  const navigate = (next: PageId) => {
    if (next === 'conversations') enterConversation()
    setPage(next)
  }
  useEffect(() => {
    // 平台占用官方整页覆盖槽，保留底层设置服务和弹窗挂载。
    const layer = frame.current!.closest<HTMLElement>('[data-shell-overlay]')!
    const underneath = [...layer.parentElement!.children].filter(element => element !== layer) as HTMLElement[]
    const previous = underneath.map(element => ({ element, hidden: element.hidden, inert: element.inert, display: element.style.display }))
    underneath.forEach(element => { element.hidden = true; element.inert = true; element.style.display = 'none' })
    const title = document.title
    document.title = 'Harness工程平台'
    return () => {
      previous.forEach(({ element, hidden, inert, display }) => { element.hidden = hidden; element.inert = inert; element.style.display = display })
      document.title = title
    }
  }, [])
  useEffect(() => {
    if (page !== 'conversations') return
    // 展示同一原生会话树，避免复制会话状态或重复挂载编辑器。
    const layer = frame.current!.closest<HTMLElement>('[data-shell-overlay]')!
    const nativeFrame = layer.parentElement!
    const elements = [...nativeFrame.children].filter(element => element !== layer) as HTMLElement[]
    const previous = elements.map(element => ({ element, hidden: element.hidden, inert: element.inert, display: element.style.display }))
    elements.forEach(element => { element.hidden = false; element.inert = false; element.style.display = '' })
    nativeFrame.classList.add('harness-conversation-frame')
    const position = () => {
      const bounds = conversation.current!.getBoundingClientRect()
      const parent = nativeFrame.getBoundingClientRect()
      nativeFrame.style.setProperty('--harness-conversation-top', `${bounds.top - parent.top}px`)
      nativeFrame.style.setProperty('--harness-conversation-left', `${bounds.left - parent.left}px`)
    }
    const observer = new ResizeObserver(position)
    observer.observe(frame.current!)
    observer.observe(conversation.current!)
    position()
    return () => {
      observer.disconnect()
      nativeFrame.classList.remove('harness-conversation-frame')
      nativeFrame.style.removeProperty('--harness-conversation-top')
      nativeFrame.style.removeProperty('--harness-conversation-left')
      previous.forEach(({ element, hidden, inert, display }) => { element.hidden = hidden; element.inert = inert; element.style.display = display })
    }
  }, [page])
  const navigation = <nav className="harness-nav" aria-label="平台导航">
    {pages.map(item => <button key={item.id} type="button" aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{item.label}</button>)}
  </nav>
  return <div ref={frame} className="harness-platform" data-page={page}>
    <style>{platformTheme}</style>
    <header className="harness-topbar"><div className="harness-brand"><PlatformLogo size={38}/><div><strong>Harness工程平台</strong><small>Harness Engineering Platform</small></div></div>
      {navigation}
      <div className="harness-account"><span className="harness-avatar">A</span><span>admin</span><span id="harness-settings"/><form method="post" action="/logout"><button type="submit">退出登录</button></form></div>
    </header>
    <div className="harness-body">
      {page !== 'home' && <aside className="harness-sidebar">{navigation}</aside>}
      <div className="harness-content">
        {page !== 'home' && <div className="harness-breadcrumb">工作空间 / {pages.find(item => item.id === page)?.label}</div>}
        {page === 'home' && <HomePage catalog={catalog} rpc={rpc} navigate={navigate} startConversation={startConversation} />}
        {page === 'conversations' && <div ref={conversation} className="harness-conversation-viewport"/>}
        {page === 'agents' && <AgentsPage rpc={rpc} />}
        {page === 'instances' && <InstancesPage rpc={rpc} />}
        {page === 'mcp' && <McpPage rpc={rpc} form={mcpForm} />}
      </div>
    </div>
  </div>
}

function ProjectWorkspace({ catalog, workspaces, selectedId, onPick }: EmptyWorkspaceOwnerProps & { catalog: Catalog; workspaces: IWorkspaces }) {
  const { inventory } = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot)
  const root = inventory?.root
  const [error, setError] = useState('')
  useEffect(() => {
    if (!root) return
    let active = true
    setError('')
    workspaces.create({ path: root }).then(workspace => {
      if (active && workspace.workspaceId !== selectedId) onPick(workspace.workspaceId)
    }).catch(() => { if (active) setError('无法准备项目工作区，请刷新重试。') })
    return () => { active = false }
  }, [root, selectedId, workspaces])
  return error ? <span role="alert">{error}</span> : null
}

function ConversationWelcome({ size }: HeroBrandMarkOwnerProps) {
  return <span className="harness-conversation-welcome"><PlatformLogo size={size}/><span>开始管理与改进智能体</span></span>
}

function PlatformSettings({ openSettings, settingsOpen, settingsShortcut }: SettingsLauncherOwnerProps) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  useEffect(() => { setTarget(document.getElementById('harness-settings')) }, [])
  return target && createPortal(<button type="button" aria-haspopup="dialog" aria-expanded={settingsOpen}
    aria-keyshortcuts={settingsShortcut?.aria} onClick={openSettings}>设置</button>, target)
}

export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'welcome-notice', order: -100, priority: -1,
  }, ({ complete }: SettingsOnboardingOwnerProps) => {
    useEffect(() => { complete() }, [complete])
    return null
  })))
  const catalog = createCatalog(ctx.connection.rpc)
  ctx.on('connection/reset', () => { void catalog.refresh() })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'harness-platform', order: -100,
    inject: () => ({ catalog, rpc: ctx.connection.rpc, mcpForm: ctx.configForms.get('mcp-session-manager'), enterConversation: () => prepareConversation(ctx.slots, ctx.layout), startConversation: (root: string, prompt: string) => startConversation(ctx, root, prompt) }),
  }, PlatformPage))
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({ name: 'settings.launcher', priority: -1 }, PlatformSettings))
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, () => null))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, () => null))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, ConversationWelcome))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register({
    name: 'conversation.hero.workspace', priority: -1, inject: () => ({ catalog, workspaces: ctx.workspaces }),
  }, ProjectWorkspace))
}
