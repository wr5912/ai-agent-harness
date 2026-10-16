import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ThreatBindings, ThreatStage } from './extension.ts'
export type { ThreatBindings, ThreatStage } from './extension.ts'

export type CompositionStep = { id: string; compositionId: string; versionId: string; inputMap: Record<string, unknown>; when?: 'always' | 'five_source' | 'claimed' | 'completed' }
export type CompositionConfig = {
  toolName: string; title: string; description: string; connectionId: string; flow?: 'soc-asset-alerts'; alertsConnectionId?: string
  kind?: 'threat-stage' | 'composite'; stage?: ThreatStage; bindings?: ThreatBindings; steps?: CompositionStep[]
}
export type CompositionVersion = { versionId: string; publishedAt?: string; config: CompositionConfig }
export type CompositionEntry = { id: string; draft?: CompositionConfig; published?: CompositionConfig & { publishedAt?: string }; versions?: CompositionVersion[]; publishedVersionId?: string }
export type Catalog = { schema_version: '1.0'; compositions: CompositionEntry[] }

export const COMPOSITION_SERVICE_ID = 'platform-compositions'
export function publishedCompositionService(catalog: Catalog, available: Catalog = catalog) {
  // 已保存分组引用服务身份；扩展装载前可暂时没有可调用工具，不能让服务 ID 消失。
  if (!catalog.compositions.some(entry => entry.published)) return undefined
  const publishedTools = available.compositions.flatMap(entry => entry.published ? [entry.published] : [])
  return { id: COMPOSITION_SERVICE_ID, serverName: 'compositions', description: '工具组合编排（已发布）',
    enabled: true, platformComposition: true, publishedTools,
    tools: { mode: 'all', names: publishedTools.map(tool => tool.toolName) } }
}

export function compositionConfig(value: any): CompositionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('编排配置无效')
  const { toolName, title, description, flow, alertsConnectionId, kind, stage } = value
  const connectionId = value.connectionId ?? (kind ? COMPOSITION_SERVICE_ID : undefined)
  if (typeof toolName !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(toolName)) throw new Error('工具名称须为 1–64 位字母、数字、点、横线或下划线')
  if (typeof title !== 'string' || !title.trim() || title.length > 80) throw new Error('编排标题须为 1–80 个字符')
  if (typeof description !== 'string' || description.length > 500) throw new Error('工具说明须不超过 500 个字符')
  if (typeof connectionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(connectionId)) throw new Error('请选择 OpenAPI 服务器')
  if (kind !== undefined && kind !== 'threat-stage' && kind !== 'composite') throw new Error('组合类型无效')
  const base = { toolName, title: title.trim(), description, connectionId }
  if (kind === 'threat-stage') {
    if (!['collect', 'infer', 'writeback', 'report'].includes(stage)) throw new Error('威胁分析阶段无效')
    const binding = value.bindings
    if (!binding || ![binding.socConnectionId, binding.reportConnectionId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('请选择 SOC 与报告连接')
    const bindings: ThreatBindings = { socConnectionId: binding.socConnectionId, reportConnectionId: binding.reportConnectionId }
    if (binding.model !== undefined) {
      if (!binding.model || !['provider', 'model'].every(key => typeof binding.model[key] === 'string' && binding.model[key].trim())) throw new Error('模型路由无效')
      if (binding.model.reasoningEffort !== undefined && typeof binding.model.reasoningEffort !== 'string') throw new Error('推理强度无效')
      bindings.model = { provider: binding.model.provider, model: binding.model.model, ...(binding.model.reasoningEffort !== undefined ? { reasoningEffort: binding.model.reasoningEffort } : {}) }
    }
    return { ...base, kind, stage, bindings }
  }
  if (kind === 'composite') {
    if (!Array.isArray(value.steps) || !value.steps.length) throw new Error('请选择子组合')
    const ids = new Set<string>()
    const steps = value.steps.map((step: any): CompositionStep => {
      if (!step || typeof step.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(step.id) || ids.has(step.id)) throw new Error('子步骤 ID 无效或重复')
      if (['input', 'stepValues', 'latest', 'trace', 'receipts', 'errors'].includes(step.id) || Object.hasOwn(Object.prototype, step.id)) throw new Error('子步骤 ID 不能使用图状态保留字段')
      ids.add(step.id)
      if (typeof step.compositionId !== 'string' || !/^[a-z0-9-]{1,80}$/.test(step.compositionId) || typeof step.versionId !== 'string') throw new Error('子组合版本引用无效')
      if (!step.inputMap || typeof step.inputMap !== 'object' || Array.isArray(step.inputMap)) throw new Error('子组合参数映射无效')
      if (step.when !== undefined && !['always', 'five_source', 'claimed', 'completed'].includes(step.when)) throw new Error('子组合执行条件无效')
      return { id: step.id, compositionId: step.compositionId, versionId: step.versionId, inputMap: step.inputMap, ...(step.when ? { when: step.when } : {}) }
    })
    return { ...base, kind, steps }
  }
  if (flow !== undefined && flow !== 'soc-asset-alerts') throw new Error('接口流程无效')
  if (flow && (typeof alertsConnectionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(alertsConnectionId))) throw new Error('请选择告警 OpenAPI 服务器')
  return { ...base, ...(flow ? { flow, alertsConnectionId } : {}) }
}

export function compositionVersionId(config: CompositionConfig) {
  return createHash('sha256').update(JSON.stringify(compositionConfig(config))).digest('hex')
}

export function versionConfig(catalog: Catalog, compositionId: string, versionId: string): CompositionConfig {
  const version = catalog.compositions.find(entry => entry.id === compositionId)?.versions?.find(item => item.versionId === versionId)
  if (!version) throw new Error('子组合已发布版本不存在，请选择具体版本')
  return version.config
}

export function publishCompositionVersion(entry: CompositionEntry, config: CompositionConfig) {
  const versionId = compositionVersionId(config)
  const publishedAt = new Date().toISOString()
  entry.versions ??= []
  if (!entry.versions.some(version => version.versionId === versionId)) entry.versions.push({ versionId, publishedAt, config: compositionConfig(config) })
  entry.published = { ...compositionConfig(config), publishedAt }
  entry.publishedVersionId = versionId
  delete entry.draft
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
    const versions = new Set<string>()
    for (const version of entry.versions ?? []) {
      if (!version || version.versionId !== compositionVersionId(version.config) || versions.has(version.versionId)) throw new Error('不可变组合版本无效或重复')
      versions.add(version.versionId)
    }
    if (entry.publishedVersionId && (!entry.published || entry.publishedVersionId !== compositionVersionId(entry.published) || !versions.has(entry.publishedVersionId))) throw new Error('当前发布版本指针无效')
  }
}

export function readCompositions(file: string) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : JSON.stringify({ schema_version: '1.0', compositions: [] })
  const catalog = JSON.parse(text) as Catalog
  validateCatalog(catalog)
  // 旧目录只有 published；派生一个初始版本，保存时再物化，不改变旧 published 内容。
  for (const entry of catalog.compositions) if (entry.published && !entry.publishedVersionId) {
    entry.publishedVersionId = compositionVersionId(entry.published)
    entry.versions ??= []
    if (!entry.versions.some(version => version.versionId === entry.publishedVersionId)) entry.versions.push({ versionId: entry.publishedVersionId, publishedAt: entry.published.publishedAt, config: compositionConfig(entry.published) })
  }
  return { catalog, revision: createHash('sha256').update(text).digest('hex') }
}

export function writeCompositions(file: string, catalog: Catalog, expectedRevision: unknown) {
  const previous = readCompositions(file)
  if (previous.revision !== expectedRevision) throw new Error('编排目录已变化，请刷新后重试；当前草稿未覆盖')
  validateCatalog(catalog)
  for (const entry of previous.catalog.compositions) for (const version of entry.versions ?? []) {
    const retained = catalog.compositions.find(item => item.id === entry.id)?.versions?.find(item => item.versionId === version.versionId)
    if (!retained || JSON.stringify(retained.config) !== JSON.stringify(version.config)) throw new Error('已发布组合版本不可修改或移除')
  }
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
