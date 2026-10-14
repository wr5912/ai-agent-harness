import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type CompositionConfig = { toolName: string; title: string; description: string; connectionId: string; flow?: 'soc-asset-alerts'; alertsConnectionId?: string }
export type CompositionEntry = { id: string; draft?: CompositionConfig; published?: CompositionConfig & { publishedAt?: string } }
type Catalog = { schema_version: '1.0'; compositions: CompositionEntry[] }

export const COMPOSITION_SERVICE_ID = 'platform-compositions'
export function publishedCompositionService(catalog: Catalog) {
  const publishedTools = catalog.compositions.flatMap(entry => entry.published ? [entry.published] : [])
  if (!publishedTools.length) return undefined
  return { id: COMPOSITION_SERVICE_ID, serverName: 'compositions', description: '工具组合编排（已发布）',
    enabled: true, platformComposition: true, publishedTools,
    tools: { mode: 'all', names: publishedTools.map(tool => tool.toolName) } }
}

export function compositionConfig(value: any): CompositionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('编排配置无效')
  const { toolName, title, description, connectionId, flow, alertsConnectionId } = value
  if (typeof toolName !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(toolName)) throw new Error('工具名称须为 1–64 位字母、数字、点、横线或下划线')
  if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new Error('编排标题须为 1–80 个字符')
  if (typeof description !== 'string' || description.length > 500) throw new Error('工具说明须不超过 500 个字符')
  if (typeof connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(connectionId)) throw new Error('请选择 OpenAPI 服务器')
  if (flow !== undefined && flow !== 'soc-asset-alerts') throw new Error('接口流程无效')
  if (flow && (typeof alertsConnectionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(alertsConnectionId))) throw new Error('请选择告警 OpenAPI 服务器')
  return { toolName, title: title.trim(), description, connectionId, ...(flow ? { flow, alertsConnectionId } : {}) }
}

function validateCatalog(catalog: Catalog) {
  if (catalog.schema_version !== '1.0' || !Array.isArray(catalog.compositions)) throw new Error('编排目录格式无效')
  const ids = new Set<string>()
  const names = new Map<string, string>()
  for (const entry of catalog.compositions) {
    if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(entry.id) || ids.has(entry.id) || (!entry.draft && !entry.published)) throw new Error('编排 ID 无效、重复或没有版本')
    ids.add(entry.id)
    for (const config of [entry.draft, entry.published].filter(Boolean)) {
      const valid = compositionConfig(config)
      if (names.has(valid.toolName) && names.get(valid.toolName) !== entry.id) throw new Error(`工具名称已被另一编排使用：${valid.toolName}`)
      names.set(valid.toolName, entry.id)
    }
  }
}

export function readCompositions(file: string) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : JSON.stringify({ schema_version: '1.0', compositions: [] })
  const catalog = JSON.parse(text) as Catalog
  validateCatalog(catalog)
  return { catalog, revision: createHash('sha256').update(text).digest('hex') }
}

export function writeCompositions(file: string, catalog: Catalog, expectedRevision: unknown) {
  if (readCompositions(file).revision !== expectedRevision) throw new Error('编排目录已变化，请刷新后重试；当前草稿未覆盖')
  validateCatalog(catalog)
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(catalog, null, 2) + '\n')
  renameSync(temp, file)
}

export function selectedComposition(catalog: Catalog, selection: any): CompositionConfig {
  if (!['draft', 'published'].includes(selection?.version)) throw new Error('请选择草稿或已发布版本')
  const config = catalog.compositions.find(entry => entry.id === selection.compositionId)?.[selection.version as 'draft' | 'published']
  if (!config) throw new Error('所选编排版本不存在')
  return config
}
