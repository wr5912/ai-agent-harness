# EXP-017 观察

2026-10-12。Baseline 为 `git:b3f439cc65f0c8430d50d7599a0488d15fdb12c4` 中 EXP-015 的 Candidate。对同一个 `tee` OpenAPI 规范地址，现场匿名 GET 返回 200，携带已配置的业务 API Key 返回 403；原实现对规范直接附加该 Key，因此「发现工具与资源」失败。Candidate 改为先匿名读取规范，仅在 401/403 且有授权配置时重试；实际工具和资源调用仍使用原授权。页面说明了这一顺序。

本地三项测试覆盖公开规范加业务 Key、受保护规范的 Key 回退、登录授权回退与缓存；全部通过。现场 `tee` 规范生成 90 个工具、14 个资源、25 个资源模板。原生成方式中 74/90 个工具 Schema 含 DSH 不支持的字段或引用；本 Candidate 在生成时转换为 DSH 接受的 Schema，重建后 90/90 个工具均通过 DSH `assertSupportedJsonSchema`。DSH 子集不支持的格式与对象映射约束未保留，递归引用退化为不约束该节点；本次没有验证这些参数的业务调用。

验证时的独立实例 `security-operations-expert-exp016-web` 使用标准镜像 `ai-agent-harness/dsh:21638c563-54f335ef05ac`（镜像 ID `sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc`），只读装载本实验 Candidate。重启后在真实浏览器选择 `tee` 并点击「发现工具与资源」，得到上述数量；[页面截图](evidence/tee-discovery.png)保留可见结果。`get_soc_asset_online_summary` 资源在现有业务授权下读取成功。Web profile 中创建 `tee-e2e` 分组，只开放 `list_soc_asset`；标准 MCP 客户端完成初始化，`tools/list` 仅返回这一项，`tools/call` 成功读取真实资产列表。无共享 Token 访问该分组返回 401。测试凭据仅保存在实例运行配置，未进入 Candidate 或证据。

同一上游的 `/soc/layer/list` 业务请求仍返回 403，插件保留此失败，不改为匿名调用。新 Session 已重新装载配置，但当前 `security-operations-guard.mjs` 的角色工具范围没有 `tee`，Agent 可见的 tee 工具数为 0；因此本次证明 Web 发现、Schema、MCP 分组与真实工具调用，不声称当前安全运营 Agent 已能自主调用 tee。要让 Agent 使用 tee，需要另行评估并修改角色工具范围。`tee` 服务器和分组是当前 Web profile 的工作态，新 HOME 需重新配置；本次未创建业务 Case Run 或 Research Release。
