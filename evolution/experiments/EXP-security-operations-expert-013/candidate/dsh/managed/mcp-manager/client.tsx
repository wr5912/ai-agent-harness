window.__ModuleLoader__.load({
  id: 'dsh-web-mcp-manager',
  factory(require) {
    const React = require('react')
    const { useEffect, useState } = React
    const formName = 'mcp-session-manager'
    const defaultSpec = 'http://172.16.138.232:18087/v3/api-docs/mcp'
    const emptyServer = () => ({ id: '', description: '', specUrl: '', apiKey: '',
      enabled: true, tools: { mode: 'all', names: [] } })
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
      const [status, setStatus] = useState('')
      const [busy, setBusy] = useState(false)
      const [page, setPage] = useState('servers')
      const [activeServer, setActiveServer] = useState(0)
      const [activeGroup, setActiveGroup] = useState(0)
      useEffect(() => {
        if (state?.status !== 'ready') return
        setDraft({ servers: structuredClone(state.value.servers ?? []),
          groups: structuredClone(state.value.groups ?? []), revision: state.revision })
      }, [state?.value, state?.revision, state?.status])
      if (view === 'summary') return <>通过 OpenAPI 规范生成 MCP tools/resources，并管理分组链接。</>
      if (!draft || !state) return <p>正在读取 Web profile 配置…</p>

      const editServer = (index, field, value) => setDraft(previous => {
        const next = structuredClone(previous)
        next.servers[index][field] = value
        return next
      })
      const editGroup = (index, update) => setDraft(previous => {
        const next = structuredClone(previous)
        update(next.groups[index])
        return next
      })
      const diagnosticServer = draft.servers.find(server => server.id === selected) ?? draft.servers[0]
      const diagnosticId = diagnosticServer?.id ?? ''
      const call = async (action, extra = {}) => {
        setBusy(true)
        setStatus('')
        try {
          const response = await fetch('/api/mcp-manager', {
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
          if (action === 'test') setDiscovered(previous => ({ ...previous,
            [diagnosticId]: data.tools?.map(tool => tool.name) ?? [] }))
          setStatus(action === 'test' ? '配置解析与工具发现成功；新会话仍需单独验证。'
            : '上游操作已返回；请检查下方结果和新会话。')
        } catch (error) { setStatus(String(error)) }
        finally { setBusy(false) }
      }
      const callSources = async serverId => {
        const response = await fetch('/api/mcp-manager', { method: 'POST', credentials: 'same-origin',
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
          for (const server of draft.servers.filter(item => !item.url && !item.urlEnv)) {
            if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.id) || !server.specUrl) throw new Error('请填写有效的服务器 ID 和 OpenAPI 接口规范地址')
            const url = new URL(server.specUrl)
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('OpenAPI 接口规范地址须为 HTTP(S) URL')
          }
          const response = await write([
            { op: 'set', path: ['servers'], value: draft.servers },
            { op: 'set', path: ['groups'], value: draft.groups },
          ], draft.revision)
          setStatus(response.ok ? '配置已保存。请新建会话验证连接与工具发现。'
            : `保存失败：${response.error.message}`)
        } catch (error) { setStatus(String(error)) }
        finally { setBusy(false) }
      }
      const toggleTool = (groupIndex, serverId, tool) => editGroup(groupIndex, group => {
        let member = group.members.find(item => item.serverId === serverId)
        if (!member) { member = { serverId, names: [] }; group.members.push(member) }
        member.names = member.names.includes(tool) ? member.names.filter(name => name !== tool) : [...member.names, tool]
        group.members = group.members.filter(item => item.names.length)
      })
      const sourceList = Array.isArray(sources) ? sources : sources?.items ?? sources?.data ?? []
      const isDirty = JSON.stringify(draft.servers) !== JSON.stringify(state.value.servers ?? [])
        || JSON.stringify(draft.groups) !== JSON.stringify(state.value.groups ?? [])
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
            <button type="button" aria-current={page === 'groups' ? 'page' : undefined} onClick={() => setPage('groups')}>工具分组 <small>{draft.groups.length}</small></button>
            <button type="button" aria-current={page === 'connection' ? 'page' : undefined} onClick={() => setPage('connection')}>连接检查与 OpenAPI 来源</button>
          </nav>
          <div className="mcp-content">
            {page === 'servers' && <>
              <div className="mcp-heading"><div><h2>MCP 服务器</h2><p className="mcp-muted">添加 OpenAPI 规范地址，自动生成 MCP tools/resources。</p></div></div>
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
                  {('specUrl' in editingServer || (!editingServer.url && !editingServer.urlEnv)) ? <section className="mcp-section"><h3>OpenAPI 接口</h3><p className="mcp-muted">保存后，接口规范中的操作会自动生成 MCP 工具或资源；服务器内全部开放。</p><div className="mcp-fields">
                    <label className="mcp-field">ID{input(editingServer.id, value => editServer(activeServer, 'id', value), { placeholder: '例如 sec-ops-api' })}</label>
                    <label className="mcp-field">描述（可选）{input(editingServer.description, value => editServer(activeServer, 'description', value))}</label>
                    <label className="mcp-field mcp-wide">OpenAPI 接口规范地址{input(editingServer.specUrl, value => editServer(activeServer, 'specUrl', value), { placeholder: defaultSpec })}</label>
                    <label className="mcp-field mcp-wide">API Key（可选）{input(editingServer.apiKey, value => editServer(activeServer, 'apiKey', value), { type: 'password', autoComplete: 'new-password' })}</label>
                  </div></section> : <><section className="mcp-section"><h3>基本信息</h3><div className="mcp-fields">
                    <label className="mcp-field">配置 ID{input(editingServer.id, value => editServer(activeServer, 'id', value))}</label>
                    <label className="mcp-field">模型可见名称{input(editingServer.serverName, value => editServer(activeServer, 'serverName', value))}</label>
                  </div></section>
                  <section className="mcp-section"><h3>连接设置</h3><p className="mcp-muted">填写 MCP URL 或 URL 环境变量。Bearer 凭据只从环境变量读取。</p><div className="mcp-fields">
                    <label className="mcp-field">MCP URL{input(editingServer.url, value => { editServer(activeServer, 'url', value); if (value) editServer(activeServer, 'urlEnv', '') }, { placeholder: 'https://…/mcp' })}</label>
                    <label className="mcp-field">URL 环境变量{input(editingServer.urlEnv, value => { editServer(activeServer, 'urlEnv', value); if (value) editServer(activeServer, 'url', '') }, { placeholder: 'SEC_OPS_MCP_URL' })}</label>
                    <label className="mcp-field">Bearer 环境变量{input(editingServer.tokenEnv, value => editServer(activeServer, 'tokenEnv', value), { placeholder: 'SEC_OPS_MCP_TOKEN' })}</label>
                    <label className="mcp-field">OpenAPI 管理 API 地址{input(editingServer.managementUrl, value => editServer(activeServer, 'managementUrl', value), { placeholder: 'http://…:8000/' })}</label>
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
              <div className="mcp-heading"><div><h2>工具分组</h2><p className="mcp-muted">为每组选择可访问的服务器工具，并使用独立的 MCP 链接。</p></div></div>
              <div className="mcp-layout">
                <aside className="mcp-card mcp-sidebar" aria-label="分组列表">
                  {draft.groups.map((group, index) => <button key={index} className="mcp-list-item" type="button" aria-current={activeGroup === index ? 'true' : undefined} onClick={() => setActiveGroup(index)}>
                    <strong>{group.id || '新分组'}</strong><small>{group.members.reduce((count, member) => count + member.names.length, 0)} 个工具</small>
                  </button>)}
                  <button className="mcp-add" type="button" onClick={() => { setActiveGroup(draft.groups.length); setDraft(previous => ({ ...previous, groups: [...previous.groups, emptyGroup()] })) }}>＋ 新增分组</button>
                </aside>
                {editingGroup ? <div className="mcp-card">
                  <div className="mcp-card-head"><div><h3>{editingGroup.id || '新分组'}</h3><p className="mcp-muted">仅开放此组勾选的工具。</p></div></div>
                  <section className="mcp-section"><div className="mcp-fields"><label className="mcp-field">分组 ID{input(editingGroup.id, value => editGroup(activeGroup, group => { group.id = value }))}</label></div>
                    {editingGroup.id && <div className="mcp-actions"><span className="mcp-muted">MCP 链接</span><code className="mcp-link">{location.origin}/mcp/groups/{editingGroup.id}</code></div>}
                    <p className="mcp-muted">分组端点统一使用 DSH_WEB_MCP_SHARED_TOKEN（未设置时为 change-me）；此链接的工具范围不受智能体 Guard 和 toolFilter 限制。</p>
                  </section>
                  <section className="mcp-section"><h3>选择工具</h3><p className="mcp-muted">发现工具后勾选；已保存的工具会直接显示。</p>
                    {draft.servers.map((server, index) => {
                      const checked = editingGroup.members.find(member => member.serverId === server.id)?.names ?? []
                      const names = [...new Set([...checked, ...(discovered[server.id] ?? [])])]
                      return <details className="mcp-server-tools" key={index}>
                        <summary>{server.serverName || server.id || '新服务器'}<span className="mcp-muted">{checked.length} 个已选</span></summary>
                        <div className="mcp-tool-body">
                          <p className="mcp-muted">服务器：{server.id || '未设置 ID'}</p>
                          <button className="mcp-quiet" type="button" onClick={() => { setSelected(server.id); void callTest(server.id) }} disabled={busy || !server.id}>发现工具</button>
                          {names.length ? <div className="mcp-tools">{names.map(tool => <label className="mcp-check" key={tool}><input type="checkbox" checked={checked.includes(tool)} onChange={() => toggleTool(activeGroup, server.id, tool)} />{tool}</label>)}</div>
                            : <p className="mcp-muted">尚无工具。点击“发现工具”读取该服务器的工具列表。</p>}
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
                </div> : <div className="mcp-card mcp-empty"><strong>暂无分组</strong><p>从左侧新增工具分组。</p></div>}
              </div>
            </>}
            {page === 'connection' && <>
              <div className="mcp-heading"><div><h2>连接检查与 OpenAPI 来源</h2><p className="mcp-muted">检查已保存的服务器，查看生成的工具和资源。</p></div></div>
              <div className="mcp-card">
                <h3>连接检查</h3><p className="mcp-muted">测试使用上次保存的服务器配置。</p>
                <div className="mcp-fields"><label className="mcp-field">服务器<select value={diagnosticId} onChange={event => { setSelected(event.target.value); setSources(null); setResult(null) }}>
                  {draft.servers.map((server, index) => <option key={index} value={server.id}>{server.serverName || server.id || '新服务器'}</option>)}
                </select></label></div>
                <div className="mcp-actions">{button('发现工具与资源', () => call('test'), busy || !diagnosticId)}</div>
              </div>
              {diagnosticServer?.specUrl ? <div className="mcp-card" style={{ marginTop: 16 }}>
                <h3>OpenAPI 来源</h3><p className="mcp-muted">{diagnosticServer.specUrl}</p>
                <section className="mcp-section"><h3>Resources</h3><div className="mcp-actions">{button('列出 Resources', () => call('resources'), busy)}
                  {button('列出 Resource Templates', () => call('resourceTemplates'), busy)}</div>
                  <div className="mcp-fields" style={{ marginTop: 12 }}><label className="mcp-field">Resource URI{input(uriText, setUriText)}</label></div>
                  <div className="mcp-actions">{button('读取 Resource', () => call('readResource', { uri: uriText }), busy || !uriText)}</div>
                </section>
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
                <section className="mcp-section"><h3>Resources</h3><div className="mcp-actions">{button('列出 Resources', () => call('resources'), busy)}
                  {button('列出 Resource Templates', () => call('resourceTemplates'), busy)}</div>
                  <div className="mcp-fields" style={{ marginTop: 12 }}><label className="mcp-field">Resource URI{input(uriText, setUriText)}</label></div>
                  <div className="mcp-actions">{button('读取 Resource', () => call('readResource', { uri: uriText }), busy || !uriText)}</div>
                </section>
              </div> : <div className="mcp-card" style={{ marginTop: 16 }}><h3>现成 MCP 连接</h3><p className="mcp-muted">该服务器按原有 MCP 地址连接。</p></div>}
              {result && <div className="mcp-card" style={{ marginTop: 16 }}><h3>操作结果</h3><pre className="mcp-result">{JSON.stringify(result, null, 2)}</pre></div>}
            </>}
          </div>
        </div>
      </section>

      async function callTest(serverId) {
        setBusy(true)
        try {
          const response = await fetch('/api/mcp-manager', { method: 'POST', credentials: 'same-origin',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverId, action: 'test' }) })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error)
          setDiscovered(previous => ({ ...previous, [serverId]: data.tools.map(tool => tool.name) }))
          setStatus(`${serverId} 已发现 ${data.tools.length} 个工具`)
        } catch (error) { setStatus(String(error)) }
        finally { setBusy(false) }
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
