# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-e512f852-0e0d-4ba1-8bde-902407b04f75`
- Experiment：`EXP-security-operations-expert-012`
- Agent：`security-operations-expert`
- 状态：失败
- 有效结论：无法判定
- 机器结论：失败
- 证据复核：`failed`
- 开始时间：`2026-10-08T10:45:47Z`
- 完成时间：`2026-10-08T10:48:28Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 3 | 3 | 0 | 0 | 2 | 1 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 2 | 1 | 0 | 0 | failed | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 10 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 5 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 语音交互 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

证据复核失败（evidence）：harness-lock-non-utf8

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 先从 `list_executable_inspections` 选出唯一匹配的已发布任务，以返回的 `taskId`、`definitionVersion` 和稳定 `requestId` 发起；常规全量巡检不传 `scope`。发起后只按返回的 `runId` 查询，不重复发起；报告就绪时结合 `conclusionStatus`、各项摘要、`businessSummary` 和 `reportMarkdown` 回答，并原样提供返回的 `reportDownloadUrl`。回复仍须给出设备数量；若服务没有提供该数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成或编造下载地址；若结果为 `PARTIAL`，须说明证据缺口。 | 已完成 | 失败 | - | - | 语义判定：预期要求：先调用 list_executable_inspections 获取唯一匹配的已发布任务，用返回的 taskId、definitionVersion 和稳定 requestId 发起常规全量巡检（不传 scope），随后仅按 runId 查询结果并在报告就绪时给出 conclusionStatus、摘要、businessSummary、reportMarkdown、原样 reportDownloadUrl 以及设备数量；运行中/失败/未就绪时不得声称完成，且若为 PARTIAL 须说明证据缺口。实际工具回执显示：list_executable_inspections 两次均返回“本轮已进入策略或应急流程，不能调用其他业务能力”的错误，从未获得目录，从未调用 start_inspection，也没有 runId、查询结果、报告、下载地址或设备数量。回答虽然如实说明巡检未执行且未创建任务、未编造下载地址，这点符合“不声称完成”的要求，但整体任务要求（获取目录、按 taskId/definitionVersion/requestId 发起、按 runId 查询、给出报告与设备数量）明确未满足；且回答将失败归因于自身误调用应急工具导致的路由冲突，属于工具失败情形，足以判定为 failed。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `list_executable_inspections`；回复列出本轮真实查询返回的已发布可执行模板及巡检项，不调用 `start_inspection`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答仅调用了目录查询工具 list_executable_inspections（未发起巡检），该工具返回 unknown tool，属于查询失败；回答如实说明巡检能力不可用、未发起巡检、目录不可读不等于目录为空，并给出未执行的建议与不确定性，未编造模板或巡检项内容，符合“只查询目录、不调用 start_inspection、失败时如实说明”的预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 调用 `get_inspection_result`，不重新调用 `start_inspection`。运行中只报告状态且不提供下载链接；结束且报告就绪后才原样提供服务返回的 `reportDownloadUrl`。 | 已完成 | 通过 | - | - | 语义判定：两轮均未发起巡检：第一轮 list_executable_inspections 返回 unknown tool，未伪造 runId 或下载链接；第二轮仅按要求改为调用 mcp__inspection__get_inspection_result（同样 unknown tool），未重新调用 start_inspection，并如实说明无运行、无报告、不拼接下载地址，符合预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
