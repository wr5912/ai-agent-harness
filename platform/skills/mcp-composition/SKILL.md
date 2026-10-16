---
name: mcp-composition
description: 平台管理助手通过原生 MCP 配置与工具组合编排维护连接、草稿及固定发布版本，并验证实际调用结果。
---

# MCP 工具组合

根据受信任系统上下文定位当前工作区和程序根，先明确用户要编辑编排、发布版本还是实际执行。通过 `platform_mcp` 发现当前连接、工具资源和组合目录；业务语义以已启用扩展的工具描述及 Skill 为准，不猜测操作名、输入字段或成功码。

原生 MCP 连接设置由 MCP 配置管理插件维护，编排定义、草稿和发布快照由数据根 `config/mcp-compositions.json` 维护。两者通过已登记的连接 ID 对接，不另存连接或凭据副本。用工具保存和发布，经平台现有提案确认后回读；不要直接改配置文件绕过摘要锁和验证。

1. 读取连接及实际工具的输入结构。对已有组合仅做 dry 时，list 中的目录、revision 和组合定义已足以构造请求，不把资源发现当作前置条件。确需连接发现时使用 configuration 中实际登记的 serverId，不能拿组合 ID、工具名或猜测的 compositions 代替；sources/list 也必须携带 serverId。必要时用原生测试或资源发现核验连接。HTTP 200、工具发现成功和业务调用成功分别报告。server not found 或猜测名称的 disconnected 先核对请求的 serverId，不能据此判断真实连接或分组故障；list 中 specLoaded:false、toolCallSucceeded:false 仅表示当前注册表尚未观测到该状态，不等于服务不可用。
2. 编辑草稿时固定工具 ID、参数映射、分支及子组合来源。组合引用具体已发布版本；子组合再次发布不会自动更换父组合的依赖。
3. 保存草稿后执行 dry 校验，携带当前目录摘要及选定组合。dry 仅检查输入、图和连接登记，不执行上游工具；通过后再按用户要求发布。并发冲突先重新读取，不覆盖他人变化。用户只要求只读或 dry 时，失败后仅核对并修正参数，仍不成功就报告具体缺口；不得转而提交 executeComposition、callPublishedComposition、callTool、保存或发布来证明 dry 能力。
4. 已发布工具在原生“工具组合编排”服务分组中发现和选择，保存分组后调用方重新发现。草稿不对外提供。首次调用前确认实际输入和必要授权；回读冻结版本、每步结果、失败停止和外部保存回执。
5. 已启用的业务扩展返回 run_id 时，用 `compositionRun {run_id}` 回读阶段、校验及保存状态，需要原始产物时用 `compositionArtifact {run_id,artifactId}`；已完成阶段不重新采样。执行中断或结果未知时先检查已有 Run 或操作 ID，不默认重试可能产生副作用的步骤。完成状态不能代替业务校验与保存均成功；如实报告未验证项。

保存草稿使用 `saveCompositionDraft {revision,compositionId?,draft}`，测试使用 `dryRunComposition {revision,compositionId,version:"draft"|"published",input}`，发布使用 `publishComposition` 的同一选择参数且 version 为 draft。revision 和 ID 必须来自最新 `list`，不要将字段改成 catalogRevision、versionId 或 arguments；draft 结构沿用已有模板或实际返回配置，不创造执行器未支持的任意步骤。发布后调用 `callPublishedComposition {toolName,input}`，平台提案会固定实际发布版本。

当前界面只显示已装载执行器和业务扩展提供的模板与能力。安全运营扩展启用后，资产告警及威胁分析样例使用其 `security-operations-composition` Skill；未发现该技能或工具时说明能力缺口，不创建替代数据副本。

只有用户任务需要修改平台实现时才进入程序根 `platform/plugin/` 开发和验证，使用程序根入口 `platform/dsh-platform prepare` 装载新构建。普通编排管理通过页面及平台工具完成；不改变业务 Agent 的 Harness，不以重启服务或模型结束代替真实调用验收。
