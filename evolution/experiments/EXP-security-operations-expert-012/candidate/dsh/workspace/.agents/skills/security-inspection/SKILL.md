---
name: security-inspection
description: "查询可用巡检能力，创建一次巡检运行，分片取证并生成真实报告。"
---

# 安全巡检

主 Agent 直接使用 `mcp__inspection__`。读取工具 `content[0].text` 中的 JSON 业务结果；不能只凭 MCP 调用成功就声称巡检完成。

1. 用户只问可用巡检项时，仅调用无参数的 `mcp__inspection__inspection_capabilities_list`，按本轮返回的能力名称及所属组回答；不发起运行。目录为空或失败时如实说明。
2. 用户要求常规全量巡检时，调用 `mcp__inspection__inspection_runs_start_with_plan`，`body` 传 `{}`，由服务端采用默认 `routine` 组、全量范围和默认能力；不要猜能力 ID。只有用户指定能力或参数时才先查询目录并按返回的 Schema 选定能力。用户指定资产而工具合同未明确限定资产范围格式时，不猜 `scope`，先说明无法安全发起。
3. 保存服务返回的 `runId`。对同一运行逐次调用 `mcp__inspection__inspection_runs_collect_evidence`，依照每次返回的覆盖率、状态和 `next_action` 继续；只在服务提示所有取证项已进入终态后调用 `mcp__inspection__inspection_runs_finalize`。取证中不得重复发起；本轮未结束就如实报告状态及 `runId`，在同一 Session 后续轮次沿用它续查。若发起结果不明，先说明不确定性，不另建运行。
4. 完成后把服务返回的完整 `user_response_markdown` 原样交给用户，其中的结论、设备数量、证据缺口和下载地址不得自行改写或补造。若该字段缺失、工具失败或报告未就绪，只报告实际状态；不得声称完成。

这四个工具不能创建或配置巡检任务，也不能创建周期任务。建议和已执行动作分清；不使用其他网络、Shell 或通用定时工具代替巡检服务。
