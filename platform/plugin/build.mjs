import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const managerSource = resolve('../../evolution/experiments/EXP-security-operations-expert-018-rfbf7fd53a340/candidate/dsh/managed/mcp-manager')
export const managerSources = {
  name: 'existing-mcp-manager',
  setup(build) {
    build.onResolve({ filter: /^harness-mcp-manager-/ }, args => ({ path: args.path, namespace: 'manager-source' }))
    build.onLoad({ filter: /.*/, namespace: 'manager-source' }, async ({ path }) => {
      let contents
      if (path.endsWith('client')) {
        const original = await readFile(resolve(managerSource, 'client.tsx'), 'utf8')
        const start = original.indexOf('    const formName =')
        const end = original.indexOf('    function apply(ctx)')
        if (start < 0 || end <= start) throw new Error('MCP 管理客户端装载合同已变化')
        const toolbarStart = original.indexOf('        <div className="mcp-toolbar">', start)
        const toolbarEnd = original.indexOf('        {status &&', toolbarStart)
        if (toolbarStart < start || toolbarEnd <= toolbarStart) throw new Error('MCP 管理工具栏装载合同已变化')
        const client = original.slice(start, toolbarStart) + `{toolbarTarget && createPortal(<button className="harness-primary" type="button" onClick={save} disabled={busy || !state.writable || !isDirty}>保存更改</button>, toolbarTarget)}\n` + original.slice(toolbarEnd, end)
        const toolEditor = `<section className="mcp-section"><h3>调用工具</h3><div className="mcp-fields"><label className="mcp-field">工具<select value={toolName} onChange={event => setToolName(event.target.value)}><option value="">请选择工具</option>{(catalog.data.tools ?? []).map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></label><label className="mcp-field mcp-wide">调用参数 JSON{input(argumentsText, setArgumentsText)}</label></div><div className="mcp-actions">{button('测试工具', () => callTool('callTool'), busy || !toolName)}</div></section>`
        const adapted = client
          .replace('function Manager({ view, form, write })', 'function Manager({ view, form, write, toolbarTarget, publishedService, onValidationError })')
          .replace("const [page, setPage] = useState('servers')", "const [page, setPage] = useState('servers'); useEffect(() => { if (['servers', 'groups', 'connection'].includes(view)) setPage(view) }, [view])")
          .replace('[state?.value, state?.revision, state?.status]', '[JSON.stringify(state?.value), state?.revision, state?.status]')
          .replace('for (const server of draft.servers) {', 'for (const [index, server] of draft.servers.entries()) {\n            try {')
          .replace("if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.id) || (server.enabled !== false && !server.specUrl)) throw new Error('请填写有效的服务器 ID 和 OpenAPI 接口规范地址')", "if (!/^[A-Za-z0-9_-]{1,32}$/.test(server.id)) throw new Error('ID 须为 1–32 个字母、数字、下划线或连字符');\n            if (server.enabled !== false && !server.specUrl) throw new Error('请填写 OpenAPI 接口规范地址')")
          .replace('          }\n          const response = await write([', `            } catch (error) {
              onValidationError?.(); setPage('servers'); setActiveServer(index)
              throw new Error(\`第 \${index + 1} 项服务：\${error instanceof Error ? error.message : String(error)}\`)
            }
          }
          const response = await write([`)
          .replace('const diagnosticServer = draft.servers.find', 'const services = [...draft.servers, ...(publishedService ? [publishedService] : [])];\n      const diagnosticServer = services.find')
          .replace('?? draft.servers[0]', '?? services[0]')
          .replace('const editingServer = draft.servers[activeServer]', 'const editingServer = services[activeServer]')
          .replaceAll('draft.servers.map(', 'services.map(')
          .replace('!draft.servers.length &&', '!services.length &&')
          .replaceAll("server.serverName || server.id || '新服务器'", "server.platformComposition ? '工具组合编排' : (server.serverName || server.id || '新服务器')")
          .replace("<small>{server.id || '未设置 ID'} · {server.enabled === false ? '已停用' : '已启用'}</small>", "<small>{server.description || '未填写描述'} · {server.enabled === false ? '已停用' : '已启用'}</small>")
          .replace('{editingServer ? <div className="mcp-card">', '{editingServer ? editingServer.platformComposition ? <PublishedService service={editingServer} /> : <div className="mcp-card">')
          .replace('...(discovered[server.id] ?? [])', '...(server.platformComposition ? server.tools.names : discovered[server.id] ?? [])')
          .replace('<h2>MCP 服务器</h2>', '<h2>服务列表</h2>')
          .replace('<input value={value ?? \'\'} onChange={event => change(event.target.value)} {...props} />', "props.type === 'password' && !props.readOnly ? <PasswordInput value={value ?? ''} onChange={event => change(event.target.value)} {...props} /> : <input value={value ?? ''} onChange={event => change(event.target.value)} {...props} />")
          .replace('<section className="mcp-section"><h3>读取 Resource</h3>', `${toolEditor}<section className="mcp-section"><h3>读取 Resource</h3>`)
        contents = `import * as React from 'react'; import { createPortal } from 'react-dom'; import { PasswordInput, PublishedService } from ${JSON.stringify(resolve('src/mcp/components.tsx'))}; const { useEffect, useState } = React;\n${adapted}\nexport { Manager };`
      } else if (path.endsWith('openapi')) {
        const original = await readFile(resolve(managerSource, 'openapi.ts'), 'utf8')
        contents = `import { appendQueryParameter } from ${JSON.stringify(resolve('src/mcp/openapi.ts'))};\nfunction platformTimeout(server: any) { const timeout = AbortSignal.timeout(20_000); return server.platformSignal ? AbortSignal.any([server.platformSignal, timeout]) : timeout }\n${original.replaceAll('AbortSignal.timeout(20_000)', 'platformTimeout(server)').replace('const { response, credential } = await authorizedFetch(source.server', 'const server = source.server\n  const { response, credential } = await authorizedFetch(source.server').replace("if (parameter.in === 'query') for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(parameter.name, String(entry))", "if (parameter.in === 'query') appendQueryParameter(url.searchParams, parameter, value)")}\nexport { execute };`
      } else {
        contents = (await readFile(resolve(managerSource, 'index.ts'), 'utf8'))
          .replace("createRequire('/opt/dsh/packages/mcp/mcp-client/package.json')", "createRequire(process.env.HARNESS_DSH_ENTRY || import.meta.url)")
          .replace("const z = runtimeRequire", "const platformRequire = createRequire(import.meta.url)\nconst z = runtimeRequire")
          .replaceAll("runtimeRequire('@modelcontextprotocol/", "platformRequire('@modelcontextprotocol/")
          .replace("from './openapi.mjs'", "from './openapi.ts'")
          .replace('if (server.specUrl) {', 'if (server.platformComposition) {\n      if (!config.platformClient) throw new Error("已发布编排服务未装载")\n      server.platformClient = config.platformClient\n      continue\n    }\n    if (server.specUrl) {')
          .replace('const url = resolvedUrl(server)\n', 'if (server.platformComposition) return run(server.platformClient)\n  const url = resolvedUrl(server)\n')
          .replace('Boolean(server.specUrl || resolvedUrl(server))', 'Boolean(server.platformComposition || server.specUrl || resolvedUrl(server))')
          .replace('!(server.specUrl || resolvedUrl(server))', '!(server.platformComposition || server.specUrl || resolvedUrl(server))')
          .replace("if (request.action === 'test') {", `if (request.action === 'callTool') {
        if (typeof request.toolName !== 'string' || !request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments)) return send(res, 400, { error: '工具名称或参数无效' })
        const result = server.specUrl
          ? await callOpenApiTool(await loadOpenApi(server), request.toolName, request.arguments)
          : await withClient(server, client => client.callTool({ name: request.toolName, arguments: request.arguments }))
        return send(res, 200, result)
      }
      if (request.action === 'test') {`)
      }
      return { contents, loader: path.endsWith('client') ? 'tsx' : 'ts', resolveDir: managerSource }
    })
  },
}

const { name } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  loader: { '.svg': 'dataurl' },
  legalComments: 'none',
  plugins: [managerSources],
})
await build({ entryPoints: ['src/mcp/manager.ts'], outfile: 'lib/mcp-manager.js', bundle: true,
  platform: 'node', target: 'node24', format: 'esm', packages: 'external', plugins: [managerSources], legalComments: 'none' })
await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  loader: { '.svg': 'dataurl' },
  external: ['react', 'react/jsx-runtime', 'react-dom'],
  legalComments: 'none',
  plugins: [managerSources],
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;`,
  },
  footer: { js: 'return module.exports;}});' },
})
