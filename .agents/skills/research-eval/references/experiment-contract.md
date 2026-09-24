# 研究评估合同

本合同只规定可复现研究的最小记录，不设置生产交付门槛。

## 开始前

至少明确：

- Baseline 引用和 Candidate 变化；
- 要验证或反驳的假设；
- 输入及其选择理由；
- 实际运行环境和来源；
- 本次结论不能外推到哪里。

业务 Case 只维护在 `agents/<agent-id>/evaluation.md`。Experiment 不保存本地 `evaluation/plan.yaml`，也不在评测文件中维护选择表。运行时通过 `--case` 显式选择；Run 的 `evaluation_ref` 指向该文件，`inputs.lock.json` 锁定所选 Case 的快照。

### Case

每个 Case 使用 `#### U-<ID> <名称>`，正文只写 `**用户输入**` 和 `**预期**`。输入使用 Markdown 引用块；多轮输入依次写成 `**用户输入 1**`、`**用户输入 2**`，并在同一 Session 执行。动态事实按同轮真实工具证据核对，不固定措辞或排版。

技术装载、合同和工具链检查不写成业务 Case，由对应项目测试和验收项覆盖。不同来源、维护阶段或措辞变体不构成复制同一 Case 的理由。

## Trial 记录

`results.jsonl` 每行是一个 JSON 对象，必填字段为：

- `run_id`
- `trial_id`
- `input_id`
- `execution_status`: `completed`、`error` 或 `skipped`
- `verdict`: `passed`、`failed` 或 `inconclusive`
- `observation`
- `evidence_ref`

`execution_status` 只描述是否真正执行完成，`verdict` 只描述证据支持的判断，二者不得混用。`error` 和 `skipped` 只能对应 `inconclusive`，`error` 还需非空 `failure_reason`。`input_id` 必须属于该 Run 锁定的 Case；`evidence_ref` 必须是 Run 内指向非空文件或目录的安全相对路径。以下字段按需使用：`score`、`metrics`、`model`、`duration_ms`、`input_tokens`、`output_tokens`、`cost_amount`、`cost_currency`。不相关的字段不要用空字符串填充。

Run 创建时必须显式锁定一个非空 Case 集合，并按 `evaluation.md` 顺序保存其输入和预期快照。只有每个锁定 Case 都至少记录一次结果，Run 才能以 `completed` 封存；基础设施失败应封存为 `failed` 或 `cancelled`，不能伪装成语义失败。

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
