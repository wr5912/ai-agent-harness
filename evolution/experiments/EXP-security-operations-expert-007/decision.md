# Decision

Decision: adopt

`run-109cfc2f-6a8a-4a60-bbbd-5145aeae6be4` 验证了 Agent 专属插件可在不修改 DSH Runtime 源码的前提下复用原生会话历史、输入框和右栏，呈现三栏安全运营工作台及 6 个快捷任务。`T-WEB-UI-LAYOUT` 与 `T-WEB-QUICK-ACTION` 均通过；风险处置卡片只写入带“只制定方案，不执行任何处置动作”的草稿，浏览器记录为 0 次 Prompt 请求和 0 条用户消息。

因此采用经该 Run 验证的 Web UI 变更。Run 的整体结论为 `inconclusive`，原因是 `T-CONTRACT-STATIC` 按合同保留人工语义判读；其仓库与 Experiment 确定性校验实际均通过，没有 UI Case 失败。右栏宽度继续使用 DSH 原生拖拽布局，不由插件覆盖。

结论只覆盖 Web 布局、插件装载和快捷任务草稿行为。自动化浏览器环境缺少中文字体时截图可能显示缺字，但 DOM 中文文本断言已通过；本次未验证快捷任务提交后的模型业务回答，也不构成生产部署验收。本 Experiment 不生成 Research Release。

## 后续扩展：自动化任务

EXP-007 Candidate 后续加入 `@deepseek-ai/dsh-experimental-schedule-bundle`，并将默认模型设为 `deepseek-flash`、推理强度设为 `off`；全新 HOME 的 Web 页面已显示该默认组合。2026-09-28 在隔离 DSH 容器实例中，以 Web 界面所示的 DeepSeek-V41-Flash、推理强度 Off 发起真实会话；主 Agent 成功创建测试任务。独立的「自动化任务」页面显示任务列表和详情，并可删除任务；删除后页面显示空列表。测试任务已删除，原会话保留。装载校验通过，且没有修改 DSH Runtime 源码。这仅验证创建、查看和删除路径；未验证定时触发、任务执行结果或其他业务测评结论。

后续门户 iframe 技术联调的拓扑、真实会话与认证/多用户限制集中记录于[门户联调记录](../../../docs/security-operations-expert门户联调记录.md)；它不是本 Experiment 的业务 Evaluation 或 Research Release。

## 后续扩展：语音插件

语音扩展 Decision：`continue`。本地 GitLab 检出提交 `4f24085f57a9112f087c0a5cef1d0b737e40a0ff` 的 `dsh-voice-hub` 已作为 Candidate 只读装载；其 Node 依赖从本机 `.local/` 只读挂载到同一个标准 DSH Runtime 镜像，未构建派生镜像。隔离实例 `security-operations-expert-voice` 使用镜像 ID `sha256:19bcfcc8d1a349ac5571cc967d66856194e1873ea6ddf6b938ca22f41db985ef`。

[`Qwen 浏览器 Run`](runs/run-fe58afad-133d-44fb-b92c-19bf74523083/report.md) 中，真实浏览器麦克风和远程 ASR 生成可编辑草稿，语音命令提交测试句，模型回复可见，点击朗读后浏览器解码 TTS 音频，`U-VOICE-001` 通过。[`默认 DeepSeek 浏览器 Run`](runs/run-e6a57ade-9cfe-4a47-9637-85e07ee423fe/report.md) 完成转写与发送，但模型请求被外部 MCP 服务提供的悬空 `#/components/schemas/PolicyValidity` 工具 schema 拒绝，未产生回复，`U-VOICE-001` 失败。上游 `prepare_policy_configuration` 的 `allOf` 引用未被 MCP 平台解析，是本次定位到的直接原因；共享服务未修改。

因此当前仅证实 Qwen 路径的语音技术闭环，默认模型和安全运营 MCP 业务链路尚未通过，连续对话和打断也未在本次 Run 复验。下一步需在 MCP 平台修正该工具的 schema 生成，再用默认模型重新执行 `U-VOICE-001`；此结论不改变上文 Web UI 变更的 Decision。既有 `security-operations-expert-lan` 和 `security-operations-expert-ui` 实例未变更，其旧镜像 ID 与新隔离实例不同；若要求所有运行实例立即统一镜像，仍需迁移这两个实例。
