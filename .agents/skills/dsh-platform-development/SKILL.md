---
name: dsh-platform-development
description: 在 Research Mode 下实施已授权的 DSH 研究平台、通用 CLI 和 Runtime 适配器开发，复用现有接入并验证受影响路径。业务 Harness 语义变化转入 harness-guided-workflow；仅编写页面开发任务清单使用 dsh-platform-task-list。
---

# DSH 平台开发

任务分类与分支选择遵循[根级分支与开发工作流](../../../AGENTS.md#分支与开发工作流)。本技能用于落实当前研究需求中的平台和通用工具实现，远期平台设计本身不构成实施授权。

## 确定范围

- 阅读根级 `AGENTS.md`、`docs/standards/SOURCES.md`、`docs/standards/PROJECT-INTERPRETATION.md` 和[项目验收矩阵](../../../docs/ai-agent-harness项目验收矩阵.md)，确定受影响的 `PA-xx` 与可观察的完成条件。
- 核对目标入口、调用方、配置、构建与现有测试，检查 Git 工作树并保留已有改动。平台任务从[平台设计维护入口](../../../docs/platform-design/README.md)定位对应设计；涉及装载时读取[当前最小平台接入合同](../../../docs/platform-design/02_系统架构与部署设计.md#当前最小平台接入合同)。以当前源码和实际装载核实能力，不把计划当作实现。
- 需求足够明确时直接形成最小修改范围并实施，已有授权不重复确认；只有会改变目标或完成条件的缺失信息才需要澄清。

## 实施与接入

优先复用 DSH 和本仓库已有能力。按根级工程语言取向维护源码与构建制品，检查同一变化直接影响的调用方、配置与消费者。

全局研究平台的启动入口、Profile 与插件集中在 `platform/`；容器内业务 Agent 的 Harness 仍由对应 Experiment 的 Candidate 装载。修改平台接入时核对这两条来源链，避免把开发身份、平台 Profile 和业务 Preset 混用。

平台页面、启动器和通用查询工具按项目路径验证。若同时改变业务 Harness 语义，对该部分使用 [`harness-guided-workflow`](../harness-guided-workflow/SKILL.md)，分别保留工具验证与研究比较的结论。仅编写未来页面开发任务清单时改用 [`dsh-platform-task-list`](../dsh-platform-task-list/SKILL.md)。

## 验证与交付

运行受影响的现有确定性检查与测试。涉及 DSH 插件构建或装载时，核对构建产物和实际加载来源，以新进程或新 Session 验证；涉及用户界面交互时检查相应浏览器路径。静态规则或文档变更按其实际影响验证，不为此启动业务实例或创建 Run。

完成前按[项目审查原则](../../../docs/项目审查原则.md)检查本次差异、链接、配置与敏感信息。将项目验证结果和缺口更新到验收矩阵对应路径，研究事实留在实际涉及的 Experiment 中。报告已验证内容、未验证内容与适用边界；是否提交、推送或发布仍按根级授权规则执行。
