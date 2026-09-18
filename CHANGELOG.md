# 变更记录

本文件记录仓库治理、目录契约和公共演进工具的变化。单个 Agent/Harness Release 的变更应记录在对应不可变 Release 中。

## [0.2.0]

### 新增

- 将 `security-operations-expert` 旧 Harness 的业务语义迁入 DSH 容器候选 Preset、Skill、受控 Profile、MCP 声明、角色工具矩阵和原生 Guard；旧活动 Hook、权限配置和宿主部署文件不进入可装载树。
- 保存四域初版交付的清洗历史、逐文件来源清单和 200 条待领域复核输入，不创建正式 Eval、候选基线、Release 或 `current/`。
- 增加锁定 DSH 源码的薄容器适配层和 Authoring/Verification 分阶段挂载契约；为两种容器模式固定用户 Patch、Web Profile manifest、全局指令与 Boot `.env` 的只读层，并阻断可写数据卷中的同名包覆盖。
- 事实源与目录契约重构：验收事实源移至 `agents/<agent-id>/spec/acceptance.yaml`（未物化时交付记录模板一暂代）；Case 事实源移至 `agents/<agent-id>/eval/cases.jsonl`；待复核输入唯一允许位于 `agents/<agent-id>/eval/pending/`；Trial 事实按 `runs/<run-uuid>/results.jsonl` 独立归档，`delivery/eval/` 不再保存 facts 文件。200 条待复核输入迁入 `agents/security-operations-expert/eval/pending/cases.pending.jsonl`。
- 来源解析扩展：`source_contract.py` 支持 `experiment:<id>`、`snapshot:<snap-id>`、`release:<name>` 选择器，并按优化执行/被测执行/评分分析三种角色生成挂载计划，被测侧与评分侧判分材料隔离。
- `mutation-receipt.py research-snapshot` 物化完整研究快照：候选元数据、Harness 树、spec、eval 与依赖身份一并冻结，附逐树摘要与完整性复核；旧 `fr-*` 三树冻结保留可用。
- `run_record.py` 提供 Run 全生命周期：init 固定输入身份、record 逐 Trial 追加、gap 记录问题、finalize 收尾并封存 results/gaps 摘要；已收尾 Run 拒绝再写。
- 校验器新增 Agent spec/eval/issues、Experiment runs/snapshots 契约校验，并去除单一迁移实验硬编码；交付校验器改读 spec/eval/runs 事实源，删除 results.csv 读取路径。测试覆盖范围扩展到选择器、快照往返与篡改检测、Run 收尾封存、spec 与交付记录一致性、pending 与旧路径门禁。
- 开发启动器 `dsh-dev`：按 `experiment:`/`snapshot:` 选择器渲染仓库外实例 Compose（host 网络、只绑定宿主回环、每实例独立 HOME 卷），提供 `image build`、`plan`、`up`、`ps`、`url`、`logs`、`down`；`url` 只从本次进程日志取认证 URL 并做 Token→Cookie→根页探针，非交互输出必须显式 `--non-interactive`。
- 受控技术装载辅助：`stub-mcp-streamable-http.mjs` 提供只含 `initialize`/`notifications/initialized`/`tools/list` 的回环 MCP 桩，`derive_mcp_stub_tools.py` 只从候选 MCP 声明派生工具原始名并对无法解析的超长引用失败关闭，使 fail-closed 的 MCP 候选在缺少真实端点时仍可核验装载。

### 变更

- Experiment `evaluation/` 重组为 `evidence/` 与 `tools/`；镜像构建证据与变更回执写入 `evaluation/evidence/`；`test_security_guard.mjs` 移至 `tests/experiments/`。
- `harness.yaml` 的 `loadable_assets` 只保留运行时装载资产；`pending_delivery`/`pending_cases` 从候选装载声明中移除。
- 受控适配层安全摘要随 `source_contract.py`、`mutation-receipt.py`、`build-image.sh` 的既有变更重新审查并同步。
- `role-tool-matrix.yaml` 的父级直连集合把残留的超长旧工具名改为已登记公开号；校验器新增“技能、角色矩阵与父级直连集合中的超长 MCP 工具引用必须登记公开号”的失败门禁，仓库测试增至 146 项。

### 边界

- 当前唯一交付结论仍为“退回整改”；容器技术检查、本地 MCP 桩与确定性插件单测不能替代真实模型/MCP 的 R3 业务评估。
- `dsh-dev open/resume/fresh`、`release:<id>` 选择器与逐例驱动 DSH 的评测执行器仍未实施；其来源解析、快照、挂载计划与 Run 台账前置契约已交付。

## [0.1.0] - 2026-09-15

### 新增

- 建立项目级 `AGENTS.md`、最小 `.codex/config.toml` 和仓库演进技能入口。
- 纳入两份 Harness 仓库规范的受控原文，并锁定 `agent-engineering-spec` 来源提交与文件摘要。
- 定义 Baseline、Experiment、单一 Eval Set、Release/current 和 DSH 双平面的项目裁决。
- 提供旧资产摄取、演进、评估、安全、交付和 DSH Release 验收的项目工作流。

### 说明

- 本版本发布时尚未导入 `security-operations-expert` 旧 Harness 或历史交付数据；导入属于上方未发布变更。
- 本版本不包含任何可部署 Agent/Harness Release，也未完成 DSH 实机验收。
