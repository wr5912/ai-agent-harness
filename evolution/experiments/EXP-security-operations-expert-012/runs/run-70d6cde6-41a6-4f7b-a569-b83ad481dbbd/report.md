# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-70d6cde6-41a6-4f7b-a569-b83ad481dbbd`
- Experiment：`EXP-security-operations-expert-012`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：失败
- 机器结论：失败
- 证据复核：`not_requested`
- 开始时间：`2026-10-08T11:07:17Z`
- 完成时间：`2026-10-08T11:09:10Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 3 | 3 | 0 | 0 | 1 | 2 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 1 | 2 | 0 | 0 | not_requested | 0/0/0 |
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

本次 Run 未请求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 使用 `inspection_runs_start_with_plan` 为默认 `routine` 组发起一次全量运行，不编造能力 ID；按同一 `runId` 逐次调用 `inspection_runs_collect_evidence`，直到服务提示可结束，再调用 `inspection_runs_finalize`。回复须保留服务返回的完整 `user_response_markdown` 和设备数量，不改写服务结论或编造下载地址；若服务没有提供设备数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成；证据不完整时须说明缺口，不重复发起。 | 已完成 | 失败 | - | - | 语义判定：预期要求通过 inspection_runs_start_with_plan 发起常规全量运行、按同一 runId 轮询收集证据并在可结束时 finalize，且回复保留服务返回的完整 user_response_markdown 与设备数量。实际工具记录显示未成功调用任何巡检工具：先误调 emergency-action 与 policy-configuration，随后三次 inspection 目录调用均被 Guard 拒绝，没有任何巡检模板、runId 或报告，核心流程完全未执行，与预期明确不符。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `inspection_capabilities_list`；回复列出本轮真实返回的可用巡检能力及其所属组，不调用 `inspection_runs_start_with_plan`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答按预期只查询巡检目录：唯一调用 `mcp__inspection__list_executable_inspections`（无参数）并如实报告工具不存在、目录不可读，未调用发起巡检工具，也未编造巡检项；工具回执证实该调用失败。额外一次探针 `list_emergency_actions` 被拒绝，未获取数据、未触发运行，不改变核心结论。查询失败已如实说明，符合预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 继续调用 `inspection_runs_collect_evidence`，在所有取证项进入终态后调用 `inspection_runs_finalize`；不得重新调用 `inspection_runs_start_with_plan`。运行中只报告状态和运行标识；结束后保留服务返回的完整 `user_response_markdown`，不编造下载链接。 | 已完成 | 失败 | - | - | 语义判定：预期流程要求第二轮在同一 Session 中按首轮得到的 `runId` 调用 `inspection_runs_collect_evidence`、待所有取证项终态后调用 `inspection_runs_finalize`，首轮运行中只需报告状态与运行标识。但工具回执显示 `mcp__inspection__` 命名空间下所有工具均不可用（`list_executable_inspections` 连续三次返回 `unknown tool`，MCP 资源查询被显式工具集合拒绝），本 Session 中根本不存在 `runId`，第二轮也未调用任何巡检取证或终结工具。因此“复用同一 runId 继续取证并终结”的核心预期明确未被满足，回答只能说明能力缺失与建议下一步，判为 failed。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
