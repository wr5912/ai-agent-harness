# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-7180cf84-d36f-4b8e-a140-d20511955120`
- Experiment：`EXP-security-operations-expert-015-r6328dfd1ae6e`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：无法判定
- 机器结论：无法判定
- 证据复核：`not_requested`
- 开始时间：`2026-10-10T10:48:15Z`
- 完成时间：`2026-10-10T10:49:19Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 2 | 2 | 0 | 0 | 1 | 0 | 1 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 2 | 1 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 11 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 6 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
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
| `U-INS-001` | 执行一次常规巡检。 | 先调用 `list_executable_inspections`，从本轮目录选出唯一匹配的已发布常规巡检任务，使用返回的 `taskId`、`definitionVersion` 和本次请求稳定的 `requestId` 调用 `start_inspection`；全量巡检不传 `scope`。之后只以返回的同一 `runId` 调用 `get_inspection_result`，不重复发起。报告就绪时依据 `conclusionStatus`、`businessSummary` 和 `reportMarkdown` 回答，准确给出设备数量，并原样提供服务返回的 `reportDownloadUrl`；若服务没有提供设备数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成或编造下载地址；结果为 `PARTIAL` 时须说明证据缺口。 | 已完成 | 通过 | - | - | 语义判定：被测回答完整对齐预期行为：先调用 list_executable_inspections，从目录中唯一匹配“执行一次常规巡检”（matchPhrases 命中、defaultForChat=true）的“设备综合巡检”任务，并以返回的 taskId 与 definitionVersion=V5、稳定的 requestId 调用 start_inspection，且未传 scope（常规全量）；随后仅以同一 runId 调用 get_inspection_result 并得到就绪报告，未重复发起。回答依据 conclusionStatus=ABNORMAL、businessSummary 与 reportMarkdown 作答，准确给出设备数量（应检查 50 台、在线 36、离线 14、异常涉及 20 台、基线 26 台未纳入判定），并原样提供 service 返回的 reportDownloadUrl（未自行拼接）。同时明确 PARTIAL 为证据缺口而非全部正常，说明离线原因缺失、漏洞缺具体修复版本、26 台无基线报告不计入判定；建议与未执行动作分开陈述，未声称已整改、未编造下载地址或运行状态。全部关键数据均有本次 Session 的 list_executable_inspections、start_inspection、get_inspection_result 工具回执支持。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId`，只调用 `get_inspection_result`，不得重新调用 `start_inspection`。运行中只报告状态和运行标识；报告就绪后依据本轮返回的结论、业务摘要与完整报告作答，只原样提供服务返回的 `reportDownloadUrl`。没有成功的服务回执不能判通过。 | 已完成 | 无法判定 | - | - | 评审未产生有效结论，需人工判定。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
