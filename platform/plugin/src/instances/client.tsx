import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CHANNEL } from '../protocol.ts'
import type { PlatformNavigation, PlatformPageProps } from '../protocol.ts'
import type { PlatformUpdates } from '../realtime/client.ts'
import { instanceWebUrl } from './url.ts'

type Operation = 'create' | 'start' | 'stop' | 'restart' | 'delete'

interface InstanceRow {
  name: string
  state?: string
  source_id?: string
  image_tag?: string
  agent_id?: string
  port?: number
  lan_access?: boolean
  home_volume?: string
  home_directory?: string
  home_preserved?: boolean | null
  container_name?: string
  observed_at?: string
  mounts?: Record<string, string>
  mount_modes?: Record<string, string>
  ps?: string
}

interface ActionRequest {
  operation: Operation
  name: string
  source?: string
  expected_source_id?: string
  port?: number
}

interface Detail {
  instance: InstanceRow
  runs: { id: string, path: string }[]
  session_scope: { home_volume?: unknown, preserved?: unknown, note: string }
}

interface Receipt {
  name: string
  operation: Operation
  ok: boolean
  value?: unknown
  error?: { message: string }
}

const labels: Record<Operation, string> = {
  create: '创建',
  start: '启动',
  stop: '停止',
  restart: '重启',
  delete: '删除',
}

const detailTabs = [{ id: 'overview', label: '概览' }, { id: 'embed', label: '网站嵌入' }, { id: 'logs', label: '运行日志' }] as const
const stateLabels: Record<string, string> = { running: '运行中', stopped: '已停止', absent: '无容器', failed: '异常', unknown: '状态未知' }

export function InstancesPage({ rpc, updates, onContext, target, onNavigate }: PlatformPageProps & { updates?: PlatformUpdates; target?: PlatformNavigation; onNavigate?(target: PlatformNavigation): void; onContext?(context: Record<string, unknown>): void }) {
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('existing')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  useEffect(() => {
    if (target?.page === 'instances') setSourceFilter(target.experiment_id ? `experiment:${target.experiment_id}` : '')
  }, [target?.page, target?.experiment_id])
  const [detailLoading, setDetailLoading] = useState(false)
  const [opening, setOpening] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<unknown>(null)
  const [pending, setPending] = useState<{ operation: Operation, items: ActionRequest[] } | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [actionDialog, setActionDialog] = useState<Operation | null>(null)
  const [creating, setCreating] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [form, setForm] = useState({ name: '', source: '', port: '' })
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailTab, setDetailTab] = useState<typeof detailTabs[number]['id']>('overview')
  const [detailNotice, setDetailNotice] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [logs, setLogs] = useState('')
  const [logsError, setLogsError] = useState('')
  const [embedUrl, setEmbedUrl] = useState('')
  const [embedMessage, setEmbedMessage] = useState('')
  const embedRequest = useRef(0)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const detailName = useRef<string | undefined>(undefined)
  const embedCode = embedUrl ? `<iframe\n  src="${embedUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"\n  title="DSH 智能体"\n  style="width: 100%; height: 700px; border: 0;"\n  allow="clipboard-write"\n></iframe>` : ''

  const visible = useMemo(() => instances.filter(item => (!sourceFilter || item.source_id === sourceFilter) && (filter === 'all' || (filter === 'existing' ? item.state !== 'absent' : item.state === filter)) && `${item.name} ${item.source_id ?? ''}`.toLowerCase().includes(query.toLowerCase())), [instances, filter, query, sourceFilter])
  const visibleSelected = visible.filter(item => selected.has(item.name)).length

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await rpc.call(CHANNEL, `instances/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }

  async function refresh(background = false) {
    const request = ++listRequest.current
    setLoading(true)
    if (!background) setError('')
    try {
      const data = await call<{ instances: InstanceRow[] }>('list', {})
      if (request !== listRequest.current) return
      setInstances(data.instances)
      setRefreshError('')
      if (detailName.current) {
        if (data.instances.some(item => item.name === detailName.current)) void openDetail(detailName.current, true)
        else {
          detailRequest.current++
          embedRequest.current++
          setDetailLoading(false)
          setDetail(current => current ? { ...current, instance: { ...current.instance, state: 'unknown' } } : current)
          setDetailNotice(`所选实例 ${detailName.current} 的登记已不存在，请重新选择。`)
          setLogs('')
          setLogsError('')
          setEmbedUrl('')
          setEmbedMessage('')
        }
      }
    } catch (err) {
      if (request === listRequest.current) setRefreshError((err as Error).message)
    } finally {
      if (request === listRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    return () => { listRequest.current++; detailRequest.current++ }
  }, [])
  useEffect(() => updates?.subscribe(() => {
    const domains = updates.getSnapshot().domains
    if (domains.includes('instances')) void refresh(true)
    else if (domains.includes('agents') && detailName.current) void openDetail(detailName.current, true)
  }), [updates])
  useEffect(() => {
    onContext?.({ page: 'instances', instance_name: detail?.instance.name, selected_instances: [...selected] })
  }, [detail?.instance.name, selected, onContext])
  useEffect(() => {
    if (actionDialog) dialog.current?.showModal()
    else dialog.current?.close()
  }, [actionDialog])

  function updateForm(next: typeof form) {
    setForm(next)
    setPreview(null)
    setPending(null)
  }

  function createRequest(): ActionRequest {
    return {
      operation: 'create',
      name: form.name,
      source: form.source,
      port: form.port ? Number(form.port) : undefined,
    }
  }

  async function prepare(operation: Operation, names: string[]) {
    setActionDialog(operation)
    setReceipts([])
    setBusy(true)
    setError('')
    setPreview(null)
    setPending(null)
    try {
      const items = operation === 'create'
        ? [createRequest()]
        : names.map(name => ({ operation, name }))
      const data = items.length === 1
        ? await call('preview', items[0])
        : await call('batch-preview', { items })
      setPreview(data)
      const previews = items.length === 1 ? [data] : (data as any).previews.map((item: any) => item.value)
      const frozen = items.map(item => {
        if (operation === 'create') return item
        const preview = previews.find((value: any) => value?.name === item.name) as any
        const source = preview?.plan?.source_id ?? preview?.source_id
        if (typeof source !== 'string' || !source) throw new Error('预览缺少实例来源，请刷新后重新预览。')
        return { ...item, expected_source_id: source }
      })
      setPending({ operation, items: frozen })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function execute() {
    if (!pending) return
    setBusy(true)
    setError('')
    setPreview(null)
    setReceipts([])
    let transportError = ''
    try {
      const concurrency = pending.operation === 'delete' ? 5 : 1
      for (let offset = 0; offset < pending.items.length; offset += concurrency) {
        const results = await Promise.allSettled(pending.items.slice(offset, offset + concurrency).map(async item => {
          try {
            const receipt = await call<Receipt>('run', item)
            setReceipts(current => [...current, receipt])
          } catch (err) {
            setReceipts(current => [...current, { ...item, ok: false, error: { message: '回执未收到，执行结果未知；请刷新核对。' } }])
            throw err
          }
        }))
        const failed = results.find(result => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      }
    } catch (err) {
      transportError = `连接失败，后续操作已停止。已收到的回执保留；请核对实例状态后重新选择。${(err as Error).message}`
    } finally {
      setPending(null)
      await refresh()
      if (transportError) setError(transportError)
      setBusy(false)
    }
  }

  async function openDetail(name: string, background = false) {
    const request = ++detailRequest.current
    detailName.current = name
    if (!background) {
      embedRequest.current++
      setDetail(null)
      setDetailTab('overview')
      setLogs('')
      setLogsError('')
      setEmbedUrl('')
      setEmbedMessage('')
    }
    setDetailLoading(true)
    if (!background) setError('')
    try {
      const [nextDetail, nextLogs] = await Promise.all([
        call<Detail>('detail', { name }),
        call<{ logs: string }>('logs', { name, tail: 200 }).then(value => ({ logs: value.logs, error: '' }), err => ({ logs: '', error: (err as Error).message })),
      ])
      if (request !== detailRequest.current || name !== detailName.current) return
      setDetail(nextDetail)
      setDetailNotice('')
      setLogs(nextLogs.logs)
      setLogsError(nextLogs.error)
    } catch (err) {
      if (request === detailRequest.current) {
        setDetailNotice((err as Error).message)
        if (!background) setError((err as Error).message)
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false)
    }
  }

  function closeDetail() {
    detailRequest.current++
    embedRequest.current++
    detailName.current = undefined
    setDetail(null)
    setDetailLoading(false)
    setDetailNotice('')
    setLogs('')
    setLogsError('')
    setEmbedUrl('')
    setEmbedMessage('')
  }

  async function webUrl(name: string) {
    const result = await call<{ url: string, lan_access: boolean }>('url', { name })
    return instanceWebUrl(result, window.location.hostname)
  }

  async function generateEmbed(name: string) {
    const request = ++embedRequest.current
    setEmbedUrl('')
    setEmbedMessage('正在读取实例地址…')
    try {
      const url = await webUrl(name)
      if (request !== embedRequest.current) return
      setEmbedUrl(url)
      setEmbedMessage('将以下代码粘贴到网站的 HTML 中。')
    } catch (err) {
      if (request === embedRequest.current) setEmbedMessage((err as Error).message)
    }
  }

  async function copyEmbed() {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(embedCode)
      else {
        const input = document.createElement('textarea')
        input.value = embedCode
        document.body.appendChild(input)
        input.select()
        try { if (!document.execCommand('copy')) throw new Error('copy failed') } finally { input.remove() }
      }
      setEmbedMessage('嵌入代码已复制。')
    } catch { setEmbedMessage('浏览器未允许复制，请手动复制下面的代码。') }
  }

  async function openWeb(name: string) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setError('浏览器阻止了新标签页，请允许弹出窗口后重试。')
      return
    }
    tab.opener = null
    tab.document.title = '正在打开 DSH Web'
    tab.document.body.textContent = '正在获取实例访问地址…'
    setOpening(current => new Set(current).add(name))
    setError('')
    try {
      const url = await webUrl(name)
      if (!tab.closed) tab.location.replace(url)
    } catch (err) {
      tab.close()
      setError((err as Error).message)
    } finally {
      setOpening(current => { const next = new Set(current); next.delete(name); return next })
    }
  }

  const selectedNames = [...selected]
  const missingSelections = selectedNames.filter(name => !instances.some(item => item.name === name))
  const containerCount = instances.filter(item => ['running', 'stopped', 'failed'].includes(item.state ?? '')).length
  const absentCount = instances.filter(item => item.state === 'absent').length
  const unknownCount = instances.length - containerCount - absentCount

  return (
    <main style={styles.page} aria-label="实例管理">
      <header className="harness-page-heading" style={styles.pageHeading}>
        <div><p>管理智能体实例的运行、访问与网站嵌入。</p><div style={styles.summaryStats}>{containerCount} 个容器实例 · {absentCount} 个无容器登记{unknownCount > 0 && ` · ${unknownCount} 个状态未知`}</div></div>
        <button type="button" className="harness-primary" aria-expanded={creating} aria-controls="instance-create" onClick={() => setCreating(value => !value)}>新建实例</button>
      </header>
      {creating && <section id="instance-create" aria-label="新建实例" style={styles.createPanel}>
        <div style={styles.createHeading}><strong>新建实例</strong><button type="button" onClick={() => setCreating(false)} style={styles.button}>收起</button></div>
        <p style={styles.createNote}>选择已有版本作为来源。预览配置并确认后，才会创建实例。</p>
        <div style={styles.createFields}>
          <label style={styles.field}>实例名<input aria-label="实例名" placeholder="例如 my-agent" value={form.name}
            onChange={event => updateForm({ ...form, name: event.target.value })} style={styles.fieldInput} /></label>
          <label style={styles.field}>来源版本<input aria-label="来源" placeholder="experiment:EXP-..." value={form.source}
            onChange={event => updateForm({ ...form, source: event.target.value })} style={styles.fieldInput} /></label>
          <label style={styles.field}>访问端口（可选）<input aria-label="端口" placeholder="留空自动分配" value={form.port}
            onChange={event => updateForm({ ...form, port: event.target.value })} style={styles.fieldInput} /></label>
        </div>
        <div style={styles.createActions}><button type="button" className="harness-primary" disabled={busy || !form.name || !form.source}
          onClick={() => prepare('create', [])}>创建预览</button></div>
      </section>}
      <section aria-label="实例筛选" style={styles.filterPanel}>
        {sourceFilter && <div style={styles.sourceFilter}><span>关联来源：{sourceFilter}</span><button type="button" onClick={() => { setSourceFilter(''); onNavigate?.({ page: 'instances' }) }}>查看全部实例</button></div>}
        <div style={styles.filterRow}>
          <label style={styles.filterField}>状态<select aria-label="状态筛选" value={filter} onChange={event => setFilter(event.target.value)} style={styles.fieldInput}>
            <option value="existing">现有容器</option><option value="all">全部登记</option>
            <option value="running">运行中</option><option value="stopped">已停止</option>
            <option value="absent">无容器（仅登记）</option><option value="failed">异常</option><option value="unknown">状态未知</option>
          </select></label>
          <label style={styles.searchField}>搜索<input aria-label="搜索实例" placeholder="输入实例名或来源版本" value={query} onChange={event => setQuery(event.target.value)} style={styles.fieldInput} /></label>
          <button type="button" onClick={() => void refresh()} disabled={loading} style={styles.button}>{loading ? '读取中…' : '刷新'}</button>
        </div>
        {selectedNames.length > 0 && <div aria-label="批量操作" style={styles.batchBar}>
          <strong style={{ fontSize: 13 }}>已选择 {selected.size} 个</strong>
          {selected.size > visibleSelected && <span style={styles.muted}>其中 {selected.size - visibleSelected} 个不在当前列表</span>}
          {(['start', 'stop', 'restart', 'delete'] as Operation[]).map(operation => <button key={operation} type="button" disabled={busy || missingSelections.length > 0}
            onClick={() => prepare(operation, selectedNames)} style={styles.button}>{labels[operation]}</button>)}
          <button type="button" disabled={busy} onClick={() => setSelected(new Set())} style={styles.button}>取消选择</button>
          {missingSelections.length > 0 && <span role="status" style={styles.selectionNotice}>{missingSelections.length} 个所选登记已不存在。<button type="button" onClick={() => setSelected(current => new Set([...current].filter(name => !missingSelections.includes(name))))}>清除失效选择</button></span>}
        </div>}
      </section>

      {error && !actionDialog ? <div role="alert" style={styles.error}>{error}</div> : null}
      {refreshError && <div role="alert" style={styles.error}>{refreshError}</div>}

      <section aria-label="实例列表" style={styles.listPanel}>
        <div style={styles.listHeading}><strong>实例列表</strong><span style={styles.muted}>显示 {visible.length} 项 · 勾选后可批量操作</span></div>
        <div style={styles.tableWrap}><table style={styles.table}>
          <colgroup><col style={{ width: 44 }}/><col style={{ width: 200 }}/><col style={{ width: 108 }}/><col/><col style={{ width: 72 }}/><col style={{ width: 160 }}/><col style={{ width: 220 }}/></colgroup>
          <thead>
            <tr>
              <th style={styles.listTh}>
                <input type="checkbox" aria-label="全选当前列表实例" disabled={loading || visible.length === 0}
                  checked={visible.length > 0 && visibleSelected === visible.length}
                  ref={element => { if (element) element.indeterminate = visibleSelected > 0 && visibleSelected < visible.length }}
                  onChange={event => setSelected(current => {
                    const next = new Set(current)
                    for (const item of visible) {
                      if (event.target.checked) next.add(item.name)
                      else next.delete(item.name)
                    }
                    return next
                  })} />
              </th>
              <th style={styles.listTh}>实例</th><th style={styles.listTh}>状态</th><th style={styles.listTh}>来源版本</th>
              <th style={styles.listTh}>端口</th><th style={styles.listTh}>访问入口</th><th style={styles.listTh}>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(item => (
              <tr key={item.name}>
                <td style={styles.listTd}>
                  <input type="checkbox" aria-label={`选择实例 ${item.name}`} checked={selected.has(item.name)}
                    onChange={event => setSelected(current => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(item.name)
                      else next.delete(item.name)
                      return next
                    })} />
                </td>
                <td style={{ ...styles.listTd, fontWeight: 600 }}>{item.name}</td>
                <td style={styles.listTd}><span style={{ ...styles.stateBadge, whiteSpace: 'nowrap', color: stateStyle(item.state).color }}>{stateLabels[item.state ?? 'unknown'] || item.state}</span></td>
                <td style={{ ...styles.listTd, color: 'var(--dsw-alias-text-secondary, #63748a)' }}>{item.source_id || '未记录'}</td>
                <td style={styles.listTd}>{item.port || '—'}</td>
                <td style={styles.listTd}>
                  <button type="button" disabled={item.state !== 'running' || !item.port || opening.has(item.name)}
                    onClick={() => openWeb(item.name)} style={styles.button}
                    title={item.state !== 'running' ? '实例运行后可访问' : item.lan_access ? '在新标签页打开' : '仅宿主机浏览器可访问'}>
                    {opening.has(item.name) ? '正在打开…' : '访问 DSH Web'}
                  </button>
                  <div style={{ ...styles.muted, marginTop: 6 }}>{item.state !== 'running' ? '实例运行后可访问' : !item.port ? '未记录端口' : !item.lan_access ? '仅宿主机' : null}</div>
                </td>
                <td style={styles.listTd}><div style={styles.actions}>
                  <button type="button" onClick={() => openDetail(item.name)} disabled={detailLoading} style={styles.button}>详情</button>
                  {(item.state === 'running' ? ['stop', 'restart'] : item.state === 'stopped' || item.state === 'absent' ? ['start', 'delete'] : item.state === 'failed' ? ['start', 'stop'] : []).map(operation =>
                    <button type="button" key={operation} disabled={busy} onClick={() => prepare(operation as Operation, [item.name])} style={styles.button}>{labels[operation as Operation]}</button>)}
                  {item.state === 'unknown' && <span>观察失败，请刷新</span>}
                </div></td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={7} style={styles.emptyList}>{loading ? '正在读取实例…' : instances.length === 0 ? '暂无实例。点击右上角“新建实例”开始创建。' : '没有符合当前筛选条件的实例。请调整状态或搜索内容。'}</td></tr>}
          </tbody>
        </table></div>
      </section>

      {detailLoading && !detail && <p role="status">正在读取实例详情…</p>}
      {detail ? (
        <section className="harness-instance-detail" aria-label="实例详情" style={styles.panel}>
          <header style={styles.detailHeader}>
            <div style={{ minWidth: 0 }}><small style={styles.muted}>实例详情</small><div style={styles.detailTitle}>
              <h2 style={{ margin: 0, fontSize: 18, overflowWrap: 'anywhere' }}>{detail.instance.name}</h2>
              <span style={{ ...styles.stateBadge, color: stateStyle(detail.instance.state).color }}>{stateLabels[detail.instance.state ?? 'unknown'] || detail.instance.state}</span>
            </div></div>
            <div style={styles.actions}>
              <button type="button" className="harness-primary" disabled={detail.instance.state !== 'running' || !detail.instance.port || opening.has(detail.instance.name)} onClick={() => void openWeb(detail.instance.name)}>{opening.has(detail.instance.name) ? '正在打开…' : '访问 DSH Web'}</button>
              <button type="button" style={{ ...styles.button, padding: '0 10px', fontSize: 13 }} disabled={detailLoading} onClick={() => void openDetail(detail.instance.name, true)}>{detailLoading ? '刷新中…' : '刷新详情'}</button>
              <button type="button" style={{ ...styles.button, padding: '0 10px', fontSize: 13 }} onClick={closeDetail}>关闭详情</button>
            </div>
          </header>
          {detailNotice && <p role="alert" style={styles.detailNotice}>{detailNotice}</p>}
          {(detail.instance.state === 'failed' || detail.instance.state === 'unknown') && <p role="alert" style={styles.detailNotice}>实例状态异常，请先查看运行日志，再决定是否停止或删除。</p>}
          <div role="tablist" aria-label="实例详情" style={styles.detailTabs} onKeyDown={event => {
            const index = detailTabs.findIndex(item => item.id === detailTab)
            const next = event.key === 'ArrowRight' ? (index + 1) % detailTabs.length : event.key === 'ArrowLeft' ? (index + detailTabs.length - 1) % detailTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? detailTabs.length - 1 : undefined
            if (next === undefined) return
            event.preventDefault()
            setDetailTab(detailTabs[next].id)
            document.getElementById(`instance-tab-${detailTabs[next].id}`)?.focus()
          }}>{detailTabs.map(item => <button key={item.id} id={`instance-tab-${item.id}`} type="button" role="tab" aria-selected={detailTab === item.id} aria-controls={`instance-panel-${item.id}`} tabIndex={detailTab === item.id ? 0 : -1} onClick={() => setDetailTab(item.id)} style={{ ...styles.detailTab, ...(detailTab === item.id ? styles.activeTab : {}) }}>{item.label}</button>)}</div>

          <section id="instance-panel-overview" role="tabpanel" aria-labelledby="instance-tab-overview" hidden={detailTab !== 'overview'} style={styles.detailBody}>
            <dl style={styles.detailGrid}>
              {[
                ['来源版本', detail.instance.source_id || '未记录'],
                ['智能体', detail.instance.agent_id || '未记录'],
                ['访问端口', detail.instance.port || '未记录'],
                ['运行镜像', detail.instance.image_tag || '未记录'],
                ['HOME 存储', String(detail.instance.home_directory || detail.session_scope.home_volume || detail.instance.home_volume || '未记录')],
                ['HOME 保留状态', detail.session_scope.preserved === true ? '已保留' : detail.session_scope.preserved === false ? '未保留' : '尚未确认'],
              ].map(([label, value]) => <div key={label} style={styles.fact}><dt style={styles.muted}>{label}</dt><dd style={styles.factValue}>{value}</dd></div>)}
            </dl>
            <div style={styles.sessionNote}><strong>会话与数据</strong><p style={{ margin: '6px 0 0' }}>{detail.session_scope.note || '未记录会话说明。'}</p></div>
            <details style={styles.detailFold}><summary style={styles.foldTitle}>挂载配置 · {Object.keys(detail.instance.mounts || {}).length} 项</summary>
              {Object.keys(detail.instance.mounts || {}).length ? <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={styles.mountTable}><thead><tr><th style={styles.th}>用途</th><th style={styles.th}>来源路径</th><th style={styles.th}>权限</th></tr></thead><tbody>{Object.entries(detail.instance.mounts || {}).map(([name, path]) => {
                const mode = detail.instance.mount_modes?.[name]
                return <tr key={name}><td style={styles.td}>{name}</td><td style={{ ...styles.td, fontFamily: 'monospace' }}>{path}</td><td style={styles.td}>{mode === 'ro' ? '只读' : mode === 'rw' ? '读写' : mode || '未记录'}</td></tr>
              })}</tbody></table></div> : <p style={styles.muted}>暂无挂载配置。</p>}
            </details>
            <details style={styles.detailFold}><summary style={styles.foldTitle}>来源版本的运行记录 · {detail.runs.length} 条</summary>
              {detail.runs.length ? <ul style={styles.runList}>{detail.runs.map(run => <li key={run.id} style={styles.runItem}>
                {onNavigate ? <button type="button" style={styles.runLink} onClick={() => onNavigate({ page: 'evaluation', run_id: run.id, agent_id: detail.instance.agent_id })}>{run.id}</button> : <code>{run.id}</code>}
                <small style={{ ...styles.muted, overflowWrap: 'anywhere' }}>{run.path}</small>
              </li>)}</ul> : <p style={styles.muted}>此来源版本暂无运行记录。</p>}
            </details>
          </section>

          <section id="instance-panel-embed" role="tabpanel" aria-labelledby="instance-tab-embed" hidden={detailTab !== 'embed'} style={styles.detailBody}>
            <div style={styles.embedHeading}><div><h3 style={styles.sectionTitle}>将智能体嵌入网站</h3><p style={styles.muted}>生成 iframe 代码，粘贴到网站的 HTML 中即可展示此实例。</p></div>
              <button type="button" style={styles.button} disabled={detail.instance.state !== 'running' || !detail.instance.port} onClick={() => void generateEmbed(detail.instance.name)}>{embedCode ? '重新生成代码' : '生成 iframe 代码'}</button>
            </div>
            {(detail.instance.state !== 'running' || !detail.instance.port) && <p role="status">实例运行且记录访问端口后，才可生成嵌入代码。</p>}
            {embedCode ? <div style={styles.codeBox}><div style={styles.codeHeading}><span>HTML 嵌入代码</span><button type="button" style={styles.button} onClick={() => void copyEmbed()}>复制嵌入代码</button></div><pre style={styles.embedCode}>{embedCode}</pre></div> : <div style={styles.embedEmpty}>点击“生成 iframe 代码”，获取使用此实例实际访问地址的代码。</div>}
            {embedMessage && <p role="status" style={styles.muted}>{embedMessage}</p>}
            <details style={styles.detailFold}><summary style={styles.foldTitle}>使用须知</summary><ul style={styles.embedNotes}>
              <li>网站访问者需要能连接到实例地址。供其他电脑访问时，使用局域网可达的地址；127.0.0.1 只指访问者自己的电脑。</li>
              <li>嵌入沿用实例自身的登录设置，不会自动传递平台登录状态。跨站登录受浏览器 Cookie 限制时，可使用同站点反向代理或直接打开 DSH Web。</li>
              <li>HTTPS 网站需使用 HTTPS 实例入口，网站的 CSP 也需要允许该 iframe 来源。</li>
            </ul></details>
          </section>

          <section id="instance-panel-logs" role="tabpanel" aria-labelledby="instance-tab-logs" hidden={detailTab !== 'logs'} style={styles.detailBody}>
            <h3 style={styles.sectionTitle}>运行日志</h3><p style={styles.muted}>最近 200 行。点击右上角“刷新详情”获取最新日志。</p>
            {logsError ? <p role="alert" style={styles.error}>日志读取失败：{logsError}</p> : <pre role="log" aria-label="实例运行日志" aria-live="off" tabIndex={0} style={styles.logContent}>{logs || '暂无日志。'}</pre>}
          </section>
        </section>
      ) : null}

      <dialog ref={dialog} aria-labelledby="instance-action-title" style={styles.dialog}
        onCancel={event => { if (busy) event.preventDefault(); else setActionDialog(null) }}>
        <h2 id="instance-action-title">{actionDialog && labels[actionDialog]}智能体 DSH 容器实例</h2>
        {busy && <p role="status">{pending ? `正在执行：已处理 ${receipts.length} / ${pending.items.length} 项` : '正在读取操作预览…'}</p>}
        {error && <div role="alert" style={styles.error}>{error}</div>}
        {preview && pending ? <>
          <p>请确认目标及保留范围后执行。</p>
          <pre style={styles.pre}>{JSON.stringify(preview, null, 2)}</pre>
          <button type="button" onClick={execute} disabled={busy} style={styles.primary}>确认{labels[pending.operation]}</button>
        </> : null}
        {receipts.length ? <section aria-live="polite">
          <strong>操作回执：成功 {receipts.filter(item => item.ok).length} 项，失败或结果未知 {receipts.filter(item => !item.ok).length} 项</strong>
          {receipts.map(item => (
            <div key={`${item.operation}-${item.name}`} style={item.ok ? styles.receiptOk : styles.receiptBad}>
              {item.name} / {labels[item.operation]} / {item.ok ? '成功' : item.error?.message || '失败'}
            </div>
          ))}
        </section> : null}
        <button type="button" disabled={busy} onClick={() => { setActionDialog(null); setPreview(null); setPending(null) }} style={styles.button}>{pending ? '取消' : '关闭'}</button>
      </dialog>
    </main>
  )
}

function stateStyle(state = 'unknown') {
  return {
    ...styles.td,
    color: state === 'running'
      ? 'var(--dsw-alias-success-text, currentColor)'
      : state === 'failed' || state === 'unknown'
        ? 'var(--dsw-alias-danger-text, currentColor)'
        : 'var(--dsw-alias-text-secondary, currentColor)',
    fontWeight: 700,
  }
}

const border = '1px solid var(--dsw-alias-border, color-mix(in srgb, currentColor 18%, transparent))'

const styles: Record<string, CSSProperties> = {
  page: {
    height: '100%',
    minHeight: 0,
    overflow: 'auto',
    padding: '24px clamp(16px, 3vw, 36px)',
    color: 'var(--dsw-alias-text-primary, inherit)',
    background: 'var(--dsw-alias-background, transparent)',
    fontFamily: 'system-ui, sans-serif',
  },
  pageHeading: { alignItems: 'center', flexWrap: 'wrap', marginBottom: 20 },
  summaryStats: { marginTop: 8, fontSize: 13, color: 'var(--dsw-alias-text-secondary, #63748a)' },
  createPanel: { padding: 20, marginBottom: 16, border, borderRadius: 12, background: 'var(--dsw-alias-background, Canvas)' },
  createHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  createNote: { margin: '8px 0 16px', fontSize: 13, color: 'var(--dsw-alias-text-secondary, #63748a)' },
  createFields: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16 },
  field: { display: 'grid', gap: 8, minWidth: 0, fontSize: 13 },
  fieldInput: { minWidth: 0, width: '100%', minHeight: 38, padding: '8px 10px', border, borderRadius: 7, color: 'inherit', background: 'inherit' },
  createActions: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 },
  filterPanel: { padding: '16px 20px', marginBottom: 16, border, borderRadius: 12, background: 'var(--dsw-alias-background, Canvas)' },
  filterRow: { display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 },
  filterField: { display: 'grid', gap: 8, minWidth: 'min(100%, 160px)', fontSize: 13 },
  searchField: { display: 'grid', gap: 8, flex: 1, minWidth: 'min(100%, 220px)', fontSize: 13 },
  sourceFilter: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16, fontSize: 13, overflowWrap: 'anywhere' },
  batchBar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16, paddingTop: 16, borderTop: border },
  selectionNotice: { fontSize: 13, color: 'var(--dsw-alias-danger-text, #c24140)' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  button: { minHeight: 34, padding: '0 12px', border, background: 'transparent', color: 'inherit', borderRadius: 6 },
  primary: {
    minHeight: 34,
    padding: '0 14px',
    border,
    background: 'var(--dsw-alias-primary, CanvasText)',
    color: 'var(--dsw-alias-on-primary, Canvas)',
    borderRadius: 6,
  },
  listPanel: { minWidth: 0, border, borderRadius: 12, overflow: 'hidden', background: 'var(--dsw-alias-background, Canvas)' },
  listHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '16px 20px', borderBottom: border },
  tableWrap: { maxWidth: '100%', overflowX: 'auto' },
  table: { minWidth: 1040, width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  listTh: { textAlign: 'left', padding: '12px 16px', borderBottom: border, fontSize: 12, whiteSpace: 'nowrap', fontWeight: 500 },
  listTd: { padding: '16px', borderBottom: border, fontSize: 13, overflowWrap: 'anywhere', verticalAlign: 'middle' },
  emptyList: { textAlign: 'center', padding: '48px 20px', fontSize: 13, color: 'var(--dsw-alias-text-secondary, #63748a)' },
  th: { textAlign: 'left', padding: 8, borderBottom: border, fontSize: 13 },
  td: { padding: 8, borderBottom: border, fontSize: 13, overflowWrap: 'anywhere', verticalAlign: 'top' },
  error: { marginBottom: 12, padding: 10, border, color: 'var(--dsw-alias-danger-text, inherit)', borderRadius: 6 },
  panel: { marginTop: 20, border, borderRadius: 12, minWidth: 0, background: 'var(--dsw-alias-background, Canvas)' },
  dialog: { width: 640, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflow: 'auto', padding: 24, border, borderRadius: 12, color: '#223550', background: '#fff' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, padding: 20 },
  detailTitle: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 4 },
  stateBadge: { borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 600, background: 'color-mix(in srgb, currentColor 8%, transparent)' },
  detailNotice: { margin: '0 20px 12px', color: 'var(--dsw-alias-danger-text, inherit)' },
  detailTabs: { display: 'flex', gap: 24, padding: '0 20px', borderBottom: border, overflowX: 'auto' },
  detailTab: { border: 0, borderBottom: '2px solid transparent', borderRadius: 0, padding: '12px 0', background: 'transparent', color: 'inherit', whiteSpace: 'nowrap' },
  activeTab: { borderBottomColor: 'var(--dsw-alias-primary, #2563eb)', color: 'var(--dsw-alias-primary, #2563eb)', fontWeight: 600 },
  detailBody: { padding: 20, minWidth: 0 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 12, margin: 0 },
  fact: { padding: '12px 14px', border, borderRadius: 8, minWidth: 0 },
  factValue: { margin: '6px 0 0', fontSize: 14, overflowWrap: 'anywhere' },
  muted: { color: 'var(--dsw-alias-text-secondary, #63748a)', fontSize: 13, lineHeight: 1.65 },
  sessionNote: { marginTop: 20, fontSize: 13, lineHeight: 1.7, overflowWrap: 'anywhere' },
  detailFold: { borderTop: border, paddingTop: 14, marginTop: 18 },
  foldTitle: { cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  mountTable: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  runList: { listStyle: 'none', padding: 0, margin: '12px 0 0' },
  runItem: { display: 'grid', gap: 4, padding: '8px 0', overflowWrap: 'anywhere' },
  runLink: { border: 0, padding: 0, textAlign: 'left', color: 'var(--dsw-alias-primary, #2563eb)', background: 'transparent', overflowWrap: 'anywhere' },
  embedHeading: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: 12 },
  sectionTitle: { fontSize: 15, margin: 0 },
  codeBox: { border, borderRadius: 8, overflow: 'hidden', marginTop: 12 },
  codeHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderBottom: border, fontSize: 13 },
  embedCode: { margin: 0, padding: 16, maxHeight: 300, overflow: 'auto', fontSize: 12, lineHeight: 1.6 },
  embedEmpty: { padding: '32px 20px', marginTop: 12, border, borderRadius: 8, textAlign: 'center', fontSize: 13, color: 'var(--dsw-alias-text-secondary, #63748a)' },
  embedNotes: { paddingLeft: 20, fontSize: 13, lineHeight: 1.8 },
  logContent: { margin: 0, maxHeight: 420, minHeight: 160, overflow: 'auto', padding: 16, border, borderRadius: 8, fontSize: 12, lineHeight: 1.6 },
  pre: { maxHeight: 260, overflow: 'auto', padding: 10, border, borderRadius: 6, color: 'inherit', background: 'transparent' },
  receiptOk: { padding: 8, color: 'var(--dsw-alias-success-text, inherit)' },
  receiptBad: { padding: 8, color: 'var(--dsw-alias-danger-text, inherit)' },
}
