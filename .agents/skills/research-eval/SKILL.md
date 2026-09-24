---
name: research-eval
description: 为 DSH Harness Experiment 设计轻量比较，校验 Run 记录并总结观察、回归、限制和 Decision。适用于探索、A/B 比较和 Research Release 前的可复现性检查；不使用固定 Case 数或生产交付门禁。
---

# Harness 研究评估

评估的目标是回答当前研究问题，不是证明系统已经达到生产标准。

## 工作方式

1. 写出假设、Baseline 引用、Candidate 变化和本次允许得出的结论范围。
2. 在 `agents/<agent-id>/evaluation.md` 按[研究评估合同](references/experiment-contract.md)维护业务 Case；运行时显式选择足以回答当前研究问题的 Case。
3. 在一次比较运行期间保持 Harness、输入、方法和判断口径稳定。
4. 每个实际执行使用新的 `run_id`，把执行状态与证据结论分开记录，并保存可核对证据。
5. 先写失败和未知状态，再总结支持或反驳假设的证据。
6. 作出 `adopt`、`continue`、`reject` 或 `inconclusive` 决定，并写明限制和下一步。

业务 Case 优先只写可直接执行的用户输入和可观察、可核对的预期行为。动态事实不固定示例值、措辞或排版；需要调用工具的 Case，应以本轮真实工具回执核对关键结果，证据不足时记为 `inconclusive`。前置状态、工具或副作用限制只在确实影响判定时补充，公共执行与判定规则不在每个 Case 重复。

检查 Experiment：

```bash
python3 .agents/skills/research-eval/scripts/validate_experiment.py \
  evolution/experiments/EXP-<agent-id>-NNN
```

可先预览再运行受管评测：

```bash
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:EXP-<agent-id>-NNN --case '<case-pattern>' --dry-run
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:EXP-<agent-id>-NNN --case '<case-pattern>'
```

`--case` 必填、可重复并支持大小写敏感的 shell 风格通配符，通配符应加引号；匹配结果按 `evaluation.md` 顺序执行。每个 Case 使用新的被测 Session，多轮输入在该 Session 中依次发送；回复和同一 Session 的工具轨迹共同进入 Run，再按预期进行语义判定。

详细字段见[研究评估合同](references/experiment-contract.md)。

## 边界

- 不要求固定 50 Case、固定 Trial 次数、REQ/AC、R1/R2/R3 或统一分数阈值。
- 不创建 Experiment 本地 `evaluation/plan.yaml`，也不在 `evaluation.md` 维护 Experiment 选择表。
- 一个输入可以支持早期探索，但不能据此扩大到未覆盖任务、模型或环境。
- 自动校验只检查记录是否可解析、身份是否一致和必要字段是否存在，不判断观察是否真实或研究结论是否合理。
- 技术装载、容器启动、HTTP `200` 和 `/health` 不等于 Harness 行为有效。
- 评估材料可以在研究中演进；同一次比较中改变口径后，应重新执行受影响部分并明确说明。
