# 交付与评估契约

执行正式证据检查或解释验证器结果时读取本文件。

## 唯一交付形态与事实源

`<agent-project>/delivery/` 只能二选一：

- 合并版：`交付记录.md`；
- 拆分版：规范规定的 `01_智能体需求定义.md` 至 `06_自测与交付评估报告.md` 六个文件。

事实源按项目裁决确定：

- 验收事实源：`<agent-project>/spec/acceptance.yaml` 存在时它是唯一事实源，交付记录中的 `AC-xxx` 必须与其逐项一致；spec 尚未物化时交付记录模板一（或拆分版 `01_智能体需求定义.md`）暂代事实源。两者不得并存为可编辑标准。
- Case 事实源：`<agent-project>/eval/cases.jsonl`。待复核输入只允许位于 `<agent-project>/eval/pending/*.pending.jsonl`，不得被正式 Run、Trial 或验收结论引用。
- Trial 事实源：`evolution/experiments/EXP-<agent-id>-NNN/runs/<run-uuid>/results.jsonl`。

模板、空文件、`latest` 或 `final-final` 副本不是交付证据。

## Case 契约

必填字段：`id`、`requirement_ids`、`acceptance_id`、`scenario_id`、`intent_id`、`tags`、`source_type`、`variant_types`、`input`、`context`、`expected_behavior`、`check`、`required_trials`、`gate`。

- `tags`：`core`、`boundary`、`safety`、`regression`。
- `source_type`：`real`、`real_redacted`、`near_real`、`synthetic_reviewed`。
- `variant_types`：`standard`、`colloquial`、`elliptical`、`multi_intent`、`incorrect_or_noisy`、`missing_info`、`high_risk`。
- `gate`：`blocking` 或 `scored`；安全 Case 还必须有 `expected_control=allow|block|require_approval`。
- `required_trials` 是至少 1 的整数。一个 Case 只关联一个场景、意图和 `acceptance_id`。
- 每个 `requirement_id` 必须在需求事实源与该 Case 的 `acceptance_id` 关联；每个 `requirement_id + variant_type` 必须由模板二中相同 `scenario_id + intent_id` 的矩阵格引用。
- `safety` Case 必须使用 `blocking`，不能通过计分被其他质量结果抵消。

## 冻结范围选择器

模板三每个 `AC-xxx` 的“评估用例编号或可执行筛选条件”必须能确定性还原本次范围。当前检查器支持：

- `case_ids=["case-001", "case-002"]` 形式的 JSON 字符串数组；
- 只含 Case ID、以逗号分隔的明确列表；
- `acceptance_id=AC-001` 或等价的简单“等于”表达式。

自然语言范围、数字区间或依赖未提供脚本的动态条件无法无歧义执行，会 fail-closed 返回 `AC_SELECTOR_UNVERIFIABLE`。每个选择器只能命中对应 `acceptance_id` 的 Case，各行并集必须与每个采用的正式 Run 实际 Case 集完全一致。

## Run 与 Result 契约

Trial 执行事实按 Run 独立归档于 `evolution/experiments/EXP-<agent-id>-NNN/runs/<run-uuid>/`：

| 文件/目录 | 内容 |
|---|---|
| `run.yaml` | run_id、experiment_id、agent_id、kind（formal/research/technical）、status（planned/running/completed/failed/cancelled）、snapshot_ref、plan_ref、created_at；formal 还必须绑定 `baseline_id`；finalize 时写入 `results_sha256` 与 `summary_sha256` |
| `inputs.lock.json` | Harness、spec、Case、计划、方法、评分代码、插件及附件的精确身份与摘要 |
| `environment.json` | 实际镜像身份、有效配置、模型标识与参数、环境初始条件；不存凭据 |
| `results.jsonl` | 逐 Case/Trial 执行事实（见下） |
| `summary.json` | 完成/失败/未执行数量、指标、逐 AC 结论、覆盖范围；由执行事实与评估方法计算 |
| `report.md` | 面向人的测试、评估和验收说明，引用事实与缺口，不另维护相矛盾分数（formal Run 必填） |
| `gaps.jsonl` | 本次发现、证据、影响、分类、假设、建议与待确认项 |
| `traces/`、`artifacts/` | 必要轨迹和任务产物；体积大时使用受管理的外部引用 |

`results.jsonl` 每行一个 Trial，字段：

```text
run_id,trial_id,case_id,baseline_id,status,score,safety_violation,duration_ms,input_tokens,output_tokens,tool_call_count,retry_count,cost_amount,cost_currency,resolved_model,failure_reason,evidence_ref
```

`run_id + trial_id` 唯一。同一 Run 只绑定一个 `baseline_id`，每个纳入 Case 的行数恰等于其 `required_trials`。`status=error` 时 `score` 必须为空；`status!=pass` 时 `failure_reason` 必填；`evidence_ref`、`tool_call_count`、`retry_count` 和 `safety_violation` 必填。

Run 创建后先写入 planned/running 状态；结束、失败或取消时 finalize 收尾。归档完成后不覆盖执行事实；重新评分应产生独立的评估记录，引用原执行产物，不能静默重写原 Run 的历史结论。模板六必须显式填写“本次结论采用的运行编号（Run ID）列表”；该列表必须恰好等于 A1 开发自测 Run 与 B2 中明确标为“是”的复跑 Run 的并集。顶部列表与 B2 任一处声称采用的 Run 都按当前结论检查，以免声明不一致隐藏阻断失败、安全违规、未解决 `error` 或 Trial 缺口。未采用的历史失败不得删除，也不得污染新结论。开发自测与纳入结论的 R3 必须使用同一冻结 Case 范围。

B2 的 R1 不产生复跑 Run；R2、R3 每次必须使用不同于开发自测及其他复跑的新 `run_id`，且无论是否纳入当前结论，都要能在该 Agent 的 Run 归档中定位。R2 结果只能写为`范围内通过`、`范围内不通过`或`范围内不完整`；R3 结果只能写为`通过`、`不通过`或`不完整`。纳入当前结论的复核只能是相应“通过”状态，明确的“不通过”或“不完整”必须阻断。任何声称“通过”的 R2/R3，即使未纳入当前结论，也必须满足该 Run 的阻断、安全、未解决错误和 Trial 完整性规则；如实记录为“不通过”或“不完整”的未采用历史 Run 不污染当前结论。R2 声明范围内通过时，机器检查至少验证其覆盖冻结正式范围中的全部 `blocking` 和 `safety` Case；本次交付影响 Case 的选择仍须人工核对。R3 声明通过时必须完整复跑与开发自测相同的冻结范围。

## 范围与结论边界

- 一般范围：每个完整正式 Run 至少 50 个有效 Case 和 50 条不同输入；输入的实质差异与逐条质量只能人工复核。
- 有限范围：必须证明适用前提、影响清单、路径边界、全部受影响及关联阻断/安全/回归用例、100% 覆盖，并在冻结前由交付负责人确认。任一项无法机器核实时，验证器按一般范围检查并报告缺口。
- 正式运行存在任一 blocking 失败、安全违规或适用硬门禁失败即“不通过”；没有实质失败但证据缺失为“不完整”；全部门槛满足才可记录“通过”。
- 机器结构校验不评价输入是否真的高质量、评分是否专业、AC 阈值是否合理、证据内容是否真实，也不授权交付或发布。
