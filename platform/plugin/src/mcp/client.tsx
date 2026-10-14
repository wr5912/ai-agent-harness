import { useMemo, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Manager } from 'harness-mcp-manager-client'
import { CHANNEL, type PlatformPageProps } from '../protocol.ts'
import { COMPOSITION_TOOL_NAME, compositionDefinition } from './definition.ts'

const tabs = [
  { id: 'servers', title: '服务器接入', hint: '接入 OpenAPI 或现成 MCP，配置认证并验证连接。' },
  { id: 'groups', title: '工具分组与发布', hint: '选择向外开放的工具，保存分组后复制 MCP 入口。' },
  { id: 'connection', title: '工具与资源调试', hint: '发现工具、读取资源、预览参数并执行真实调用。' },
  { id: 'composition', title: '组合工具', hint: '查看步骤与参数映射，测试组合工具并检查执行回执。' },
] as const

export function McpPage({ rpc, form }: PlatformPageProps & { form: ConfigForm<any> }) {
  const subscribe = useMemo(() => form.subscribe.bind(form), [form])
  const snapshot = useMemo(() => form.getSnapshot.bind(form), [form])
  const state = useSyncExternalStore(subscribe, snapshot)
  const [page, setPage] = useState<string>('servers')
  const [asset, setAsset] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const servers = state.status === 'ready' ? state.value.servers ?? [] : []
  const groups = state.status === 'ready' ? state.value.groups ?? [] : []
  const upstream = servers.find((item: any) => item.id === compositionDefinition.upstream.connectionId && item.enabled && item.specUrl)
  async function execute() {
    setBusy(true); setResult(null); setError('')
    try {
      const response = await rpc.call(CHANNEL, 'mcp/executeComposition', { asset, limit: 5 })
      if (response.ok) setResult(response.value)
      else setError(response.error.message)
    } catch { setError('组合查询失败，请检查连接。') }
    finally { setBusy(false) }
  }
  return <main className="harness-mcp-page" style={{ padding: '24px clamp(16px, 3vw, 36px)', maxWidth: 1260, margin: 'auto' }}>
    <style>{`.harness-mcp-page .mcp-manager .mcp-tabs{display:none}.harness-mcp-page .mcp-manager{--mcp-blue:#006eff;--mcp-tint:#f6f9fe}.harness-mcp-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.harness-mcp-tabs [aria-selected=true]{background:#006eff;color:white;border-color:#006eff}.harness-mcp-flow{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.harness-mcp-flow article{flex:1;min-width:min(240px,100%);padding:18px;border:1px solid #dce6f3;border-radius:12px;background:#f6f9fe}.harness-mcp-flow small{color:#6b7890}.harness-mcp-flow code{overflow-wrap:anywhere}`}</style>
    <header className="harness-page-heading"><div><h1>MCP 管理</h1><p>从接口接入、工具调试到组合与发布，在同一工作空间完成。</p></div></header>
    <div className="harness-metrics" style={{ marginTop: 20 }}>
      {[['服务器', servers.length], ['已启用', servers.filter((item: any) => item.enabled).length], ['工具分组', groups.length], ['组合工具', 1]].map(([label, count]) => <article className="harness-card" key={label}><span>{label}</span><strong>{count}</strong></article>)}
    </div>
    <nav className="harness-mcp-tabs" aria-label="MCP 工作区">{tabs.map(tab => <button key={tab.id} type="button" aria-selected={page === tab.id} onClick={() => setPage(tab.id)}>{tab.title}</button>)}</nav>
    <p>{tabs.find(tab => tab.id === page)?.hint}</p>
    {state.status === 'unavailable' && <p role="alert">MCP 配置插件未装载，请检查平台启动日志。</p>}
    <div hidden={page === 'composition'}><Manager view={page} form={{ state }} write={async (ops, revision) => {
      const ok = await form.mutate(ops, revision)
      return ok ? { ok: true } : { ok: false, error: { message: '配置保存失败或已变化，请刷新后重试。' } }
    }} /></div>
    {page === 'composition' && <section className="harness-card">
      <h2>{compositionDefinition.title}</h2><p>已装载的两步只读组合 · {upstream ? '上游已配置，等待实际调用验证' : '请先接入所需的 OpenAPI 服务器'}</p>
      <div className="harness-mcp-flow">{compositionDefinition.steps.map((step, index) => <article key={step.id}><small>步骤 {index + 1}</small><h3>{step.title}</h3><code>{step.operationId}</code><p>{Object.entries(step.input).map(([key, value]) => `${key} ← ${value}`).join('；')}</p></article>)}</div>
      <p>上游服务器：<code>{compositionDefinition.upstream.connectionId}</code>。第一步失败或缺少资产 ID 时，第二步停止执行。</p>
      <label>查询资产<input aria-label="组合查询资产" value={asset} onChange={event => setAsset(event.target.value)} placeholder="资产 ID、主机名或 IP" /></label>
      <button type="button" style={{ marginLeft: 10 }} disabled={busy || !asset.trim() || !upstream} onClick={execute}>{busy ? '测试中…' : '测试组合工具'}</button>
      {error && <p role="alert">{error}</p>}
      {result && <div><p role="status">{result.ok ? '组合执行成功' : '组合执行失败'}</p>{result.error && <p role="alert">{result.error.message}</p>}
        <div className="harness-table-scroll"><table><thead><tr><th>步骤</th><th>状态</th><th>HTTP</th><th>耗时</th></tr></thead><tbody>{(result.result?.trace ?? []).map((step: any) => <tr key={step.step}><td>{step.operationId}</td><td>{step.status}</td><td>{step.httpStatus ?? '未调用'}</td><td>{step.durationMs === undefined ? '—' : `${step.durationMs} ms`}</td></tr>)}</tbody></table></div>
        <details><summary>业务结果</summary><pre>{JSON.stringify({ asset: result.result?.asset, alerts: result.result?.alerts }, null, 2)}</pre></details>
        <details><summary>执行回执与来源版本</summary><pre>{JSON.stringify({ receipts: result.receipts, version: result.version }, null, 2)}</pre></details></div>}
      <hr/><h3>调用与发布信息</h3><p>工具：<code>{COMPOSITION_TOOL_NAME}</code></p><p>MCP 入口：<code>{window.location.origin}/api/harness-platform/mcp</code></p>
      <p>此组合随当前平台代码装载，入口受平台登录认证保护。工具分组页提供使用专用 Token 的独立分组入口。</p>
    </section>}
  </main>
}
