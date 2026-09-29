# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-c2eca146-bfea-4a86-be40-1ed879ec78dc`
- Experiment：`EXP-threat-analysis-001`
- Agent：`threat-analysis`
- 状态：已完成
- 有效结论：无法判定
- 机器结论：无法判定
- 证据复核：`not_requested`
- 开始时间：`2026-09-28T09:54:25Z`
- 完成时间：`2026-09-28T10:03:08Z`
- 执行通道：`browser`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 2 | 0 | 1 | 1 | 0 | 0 | 2 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 威胁事件研判 | 6 | 2 | 0 | 0 | 2 | 0 | not_requested | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

fast/explicit Run 不要求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-FIVE-SOURCE` | 请研判威胁事件 INC-20260912-000004。 | 调用 analyze_threat_incident 一次，通过正式助手消息展示 Markdown 摘要、保留原始元数据；route=five_source。五源若合同拒绝但 JSON 对象已解析，仍返回 completed、原始 result 和 validation.failed，摘要及报告明确展示校验问题；无法解析时返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 执行错误 | 无法判定 | - | - | 评测身份或证据失配，已停止。 | [evidence/U-FIVE-SOURCE](evidence/U-FIVE-SOURCE) |
| ~~`U-REPLAY-0917`~~ | 请研判威胁事件 INC-20260917-000001。 | 调用 analyze_threat_incident 一次，两条路径均由程序输出正式助手 Markdown 摘要，不再请求外层模型生成结果；原始 result 保留在元数据中，保存接口显示待接入；根据实时名单允许 fast_classification 或 five_source。五源若合同拒绝但 JSON 对象已解析，仍返回 completed、原始 result 和 validation.failed，摘要及报告明确展示校验问题；无法解析时返回 contract_failed 且没有 result。连接失败不算迁移通过。 | 已跳过 | 无法判定 | - | - | 评测已停止，该用例未执行。 | [evidence/U-REPLAY-0917](evidence/U-REPLAY-0917) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
