# 研究假设

在 EXP-012 业务配置基础上恢复 EXP-011 的完整 Web 界面，并保留 EXP-012 新增的快捷任务。DSH Web 管理插件接受 ID、可选描述、OpenAPI 规范地址与可选 API Key，按规范动态生成 MCP tools/resources；服务器内工具全部开放，分组链接可进一步选择工具。原有四个现成 MCP 连接继续可用。当前实例配置保存到 Web profile，验证后回流到 Candidate 种子；新实例从种子装载。业务 Guard 与子智能体 `toolFilter` 继续按角色限制 Agent 可见工具。

核对 Web 保存与 profile patch、真实规范的工具和资源发现、受控 API Key 调用、分组端点、新会话装载、同名实例重建及新卷恢复。目标业务 API 的认证调用和模型参与的业务 Case 另行验证；未执行时保留为未知。
