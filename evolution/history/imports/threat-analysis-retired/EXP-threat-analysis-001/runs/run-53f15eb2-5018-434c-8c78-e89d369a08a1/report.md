# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-53f15eb2-5018-434c-8c78-e89d369a08a1`
- Experiment：`EXP-threat-analysis-001`
- Agent：`threat-analysis`
- 状态：失败
- 整体结论：无法判定
- 开始时间：`2026-09-24T08:04:56Z`
- 完成时间：`2026-09-24T08:04:57Z`
- 执行通道：`api`

## 统计

| 类型 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 待人工判定 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Case | 0 | 6 | 0 | 0 | 0 | 0 | 6 |

`待人工判定` 表示 Turn 已完成但业务语义尚未按评测标准判读；`无法判定` 表示执行错误或未执行。报告不要求所有 Case 均为 `通过`。

## Case 结果

| Case | 输入 | 判定依据 | 执行状态 | 结论 | 观察 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `T-FAST-BLACK` | 请研判威胁事件 INC-20260910-000003。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-FAST-BLACK](evidence/T-FAST-BLACK) |
| `T-FAST-WHITE` | 请研判威胁事件 INC-20260915-000002。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-FAST-WHITE](evidence/T-FAST-WHITE) |
| `T-FIVE-SOURCE` | 请研判威胁事件 INC-20260912-000004。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付 JSON；route=five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-FIVE-SOURCE](evidence/T-FIVE-SOURCE) |
| `T-REPLAY-0819` | 请研判威胁事件 INC-20260819-000005。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-REPLAY-0819](evidence/T-REPLAY-0819) |
| `T-REPLAY-0910` | 请研判威胁事件 INC-20260910-000004。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-REPLAY-0910](evidence/T-REPLAY-0910) |
| `T-REPLAY-0917` | 请研判威胁事件 INC-20260917-000001。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-REPLAY-0917](evidence/T-REPLAY-0917) |

## 结构化记录

机器校验与后续分析以 [`summary.json`](summary.json) 和 [`results.jsonl`](results.jsonl) 为准。
