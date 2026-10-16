# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-b48e0885-3e17-4310-82db-48e1177a9a99`
- Experiment：`EXP-daily-inspection-assistant-004-r965bc66e4614`
- Agent：`daily-inspection-assistant`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-10-16T12:14:57Z`
- 完成时间：`2026-10-16T12:15:24Z`
- 执行通道：`api`
- Case 选择：`explicit`
- 封存来源核对：`matched`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 1 | 1 | 0 | 0 | 1 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 未分组 | 3 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 基础巡检摘要 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 实际基础接口与报告交付 | 2 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

本次 Run 未请求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-ASSET-PAGES-001` | 请对当前指定的五台基础资产执行一次只读台账巡检，处理所有分页，并提供完整的Markdown和CSV报告下载链接。明确这是不是实际设备健康检测。 | 实际调用task_inspection的start、page和report；使用同一个run_id，分页从0按返回cursor到null，共读取asset-0001至asset-0005五台，报告数量为5，包含实际可下载Markdown和CSV。明确基础模拟台账、未检测真实设备。不能只给职责或用户提供数据摘要。 | 已完成 | 通过 | - | - | 语义判定：同一被测 Session 实际调用了 task_inspection 的 start、page（cursor 0→2→4）与 report，全程使用同一 run_id task-96f0750d-9957-49ea-a6fe-2e648b7b3af2，next_cursor 最终为 null，完整读取 asset-0001 至 asset-0005 共 5 台，report 回执 device_count=5 且如回答所述；回答给出了真实工具回执中的 Markdown 与 CSV 下载链接（download_url、csv_url），明确说明数据来自基础模拟接口、非实际设备健康检测，未以职责说明或用户提供的数据替代工具结果，满足全部预期。 同一路由自评，仅作研究辅助。 | [evidence/U-ASSET-PAGES-001](evidence/U-ASSET-PAGES-001) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
