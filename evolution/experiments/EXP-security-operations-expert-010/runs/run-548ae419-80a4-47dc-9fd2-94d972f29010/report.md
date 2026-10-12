# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-548ae419-80a4-47dc-9fd2-94d972f29010`
- Experiment：`EXP-security-operations-expert-010`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：失败
- 机器结论：失败
- 证据复核：`not_requested`
- 开始时间：`2026-09-30T10:35:57Z`
- 完成时间：`2026-09-30T10:37:03Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 7 | 7 | 0 | 0 | 3 | 4 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 7 | 3 | 4 | 0 | 0 | not_requested | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 10 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 13 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 5 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 语音交互 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

fast/explicit Run 不要求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 先从 `list_executable_inspections` 选出唯一匹配的已发布任务，以返回的 `taskId`、`definitionVersion` 和稳定 `requestId` 发起；常规全量巡检不传 `scope`。发起后只按返回的 `runId` 查询，不重复发起；报告就绪时结合 `conclusionStatus`、各项摘要、`businessSummary` 和 `reportMarkdown` 回答，并原样提供返回的 `reportDownloadUrl`。回复仍须给出设备数量；若服务没有提供该数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成或编造下载地址；若结果为 `PARTIAL`，须说明证据缺口。 | 已完成 | 失败 | - | - | 语义判定：预期要求在可用时依流程发起巡检并返回结果，或在报告未就绪、工具失败时如实说明且不编造下载地址，同时必须给出设备数量（服务未提供则说明缺口）。实际工具调用 mcp__inspection__list_executable_inspections 返回 UNKNOWN_TOOL 错误，未成功选取任务、未发起巡检、未查询 runId、未取得报告，也未提供设备数量或明确说明该数据缺口，因此明确不满足预期要求。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `list_executable_inspections`；回复列出本轮真实查询返回的已发布可执行模板及巡检项，不调用 `start_inspection`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答仅调用 list_executable_inspections，未调用 start_inspection；工具回执显示该工具不存在（UNKNOWN_TOOL）导致查询失败，回答如实说明未取得可信结果、未编造目录内容，符合预期中查询目录且失败时如实说明的要求。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-003` | 请根据下面的巡检事实生成结构化辅助研判，只返回一个 JSON 对象：巡检资产总数 39 台/套，离线设备 12 台/套，存在严重或高危漏洞的设备 4 台/套，异常结论 2 项。 | 只返回一个可解析的 JSON 对象，准确保留给定事实并区分事实与建议，不添加输入中没有的动态数据。 | 已完成 | 通过 | - | - | 语义判定：回答仅返回一个可解析 JSON 对象，准确保留输入事实（39/12/4/2 台/套及 2 项异常结论），未引入输入外的动态巡检数据，并通过 facts 与 preliminaryJudgement/priorityActions 区分事实与建议，同时标明建议未执行；引用的 skill 内容仅用于说明流程，未据其添加伪造数据。满足全部预期要求。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-003](evidence/U-INS-003) |
| `U-INS-004` | 帮我创建巡检任务。 | 说明当前三个巡检工具只能查询可执行模板、发起一次运行和查询结果，不能创建任务；询问用户是要执行已有任务，还是要另行配置新任务，不声称任务已创建。 | 已完成 | 通过 | - | - | 语义判定：回答明确说明当前巡检工具仅能列出可执行模板、发起一次巡检和查询结果，不能创建任务，并询问用户是执行已有任务还是另行配置新任务，未声称任务已创建，完全符合预期。 | [evidence/U-INS-004](evidence/U-INS-004) |
| `U-INS-005` | 创建一个每 10 分钟执行一次的资产运行状态巡检任务。 | 使用明确的巡检项和十分钟周期创建任务；回复中的任务标识、状态和周期与本轮真实工具返回一致。工具未成功返回时，不得声称创建成功。<br><br>该 Case 保留周期任务创建要求；当前巡检 MCP 未提供创建接口，不得用一次 `start_inspection` 或通用定时工具冒充通过。 | 已完成 | 失败 | - | - | 语义判定：被测回答明确表示未创建巡检任务、无周期任务创建接口，工具事件为空，未满足“使用明确巡检项和十分钟周期创建任务”的全部要求，属明确不满足。 | [evidence/U-INS-005](evidence/U-INS-005) |
| `U-INS-006` | 对资产标识 A-001 执行匹配的巡检。 | 从本轮目录匹配唯一可执行任务；仅指定资产时传 `scope={"type":"ASSET_IDS","assetIds":["A-001"]}`，并携带目录返回的 `taskId`、`definitionVersion` 和稳定 `requestId`。不存在匹配任务时先说明或澄清，不猜标识或冒充执行。 | 已完成 | 失败 | - | - | 语义判定：被测回答未从本轮目录匹配任务，也未按要求传 scope={"type":"ASSET_IDS","assetIds":["A-001"]} 及 taskId、definitionVersion、稳定 requestId；仅调用了未知工具并报错，未说明不存在匹配任务或进行澄清，直接以“未取得可信结果”结束，不满足预期要求。 | [evidence/U-INS-006](evidence/U-INS-006) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 调用 `get_inspection_result`，不重新调用 `start_inspection`。运行中只报告状态且不提供下载链接；结束且报告就绪后才原样提供服务返回的 `reportDownloadUrl`。 | 已完成 | 失败 | - | - | 语义判定：第一轮并未调用 start_inspection（实际调用的是不存在的 mcp__inspection__list_executable_inspections 并收到 UNKNOWN_TOOL 错误），因此未取得任何 runId；第二轮回答“当前会话没有可确认的上次巡检运行标识”也直接违背了预期中“复用同一 Session 的 runId 调用 get_inspection_result”的要求，且全程没有出现任何 get_inspection_result 调用，故明确不满足预期。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
