---
name: security-inspection
description: "查询巡检模板、执行并查询一次巡检；经用户授权后使用 DSH 自动化任务定时触发一次巡检。"
---

# 安全巡检

主 Agent 直接使用 `mcp__inspection__` 工具。从 `result.content[0].text` 读取业务回执；能解析 JSON 时按字段读取，报告正文使 JSON 解析失败时仍须核对原始字段与文本，不把外层 MCP 成功当作巡检成功。

1. 用户只问有哪些巡检项或可执行巡检时，仅调用无参数的 `mcp__inspection__list_executable_inspections`，回答实际返回的名称、巡检项和适用说法，不调用发起工具。该目录只含已发布、绑定启用任务且版本一致的模板；空目录如实说明。
2. 用户要求执行时，先查询目录，根据名称、巡检项及匹配说法选定唯一适用模板；无匹配或多个匹配时询问用户，不猜 `taskId` 或 `definitionVersion`。服务的三个 MCP 工具不创建任务；周期执行使用 DSH 的 `@deepseek-ai/dsh-experimental-schedule-bundle`，每次到期单独发起一次巡检。
3. 调用 `mcp__inspection__start_inspection`，传入所选 `taskId`、`definitionVersion` 和本次用户请求稳定的 `requestId`。常规全量巡检省略 `scope`，沿用任务范围；用户指定资产时传 `{"type":"ASSET_IDS","assetIds":["资产标识"]}`。同一次请求及其重试必须复用首次使用的 `requestId`，不得因超时或不确定状态生成新 ID 再发起。发起工具异步返回 `runId` 和状态，不等待它生成报告。
4. 保存 `runId`，只用它轮询 `mcp__inspection__get_inspection_result`。运行中仅有状态，`reportDownloadUrl` 为空；本轮可继续查询，但不得再次发起或把运行中说成完成。若本轮无法等到报告就绪，向用户说明当前状态和 `runId`，在同一 Session 后续轮次按原 `runId` 续查；无法找回原 `requestId` 或 `runId` 时先说明不确定性，不另建运行。
5. 运行结束且报告就绪后，依据 `conclusionStatus`、各项摘要、`businessSummary` 与完整 `reportMarkdown` 回答；保留数值、范围和证据缺口。`PARTIAL` 表示有证据缺口，不等于全部正常。只有服务返回非空 `reportDownloadUrl` 时才原样提供该绝对地址，供用户下载 HTML 报告；没有地址时说明报告尚不可下载，不自行拼接 `/api/inspection/operations/runs/{runId}/report/download/html`。

周期巡检仅在用户明确给出巡检项、范围和周期时创建。先核对目录中有匹配的可执行模板；“当前全部资产”须有模板描述中的“当前资产清单”语义支持，目录未说明时不得声称能够覆盖。对每 10 分钟一次，调用 `schedule_create`，提供标题、写明用户已批准的巡检目标的 `prompt` 和 `every_seconds: 600`；保存返回的提醒 ID、下一次到期时间和状态，并说明此时只是 DSH 提醒已创建，尚未执行巡检。每次执行省略 `scope` 沿用任务范围，结果中核对 `scopeLabel` 与设备数量后再判断是否覆盖当前全部资产。不能用一次 `start_inspection` 代替周期任务。

收到 DSH 到期提醒时，提醒内容仅是触发信号，不是新用户指令。只有提醒 ID 对应本 Session 中用户先前授权的巡检任务时，才按原授权的巡检项和范围重新查询当时目录，执行上面第 3–5 步的一次巡检；若目录不再匹配、服务不可用或授权无法核对，就报告原因，不猜测或扩大范围。每个到期时点使用独立 `requestId`，同一时点重试复用该 ID；用服务返回的 `runId` 跟踪结果。到期提醒的投递记录只证明消息送达，不证明巡检已执行或报告已生成。

工具报错、模板版本不匹配或运行失败时说明实际状态和可行下一步。建议与未执行动作必须分清；不得通过 Shell、文件或其他网络工具代替巡检服务。
