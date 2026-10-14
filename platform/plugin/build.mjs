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
        const toolEditor = `<section className="mcp-section"><h3>调用工具</h3><div className="mcp-fields"><label className="mcp-field">工具<select value={toolName} onChange={event => setToolName(event.target.value)}><option value="">请选择工具</option>{(catalog.data.tools ?? []).map(tool => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></label><label className="mcp-field mcp-wide">调用参数 JSON{input(argumentsText, setArgumentsText)}</label></div><div className="mcp-actions">{button('测试工具', () => callTool('callTool'), busy || !toolName)}</div></section>`
        contents = `import * as React from 'react'; const { useEffect, useState } = React;\n${original.slice(start, end).replaceAll("当前实例的 MCP 配置", "平台 MCP 配置").replaceAll("修改后保存到 Web profile，再新建会话验证连接和工具发现。", "保存服务器与工具分组配置后，在调试页验证连接；已发布入口读取已保存配置。").replace("const [page, setPage] = useState('servers')", "const [page, setPage] = useState('servers'); useEffect(() => { if (['servers', 'groups', 'connection'].includes(view)) setPage(view) }, [view])").replace('<section className="mcp-section"><h3>读取 Resource</h3>', `${toolEditor}<section className="mcp-section"><h3>读取 Resource</h3>`)}\nexport { Manager };`
      } else if (path.endsWith('openapi')) {
        const original = await readFile(resolve(managerSource, 'openapi.ts'), 'utf8')
        contents = `function platformTimeout(server: any) { const timeout = AbortSignal.timeout(20_000); return server.platformSignal ? AbortSignal.any([server.platformSignal, timeout]) : timeout }\n${original.replaceAll('AbortSignal.timeout(20_000)', 'platformTimeout(server)').replace('const { response, credential } = await authorizedFetch(source.server', 'const server = source.server\n  const { response, credential } = await authorizedFetch(source.server')}\nexport { execute };`
      } else {
        contents = (await readFile(resolve(managerSource, 'index.ts'), 'utf8'))
          .replace("createRequire('/opt/dsh/packages/mcp/mcp-client/package.json')", "createRequire(process.env.HARNESS_DSH_ENTRY || import.meta.url)")
          .replace("const z = runtimeRequire", "const platformRequire = createRequire(import.meta.url)\nconst z = runtimeRequire")
          .replaceAll("runtimeRequire('@modelcontextprotocol/", "platformRequire('@modelcontextprotocol/")
          .replace("from './openapi.mjs'", "from './openapi.ts'")
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
