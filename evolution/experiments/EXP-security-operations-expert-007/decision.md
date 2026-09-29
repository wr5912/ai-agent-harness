# Decision

Decision: adopt

`run-109cfc2f-6a8a-4a60-bbbd-5145aeae6be4` 验证了 Agent 专属插件可在不修改 DSH Runtime 源码的前提下复用原生会话历史、输入框和右栏，呈现三栏安全运营工作台及 6 个快捷任务。`T-WEB-UI-LAYOUT` 与 `T-WEB-QUICK-ACTION` 均通过；风险处置卡片只写入带“只制定方案，不执行任何处置动作”的草稿，浏览器记录为 0 次 Prompt 请求和 0 条用户消息。

因此采用本 Experiment 的 Candidate。Run 的整体结论为 `inconclusive`，原因是 `T-CONTRACT-STATIC` 按合同保留人工语义判读；其仓库与 Experiment 确定性校验实际均通过，没有 UI Case 失败。右栏宽度继续使用 DSH 原生拖拽布局，不由插件覆盖。

结论只覆盖 Web 布局、插件装载和快捷任务草稿行为。自动化浏览器环境缺少中文字体时截图可能显示缺字，但 DOM 中文文本断言已通过；本次未验证快捷任务提交后的模型业务回答，也不构成生产部署验收。本 Experiment 不生成 Research Release。

## 后续扩展：自动化任务

EXP-007 Candidate 后续加入 `@deepseek-ai/dsh-experimental-schedule-bundle`，并将默认模型设为 `deepseek-flash`、推理强度设为 `off`；全新 HOME 的 Web 页面已显示该默认组合。2026-09-28 在隔离 DSH 容器实例中，以 Web 界面所示的 DeepSeek-V41-Flash、推理强度 Off 发起真实会话；主 Agent 成功创建测试任务。独立的「自动化任务」页面显示任务列表和详情，并可删除任务；删除后页面显示空列表。测试任务已删除，原会话保留。装载校验通过，且没有修改 DSH Runtime 源码。这仅验证创建、查看和删除路径；未验证定时触发、任务执行结果或其他业务测评结论。

后续门户 iframe 技术联调的拓扑、真实会话与认证/多用户限制集中记录于[门户联调记录](../../../docs/security-operations-expert门户联调记录.md)；它不是本 Experiment 的业务 Evaluation 或 Research Release。

## 2026-09-28：在现有 007 Candidate 合并策略配置与应急指令

本段记录 Candidate 的后续实现，不改写前述 Web UI Run 的采纳结论，也不把旧 Run 当作两项新能力的业务验收。沿用 EXP-005 的单一 `security-operations-expert` Candidate / Preset 命名：在 007 内以 `policy-configuration` 和 `emergency-action` 两个独立 Skill、MCP 前缀、参数 Guard 和受信确认运行时接入。原巡检、故障、响应规划及自动化任务路由保留。策略单独“执行”与应急单独“确认执行”仅在同会话存在匹配有效草案时由各自运行时处理；模型直调确认或提交工具仍被拒绝。

007 来源合同把新增服务变量列为可选透传；缺失连接时 Profile 禁用对应 MCP 插件，原有 sec-ops 与 inspection 连接仍按原合同强制检查。新增控制边界见 Candidate 的 `control-boundary.yaml`。离线 Guard 回归 6/6、适配器与来源合同单测 99/99、仓库与实验确定性校验通过；这些结果证明配置和本地守卫行为，不等于 Workbench 或 SOC 的端到端验收。

提 MR 前补齐来源解析与 `dsh-dev` 对可选服务环境变量的透传：仅已设置的变量进入 Compose，实例状态只记录变量名，缺失变量不阻断旧能力启动。复核时适配器与来源合同单测 110/110、Guard 回归 17/17，仓库与 EXP-007 确定性校验均通过。当前镜像指纹包含 `source_contract.py`，因此该源码变更后的新实例需按仓库镜像身份规则更新镜像；本次复核没有重新构建或启动容器。

2026-09-29 使用已有锁定 DSH 镜像启动独立 `security-operations-combined-007:3113`，Candidate 文件以只读挂载装载。启动器在显式复用模式下核对镜像标签提交短号、DSH 包版本和锁文件摘要，未重新构建镜像。认证 Web 入口在本机和局域网均返回 HTTP 200；策略和应急 MCP 均可初始化，并各列出 6 个工具。新 HOME 的工作区注册和自然语言业务对话仍由访问该实例的用户验证。

策略 008 的 `ui-preview-overlay` 依赖其专用 Runtime 镜像；007 使用仓库全局 Runtime 锁，故本次未移植该专用镜像覆盖层。策略草稿、状态、候选排序、结果和受信确认已经接入，但 008 的专用预览样式仍待在统一 Runtime 上单独适配和页面验收。
