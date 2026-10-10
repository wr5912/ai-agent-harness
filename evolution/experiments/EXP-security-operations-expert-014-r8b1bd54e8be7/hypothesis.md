# 研究假设

以 `EXP-security-operations-expert-013-r26ecd1295ab4` 的 Candidate 为基础，合入并行 `EXP-security-operations-expert-013` 的 Web MCP 管理插件、配置种子与智能对话新增入口。主来源取自 `git:b46c12f7509865db92da91811d4f2adaf1b94c7e`，Candidate tree 为 `cdfbca9d8d0fc332ef03c1afea40af16fb5465c7`；并行来源取自 `git:bc9410a95a26806cfa4b7d975eda6b862bd9ffeb`，Candidate tree 为 `d414b97d2d1a036eddbc3cff76126c39150f8c05`。新实例应同时显示运行概览和 MCP 管理页；新 Session 应保留模型对话、委派和业务 Guard 的工具限制。本次同时按 Issue #3 固化的 `harness-experiment-fusion` 流程验证来源固定、自动装载检查与组合行为。

| 交叉修改点 | 融合取舍 |
| --- | --- |
| Web UI 与智能对话 | 保留主来源的实时运行概览、工具调用与 Skill 加载次数、中文默认语言和编辑数字员工；合入另一来源的策略与应急快捷入口，重新构建 `client.js`。 |
| MCP 注册与工具范围 | 使用并行 EXP-013 的 MCP 管理插件和 Web profile 种子；替换主来源启动 patch 中固定的四个 MCP client 注册，保留 Preset 的业务 `toolFilter` 与 Guard，避免同一服务器重复连接。 |
| 业务 Prompt 与 Guard | 保留主来源的四工具巡检合同、Skill 路由和委派；合入另一来源的知识查询兜底与按 Agent 作用域取工具的 Guard 修正。 |
| Runtime 与装载 | 沿用全仓 DSH 来源锁及当前标准镜像；三棵 Candidate 资产只读挂载，语音插件运行依赖需随实例挂载。Web profile 种子只在新 HOME 初始化时装载。 |

本次在融合后的 MCP 管理页增加 OpenAPI 服务器授权：凭据可指定 Header 字段；用户名密码使用可配置的登录地址和响应凭据字段，进程内复用凭据，HTTP 401 后重新登录一次。登录请求发送 JSON `username`、`password`；调用接口时按 OpenAPI 安全声明发送凭据。读取规范时默认以 `Authorization` 原值发送。

现成 MCP 服务在页面填写 Streamable HTTP URL 与请求 Header，保存在当前实例的 Web profile；工具分组页生成统一 Token，分组与智能体链接共用。Token 未生成时链接拒绝访问；Candidate 种子保留服务器和分组规则，移除凭据与 Token 值，缺少凭据的服务器在新卷中保持停用。

先验证融合资产的构建、装载、局域网浏览器中的模型设置、MCP 管理、智能对话、运行概览和语音入口，以及新会话中的组合行为。巡检服务目前的工具目录与 Candidate 四工具合同不一致；只有重新取得匹配服务并完成业务 Run，才能评价巡检业务效果。
