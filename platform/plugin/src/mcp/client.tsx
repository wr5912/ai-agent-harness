import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Manager } from 'harness-mcp-manager-client'
import { CHANNEL, type PlatformPageProps } from '../protocol.ts'
import type { CompositionConfig, CompositionEntry } from './compositions.ts'

const tabs = [
  { id: 'servers', title: '服务列表' },
  { id: 'groups', title: '工具与资源分组' },
  { id: 'connection', title: '工具与资源调试' },
  { id: 'composition', title: '工具组合编排' },
] as const

export function McpPage({ rpc, form }: PlatformPageProps & { form: ConfigForm<any> }) {
  const subscribe = useMemo(() => form.subscribe.bind(form), [form])
  const snapshot = useMemo(() => form.getSnapshot.bind(form), [form])
  const state = useSyncExternalStore(subscribe, snapshot)
  const [page, setPage] = useState<string>('servers')
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [publishedService, setPublishedService] = useState<any>(null)
  const [serviceError, setServiceError] = useState('')
  useEffect(() => {
    if (state.status !== 'ready') return
    let active = true
    void rpc.call(CHANNEL, 'mcp/list', {}).then(response => {
      if (!active) return
      if (response.ok) { setPublishedService((response.value as any).publishedService ?? null); setServiceError('') }
      else setServiceError(response.error.message)
    }).catch(() => { if (active) setServiceError('无法读取已发布组合服务，请刷新重试。') })
    return () => { active = false }
  }, [state.revision, state.status])
  return <main className="harness-mcp-page">
    <header className="harness-page-heading"><h1>MCP 管理</h1><div className="harness-mcp-actions" ref={setToolbarTarget} /></header>
    <nav className="harness-mcp-tabs" aria-label="MCP 工作区">{tabs.map(tab => <button key={tab.id} type="button" aria-current={page === tab.id ? 'page' : undefined} onClick={() => setPage(tab.id)}>{tab.title}</button>)}</nav>
    {state.status === 'unavailable' && <p role="alert">MCP 配置插件未装载，请检查平台启动日志。</p>}
    {serviceError && <p role="alert">{serviceError}</p>}
    <div hidden={page === 'composition'}><Manager view={page} onValidationError={() => setPage('servers')} publishedService={publishedService} toolbarTarget={page === 'composition' ? null : toolbarTarget} form={{ state }} write={async (ops, revision) => {
      const ok = await form.mutate(ops, revision)
      return ok ? { ok: true } : { ok: false, error: { message: '配置保存失败或已变化，请刷新后重试。' } }
    }} /></div>
    <div hidden={page !== 'composition'}>{page === 'composition' && <CompositionPage rpc={rpc} configuration={state} onCatalogChange={value => { setPublishedService(value.publishedService ?? null); setServiceError('') }} />}</div>
  </main>
}

function CompositionPage({ rpc, configuration, onCatalogChange }: PlatformPageProps & { configuration: unknown; onCatalogChange(value: any): void }) {
  const [data, setData] = useState<any>(null)
  const [selection, setSelection] = useState<{ id: string; version: 'draft' | 'published' } | null>(null)
  const [editor, setEditor] = useState<{ id?: string; revision: string; value: CompositionConfig } | null>(null)
  const [asset, setAsset] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedNode, setSelectedNode] = useState('getAsset')
  const requestId = useRef(0)
  const entries: CompositionEntry[] = data?.compositions ?? []
  const entry = entries.find(item => item.id === selection?.id)
  const config = selection && entry?.[selection.version]
  const connections = data?.connections?.filter((item: any) => item.kind === 'openapi') ?? []
  const upstream = config && [config.connectionId, ...(config.flow ? [config.alertsConnectionId] : [])].every(id => connections.some((item: any) => item.id === id))
  const graph = result?.graph ?? (selection && data?.compositions.find((item: any) => item.id === selection.id)?.graphs?.[selection.version])
  const nodes = graph?.nodes.filter((node: any) => node.operationId) ?? []
  const node = nodes.find((item: any) => item.id === selectedNode)
  const trace = result?.result?.trace?.find((item: any) => item.step === node?.step)

  function accept(value: any) {
    setData(value)
    onCatalogChange(value)
    setSelection(current => {
      if (current && value.compositions.some((item: CompositionEntry) => item.id === current.id && item[current.version])) return current
      const first = value.compositions[0]
      return first ? { id: first.id, version: first.draft ? 'draft' : 'published' } : null
    })
  }
  useEffect(() => {
    const id = ++requestId.current
    void rpc.call(CHANNEL, 'mcp/list', {}).then(response => {
      if (id !== requestId.current) return
      if (response.ok) accept(response.value)
      else setError(response.error.message)
    }).catch(() => { if (id === requestId.current) setError('无法读取编排目录。') })
    return () => { requestId.current++ }
  }, [configuration])

  function select(item: CompositionEntry, version: 'draft' | 'published') {
    setSelection({ id: item.id, version }); setResult(null); setError('')
  }
  async function action(endpoint: string, payload: any) {
    const id = ++requestId.current
    setBusy(true); setResult(null); setError('')
    try {
      const response = await rpc.call(CHANNEL, `mcp/${endpoint}`, payload)
      if (id !== requestId.current) return
      if (!response.ok) { setError(response.error.message); return }
      const value = response.value as any
      if (endpoint === 'list') accept(value)
      else if (endpoint === 'saveCompositionDraft') {
        const saved = editor?.id ? value.compositions.find((item: CompositionEntry) => item.id === editor.id) : value.compositions.at(-1)
        accept(value); setSelection({ id: saved.id, version: 'draft' }); setEditor(null)
      } else if (endpoint === 'publishComposition') {
        accept(value); setSelection({ id: payload.compositionId, version: 'published' }); setResult(value.dry)
      } else setResult(value)
    } catch { if (id === requestId.current) setError('操作失败，请检查连接并重试。') }
    finally { setBusy(false) }
  }
  const selectedPayload = { compositionId: entry?.id, version: selection?.version, revision: data?.revision, input: { asset, limit: 5 } }
  const groups = [
    { title: '全部编排', entries, version: undefined },
    { title: '正在编辑', entries: entries.filter(item => item.draft), version: 'draft' as const },
    { title: '已发布', entries: entries.filter(item => item.published), version: 'published' as const },
  ]
  return <div className="harness-composition-workspace">
    <nav className="harness-card harness-composition-sidebar" aria-label="工具编排列表">
      <h2>工具组合编排</h2><div className="harness-mcp-actions"><button type="button" disabled={busy || !!editor || !data} onClick={() => setEditor({ revision: data.revision, value: { toolName: '', title: '资产相关告警查询', description: '查询资产后查询相关告警的两步只读组合', connectionId: connections[0]?.id ?? '' } })}>新建编排</button>
        <button type="button" disabled={busy || !!editor} onClick={() => void action('list', {})}>刷新</button></div>
      {groups.map(group => <section key={group.title} aria-label={group.title}><h3>{group.title}（{group.entries.length}）</h3>
        {group.entries.length ? <ul>{group.entries.map(item => {
          const version = group.version ?? (item.draft ? 'draft' : 'published')
          const value = item[version]!
          return <li key={item.id}><button type="button" disabled={busy || !!editor} aria-current={selection?.id === item.id && selection.version === version ? 'true' : undefined} onClick={() => select(item, version)}>
            <span>{value.title}</span><small>{value.toolName} · {group.version ? (version === 'draft' ? '草稿' : '已发布') : [item.draft && '正在编辑', item.published && '已发布'].filter(Boolean).join(' / ')}</small>
          </button></li>
        })}</ul> : <p>暂无{group.title === '全部编排' ? '编排' : group.title === '正在编辑' ? '草稿' : '已发布工具'}</p>}
      </section>)}
    </nav>
    <section className="harness-card harness-composition-detail" aria-label="组合编排详情">
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">正在处理…</p>}
      {!config && !editor ? <p>{data ? '选择一个编排查看，或新建编排。' : '正在读取编排目录…'}</p> : <>
        <h2>{editor ? (editor.id ? '编辑草稿' : '新建编排') : config?.title}</h2>
        {editor ? <form onSubmit={event => { event.preventDefault(); void action('saveCompositionDraft', { compositionId: editor.id, revision: editor.revision, draft: editor.value }) }} className="harness-composition-editor">
          <p>复用当前 LangGraph 两步只读流程：查询资产 → 查询相关告警。保存草稿后进行 dry 测试和发布。</p>
          <label>编排标题<input required maxLength={80} value={editor.value.title} onChange={event => setEditor({ ...editor, value: { ...editor.value, title: event.target.value } })} /></label>
          <label>工具名称<input required maxLength={64} pattern="[A-Za-z0-9_.\-]+" value={editor.value.toolName} onChange={event => setEditor({ ...editor, value: { ...editor.value, toolName: event.target.value } })} /></label>
          <label>工具说明<textarea maxLength={500} value={editor.value.description} onChange={event => setEditor({ ...editor, value: { ...editor.value, description: event.target.value } })} /></label>
          <label>接口流程<select value={editor.value.flow ?? ''} onChange={event => setEditor({ ...editor, value: { ...editor.value, flow: event.target.value === 'soc-asset-alerts' ? 'soc-asset-alerts' : undefined, alertsConnectionId: event.target.value ? editor.value.alertsConnectionId ?? connections[0]?.id ?? '' : undefined } })}>
            <option value="">get_asset → list_alerts</option><option value="soc-asset-alerts">SOC 资产详情 → 近 30 天告警分组</option>
          </select></label>
          <label>{editor.value.flow ? '资产 OpenAPI 服务器' : 'OpenAPI 服务器'}<select required value={editor.value.connectionId} onChange={event => setEditor({ ...editor, value: { ...editor.value, connectionId: event.target.value } })}>
            <option value="">请选择服务器</option>{editor.value.connectionId && !connections.some((item: any) => item.id === editor.value.connectionId) && <option value={editor.value.connectionId}>{editor.value.connectionId}（尚未接入）</option>}
            {connections.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}（{item.id}）</option>)}
          </select></label>
          {editor.value.flow && <label>告警 OpenAPI 服务器<select required value={editor.value.alertsConnectionId ?? ''} onChange={event => setEditor({ ...editor, value: { ...editor.value, alertsConnectionId: event.target.value } })}>
            <option value="">请选择服务器</option>{editor.value.alertsConnectionId && !connections.some((item: any) => item.id === editor.value.alertsConnectionId) && <option value={editor.value.alertsConnectionId}>{editor.value.alertsConnectionId}（尚未接入）</option>}
            {connections.map((item: any) => <option key={item.id} value={item.id}>{item.name || item.id}（{item.id}）</option>)}
          </select></label>}
          <div className="harness-mcp-actions"><button disabled={busy} type="submit">保存草稿</button><button disabled={busy} type="button" onClick={() => { setEditor(null); setError('') }}>取消编辑</button></div>
          <p>草稿保存到仓库编排目录；已发布版本继续供 MCP 调用。</p>
        </form> : <>
          <div className="harness-mcp-actions" aria-label="编排版本">{(['draft', 'published'] as const).filter(version => entry?.[version]).map(version => <button key={version} disabled={busy} aria-pressed={selection?.version === version} onClick={() => select(entry!, version)}>{version === 'draft' ? '编辑草稿' : '已发布版本'}</button>)}</div>
          <p>{selection?.version === 'draft' ? '草稿尚未发布' : '当前版本已发布'} · {upstream ? '上游已配置，等待实际调用验证' : '请先接入所需的 OpenAPI 服务器'}</p>
          <p>{config?.description}</p><p>工具：<code>{config?.toolName}</code> · 上游：<code>{config?.connectionId}</code>{config?.flow && <> → <code>{config.alertsConnectionId}</code></>}</p>
          {selection?.version === 'published' && entry?.published?.publishedAt && <p>发布时间：{entry.published.publishedAt}</p>}
          <button type="button" disabled={busy} onClick={() => { setEditor({ id: entry!.id, revision: data.revision, value: { ...(entry!.draft ?? config!) } }); setResult(null); setError('') }}>{entry?.draft ? '继续编辑草稿' : '编辑为草稿'}</button>
        </>}
        {!editor && <div className="harness-composition-layout"><div>
          <div className="harness-mcp-flow">{nodes.map((step: any, index: number) => <article key={step.id}><small>步骤 {index + 1}</small><h3><button type="button" aria-pressed={step.id === selectedNode} onClick={() => setSelectedNode(step.id)}>{step.title}</button></h3><code>{step.operationId}</code></article>)}</div>
          <ul aria-label="编排路径">{(graph?.edges ?? []).map((edge: any) => <li key={`${edge.source}-${edge.target}`}>{edge.source === '__start__' ? '开始' : nodes.find((item: any) => item.id === edge.source)?.title} → {edge.target === '__end__' ? '结束' : nodes.find((item: any) => item.id === edge.target)?.title}{edge.conditional ? '（按前置结果）' : ''}</li>)}</ul>
        </div><aside className="harness-card" aria-label="编排节点详情">{node && <><h3>{node.title}</h3><p>工具：<code>{node.operationId}</code></p><p>状态：{result?.mode === 'dry' ? 'dry 未执行节点' : trace?.status ?? '尚未执行'}</p>
          <h4>输入映射</h4><dl className="harness-fields">{Object.entries(node.input).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
          {trace?.mappedArguments && <pre className="harness-asset-content">{JSON.stringify(trace.mappedArguments, null, 2)}</pre>}
          <h4>输出：{node.output}</h4><pre className="harness-asset-content">{result?.result ? JSON.stringify(result.result[node.output], null, 2) : '尚无执行结果'}</pre>{trace?.reason && <p>{trace.reason}</p>}
        </>}</aside></div>}
        {!editor && <><p>第一步失败或缺少资产 ID 时，第二步停止执行。</p>
          <label>查询资产<input aria-label="组合查询资产" value={asset} onChange={event => { setAsset(event.target.value); setResult(null) }} placeholder={config?.flow ? '资产 ID，如 9106' : '资产 ID、主机名或 IP'} /></label>
          <div className="harness-mcp-actions"><button type="button" disabled={busy || !asset.trim()} onClick={() => void action('dryRunComposition', selectedPayload)}>测试（dry）</button>
            {selection?.version === 'draft' && <button type="button" disabled={busy || !asset.trim()} onClick={() => void action('publishComposition', selectedPayload)}>发布工具</button>}
            <button type="button" disabled={busy || !asset.trim() || !upstream} onClick={() => void action('executeComposition', selectedPayload)}>实际执行组合工具</button></div>
          <p>测试及发布前校验均使用 dry，不请求上游。实际执行会调用两个只读工具。</p>
          {result?.mode === 'dry' && <div role="status"><p>dry 校验通过 · 上游请求 {result.upstreamRequests} 次</p><p>{result.checks.join('、')}。未验证：{result.unverified.join('、')}。</p></div>}
          {result && result.mode !== 'dry' && <div><p role="status">{result.ok ? '组合执行成功' : '组合执行失败'}</p>{result.error && <p role="alert">{result.error.message}</p>}
            {result.result?.alertSummary && <p>近 30 天：{result.result.alertSummary.totalGroups} 个告警分组 · {result.result.alertSummary.totalAlerts} 条告警 · 当前展示 {result.result.alerts.length} 个分组。{result.result.alertSummary.truncated && '上游结果已截断。'}<br/>查询范围：{result.result.alertSummary.from} ～ {result.result.alertSummary.to}</p>}
            <div className="harness-table-scroll"><table><thead><tr><th>步骤</th><th>状态</th><th>HTTP</th><th>耗时</th></tr></thead><tbody>{(result.result?.trace ?? []).map((step: any) => <tr key={step.step}><td>{step.operationId}</td><td>{step.status}</td><td>{step.httpStatus ?? '未调用'}</td><td>{step.durationMs === undefined ? '—' : `${step.durationMs} ms`}</td></tr>)}</tbody></table></div>
            <details><summary>业务结果</summary><pre>{JSON.stringify({ asset: result.result?.asset, alerts: result.result?.alerts, alertSummary: result.result?.alertSummary }, null, 2)}</pre></details><details><summary>执行回执与来源版本</summary><pre>{JSON.stringify({ receipts: result.receipts, version: result.version }, null, 2)}</pre></details></div>}
          <hr/><h3>调用与发布信息</h3><p>MCP 入口：<code>{new URL('api/harness-platform/mcp', document.baseURI).href}</code></p><p>入口受平台登录认证保护，仅列出并执行已发布版本。发布后调用方需重新发现工具；草稿供页面查看与测试。</p>
          <p>在管理对话中可使用 <code>mcp-composition</code> Skill 修改 TypeScript 流程，构建并重启后图会同步更新。</p>
        </>}
      </>}
    </section>
  </div>
}
