---
name: mcp-composition
description: 在平台管理对话中按需求修改并验证轻量 MCP 工具组合，使用本项目 LangGraph.js 两步只读实现；适用于输入输出映射、失败停止和编排流程展示。
---

# MCP 工具组合

先从环境变量 `HARNESS_ASSET_ROOT` 定位当前仓库并读取根级 `AGENTS.md`。本技能供全局 DSH 的平台管理对话使用，不写入业务智能体的 Candidate，也不改变开发身份。先确认用户需要修改组合还是只运行当前只读查询。

唯一流程实现是仓库下 `platform/plugin/src/mcp/executor.ts` 中的 `compositionGraph()`，保留两步只读结构。默认接口为 `get_asset → list_alerts`；SOC 流程 `soc-asset-alerts` 使用资产服务的 `get_soc_asset_by_asset_id` 和告警服务的 `list_detect_alert`。输入输出 Schema 在同目录 `definition.ts`；界面从所选版本的已编译图读取节点、边和 metadata。工具名称、标题、说明、接口流程、两个服务连接及草稿/发布版本的唯一维护位置是 `platform/mcp-compositions.json`，它不保存另一份流程图。只需查询且会话已接入组合 MCP 入口时，先发现已发布工具，再传入 `asset` 和可选 `limit`（1–20，默认 5）；未接入时使用页面的实际执行入口。实际调用会请求上游，先确认用户的查询意图。

SOC 流程要求正整数资产 ID。资产服务配置在 `connectionId`，告警服务配置在 `alertsConnectionId`。第一步将输入转为整数 `assetId`，校验响应 `code === 200` 与 `data.assetId` 匹配后，第二步传入 `req: { assetId: String(data.assetId), pageNum: 1, pageSize: limit, windowSeconds: 2592000 }`。共享 OpenAPI 适配器将 `form/explode` 对象查询参数展开到 URL，不能发送 `req=[object Object]`。第二步同样检查业务码，读取 `data.groups`；`alerts` 是首页告警分组，`alertSummary` 保留近 30 天查询范围、总分组数及总告警数。HTTP 200、空列表与业务失败须分别判断。

修改时复用 LangGraph.js 的 `Annotation.Root`、`StateGraph.addNode/addEdge/addConditionalEdges`、`compile({ checkpointer: false })` 和 `invoke`。节点名称不要与 State 字段同名。节点通过现有 MCP 管理器调用工具，保留连接鉴权、只读 GET 检查、总超时、取消和回执。首步失败或缺少资产 ID 时停止，不调用第二步；第二步从 State 中读取首步的资产 ID。给节点设置 `title`、`step`、`operationId`、`input`、`output` metadata，UI 会通过 `getGraphAsync()` 同步展示。

按用户当前需要修改最少代码，并在 `platform/plugin/test/mcp.test.mjs` 验证受影响路径。工具目录保留可编辑草稿和当前发布快照，发布前 dry 校验，草稿不得替换正在调用的发布版。不要新增图数据库、持久工作流、通用 Workflow 引擎或图编辑器。

验证流程：

1. 在 `platform/plugin/` 执行 `pnpm run check`、`pnpm test`。现有测试使用受控 HTTP 接口验证两次调用、输出映射、失败停止及取消，不代表业务平台验收。
2. 页面“工具组合编排”的侧边栏按全部编排、正在编辑、已发布列出工具。选择草稿或发布版后，**测试（dry）** 调用 `mcp/dryRunComposition`，只检查输入、图编译和连接登记，零上游请求、零节点执行。保存和测试均携带所选编排 ID、版本及目录摘要；并发变化拒绝覆盖。发布只接受已保存草稿，服务端再次 dry 校验后更新发布快照；Gateway 仅发现和调用已发布版本，发布后调用方重新发现工具。dry 通过不能证明远端工具存在或执行成功。
3. 修改后执行仓库入口 `platform/dsh-platform prepare`，按当前实例的启动方式重启平台。在新 Session 中确认本 Skill 仍可发现，在页面检查图与源码一致。读取原有启动参数，避免启动另一工作树或覆盖用户配置。
4. 用户需要实际查询时才在页面点击“实际执行组合工具”，或调用已接入的组合工具。核对回执中的操作 ID、参数映射、版本与错误；如实保留失败，不把 dry 当作业务评测或新建 Research Run。
