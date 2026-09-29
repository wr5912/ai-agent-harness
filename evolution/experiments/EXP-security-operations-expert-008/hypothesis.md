# 研究假设

在 `EXP-security-operations-expert-007` 的 Candidate 基础上，将巡检工具直接开放给主 Agent，并把旧四步巡检替换为“列出可执行模板 → 异步发起 → 按 `runId` 查询结果”，可以使一次常规巡检不阻塞在发起阶段，并在报告就绪后交付服务返回的真实下载地址。

巡检连接继续通过 `INSPECTION_MCP_URL` 与 `INSPECTION_MCP_TOKEN` 注入；本地联调地址由运行环境提供，Candidate 不写死地址或凭据。

## 预期观察

- 只查询巡检项时仅调用 `list_executable_inspections`，不创建运行；没有唯一匹配模板时先澄清。
- 常规全量巡检不传 `scope`；指定资产时使用 `ASSET_IDS`。同一请求重试复用 `requestId`，发起后保留 `runId` 并查询至报告就绪或明确失败。
- `PARTIAL` 保留证据缺口；报告链接仅来自结束后实际返回的 `reportDownloadUrl`，不自行拼接。
- 新工具仅对主 Agent 可见；旧巡检工具及 `delegate_inspection` 不再暴露，其他业务路由继续工作。
- 008 来源启动前核对完整的应急运行配置；新 Session 能调用应急 MCP 生成 `READY/NOT_SUBMITTED` 草案，不触发执行。

## 停止条件

- 服务未发布可执行模板、无法连接或返回字段与给定合同不同，不能声称已完成真实巡检。
- 仅通过静态配置、Mock 或装载检查时，Decision 保留为 `inconclusive`，直至真实 Session 证实业务行为。
