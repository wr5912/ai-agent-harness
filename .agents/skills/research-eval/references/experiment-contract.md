# 研究评估合同

本合同只规定可复现研究的最小记录，不设置生产交付门槛。

## 开始前

至少明确：

- Baseline 引用和 Candidate 变化；
- 要验证或反驳的假设；
- 输入及其选择理由；
- 实际运行环境和来源；
- 本次结论不能外推到哪里。

测试数据、评估方法、测试验收和 Experiment 选择只维护在 `agents/<agent-id>/evaluation.md`。Experiment 不保存本地 `evaluation/plan.yaml`。Run 的 `evaluation_ref` 指向该文件中的 Experiment 选择，`inputs.lock.json` 锁定当次文件摘要与所选 ID；这些运行事实不回写为第二份评测源。

### 评测预置

`测试数据` 必须依次包含唯一的 `### 测试预置` 和 `### 测试用例`。每个命名预置使用 `#### <领域>-F<两位序号> <名称>`，并依次且各声明一次 `**公共基线**`、Mermaid `flowchart` 主决策流程图、`**金标准**` 和 `**适用边界**`；仅在异常交互确有表达价值时增加 `sequenceDiagram`。固定事实可以在公共基线中使用表格；主分支关系必须由流程图表达，金标准只定义判定，适用边界只说明不可外推范围，不另建一套流程。

## Trial 记录

`results.jsonl` 每行是一个 JSON 对象，必填字段为：

- `run_id`
- `trial_id`
- `input_id`
- `execution_status`: `completed`、`error` 或 `skipped`
- `verdict`: `passed`、`failed` 或 `inconclusive`
- `observation`
- `evidence_ref`

`execution_status` 只描述是否真正执行完成，`verdict` 只描述证据支持的判断，二者不得混用。`error` 和 `skipped` 只能对应 `inconclusive`，`error` 还需非空 `failure_reason`。`input_id` 必须属于该 Run 锁定的 Experiment 选择；`evidence_ref` 必须是 Run 内指向非空文件或目录的安全相对路径。以下字段按需使用：`score`、`metrics`、`model`、`duration_ms`、`input_tokens`、`output_tokens`、`cost_amount`、`cost_currency`。不相关的字段不要用空字符串填充。

Run 创建时可以按 `evaluation.md` 中的顺序锁定全部选择或一个非空子集。只有每个锁定 Case 都至少记录一次结果，Run 才能以 `completed` 封存；基础设施失败应封存为 `failed` 或 `cancelled`，不能伪装成语义失败。

## 研究总结

Evaluation 或 Decision 应让读者直接找到：

- 实际比较了什么；
- 哪些观察支持或反驳假设；
- 是否出现回归；
- 失败、异常和未知状态；
- 结果受哪些模型、工具、环境或输入限制；
- `adopt`、`continue`、`reject` 或 `inconclusive` 的理由；
- 下一步是否需要扩大样本或生成 Research Release。

机器检查通过不代表这些内容语义正确，最终判断由研究者负责。
