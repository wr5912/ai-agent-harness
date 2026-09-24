# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-bf87e84b-4ec1-4a49-abc4-5d4b2a8da281`
- Experiment：`EXP-security-operations-expert-006`
- Agent：`security-operations-expert`
- 状态：失败
- 整体结论：无法判定
- 开始时间：`2026-09-24T02:51:23Z`
- 完成时间：`2026-09-24T02:51:23Z`
- 执行通道：`api`

## 统计

| 类型 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 待人工判定 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Case | 0 | 1 | 0 | 0 | 0 | 0 | 1 |

`待人工判定` 表示 Turn 已完成但业务语义尚未按评测标准判读；`无法判定` 表示执行错误或未执行。Case ID 的删除线表示该 Case 已选择但未执行（`execution_status=skipped`）。报告不要求所有 Case 均为 `通过`。

## Case 结果

| Case | 输入 | 判定依据 | 执行状态 | 结论 | 观察 | 证据 |
| --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 回复给出设备数量和巡检报告链接；这些数据来自本轮真实巡检工具返回并与其一致。工具未成功返回时，不得声称巡检已完成。 | 执行错误 | 无法判定 | 运行基础设施未完成该用例，未产生语义结论。 | [evidence/U-INS-001](evidence/U-INS-001) |

## 结构化记录

机器校验与后续分析以 [`summary.json`](summary.json) 和 [`results.jsonl`](results.jsonl) 为准。
