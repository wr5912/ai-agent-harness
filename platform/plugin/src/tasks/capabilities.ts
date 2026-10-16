import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as yaml } from 'js-yaml'
import { candidateDigest, candidateFiles, sourceInfo } from './files.ts'
import { workspaceConfigPath } from '../workspace.ts'

export interface CapabilityOptions {
  nativeServers?: () => any[]
  signal?: AbortSignal
}

/** 动态读取当前资产及原生 MCP 配置，只报告已发现事实，不把配置等同于可用性。 */
export async function discoverTaskCapabilities(assetRoot: string, options: CapabilityOptions = {}) {
  options.signal?.throwIfAborted()
  const catalog = JSON.parse(readFileSync(workspaceConfigPath(assetRoot, 'sources.json'), 'utf8'))
  const sources = []
  const unavailable = []
  for (const id of Object.keys(catalog.sources ?? {}).sort()) {
    options.signal?.throwIfAborted()
    try {
      const info = sourceInfo(assetRoot, id)
      const files = candidateFiles(info.candidate)
      const skills = files.filter(path => path.endsWith('/SKILL.md')).map(path => ({ path, name: path.split('/').at(-2), verification: 'discovered' as const }))
      function names(value: unknown): string[] {
        if (Array.isArray(value)) return value.flatMap(names)
        if (!value || typeof value !== 'object') return []
        const row = value as Record<string, unknown>
        return [...(typeof row.name === 'string' ? [row.name] : []), ...Object.values(row).flatMap(names)]
      }
      const plugins = files.filter(path => /(?:\.patch\.yml|\.cordis\.yml|package\.json)$/.test(path)).map(path => {
        try {
          const body = readFileSync(join(info.candidate, path), 'utf8')
          const parsed = path.endsWith('.json') ? JSON.parse(body) : yaml(body)
          return { path, name: typeof parsed?.name === 'string' ? parsed.name : path.split('/').at(-1), plugin_names: [...new Set(names(parsed))], verification: 'discovered' as const }
        } catch { return { path, name: path.split('/').at(-1), verification: 'invalid' as const } }
      })
      sources.push({ source: info.source, experiment_id: id, agent_id: info.agent_id,
        candidate_sha256: candidateDigest(info.candidate), skills, plugins, preset: info.entry.preset,
        required_env_names: info.entry.required_env_names ?? [] })
    } catch { unavailable.push({ source: `experiment:${id}`, reason: '来源登记或资产不可读取' }) }
  }
  const mcp = (options.nativeServers?.() ?? []).map(server => ({
    id: String(server.id ?? ''), enabled: server.enabled !== false,
    transport: server.specUrl ? 'openapi' : String(server.transport ?? 'streamable-http'),
    tools: Array.isArray(server.tools?.names) ? server.tools.names.filter((value: unknown) => typeof value === 'string') : [],
    verification: 'configured' as const,
  }))
  return { observed_at: new Date().toISOString(), sources, mcp, unavailable,
    note: '已发现或已配置不表示已装载、已调用或通过当前任务验证。工具接入优先使用原生 MCP 配置管理。' }
}
