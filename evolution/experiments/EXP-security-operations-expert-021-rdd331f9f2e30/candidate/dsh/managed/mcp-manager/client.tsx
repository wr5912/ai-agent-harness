window.__ModuleLoader__.load({
  id: 'dsh-web-mcp-manager',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef, useState } = React
    const formName = 'mcp-session-manager'
    const defaultSpec = 'http://172.16.138.232:18087/v3/api-docs/mcp'
    const emptyServer = () => ({ id: '', description: '', specUrl: '', authType: 'credential',
      apiKey: '', authHeader: 'Authorization', loginUrl: '', loginUsername: '', loginPassword: '', loginTokenPath: 'data.token',
      enabled: true, tools: { mode: 'all', names: [] } })
    const commonHeaders = ['Authorization', 'X-API-Key', 'Api-Key', 'X-Auth-Token']
    const emptyGroup = () => ({ id: '', members: [] })
    const input = (value, change, props = {}) => <input value={value ?? ''} onChange={event => change(event.target.value)} {...props} />
    const button = (label, action, disabled = false) => <button type="button" onClick={action} disabled={disabled}>{label}</button>
    const styles = `
      .mcp-manager{--mcp-ink:#202838;--mcp-muted:#667287;--mcp-line:#e4e9f1;--mcp-tint:#f6f8fc;--mcp-blue:#4669e8;width:min(100%,1120px);margin:18px auto 44px;color:var(--mcp-ink);font-size:14px}
      .mcp-manager *{box-sizing:border-box}
      .mcp-manager button,.mcp-manager input,.mcp-manager select{font:inherit}
      .mcp-manager button{cursor:pointer}
      .mcp-manager button:disabled{cursor:not-allowed;opacity:.5}
      .mcp-manager .mcp-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:16px;padding:16px 20px;background:#eef3ff;border:1px solid #dce6ff;border-radius:14px}
      .mcp-manager .mcp-toolbar strong{display:block;font-size:14px}.mcp-manager .mcp-toolbar p{margin:4px 0 0;color:var(--mcp-muted);line-height:1.5}
      .mcp-manager .mcp-primary{border:1px solid var(--mcp-blue);border-radius:9px;background:var(--mcp-blue);color:white;padding:9px 16px;font-weight:600;white-space:nowrap}
      .mcp-manager .mcp-primary:hover:not(:disabled){background:#3658d5}
      .mcp-manager .mcp-shell{border:1px solid var(--mcp-line);border-radius:16px;background:white;box-shadow:0 12px 32px rgba(24,38,73,.045);overflow:hidden}
      .mcp-manager .mcp-tabs{display:flex;gap:6px;padding:12px 18px 0;border-bottom:1px solid var(--mcp-line);overflow-x:auto}
      .mcp-manager .mcp-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--mcp-muted);padding:10px 16px 12px;white-space:nowrap;font-weight:600}
      .mcp-manager .mcp-tabs button[aria-current=page]{border-color:var(--mcp-blue);color:var(--mcp-blue)}
      .mcp-manager .mcp-tabs small{margin-left:6px;padding:2px 6px;border-radius:6px;background:var(--mcp-tint);color:inherit;font-size:11px}
      .mcp-manager .mcp-content{padding:24px;background:var(--mcp-tint);min-height:460px}
      .mcp-manager .mcp-heading{display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:18px}
      .mcp-manager h2,.mcp-manager h3{margin:0;color:var(--mcp-ink);line-height:1.3}.mcp-manager h2{font-size:20px}.mcp-manager h3{font-size:16px}
      .mcp-manager .mcp-muted{color:var(--mcp-muted);line-height:1.5}.mcp-manager .mcp-heading p{margin:5px 0 0}
      .mcp-manager .mcp-layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:18px;align-items:start}
      .mcp-manager .mcp-card{min-width:0;border:1px solid var(--mcp-line);border-radius:13px;background:white;padding:20px}
      .mcp-manager .mcp-sidebar{padding:8px}.mcp-manager .mcp-list-item{display:block;width:100%;margin:0 0 4px;padding:12px;border:1px solid transparent;border-radius:9px;background:transparent;text-align:left;color:var(--mcp-ink)}
      .mcp-manager .mcp-list-item:hover{background:var(--mcp-tint)}.mcp-manager .mcp-list-item[aria-current=true]{background:#eef3ff;border-color:#dce6ff}
      .mcp-manager .mcp-list-item strong{display:block;overflow-wrap:anywhere}.mcp-manager .mcp-list-item small{display:block;margin-top:3px;color:var(--mcp-muted);font-size:12px}
      .mcp-manager .mcp-add{width:100%;margin-top:6px;border:1px dashed #b9c8ea;border-radius:9px;background:#fff;color:var(--mcp-blue);padding:10px;font-weight:600}
      .mcp-manager .mcp-card-head{display:flex;align-items:start;justify-content:space-between;gap:12px;padding-bottom:18px;border-bottom:1px solid var(--mcp-line)}
      .mcp-manager .mcp-card-head p{margin:5px 0 0}.mcp-manager .mcp-card-head .mcp-switch{flex:none;margin:0}
      .mcp-manager .mcp-section{padding-top:20px}.mcp-manager .mcp-section+.mcp-section{margin-top:20px;border-top:1px solid var(--mcp-line)}
      .mcp-manager .mcp-section h3{margin-bottom:12px}.mcp-manager .mcp-section>p{margin:0 0 12px}
      .mcp-manager .mcp-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 18px}
      .mcp-manager label.mcp-field{display:grid;gap:7px;min-width:0;color:#344054;font-weight:600}
      .mcp-manager .mcp-field input,.mcp-manager .mcp-field select{width:100%;min-width:0;height:39px;padding:8px 11px;border:1px solid #cfd7e3;border-radius:8px;background:white;color:var(--mcp-ink);outline:none;font-weight:400}
      .mcp-manager .mcp-field input:focus,.mcp-manager .mcp-field select:focus{border-color:var(--mcp-blue);box-shadow:0 0 0 3px #e7edff}
      .mcp-manager .mcp-field small{font-size:12px;color:var(--mcp-muted);font-weight:400}
      .mcp-manager .mcp-wide{grid-column:1/-1}.mcp-manager .mcp-switch,.mcp-manager .mcp-check{display:flex;align-items:center;gap:9px;cursor:pointer}
      .mcp-manager .mcp-switch input,.mcp-manager .mcp-check input{width:16px;height:16px;flex:none;accent-color:var(--mcp-blue)}
      .mcp-manager .mcp-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:18px}
      .mcp-manager .mcp-actions button,.mcp-manager .mcp-quiet{border:1px solid #ccd6e5;border-radius:8px;background:white;color:#344054;padding:8px 12px}
      .mcp-manager .mcp-actions button:hover:not(:disabled),.mcp-manager .mcp-quiet:hover:not(:disabled){background:#f3f6fb}
      .mcp-manager .mcp-danger{color:#bd3a42!important;border-color:#f1c9cd!important}
      .mcp-manager .mcp-note{padding:12px 14px;border-radius:9px;background:#f4f7fd;color:var(--mcp-muted);line-height:1.55}
      .mcp-manager .mcp-status{margin:0 0 16px;padding:11px 14px;border:1px solid #cdddfd;border-radius:9px;background:#f1f6ff;color:#294780}
      .mcp-manager .mcp-link{display:block;overflow-wrap:anywhere;padding:10px 12px;border:1px solid var(--mcp-line);border-radius:8px;background:var(--mcp-tint);color:#3154c3}
      .mcp-manager .mcp-server-tools{border:1px solid var(--mcp-line);border-radius:9px;margin-top:10px;background:#fff;overflow:hidden}
      .mcp-manager .mcp-server-tools summary{display:flex;align-items:center;gap:8px;cursor:pointer;padding:12px 14px;font-weight:600;list-style:none}
      .mcp-manager .mcp-server-tools summary::-webkit-details-marker{display:none}.mcp-manager .mcp-server-tools summary::before{content:'▸';color:var(--mcp-blue);margin-right:7px}.mcp-manager .mcp-server-tools[open] summary{border-bottom:1px solid var(--mcp-line)}.mcp-manager .mcp-server-tools[open] summary::before{content:'▾'}
      .mcp-manager .mcp-server-tools summary .mcp-muted{margin-left:auto}
      .mcp-manager .mcp-tool-body{padding:12px 14px}.mcp-manager .mcp-tool-body p{margin:0 0 10px}
      .mcp-manager .mcp-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:280px;overflow:auto}
      .mcp-manager .mcp-check{min-width:0;overflow-wrap:anywhere;padding:8px;border-radius:7px;background:var(--mcp-tint);font-size:12px}
      .mcp-manager .mcp-result{max-height:320px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0;padding:14px;border-radius:8px;background:#1f2937;color:#edf2ff;font-size:12px}
      .mcp-manager .mcp-catalog{list-style:none;margin:0;padding:0}.mcp-manager .mcp-catalog li{padding:11px 0;border-top:1px solid var(--mcp-line);overflow-wrap:anywhere}.mcp-manager .mcp-catalog li:first-child{border-top:0}.mcp-manager .mcp-catalog strong{display:block}.mcp-manager .mcp-catalog small{display:block;margin-top:3px;color:var(--mcp-muted)}
      .mcp-manager .mcp-source{padding:13px 0;border-top:1px solid var(--mcp-line)}.mcp-manager .mcp-source:first-child{border-top:0}
      .mcp-manager .mcp-empty{text-align:center;padding:72px 20px;color:var(--mcp-muted)}.mcp-manager .mcp-empty strong{display:block;color:var(--mcp-ink);font-size:16px}
      @media(max-width:760px){.mcp-manager .mcp-toolbar{align-items:start;flex-direction:column}.mcp-manager .mcp-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;padding:8px 8px 0;overflow:visible}.mcp-manager .mcp-tabs button{white-space:normal;padding:9px 5px}.mcp-manager .mcp-tabs button:last-child{grid-column:1/-1}.mcp-manager .mcp-layout{grid-template-columns:1fr}.mcp-manager .mcp-content{padding:14px}.mcp-manager .mcp-fields,.mcp-manager .mcp-tools{grid-template-columns:1fr}}
    `

    function Manager({ view, form, write }) {
      const state = form?.state
      const [draft, setDraft] = useState(null)
      const [discovered, setDiscovered] = useState({})
      const [selected, setSelected] = useState('')
      const [sources, setSources] = useState(null)
      const [sourceId, setSourceId] = useState('')
      const [specName, setSpecName] = useState('')
      const [specUrl, setSpecUrl] = useState(defaultSpec)
      const [toolName, setToolName] = useState('')
      const [argumentsText, setArgumentsText] = useState('{}')
      const [uriText, setUriText] = useState('')
      const [result, setResult] = useState(null)
      const discoveryEpoch = useRef(0)
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState(false)
      const [page, setPage] = useState('servers')
      const [activeServer, setActiveServer] = useState(0)
      const [activeGroup, setActiveGroup] = useState(0)
      const [tokenVisible, setTokenVisible] = useState(false)
      useEffect(() => {
        if (state?.status !== 'ready') return
        discoveryEpoch.current++
        setDiscovered({})
        setDraft({ servers: structuredClone(state.value.servers ?? []),
          groups: structuredClone(state.value.groups ?? []), sharedToken: state.value.sharedToken ?? '', revision: state.revision })
      }, [state?.value, state?.revision, state?.status])
      if (view === 'summary') return <>通过 OpenAPI 规范生成 MCP tools/resources，并管理分组链接。</>
      if (!draft || !state) return <p>正在读取 Web profile 配置…</p>

      const editServer = (index, field, value) => setDraft(previous => {
        const next = structuredClone(previous)
        next.servers[index][field] = value
        return next
      })
      const switchServerType = (index, type) => setDraft(previous => {
        const next = structuredClone(previous)
        const current = next.servers[index]
        const saved = state.value.servers.find(server => server.id === current.id)
        const restore = saved && (type === 'openapi' ? 'specUrl' in saved : !('specUrl' in saved))
        const source = restore ? structuredClone(saved) : type === 'openapi' ? emptyServer()
          : { url: '', headers: [], tools: { mode: 'all', names: [] } }
        next.servers[index] = { ...source, id: current.id, description: current.description ?? '',
          serverName: current.serverName, enabled: current.enabled }
        return next
      })
      const editGroup = (index, update) => setDraft(previous => {
        const next = structuredClone(previous)
        update(next.groups[index])
        return next
      })
      const diagnosticServer = draft.servers.find(server => server.id === selected) ?? draft.servers[0]
      const diagnosticId = diagnosticServer?.id ?? ''
      const catalog = discovered[diagnosticId]?.data ? { serverId: diagnosticId, data: discovered[diagnosticId].data } : null
      const call = async (action, extra = {}) => {
        if (action === 'test') return callTest(diagnosticId)
        setBusy(true)
        setStatus('')
        try {
          const response = await fetch(new URL('api/mcp-manager', document.baseURI), {
            method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ serverId: diagnosticId, action, ...extra }),
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
          setResult(data)
          if (action === 'sources' || action === 'create' || action === 'refresh' || action === 'toggle') {
            const list = action === 'sources' ? data : await callSources(diagnosticId)
            setSources(list)
          }
          setStatus('上游操作已返回；请检查下方结果和新会话。')
        } catch (error) { setStatus(String(error)) }
        finally { setBusy(false) }
      }
      const callSources = async serverId => {
        const response = await fetch(new URL('api/mcp-manager', document.baseURI), { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ serverId, action: 'sources' }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
        return data
      }
      const callTool = action => {
        try { void call(action, { sourceId, toolName, arguments: JSON.parse(argumentsText) }) }
        catch (error) { setStatus(`工具参数 JSON 无效：${String(error)}`) }
      }
      const save = async () => {
        setBusy(true)
        setStatus('')
        try {
          for (const server of draft.servers) {
            if (!('specUrl' in server)) {
              if (server.enabled !== false && !server.url) throw new Error(`${server.id}: 请填写 MCP URL`)
              continue
            }
            if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.id) || (server.enabled !== false && !server.specUrl)) throw new Error('请填写有效的服务器 ID 和 OpenAPI 接口规范地址')
            if (!server.specUrl) continue
            const url = new URL(server.specUrl)
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('OpenAPI 接口规范地址须为 HTTP(S) URL')
            if (server.authType === 'credential' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(server.authHeader ?? 'Authorization')) throw new Error('凭据 Header 字段名无效')
            if (server.authType === 'login') {
              if (server.enabled !== false && (!server.loginUrl || !server.loginUsername || !server.loginPassword || !server.loginTokenPath)) throw new Error('请填写完整的登录授权信息')
              if (!server.loginUrl) continue
              const loginUrl = new URL(server.loginUrl)
              if (!['http:', 'https:'].includes(loginUrl.protocol) || loginUrl.username || loginUrl.password || loginUrl.hash) throw new Error('登录接口地址须为 HTTP(S) URL')
              if (!server.loginTokenPath.split('.').every(part => /^[A-Za-z_][\w-]*$/.test(part))) throw new Error('凭据字段路径无效')
            }
          }
          const response = await write([
            { op: 'set', path: ['servers'], value: draft.servers },
            { op: 'set', path: ['groups'], value: draft.groups },
            { op: 'set', path: ['sharedToken'], value: draft.sharedToken },
          ], draft.revision)
          setStatus(response.ok ? '配置已保存。请新建会话验证连接与工具发现。'
            : `保存失败：${response.error.message}`)
          if (response.ok) { discoveryEpoch.current++; setDiscovered({}) }
        } catch (error) { setStatus(String(error)) }
        finally { setBusy(false) }
      }
      const toggleSelection = (groupIndex, serverId, field, value) => editGroup(groupIndex, group => {
        let member = group.members.find(item => item.serverId === serverId)
        if (!member) { member = { serverId, names: [], resourceUris: [], resourceTemplates: [] }; group.members.push(member) }
        const values = member[field] ?? []
        member[field] = values.includes(value) ? values.filter(item => item !== value) : [...values, value]
        group.members = group.members.filter(item => [item.names, item.resourceUris, item.resourceTemplates].some(values => values?.length))
      })
      const sourceList = Array.isArray(sources) ? sources : sources?.items ?? sources?.data ?? []
      const isDirty = JSON.stringify(draft.servers) !== JSON.stringify(state.value.servers ?? [])
        || JSON.stringify(draft.groups) !== JSON.stringify(state.value.groups ?? [])
        || draft.sharedToken !== (state.value.sharedToken ?? '')
      const editingServer = draft.servers[activeServer]
      const editingGroup = draft.groups[activeGroup]

      return <section className="mcp-manager">
        <style>{styles}</style>
        <div className="mcp-toolbar">
          <div><strong>当前实例的 MCP 配置</strong><p>修改后保存到 Web profile，再新建会话验证连接和工具发现。</p></div>
          <button className="mcp-primary" type="button" onClick={save} disabled={busy || !state.writable || !isDirty}>保存更改</button>
        </div>
        {status && <p className="mcp-status" role="status">{status}</p>}
        <div className="mcp-shell">
          <nav className="mcp-tabs" aria-label="MCP 配置管理页面">
            <button type="button" aria-current={page === 'servers' ? 'page' : undefined} onClick={() => setPage('servers')}>MCP 服务器 <small>{draft.servers.length}</small></button>
            <button type="button" aria-current={page === 'groups' ? 'page' : undefined} onClick={() => setPage('groups')}>工具与资源分组 <small>{draft.groups.length}</small></button>
            <button type="button" aria-current={page === 'connection' ? 'page' : undefined} onClick={() => setPage('connection')}>工具与资源</button>
          </nav>
          <div className="mcp-content">
            {page === 'servers' && <>
              <div className="mcp-heading"><div><h2>MCP 服务器</h2><p className="mcp-muted">添加 OpenAPI 规范地址生成工具，或填写现成 MCP 服务地址。</p></div></div>
              <div className="mcp-layout">
                <aside className="mcp-card mcp-sidebar" aria-label="服务器列表">
                  {draft.servers.map((server, index) => <button key={index} className="mcp-list-item" type="button" aria-current={activeServer === index ? 'true' : undefined} onClick={() => setActiveServer(index)}>
                    <strong>{server.serverName || server.id || '新服务器'}</strong><small>{server.id || '未设置 ID'} · {server.enabled === false ? '已停用' : '已启用'}</small>
                  </button>)}
                  <button className="mcp-add" type="button" onClick={() => { setActiveServer(draft.servers.length); setDraft(previous => ({ ...previous, servers: [...previous.servers, emptyServer()] })) }}>＋ 新增服务器</button>
                </aside>
                {editingServer ? <div className="mcp-card">
                  <div className="mcp-card-head"><div><h3>{editingServer.serverName || editingServer.id || '新服务器'}</h3><p className="mcp-muted">{editingServer.description || editingServer.id || '填写 ID 与 OpenAPI 规范地址后保存'}</p></div>
                    <label className="mcp-switch"><input type="checkbox" checked={editingServer.enabled !== false} onChange={event => editServer(activeServer, 'enabled', event.target.checked)} />启用</label>
                  </div>
                  <section className="mcp-section"><h3>基本信息</h3><div className="mcp-fields">
                    <label className="mcp-field">ID{input(editingServer.id, value => editServer(activeServer, 'id', value), { placeholder: '例如 sec-ops-api' })}</label>
                    <label className="mcp-field">描述（可选）{input(editingServer.description, value => editServer(activeServer, 'description', value))}</label>
                    {editingServer.serverName !== undefined && <label className="mcp-field">模型可见名称{input(editingServer.serverName, value => editServer(activeServer, 'serverName', value))}</label>}
                    <label className="mcp-field">接入方式<select value={'specUrl' in editingServer ? 'openapi' : 'mcp'} onChange={event => switchServerType(activeServer, event.target.value)}>
                      <option value="openapi">OpenAPI 接口规范</option><option value="mcp">现成 MCP 连接</option>
                    </select></label>
                  </div></section>
                  {'specUrl' in editingServer ? <section className="mcp-section"><h3>OpenAPI 接口</h3><p className="mcp-muted">保存后，接口规范中的操作会自动生成 MCP 工具或资源；服务器内全部开放。规范先匿名读取，遇 401/403 再用已配置的授权重试；业务接口始终按授权方式调用。</p><div className="mcp-fields">
                    <label className="mcp-field mcp-wide">OpenAPI 接口规范地址{input(editingServer.specUrl, value => editServer(activeServer, 'specUrl', value), { placeholder: defaultSpec })}</label>
                    <label className="mcp-field">授权方式<select value={editingServer.authType || (editingServer.apiKey ? 'legacy' : 'credential')} onChange={event => editServer(activeServer, 'authType', event.target.value)}>
                      {!editingServer.authType && editingServer.apiKey && <option value="legacy">按规范匹配（旧配置）</option>}
                      <option value="credential">凭据授权</option><option value="login">用户名密码登陆授权</option>
                    </select></label>
                    {editingServer.authType === 'login' ? <>
                      <label className="mcp-field mcp-wide">登录接口地址{input(editingServer.loginUrl, value => editServer(activeServer, 'loginUrl', value), { placeholder: 'https://…/login' })}</label>
                      <label className="mcp-field">用户名{input(editingServer.loginUsername, value => editServer(activeServer, 'loginUsername', value), { autoComplete: 'username' })}</label>
                      <label className="mcp-field">密码{input(editingServer.loginPassword, value => editServer(activeServer, 'loginPassword', value), { type: 'password', autoComplete: 'new-password' })}</label>
                      <label className="mcp-field">登录响应中的凭据字段{input(editingServer.loginTokenPath, value => editServer(activeServer, 'loginTokenPath', value), { placeholder: 'token 或 data.access_token' })}</label>
                      <p className="mcp-muted mcp-wide">以 JSON 的 username、password 字段登录；凭据按 OpenAPI 安全声明发送，401 时重新登录一次。</p>
                    </> : <>
                      <label className="mcp-field">凭据 Header 字段<select value={commonHeaders.includes(editingServer.authHeader ?? 'Authorization') ? (editingServer.authHeader ?? 'Authorization') : 'custom'} onChange={event => editServer(activeServer, 'authHeader', event.target.value === 'custom' ? '' : event.target.value)}>
                        {commonHeaders.map(name => <option key={name} value={name}>{name}</option>)}<option value="custom">自定义字段</option>
                      </select></label>
                      {!commonHeaders.includes(editingServer.authHeader ?? 'Authorization') && <label className="mcp-field">自定义 Header 字段名{input(editingServer.authHeader, value => editServer(activeServer, 'authHeader', value), { placeholder: 'X-Custom-Token' })}</label>}
                      <label className="mcp-field mcp-wide">凭据（可选）{input(editingServer.apiKey, value => editServer(activeServer, 'apiKey', value), { type: 'password', autoComplete: 'new-password' })}<small>默认将凭据原文写入 Authorization；若接口要求 Bearer，请在凭据中包含 Bearer 前缀。</small></label>
                    </>}
                  </div></section> : <><section className="mcp-section"><h3>连接设置</h3><p className="mcp-muted">填写 Streamable HTTP MCP URL；需要鉴权时添加请求 Header，例如 Authorization: Bearer …。保存后新建会话生效。</p><div className="mcp-fields">
                    <label className="mcp-field mcp-wide">MCP URL{input(editingServer.url, value => editServer(activeServer, 'url', value), { placeholder: 'https://…/mcp' })}</label>
                    {(editingServer.headers ?? []).map((header, index) => <React.Fragment key={index}>
                      <label className="mcp-field">Header 名称 {index + 1}{input(header.name, value => editServer(activeServer, 'headers', editingServer.headers.map((item, at) => at === index ? { ...item, name: value } : item)), { placeholder: 'Authorization' })}</label>
                      <label className="mcp-field">Header 值 {index + 1}{input(header.value, value => editServer(activeServer, 'headers', editingServer.headers.map((item, at) => at === index ? { ...item, value } : item)), { type: 'password', autoComplete: 'new-password' })}</label>
                      <div className="mcp-wide">{button(`删除 Header ${index + 1}`, () => editServer(activeServer, 'headers', editingServer.headers.filter((_, at) => at !== index)))}</div>
                    </React.Fragment>)}
                    <div className="mcp-wide">{button('＋ 添加请求 Header', () => editServer(activeServer, 'headers', [...(editingServer.headers ?? []), { name: '', value: '' }]))}</div>
                  </div></section>
                  <section className="mcp-section"><h3>工具范围</h3><div className="mcp-fields">
                    <label className="mcp-field">开放方式<select value={editingServer.tools?.mode ?? 'all'} onChange={event => editServer(activeServer, 'tools', { mode: event.target.value, names: editingServer.tools?.names ?? [] })}>
                      <option value="all">全部工具</option><option value="selected">仅指定工具</option>
                    </select></label>
                    {editingServer.tools?.mode === 'selected' && <label className="mcp-field mcp-wide">工具原名（逗号分隔）{input((editingServer.tools.names ?? []).join(', '), value => editServer(activeServer, 'tools', { mode: 'selected', names: value.split(',').map(name => name.trim()).filter(Boolean) }))}</label>}
                  </div><p className="mcp-muted">工具仍受业务 Guard 限制；子智能体的 toolFilter 可按角色进一步收紧。</p></section></>}
                  <div className="mcp-actions"><button className="mcp-danger" type="button" onClick={() => {
                    if (!window.confirm(`删除服务器「${editingServer.serverName || editingServer.id}」及其分组引用？`)) return
                    const serverId = editingServer.id
                    setDraft(previous => ({ ...previous, servers: previous.servers.filter((_, at) => at !== activeServer), groups: previous.groups.map(group => ({ ...group, members: group.members.filter(member => member.serverId !== serverId) })) }))
                    setActiveServer(Math.max(0, activeServer - 1))
                  }}>删除服务器</button></div>
                </div> : <div className="mcp-card mcp-empty"><strong>暂无服务器</strong><p>从左侧新增一个 MCP 服务器。</p></div>}
              </div>
            </>}
            {page === 'groups' && <>
              <div className="mcp-heading"><div><h2>工具与资源分组</h2><p className="mcp-muted">为每组选择可访问的工具、资源和资源模板，并使用独立的 MCP 链接。</p></div></div>
              <div className="mcp-card" style={{ marginBottom: 16 }}>
                <h3>统一访问 Token</h3><p className="mcp-muted">分组和智能体 MCP 链接共用。未生成时链接不接受访问；更换并保存后旧 Token 立即失效。</p>
                <div className="mcp-fields"><label className="mcp-field mcp-wide">Token{input(draft.sharedToken, () => {}, { type: tokenVisible ? 'text' : 'password', readOnly: true, placeholder: '尚未生成', autoComplete: 'off', id: 'mcp-shared-token' })}</label></div>
                <div className="mcp-actions">
                  {button(draft.sharedToken ? '重新生成 Token' : '生成 Token', () => {
                    if (draft.sharedToken && !window.confirm('更换 Token 并保存后，旧 Token 立即失效。继续？')) return
                    const bytes = new Uint8Array(32)
                    window.crypto.getRandomValues(bytes)
                    setDraft(previous => ({ ...previous, sharedToken: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') }))
                    setStatus('新 Token 已生成；请点击「保存更改」使其生效。')
                  })}
                  {button(tokenVisible ? '隐藏' : '显示', () => setTokenVisible(value => !value), !draft.sharedToken)}
                  {button('复制 Token', async () => { try { await navigator.clipboard.writeText(draft.sharedToken); setStatus('Token 已复制。') } catch { setTokenVisible(true); setStatus('当前浏览器无法自动复制，请显示后手动复制。') } }, !draft.sharedToken)}
                </div>
              </div>
              <div className="mcp-layout">
                <aside className="mcp-card mcp-sidebar" aria-label="分组列表">
                  {draft.groups.map((group, index) => <button key={index} className="mcp-list-item" type="button" aria-current={activeGroup === index ? 'true' : undefined} onClick={() => setActiveGroup(index)}>
                    <strong>{group.id || '新分组'}</strong><small>{group.members.reduce((count, member) => count + member.names.length, 0)} 个工具 · {group.members.reduce((count, member) => count + (member.resourceUris?.length ?? 0), 0)} 个资源 · {group.members.reduce((count, member) => count + (member.resourceTemplates?.length ?? 0), 0)} 个资源模板</small>
                  </button>)}
                  <button className="mcp-add" type="button" onClick={() => { setActiveGroup(draft.groups.length); setDraft(previous => ({ ...previous, groups: [...previous.groups, emptyGroup()] })) }}>＋ 新增分组</button>
                </aside>
                {editingGroup ? <div className="mcp-card">
                  <div className="mcp-card-head"><div><h3>{editingGroup.id || '新分组'}</h3><p className="mcp-muted">仅开放此组勾选的工具、资源和资源模板。</p></div></div>
                  <section className="mcp-section"><div className="mcp-fields"><label className="mcp-field">分组 ID{input(editingGroup.id, value => editGroup(activeGroup, group => { group.id = value }))}</label></div>
                    {editingGroup.id && <div className="mcp-actions"><span className="mcp-muted">MCP 链接</span><code className="mcp-link">{new URL(`mcp/groups/${encodeURIComponent(editingGroup.id)}`, document.baseURI).href}</code></div>}
                    <p className="mcp-muted">通过 Authorization: Bearer &lt;统一访问 Token&gt; 调用；此链接的工具与资源范围由本组勾选结果决定。</p>
                  </section>
                  <section className="mcp-section"><h3>选择工具与资源</h3><p className="mcp-muted">工具执行操作；资源按 URI 读取数据；资源模板填写参数后读取。展开服务器自动发现；已保存的选择会保留。</p>
                    {draft.servers.map((server, index) => {
                      const member = editingGroup.members.find(member => member.serverId === server.id)
                      const discovery = discovered[server.id]
                      const data = discovery?.data
                      const sections = [
                        { title: '工具', field: 'names', identity: 'name', items: data?.tools ?? [] },
                        { title: '资源', field: 'resourceUris', identity: 'uri', items: data?.resources?.resources ?? [], unavailable: data?.resources?.unavailable, error: data?.resources?.error },
                        { title: '资源模板', field: 'resourceTemplates', identity: 'uriTemplate', items: data?.resourceTemplates?.resourceTemplates ?? [], unavailable: data?.resourceTemplates?.unavailable, error: data?.resourceTemplates?.error },
                      ]
                      return <details className="mcp-server-tools" key={index} onToggle={event => {
                        if (event.currentTarget.open && !discovery && state.value.servers.some(item => item.id === server.id)) void callTest(server.id)
                      }}>
                        <summary>{server.serverName || server.id || '新服务器'}<span className="mcp-muted">{sections.map(section => `${section.title}已选 ${member?.[section.field]?.length ?? 0}`).join(' · ')}</span></summary>
                        <div className="mcp-tool-body">
                          <p className="mcp-muted">服务器：{server.id || '未设置 ID'}</p>
                          <button className="mcp-quiet" type="button" onClick={() => void callTest(server.id)} disabled={busy || discovery?.loading || !server.id}>发现工具与资源</button>
                          {!discovery && <p className="mcp-muted">尚未发现，仅显示已保存的选择；请先保存服务器配置。</p>}
                          {discovery?.loading && <p role="status">正在发现工具与资源…</p>}
                          {discovery?.error && <p role="alert">发现失败：{discovery.error}；仅显示已保存的选择。</p>}
                          {sections.map(section => {
                            const checked = member?.[section.field] ?? []
                            const choices = new Map(section.items.map(item => [item[section.identity], item]))
                            for (const value of checked) if (!choices.has(value)) choices.set(value, { [section.identity]: value })
                            return <section className="mcp-section" key={section.field}>
                              <h3>{section.title}（{!data || section.unavailable ? '未确认' : section.items.length}），已选 {checked.length}</h3>
                              {section.unavailable && <p role="alert">发现不可用：{section.error}</p>}
                              <div className="mcp-tools">{[...choices].map(([value, item]) => <label className="mcp-check" key={value}>
                                <input type="checkbox" checked={checked.includes(value)} onChange={() => toggleSelection(activeGroup, server.id, section.field, value)} />
                                <span>{item.name || value}{section.identity !== 'name' && <small> · {value}</small>}{data && !section.unavailable && !section.items.some(item => item[section.identity] === value) && '（当前未发现）'}</span>
                              </label>)}</div>
                            </section>
                          })}
                        </div>
                      </details>
                    })}
                    {!draft.servers.length && <p className="mcp-note">请先添加 MCP 服务器。</p>}
                  </section>
                  <div className="mcp-actions"><button className="mcp-danger" type="button" onClick={() => {
                    if (!window.confirm(`删除分组「${editingGroup.id}」？`)) return
                    setDraft(previous => ({ ...previous, groups: previous.groups.filter((_, at) => at !== activeGroup) }))
                    setActiveGroup(Math.max(0, activeGroup - 1))
                  }}>删除分组</button></div>
                </div> : <div className="mcp-card mcp-empty"><strong>暂无分组</strong><p>从左侧新增工具与资源分组。</p></div>}
              </div>
            </>}
            {page === 'connection' && <>
              <div className="mcp-heading"><div><h2>工具与资源</h2><p className="mcp-muted">按已保存的配置查看 OpenAPI 生成或现成 MCP 服务提供的能力。</p></div></div>
              <div className="mcp-card">
                <h3>连接检查</h3><p className="mcp-muted">测试使用上次保存的服务器配置。</p>
                <div className="mcp-fields"><label className="mcp-field">服务器<select value={diagnosticId} onChange={event => { setSelected(event.target.value); setSources(null); setResult(null); setUriText('') }}>
                  {draft.servers.map((server, index) => <option key={index} value={server.id}>{server.serverName || server.id || '新服务器'}</option>)}
                </select></label></div>
                <div className="mcp-actions">{button('发现工具与资源', () => call('test'), busy || discovered[diagnosticId]?.loading || !diagnosticId)}</div>
              </div>
              {diagnosticServer?.specUrl ? <div className="mcp-card" style={{ marginTop: 16 }}>
                <h3>OpenAPI 来源</h3><p className="mcp-muted">{diagnosticServer.specUrl}</p>
              </div> : diagnosticServer?.managementUrl ? <div className="mcp-card" style={{ marginTop: 16 }}>
                <div className="mcp-card-head"><div><h3>OpenAPI 来源</h3><p className="mcp-muted">管理 API：{diagnosticServer.managementUrl}</p></div>{button('读取来源', () => call('sources'), busy || !diagnosticId)}</div>
                <section className="mcp-section"><h3>添加来源</h3><div className="mcp-fields">
                  <label className="mcp-field">来源名称{input(specName, setSpecName)}</label>
                  <label className="mcp-field">OpenAPI specification URL{input(specUrl, setSpecUrl)}</label>
                </div><div className="mcp-actions">{button('创建来源', () => call('create', { name: specName, specUrl }), busy || !specName || !diagnosticId)}</div></section>
                {sourceList.length > 0 && <section className="mcp-section"><h3>现有来源</h3>{sourceList.map(source => <div className="mcp-source" key={source.id}>
                  <strong>{source.name}</strong><p className="mcp-muted">ID：{source.id} · {source.status ?? '状态未知'}</p>
                  <div className="mcp-actions">{button('组件', () => { setSourceId(String(source.id)); void call('components', { sourceId: String(source.id) }) }, busy)}
                    {button('刷新', () => call('refresh', { sourceId: String(source.id) }), busy)}
                    {button(source.enabled ? '停用来源' : '启用来源', () => call('toggle', { sourceId: String(source.id), enabled: !source.enabled }), busy)}
                    {button('日志', () => call('logs', { sourceId: String(source.id) }), busy)}</div>
                </div>)}</section>}
                <section className="mcp-section"><h3>工具操作</h3><div className="mcp-fields">
                  <label className="mcp-field">来源 ID{input(sourceId, setSourceId)}</label>
                  <label className="mcp-field">工具名称{input(toolName, setToolName)}</label>
                  <label className="mcp-field mcp-wide">工具参数 JSON{input(argumentsText, setArgumentsText)}</label>
                </div><div className="mcp-actions">{button('预览请求', () => callTool('preview'), busy || !sourceId || !toolName)}
                  {button('执行工具', () => callTool('invoke'), busy || !sourceId || !toolName)}</div></section>
              </div> : <div className="mcp-card" style={{ marginTop: 16 }}><h3>现成 MCP 连接</h3><p className="mcp-muted">该服务器按已保存的 MCP URL 和请求 Header 连接。</p></div>}
              {discovered[diagnosticId]?.loading && <p role="status">正在发现工具与资源…</p>}
              {discovered[diagnosticId]?.error && <p role="alert">发现失败：{discovered[diagnosticId].error}</p>}
              {catalog?.serverId === diagnosticId && <div className="mcp-card" style={{ marginTop: 16 }}>
                <h3>{diagnosticServer?.specUrl ? 'OpenAPI 生成的 MCP 能力' : '现成 MCP 服务的能力'}</h3>
                {[
                  { title: '工具', items: catalog.data.tools ?? [] },
                  { title: '资源', items: catalog.data.resources?.resources ?? [], unavailable: catalog.data.resources?.unavailable, error: catalog.data.resources?.error },
                  { title: '资源模板', items: catalog.data.resourceTemplates?.resourceTemplates ?? [], unavailable: catalog.data.resourceTemplates?.unavailable, error: catalog.data.resourceTemplates?.error },
                ].map(section => <section className="mcp-section" key={section.title}>
                  <h3>{section.title}（{section.unavailable ? '未确认' : section.items.length}）</h3>
                  {section.unavailable ? <p className="mcp-muted">服务未提供该列表，或读取失败。</p>
                    : section.items.length ? <ul className="mcp-catalog">{section.items.map((item, index) => <li key={index}>
                      <strong>{item.name || item.uri || item.uriTemplate}</strong>
                      {(item.uri || item.uriTemplate || item.description) && <small>{[item.uri || item.uriTemplate, item.description].filter(Boolean).join(' · ')}</small>}
                    </li>)}</ul> : <p className="mcp-muted">没有可列出的项目。</p>}
                </section>)}
                <section className="mcp-section"><h3>读取 Resource</h3>
                  <div className="mcp-fields"><label className="mcp-field mcp-wide">Resource URI{input(uriText, setUriText)}</label></div>
                  <div className="mcp-actions">{button('读取 Resource', () => call('readResource', { uri: uriText }), busy || !uriText)}</div>
                </section>
              </div>}
              {result && <div className="mcp-card" style={{ marginTop: 16 }}><h3>操作结果</h3><pre className="mcp-result">{JSON.stringify(result, null, 2)}</pre></div>}
            </>}
          </div>
        </div>
      </section>

      async function callTest(serverId) {
        const epoch = discoveryEpoch.current
        setDiscovered(previous => ({ ...previous, [serverId]: { loading: true } }))
        try {
          const response = await fetch(new URL('api/mcp-manager', document.baseURI), { method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverId, action: 'test' }) })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
          if (epoch !== discoveryEpoch.current) return
          setDiscovered(previous => ({ ...previous, [serverId]: { data } }))
          setStatus(`${serverId} 已发现 ${data.tools.length} 个工具、${data.resources?.unavailable ? '未确认' : data.resources.resources.length} 个资源、${data.resourceTemplates?.unavailable ? '未确认' : data.resourceTemplates.resourceTemplates.length} 个资源模板`)
        } catch (error) {
          if (epoch !== discoveryEpoch.current) return
          setDiscovered(previous => ({ ...previous, [serverId]: { error: String(error) } }))
          setStatus(String(error))
        }
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.configForms.whileServed([formName], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
        name: 'plugins.item', id: 'mcp-session-manager', order: 50,
        label: () => 'MCP 配置管理',
      }, props => <Manager {...props} write={(ops, revision) => ctx.remote.settings.mutate(formName, ops, revision)} />))), 'mcp-manager: page')
    }
    return { apply, inject: ['slots', 'configForms', 'remote', 'remote.settings'] }
  },
})
