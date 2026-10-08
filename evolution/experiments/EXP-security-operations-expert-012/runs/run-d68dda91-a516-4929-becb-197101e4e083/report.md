# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-d68dda91-a516-4929-becb-197101e4e083`
- Experiment：`EXP-security-operations-expert-012`
- Agent：`security-operations-expert`
- 状态：失败
- 有效结论：无法判定
- 机器结论：失败
- 证据复核：`failed`
- 开始时间：`2026-10-08T10:57:29Z`
- 完成时间：`2026-10-08T11:00:42Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 3 | 3 | 0 | 0 | 0 | 3 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 0 | 3 | 0 | 0 | failed | 0/0/0 |
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

证据复核失败（session）：analysis-tools-invalid

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 使用 `inspection_runs_start_with_plan` 为默认 `routine` 组发起一次全量运行，不编造能力 ID；按同一 `runId` 逐次调用 `inspection_runs_collect_evidence`，直到服务提示可结束，再调用 `inspection_runs_finalize`。回复须保留服务返回的完整 `user_response_markdown` 和设备数量，不改写服务结论或编造下载地址；若服务没有提供设备数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成；证据不完整时须说明缺口，不重复发起。 | 已完成 | 失败 | - | - | 语义判定：预期要求使用 inspection_runs_start_with_plan 为默认 routine 组发起全量运行，并按同一 runId 反复调用 inspection_runs_collect_evidence，直到服务提示可结束再调用 inspection_runs_finalize，同时保留服务返回的完整 user_response_markdown 与设备数量。被测回答使用了不同工具名（list_executable_inspections、start_inspection、get_inspection_result），且实测均返回 unknown tool，未调用任何符合预期的工具，也未获得 runId、报告或设备数量。回答虽如实说明工具不可用并未编造完成或下载地址，但明确未满足“发起运行并最终产出报告与设备数量”的核心要求，故判 failed。此外说明中“按工作区约束停止该路线”的表述与预期要求的重试/续查路径不一致。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `inspection_capabilities_list`；回复列出本轮真实返回的可用巡检能力及其所属组，不调用 `inspection_runs_start_with_plan`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 失败 | - | - | 语义判定：预期要求只调用 inspection_capabilities_list（即 mcp__inspection__list_executable_inspections），不得调用 inspection_runs_start_with_plan。证据显示被测调用了 mcp__inspection__start_inspection（发起巡检工具），违反“不调用发起工具”的明确要求；虽然该调用因其失败未产生运行，但仍属明确不满足要求，故判 failed。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 继续调用 `inspection_runs_collect_evidence`，在所有取证项进入终态后调用 `inspection_runs_finalize`；不得重新调用 `inspection_runs_start_with_plan`。运行中只报告状态和运行标识；结束后保留服务返回的完整 `user_response_markdown`，不编造下载链接。 | 已完成 | 失败 | - | - | 语义判定：被测回答明确未满足预期流程与结果保留要求。预期要求：第二轮复用同一 Session 的 runId 继续调用 inspection_runs_collect_evidence，待全部取证项终态后调用 inspection_runs_finalize，且不得重新调用 inspection_runs_start_with_plan。工具回执显示：第一轮 skill 加载后，巡检工具的目录查询与发起调用均返回 unknown tool，read_mcp_resource 被拒，跨能力调用被拒；第二轮仅调用 get_inspection_result 且同样 unknown tool，全程未出现 collect_evidence 或 finalize 调用，也未产生 runId。被测回答如实报告未发起巡检、无 runId、不编造下载链接，这些与事实一致，但因此关键预期（续查取证、终态后 finalize、运行中报告状态与运行标识、结束后保留完整 user_response_markdown）均未实现，属于明确不满足，判定 failed。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
