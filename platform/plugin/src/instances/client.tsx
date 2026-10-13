import { useEffect, useMemo, useState } from 'react'
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
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<unknown>(null)
  const [pending, setPending] = useState<{ operation: Operation, items: ActionRequest[] } | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [form, setForm] = useState({ name: '', source: '', port: '' })
  const [detail, setDetail] = useState<Detail | null>(null)
  const [logs, setLogs] = useState('')

  const visible = useMemo(() => instances.filter(item => filter === 'all' || item.state === filter), [instances, filter])

  async function call<T>(endpoint: string, payload: unknown): Promise<T> {
    const result = await rpc.call(CHANNEL, `instances/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      const data = await call<{ instances: InstanceRow[] }>('list', {})
      setInstances(data.instances)
      setSelected(current => new Set([...current].filter(name => data.instances.some(item => item.name === name))))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

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
    try {
      const data = pending.items.length === 1
        ? await call<Receipt>('run', pending.items[0])
        : await call<{ receipts: Receipt[] }>('batch', { items: pending.items })
      setReceipts('receipts' in data ? data.receipts : [data])
      setPreview(null)
      setPending(null)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function openDetail(name: string) {
    setBusy(true)
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
      setBusy(false)
    }
  }

  const selectedNames = [...selected]

  return (
    <main style={styles.page}>
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
            <option value="all">全部状态</option>
            <option value="running">running</option>
            <option value="stopped">stopped</option>
            <option value="failed">failed</option>
            <option value="unknown">unknown</option>
          </select>
          <button type="button" onClick={refresh} disabled={busy} style={styles.button}>刷新</button>
          {(['start', 'stop', 'restart', 'delete'] as Operation[]).map(operation => (
            <button key={operation} type="button" disabled={busy || selectedNames.length === 0}
              onClick={() => prepare(operation, selectedNames)} style={styles.button}>
              {labels[operation]}
            </button>
          ))}
        </div>
      </section>

      {error ? <div role="alert" style={styles.error}>{error}</div> : null}

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}></th>
              <th style={styles.th}>实例</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>来源</th>
              <th style={styles.th}>镜像</th>
              <th style={styles.th}>Agent</th>
              <th style={styles.th}>端口</th>
              <th style={styles.th}>HOME</th>
              <th style={styles.th}>容器</th>
              <th style={styles.th}>观察时间</th>
              <th style={styles.th}>详情</th>
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
                <td style={stateStyle(item.state)}>{item.state || 'unknown'}</td>
                <td style={styles.td}>{item.source_id || '-'}</td>
                <td style={styles.td}>{item.image_tag || '-'}</td>
                <td style={styles.td}>{item.agent_id || '-'}</td>
                <td style={styles.td}>{item.port || '-'}</td>
                <td style={styles.td}>{item.home_volume || '-'} {item.home_preserved === false ? '(缺失)' : ''}</td>
                <td style={styles.td}>{item.container_name || '-'}</td>
                <td style={styles.td}>{item.observed_at || '-'}</td>
                <td style={styles.td}><button type="button" onClick={() => openDetail(item.name)} style={styles.button}>详情</button></td>
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

      {preview && pending ? (
        <section style={styles.panel}>
          <strong>{labels[pending.operation]}确认</strong>
          <pre style={styles.pre}>{JSON.stringify(preview, null, 2)}</pre>
          <button type="button" onClick={execute} disabled={busy} style={styles.primary}>执行</button>
          <button type="button" onClick={() => { setPreview(null); setPending(null) }} style={styles.button}>取消</button>
        </section>
      ) : null}

      {receipts.length ? (
        <section style={styles.panel}>
          <strong>逐项回执</strong>
          {receipts.map(item => (
            <div key={`${item.operation}-${item.name}`} style={item.ok ? styles.receiptOk : styles.receiptBad}>
              {item.name} / {labels[item.operation]} / {item.ok ? '成功' : item.error?.message || '失败'}
            </div>
          ))}
        </section>
      ) : null}
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
  table: { minWidth: 1120, width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' },
  th: { textAlign: 'left', padding: 8, borderBottom: border, fontSize: 13 },
  td: { padding: 8, borderBottom: border, fontSize: 13, overflowWrap: 'anywhere', verticalAlign: 'top' },
  error: { marginBottom: 12, padding: 10, border, color: 'var(--dsw-alias-danger-text, inherit)', borderRadius: 6 },
  panel: { marginTop: 16, padding: 12, border, borderRadius: 6 },
  detailGrid: { display: 'grid', gap: 8, marginTop: 10 },
  pre: { maxHeight: 260, overflow: 'auto', padding: 10, border, borderRadius: 6, color: 'inherit', background: 'transparent' },
  receiptOk: { padding: 8, color: 'var(--dsw-alias-success-text, inherit)' },
  receiptBad: { padding: 8, color: 'var(--dsw-alias-danger-text, inherit)' },
}
