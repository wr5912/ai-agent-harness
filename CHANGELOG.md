# 变更记录

本文件记录仓库治理、目录契约和公共演进工具的变化。单个 Agent/Harness Release 的变更应记录在对应不可变 Release 中。

## [Unreleased]

### 新增

- 将 `security-operations-expert` 旧 Harness 的业务语义迁入 DSH 容器候选 Preset、Skill、受控 Profile、MCP 声明、角色工具矩阵和原生 Guard；旧活动 Hook、权限配置和宿主部署文件不进入可装载树。
- 保存四域初版交付的清洗历史、逐文件来源清单和 200 条待领域复核输入，不创建正式 Eval、候选基线、Release 或 `current/`。
- 增加锁定 DSH 源码的薄容器适配层和 Authoring/Verification 分阶段挂载契约。
- 为两种容器模式固定用户 Patch、Web Profile manifest、全局指令与 Boot `.env` 的只读层；将官方安装模块 fallback 离线预生成并只读装载，阻断可写数据卷中的同名包覆盖。装载探针核对镜像内脚本、精确挂载、模块解析与候选摘要，但不把这些局部证据当作 Plugin/业务验收。

### 边界

- 当前唯一交付结论仍为“退回整改”；容器技术检查与确定性插件单测不能替代真实模型/MCP 的 R3 业务评估。

## [0.1.0] - 2026-09-15

### 新增

- 建立项目级 `AGENTS.md`、最小 `.codex/config.toml` 和仓库演进技能入口。
- 纳入两份 Harness 仓库规范的受控原文，并锁定 `agent-engineering-spec` 来源提交与文件摘要。
- 定义 Baseline、Experiment、单一 Eval Set、Release/current 和 DSH 双平面的项目裁决。
- 提供旧资产摄取、演进、评估、安全、交付和 DSH Release 验收的项目工作流。

### 说明

- 本版本发布时尚未导入 `security-operations-expert` 旧 Harness 或历史交付数据；导入属于上方未发布变更。
- 本版本不包含任何可部署 Agent/Harness Release，也未完成 DSH 实机验收。
