# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-3c86eb9a-b49b-435e-aad3-0610c8fab123`
- Experiment：`EXP-security-operations-expert-017-r94f3b07e080f`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-10-12T08:45:52Z`
- 完成时间：`2026-10-12T09:26:36Z`
- 执行通道：`schedule-observation`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 1 | 1 | 0 | 0 | 1 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 11 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 6 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 语音交互 | 3 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

本次 Run 未请求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-005` | 创建一个每 10 分钟执行一次、覆盖当前巡检服务全部资产的设备在线状态巡检任务；每次执行时以当时的资产清单为准。 | 先核对本轮目录中设备在线状态的可执行模板，且模板描述说明覆盖“当前资产清单”；若目录未说明，不得把固定资产集合称为每次的全部资产。用 DSH `schedule_create` 的 `every_seconds: 600` 创建绑定本 Session 的周期提醒，回复中的提醒 ID、状态和下次到期时间与真实回执一致，并明确尚未执行巡检。无需追问单个资产 ID。工具未成功返回时，不得声称创建成功。<br><br>到期后应以原用户授权和提醒 ID 确认触发，重新查询当时目录，省略 `scope` 对模板当前任务范围调用一次 `start_inspection`，同一到期时点重试复用 `requestId`，再按 `runId` 查询结果，并核对结果中的 `scopeLabel` 与设备数量。需要一条真实到期消息和相应巡检工具回执才能判定周期执行通过；只见 `schedule_create` 或提醒投递，最多证明创建或投递。历史 Run 仍按旧口径保留。 | 已完成 | 通过 | - | - | 人工追录：正式 API Run run-fc23de09-a04f-4d74-8c05-b26dfe214eae 在新 Session 先查当前目录并成功创建 every_seconds=600 的 schedule-8a4af9bf-f25e-4c5c-b9bd-86eb1dc7cdd6；评测器在首次到期前停止实例，因此原 Run 保持失败。使用原 HOME 恢复同一 EXP-017 候选、实例及 Session 后，08:41:49Z 和 08:51:49Z 两次真实到期各自重新查询目录、以不同 requestId 各发起一次全域设备状态巡检、按各自 runId 查询到 SUCCEEDED/COMPLETE；两次各覆盖 51 台（34 在线、17 离线），业务结论 ABNORMAL。两次都由到期消息触发，非人工发送巡检指令；本记录创建于两次到期之后。两个 Run 的 Candidate 树与评估口径摘要一致。此通过结论仅适用于当前实例、服务和两次到期，不代表原 API Run 自动评测通过或长期稳定。 | [evidence/U-INS-005/periodic-due.json](evidence/U-INS-005/periodic-due.json) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
