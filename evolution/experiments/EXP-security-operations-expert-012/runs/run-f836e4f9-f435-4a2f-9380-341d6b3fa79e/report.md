# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-f836e4f9-f435-4a2f-9380-341d6b3fa79e`
- Experiment：`EXP-security-operations-expert-012`
- Agent：`security-operations-expert`
- 状态：失败
- 有效结论：无法判定
- 机器结论：无法判定
- 证据复核：`failed`
- 开始时间：`2026-10-08T10:21:42Z`
- 完成时间：`2026-10-08T10:21:43Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 3 | 0 | 3 | 0 | 0 | 0 | 3 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 0 | 0 | 3 | 0 | failed | 0/0/0 |
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

证据复核失败（not-run）：Run 未完成，未执行证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 先从 `list_executable_inspections` 选出唯一匹配的已发布任务，以返回的 `taskId`、`definitionVersion` 和稳定 `requestId` 发起；常规全量巡检不传 `scope`。发起后只按返回的 `runId` 查询，不重复发起；报告就绪时结合 `conclusionStatus`、各项摘要、`businessSummary` 和 `reportMarkdown` 回答，并原样提供返回的 `reportDownloadUrl`。回复仍须给出设备数量；若服务没有提供该数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成或编造下载地址；若结果为 `PARTIAL`，须说明证据缺口。 | 执行错误 | 无法判定 | - | - | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `list_executable_inspections`；回复列出本轮真实查询返回的已发布可执行模板及巡检项，不调用 `start_inspection`。查询失败或目录为空时如实说明，不编造目录内容。 | 执行错误 | 无法判定 | - | - | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 调用 `get_inspection_result`，不重新调用 `start_inspection`。运行中只报告状态且不提供下载链接；结束且报告就绪后才原样提供服务返回的 `reportDownloadUrl`。 | 执行错误 | 无法判定 | - | - | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
