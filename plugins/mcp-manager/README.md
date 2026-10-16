# 通用 MCP 配置管理器

此目录是平台使用的通用 MCP 配置管理器源码，维护 OpenAPI/MCP 连接、工具资源分组与调试。平台构建不读取用户工作区的 Candidate。

初始源码提取自 `git:9afc8fd0047367deb9df5b51595f101835359044` 中 `evolution/experiments/EXP-security-operations-expert-018-rfbf7fd53a340/candidate/dsh/managed/mcp-manager/`。既有 Candidate 保持历史身份，平台版本从本目录独立维护。平台适配仍在 `platform/plugin/build.mjs`，依赖由平台插件包锁定。
