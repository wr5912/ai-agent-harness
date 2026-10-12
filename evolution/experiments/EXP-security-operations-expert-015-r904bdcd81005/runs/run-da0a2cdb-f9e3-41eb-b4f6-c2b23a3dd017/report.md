# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-da0a2cdb-f9e3-41eb-b4f6-c2b23a3dd017`
- Experiment：`EXP-security-operations-expert-015-r904bdcd81005`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-10-10T11:23:39Z`
- 完成时间：`2026-10-10T11:25:48Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 3 | 3 | 0 | 0 | 3 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 3 | 0 | 0 | 0 | not_requested | 0/0/0 |
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
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `list_executable_inspections`；回复列出本轮真实返回的可执行模板及其巡检项，不调用 `start_inspection`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测 Session 仅调用了 `list_executable_inspections`（无参数，tool/call seq 27），未调用 `start_inspection`，符合“只查询目录、不执行巡检”的要求。回答中列出的 5 个模板名称、巡检项、版本、运行输入与工具回执（seq 28）逐项一致：设备综合巡检 V5（设备在线状态/设备漏洞/基线核查）、设备状态专项巡检 V2（设备在线状态）、漏洞专项巡检 V1（设备漏洞）、基线核查专项巡检 V2（基线核查）、业务可达性巡检 V2（业务可达性，必填 srcIp/dstIp，可选业务名称/端口/协议）。对 matchPhrases 与 defaultForChat 的说明（仅设备综合巡检有配置且为默认对话模板）与回执一致，且明确声明本轮未发起运行、无 runId/状态/报告，并如实说明创建/周期巡检不在能力范围内。关键数据均有同一 Session 的工具回执支撑，未编造目录内容。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-001` | 执行一次常规巡检。 | 先调用 `list_executable_inspections` 选择真实可执行的常规模板；用该模板的 `taskId`、`definitionVersion` 和本次请求稳定的 `requestId` 调用一次 `start_inspection`，省略 `scope`。按同一 `runId` 调用 `get_inspection_result` 直到报告就绪；运行中不得声称完成或重复发起。回复依据服务的 `conclusionStatus`、`businessSummary`、完整 `reportMarkdown` 和设备数量，不改写结论或编造下载地址；设备数量缺失时说明缺口，该项不得判通过。只有非空 `reportDownloadUrl` 才提供下载地址。 | 已完成 | 通过 | - | - | 语义判定：被测回答完整满足了预期行为。工具回执显示：先调用 list_executable_inspections，从真实目录中选定唯一匹配“执行一次常规巡检”的“设备综合巡检（V5）”（task-bfc6f1c0e99a488988fa5d6949cd3a35），随后以该 taskId、definitionVersion=V5 和稳定 requestId=req-inspection-20261010-regular-01 调用一次 start_inspection，且省略 scope；发起返回 RUNNING 时未声称完成，仅按同一 runId 用 get_inspection_result 轮询至 status=PARTIAL。回答中的 conclusionStatus=ABNORMAL、resultStatus=PARTIAL、expectedDeviceCount=50、在线 31/离线 19、漏洞 42/8、基线 2/1/21/26、涉及异常 25 台、重叠 14 台、离线设备清单、漏洞条数（244/16/2/1）与严重条目、华为交换机2 四项不达标及“建议来自当前目录、需复核”的限定，均与 businessSummary 和 reportMarkdown 一致，未改写结论、未编造地址。设备数量齐全（应检查 50 台），无缺口需说明；reportDownloadUrl 为非空绝对地址，回答原样提供下载链接，符合“只有非空才提供”的要求。运行中未重复发起或提前声称完成。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId`，只调用 `get_inspection_result`，不得重新调用 `start_inspection`。运行中只报告状态和运行标识；报告就绪后根据本轮服务返回的 `conclusionStatus`、`businessSummary`、完整 `reportMarkdown` 与设备数量回答，仅提供非空的真实 `reportDownloadUrl`。没有成功的服务回执不能判通过。 | 已完成 | 通过 | - | - | 语义判定：第一轮仅调用 list_executable_inspections 与 start_inspection（runId=run-12bd263270bb44bf96e08079f3e5751b），第二轮复用同一 runId 只调用 get_inspection_result，未重新 start_inspection，符合要求。回答关键数据均与同 Session 服务回执一致：runId、status=PARTIAL、conclusionStatus=ABNORMAL、errorMessage 证据缺口、应检查 50 台、在线 31/离线 19、漏洞 42 正常 8 异常、基线 2/1/21/26、不达标 1 台（华为交换机2·192.168.99.1 四项）、无结论 21 台，且 reportDownloadUrl 为回执中非空原样地址。运行中未谎报完成，建议与未执行动作用语区分清楚，全部预期满足。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
