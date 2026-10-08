# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-d6fe4696-6ee4-41ce-876d-718a5ce3e18f`
- Experiment：`EXP-security-operations-expert-011`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：无法判定
- 机器结论：无法判定
- 证据复核：`not_requested`
- 开始时间：`2026-10-08T11:10:11Z`
- 完成时间：`2026-10-08T11:14:15Z`
- 执行通道：`browser`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 2 | 1 | 1 | 0 | 1 | 0 | 1 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 11 | 1 | 0 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 6 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
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
| `U-FLT-MENTION` | @故障分析子智能体 业务系统访问异常，帮我做故障分析。 | 按故障排查路由处理；信息不足时询问源、目的、协议、端口和现象，不编造根因，也不进入威胁研判或处置路由。 | 执行错误 | 无法判定 | - | - | 浏览器用例未完成，未产生语义结论。 | [evidence/U-FLT-MENTION](evidence/U-FLT-MENTION) |
| `U-THREAT-MENTION` | @威胁研判子智能体 请研判威胁事件 INC-20260917-000001。 | 按威胁研判路由调用 `delegate_threat_analysis`，原样传递事件 ID；回复和工具轨迹满足 `U-THREAT-FAST` 的证据要求。委派不可用时如实说明，不改走故障排查或编造研判结果。 | 已完成 | 通过 | - | - | 语义判定：被测 Session 工具轨迹显示其按威胁研判路由调用 `delegate_threat_analysis`，并在 prompt 中原样传递事件 ID INC-20260917-000001；子代理随后调用 `analyze_threat_incident` 且参数 incident_id 一致，回执状态 completed、route=fast_classification，包含名单命中实体 172.16.2.112、394 条引用、查询时间、保存状态与下载链接等事实。被测回答的关键数据（误报、快速研判、名单来源、实体、引用条数、查询时间、存储状态、报告 ID/下载链接、运行 ID）均与该 Session 工具回执一致，无改走故障排查或编造结果迹象，满足 U-THREAT-FAST 证据要求。 | [evidence/U-THREAT-MENTION](evidence/U-THREAT-MENTION) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
