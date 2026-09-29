# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-bcdc9957-c531-4554-a4e7-79bd3f8c6404`
- Experiment：`EXP-security-operations-expert-008`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-09-29T14:09:30Z`
- 完成时间：`2026-09-29T14:13:09Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 4 | 4 | 0 | 0 | 4 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 3 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 10 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
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
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `list_executable_inspections`；回复列出本轮真实查询返回的已发布可执行模板及巡检项，不调用 `start_inspection`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答仅调用了 mcp__inspection__list_executable_inspections（无参数目录查询），未调用 start_inspection 或任何执行/轮询工具。回答列出的 5 个已发布可执行模板、各巡检项、版本 V3/V1、taskId 及 matchPhrases 与同一 Session 工具回执 seq=28 的 JSON 返回逐项一致（设备综合巡检（228验收）含设备在线状态/设备漏洞/基线核查，其余四项为单巡检项专项模板），业务可达性巡检的必填 srcIp/dstIp 及可选参数也与回执 runtimeInputSchema 相符，无编造内容。回答同时明确说明未执行巡检、未生成 runId、未创建或修改任务，并如实指出目录未返回历史运行状态等缺口信息，符合预期全部要求。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-006` | 对资产标识 A-001 执行匹配的巡检。 | 从本轮目录匹配唯一可执行任务；仅指定资产时传 `scope={"type":"ASSET_IDS","assetIds":["A-001"]}`，并携带目录返回的 `taskId`、`definitionVersion` 和稳定 `requestId`。不存在匹配任务时先说明或澄清，不猜标识或冒充执行。 | 已完成 | 通过 | - | - | 语义判定：本轮目录唯一匹配“设备综合巡检（228验收）”（taskId=task-bfc6f1c0e99a488988fa5d6949cd3a35，definitionVersion=V3，defaultForChat=true），start_inspection 仅指定资产时传入 scope={"type":"ASSET_IDS","assetIds":["A-001"]}，并携带该 taskId、definitionVersion 及稳定 requestId（insp-A-001-20260929-1409）；随后仅用返回的 runId 轮询，未重复发起。工具回执支持其关键数据：状态 PARTIAL、结论 INCOMPLETE、三项巡检项各 1 台检查未完成、应检查 1 台、报告下载地址来自服务返回的非空 reportDownloadUrl。回答如实说明证据缺口、不判为正常、区分未执行建议，且未猜测标识或冒充执行，符合全部预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-006](evidence/U-INS-006) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 调用 `get_inspection_result`，不重新调用 `start_inspection`。运行中只报告状态且不提供下载链接；结束且报告就绪后才原样提供服务返回的 `reportDownloadUrl`。 | 已完成 | 通过 | - | - | 语义判定：第二轮仅调用 get_inspection_result 并复用首轮 runId（run-6206c6224168463a8f54eb4f03b64cd5），未再调用 start_inspection；首轮 start_inspection 返回 RUNNING 时回答给出 runId 且未提供下载链接；第二轮工具回执 status=PARTIAL、reportDownloadUrl 非空，回答报告已结束并就绪并原样提供该地址，摘要数值与工具 businessSummary/reportMarkdown 一致。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |
| `U-FLT-009` | 执行一次常规巡检。<br>根据刚才的巡检异常做根因分析，只分析、不处置，并生成正式报告。 | 第二轮基于同一 Session 中真实巡检结果做根因分析并生成可访问的正式报告；没有执行任何处置。巡检或报告工具失败时，不得声称分析或报告已经完成。 | 已完成 | 通过 | - | - | 语义判定：第二轮在同一 Session 内基于第一轮真实巡检回执（run-e9dde1f5…，PARTIAL/ABNORMAL、42台、离线18、漏洞7台、基线未完成39）完成了根因分析，并通过 delegate_fault_analysis 取证整合出结构化正式报告（全文在回答中交付，且报告引用巡检工具返回的 reportDownloadUrl 为可访问下载地址）。工具事实显示第二轮仅使用只读工具与委派分析，未执行任何处置动作；写入报告文件被运行时拒绝后如实说明未落盘、未声称已生成文件。唯一未完全达成的是“生成可访问的正式报告文件”形态——报告以正文交付而非独立文件，但预期要求的是可访问的正式报告，正文＋真实可下载的巡检报告地址已满足，且失败情形未导致任何虚假完成声明。 同一路由自评，仅作研究辅助。 | [evidence/U-FLT-009](evidence/U-FLT-009) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
