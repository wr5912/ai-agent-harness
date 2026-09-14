# 变更记录

本文件记录仓库治理、目录契约和公共演进工具的变化。单个 Agent/Harness Release 的变更应记录在对应不可变 Release 中。

## [Unreleased]

- 尚无未发布变更。

## [0.1.0] - 2026-09-15

### 新增

- 建立项目级 `AGENTS.md`、最小 `.codex/config.toml` 和仓库演进技能入口。
- 纳入两份 Harness 仓库规范的受控原文，并锁定 `agent-engineering-spec` 来源提交与文件摘要。
- 定义 Baseline、Experiment、单一 Eval Set、Release/current 和 DSH 双平面的项目裁决。
- 提供旧资产摄取、演进、评估、安全、交付和 DSH Release 验收的项目工作流。

### 说明

- 本版本不导入 `security-operations-expert` 旧 Harness 或历史交付数据。
- 本版本不包含任何可部署 Agent/Harness Release，也未完成 DSH 实机验收。
