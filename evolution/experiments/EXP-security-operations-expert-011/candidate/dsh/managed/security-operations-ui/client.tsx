import type * as ReactTypes from 'react'
import avatarUrl from './assets/live-chatbot.gif'
import logoUrl from './assets/logo-v1.webp'

type InputActions = {
  captureInsertion(): { start: number; end: number; draftRev: number }
  insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

type Action = { title: string; description: string; prompt: string }
type Employee = { title: string; description: string; skills: string[]; mention: string }
type Tab = 'recommend' | 'employees' | 'favorites'

const recommendations: Action[] = [
  {
    title: '最近24小时网络总结报告',
    description: '汇总最近 24 小时网络运行、安全事件、风险变化及待处理事项。',
    prompt: '请生成最近24小时网络总结报告，汇总网络运行、安全事件、风险变化和待处理事项，并标明事实、推断与证据缺口。',
  },
  {
    title: '自动巡检',
    description: '巡检已接入设备、关键资产、服务和数据链路，定位异常与待办。',
    prompt: '请查询可执行的巡检任务，并对匹配的常规任务执行一次全量巡检；如实返回结论、证据缺口和报告链接。',
  },
  {
    title: '风险处置',
    description: '梳理未闭环风险并形成分级、可验证、可回退的处置建议。',
    prompt: '请梳理当前未闭环风险，按优先级给出可验证、可回退的处置建议。只制定方案，不执行任何处置动作。',
  },
  {
    title: '资产盘点',
    description: '按资产类型、归属、状态、暴露面和风险等级形成资产视图。',
    prompt: '请盘点当前已接入资产，按类型、归属、状态、暴露面和风险等级汇总，并列出数据缺口。',
  },
  {
    title: '周报生成',
    description: '生成本周截至当前的安全运营周报，呈现趋势、成果和待办。',
    prompt: '请生成本周截至当前的安全运营周报，呈现关键趋势、已完成事项、未闭环风险和下周待办。',
  },
  {
    title: '月报生成',
    description: '生成本月截至当前的安全运营月报，分析风险变化和治理成效。',
    prompt: '请生成本月截至当前的安全运营月报，分析风险变化、事件处理、巡检结果和治理成效。',
  },
]

const employees: Employee[] = [
  {
    title: '威胁研判子智能体',
    description: '基于事件 ID 取证、研判并交付结果。',
    skills: ['事件研判', '证据核查', '报告交付'],
    mention: '@威胁研判子智能体 ',
  },
  {
    title: '故障分析子智能体',
    description: '只读核查设备、服务与链路故障。',
    skills: ['故障排查', '只读取证', '根因分析'],
    mention: '@故障分析子智能体 ',
  },
]

const PLUGIN_ID = 'dsh-security-operations-ui'
const STATUS_KIND = 'security-operations-status'

type ModuleLoader = {
  load(plugin: { id: string; factory(require: (name: string) => unknown): unknown }): void
}

;(window as unknown as { __ModuleLoader__: ModuleLoader }).__ModuleLoader__.load({
  id: PLUGIN_ID,
  factory(require) {
    const React = require('react') as typeof ReactTypes

    function BrandMark({ size }: { size: number }) {
      return <img className="soc-brand-mark" src={logoUrl} width={size} height={size} alt="" />
    }

    function BrandName() {
      return <span className="soc-brand-name">AI 安全运营</span>
    }

    function HeroMark() {
      return <span className="soc-hero-brand"><img src={avatarUrl} width="50" height="50" alt="" /><strong>AI-SOC</strong></span>
    }

    function QuickActions({ session, inputActions, openStatus, useWorkspaces, useSessions, uiWorkspace }: {
      session: { blank: boolean }
      inputActions: InputActions
      openStatus: () => void
      useWorkspaces: (select: (state: any) => any) => any
      useSessions: (select: (state: any) => any) => any
      uiWorkspace: any
    }) {
      const [tab, setTab] = React.useState<Tab>('recommend')
      const [query, setQuery] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const workspaceList = useWorkspaces(state => state) as { pinnedSessionIds: string[] }
      const sessionList = useSessions(state => state) as {
        byId: Record<string, { id: string; displayTitle: string }>
      }

      React.useEffect(() => {
        if (!session.blank || window.innerWidth <= 720) return undefined
        const frame = requestAnimationFrame(openStatus)
        return () => cancelAnimationFrame(frame)
      }, [session.blank, openStatus])

      if (!session.blank) return null

      const keyword = query.trim().toLocaleLowerCase()
      const recommended = recommendations.filter(action =>
        `${action.title} ${action.description}`.toLocaleLowerCase().includes(keyword))
      const people = employees.filter(person =>
        `${person.title} ${person.description} ${person.skills.join(' ')}`.toLocaleLowerCase().includes(keyword))
      const favorites = workspaceList.pinnedSessionIds
        .map((id: string) => sessionList.byId[id])
        .filter((item: any) => item && item.displayTitle.toLocaleLowerCase().includes(keyword))
      const hasResults = tab === 'recommend' ? recommended.length > 0 : tab === 'employees' ? people.length > 0 : favorites.length > 0

      function insert(text: string) {
        const inserted = inputActions.insertText(text, inputActions.captureInsertion())
        setNotice(inserted ? '' : '输入框暂不可编辑，请稍后重试。')
      }

      function switchTab(next: Tab) {
        setTab(next)
        setQuery('')
        setNotice('')
      }

      return (
        <section className="soc-quick" aria-label="智能对话快捷入口">
          <div className="soc-quick__heading">
            <strong>智能对话</strong>
            <button type="button" className="soc-quick__status" onClick={openStatus}>系统消息</button>
          </div>
          <div className="soc-quick__toolbar">
            <div className="soc-quick__tabs" role="tablist" aria-label="快捷入口分类">
              <button type="button" role="tab" aria-selected={tab === 'recommend'} onClick={() => switchTab('recommend')}>推荐</button>
              <button type="button" role="tab" aria-selected={tab === 'employees'} onClick={() => switchTab('employees')}>数字员工</button>
              <button type="button" role="tab" aria-selected={tab === 'favorites'} onClick={() => switchTab('favorites')}>收藏</button>
            </div>
            <label className="soc-quick__search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={event => setQuery(event.target.value)}
                aria-label={tab === 'recommend' ? '搜索推荐' : tab === 'employees' ? '搜索数字员工' : '搜索收藏'}
                placeholder={tab === 'recommend' ? '搜索推荐' : tab === 'employees' ? '搜索数字员工' : '搜索收藏'} />
            </label>
          </div>
          {notice && <p className="soc-quick__notice" role="alert">{notice}</p>}
          {hasResults ? (
            <div className="soc-quick__grid" role="tabpanel">
              {tab === 'recommend'
                ? recommended.map(action => (
                  <button key={action.title} type="button" className="soc-quick__card"
                    onClick={() => insert(action.prompt)}>
                    <span className="soc-quick__card-title">{action.title}<span aria-hidden="true">↗</span></span>
                    <span className="soc-quick__card-description">{action.description}</span>
                  </button>
                ))
                : tab === 'employees' ? people.map(person => (
                  <button key={person.title} type="button" className="soc-quick__card soc-quick__card--employee"
                    onClick={() => insert(person.mention)}>
                    <img src={avatarUrl} width="42" height="42" alt="" />
                    <span className="soc-quick__person">
                      <span className="soc-quick__card-title">{person.title}<span aria-hidden="true">↗</span></span>
                      <span className="soc-quick__person-label">简介</span>
                      <span className="soc-quick__card-description">{person.description}</span>
                      <span className="soc-quick__skills">{person.skills.map(skill => <span key={skill}>{skill}</span>)}</span>
                    </span>
                  </button>
                )) : favorites.map((item: any) => (
                  <button key={item.id} type="button" className="soc-quick__card" onClick={() => uiWorkspace.openSession(item.id)}>
                    <span className="soc-quick__card-title">{item.displayTitle}<span aria-hidden="true">↗</span></span>
                    <span className="soc-quick__card-description">已置顶会话，点击继续对话。</span>
                  </button>
                ))}
            </div>
          ) : <p className="soc-quick__empty" role="tabpanel">{tab === 'favorites' && !keyword
            ? '暂无收藏会话。可在左侧会话菜单中选择“置顶”。'
            : `没有匹配的${tab === 'recommend' ? '推荐任务' : tab === 'employees' ? '数字员工' : '收藏会话'}。`}</p>}
          {tab === 'favorites' && favorites.length > 0 && <p className="soc-quick__favorite">在左侧会话菜单中使用“置顶”或“取消置顶”管理收藏。</p>}
        </section>
      )
    }

    function StatusPanel({ useSession, useInput }: any) {
      const queued = useInput((state: any) => state.queue.length) as number
      const submitting = useSession((state: any) => state.pendingSubmissions.length) as number
      const running = useSession((state: any) => state.running) as boolean
      const attempted = useSession((state: any) => state.promptAttempted) as boolean
      const awaiting = useSession((state: any) => state.awaitingFirstTurn) as boolean
      const failed = useSession((state: any) =>
        state.lastAgentError !== null || state.promptError !== null || state.openError !== null) as boolean
      const pending = queued + submitting
      const completed = attempted && !running && !awaiting && !failed ? 1 : 0
      const message = failed
        ? '执行异常，请查看当前会话详情。'
        : running || awaiting
          ? '当前会话正在执行。'
          : pending > 0
            ? `当前会话有 ${pending} 项待处理消息。`
            : completed
              ? '当前会话最近一次执行已完成。'
              : '暂无系统消息。'
      const metrics: [string, string][] = [
        ['1', '当前'],
        [String(pending), '待处理'],
        [running || awaiting ? '1' : '0', '执行中'],
        [String(completed), '已完成'],
      ]

      return (
        <section className="soc-status" aria-labelledby="soc-status-title">
          <header><strong id="soc-status-title">系统消息</strong><span>当前会话</span></header>
          <div className="soc-status__metrics">{metrics.map(([value, label]) =>
            <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
          <p className={failed ? 'soc-status__message soc-status__message--error' : 'soc-status__message'}>{message}</p>
        </section>
      )
    }

    const css = `
      .soc-brand-mark{display:block;object-fit:contain}
      .soc-brand-name{font-size:14px;font-weight:600;white-space:nowrap}
      .soc-hero-brand{display:inline-flex;align-items:center;gap:12px;white-space:nowrap}
      .soc-hero-brand img{display:block;object-fit:cover;border-radius:12px}
      .soc-hero-brand strong{font-size:20px;font-weight:600}
      div:has(> span > .soc-hero-brand){justify-content:flex-start}
      span:has(> [data-slot="conversation.hero.brand.mark"] .soc-hero-brand)+span{display:none}
      .soc-quick{order:10;width:100%;padding-top:14px;color:var(--dsw-alias-label-primary,#242933)}
      .soc-quick__heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 12px 10px}
      .soc-quick__heading strong{font-size:16px}
      .soc-quick__status{border:0;background:transparent;color:var(--dsw-alias-brand-primary,#1677ff);cursor:pointer;font:inherit;white-space:nowrap}
      .soc-quick__toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 14px}
      .soc-quick__tabs{display:flex;align-items:center;gap:5px}
      .soc-quick__tabs button{padding:8px 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
      .soc-quick__tabs button[aria-selected=true]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#242933);box-shadow:0 2px 12px rgba(31,35,41,.06)}
      .soc-quick__search{display:flex;align-items:center;gap:7px;min-width:160px;width:min(260px,42%);height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#667085)}
      .soc-quick__search input{min-width:0;width:100%;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary,#242933);font:inherit;font-size:12px}
      .soc-quick__search:focus-within{border-color:var(--dsw-alias-brand-primary,#1677ff)}
      .soc-quick__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .soc-quick__card{display:block;min-width:0;min-height:132px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer;font:inherit;text-align:left;transition:border-color .15s,box-shadow .15s,transform .15s}
      .soc-quick__card:hover{border-color:var(--dsw-alias-brand-primary,#1677ff);box-shadow:0 6px 18px rgba(31,35,41,.08);transform:translateY(-1px)}
      .soc-quick__card:focus-visible,.soc-quick__status:focus-visible,.soc-quick__tabs button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#1677ff);outline-offset:2px}
      .soc-quick__card-title{display:flex;justify-content:space-between;gap:8px;margin-bottom:9px;font-size:14px;font-weight:600}
      .soc-quick__card-title span{color:var(--dsw-alias-label-secondary,#667085);font-weight:400}
      .soc-quick__card-description{display:block;color:var(--dsw-alias-label-secondary,#667085);font-size:13px;line-height:1.5}
      .soc-quick__card--employee{display:flex;align-items:flex-start;gap:9px}
      .soc-quick__card--employee img{flex:none;border-radius:50%;border:1px solid #e4e7ec}
      .soc-quick__person{display:block;min-width:0;flex:1}
      .soc-quick__person-label{display:block;margin:2px 0 3px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px}
      .soc-quick__skills{display:flex;flex-wrap:wrap;gap:4px;margin-top:10px}
      .soc-quick__skills span{padding:2px 7px;border-radius:99px;background:#e8f2ff;color:#426381;font-size:11px}
      .soc-quick__empty{padding:30px 10px;color:var(--dsw-alias-label-secondary,#667085);font-size:13px;text-align:center}
      .soc-quick__notice{margin:0 0 10px;color:var(--dsw-alias-error-primary,#d92d20);font-size:12px}
      .soc-quick__favorite{margin:11px 2px 0;color:var(--dsw-alias-label-secondary,#667085);font-size:11px}
      .soc-status{height:100%;padding:18px;color:var(--dsw-alias-label-primary,#242933)}
      .soc-status header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:16px;border-bottom:1px solid var(--dsw-alias-border-l2,#e4e7ec)}
      .soc-status header span{color:var(--dsw-alias-label-secondary,#667085);font-size:12px}
      .soc-status__metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:18px 0}
      .soc-status__metrics div{display:flex;min-width:0;flex-direction:column;gap:4px;padding:10px 4px;border-radius:8px;background:var(--dsw-alias-bg-subtle,#f5f7fa);text-align:center}
      .soc-status__metrics strong{font-size:18px}
      .soc-status__metrics span{overflow:hidden;color:var(--dsw-alias-label-secondary,#667085);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
      .soc-status__message{margin:22px 0;color:var(--dsw-alias-label-secondary,#667085);font-size:13px;line-height:1.6;text-align:center}
      .soc-status__message--error{color:var(--dsw-alias-error-primary,#d92d20)}
      @media(max-width:1100px){.soc-quick__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:720px){.soc-quick__grid{grid-template-columns:1fr}.soc-quick__toolbar{align-items:stretch;flex-direction:column}.soc-quick__search{width:100%;box-sizing:border-box}}
    `

    const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace']
    function apply(ctx: any) {
      ctx.effect(() => {
        try {
          if (localStorage.getItem('dsh.workspace.view.v5') !== null) return
        } catch { return }
        let applied = false
        const setDefault = () => {
          if (applied) return
          const view = ctx.slots.entries('sidebar.workspaces')[0]?.store?.create()
          if (!view) return
          applied = true
          view.actions.setGroupBy('flat')
        }
        const unsubscribe = ctx.slots.subscribe('sidebar.workspaces', setDefault)
        setDefault()
        return unsubscribe
      }, 'security-operations-ui: default workspace grouping')

      ctx.effect(() => {
        const layout = ctx.slots.entries('root')[0]?.store?.create()
        if (!layout) throw new Error('security-operations-ui: root layout store unavailable')
        if (window.innerWidth > 720 && layout.getSnapshot().layoutInfo.rightbar === null) layout.actions.setRightbar(350)
      }, 'security-operations-ui: right sidebar default width')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshSecurityOperationsUi = 'true'
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      }, 'security-operations-ui: styles')

      ctx.effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register(
        { name: 'sidebar.brand.mark', key: PLUGIN_ID, priority: -1 }, BrandMark,
      )), 'security-operations-ui: brand mark')
      ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register(
        { name: 'sidebar.brand.name', key: PLUGIN_ID, priority: -1 }, BrandName,
      )), 'security-operations-ui: brand name')
      ctx.effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register(
        { name: 'conversation.hero.brand.mark', key: PLUGIN_ID, priority: -1 }, HeroMark,
      )), 'security-operations-ui: hero mark')

      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: PLUGIN_ID,
        kind: STATUS_KIND,
        title: () => '系统消息',
        guide: [{ order: 5, title: () => '系统消息', description: () => '查看当前会话执行状态' }],
      }), 'security-operations-ui: status type')

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: PLUGIN_ID },
        StatusPanel,
      )), 'security-operations-ui: status panel')

      const openStatus = () => ctx.sidebarRight.openTab(STATUS_KIND)
      const Dock = (props: any) => <QuickActions {...props} openStatus={openStatus}
        uiWorkspace={ctx.get('uiWorkspace')} />
      ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
        { name: 'conversation.input.dock', id: PLUGIN_ID, order: 100 },
        Dock,
      )), 'security-operations-ui: quick actions')
    }

    return { apply, inject }
  },
})
