"use strict";
window.__ModuleLoader__.load({
    id: 'dsh-web-mcp-manager',
    factory(require) {
        const React = require('react');
        const { useEffect, useState } = React;
        const formName = 'mcp-session-manager';
        const defaultSpec = 'http://172.16.138.232:18087/v3/api-docs/mcp';
        const emptyServer = () => ({ id: '', description: '', specUrl: '', apiKey: '',
            enabled: true, tools: { mode: 'all', names: [] } });
        const emptyGroup = () => ({ id: '', members: [] });
        const input = (value, change, props = {}) => React.createElement("input", { value: value ?? '', onChange: event => change(event.target.value), ...props });
        const button = (label, action, disabled = false) => React.createElement("button", { type: "button", onClick: action, disabled: disabled }, label);
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
    `;
        function Manager({ view, form, write }) {
            const state = form?.state;
            const [draft, setDraft] = useState(null);
            const [discovered, setDiscovered] = useState({});
            const [selected, setSelected] = useState('');
            const [sources, setSources] = useState(null);
            const [sourceId, setSourceId] = useState('');
            const [specName, setSpecName] = useState('');
            const [specUrl, setSpecUrl] = useState(defaultSpec);
            const [toolName, setToolName] = useState('');
            const [argumentsText, setArgumentsText] = useState('{}');
            const [uriText, setUriText] = useState('');
            const [result, setResult] = useState(null);
            const [status, setStatus] = useState('');
            const [busy, setBusy] = useState(false);
            const [page, setPage] = useState('servers');
            const [activeServer, setActiveServer] = useState(0);
            const [activeGroup, setActiveGroup] = useState(0);
            useEffect(() => {
                if (state?.status !== 'ready')
                    return;
                setDraft({ servers: structuredClone(state.value.servers ?? []),
                    groups: structuredClone(state.value.groups ?? []), revision: state.revision });
            }, [state?.value, state?.revision, state?.status]);
            if (view === 'summary')
                return React.createElement(React.Fragment, null, "\u901A\u8FC7 OpenAPI \u89C4\u8303\u751F\u6210 MCP tools/resources\uFF0C\u5E76\u7BA1\u7406\u5206\u7EC4\u94FE\u63A5\u3002");
            if (!draft || !state)
                return React.createElement("p", null, "\u6B63\u5728\u8BFB\u53D6 Web profile \u914D\u7F6E\u2026");
            const editServer = (index, field, value) => setDraft(previous => {
                const next = structuredClone(previous);
                next.servers[index][field] = value;
                return next;
            });
            const editGroup = (index, update) => setDraft(previous => {
                const next = structuredClone(previous);
                update(next.groups[index]);
                return next;
            });
            const diagnosticServer = draft.servers.find(server => server.id === selected) ?? draft.servers[0];
            const diagnosticId = diagnosticServer?.id ?? '';
            const call = async (action, extra = {}) => {
                setBusy(true);
                setStatus('');
                try {
                    const response = await fetch('/api/mcp-manager', {
                        method: 'POST', credentials: 'same-origin',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ serverId: diagnosticId, action, ...extra }),
                    });
                    const data = await response.json();
                    if (!response.ok)
                        throw new Error(data.error || `HTTP ${response.status}`);
                    setResult(data);
                    if (action === 'sources' || action === 'create' || action === 'refresh' || action === 'toggle') {
                        const list = action === 'sources' ? data : await callSources(diagnosticId);
                        setSources(list);
                    }
                    if (action === 'test')
                        setDiscovered(previous => ({ ...previous,
                            [diagnosticId]: data.tools?.map(tool => tool.name) ?? [] }));
                    setStatus(action === 'test' ? '配置解析与工具发现成功；新会话仍需单独验证。'
                        : '上游操作已返回；请检查下方结果和新会话。');
                }
                catch (error) {
                    setStatus(String(error));
                }
                finally {
                    setBusy(false);
                }
            };
            const callSources = async (serverId) => {
                const response = await fetch('/api/mcp-manager', { method: 'POST', credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ serverId, action: 'sources' }) });
                const data = await response.json();
                if (!response.ok)
                    throw new Error(data.error || `HTTP ${response.status}`);
                return data;
            };
            const callTool = action => {
                try {
                    void call(action, { sourceId, toolName, arguments: JSON.parse(argumentsText) });
                }
                catch (error) {
                    setStatus(`工具参数 JSON 无效：${String(error)}`);
                }
            };
            const save = async () => {
                setBusy(true);
                setStatus('');
                try {
                    for (const server of draft.servers.filter(item => !item.url && !item.urlEnv)) {
                        if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.id) || !server.specUrl)
                            throw new Error('请填写有效的服务器 ID 和 OpenAPI 接口规范地址');
                        const url = new URL(server.specUrl);
                        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
                            throw new Error('OpenAPI 接口规范地址须为 HTTP(S) URL');
                    }
                    const response = await write([
                        { op: 'set', path: ['servers'], value: draft.servers },
                        { op: 'set', path: ['groups'], value: draft.groups },
                    ], draft.revision);
                    setStatus(response.ok ? '配置已保存。请新建会话验证连接与工具发现。'
                        : `保存失败：${response.error.message}`);
                }
                catch (error) {
                    setStatus(String(error));
                }
                finally {
                    setBusy(false);
                }
            };
            const toggleTool = (groupIndex, serverId, tool) => editGroup(groupIndex, group => {
                let member = group.members.find(item => item.serverId === serverId);
                if (!member) {
                    member = { serverId, names: [] };
                    group.members.push(member);
                }
                member.names = member.names.includes(tool) ? member.names.filter(name => name !== tool) : [...member.names, tool];
                group.members = group.members.filter(item => item.names.length);
            });
            const sourceList = Array.isArray(sources) ? sources : sources?.items ?? sources?.data ?? [];
            const isDirty = JSON.stringify(draft.servers) !== JSON.stringify(state.value.servers ?? [])
                || JSON.stringify(draft.groups) !== JSON.stringify(state.value.groups ?? []);
            const editingServer = draft.servers[activeServer];
            const editingGroup = draft.groups[activeGroup];
            return React.createElement("section", { className: "mcp-manager" },
                React.createElement("style", null, styles),
                React.createElement("div", { className: "mcp-toolbar" },
                    React.createElement("div", null,
                        React.createElement("strong", null, "\u5F53\u524D\u5B9E\u4F8B\u7684 MCP \u914D\u7F6E"),
                        React.createElement("p", null, "\u4FEE\u6539\u540E\u4FDD\u5B58\u5230 Web profile\uFF0C\u518D\u65B0\u5EFA\u4F1A\u8BDD\u9A8C\u8BC1\u8FDE\u63A5\u548C\u5DE5\u5177\u53D1\u73B0\u3002")),
                    React.createElement("button", { className: "mcp-primary", type: "button", onClick: save, disabled: busy || !state.writable || !isDirty }, "\u4FDD\u5B58\u66F4\u6539")),
                status && React.createElement("p", { className: "mcp-status", role: "status" }, status),
                React.createElement("div", { className: "mcp-shell" },
                    React.createElement("nav", { className: "mcp-tabs", "aria-label": "MCP \u914D\u7F6E\u7BA1\u7406\u9875\u9762" },
                        React.createElement("button", { type: "button", "aria-current": page === 'servers' ? 'page' : undefined, onClick: () => setPage('servers') },
                            "MCP \u670D\u52A1\u5668 ",
                            React.createElement("small", null, draft.servers.length)),
                        React.createElement("button", { type: "button", "aria-current": page === 'groups' ? 'page' : undefined, onClick: () => setPage('groups') },
                            "\u5DE5\u5177\u5206\u7EC4 ",
                            React.createElement("small", null, draft.groups.length)),
                        React.createElement("button", { type: "button", "aria-current": page === 'connection' ? 'page' : undefined, onClick: () => setPage('connection') }, "\u8FDE\u63A5\u68C0\u67E5\u4E0E OpenAPI \u6765\u6E90")),
                    React.createElement("div", { className: "mcp-content" },
                        page === 'servers' && React.createElement(React.Fragment, null,
                            React.createElement("div", { className: "mcp-heading" },
                                React.createElement("div", null,
                                    React.createElement("h2", null, "MCP \u670D\u52A1\u5668"),
                                    React.createElement("p", { className: "mcp-muted" }, "\u6DFB\u52A0 OpenAPI \u89C4\u8303\u5730\u5740\uFF0C\u81EA\u52A8\u751F\u6210 MCP tools/resources\u3002"))),
                            React.createElement("div", { className: "mcp-layout" },
                                React.createElement("aside", { className: "mcp-card mcp-sidebar", "aria-label": "\u670D\u52A1\u5668\u5217\u8868" },
                                    draft.servers.map((server, index) => React.createElement("button", { key: index, className: "mcp-list-item", type: "button", "aria-current": activeServer === index ? 'true' : undefined, onClick: () => setActiveServer(index) },
                                        React.createElement("strong", null, server.serverName || server.id || '新服务器'),
                                        React.createElement("small", null,
                                            server.id || '未设置 ID',
                                            " \u00B7 ",
                                            server.enabled === false ? '已停用' : '已启用'))),
                                    React.createElement("button", { className: "mcp-add", type: "button", onClick: () => { setActiveServer(draft.servers.length); setDraft(previous => ({ ...previous, servers: [...previous.servers, emptyServer()] })); } }, "\uFF0B \u65B0\u589E\u670D\u52A1\u5668")),
                                editingServer ? React.createElement("div", { className: "mcp-card" },
                                    React.createElement("div", { className: "mcp-card-head" },
                                        React.createElement("div", null,
                                            React.createElement("h3", null, editingServer.serverName || editingServer.id || '新服务器'),
                                            React.createElement("p", { className: "mcp-muted" }, editingServer.description || editingServer.id || '填写 ID 与 OpenAPI 规范地址后保存')),
                                        React.createElement("label", { className: "mcp-switch" },
                                            React.createElement("input", { type: "checkbox", checked: editingServer.enabled !== false, onChange: event => editServer(activeServer, 'enabled', event.target.checked) }),
                                            "\u542F\u7528")),
                                    ('specUrl' in editingServer || (!editingServer.url && !editingServer.urlEnv)) ? React.createElement("section", { className: "mcp-section" },
                                        React.createElement("h3", null, "OpenAPI \u63A5\u53E3"),
                                        React.createElement("p", { className: "mcp-muted" }, "\u4FDD\u5B58\u540E\uFF0C\u63A5\u53E3\u89C4\u8303\u4E2D\u7684\u64CD\u4F5C\u4F1A\u81EA\u52A8\u751F\u6210 MCP \u5DE5\u5177\u6216\u8D44\u6E90\uFF1B\u670D\u52A1\u5668\u5185\u5168\u90E8\u5F00\u653E\u3002"),
                                        React.createElement("div", { className: "mcp-fields" },
                                            React.createElement("label", { className: "mcp-field" },
                                                "ID",
                                                input(editingServer.id, value => editServer(activeServer, 'id', value), { placeholder: '例如 sec-ops-api' })),
                                            React.createElement("label", { className: "mcp-field" },
                                                "\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09",
                                                input(editingServer.description, value => editServer(activeServer, 'description', value))),
                                            React.createElement("label", { className: "mcp-field mcp-wide" },
                                                "OpenAPI \u63A5\u53E3\u89C4\u8303\u5730\u5740",
                                                input(editingServer.specUrl, value => editServer(activeServer, 'specUrl', value), { placeholder: defaultSpec })),
                                            React.createElement("label", { className: "mcp-field mcp-wide" },
                                                "API Key\uFF08\u53EF\u9009\uFF09",
                                                input(editingServer.apiKey, value => editServer(activeServer, 'apiKey', value), { type: 'password', autoComplete: 'new-password' })))) : React.createElement(React.Fragment, null,
                                        React.createElement("section", { className: "mcp-section" },
                                            React.createElement("h3", null, "\u57FA\u672C\u4FE1\u606F"),
                                            React.createElement("div", { className: "mcp-fields" },
                                                React.createElement("label", { className: "mcp-field" },
                                                    "\u914D\u7F6E ID",
                                                    input(editingServer.id, value => editServer(activeServer, 'id', value))),
                                                React.createElement("label", { className: "mcp-field" },
                                                    "\u6A21\u578B\u53EF\u89C1\u540D\u79F0",
                                                    input(editingServer.serverName, value => editServer(activeServer, 'serverName', value))))),
                                        React.createElement("section", { className: "mcp-section" },
                                            React.createElement("h3", null, "\u8FDE\u63A5\u8BBE\u7F6E"),
                                            React.createElement("p", { className: "mcp-muted" }, "\u586B\u5199 MCP URL \u6216 URL \u73AF\u5883\u53D8\u91CF\u3002Bearer \u51ED\u636E\u53EA\u4ECE\u73AF\u5883\u53D8\u91CF\u8BFB\u53D6\u3002"),
                                            React.createElement("div", { className: "mcp-fields" },
                                                React.createElement("label", { className: "mcp-field" },
                                                    "MCP URL",
                                                    input(editingServer.url, value => { editServer(activeServer, 'url', value); if (value)
                                                        editServer(activeServer, 'urlEnv', ''); }, { placeholder: 'https://…/mcp' })),
                                                React.createElement("label", { className: "mcp-field" },
                                                    "URL \u73AF\u5883\u53D8\u91CF",
                                                    input(editingServer.urlEnv, value => { editServer(activeServer, 'urlEnv', value); if (value)
                                                        editServer(activeServer, 'url', ''); }, { placeholder: 'SEC_OPS_MCP_URL' })),
                                                React.createElement("label", { className: "mcp-field" },
                                                    "Bearer \u73AF\u5883\u53D8\u91CF",
                                                    input(editingServer.tokenEnv, value => editServer(activeServer, 'tokenEnv', value), { placeholder: 'SEC_OPS_MCP_TOKEN' })),
                                                React.createElement("label", { className: "mcp-field" },
                                                    "OpenAPI \u7BA1\u7406 API \u5730\u5740",
                                                    input(editingServer.managementUrl, value => editServer(activeServer, 'managementUrl', value), { placeholder: 'http://…:8000/' })))),
                                        React.createElement("section", { className: "mcp-section" },
                                            React.createElement("h3", null, "\u5DE5\u5177\u8303\u56F4"),
                                            React.createElement("div", { className: "mcp-fields" },
                                                React.createElement("label", { className: "mcp-field" },
                                                    "\u5F00\u653E\u65B9\u5F0F",
                                                    React.createElement("select", { value: editingServer.tools?.mode ?? 'all', onChange: event => editServer(activeServer, 'tools', { mode: event.target.value, names: editingServer.tools?.names ?? [] }) },
                                                        React.createElement("option", { value: "all" }, "\u5168\u90E8\u5DE5\u5177"),
                                                        React.createElement("option", { value: "selected" }, "\u4EC5\u6307\u5B9A\u5DE5\u5177"))),
                                                editingServer.tools?.mode === 'selected' && React.createElement("label", { className: "mcp-field mcp-wide" },
                                                    "\u5DE5\u5177\u539F\u540D\uFF08\u9017\u53F7\u5206\u9694\uFF09",
                                                    input((editingServer.tools.names ?? []).join(', '), value => editServer(activeServer, 'tools', { mode: 'selected', names: value.split(',').map(name => name.trim()).filter(Boolean) })))),
                                            React.createElement("p", { className: "mcp-muted" }, "\u5DE5\u5177\u4ECD\u53D7\u4E1A\u52A1 Guard \u9650\u5236\uFF1B\u5B50\u667A\u80FD\u4F53\u7684 toolFilter \u53EF\u6309\u89D2\u8272\u8FDB\u4E00\u6B65\u6536\u7D27\u3002"))),
                                    React.createElement("div", { className: "mcp-actions" },
                                        React.createElement("button", { className: "mcp-danger", type: "button", onClick: () => {
                                                if (!window.confirm(`删除服务器「${editingServer.serverName || editingServer.id}」及其分组引用？`))
                                                    return;
                                                const serverId = editingServer.id;
                                                setDraft(previous => ({ ...previous, servers: previous.servers.filter((_, at) => at !== activeServer), groups: previous.groups.map(group => ({ ...group, members: group.members.filter(member => member.serverId !== serverId) })) }));
                                                setActiveServer(Math.max(0, activeServer - 1));
                                            } }, "\u5220\u9664\u670D\u52A1\u5668"))) : React.createElement("div", { className: "mcp-card mcp-empty" },
                                    React.createElement("strong", null, "\u6682\u65E0\u670D\u52A1\u5668"),
                                    React.createElement("p", null, "\u4ECE\u5DE6\u4FA7\u65B0\u589E\u4E00\u4E2A MCP \u670D\u52A1\u5668\u3002")))),
                        page === 'groups' && React.createElement(React.Fragment, null,
                            React.createElement("div", { className: "mcp-heading" },
                                React.createElement("div", null,
                                    React.createElement("h2", null, "\u5DE5\u5177\u5206\u7EC4"),
                                    React.createElement("p", { className: "mcp-muted" }, "\u4E3A\u6BCF\u7EC4\u9009\u62E9\u53EF\u8BBF\u95EE\u7684\u670D\u52A1\u5668\u5DE5\u5177\uFF0C\u5E76\u4F7F\u7528\u72EC\u7ACB\u7684 MCP \u94FE\u63A5\u3002"))),
                            React.createElement("div", { className: "mcp-layout" },
                                React.createElement("aside", { className: "mcp-card mcp-sidebar", "aria-label": "\u5206\u7EC4\u5217\u8868" },
                                    draft.groups.map((group, index) => React.createElement("button", { key: index, className: "mcp-list-item", type: "button", "aria-current": activeGroup === index ? 'true' : undefined, onClick: () => setActiveGroup(index) },
                                        React.createElement("strong", null, group.id || '新分组'),
                                        React.createElement("small", null,
                                            group.members.reduce((count, member) => count + member.names.length, 0),
                                            " \u4E2A\u5DE5\u5177"))),
                                    React.createElement("button", { className: "mcp-add", type: "button", onClick: () => { setActiveGroup(draft.groups.length); setDraft(previous => ({ ...previous, groups: [...previous.groups, emptyGroup()] })); } }, "\uFF0B \u65B0\u589E\u5206\u7EC4")),
                                editingGroup ? React.createElement("div", { className: "mcp-card" },
                                    React.createElement("div", { className: "mcp-card-head" },
                                        React.createElement("div", null,
                                            React.createElement("h3", null, editingGroup.id || '新分组'),
                                            React.createElement("p", { className: "mcp-muted" }, "\u4EC5\u5F00\u653E\u6B64\u7EC4\u52FE\u9009\u7684\u5DE5\u5177\u3002"))),
                                    React.createElement("section", { className: "mcp-section" },
                                        React.createElement("div", { className: "mcp-fields" },
                                            React.createElement("label", { className: "mcp-field" },
                                                "\u5206\u7EC4 ID",
                                                input(editingGroup.id, value => editGroup(activeGroup, group => { group.id = value; })))),
                                        editingGroup.id && React.createElement("div", { className: "mcp-actions" },
                                            React.createElement("span", { className: "mcp-muted" }, "MCP \u94FE\u63A5"),
                                            React.createElement("code", { className: "mcp-link" },
                                                location.origin,
                                                "/mcp/groups/",
                                                editingGroup.id)),
                                        React.createElement("p", { className: "mcp-muted" }, "\u5206\u7EC4\u7AEF\u70B9\u7EDF\u4E00\u4F7F\u7528 DSH_WEB_MCP_SHARED_TOKEN\uFF08\u672A\u8BBE\u7F6E\u65F6\u4E3A change-me\uFF09\uFF1B\u6B64\u94FE\u63A5\u7684\u5DE5\u5177\u8303\u56F4\u4E0D\u53D7\u667A\u80FD\u4F53 Guard \u548C toolFilter \u9650\u5236\u3002")),
                                    React.createElement("section", { className: "mcp-section" },
                                        React.createElement("h3", null, "\u9009\u62E9\u5DE5\u5177"),
                                        React.createElement("p", { className: "mcp-muted" }, "\u53D1\u73B0\u5DE5\u5177\u540E\u52FE\u9009\uFF1B\u5DF2\u4FDD\u5B58\u7684\u5DE5\u5177\u4F1A\u76F4\u63A5\u663E\u793A\u3002"),
                                        draft.servers.map((server, index) => {
                                            const checked = editingGroup.members.find(member => member.serverId === server.id)?.names ?? [];
                                            const names = [...new Set([...checked, ...(discovered[server.id] ?? [])])];
                                            return React.createElement("details", { className: "mcp-server-tools", key: index },
                                                React.createElement("summary", null,
                                                    server.serverName || server.id || '新服务器',
                                                    React.createElement("span", { className: "mcp-muted" },
                                                        checked.length,
                                                        " \u4E2A\u5DF2\u9009")),
                                                React.createElement("div", { className: "mcp-tool-body" },
                                                    React.createElement("p", { className: "mcp-muted" },
                                                        "\u670D\u52A1\u5668\uFF1A",
                                                        server.id || '未设置 ID'),
                                                    React.createElement("button", { className: "mcp-quiet", type: "button", onClick: () => { setSelected(server.id); void callTest(server.id); }, disabled: busy || !server.id }, "\u53D1\u73B0\u5DE5\u5177"),
                                                    names.length ? React.createElement("div", { className: "mcp-tools" }, names.map(tool => React.createElement("label", { className: "mcp-check", key: tool },
                                                        React.createElement("input", { type: "checkbox", checked: checked.includes(tool), onChange: () => toggleTool(activeGroup, server.id, tool) }),
                                                        tool)))
                                                        : React.createElement("p", { className: "mcp-muted" }, "\u5C1A\u65E0\u5DE5\u5177\u3002\u70B9\u51FB\u201C\u53D1\u73B0\u5DE5\u5177\u201D\u8BFB\u53D6\u8BE5\u670D\u52A1\u5668\u7684\u5DE5\u5177\u5217\u8868\u3002")));
                                        }),
                                        !draft.servers.length && React.createElement("p", { className: "mcp-note" }, "\u8BF7\u5148\u6DFB\u52A0 MCP \u670D\u52A1\u5668\u3002")),
                                    React.createElement("div", { className: "mcp-actions" },
                                        React.createElement("button", { className: "mcp-danger", type: "button", onClick: () => {
                                                if (!window.confirm(`删除分组「${editingGroup.id}」？`))
                                                    return;
                                                setDraft(previous => ({ ...previous, groups: previous.groups.filter((_, at) => at !== activeGroup) }));
                                                setActiveGroup(Math.max(0, activeGroup - 1));
                                            } }, "\u5220\u9664\u5206\u7EC4"))) : React.createElement("div", { className: "mcp-card mcp-empty" },
                                    React.createElement("strong", null, "\u6682\u65E0\u5206\u7EC4"),
                                    React.createElement("p", null, "\u4ECE\u5DE6\u4FA7\u65B0\u589E\u5DE5\u5177\u5206\u7EC4\u3002")))),
                        page === 'connection' && React.createElement(React.Fragment, null,
                            React.createElement("div", { className: "mcp-heading" },
                                React.createElement("div", null,
                                    React.createElement("h2", null, "\u8FDE\u63A5\u68C0\u67E5\u4E0E OpenAPI \u6765\u6E90"),
                                    React.createElement("p", { className: "mcp-muted" }, "\u68C0\u67E5\u5DF2\u4FDD\u5B58\u7684\u670D\u52A1\u5668\uFF0C\u67E5\u770B\u751F\u6210\u7684\u5DE5\u5177\u548C\u8D44\u6E90\u3002"))),
                            React.createElement("div", { className: "mcp-card" },
                                React.createElement("h3", null, "\u8FDE\u63A5\u68C0\u67E5"),
                                React.createElement("p", { className: "mcp-muted" }, "\u6D4B\u8BD5\u4F7F\u7528\u4E0A\u6B21\u4FDD\u5B58\u7684\u670D\u52A1\u5668\u914D\u7F6E\u3002"),
                                React.createElement("div", { className: "mcp-fields" },
                                    React.createElement("label", { className: "mcp-field" },
                                        "\u670D\u52A1\u5668",
                                        React.createElement("select", { value: diagnosticId, onChange: event => { setSelected(event.target.value); setSources(null); setResult(null); } }, draft.servers.map((server, index) => React.createElement("option", { key: index, value: server.id }, server.serverName || server.id || '新服务器'))))),
                                React.createElement("div", { className: "mcp-actions" }, button('发现工具与资源', () => call('test'), busy || !diagnosticId))),
                            diagnosticServer?.specUrl ? React.createElement("div", { className: "mcp-card", style: { marginTop: 16 } },
                                React.createElement("h3", null, "OpenAPI \u6765\u6E90"),
                                React.createElement("p", { className: "mcp-muted" }, diagnosticServer.specUrl),
                                React.createElement("section", { className: "mcp-section" },
                                    React.createElement("h3", null, "Resources"),
                                    React.createElement("div", { className: "mcp-actions" },
                                        button('列出 Resources', () => call('resources'), busy),
                                        button('列出 Resource Templates', () => call('resourceTemplates'), busy)),
                                    React.createElement("div", { className: "mcp-fields", style: { marginTop: 12 } },
                                        React.createElement("label", { className: "mcp-field" },
                                            "Resource URI",
                                            input(uriText, setUriText))),
                                    React.createElement("div", { className: "mcp-actions" }, button('读取 Resource', () => call('readResource', { uri: uriText }), busy || !uriText)))) : diagnosticServer?.managementUrl ? React.createElement("div", { className: "mcp-card", style: { marginTop: 16 } },
                                React.createElement("div", { className: "mcp-card-head" },
                                    React.createElement("div", null,
                                        React.createElement("h3", null, "OpenAPI \u6765\u6E90"),
                                        React.createElement("p", { className: "mcp-muted" },
                                            "\u7BA1\u7406 API\uFF1A",
                                            diagnosticServer.managementUrl)),
                                    button('读取来源', () => call('sources'), busy || !diagnosticId)),
                                React.createElement("section", { className: "mcp-section" },
                                    React.createElement("h3", null, "\u6DFB\u52A0\u6765\u6E90"),
                                    React.createElement("div", { className: "mcp-fields" },
                                        React.createElement("label", { className: "mcp-field" },
                                            "\u6765\u6E90\u540D\u79F0",
                                            input(specName, setSpecName)),
                                        React.createElement("label", { className: "mcp-field" },
                                            "OpenAPI specification URL",
                                            input(specUrl, setSpecUrl))),
                                    React.createElement("div", { className: "mcp-actions" }, button('创建来源', () => call('create', { name: specName, specUrl }), busy || !specName || !diagnosticId))),
                                sourceList.length > 0 && React.createElement("section", { className: "mcp-section" },
                                    React.createElement("h3", null, "\u73B0\u6709\u6765\u6E90"),
                                    sourceList.map(source => React.createElement("div", { className: "mcp-source", key: source.id },
                                        React.createElement("strong", null, source.name),
                                        React.createElement("p", { className: "mcp-muted" },
                                            "ID\uFF1A",
                                            source.id,
                                            " \u00B7 ",
                                            source.status ?? '状态未知'),
                                        React.createElement("div", { className: "mcp-actions" },
                                            button('组件', () => { setSourceId(String(source.id)); void call('components', { sourceId: String(source.id) }); }, busy),
                                            button('刷新', () => call('refresh', { sourceId: String(source.id) }), busy),
                                            button(source.enabled ? '停用来源' : '启用来源', () => call('toggle', { sourceId: String(source.id), enabled: !source.enabled }), busy),
                                            button('日志', () => call('logs', { sourceId: String(source.id) }), busy))))),
                                React.createElement("section", { className: "mcp-section" },
                                    React.createElement("h3", null, "\u5DE5\u5177\u64CD\u4F5C"),
                                    React.createElement("div", { className: "mcp-fields" },
                                        React.createElement("label", { className: "mcp-field" },
                                            "\u6765\u6E90 ID",
                                            input(sourceId, setSourceId)),
                                        React.createElement("label", { className: "mcp-field" },
                                            "\u5DE5\u5177\u540D\u79F0",
                                            input(toolName, setToolName)),
                                        React.createElement("label", { className: "mcp-field mcp-wide" },
                                            "\u5DE5\u5177\u53C2\u6570 JSON",
                                            input(argumentsText, setArgumentsText))),
                                    React.createElement("div", { className: "mcp-actions" },
                                        button('预览请求', () => callTool('preview'), busy || !sourceId || !toolName),
                                        button('执行工具', () => callTool('invoke'), busy || !sourceId || !toolName))),
                                React.createElement("section", { className: "mcp-section" },
                                    React.createElement("h3", null, "Resources"),
                                    React.createElement("div", { className: "mcp-actions" },
                                        button('列出 Resources', () => call('resources'), busy),
                                        button('列出 Resource Templates', () => call('resourceTemplates'), busy)),
                                    React.createElement("div", { className: "mcp-fields", style: { marginTop: 12 } },
                                        React.createElement("label", { className: "mcp-field" },
                                            "Resource URI",
                                            input(uriText, setUriText))),
                                    React.createElement("div", { className: "mcp-actions" }, button('读取 Resource', () => call('readResource', { uri: uriText }), busy || !uriText)))) : React.createElement("div", { className: "mcp-card", style: { marginTop: 16 } },
                                React.createElement("h3", null, "\u73B0\u6210 MCP \u8FDE\u63A5"),
                                React.createElement("p", { className: "mcp-muted" }, "\u8BE5\u670D\u52A1\u5668\u6309\u539F\u6709 MCP \u5730\u5740\u8FDE\u63A5\u3002")),
                            result && React.createElement("div", { className: "mcp-card", style: { marginTop: 16 } },
                                React.createElement("h3", null, "\u64CD\u4F5C\u7ED3\u679C"),
                                React.createElement("pre", { className: "mcp-result" }, JSON.stringify(result, null, 2)))))));
            async function callTest(serverId) {
                setBusy(true);
                try {
                    const response = await fetch('/api/mcp-manager', { method: 'POST', credentials: 'same-origin',
                        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverId, action: 'test' }) });
                    const data = await response.json();
                    if (!response.ok)
                        throw new Error(data.error);
                    setDiscovered(previous => ({ ...previous, [serverId]: data.tools.map(tool => tool.name) }));
                    setStatus(`${serverId} 已发现 ${data.tools.length} 个工具`);
                }
                catch (error) {
                    setStatus(String(error));
                }
                finally {
                    setBusy(false);
                }
            }
        }
        function apply(ctx) {
            ctx.effect(() => ctx.configForms.whileServed([formName], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
                name: 'plugins.item', id: 'mcp-session-manager', order: 50,
                label: () => 'MCP 配置管理',
            }, props => React.createElement(Manager, { ...props, write: (ops, revision) => ctx.remote.settings.mutate(formName, ops, revision) })))), 'mcp-manager: page');
        }
        return { apply, inject: ['slots', 'configForms', 'remote', 'remote.settings'] };
    },
});
