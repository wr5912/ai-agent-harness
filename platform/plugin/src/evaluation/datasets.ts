import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RunFileError, redactRunText } from '../agents/run-files.ts'
import { buildDecisionSlices, loadRunTrace, listRunTraceSources, type DecisionSlice } from './trace.ts'

type MapValue = Record<string, any>
type Question = { type: 'choice' | 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[]; label: string | boolean | number; src: string }
type Sample = { state: unknown; questions: { decision: Question }; _meta: MapValue }
type Dataset = { id: string; run_id: string; path: string; source_sha256: string; created_at: string; extractor: MapValue; records: Sample[]; skipped: string[] }
const ID = /^decision-dataset-[0-9a-f-]{36}$/
const SPLITS = ['unassigned', 'train', 'development', 'calibration', 'test']
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
function normalized(value: any): any {
  if (typeof value === 'string') return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]))
  return value
}
function fail(message: string, code = 'invalid_dataset'): never { throw new RunFileError(code, message) }
function object(value: unknown): MapValue { return value && typeof value === 'object' && !Array.isArray(value) ? value as MapValue : fail('需要 JSON 对象') }
function text(value: unknown, name: string, max = 6000): string { return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail(`${name} 为空或过长`) }
function clean<T>(value: T): T { return JSON.parse(redactRunText(JSON.stringify(value))) }

export function validateDecisionQuestion(raw: unknown): Question {
  const value = object(raw)
  const type = value.type
  if (!['choice', 'noul', 'score'].includes(type)) fail('题型必须是 choice、noul 或 score')
  const result: Question = { type, instructions: text(value.instructions, 'instructions'), label: value.label, src: text(value.src, 'src', 200) }
  if (type === 'choice') {
    const criteria = object(value.criteria), keys = Object.keys(criteria)
    if (keys.length < 2 || keys.length > 32 || keys.some(key => !key.trim() || key.length > 200)) fail('choice 至少需要两个有效候选')
    const entries = keys.map(key => [key, text(criteria[key], '候选说明', 2000)] as const)
    if (new Set(entries.map(([, description]) => description)).size !== keys.length) fail('候选说明不能重复')
    if (typeof value.label !== 'string' || !Object.hasOwn(criteria, value.label)) fail('label 必须精确匹配候选键')
    result.criteria = Object.fromEntries(entries)
  } else if (type === 'noul') {
    if (typeof value.label !== 'boolean') fail('noul label 必须是布尔值')
    if (value.criteria !== undefined) {
      const criteria = object(value.criteria)
      if (Object.keys(criteria).sort().join(',') !== 'false,true') fail('noul criteria 只能包含 false 和 true')
      result.criteria = { false: text(criteria.false, 'false 说明'), true: text(criteria.true, 'true 说明') }
    }
  } else {
    if (!Array.isArray(value.criteria) || value.criteria.length < 2 || value.criteria.length > 32) fail('score 需要有序等级列表')
    const criteria: string[] = value.criteria.map((entry: unknown) => text(entry, '等级说明', 2000))
    result.criteria = criteria
    if (new Set(criteria).size !== criteria.length || !Number.isInteger(value.label) || value.label < 0 || value.label >= criteria.length) fail('score label 超出等级范围或等级重复')
  }
  if (JSON.stringify(clean(result)) !== JSON.stringify(result)) fail('题目包含凭据，请先移除')
  return result
}

function storage(root: string) {
  const base = resolve(root, 'evolution/datasets')
  for (const path of [resolve(root, 'evolution'), base]) if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('数据集目录不得是符号链接', 'path_rejected')
  return base
}
function fileFor(root: string, id: unknown) {
  if (typeof id !== 'string' || !ID.test(id)) fail('数据集 ID 无效')
  const path = join(storage(root), `${id}.json`)
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail('数据集不得通过符号链接读写', 'path_rejected')
  return path
}
function read(root: string, id: unknown) {
  const path = fileFor(root, id)
  if (!existsSync(path)) fail('数据集不存在', 'not_found')
  const content = readFileSync(path, 'utf8')
  if (content.length > 4 * 1024 * 1024) fail('数据集过大')
  const dataset = JSON.parse(content) as Dataset
  if (dataset.id !== id || !Array.isArray(dataset.records)) fail('数据集结构无效')
  return { dataset, sha256: digest(content) }
}
function all(root: string): Dataset[] {
  const base = storage(root)
  return existsSync(base) ? readdirSync(base).filter(name => name.endsWith('.json') && ID.test(name.slice(0, -5))).map(name => read(root, name.slice(0, -5)).dataset) : []
}
function write(root: string, dataset: Dataset, create = false) {
  const path = fileFor(root, dataset.id)
  mkdirSync(storage(root), { recursive: true })
  const content = JSON.stringify(clean(dataset), null, 2) + '\n'
  if (content.length > 4 * 1024 * 1024) fail('样本批次超过 4 MiB，请分批保存')
  if (create) writeFileSync(path, content, { flag: 'wx' })
  else { const temp = `${path}.${randomUUID()}.tmp`; writeFileSync(temp, content, { flag: 'wx' }); renameSync(temp, path) }
  return { dataset: clean(dataset), sha256: digest(content), file: `evolution/datasets/${dataset.id}.json` }
}
function stateOf(slice: DecisionSlice) {
  // 训练输入不含动作、后果、标签和来源位置；这些字段仅进入审核元数据。
  return clean({ messages: slice.state.messages.map(({ ref: _ref, ...message }) => message), available_tools: slice.state.available_tools ?? null })
}
function groupOf(slice: DecisionSlice) {
  const first = slice.state.messages.find(message => message.role === 'user')
  return `task-${digest(JSON.stringify(first?.content ?? slice.anchor.session_log).normalize('NFKC').replace(/\s+/g, ' ').trim()).slice(0, 24)}`
}
function contentHash(state: unknown, question: Question) {
  return digest(normalized([state, question.type, question.instructions, question.criteria ?? null]))
}
function identities(records: Sample[]) {
  return new Set(records.flatMap(record => [record._meta.id, `decision-${contentHash(record.state, record.questions.decision).slice(0, 32)}`]))
}

export function createDecisionDatasetHandler(root: string) {
  const previews = new Map<string, { dataset: Dataset; owner: string; created: number }>()
  async function slices(body: MapValue, signal?: AbortSignal) {
    const loaded = await loadRunTrace(root, { run_id: text(body.run_id, 'run_id'), path: text(body.path, 'path'), source_sha256: text(body.source_sha256, 'source_sha256') }, signal)
    return { loaded, decisions: buildDecisionSlices(loaded.events) }
  }
  return async function handle(endpoint: string, body: MapValue, signal?: AbortSignal): Promise<any> {
    signal?.throwIfAborted()
    if (endpoint === 'datasets/source') {
      const files = await listRunTraceSources(root, text(body.run_id, 'run_id'), signal)
      if (!body.path) return { run_id: body.run_id, files, instructions: '选择 target 业务轨迹的 path，读取决策分页；未知角色先核对。所有文件均需显式核对，不能把单文件结果称为完整 Run。' }
      const loaded = await loadRunTrace(root, { run_id: body.run_id, path: body.path, ...(body.source_sha256 ? { source_sha256: body.source_sha256 } : {}) }, signal)
      const decisions = buildDecisionSlices(loaded.events)
      const cursor = body.cursor ?? 0
      if (!Number.isInteger(cursor) || cursor < 0 || cursor > decisions.length) fail('决策分页 cursor 无效')
      const selected = decisions.slice(cursor, cursor + 3).map(slice => {
        const eligible = slice.eligible && Buffer.byteLength(JSON.stringify(slice.state)) <= 96 * 1024
        return { decision_id: slice.id, kind: slice.kind, anchor: slice.anchor, eligible, state: eligible ? stateOf(slice) : null, observed_action: slice.observed_action, outcome_refs: slice.outcome_refs, context_mode: slice.context_mode, limitations: [...slice.limitations, ...(!eligible && slice.eligible ? ['决策输入超过本轮 96 KiB 提取上限，不能截断成训练样本'] : [])] }
      })
      return { run_id: body.run_id, path: loaded.source.path, source_sha256: loaded.source_sha256, total_decisions: decisions.length, cursor, next_cursor: cursor + selected.length < decisions.length ? cursor + selected.length : null, decisions: selected, warnings: loaded.source.warnings }
    }
    if (endpoint === 'datasets/preview') {
      const { loaded, decisions } = await slices(body, signal)
      if (!Array.isArray(body.samples) || body.samples.length > 40) fail('samples 必须是最多 40 条的数组')
      const skipped = Array.isArray(body.skipped) ? body.skipped.map((reason: unknown) => text(reason, '跳过原因', 2000)).slice(0, 100) : []
      const existing = identities(all(root).flatMap(dataset => dataset.records))
      const records: Sample[] = []
      for (const raw of body.samples) {
        const draft = object(raw), slice = decisions.find(value => value.id === draft.decision_id)
        if (!slice?.eligible || Buffer.byteLength(JSON.stringify(slice.state)) > 96 * 1024) fail('决策不存在或材料不足，不能保存训练候选')
        if (draft.action_name !== slice.observed_action.name) fail('action_name 与所选决策的实际动作不一致，请重新核对 decision_id；工具查询前不能冒称已取得查询结果')
        const question = validateDecisionQuestion({ ...object(draft.question), src: `${loaded.source.path}:${slice.anchor.line}` }), state = stateOf(slice)
        const content_sha256 = contentHash(state, question)
        const id = `decision-${content_sha256.slice(0, 32)}`
        if (existing.has(id) || records.some(record => record._meta.id === id)) { skipped.push(`${slice.id}：相同题目已存在，保留既有人工内容`); continue }
        records.push({ state, questions: { decision: question }, _meta: {
          id, content_sha256, group_id: groupOf(slice), source: 'dsh_run', variant: 'clean', run_id: body.run_id,
          trace_path: loaded.source.path, trace_sha256: loaded.source_sha256, decision_id: slice.id, cutoff: slice.anchor,
          context_mode: slice.context_mode, evidence_refs: slice.context_refs, observed_action: slice.observed_action, outcome_refs: slice.outcome_refs,
          limitations: slice.limitations, label_status: 'suggested', label_basis: text(draft.label_basis, 'label_basis'), split: 'unassigned', decision_time_reviewed: false,
        } })
      }
      const skill = readFileSync(join(root, 'platform/skills/decision-sample-extraction/SKILL.md'), 'utf8')
      const owner = text(body.assistant_session_id, 'assistant_session_id')
      const dataset: Dataset = { id: `decision-dataset-${randomUUID()}`, run_id: body.run_id, path: loaded.source.path, source_sha256: loaded.source_sha256, created_at: new Date().toISOString(), extractor: { session_id: owner, model: clean(body.assistant_model ?? null), skill: 'decision-sample-extraction', skill_sha256: digest(skill), format: 'kev@85ccf56a0afb952323c621055b02876e8498d60c' }, records, skipped }
      for (const [key, value] of previews) if (Date.now() - value.created > 30 * 60_000) previews.delete(key)
      if (!records.length) return { count: 0, skipped, message: '没有可保存的候选；未创建数据集文件。' }
      const preview_id = randomUUID()
      previews.set(preview_id, { dataset, owner, created: Date.now() })
      return { preview_id, run_id: dataset.run_id, count: records.length, status: 'suggested', records, skipped, file: `evolution/datasets/${dataset.id}.json`, message: '确认后保存候选，训练导出仍需逐条人员复核。' }
    }
    if (endpoint === 'datasets/apply') {
      const preview = previews.get(body.preview_id)
      if (!preview || preview.owner !== body.assistant_session_id || Date.now() - preview.created > 30 * 60_000) fail('预览已失效，请重新抽取', 'conflict')
      await loadRunTrace(root, { run_id: preview.dataset.run_id, path: preview.dataset.path, source_sha256: preview.dataset.source_sha256 }, signal)
      const existing = identities(all(root).flatMap(dataset => dataset.records))
      if (preview.dataset.records.some(record => existing.has(record._meta.id))) fail('相同题目已被其他任务保存，请重新抽取', 'conflict')
      const saved = write(root, preview.dataset, true)
      previews.delete(body.preview_id)
      return saved
    }
    if (endpoint === 'datasets/list') return { datasets: all(root).filter(dataset => !body.run_id || dataset.run_id === body.run_id).map(dataset => ({ id: dataset.id, run_id: dataset.run_id, created_at: dataset.created_at, count: dataset.records.length, reviewed: dataset.records.filter(record => record._meta.label_status === 'reviewed').length })) }
    if (endpoint === 'datasets/read') return read(root, body.dataset_id)
    if (endpoint === 'datasets/update') {
      const current = read(root, body.dataset_id)
      if (current.sha256 !== body.expected_sha256) fail('样本已被其他任务修改，当前草稿需重新核对', 'conflict')
      const record = current.dataset.records.find(item => item._meta.id === body.record_id)
      if (!record) fail('样本不存在', 'not_found')
      const question = validateDecisionQuestion({ ...object(body.question), src: `${record._meta.trace_path}:${record._meta.cutoff.line}` })
      const group = text(body.group_id, 'group_id', 200), split = text(body.split, 'split', 30)
      if (!SPLITS.includes(split) || !['suggested', 'reviewed', 'rejected'].includes(body.label_status)) fail('复核状态或划分用途无效')
      if (body.label_status === 'reviewed' && body.decision_time_reviewed !== true) fail('请先人工核对题目、候选和标签依据与当前决策及决策前材料一致')
      const others = all(root).flatMap(dataset => dataset.records).filter(item => item._meta.id !== body.record_id)
      const content_sha256 = contentHash(record.state, question)
      if (identities(others).has(`decision-${content_sha256.slice(0, 32)}`)) fail('相同内容的题目已存在，请保留一条并合并复核', 'conflict')
      if (split !== 'unassigned' && others.some(item => item._meta.group_id === group && item._meta.split !== 'unassigned' && item._meta.split !== split)) fail('同一任务分组不能跨训练、开发、校准与测试用途')
      record.questions = { decision: question }
      record._meta = { ...record._meta, content_sha256, group_id: group, split, label_status: body.label_status, label_basis: text(body.label_basis, 'label_basis'), decision_time_reviewed: body.label_status === 'reviewed' && body.decision_time_reviewed === true, reviewed_at: body.label_status === 'reviewed' ? new Date().toISOString() : null }
      return write(root, current.dataset)
    }
    if (endpoint === 'datasets/export') {
      const { dataset } = read(root, body.dataset_id)
      if (body.kind !== undefined && !['candidates', 'training'].includes(body.kind)) fail('导出类型必须是 candidates 或 training')
      const candidates = body.kind === 'candidates'
      // 分组内未分配记录同样服从已有留出用途，不能混入训练下载。
      const heldOutGroups = new Set(all(root).flatMap(item => item.records).filter(record => ['development', 'calibration', 'test'].includes(record._meta.split)).map(record => record._meta.group_id))
      const records = dataset.records.filter(record => candidates ? record._meta.label_status !== 'rejected' : record._meta.label_status === 'reviewed' && record._meta.decision_time_reviewed === true && ['train', 'unassigned'].includes(record._meta.split) && !heldOutGroups.has(record._meta.group_id))
      if (!records.length) fail(candidates ? '没有可导出的候选样本' : '尚无人员复核且完成决策时点核对的训练样本；开发、校准、测试分组及同组未分配记录均不进入训练下载')
      records.forEach(record => validateDecisionQuestion(record.questions.decision))
      return { filename: `${dataset.id}-${candidates ? 'candidates' : 'reviewed-training'}.jsonl`, count: records.length, content: records.map(record => JSON.stringify(clean({ ...record, _meta: { ...record._meta, extractor: dataset.extractor } }))).join('\n') + '\n' }
    }
    fail('未知数据集操作', 'not_found')
  }
}
