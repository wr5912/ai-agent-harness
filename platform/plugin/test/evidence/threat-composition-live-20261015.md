# 威胁分析阶段组合实机记录（2026-10-15）

本记录验证平台工具组合功能及基础 Mock 接入，不是业务 Harness 变更、Experiment Evaluation 或 Research Release。

- 实机验证时平台为 `http://10.0.160.32:3090/hap/`，工作树提交 `cae8a8c4417aa6f970cf3cd8f7cc925ff36d9a29`，当时本轮改动尚未提交。沿用既有平台 HOME、账号和标准全局 DSH Runtime；最终进程 PID 为 `457920`，tmux 为 `ai-agent-harness-platform-3090`。
- 算法固定为 `git:6e80f2c92b7983cbe8fc7957685d36338080b134` 的 EXP-020 原文件，缓存源码摘要为 `a85db94a8d2862986e2a1f2dfd9d89d6e969647f8fe785b89e1693349383b331`。业务 Harness 文件未修改。
- 经浏览器原生服务表单保存 `mock-threat-soc`（完整 SOC OpenAPI）与 `mock-threat-report`（报告 MCP），通过样例向导创建五个草稿，分别发布四个子组合，再从界面给父组合选择固定发布版本。dry 与发布不请求业务上游。
- 旧资产相关告警只读工具保留；发布 Gateway 实际发现 6 个工具，新增五个均声明 `readOnlyHint=false`。

## 两条基础业务路径

| 输入事件 | 调用入口 | Run | 路由 | 内层模型 | 校验 | SOC / 报告 |
| --- | --- | --- | --- | --- | --- | --- |
| `INC-20261015-000001` | 浏览器总组合实际执行 | `run-6e0de720-ce5c-4b2c-a184-4a7a9bdad420` | `fast_classification` | 零次 | `not_applicable_fast_classification` | `saved` / `saved` |
| `INC-20261015-000002` | 已发布 MCP 总组合 | `run-dcb723dc-d675-4836-ac04-9aff73a4c02a` | `five_source` | 一次 `deepseek-flash/off` | `failed` | `saved` / `saved` |

快速路径实际执行 collect、writeback、report，infer 按条件跳过；完整路径实际执行全部四阶段，模型路由在首次 infer 冻结为 `deepseek-official/deepseek-flash/off`。两次结果均为 `status=completed、phase_status=completed`，SOC 回写使用同一 judgementId/runId，摘要存储均一次成功。

完整路径的原机械校验错误为 `verified_facts[1].fact contains an incident or rule declaration`。原流程允许可解析 JSON 继续交付，因此此结果保留 `validation.status=failed`，页面醒目要求人工复核，不能据 completed 认定结论已核实。未降低校验规则，也未重新采样或改写原始摘要。

两个 Mock 报告实际下载均 HTTP 200；Mock 下载固定基础 HTML，不原样发布模型 HTML。本地原始 HTML 及冻结输入仍由 Run 产物提供。

- `INC-20261015-000001`：[基础报告](http://10.0.160.32:53001/reports/report_5c03f5730d2f4024944926ba7b49d98a.html)。
- `INC-20261015-000002`：[基础报告](http://10.0.160.32:53001/reports/report_fb9706b875014a0a9107d98218d0c765.html)。

## MCP 分组与重放

通过“工具与资源分组”创建并保存 `threat-analysis-mock`，勾选五个已发布工具。原有分组保留，未更换已有统一访问 Token。真实 SDK 客户端使用 Bearer 连接 `http://10.0.160.32:3090/hap/mcp/groups/threat-analysis-mock`，发现以下工具，并成功通过分组调用 infer 重放：

- `mcp__compositions__threat_collect`
- `mcp__compositions__threat_infer`
- `mcp__compositions__threat_writeback`
- `mcp__compositions__threat_report`
- `mcp__compositions__analyze_threat_incident`

完整 Run 的 infer、report 经 Gateway 重放均返回 `replayed=true`；分组 infer 重放同样成功，原阶段 trace 与产物未增加。最终重启后，通过页面报告子组合重放、刷新上下文、读取并下载 report.html 文本产物，人工复核提示可见，HTML 未嵌入执行，浏览器错误为零。旧 `query_asset_related_alerts` 实际查询资产 9106 成功。

两条事件现已认领完成；直接对同一事件再次执行父组合会按原语义认领冲突。查看结果请在报告子组合填上述 run_id 进行重放。未重启或清空共享 Mock；其重启会清除内存中的报告和状态，届时这些下载 URL 可能失效。

## 确定性验证与修复记录

- `platform/plugin` 的 `pnpm test`：143/143，包括 TypeScript 检查和实际构建。阶段原算法回归 11 项、原 CLI 与四阶段对照 3 项、嵌套编排 10 项、原生服务 8 项、真实 MCP 协议 3 项、页面状态 4 项。
- 原 CLI 对照使用隔离进程和基础正常数据，比较快判、完整路径、可解析校验失败路径的业务字段、取证参数、冻结五源输入、模型请求、SOC 请求顺序和完整报告保存载荷；未调用真实模型或真实业务 API。
- 真实协议测试加载生产管理器构建适配，验证分组和外部 MCP 的取消信号、长超时、认证 Header，以及 OpenAPI 发现 schema 到 body.arguments 的真实封装。取消验证采用与当前 DSH 相同的 auto 协商模式；旧版无状态协议的跨请求取消有限制，未声称支持。
- 提交前先合入远端 `main` 的 `27a0434` 并保留其并行改动，再执行 `pnpm test`：169/169，类型检查和构建均通过。该检查没有重新调用真实模型或清空 Mock 状态。
- 仓库合同校验通过，无错误或警告。聚焦审查修正了全跳过误报成功、保留步骤 ID 导致目录不可读两项问题；相应失败不落盘及 MCP 失败回执均有回归。
- 首次实机尝试产生 `run-0b3d4690-afd0-4dbd-8e96-2aee93bf299b`：原生 OpenAPI 发现响应省略 inputSchema 导致请求封装错误，返回 claim_failed/502，未消费测试事件。修复共同发现入口并通过真实协议回归后，使用新 Run 完成两条路径；原失败上下文保留，没有改写。

这里只证明基础 Mock 样例上的执行闭环与固定原程序的对照，不证明真实 SOC 上游合同、完整威胁场景质量或自动调度行为。宿主硬崩溃后遗留的阶段锁仍需人工核验处理。

[已发布父子图](threat-composition-published-20261015.png) · [实际校验失败与人工复核提示](threat-composition-manual-review-20261015.png)

停止平台：`tmux send-keys -t ai-agent-harness-platform-3090:0.0 C-c`；不停止或重置 Mock 与业务智能体实例。
