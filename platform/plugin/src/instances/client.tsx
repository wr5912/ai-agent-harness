import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { CHANNEL } from '../protocol.ts'
import type { PlatformPageProps } from '../protocol.ts'

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

export function InstancesPage({ rpc }: PlatformPageProps) {
  const [instances, setInstances] = useState<InstanceRow[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('existing')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [opening, setOpening] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<unknown>(null)
  const [pending, setPending] = useState<{ operation: Operation, items: ActionRequest[] } | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [actionDialog, setActionDialog] = useState<Operation | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [form, setForm] = useState({ name: '', source: '', port: '' })
  const [detail, setDetail] = useState<Detail | null>(null)
  const [logs, setLogs] = useState('')

  const visible = useMemo(() => instances.filter(item => (filter === 'all' || (filter === 'existing' ? item.state !== 'absent' : item.state === filter)) && `${item.name} ${item.source_id ?? ''}`.toLowerCase().includes(query.toLowerCase())), [instances, filter, query])
  const visibleSelected = visible.filter(item => selected.has(item.name)).length

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await rpc.call(CHANNEL, `instances/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const data = await call<{ instances: InstanceRow[] }>('list', {})
      setInstances(data.instances)
      setSelected(current => new Set([...current].filter(name => data.instances.some(item => item.name === name))))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])
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
      setPending({ operation, items })
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

  async function openDetail(name: string) {
    setDetailLoading(true)
    setError('')
    try {
      const [nextDetail, nextLogs] = await Promise.all([
        call<Detail>('detail', { name }),
        call<{ logs: string }>('logs', { name, tail: 200 }),
      ])
      setDetail(nextDetail)
      setLogs(nextLogs.logs)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDetailLoading(false)
    }
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
      const result = await call<{ url: string, lan_access: boolean }>('url', { name })
      const url = new URL(result.url)
      if (result.lan_access) url.hostname = window.location.hostname
      if (!tab.closed) tab.location.replace(url.href)
    } catch (err) {
      tab.close()
      setError((err as Error).message)
    } finally {
      setOpening(current => { const next = new Set(current); next.delete(name); return next })
    }
  }

  const selectedNames = [...selected]
  const containerCount = instances.filter(item => ['running', 'stopped', 'failed'].includes(item.state ?? '')).length
  const absentCount = instances.filter(item => item.state === 'absent').length
  const unknownCount = instances.length - containerCount - absentCount

  return (
    <main style={styles.page}>
      <header className="harness-page-heading"><div><h1>智能体 DSH 容器实例</h1><p>管理智能体的 DSH 容器启停；删除容器及管理登记，保留 HOME 卷与研究记录。</p></div><span>{containerCount} 个容器实例 · {absentCount} 个无容器登记{unknownCount > 0 && ` · ${unknownCount} 个状态未知`}</span></header>
      <section style={styles.toolbar}>
        <div style={styles.form}>
          <input aria-label="实例名" placeholder="实例名" value={form.name}
            onChange={event => updateForm({ ...form, name: event.target.value })} style={styles.input} />
          <input aria-label="来源" placeholder="experiment:EXP-..." value={form.source}
            onChange={event => updateForm({ ...form, source: event.target.value })} style={styles.inputWide} />
          <input aria-label="端口" placeholder="端口" value={form.port}
            onChange={event => updateForm({ ...form, port: event.target.value })} style={styles.port} />
          <button type="button" disabled={busy || !form.name || !form.source}
            onClick={() => prepare('create', [])} style={styles.primary}>创建预览</button>
        </div>
        <div style={styles.actions}>
          <select aria-label="状态筛选" value={filter} onChange={event => setFilter(event.target.value)} style={styles.input}>
            <option value="existing">现有容器</option>
            <option value="all">全部登记</option>
            <option value="running">running</option>
            <option value="stopped">stopped</option>
            <option value="absent">无容器（仅登记）</option>
            <option value="failed">failed</option>
            <option value="unknown">unknown</option>
          </select>
          <input aria-label="搜索实例" placeholder="搜索实例或来源" value={query} onChange={event => setQuery(event.target.value)} style={styles.inputWide} />
          <button type="button" onClick={refresh} disabled={loading} style={styles.button}>{loading ? '读取中…' : '刷新'}</button>
          <span>已选择 {selected.size} 个；勾选后可批量操作</span>
          {(['start', 'stop', 'restart', 'delete'] as Operation[]).map(operation => (
            <button key={operation} type="button" disabled={busy || selectedNames.length === 0}
              onClick={() => prepare(operation, selectedNames)} style={styles.button}>
              {labels[operation]}
            </button>
          ))}
        </div>
      </section>

      {error && !actionDialog ? <div role="alert" style={styles.error}>{error}</div> : null}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>
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
              <th style={styles.th}>实例</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>来源</th>

              <th style={styles.th}>端口</th>
              <th style={styles.th}>访问入口</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(item => (
              <tr key={item.name}>
                <td style={styles.td}>
                  <input type="checkbox" aria-label={`选择实例 ${item.name}`} checked={selected.has(item.name)}
                    onChange={event => setSelected(current => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(item.name)
                      else next.delete(item.name)
                      return next
                    })} />
                </td>
                <td style={styles.td}>{item.name}</td>
                <td style={stateStyle(item.state)}>{item.state === 'absent' ? '无容器（仅登记）' : item.state || 'unknown'}</td>
                <td style={styles.td}>{item.source_id || '-'}</td>

                <td style={styles.td}>{item.port || '-'}</td>
                <td style={styles.td}>
                  <button type="button" disabled={item.state !== 'running' || !item.port || opening.has(item.name)}
                    onClick={() => openWeb(item.name)} style={styles.button}
                    title={item.state !== 'running' ? '实例运行后可访问' : item.lan_access ? '在新标签页打开' : '仅宿主机浏览器可访问'}>
                    {opening.has(item.name) ? '正在打开…' : '访问 DSH Web'}
                  </button>
                  <div>{item.state !== 'running' ? '实例运行后可访问' : !item.port ? '未记录端口' : !item.lan_access ? '仅宿主机' : null}</div>
                </td>
                <td style={styles.td}><div style={styles.actions}>
                  <button type="button" onClick={() => openDetail(item.name)} disabled={detailLoading} style={styles.button}>详情</button>
                  {(item.state === 'running' ? ['stop', 'restart'] : item.state === 'stopped' || item.state === 'absent' ? ['start', 'delete'] : item.state === 'failed' ? ['start', 'stop'] : []).map(operation =>
                    <button type="button" key={operation} disabled={busy} onClick={() => prepare(operation as Operation, [item.name])} style={styles.button}>{labels[operation as Operation]}</button>)}
                  {item.state === 'unknown' && <span>观察失败，请刷新</span>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail ? (
        <section style={styles.panel}>
          <strong>{detail.instance.name} 详情</strong>
          <div style={styles.detailGrid}>
            <div>HOME：{String(detail.session_scope.home_volume || '-')} / {String(detail.session_scope.preserved)}</div>
            <div>Session：{detail.session_scope.note}</div>
            <div>历史 Run：{detail.runs.map(run => run.id).join('、') || '-'}</div>
            <div>只读模式：{JSON.stringify(detail.instance.mount_modes || {})}</div>
          </div>
          <pre style={styles.pre}>{JSON.stringify({ mounts: detail.instance.mounts || {}, runs: detail.runs }, null, 2)}</pre>
          <pre style={styles.pre}>{logs || '暂无日志'}</pre>
          {(detail.instance.state === 'failed' || detail.instance.state === 'unknown')
            ? <div style={styles.error}>状态异常时保留登记，查看日志后再停止或删除。</div>
            : null}
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
    padding: 24,
    color: 'var(--dsw-alias-text-primary, inherit)',
    background: 'var(--dsw-alias-background, transparent)',
    fontFamily: 'system-ui, sans-serif',
  },
  toolbar: { display: 'grid', gap: 12, marginBottom: 16 },
  form: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  input: { minHeight: 34, padding: '0 10px', border, borderRadius: 6, color: 'inherit', background: 'inherit' },
  inputWide: { minHeight: 34, minWidth: 280, padding: '0 10px', border, borderRadius: 6, color: 'inherit', background: 'inherit' },
  port: { minHeight: 34, width: 90, padding: '0 10px', border, borderRadius: 6, color: 'inherit', background: 'inherit' },
  button: { minHeight: 34, padding: '0 12px', border, background: 'transparent', color: 'inherit', borderRadius: 6 },
  primary: {
    minHeight: 34,
    padding: '0 14px',
    border,
    background: 'var(--dsw-alias-primary, CanvasText)',
    color: 'var(--dsw-alias-on-primary, Canvas)',
    borderRadius: 6,
  },
  tableWrap: { maxWidth: '100%', overflowX: 'auto', border },
  table: { minWidth: 760, width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  th: { textAlign: 'left', padding: 8, borderBottom: border, fontSize: 13 },
  td: { padding: 8, borderBottom: border, fontSize: 13, overflowWrap: 'anywhere', verticalAlign: 'top' },
  error: { marginBottom: 12, padding: 10, border, color: 'var(--dsw-alias-danger-text, inherit)', borderRadius: 6 },
  panel: { marginTop: 16, padding: 12, border, borderRadius: 6 },
  dialog: { width: 640, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflow: 'auto', padding: 24, border, borderRadius: 12, color: '#223550', background: '#fff' },
  detailGrid: { display: 'grid', gap: 8, marginTop: 10 },
  pre: { maxHeight: 260, overflow: 'auto', padding: 10, border, borderRadius: 6, color: 'inherit', background: 'transparent' },
  receiptOk: { padding: 8, color: 'var(--dsw-alias-success-text, inherit)' },
  receiptBad: { padding: 8, color: 'var(--dsw-alias-danger-text, inherit)' },
}
