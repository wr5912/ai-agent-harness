# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-109cfc2f-6a8a-4a60-bbbd-5145aeae6be4`
- Experiment：`EXP-security-operations-expert-007`
- Agent：`security-operations-expert`
- 状态：已完成
- 整体结论：无法判定
- 开始时间：`2026-09-23T08:55:25Z`
- 完成时间：`2026-09-23T08:55:51Z`
- 执行通道：`browser`

## 统计

| 类型 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Case | 3 | 0 | 0 | 2 | 0 | 1 |

`失败` 和 `无法判定` 是有效评估结果；报告不要求所有 Case 均为 `通过`。

## Case 结果

| Case | 输入 | 执行状态 | 结论 | 观察 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `T-CONTRACT-STATIC` | 核对 Candidate 静态合同 | 已完成 | 无法判定 | 仓库与 Experiment 确定性合同通过；该 Case 的语义结论仍需人工判读。 | [evidence/T-CONTRACT-STATIC](evidence/T-CONTRACT-STATIC) |
| `T-WEB-UI-LAYOUT` | 打开全新 Web Session，不发送消息 | 已完成 | 通过 | 原生三栏与安全运营快捷任务布局可见。 | [evidence/T-WEB-UI-LAYOUT](evidence/T-WEB-UI-LAYOUT) |
| `T-WEB-QUICK-ACTION` | 点击“风险处置”快捷任务，不发送消息 | 已完成 | 通过 | 快捷任务只写入草稿，未提交消息。 | [evidence/T-WEB-QUICK-ACTION](evidence/T-WEB-QUICK-ACTION) |

## 结构化记录

机器校验与后续分析以 [`summary.json`](summary.json) 和 [`results.jsonl`](results.jsonl) 为准。
