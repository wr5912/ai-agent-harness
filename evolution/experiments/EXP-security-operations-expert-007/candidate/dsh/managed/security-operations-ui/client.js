window.__ModuleLoader__.load({
  id: 'dsh-security-operations-ui',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PLUGIN_ID = 'dsh-security-operations-ui'
    const STATUS_KIND = 'security-operations-status'
    const actions = [
      {
        title: '最近24小时网络总结报告',
        description: '汇总最近24小时网络运行、安全事件、风险变化及待处理事项。',
        prompt: '请生成最近24小时网络总结报告，汇总网络运行、安全事件、风险变化和待处理事项，并标明事实、推断与证据缺口。',
      },
      {
        title: '自动巡检',
        description: '巡检已接入设备、关键资产、服务和数据链路，定位异常与待办。',
        prompt: '请对已接入的设备、关键资产、服务和数据链路执行一次常规全量巡检，如实返回异常、证据缺口和待办。',
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

    function QuickActions({ session, inputActions, openStatus }) {
      React.useEffect(() => {
        if (!session.blank) return undefined
        const frame = requestAnimationFrame(openStatus)
        return () => cancelAnimationFrame(frame)
      }, [session.blank, openStatus])

      if (!session.blank) return null
      return h('section', { className: 'soc-quick', 'aria-labelledby': 'soc-quick-title' },
        h('div', { className: 'soc-quick__heading' },
          h('div', null,
            h('strong', { id: 'soc-quick-title' }, 'AI-SOC 快捷任务'),
            h('span', null, '选择任务后可继续编辑，确认后再发送')),
          h('button', { type: 'button', className: 'soc-quick__status', onClick: openStatus }, '系统消息')),
        h('div', { className: 'soc-quick__grid' }, actions.map(action =>
          h('button', {
            key: action.title,
            type: 'button',
            className: 'soc-quick__card',
            onClick: () => inputActions.setDraft(action.prompt),
          },
          h('span', { className: 'soc-quick__card-title' }, action.title, h('span', { 'aria-hidden': 'true' }, '↗')),
          h('span', { className: 'soc-quick__card-description' }, action.description))))
      )
    }

    function StatusPanel({ useSession }) {
      const queued = useSession(state => state.queue.length)
      const submitting = useSession(state => state.pendingSubmissions.length)
      const running = useSession(state => state.running)
      const attempted = useSession(state => state.promptAttempted)
      const awaiting = useSession(state => state.awaitingFirstTurn)
      const failed = useSession(state => state.lastAgentError !== null || state.promptError !== null || state.openError !== null)
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
      const metrics = [
        ['1', '当前'],
        [String(pending), '待处理'],
        [running || awaiting ? '1' : '0', '执行中'],
        [String(completed), '已完成'],
      ]

      return h('section', { className: 'soc-status', 'aria-labelledby': 'soc-status-title' },
        h('header', null,
          h('strong', { id: 'soc-status-title' }, '系统消息'),
          h('span', null, '当前会话')),
        h('div', { className: 'soc-status__metrics' }, metrics.map(([value, label]) =>
          h('div', { key: label }, h('strong', null, value), h('span', null, label)))),
        h('p', { className: failed ? 'soc-status__message soc-status__message--error' : 'soc-status__message' }, message))
    }

    const css = `
      .soc-quick{order:10;width:100%;padding-top:14px;color:var(--dsw-alias-label-primary,#242933)}
      .soc-quick__heading{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 12px 12px}
      .soc-quick__heading>div{display:flex;align-items:baseline;gap:12px;min-width:0}
      .soc-quick__heading strong{font-size:16px}
      .soc-quick__heading span{color:var(--dsw-alias-label-secondary,#667085);font-size:12px}
      .soc-quick__status{border:0;background:transparent;color:var(--dsw-alias-brand-primary,#1677ff);cursor:pointer;font:inherit;white-space:nowrap}
      .soc-quick__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .soc-quick__card{min-height:116px;padding:16px;border:1px solid var(--dsw-alias-border-l2,#e4e7ec);border-radius:10px;background:var(--dsw-alias-bg-base,#fff);color:inherit;cursor:pointer;font:inherit;text-align:left;transition:border-color .15s,box-shadow .15s,transform .15s}
      .soc-quick__card:hover{border-color:var(--dsw-alias-brand-primary,#1677ff);box-shadow:0 6px 18px rgba(31,35,41,.08);transform:translateY(-1px)}
      .soc-quick__card:focus-visible,.soc-quick__status:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#1677ff);outline-offset:2px}
      .soc-quick__card-title{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;font-size:14px;font-weight:600}
      .soc-quick__card-title span{color:var(--dsw-alias-label-secondary,#667085);font-weight:400}
      .soc-quick__card-description{display:block;color:var(--dsw-alias-label-secondary,#667085);font-size:13px;line-height:1.55}
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
      @media(max-width:720px){.soc-quick__grid{grid-template-columns:1fr}.soc-quick__heading>div{align-items:flex-start;flex-direction:column;gap:4px}}
    `

    const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshSecurityOperationsUi = 'true'
        style.textContent = css
        document.head.appendChild(style)
        return () => style.remove()
      }, 'security-operations-ui: styles')

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
      const Dock = props => h(QuickActions, { ...props, openStatus })
      ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
        { name: 'conversation.input.dock', id: PLUGIN_ID, order: 100 },
        Dock,
      )), 'security-operations-ui: quick actions')
    }

    return { apply, inject }
  },
})
