import type * as ReactTypes from 'react'
import avatarUrl from './assets/live-chatbot.gif'
import logoUrl from './assets/logo-v1.webp'

type InputActions = {
  captureInsertion(): { start: number; end: number; draftRev: number }
  insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

type Action = { title: string; description: string; prompt: string }
type Employee = { id: string; title: string; description: string; skills: string[] }
type EmployeeDraft = { title: string; description: string; skills: string }
type Tab = 'recommend' | 'employees' | 'favorites'
type OverviewCall = { parentSessionId: string; childSessionId?: string; startedAt: number; status: string }
type OverviewCounts = { toolCalls: number; skillLoads: number }
type OverviewRole = OverviewCounts & { id: string; title: string; state: string; active: number; completed: number; failed: number; noChild: number; unknown: number; recent: OverviewCall[] }
type Overview = { windowHours: number; parent: OverviewCounts & { state: string; active: number; sessions: number; recentSessionId: string | null }; roles: OverviewRole[] }

const recommendations: Action[] = [
  {
    title: '新增访问策略草稿',
    description: '填写源与目的 IPv4、协议和端口，先生成待确认草稿。',
    prompt: '请新增 <源IPv4> 到 <目的IPv4> 的 TCP <目的端口> 访问策略，先生成草稿，不要执行。',
  },
  {
    title: '准备应急指令',
    description: '填写单个目标与动作，先查看冻结草案。',
    prompt: '请对 <单个目标IP或设备ID> 准备 <单个应急动作> 指令，先展示草案，不要执行。',
  },
  {
    title: '最近24小时网络总结报告',
    description: '汇总最近 24 小时网络运行、安全事件、风险变化及待处理事项。',
    prompt: '请生成最近24小时网络总结报告，汇总网络运行、安全事件、风险变化和待处理事项，并标明事实、推断与证据缺口。',
  },
  {
    title: '自动巡检',
    description: '巡检已接入设备、关键资产、服务和数据链路，定位异常与待办。',
    prompt: '请查询当前可用的巡检能力，按服务返回的能力执行一次巡检；如实返回结论、证据缺口和原始报告链接。',
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

const defaultEmployees: Employee[] = [
  {
    id: 'threat-analysis',
    title: '威胁研判子智能体',
    description: '基于事件 ID 取证、研判并交付结果。',
    skills: ['事件研判', '证据核查', '报告交付'],
  },
  {
    id: 'fault-diagnosis',
    title: '故障分析子智能体',
    description: '只读核查设备、服务与链路故障。',
    skills: ['故障排查', '只读取证', '根因分析'],
  },
]

const PLUGIN_ID = 'dsh-security-operations-ui'
const STATUS_KIND = 'security-operations-status'
const WORKSPACE_PATH = '/work/harness/workspace'
const AGENT_PRESET = 'security-operations-expert'
// shortcut: 卡片仅保存在当前浏览器，需要跨设备共享时接入持久化服务。
const EMPLOYEES_KEY = 'dsh.securityOperations.digitalEmployees.v1'

function loadEmployees(): Employee[] {
  try {
    const saved = localStorage.getItem(EMPLOYEES_KEY)
    if (saved === null) return defaultEmployees
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return defaultEmployees
    return parsed.filter((item): item is Employee => typeof item?.id === 'string'
      && typeof item.title === 'string' && typeof item.description === 'string'
      && Array.isArray(item.skills) && item.skills.every((skill: unknown) => typeof skill === 'string'))
  } catch { return defaultEmployees }
}

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

    function RuntimeOverview({ overview, openStatus, openSession }: {
      overview: Overview | null
      openStatus: () => void
      openSession: (id: string) => void
    }) {
      const [expanded, setExpanded] = React.useState(false)
      const roles = overview?.roles ?? [
        { id: 'delegate_threat_analysis', title: '威胁研判子智能体' },
        { id: 'delegate_fault_analysis', title: '故障分析子智能体' },
        { id: 'delegate_response_planning', title: '响应规划子智能体' },
      ].map(role => ({ ...role, state: 'unknown', active: 0, completed: 0, failed: 0, noChild: 0, unknown: 0, toolCalls: 0, skillLoads: 0, recent: [] }))
      const running = overview ? overview.parent.active + roles.reduce((sum, role) => sum + role.active, 0) : null
      const failed = overview ? roles.reduce((sum, role) => sum + role.failed + role.noChild, 0) : null
      const stateText = (state: string) => state === 'running' ? '执行中' : state === 'idle' ? '空闲' : '未知'
      const parentState = overview?.parent.state ?? 'unknown'
      return (
        <section className="soc-runtime" aria-label="智能体运行概览">
          <header className="soc-runtime__header">
            <div className="soc-runtime__title"><strong>智能体运行概览</strong><span>当前实例 · 近 {overview?.windowHours ?? 24} 小时 · 统计启用后</span></div>
            <dl className="soc-runtime__summary">
              <div><dt>角色</dt><dd>4</dd></div>
              <div><dt>运行中</dt><dd>{running ?? '—'}</dd></div>
              <div><dt>失败及无子会话</dt><dd>{failed ?? '—'}</dd></div>
            </dl>
            <button type="button" className="soc-runtime__expand" aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}>{expanded ? '收起详情' : '展开详情'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span></button>
          </header>
          <div className="soc-runtime__strip">
            <article className={`soc-runtime__card soc-runtime__card--${parentState === 'idle' ? 'healthy' : parentState}`} data-runtime-state={parentState}>
              <div className="soc-runtime__card-head"><img src={avatarUrl} width="40" height="40" alt="" />
                <span className="soc-runtime__identity"><span><strong title="主智能体：网络安全运营专家">网络安全运营专家</strong><em>{stateText(parentState)}</em></span>
                  <small>运行 <b>{overview?.parent.active ?? '—'}</b>　会话 <b>{overview?.parent.sessions ?? '—'}</b></small>
                  <small className="soc-runtime__activity"><span>工具调用 <b>{overview?.parent.toolCalls ?? '—'}</b></span><span>Skill 加载 <b>{overview?.parent.skillLoads ?? '—'}</b></span></small></span></div>
              {expanded && <div className="soc-runtime__detail">主智能体会话由 DSH 会话服务统计。<br />
                <button type="button" onClick={() => overview?.parent.recentSessionId ? openSession(overview.parent.recentSessionId) : openStatus()}>查看最近会话</button></div>}
            </article>
            {roles.map(role => <article key={role.id}
              className={`soc-runtime__card soc-runtime__card--${role.state === 'idle' ? 'healthy' : role.state}`}
              data-runtime-state={role.state}>
              <div className="soc-runtime__card-head"><img src={avatarUrl} width="40" height="40" alt="" />
                <span className="soc-runtime__identity"><span><strong title={role.title}>{role.title}</strong><em>{stateText(role.state)}</em></span>
                  <small>运行 <b>{overview ? role.active : '—'}</b>　完成 <b>{overview ? role.completed : '—'}</b></small>
                  <small className="soc-runtime__activity"><span>工具调用 <b>{overview ? role.toolCalls : '—'}</b></span><span>Skill 加载 <b>{overview ? role.skillLoads : '—'}</b></span></small></span></div>
              {expanded && <div className="soc-runtime__detail">失败 {overview ? role.failed : '—'} · 无子会话 {overview ? role.noChild : '—'} · 状态未知 {overview ? role.unknown : '—'}
                {role.recent.length ? <ul>{role.recent.map((call, index) => <li key={`${call.startedAt}-${index}`}>
                  <button type="button" onClick={() => openSession(call.childSessionId ?? call.parentSessionId)}>
                    {new Date(call.startedAt).toLocaleString()} · {call.status} · {call.childSessionId ? '子会话' : '主会话'}
                  </button></li>)}</ul> : <p>当前时间窗暂无委派调用。</p>}
              </div>}
            </article>)}
          </div>
        </section>
      )
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
      const [employeeItems, setEmployeeItems] = React.useState<Employee[]>(loadEmployees)
      const [employeeEditing, setEmployeeEditing] = React.useState(false)
      const [editingId, setEditingId] = React.useState<string | null>(null)
      const [draft, setDraft] = React.useState<EmployeeDraft | null>(null)
      const [overview, setOverview] = React.useState<Overview | null>(null)
      const workspaceList = useWorkspaces(state => state) as { pinnedSessionIds: string[] }
      const sessionList = useSessions(state => state) as {
        phase: string
        byId: Record<string, { id: string; displayTitle: string; blank: boolean; running: boolean; parentId?: string }>
      }

      React.useEffect(() => {
        let active = true
        async function refresh() {
          try {
            const response = await fetch(new URL('api/security-operations/overview', document.baseURI), { credentials: 'same-origin' })
            if (!response.ok) throw new Error(`overview ${response.status}`)
            const data = await response.json() as Overview
            if (active) setOverview(data)
          } catch { if (active) setOverview(null) }
        }
        void refresh()
        const timer = setInterval(() => void refresh(), 5000)
        return () => { active = false; clearInterval(timer) }
      }, [])

      React.useEffect(() => {
        if (!session.blank || window.innerWidth <= 720) return undefined
        const frame = requestAnimationFrame(openStatus)
        return () => cancelAnimationFrame(frame)
      }, [session.blank, openStatus])

      if (!session.blank) return null

      const keyword = query.trim().toLocaleLowerCase()
      const recommended = recommendations.filter(action =>
        `${action.title} ${action.description}`.toLocaleLowerCase().includes(keyword))
      const people = employeeItems.filter(person =>
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

      function persistEmployees(next: Employee[]) {
        try { localStorage.setItem(EMPLOYEES_KEY, JSON.stringify(next)) }
        catch { setNotice('数字员工保存失败，请检查浏览器存储权限。'); return false }
        setEmployeeItems(next)
        setNotice('')
        return true
      }

      function openEmployeeForm(person?: Employee) {
        setEditingId(person?.id ?? null)
        setDraft({ title: person?.title ?? '', description: person?.description ?? '', skills: person?.skills.join('、') ?? '' })
        setNotice('')
      }

      function saveEmployee(event: ReactTypes.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (!draft) return
        const title = draft.title.trim()
        const description = draft.description.trim()
        const skills = draft.skills.split(/[，,、]/).map(item => item.trim()).filter(Boolean)
        if (!title || !description) { setNotice('请填写数字员工名称和简介。'); return }
        if (employeeItems.some(item => item.title === title && item.id !== editingId)) {
          setNotice('数字员工名称不能重复。')
          return
        }
        const next = editingId
          ? employeeItems.map(item => item.id === editingId ? { ...item, title, description, skills } : item)
          : [...employeeItems, { id: crypto.randomUUID(), title, description, skills }]
        if (persistEmployees(next)) setDraft(null)
      }

      function removeEmployee(person: Employee) {
        if (!window.confirm(`确定删除“${person.title}”吗？`)) return
        if (persistEmployees(employeeItems.filter(item => item.id !== person.id)) && editingId === person.id) setDraft(null)
      }

      return (
        <section className="soc-quick" aria-label="智能对话快捷入口">
          <RuntimeOverview overview={overview} openStatus={openStatus} openSession={(id) => void uiWorkspace.openSession(id)} />
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
            {tab === 'employees' && <button type="button" className="soc-employee-edit-toggle"
              aria-label={employeeEditing ? '完成编辑数字员工' : '编辑数字员工'}
              title={employeeEditing ? '完成编辑' : '编辑数字员工'}
              onClick={() => { setEmployeeEditing(!employeeEditing); setDraft(null); setNotice('') }}>
              {employeeEditing ? '完成' : '✎'}
            </button>}
            <label className="soc-quick__search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={event => setQuery(event.target.value)}
                aria-label={tab === 'recommend' ? '搜索推荐' : tab === 'employees' ? '搜索数字员工' : '搜索收藏'}
                placeholder={tab === 'recommend' ? '搜索推荐' : tab === 'employees' ? '搜索数字员工' : '搜索收藏'} />
            </label>
          </div>
          {notice && <p className="soc-quick__notice" role="alert">{notice}</p>}
          {tab === 'employees' && employeeEditing && <p className="soc-employee-scope">卡片变更仅保存在当前浏览器；新增卡片不会创建智能体。</p>}
          {tab === 'employees' && employeeEditing && draft && <form className="soc-employee-form" aria-label={editingId ? '编辑数字员工卡片' : '新增数字员工卡片'} onSubmit={saveEmployee}>
            <label>名称<input autoFocus maxLength={40} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
            <label>简介<input maxLength={160} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
            <label>技能（用逗号分隔）<input maxLength={160} value={draft.skills} onChange={event => setDraft({ ...draft, skills: event.target.value })} /></label>
            <div><button type="button" onClick={() => { setDraft(null); setNotice('') }}>取消</button><button type="submit">保存</button></div>
          </form>}
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
                : tab === 'employees' ? <>
                  {employeeEditing && <button type="button" className="soc-quick__card soc-employee-add" onClick={() => openEmployeeForm()}>
                    <span aria-hidden="true">＋</span>新增数字员工
                  </button>}
                  {people.map(person => employeeEditing ? <article key={person.id} className="soc-quick__card soc-quick__card--employee">
                    <img src={avatarUrl} width="42" height="42" alt="" />
                    <span className="soc-quick__person">
                      <span className="soc-quick__card-title">{person.title}</span>
                      <span className="soc-quick__person-label">简介</span>
                      <span className="soc-quick__card-description">{person.description}</span>
                      <span className="soc-quick__skills">{person.skills.map(skill => <span key={skill}>{skill}</span>)}</span>
                      <span className="soc-employee-actions"><button type="button" aria-label={`编辑${person.title}`} onClick={() => openEmployeeForm(person)}>编辑</button>
                        <button type="button" aria-label={`删除${person.title}`} onClick={() => removeEmployee(person)}>删除</button></span>
                    </span>
                  </article> : <button key={person.id} type="button" className="soc-quick__card soc-quick__card--employee"
                    onClick={() => insert(`@${person.title} `)}>
                    <img src={avatarUrl} width="42" height="42" alt="" />
                    <span className="soc-quick__person">
                      <span className="soc-quick__card-title">{person.title}<span aria-hidden="true">↗</span></span>
                      <span className="soc-quick__person-label">简介</span>
                      <span className="soc-quick__card-description">{person.description}</span>
                      <span className="soc-quick__skills">{person.skills.map(skill => <span key={skill}>{skill}</span>)}</span>
                    </span>
                  </button>)}
                </> : favorites.map((item: any) => (
                  <button key={item.id} type="button" className="soc-quick__card" onClick={() => uiWorkspace.openSession(item.id)}>
                    <span className="soc-quick__card-title">{item.displayTitle}<span aria-hidden="true">↗</span></span>
                    <span className="soc-quick__card-description">已置顶会话，点击继续对话。</span>
                  </button>
                ))}
            </div>
          ) : tab === 'employees' && employeeEditing ? <div className="soc-quick__grid" role="tabpanel"><button type="button" className="soc-quick__card soc-employee-add" onClick={() => openEmployeeForm()}><span aria-hidden="true">＋</span>新增数字员工</button></div> : <p className="soc-quick__empty" role="tabpanel">{tab === 'favorites' && !keyword
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
      div:has(> button[aria-label="选择工作区"]),div:has(> button[aria-label="Choose workspace"]){display:none}
      button[aria-label="添加工作区"],button[aria-label="Add workspace"]{display:none}
      .soc-brand-mark{display:block;object-fit:contain}
      .soc-brand-name{font-size:14px;font-weight:600;white-space:nowrap}
      .soc-hero-brand{display:inline-flex;align-items:center;gap:12px;white-space:nowrap}
      .soc-hero-brand img{display:block;object-fit:cover;border-radius:12px}
      .soc-hero-brand strong{font-size:20px;font-weight:600}
      div:has(> span > .soc-hero-brand){justify-content:flex-start}
      span:has(> [data-slot="conversation.hero.brand.mark"] .soc-hero-brand)+span{display:none}
      .soc-quick{order:10;width:100%;padding-top:14px;color:var(--dsw-alias-label-primary,#242933)}
      .soc-runtime{display:grid;gap:10px;margin-bottom:18px;padding:11px 12px 10px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:12px;background:linear-gradient(135deg,#e9f4ff88,transparent 42%),repeating-linear-gradient(0deg,#1677ff08 0 1px,transparent 1px 22px),repeating-linear-gradient(90deg,#1677ff08 0 1px,transparent 1px 22px),var(--dsw-alias-bg-base,#fff)}
      .soc-runtime__header{display:flex;align-items:center;gap:12px;min-width:0}
      .soc-runtime__title{display:flex;align-items:center;gap:6px;white-space:nowrap}
      .soc-runtime__title strong{font-size:16px}
      .soc-runtime__title span{padding:3px 7px;border:1px solid #b5d5ff;border-radius:99px;background:#eaf3ff;color:#2465ad;font-size:11px}
      .soc-runtime__summary{display:flex;flex:1;align-items:center;min-width:0;margin:0}
      .soc-runtime__summary div{display:flex;align-items:baseline;gap:5px;padding:0 11px;border-left:1px solid var(--dsw-alias-border-l2,#e4e7ec)}
      .soc-runtime__summary dt{color:var(--dsw-alias-label-secondary,#667085);font-size:12px;white-space:nowrap}
      .soc-runtime__summary dd{margin:0;font-size:15px;font-weight:700}
      .soc-runtime__expand{flex:none;padding:6px 9px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer;font:inherit;font-size:12px}
      .soc-runtime__strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
      .soc-runtime__card{flex:1 0 185px;min-width:185px;display:grid;gap:9px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-left:3px solid var(--runtime-accent);border-radius:9px;background:var(--runtime-soft);color:inherit;font:inherit;text-align:left}
      .soc-runtime__card:hover{border-color:var(--runtime-accent);box-shadow:0 5px 14px #1f23291a}
      .soc-runtime__card--healthy{--runtime-accent:#27b575;--runtime-soft:#f3fbf7}
      .soc-runtime__card--running{--runtime-accent:#1677ff;--runtime-soft:#f0f6ff}
      .soc-runtime__card--pending,.soc-runtime__card--unknown{--runtime-accent:#98a2b3;--runtime-soft:#f6f7f9}
      .soc-runtime__card-head{display:flex;align-items:center;gap:8px;min-width:0}
      .soc-runtime__card-head img{flex:none;border:1px solid var(--runtime-accent);border-radius:50%;object-fit:cover}
      .soc-runtime__identity{display:grid;gap:3px;min-width:0;flex:1}
      .soc-runtime__identity>span{display:flex;align-items:center;justify-content:space-between;gap:5px;min-width:0}
      .soc-runtime__identity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
      .soc-runtime__identity em{flex:none;padding:3px 6px;border:1px solid var(--runtime-accent);border-radius:99px;color:var(--runtime-accent);background:var(--dsw-alias-bg-base,#fff);font-size:11px;font-style:normal}
      .soc-runtime__identity small{color:var(--dsw-alias-label-secondary,#667085);font-size:12px;white-space:nowrap}
      .soc-runtime__identity .soc-runtime__activity{display:flex;flex-wrap:wrap;gap:2px 8px}
      .soc-runtime__identity b{color:var(--dsw-alias-label-primary,#242933)}
      .soc-runtime__detail{padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2,#e4e7ec);color:var(--dsw-alias-label-secondary,#667085);font-size:12px;line-height:1.5}
      .soc-quick__heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 12px 10px}
      .soc-quick__heading strong{font-size:16px}
      .soc-quick__status{border:0;background:transparent;color:var(--dsw-alias-brand-primary,#1677ff);cursor:pointer;font:inherit;white-space:nowrap}
      .soc-quick__toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 14px}
      .soc-quick__tabs{display:flex;align-items:center;gap:5px}
      .soc-quick__tabs button{padding:8px 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#667085);cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}
      .soc-quick__tabs button[aria-selected=true]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#242933);box-shadow:0 2px 12px rgba(31,35,41,.06)}
      .soc-employee-edit-toggle{padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-brand-primary,#1677ff);cursor:pointer;font:inherit;font-size:13px}
      .soc-quick__search{display:flex;align-items:center;gap:7px;min-width:160px;width:min(260px,42%);height:34px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#667085)}
      .soc-quick__search{margin-left:auto}
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
      .soc-employee-add{display:grid;place-items:center;align-content:center;gap:8px;color:var(--dsw-alias-brand-primary,#1677ff);text-align:center}
      .soc-employee-add span{font-size:24px}
      .soc-employee-actions{display:flex;gap:6px;margin-top:12px}
      .soc-employee-actions button,.soc-employee-form button{padding:5px 9px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer;font:inherit;font-size:12px}
      .soc-employee-actions button:last-child{color:var(--dsw-alias-error-primary,#d92d20)}
      .soc-employee-scope{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#667085);font-size:12px}
      .soc-employee-form{display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:14px;padding:14px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:9px;background:var(--dsw-alias-bg-base,#fff)}
      .soc-employee-form label{display:grid;gap:5px;font-size:12px}
      .soc-employee-form label:nth-child(3){grid-column:1/-1}
      .soc-employee-form input{min-width:0;padding:8px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:6px;background:transparent;color:inherit;font:inherit}
      .soc-employee-form>div{grid-column:1/-1;display:flex;justify-content:flex-end;gap:7px}
      .soc-employee-form>div button:last-child{border-color:var(--dsw-alias-brand-primary,#1677ff);background:var(--dsw-alias-brand-primary,#1677ff);color:#fff}
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
      @media(max-width:1100px){.soc-quick__grid{grid-template-columns:repeat(2,minmax(0,1fr))}.soc-runtime__header{flex-wrap:wrap}.soc-runtime__summary{flex-basis:100%;order:3}.soc-runtime__summary div:first-child{padding-left:0;border-left:0}}
      @media(max-width:720px){.soc-quick__grid{grid-template-columns:1fr}.soc-quick__toolbar{align-items:stretch;flex-direction:column}.soc-quick__search{width:100%;box-sizing:border-box;margin-left:0}.soc-employee-form{grid-template-columns:1fr}.soc-employee-form label:nth-child(3){grid-column:auto}}
    `

    const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'uiWorkspace', 'workspaces', 'sessions', 'remote.agentPresets', 'locale', 'configForms']
    function apply(ctx: any) {
      ctx.effect(() => {
        const preference = ctx.configForms.get('locale')
        let settled = false
        const setDefault = () => {
          if (settled) return
          const snapshot = preference.getSnapshot()
          if (snapshot.mode === 'memory') {
            settled = true
            ctx.locale.setLocale('zh')
          } else if (snapshot.status === 'ready') {
            settled = true
            if (!snapshot.value?.preference) ctx.locale.setLocale('zh')
          }
        }
        const unsubscribe = preference.subscribe(setDefault)
        setDefault()
        return unsubscribe
      }, 'security-operations-ui: default Chinese locale')

      ctx.effect(() => {
        let disposed = false
        let workspaceId: string | undefined
        let moving = false
        const presetAttempts = new Set<string>()
        const reconcile = () => {
          if (disposed || !workspaceId) return
          const blank = Object.values(ctx.sessions.list.getSnapshot().byId).find((session: any) =>
            session.blank && (session.retainedBy.mainView ?? 0) > 0) as any
          if (!blank) return
          const owner = ctx.workspaces.list.getSnapshot().items.find((item: any) => item.sessionIds.includes(blank.id))
          if (owner?.workspaceId !== workspaceId) {
            if (moving) return
            moving = true
            void ctx.uiWorkspace.openWorkspace(workspaceId).then(
              () => { moving = false; reconcile() },
              (error: unknown) => { moving = false; console.error('固定工作区切换失败', error) },
            )
            return
          }
          if (blank.projectionValues?.agentPreset === AGENT_PRESET || presetAttempts.has(blank.id)) return
          presetAttempts.add(blank.id)
          void ctx.remote.agentPresets.select(blank.id, AGENT_PRESET).then(
            (result: any) => { if (!result.ok) console.error('固定 Agent 预设失败', result.error) },
            (error: unknown) => { console.error('固定 Agent 预设失败', error) },
          )
        }
        const unsubscribe = ctx.sessions.list.subscribe(reconcile)
        void ctx.workspaces.create({ path: WORKSPACE_PATH }).then(
          (workspace: any) => { if (!disposed) { workspaceId = workspace.workspaceId; reconcile() } },
          (error: unknown) => { console.error('注册固定工作区失败', error) },
        )
        return () => { disposed = true; unsubscribe() }
      }, 'security-operations-ui: fixed workspace and agent preset')

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
