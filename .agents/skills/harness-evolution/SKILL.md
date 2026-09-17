---
name: harness-evolution
description: 治理 Agent/Harness 从任务与验收标准到 Experiment、候选基线、评估和不可变 Release 的演进。适用于创建、变更、迁移或审计仓库管理的 Harness 资产。
---

# Harness 演进治理

从业务任务和 `AC-xxx` 开始，而不是从 Runtime 目录或配置格式开始。任何语义性 Harness 变更都进入独立 Experiment；禁止直接修改生产挂载资产。

## 决策流程

1. 绑定可核验的 `REQ-xxx`、唯一验收事实源中的 `AC-xxx`、影响范围和安全边界。
2. 只有关键不确定性会改变实施路线时，才用 5～20 条真实或近真实输入探索；否则记录 `development_path: direct` 并直接实现。
3. 将变更判为 A（普通优化）、B（能力边界）或 C（控制边界）；多类同时适用时叠加要求，无法判断时取更高影响。
4. 在 Experiment 中保留假设、变更、候选、评估和决定。针对性检查不能替代冻结范围的正式自测。
5. 冻结完整候选基线，评估并完成交付复核。只有通过的候选才沉淀为稳定 Baseline 和不可变 Release。
6. DSH 仅在容器中装载本仓库资产。隔离 Authoring 容器可读写当前 Experiment Candidate 的行为工作区并产生待审变更；受控配置、证据与生产 Release 不由模型改写。DSH 生产挂载具体 Release；`current/` 只能在发布通过后更新为同一 Release 的校验镜像。

涉及目录、命名、晋升关系或 Runtime 迁移时，先读 [仓库演进不变量](references/repository-invariants.md)。需要检查仓库时运行：

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/harness-evolution/scripts/validate_repository.py [repo-root]
```

校验器使用 PyYAML 的安全、节点与 alias 受限解析器检查 Harness YAML；缺少依赖时，对已物化 YAML 资产 fail-closed，不把文本外观当作有效配置。

## 边界

- Agent/Harness 是仅供容器内 DSH 装载的业务资产；DSH Preset 是其 Runtime 表达之一，不能把旧 Runtime 配置或宿主机 Codex 技能当作 DSH 可装载资产。
- 不存在或不适用的组件不得用空目录、空文件或虚假制品补齐。
- Runtime 迁移必须建立 Experiment。完成逐条领域复核、正式 Eval Set 和完整冻结组合后才能建立新候选基线；配置字段相似、容器构建或 Mock MCP 不构成行为等价证据。
- 验证器退出 `0` 只表示其机器不变量通过，不表示交付评估或发布通过。
