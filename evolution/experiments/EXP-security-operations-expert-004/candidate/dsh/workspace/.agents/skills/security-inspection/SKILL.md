---
name: security-inspection
description: "通过专用子 Agent 查询巡检能力，或按 start、collect、finalize 执行一次即时巡检并返回真实报告。"
---

# 即时巡检

主 Agent 调用 `delegate_inspection`，传递用户的原始巡检意图，不直接调用 inspection MCP 工具。

巡检子 Agent 按以下顺序工作：

1. 用户明确要求一次常规全量即时巡检时，调用 `mcp__inspection__inspection_runs_start_with_plan`，参数为 `{"body":{"group_code":"routine","scope":{"type":"all"}}}`。
2. 保存返回的 `run_id`，用同一 ID 调用 `mcp__inspection__inspection_runs_collect_evidence`。
3. 仅当运行已可收口时，用同一 ID 调用 `mcp__inspection__inspection_runs_finalize`。
4. 忠实返回最终报告；接口错误或尚未可收口时，分别说明真实状态，不补造结果。

用户只查询能力时调用 `mcp__inspection__inspection_capabilities_list`。本路线不创建计划任务，不调用 Shell、文件或其他网络能力替代巡检服务。
