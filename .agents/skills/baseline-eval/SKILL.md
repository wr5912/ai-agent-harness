---
name: baseline-eval
description: 校验候选基线交付记录、Eval Case、Trial 结果、范围证据和追溯关系。适用于正式自测、回归、R2/R3 复核或发布前证据检查；不用于仅凭机器检查宣告交付通过。
---

# Baseline 与评估校验

先确定正在检查的是探索、针对性检查、R2 范围复核，还是完整正式评估运行；它们允许形成的结论不同。候选 `baseline_id` 只是被冻结的待测组合，不代表已经通过。

## 工作方式

1. 先按根级 `AGENTS.md` 的四类对象确认本次检查的是什么：候选 Harness 资产、需求与评测资料，还是运行记录；三者证据来源不同，不能互相替代。
2. 检查前读取 [交付与评估契约](references/delivery-contract.md)。
3. 对 Agent 项目运行：

   ```bash
   python3 .agents/skills/baseline-eval/scripts/validate_delivery.py <agent-project>
   ```

4. 先处理已确认的实质失败，再处理证据缺口；不得用“不完整”隐藏硬失败。
5. 报告机器可证事实与人工复核项，不把退出码 `0` 表述为正式评估、交付评估或发布通过。

## 不变量

- 项目特有阈值只来自 `agents/<agent-id>/spec/acceptance.yaml` 的 `AC-xxx`。仅在该文件尚未物化时，交付记录模板一暂代阈值来源；物化后模板一不再是阈值来源。评估记录只定义评估实现，不复制阈值。
- Eval Set 只有一个 Case 事实源，逻辑子集用标签表达；Trial 不增加 Case 或不同输入数。
- 一般范围至少 50 个有效 Case 和 50 条逐条质量复核的不同输入。有限范围任一证明缺失时，按一般范围 fail-closed。
- 每次正式执行使用新 `run_id`；同一候选基线重跑保留 `baseline_id`，冻结项改变则两者都更新。
- R2 只能形成范围结论；R3、正式自测和正式回归才能按完整规则形成正式评估运行结论。
