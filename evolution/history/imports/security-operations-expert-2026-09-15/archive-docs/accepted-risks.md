# 已接受风险与外部边界

本文件记录本轮不能由 Workspace 单独消除、但在 `personal-debug` 使用范围内被明确接受的风险。
“接受”不是“已修复”；任何生产或多租户部署都必须重新评审。

## AR-01：个人调试父会话仍可见部分精确只读 MCP

- 状态：`ACCEPTED-PERSONAL`
- 范围：单用户、人工在环、非生产数据的本地调试。
- 原因：项目 settings 的 `allow` 可保留为调试便利的精确只读工具；不允许 server-wide wildcard。
- 补偿控制：mutation 进入 `ask`，系统破坏进入 `deny`；专职子 Agent 仍使用精确工具面；checker
  阻止 broad `mcp__sec-ops__*`。
- 明确例外：Workbench response/policy intake、`inspection.execute` starts-job 和 threat
  `submit_report` report-write 可精确 allow；它们不属于纯只读，禁止 wildcard 扩张。
- 退出条件：转为无人值守、生产、多租户或共享凭据时，Runtime 必须按 route 生成 exact tool surface，
  父会话不得再持有专职底层 MCP。

## AR-02：项目设置不是不可覆盖的生产信任根

- 状态：`OUT-OF-SCOPE`
- 范围：组织级 managed settings、服务端 `canUseTool`、tenant 隔离、凭据 scope。
- 原因：这些能力不在 Workspace 包内实现。
- 必需外部门禁：固定 project-only setting source 或程序化注入；禁用 Auto Memory；managed deny/hooks；
  tenant filesystem/network isolation；server-side token scopes；可信 metadata 与 session/request binding。
- 退出条件：部署仓库提供可审计实现及 staging runtime evidence。

## AR-03：`ask` 依赖真实交互式宿主

- 状态：`ACCEPTED-PERSONAL`
- 风险：无交互后台 Runtime 如果错误处理 `ask`，可能阻断流程或产生不确定行为。
- 补偿控制：Workspace 声明 personal-debug；无人值守 Runtime 不得直接复用该 profile，应使用
  route-scoped `dontAsk` 与精确 allow/deny。
- 验证：个人调试验收需真实确认一次 mutation；后台部署需独立 contract test 证明未知工具 fail-closed。

## AR-04：Threat Analysis MCP 的真实运行绑定

- 状态：`PARTIAL`
- 风险：Workspace 通过专职 `threat-analysis` Agent 的 inline `mcpServers` 使用
  `${THREAT_ANALYSIS_MCP_URL}` / `${THREAT_ANALYSIS_MCP_TOKEN}` 自描述连接需求，并从父上下文移除
  Threat server；静态占位符仍不能证明真实端点身份或工具 Schema。
- 原因：敏感真实 URL/Token 不得固化进可导入包。
- 补偿控制：Manifest 明确依赖；启动 preflight 必须解析占位符并验证 server identity、精确 tool set 和
  schema hash。
- 未闭环：当前 Workspace 静态 checker 无法证明目标 Runtime 已完成注入。

Inspection MCP 同样只在 `inspection-agent` 的 inline `mcpServers` 自描述并从父上下文移除；其真实
endpoint、凭据 scope 与 Schema 也必须由外部启动 preflight 验证。

项目 `permissions.allow` 中为专职 Agent 列出的精确 MCP 名只是继承后的 permission 判定，不会让未连接
inline server 的父上下文发现这些工具。真实 tool surface 仍以父/子上下文各自建立的 MCP 连接和 Agent
`tools` 列表为准；生产 Runtime 必须复核二者交集，不能把 permission matcher 误当成 physical tool binder。

## AR-05：真实行为测试可能产生控制面状态

- 状态：`ACCEPTED-PERSONAL`
- 风险：live fixture 会导入并删除临时 Agent；真实巡检会启动 job，因此都不是“纯只读”。
- 补偿控制：双重显式 opt-in、测试环境标识、随机临时身份、mock/replay MCP、终态等待、清理和候选
  文件 hash 校验。
- 禁止范围：生产 AgentGov、生产设备、生产 SOC/Policy、跨租户资源。

## AR-06：旧 commands/兼容资产的发现语义

- 状态：`PARTIAL`
- 风险：兼容入口若仍在 production discovery，可能与 canonical Skill/Agent 产生双事实源。
- 补偿控制：legacy 资产必须移出官方 discovery 路径；测试检查正式资产集合和 legacy 不可发现。
- 退出条件：确认所有消费者迁移完成后删除兼容资产。

## AR-07：历史 review 不是当前证明

- 状态：`POSITIVE`
- 约束：`security-operations-expert-adversarial-review.md` 是问题来源，不是整改完成证据；其明确未审查
  `workspace/tests/**`。
- 当前证据：每个问题必须落到整改矩阵的静态、unit/contract、adversarial、runtime/live 层之一；缺少
  当前证据时只能标 `PARTIAL` 或 `OUT-OF-SCOPE`。

## AR-08：Response Plan 的最终消费授权在 Workspace 外

- 状态：`OUT-OF-SCOPE`
- 风险：response output Hook 只能证明结构、`request_id` 和冻结候选投影一致，不能证明外部规划 job 已
  成功终止，也不能把 Agent 正文中的“完成”声明变成控制面事实。
- 必需外部门禁：消费者必须从受信 job/event 元数据验证 `terminal_reason=completed`，再次校验
  `request_id`、候选集合 hash 与 output schema 后才可登记/消费结果。
- 禁止误读：`disable-model-invocation`、`tools: []`、`dontAsk` 和 Hook PASS 都不是外部发布授权。

## AR-09：Physical Tool Binder 属 Runtime 运行证据

- 状态：`PARTIAL`
- 当前静态边界：父 `.mcp.json` 仅连接 `sec-ops`；Inspection/Threat server 只在专职 Agent inline
  `mcpServers` 声明，Agent `tools` 与项目 permission 均 exact 枚举。
- 未闭环：静态文件不能证明目标 SDK 实际建立了预期父/子 tool surface，也不能证明 server 身份、Token
  scope、`tools/list` 和 schema hash。启动 preflight 必须记录连接、绑定闭包与拒绝未知工具的证据。

## AR-10：开发树扫描结果不等于发布候选处置

- 状态：`ACCEPTED-PERSONAL`
- 范围：开发树可保留 `.remediation-backup/`、pytest cache 和临时 runtime state，以支持回滚与本地调试；
  默认 checker 将它们列为 `local-only` warning。
- 发布判定：只有显式复制/暂存且剔除所有 local-only 工件后的干净目录才是 candidate；必须在该目录执行
  `check_workspace_contract.py --release` 并记录规范化包 digest。开发树默认 PASS 不能替代发布 PASS。
- 当前剩余：本轮已完成 staged raw-tree gate；导入 bootstrap、isolated live 与部署后 digest parity 仍未完成。
