# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-8a7245e8-f599-4f3a-ac21-5e163f497cdf`
- Experiment：`EXP-security-operations-expert-006`
- Agent：`security-operations-expert`
- 状态：已完成
- 整体结论：通过
- 开始时间：`2026-09-23T07:22:46Z`
- 完成时间：`2026-09-23T07:23:05Z`
- 执行通道：`browser`

## 统计

| 类型 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 待人工判定 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Case | 1 | 0 | 0 | 1 | 0 | 0 | 0 |

`待人工判定` 表示 Turn 已完成但业务语义尚未按评测标准判读；`无法判定` 表示执行错误或未执行。报告不要求所有 Case 均为 `通过`。

## Case 结果

| Case | 输入 | 判定依据 | 执行状态 | 结论 | 观察 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `T-MODEL-CATALOG` | 核对 Web 模型目录 | - Web 模型目录的默认项名称匹配 `DeepSeek`，并存在名为 `Qwen3.8-27B` 的可选模型。 | 已完成 | 通过 | Web 模型目录的确定性代码检查通过。 | [evidence/T-MODEL-CATALOG](evidence/T-MODEL-CATALOG) |

## 结构化记录

机器校验与后续分析以 [`summary.json`](summary.json) 和 [`results.jsonl`](results.jsonl) 为准。
