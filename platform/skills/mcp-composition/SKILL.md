---
name: mcp-composition
description: 在平台管理对话中配置、发布和验证 MCP 工具组合，支持既有资产告警只读查询、威胁分析业务阶段及固定版本的子组合调用。
---

# MCP 工具组合

先从环境变量 `HARNESS_ASSET_ROOT` 定位当前仓库并读取根级 `AGENTS.md`。本技能供全局 DSH 的平台管理对话使用，不写入业务智能体的 Candidate，也不改变开发身份。先区分用户要配置编排、发布版本还是实际调用工具。

编排定义与草稿、发布版本只在 `platform/mcp-compositions.json` 维护。界面和 MCP Gateway 共用 `platform/plugin/src/mcp/` 执行器，从所选版本的编译图展示节点、边与映射。当前接入合同与阶段边界见[威胁分析阶段组合](../../../docs/platform-design/02_系统架构与部署设计.md#threat-stage-composition)；运行设置、Session 和产物留在平台 HOME，不回流业务 Candidate。

用户需要配置威胁分析样例时，按以下顺序操作：

1. 在 MCP“服务列表”登记并保存 SOC 的原生 OpenAPI 服务及报告的原生 MCP 服务。SOC 规范须包含原事件研判所需操作，报告服务须发现 `save_persistence_result`；地址、鉴权和模型凭据沿用平台原生配置，不另存一份凭据。
2. 在“工具组合编排”点击“威胁分析样例”，选择这两个连接，创建四个阶段草稿和一个总组合草稿。模型仅在完整研判阶段配置；可选平台默认模型或指定原生 Provider、模型及推理强度。
3. 分别保存、dry 校验并发布四个子组合，再编辑总组合，为每步选择具体已发布版本。保留样例的输入映射与分支条件；父组合固定引用这些版本，子组合再次发布不会自动改变父组合。
4. 对总组合输入有效 `incident_id`，仅在用户要求实际研判时执行。单独测试后续阶段时输入同一 `run_id`，不要重新发起取证。已完成阶段重放原结果，不能靠再次调用研判阶段重新采样。
5. 分别核对研判、机械校验、SOC 回写和报告保存状态，再查看原程序摘要、真实下载地址及冻结产物。`validation=failed` 但 JSON 可解析时，原流程仍保留 `status=completed` 并要求人工复核；不得把阶段返回或该完成状态解释成校验、保存均成功。

已发布工具会进入“工具组合编排”服务，可在原生分组中勾选、保存并重新发现；调用方使用分组入口及统一访问 Token。草稿只供页面编辑和测试，不对外提供。发布和 dry 不请求上游，不证明实际业务可用。模型默认值、固定源码、Python 版本及中断恢复边界集中维护在上述合同，不在 Skill 中维护第二份配置。

原有两步只读组合继续保留。默认接口为 `get_asset → list_alerts`；SOC 流程 `soc-asset-alerts` 使用资产服务的 `get_soc_asset_by_asset_id` 和告警服务的 `list_detect_alert`。只需查询且会话已接入组合 MCP 入口时，先发现已发布工具，再传入 `asset` 和可选 `limit`（1–20，默认 5）；未接入时使用页面的实际执行入口。

SOC 流程要求正整数资产 ID。资产服务配置在 `connectionId`，告警服务配置在 `alertsConnectionId`。第一步将输入转为整数 `assetId`，校验响应 `code === 200` 与 `data.assetId` 匹配后，第二步传入 `req: { assetId: String(data.assetId), pageNum: 1, pageSize: limit, windowSeconds: 2592000 }`。共享 OpenAPI 适配器将 `form/explode` 对象查询参数展开到 URL，不能发送 `req=[object Object]`。第二步同样检查业务码，读取 `data.groups`；`alerts` 是首页告警分组，`alertSummary` 保留近 30 天查询范围、总分组数及总告警数。HTTP 200、空列表与业务失败须分别判断。

确需修改执行实现时，复用 LangGraph.js 的 `Annotation.Root`、`StateGraph.addNode/addEdge/addConditionalEdges`、`compile({ checkpointer: false })` 和 `invoke`。节点名称不要与 State 字段同名。只读资产组合保留 GET 检查和首步失败停止；威胁阶段复用固定算法与原生连接，不将整段原 CLI 伪装成多个已执行节点。节点 metadata 与真实调用保持一致。

按用户当前需要修改最少代码，验证受影响路径。威胁阶段测试见 `threat-runtime.test.mjs`，固定原 CLI 与四阶段的基本样例比对见 `threat-equivalence.test.mjs`；它们不替代真实界面、原生 MCP 或外部业务验收。不要新增图数据库、调度服务或通用 Workflow 引擎。

验证流程：

1. 在 `platform/plugin/` 执行 `pnpm run check`、`pnpm test`。现有测试使用受控 HTTP 接口验证两次调用、输出映射、失败停止及取消，不代表业务平台验收。
2. 页面“工具组合编排”的侧边栏按全部编排、正在编辑、已发布列出工具。选择草稿或发布版后，**测试（dry）** 调用 `mcp/dryRunComposition`，只检查输入、图编译和连接登记，零上游请求、零节点执行。保存和测试均携带所选编排 ID、版本及目录摘要；并发变化拒绝覆盖。发布只接受已保存草稿，服务端再次 dry 校验后更新发布快照；Gateway 仅发现和调用已发布版本，发布后调用方重新发现工具。dry 通过不能证明远端工具存在或执行成功。
3. 修改后执行仓库入口 `platform/dsh-platform prepare`，按当前实例的启动方式重启平台。在新 Session 中确认本 Skill 仍可发现，在页面检查图与源码一致。读取原有启动参数，避免启动另一工作树或覆盖用户配置。
4. 用户要求实际执行时才在页面点击“实际执行组合工具”，或调用已接入的组合工具。核对回执中的操作 ID、参数映射、版本与错误；如实保留失败，不把 dry 当作业务评测或新建 Research Run。
