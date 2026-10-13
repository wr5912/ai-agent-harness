# EXP-014 观察

2026-10-09。以 `git:b46c12f7509865db92da91811d4f2adaf1b94c7e` 中的 `EXP-security-operations-expert-013-r26ecd1295ab4` 为主，融合并行 `EXP-security-operations-expert-013` 的 MCP 管理资产，得到本 Experiment 的单一 Candidate。`sources.json` 已登记新来源；`security-operations-expert-exp014-web` 使用全仓标准 DSH 镜像 `ai-agent-harness/dsh:21638c563-54f335ef05ac`，镜像 ID 为 `sha256:af81ca8e4e059329c951e269320f9e819d56346ea6135bfc15992cf387634920`。实例的 workspace、managed、presets 和语音插件依赖均为只读挂载，HOME 为运行态可写卷。来源合同测试通过；隔离 `verify-load` 的 Docker 探针卡住，未将其计为通过。

浏览器在当前实例核对了智能对话、运行概览、插件列表中的 MCP 配置管理三页，以及“设置 → 模型”的 DeepSeek 与 Local Qwen 目录。新 Web Session 提问 `17 + 25`，得到 `42`，见[页面证据](evidence/web-chat-20261009.png)。语音服务检查中的流式识别、批量识别和语音合成均返回成功；浏览器使用虚拟麦克风完成“这是语音测试。”转写、语音指令“确认发送”、新 Session 中的智能体回复，并触发回复音频解码和播放。语音浏览器测试将局域网 HTTP 地址显式设为安全来源；普通浏览器要使用麦克风，仍需满足浏览器的安全来源要求。

MCP 管理页可保存服务器及工具分组到当前 Web profile。受控 OpenAPI 服务的浏览器验收覆盖自定义凭据 Header、用户名密码登录、凭据复用、HTTP 401 后重新登录、工具与资源发现、分组端点只开放所选工具以及新会话装载。临时服务器与分组已清理，当前 profile 恢复为四个原有服务器、零个分组。仓库与 Experiment 校验无错误；来源合同 20 项、`dsh-dev` 89 项、OpenAPI 3 项及两项 Web UI 脚本均通过。

当前四个服务器的接入信息保存在 Web profile：现成 MCP 服务使用 URL 与请求 Header，OpenAPI 服务使用规范地址及授权设置。浏览器验证了现有服务器可切换到 OpenAPI 编辑表单并在切回时恢复原连接，见[界面证据](evidence/mcp-existing-server-openapi.png)；另用停用的临时服务器验证 MCP 转 OpenAPI 后保存、刷新读回及清理，结束时仍为原有四个服务器。

2026-10-10，浏览器在“工具分组”页生成并更换统一 Token；未配置和旧 Token 均被分组端点拒绝，新 Token 可访问。页面效果见[工具分组界面](evidence/mcp-groups-token-20261010.png)，截图中的 Token 保持遮蔽。受控 Streamable HTTP MCP 服务通过页面保存的自定义请求 Header 完成工具发现；分组只开放选中的 `ping` 工具，调用返回 `pong`，错误 Token 返回 HTTP 401。临时服务器和分组已清理。随后 `mcp-promote` 将当前 Web 配置写回 Candidate 种子，摘要为 `43a35b8039f271f1c17ced67d36e68c5026d9db05b0aa9d0ea39cee1ed3d8797`。同名实例重建保留 HOME 和已生成的 Token；新实例、新 HOME 从种子自动加载插件及四个服务器，Token、密码、API Key 和请求 Header 值为空，需凭据的服务器保持停用。新建 Web Session 提问 `17 + 25` 再次得到 `42`。这些验证支持本次配置管理与恢复路径，不代表外部业务 MCP 已通过。

“工具与资源”页现在分别列示工具、Resources 和 Resource Templates；现成 MCP 表单不再要求 OpenAPI 管理 API 地址。浏览器经真实插件接口连接本机受控 Streamable HTTP MCP 服务与 OpenAPI 规范，验证了两种接入方式的表单保存和资源列表展示，临时服务器已清理。运行实例的 `policy-configuration` 实际发现 6 个工具、0 个 Resources、0 个 Resource Templates；不能据受控服务的结果推断该外部服务提供资源。

提供的登录接口 `http://172.16.138.223:18080/login` 已实测返回 `data.token`；该凭据可访问同一服务的受保护接口。该服务 `/v3/api-docs/mcp` 的 40 条路径以及 `/v3/api-docs` 的 193 条路径和操作 ID 均未包含 `ai_soc_*`；原定规范地址 `http://172.16.138.232:18087/v3/api-docs/mcp` 当前无法连通。因此尚未把 `ai_soc_*` 注册为真实 MCP 工具，也未执行其业务调用或封存业务 Run。当前实例 Web profile 保存登录设置；Candidate 种子保留登录地址和用户名，清空密码，登录后取得的临时凭据没有写入 Candidate 或研究证据。真实业务规范可访问后，需按其安全声明新建服务器并以新 Session 验证工具发现和调用。

本次证据支持融合资产装载、基础 Web 与语音交互，以及授权机制的技术链路；不支持判断 `ai_soc_*` 业务效果或本 Experiment 的研究采纳。

2026-10-10 对 Candidate 种子指向的巡检 MCP 入口做了只读协议复测，见[探测记录](evidence/inspection-mcp-probe-20261010.json)。`initialize` 返回 HTTP 200 并签发 Session；未携带 Session 的 `server/discover` 虽为 HTTP 200，JSON-RPC 实为 `-32601 Method not found`；未携带 Session 的 `tools/list` 返回 HTTP 500。按 `initialize → notifications/initialized → tools/list` 并传回 `Mcp-Session-Id` 后，服务返回三个工具：`list_executable_inspections`、`start_inspection`、`get_inspection_result`。只读调用 `list_executable_inspections` 成功，返回五个可执行模板。上述 HTTP 500 仍是无 Session 请求的错误处理问题，不能由此判定有效会话下的工具目录失败。

现行服务目录与 Candidate 的四工具巡检 Skill、Guard、角色工具矩阵及 `U-INS-001/002/007` 判定口径存在语义差异，尚不能据三工具目录把四工具业务 Run 判为通过。历史文档所指的四工具服务入口本次连接被拒绝；未发起新巡检运行。当前运行的 `security-operations-expert-exp014-web` 只读挂载来自 `ai-agent-harness-copy1` checkout，而非本工作树；其 Web profile 中巡检服务器有 `enabled: true` 的运行态覆盖配置。后续 Candidate 修改须在目标来源的新实例和新 Session 中核验。

同日重新获取三处 OpenAPI 规范，见[只读发现记录](evidence/openapi-spec-probe-20261010.json)。此前不可达的 `18087/v3/api-docs/mcp` 现返回 HTTP 200，包含 101 条路径和 122 个 Operation；`223:18080` 的两处规范也可达。三处规范均没有 `ai_soc_*` Operation ID。当前 MCP 管理插件以 Operation ID 生成工具名，因此规范恢复可达只缩小了连接差距，尚未提供预期的 `ai_soc_*` 业务工具；未执行授权业务调用。
