/** 决策输入与监督目标共用的可执行合同；不包含 Node 依赖，可由界面直接校验。 */
export type DecisionQuestion = { type: 'choice' | 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }
export type DecisionTask = { id: string; semantics: 'recommended_decision' | 'observed_action' }
export type DecisionTarget = { label: string | boolean | number; probabilities?: Record<string, number>; provenance: Record<string, any>; basis: string; status: 'suggested' | 'reviewed' | 'rejected'; decision_time_reviewed: boolean; reviewed_at?: string | null }
export const DECISION_SPLITS = ['unassigned', 'train', 'development', 'calibration', 'test'] as const
export const DECISION_EXTRACTION_CONTRACT = {
  schema_version: 2,
  preview: {
    required_fields: ['run_id', 'path', 'source_sha256', 'samples'],
    source_path: '一个预览仅针对所选 Run 的同一条 path；所有 samples 的 decision_id 必须来自该 path 的决策分页，不得混入其他文件。',
    samples_max: 40,
    skipped: { optional: true, type: 'string[]', max_items: 100, max_item_length: 2000, instructions: '每项必须为非空跳过原因字符串；不接受对象数组或字典，不提供时视为空数组。' },
  },
  sample_fields: ['decision_id', 'action_name', 'workflow', 'task', 'questions', 'targets'],
  workflow: '非空业务流程名称，最多 200 字符',
  task: { id: '稳定的业务任务标识，最多 200 字符', semantics: ['recommended_decision', 'observed_action'] },
  questions: '一个或多个命名问题，键为 1–80 位英文、数字、下划线或短横线；每题含 type、instructions、criteria（noul 可省略）',
  targets: '与 questions 键精确对应；每题含 label、basis，可选 probabilities；输入不含标签、来源或审核信息',
  types: { choice: 'criteria 为至少两个不同说明的候选映射，label 精确匹配候选键', noul: 'label 为布尔值；criteria 如提供，仅有 false/true', score: 'criteria 为有序且不同的等级说明，label 为从 0 开始的等级索引' },
  probabilities: '可选完整概率映射，choice 使用候选键，noul 使用 false/true，score 使用等级索引字符串；全部有限且位于 [0,1]，总和与 1 的误差不超过 1e-5（不改写原始概率），label 位于最大概率集合；硬标签不自动补 one-hot',
  provenance: '预览仅产生未经校准的 model_suggestion，服务器固定 Session/模型/技能来源；不得自称人工标注、教师聚合或 reviewed。observed_action 语义仅保存与真实动作名一致的 choice 硬标签，来源由服务器固定。',
  state: '由服务器从当前决策前材料生成；不得加入当前动作、后果、标签或不可见回复。逐题人工复核须确认输入足以回答问题。',
  export: '仅新版、来源仍有效、逐题 reviewed 且完成决策时点核对的显式 split 可导出；unassigned 不进入训练。旧格式只读候选。',
} as const

function error(message: string): never { throw new Error(message) }
function map(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : error('需要 JSON 对象') }
export function decisionText(value: unknown, name: string, max = 6000): string { return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : error(`${name} 为空或过长`) }
function exactKeys(value: Record<string, any>, allowed: string[], name: string) { if (Object.keys(value).some(key => !allowed.includes(key))) error(`${name} 含有输入与目标合同之外的字段`) }
export function validateDecisionInputQuestion(raw: unknown): DecisionQuestion {
  const value = map(raw), type = value.type
  exactKeys(value, ['type', 'instructions', 'criteria'], 'question')
  if (!['choice', 'noul', 'score'].includes(type)) error('题型必须是 choice、noul 或 score')
  const result: DecisionQuestion = { type, instructions: decisionText(value.instructions, 'instructions') }
  if (type === 'choice') {
    const criteria = map(value.criteria), keys = Object.keys(criteria)
    if (keys.length < 2 || keys.length > 32 || keys.some(key => !key.trim() || key.length > 200 || ['__proto__', 'prototype', 'constructor'].includes(key))) error('choice 至少需要两个有效候选')
    const entries = keys.map(key => [key, decisionText(criteria[key], '候选说明', 2000)] as const)
    if (new Set(entries.map(([, description]) => description)).size !== keys.length) error('候选说明不能重复')
    result.criteria = Object.fromEntries(entries)
  } else if (type === 'noul') {
    if (value.criteria !== undefined) {
      const criteria = map(value.criteria)
      if (Object.keys(criteria).sort().join(',') !== 'false,true') error('noul criteria 只能包含 false 和 true')
      result.criteria = { false: decisionText(criteria.false, 'false 说明'), true: decisionText(criteria.true, 'true 说明') }
    }
  } else {
    if (!Array.isArray(value.criteria) || value.criteria.length < 2 || value.criteria.length > 32) error('score 需要有序等级列表')
    const criteria: string[] = value.criteria.map((entry: unknown) => decisionText(entry, '等级说明', 2000))
    if (new Set(criteria).size !== criteria.length) error('score 等级说明不能重复')
    result.criteria = criteria
  }
  return result
}
export function validateDecisionTask(raw: unknown): DecisionTask {
  const value = map(raw)
  exactKeys(value, ['id', 'semantics'], 'task')
  if (!['recommended_decision', 'observed_action'].includes(value.semantics)) error('task.semantics 必须明确区分推荐决策与观察动作')
  return { id: decisionText(value.id, 'task.id', 200), semantics: value.semantics }
}
export function validateDecisionLabel(question: DecisionQuestion, raw: unknown): { label: string | number | boolean; probabilities?: Record<string, number> } {
  const value = map(raw), label = value.label
  let keys: string[]
  if (question.type === 'choice') { keys = Object.keys(question.criteria!); if (typeof label !== 'string' || !Object.hasOwn(question.criteria!, label)) error('label 必须精确匹配候选键') }
  else if (question.type === 'noul') { keys = ['false', 'true']; if (typeof label !== 'boolean') error('noul label 必须是布尔值') }
  else { keys = (question.criteria as string[]).map((_, index) => String(index)); if (!Number.isInteger(label) || label < 0 || label >= keys.length) error('score label 超出等级范围') }
  const result = { label } as { label: string | number | boolean; probabilities?: Record<string, number> }
  if (value.probabilities !== undefined) {
    const probabilities = map(value.probabilities)
    if (Object.keys(probabilities).sort().join('\u0000') !== [...keys].sort().join('\u0000')) error('probabilities 必须精确覆盖全部候选或等级')
    const values = keys.map(key => probabilities[key])
    if (values.some(item => typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) || Math.abs(values.reduce((sum, item) => sum + item, 0) - 1) > 1e-5) error('probabilities 必须为有限的 0–1 概率且总和为 1')
    if (probabilities[String(label)] < Math.max(...values) - 1e-9) error('label 必须位于最大概率候选集合')
    result.probabilities = Object.fromEntries(keys.map(key => [key, probabilities[key]]))
  }
  return result
}
export function validateDecisionQuestions(raw: unknown): Record<string, DecisionQuestion> {
  const value = map(raw), keys = Object.keys(value)
  if (!keys.length || keys.length > 32 || keys.some(key => !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))) error('questions 需要 1–32 个有效命名问题')
  return Object.fromEntries(keys.map(key => [key, validateDecisionInputQuestion(value[key])]))
}
export function validateDecisionTargets(questions: Record<string, DecisionQuestion>, raw: unknown): Record<string, DecisionTarget> {
  const value = map(raw), keys = Object.keys(questions)
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) error('questions 与 targets 的命名键必须精确对应')
  return Object.fromEntries(keys.map(key => {
    const target = map(value[key]), provenance = map(target.provenance)
    if (!['model_suggestion', 'human_annotation', 'observed_action'].includes(provenance.kind)) error('标签来源必须是可核对的模型建议、人工标注或观察动作；本版本不支持教师聚合来源')
    if (!['suggested', 'reviewed', 'rejected'].includes(target.status) || typeof target.decision_time_reviewed !== 'boolean') error('逐题复核状态或决策时点声明无效')
    if (target.status === 'reviewed' && target.decision_time_reviewed !== true) error('请先人工核对该题与当前决策及决策前材料一致')
    return [key, { ...validateDecisionLabel(questions[key]!, target), provenance, basis: decisionText(target.basis, 'basis'), status: target.status, decision_time_reviewed: target.status === 'reviewed' && target.decision_time_reviewed === true, ...(target.reviewed_at !== undefined ? { reviewed_at: target.reviewed_at } : {}) }]
  }))
}
