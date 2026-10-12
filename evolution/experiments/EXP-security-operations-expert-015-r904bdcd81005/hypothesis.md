# 研究假设

基于 `git:b3bf78c530dc0af3840da2d8b5030f9691a6d94f` 中的 EXP-014 Candidate。Web profile 管理 `sec-ops`、`inspection`、`policy-configuration`、`emergency-action` 四个模型可见的现成 MCP 连接；经验证的非敏感定义回流本 Candidate 的 `web-profile.seed.patch.yml`。新 HOME 从种子恢复服务器定义，在 Web 中补充凭据并启用；保留 HOME 的同名实例重建应保留当前 Web 配置。Token 和请求 Header 值不得写入 Candidate 或 Run。

实际巡检服务只提供 `list_executable_inspections`、`start_inspection`、`get_inspection_result`。同步更新 Skill、Guard、角色矩阵和评估口径后，新 Session 应能先查可执行模板、对真实常规模板发起一次巡检、沿同一 `runId` 查询结果，准确展示设备数量、结论、报告和可用下载地址。旧四工具应被拒绝。

模型可见的四个连接不再由启动环境变量重复注册。`SOC_MCP_BASE_URL`、`REPORT_MCP_URL`、`POLICY_CONFIGURATION_MCP_URL`、`SEC_OPS_MCP_TOKEN` 和 Workbench 变量仍供受信业务代码调用；`REPORT_MCP_URL` 不注册为第五个模型工具连接。原 OpenAPI 规范是否出现 `ai_soc_*` 操作只按实际规范判断，不将不存在的操作列为通过。

选 `U-INS-002` 验证只读目录，`U-INS-001` 和 `U-INS-007` 验证发起、完成与续查，再用故障只读、策略草稿、应急草案各一个新 Session 检查路由隔离。只使用真实常规巡检；不执行策略或应急确认。业务 Run 以实际工具轨迹和服务回执判断，容器启动、页面加载和静态测试仅是装载证据。外部服务中断、凭据失效或缺少设备数量时，结论保持 `continue` 或 `inconclusive`，不推断业务通过。
