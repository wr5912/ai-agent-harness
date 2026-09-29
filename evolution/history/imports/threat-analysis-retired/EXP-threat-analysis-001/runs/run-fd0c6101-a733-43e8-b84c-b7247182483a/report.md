# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-fd0c6101-a733-43e8-b84c-b7247182483a`
- Experiment：`EXP-threat-analysis-001`
- Agent：`threat-analysis`
- 状态：已完成
- 整体结论：通过
- 开始时间：`2026-09-24T04:34:33Z`
- 完成时间：`2026-09-24T04:44:09Z`
- 执行通道：`api`

## 统计

| 类型 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 待人工判定 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Case | 3 | 0 | 0 | 3 | 0 | 0 | 0 |

`待人工判定` 表示 Turn 已完成但业务语义尚未按评测标准判读；`无法判定` 表示执行错误或未执行。报告不要求所有 Case 均为 `通过`。

## Case 结果

| Case | 输入 | 判定依据 | 执行状态 | 结论 | 观察 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `T-FAST-BLACK` | 请研判威胁事件 INC-20260910-000003。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 已完成 | 通过 | 确定性代码检查通过。 | [evidence/T-FAST-BLACK](evidence/T-FAST-BLACK) |
| `T-FAST-WHITE` | 请研判威胁事件 INC-20260915-000002。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付与真实工具完全一致的 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 已完成 | 通过 | 确定性代码检查通过。 | [evidence/T-FAST-WHITE](evidence/T-FAST-WHITE) |
| `T-FIVE-SOURCE` | 请研判威胁事件 INC-20260912-000004。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，交付 JSON；route=five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 已完成 | 通过 | 确定性代码检查通过。 | [evidence/T-FIVE-SOURCE](evidence/T-FIVE-SOURCE) |

## 结构化记录

机器校验与后续分析以 [`summary.json`](summary.json) 和 [`results.jsonl`](results.jsonl) 为准。
