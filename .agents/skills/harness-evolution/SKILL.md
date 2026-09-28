---
name: harness-evolution
description: 以 Research Mode 创建、修改、迁移或审计 DSH Harness Experiment，记录 Baseline 引用、Candidate、Evaluation、Decision 和可选 Research Release。用于 Harness 资产演进；不用于建设生产发布或权限治理平台。
---

# Harness 研究演进

用最短的可复现路径验证 Harness 变化是否有价值。不要把未来生产需求提前变成当前实验的基础设施。

## 工作流程

1. 按根级 `AGENTS.md` 确认本次涉及的对象、修改范围、保存位置和验证方式。
2. 选择 Baseline 引用：`git:<commit>`、`release:<id>` 或首次实验的 `none:first-experiment`。
3. 建立 `EXP-<agent-id>-NNN`，写清假设、预期观察、停止条件和 Candidate 变化。
4. 使用足以回答当前问题的最小 Evaluation。先从少量高价值输入开始；需要扩大结论时再补覆盖和回归。
5. 保存真实观察、失败、未知状态和限制，作出 `adopt`、`continue`、`reject` 或 `inconclusive` 决定。
6. 只有版本确实值得独立复用时，才生成自包含、不可变、可校验的 Research Release。

涉及目录、身份或 Release 时，读取[仓库演进不变量](references/repository-invariants.md)。需要检查仓库时运行：

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/harness-evolution/scripts/validate_repository.py [repo-root]
```

## 边界

- 每一处结构和字段都应服务当前研究、复现或装载；不添加未被当前问题使用的治理层。
- `candidate/` 是可修改工作树，不是生产候选或准入状态。
- Evaluation 不要求固定数量、REQ/AC、R1/R2/R3 或安全控制映射。
- DSH 源码、Session、缓存、附件和整个 `$DSH_HOME` 不进入 Harness 资产；平台和实例凭据保存在 Agent 的实例专用路径，LLM API Key 不进入 Git 或 Research Release。
- 源码修改后，用新进程或新 Session 核对实际装载；文件存在和脚本退出码 `0` 不等于假设成立。
- 校验器只检查确定性合同，不评价研究价值，也不授予发布或生产结论。
