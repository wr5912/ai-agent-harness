import { useEffect, useMemo, useState } from 'react'
import { CHANNEL, type PlatformPageProps } from '../protocol.ts'

type State = {
  loading: boolean
  data?: any
  error?: string
  result?: any
  tools?: any[]
  toolResult?: any
  connectionId: string
  specUrl: string
  credentialPath: string
  connectionKind: 'openapi' | 'mcp-http'
  toolName: string
  toolArgs: string
  asset: string
  limit: number
}

export function McpPage({ rpc }: PlatformPageProps) {
  const [state, setState] = useState<State>({
    loading: true,
    connectionId: 'security-readonly-api',
    specUrl: '',
    credentialPath: '',
    connectionKind: 'openapi',
    toolName: '',
    toolArgs: '{}',
    asset: '',
    limit: 5,
  })
  const call = useMemo(() => async (endpoint: string, payload: any) => {
    const result = await rpc.call(CHANNEL, `mcp/${endpoint}`, payload)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }, [rpc])
  const refresh = async () => {
    setState(current => ({ ...current, loading: true, error: undefined }))
    try {
      const data = await call('list', {})
      setState(current => ({ ...current, loading: false, data }))
    }
    catch (error) { setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) })) }
  }
  useEffect(() => { void refresh() }, [])
  const register = async () => {
    setState(current => ({ ...current, loading: true, error: undefined }))
    try {
      await call(state.connectionKind === 'openapi' ? 'registerOpenApi' : 'registerMcp', {
        id: state.connectionId,
        ...(state.connectionKind === 'openapi' ? { specUrl: state.specUrl } : { endpointUrl: state.specUrl }),
        credentialRef: state.credentialPath.trim() ? { kind: 'file', path: state.credentialPath.trim() } : undefined,
      })
      await refresh()
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const deleteConnection = async () => {
    setState(current => ({ ...current, loading: true, error: undefined }))
    try {
      await call('deleteConnection', { connectionId: state.connectionId })
      await refresh()
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const refreshSpec = async () => {
    setState(current => ({ ...current, loading: true, error: undefined, tools: undefined }))
    try {
      const value = await call('refreshSpec', { connectionId: state.connectionId }) as { tools?: Array<{ name: string }> }
      setState(current => ({ ...current, loading: false, tools: value.tools, toolName: value.tools?.[0]?.name ?? current.toolName }))
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const runTool = async () => {
    setState(current => ({ ...current, loading: true, error: undefined, toolResult: undefined }))
    try {
      const value = await call('callTool', { connectionId: state.connectionId, toolName: state.toolName, arguments: JSON.parse(state.toolArgs) })
      setState(current => ({ ...current, loading: false, toolResult: value }))
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const run = async () => {
    setState(current => ({ ...current, loading: true, error: undefined, result: undefined }))
    try {
      const result = await call('executeComposition', { asset: state.asset, limit: state.limit })
      setState(current => ({ ...current, loading: false, result }))
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  const definition = state.data?.composition?.definition
  const statusText = (value: boolean | 'unknown') => value === 'unknown' ? '未知' : value ? '是' : '否'
  const selectConnection = (connection: any) => setState(current => ({
    ...current,
    connectionId: connection.id,
    connectionKind: connection.kind,
    specUrl: connection.kind === 'openapi' ? connection.specUrl : connection.endpointUrl,
    tools: undefined,
    toolName: '',
    toolResult: undefined,
  }))
  return <main style={{ height: '100%', overflow: 'auto', padding: '28px clamp(18px, 4vw, 44px)', boxSizing: 'border-box' }}>
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gap: 18 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>MCP 组合</h1>
          <p style={{ margin: 0, opacity: 0.68 }}>固定两步只读组合与 Gateway 发布视图：/api/harness-platform/mcp。</p>
        </div>
        <button type="button" onClick={() => { void refresh() }} disabled={state.loading}>刷新</button>
      </header>
      {state.error && <p role="alert" style={{ color: '#b42318' }}>{state.error}</p>}
      {definition && <section>
        <h2 style={{ fontSize: 18 }}>{definition.title}</h2>
        <code style={{ overflowWrap: 'anywhere' }}>digest: {state.data.composition.digest}</code>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 16 }}>
          {definition.steps.map((step: any) => <article key={step.id} style={{ border: '1px solid #d1d5db', borderRadius: 8, padding: 14 }}>
            <strong>{step.title}</strong>
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 6 }}>
              {step.operationId}{step.dependsOn?.length ? `，依赖：${step.dependsOn.join(', ')}` : '，第一步'}
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(step.input, null, 2)}</pre>
          </article>)}
        </div>
      </section>}
      <section>
        <h2 style={{ fontSize: 18 }}>OpenAPI / MCP 连接</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <select aria-label="连接类型" value={state.connectionKind} onChange={event => setState(current => ({ ...current, connectionKind: event.target.value as State['connectionKind'] }))}>
            <option value="openapi">OpenAPI</option>
            <option value="mcp-http">HTTP MCP</option>
          </select>
          <input aria-label="连接 ID" value={state.connectionId} onChange={event => setState(current => ({ ...current, connectionId: event.target.value }))} />
          <input aria-label="规范 URL" value={state.specUrl} onChange={event => setState(current => ({ ...current, specUrl: event.target.value }))} placeholder="https://.../openapi.json" />
          <input aria-label="凭据文件" value={state.credentialPath} onChange={event => setState(current => ({ ...current, credentialPath: event.target.value }))} placeholder="/path/to/credential-file" />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          <button type="button" onClick={() => { void register() }} disabled={state.loading || !state.connectionId.trim() || !state.specUrl.trim()}>注册</button>
          <button type="button" onClick={() => { void deleteConnection() }} disabled={state.loading || !state.connectionId.trim()}>删除登记</button>
          <button type="button" onClick={() => { void refreshSpec() }} disabled={state.loading || !state.connectionId.trim()}>刷新规范</button>
        </div>
        {!!state.data?.connections?.length && <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {state.data.connections.map((connection: any) => <button key={connection.id} type="button" onClick={() => selectConnection(connection)}
            style={{ textAlign: 'left', border: '1px solid #d1d5db', borderRadius: 8, padding: 10, background: connection.id === state.connectionId ? 'rgba(107, 114, 128, 0.14)' : 'transparent', color: 'inherit' }}>
            <strong>{connection.id}</strong>
            <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.7 }}>
              注册 {statusText(connection.status.registered)} / 规范 {statusText(connection.status.specLoaded)} / 调用 {statusText(connection.status.toolCallSucceeded)}
            </span>
          </button>)}
        </div>}
      </section>
      <section>
        <h2 style={{ fontSize: 18 }}>单工具试跑</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 10, alignItems: 'start' }}>
          <select aria-label="工具" value={state.toolName} onChange={event => setState(current => ({ ...current, toolName: event.target.value }))}>
            <option value="">选择工具</option>
            {(state.tools ?? []).map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}
          </select>
          <textarea aria-label="工具参数" value={state.toolArgs} onChange={event => setState(current => ({ ...current, toolArgs: event.target.value }))} rows={4} />
          <button type="button" onClick={() => { void runTool() }} disabled={state.loading || !state.toolName}>运行</button>
        </div>
        {state.toolResult && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', border: '1px solid #d1d5db', borderRadius: 8, padding: 14 }}>{JSON.stringify(state.toolResult, null, 2)}</pre>}
      </section>
      <section>
        <h2 style={{ fontSize: 18 }}>试跑</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <input aria-label="资产" value={state.asset} onChange={event => setState(current => ({ ...current, asset: event.target.value }))}
            placeholder="资产 ID、主机名或 IP" style={{ minWidth: 240 }} />
          <input aria-label="数量" type="number" min={1} max={20} value={state.limit} onChange={event => setState(current => ({ ...current, limit: Number(event.target.value) }))}
            style={{ width: 96 }} />
          <button type="button" onClick={() => { void run() }} disabled={state.loading || !state.asset.trim()}>运行</button>
        </div>
      </section>
      {state.result && <section>
        <h2 style={{ fontSize: 18 }}>结果</h2>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', border: '1px solid #d1d5db', borderRadius: 8, padding: 14 }}>{JSON.stringify(state.result, null, 2)}</pre>
      </section>}
    </div>
  </main>
}
