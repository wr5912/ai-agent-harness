export type HomeMode = 'build' | 'evaluate' | 'improve'
export const PLATFORM_SLOGAN = '让智能体真正可用，持续变好。'
export const HOME_SUBTITLE = '描述你希望它完成的任务，平台协助接入工具、构建能力、验证效果，并根据评测结果持续改进。'
export const BUILD_PLACEHOLDER = '帮我构建一个行业情报智能体，每天收集 AI 行业动态，提炼重要进展，生成附有来源链接的简报。'
export const HOME_MODES = [
  { id: 'build', label: '构建业务智能体', action: '开始任务' },
  { id: 'evaluate', label: '评测已有智能体', action: '开始评测' },
  { id: 'improve', label: '改进优化任务', action: '开始改进' },
] as const
export const DEMO_AGENT = 'daily-inspection-assistant'
export const DEMO_CASE = 'U-ASSET-PAGES-001'
export const DEMO_BUILD_PROMPT = '帮我构建一个基础台账整理智能体。只整理用户提供的模拟资产清单，不连接外部设备：DEMO-01、DEMO-02、DEMO-03、DEMO-04、DEMO-05 的状态均为“台账已记录”。请生成包含全部设备和数量汇总的 Markdown 报告，明确它不是实时设备健康检测。先复用已有能力，配置业务测试，实际评测后交付可使用的实例与报告。'

/** 入口只决定任务目标；执行继续使用既有助手提案、真实工具与确认机制。 */
export function homeTaskRequest(mode: HomeMode, prompt: string): { prompt: string; context: Record<string, unknown> } {
  const task = prompt.trim()
  if (mode === 'build') {
    if (!task) throw new Error('请先描述希望智能体完成的业务任务。')
    return { prompt: task, context: { page: 'home', skill: 'task-builder', workflow: 'build', entry_intent: 'build' } }
  }
  if (mode === 'evaluate') {
    return { prompt: task || '请先查询当前工作区的智能体、版本、已有测试用例和运行记录，帮助我确定评测目标。先利用已有信息，仍有歧义时集中询问必要信息；明确并固定来源版本、测试用例和评判口径，说明环境与执行范围，经整体确认后开展真实评测，保存并解释实际结果。缺少用例或运行条件时先说明，不将预览当作评测通过。', context: {
      page: 'home', skill: 'agent-maintenance', workflow: 'evaluation', entry_intent: 'evaluate',
    } }
  }
  return { prompt: task || '请先查询当前工作区的智能体、已有能力和运行记录，帮助我确定值得改进或优化的任务。先利用已有信息，仍有歧义时集中询问必要信息；固定来源版本、原始证据与评判口径，提出明确的目标、评测、执行范围和预算后，再请求整体确认。在最多 3 轮“分析问题→修改→复测”内改进，条件不足或达到预算时如实停止。', context: {
    page: 'home', skill: 'task-builder', workflow: 'improvement', entry_intent: 'improve',
    max_repair_rounds: 3,
  } }
}
