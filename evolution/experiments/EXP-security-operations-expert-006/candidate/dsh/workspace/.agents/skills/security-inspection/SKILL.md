---
name: security-inspection
description: "通过专用子 Agent 查询巡检能力，或按 start、collect、finalize 执行一次即时巡检并返回真实报告。"
---

# 即时巡检

主 Agent 调用 `delegate_inspection`，只传递用户的原始巡检意图，并要求子 Agent 生成可直接回复用户的最终正文；不直接调用 inspection MCP 工具，也不在委派要求中新增证据表、内部 ID 或工具调用链。

巡检子 Agent 按以下顺序工作：

1. 用户明确要求一次常规全量即时巡检时，调用 `mcp__inspection__inspection_runs_start_with_plan`，参数为 `{"body":{"group_code":"routine","scope":{"type":"all"}}}`。
2. 保存返回的 `run_id`，用同一 ID 调用 `mcp__inspection__inspection_runs_collect_evidence`。
3. 仅当运行已可收口时，用同一 ID 调用 `mcp__inspection__inspection_runs_finalize`。
4. 根据最终工具结果生成一次用户可见正文；接口错误或尚未可收口时，分别说明真实状态，不补造结果。

用户只查询能力时调用 `mcp__inspection__inspection_capabilities_list`。本路线不创建计划任务，不调用 Shell、文件或其他网络能力替代巡检服务。

## 返回格式

完成巡检时按以下顺序输出简洁中文 Markdown：

1. 首行标题概括完成状态或最重要结论。
2. `finalize` 返回真实报告 URL 时，以 Markdown 链接原样保留 URL，并紧接标题、置于摘要之前；没有 URL 时不得编造占位链接。
3. 固定使用“结论”“关键结果”“建议”“巡检概况”四段；建议必须明确尚未执行。
4. `user_response_markdown` 是事实来源文本，不是必须逐字粘贴的展示模板。只重排其中已有事实，不改变含义或数值；将数量、状态和未知项写入对应结果，不另设独立的工具证据板块。
5. 数量、状态和时间必须与工具字段逐项一致；工具未明确说明集合或计算关系时，不得自行相加、去重、推导，或用分项解释汇总值。此类计数必须各自独立列点，禁止使用“其中”等暗示归属关系的连接词，并在相邻位置明确关系未知。

默认不展示 `run_id`、`report_id`、`result_digest`、工具调用链或委派元数据，除非用户明确询问或需要定位失败。子 Agent 返回后，主 Agent 直接复用这份用户可见正文，不再套用其他报告模板；仅在正文与本轮工具结果明显矛盾时做必要校正。
