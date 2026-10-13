---
name: security-inspection
description: "查询已发布且可执行的巡检模板，异步发起一次巡检，按运行 ID 查询结果和真实报告。"
---

# 安全巡检

主 Agent 直接使用 `mcp__inspection__` 工具。每次工具的协议响应中，`result.content[0].text` 是 JSON 字符串；先解析，再读取业务字段，不把外层 MCP 成功当作巡检成功。

1. 用户只问有哪些巡检项或可执行巡检时，仅调用无参数的 `mcp__inspection__list_executable_inspections`，回答实际返回的名称、巡检项和适用说法，不调用发起工具。该目录只含已发布、绑定启用任务且版本一致的模板；空目录如实说明。
2. 用户要求执行时，先查询目录，根据名称、巡检项及匹配说法选定唯一适用模板；无匹配或多个匹配时询问用户，不猜 `taskId` 或 `definitionVersion`。创建或配置巡检任务（含周期任务）不属于这三个工具；不得调用通用定时任务来冒充巡检任务。
3. 调用 `mcp__inspection__start_inspection`，传入所选 `taskId`、`definitionVersion` 和本次用户请求稳定的 `requestId`。常规全量巡检省略 `scope`，沿用任务范围；用户指定资产时传 `{"type":"ASSET_IDS","assetIds":["资产标识"]}`。同一次请求及其重试必须复用首次使用的 `requestId`，不得因超时或不确定状态生成新 ID 再发起。发起工具异步返回 `runId` 和状态，不等待它生成报告。
4. 保存 `runId`，只用它轮询 `mcp__inspection__get_inspection_result`。运行中仅有状态，`reportDownloadUrl` 为空；本轮可继续查询，但不得再次发起或把运行中说成完成。若本轮无法等到报告就绪，向用户说明当前状态和 `runId`，在同一 Session 后续轮次按原 `runId` 续查；无法找回原 `requestId` 或 `runId` 时先说明不确定性，不另建运行。
5. 运行结束且报告就绪后，依据 `conclusionStatus`、各项摘要、`businessSummary` 与完整 `reportMarkdown` 回答；保留数值、范围和证据缺口。`PARTIAL` 表示有证据缺口，不等于全部正常。只有服务返回非空 `reportDownloadUrl` 时才原样提供该绝对地址，供用户下载 HTML 报告；没有地址时说明报告尚不可下载，不自行拼接 `/api/inspection/operations/runs/{runId}/report/download/html`。

工具报错、模板版本不匹配或运行失败时说明实际状态和可行下一步。建议与未执行动作必须分清；不得通过 Shell、文件或其他网络工具代替巡检服务。
