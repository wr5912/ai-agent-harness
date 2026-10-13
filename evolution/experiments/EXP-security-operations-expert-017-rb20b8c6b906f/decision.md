# Decision：adopt

2026-10-12。采纳本次 MCP 配置管理插件的规范读取顺序及 DSH Schema 转换：`tee` 在浏览器可发现能力，分组端点仅开放选定工具，真实业务调用成功；受保护规范仍可授权读取，业务 403 保持原样。证据和限制见 [Evaluation 观察](evaluation/observations.md)。本决定只覆盖插件技术链路；Agent 使用 tee 的 Guard 范围和上游 `/soc/layer/list` 权限不在此次采纳结论内。
