# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-60d12ba9-aa40-4073-b3dc-7b82f6657daf`
- Experiment：`EXP-threat-analysis-001`
- Agent：`threat-analysis`
- 状态：失败
- 整体结论：无法判定
- 开始时间：`2026-09-28T01:14:30Z`
- 完成时间：`2026-09-28T01:14:31Z`
- 执行通道：`api`

## 统计

| 类型 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 待人工判定 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Case | 0 | 1 | 0 | 0 | 0 | 0 | 1 |

`待人工判定` 表示 Turn 已完成但业务语义尚未按评测标准判读；`无法判定` 表示执行错误或未执行。报告不要求所有 Case 均为 `通过`。

## Case 结果

| Case | 输入 | 判定依据 | 执行状态 | 结论 | 观察 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `T-REPLAY-0917` | 请研判威胁事件 INC-20260917-000001。 | `m-dsh-frozen-chain`、`AC-001`、`AC-002`<br>调用 analyze_threat_incident 一次，快速分类成功时只交付与工具 result 完全一致的 JSON，其他情况交付完整工具 JSON；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝，必须返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/T-REPLAY-0917](evidence/T-REPLAY-0917) |

## 结构化记录

机器校验与后续分析以 [`summary.json`](summary.json) 和 [`results.jsonl`](results.jsonl) 为准。
