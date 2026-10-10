# EXP-013 观察

EXP-013 的 Web 界面以 EXP-011 的 TSX、图标和完整交互为基础，纳入 EXP-012 新增的访问策略草稿、应急指令入口和巡检文案。2026-10-09 重启当前实例后，浏览器确认运行概览、8 个推荐任务、数字员工编辑入口、语音模式入口；点击推荐任务和数字员工卡片均能写入输入框。局域网浏览器可从插件列表打开 MCP 配置管理页，服务器和分组编辑区域正常呈现；“设置 → 模型”显示 DeepSeek 与 Local Qwen 提供商目录，无令牌访问返回 401。界面构建、类型检查和交互测试通过。本次未重新验证语音识别、播报服务或外部业务 MCP 上游调用。

MCP 配置管理页改为“MCP 服务器”“工具分组”“连接检查与 OpenAPI 来源”三个视图。初轮浏览器检查覆盖页面切换、编辑草稿跨视图保留、分组新增与删除、服务器删除后清理分组引用、刷新后恢复原值、分组链接与工具勾选，以及 390px 窄屏无横向溢出；当时的工具发现使用浏览器模拟响应。

2026-10-09 在 EXP-013 当前实例中完成实际端到端检查：通过浏览器新增临时 MCP 服务器并保存至 Web profile，刷新后配置仍在；[连接检查页面](evidence/mcp-web-connection-20261009.png)对受控 MCP 服务完成握手并发现两个工具。通过浏览器新建[仅开放一个工具的分组](evidence/mcp-group-20261009.png)并保存、刷新后，分组端点 `tools/list` 仅返回所选工具，`tools/call` 返回预期结果；无 Bearer 访问返回 401，调用未开放工具被拒绝。检查结束后通过页面删除临时分组和服务器，实际 profile patch 已核对不含测试配置。

同一实例的新 [Web Session](evidence/web-session-20261009.png) 用 DeepSeek 模型回答 `17 + 25`，页面得到 `42`；[设置 → 模型](evidence/model-settings-20261009.png)显示 DeepSeek 和 Local Qwen，未出现提供商目录加载错误。以上证明当前界面、Web 保存、受控 MCP 协议链路及基础模型回复；四个外部业务 MCP 的地址与凭据未在当前实例配置。

验收后重启 `security-operations-expert-exp013-web`；实例仍运行标准 DSH 镜像并只读装载 EXP-013 的 managed、presets 与 workspace。局域网 `172.16.138.228:3301` 的带令牌入口最终返回 200，无令牌请求返回 401。重启后的浏览器显示原有 4 个服务器、0 个测试分组，新 Web Session 再次得到 `42`，模型目录加载正常。

本地技术探针已核对 Web 保存写入 profile patch、分组端点的认证及 `tools/list`/`tools/call`、同名实例保留 HOME 后重建，以及新实例按 Candidate 种子恢复。受控 MCP 服务下，新 Agent 可以发现已开放且在业务 Guard 内的巡检工具；Preset 中另两个未获业务路由允许的工具未进入主智能体工具列表；受限子作用域的 `allow: []` 未发现 MCP 工具。针对 Guard 作用域查询的自动化测试见 `tests/experiments/test_exp013_mcp_scope_guard.mjs`。

随后按 OpenAPI 规范直连需求调整[新增服务器表单](evidence/mcp-openapi-new-form-20261009.png)：只填写 ID、可选描述、规范地址和可选 API Key；服务器内工具全部开放。浏览器通过该表单保存真实规范地址并刷新后，[连接检查](evidence/mcp-openapi-real-discovery-20261009.png)从 `http://172.16.138.232:18087/v3/api-docs/mcp` 动态发现 121 个操作，生成 86 个工具、13 个固定资源和 22 个资源模板。受控 OpenAPI 接口的端到端检查覆盖 Web 保存、API Key 请求头、资源读取、带参数工具调用、分组端点的 Bearer 认证和工具范围；同时加载真实规范与受控规范的新 Web Session 得到模型回复 `42`。临时服务器和分组已从实际 profile patch 清理。真实业务接口在未提供 API Key 时返回 401，未调用其写入类操作。

重新构建并重启 `security-operations-expert-exp013-web` 后，浏览器再次核对新增表单四项字段、原有 4 个服务器和新 Session 回复 `42`；实例仍从 EXP-013 Candidate 只读装载插件，实际 profile 中有 4 个原有服务器、0 个分组。

上述结果属于本地技术验证，没有封存的业务 Run。真实业务接口的认证调用、语音识别与播报及业务 Case 尚未验证，不能据此判断智能体业务效果。后续研究应在授权的业务环境中保存实际来源与 Run。
