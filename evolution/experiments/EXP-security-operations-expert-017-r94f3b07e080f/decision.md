# Decision：continue

2026-10-12。保留 EXP-017 Candidate 继续验证。文件级复核已补回 EXP-016 的语音摘要、Web MCP 直连种子和巡检报告解析能力，合入并行 EXP-015-rbe 的自动研判，并保留本实验的 Schedule 路由与到期巡检规则；并行的 EXP-015-r632 来源已按[研究假设](hypothesis.md)固定提交并重新核对。逐版本核对发现旧 Skill 语义和探索性代码 Variant 尚无继承或取舍的完整证据。新实例的[正式 API Run](runs/run-fc23de09-a04f-4d74-8c05-b26dfe214eae/report.md)成功创建每 10 分钟的周期任务，但评测器在首次到期前停止实例，原失败结论保留；恢复原 HOME 后，两次真实到期的[追录 Run](runs/run-3c86eb9a-b49b-435e-aad3-0610c8fab123/report.md)均形成目录查询、一次全域巡检和同 `runId` 结果查询，`U-INS-005` 在这两个到期时点通过。仍需按[观察与验证边界](evaluation/observations.md)处理历史语义继承和其他业务路径，不能由此推断整个 Agent 已完成验收。

同一 EXP-017 实例的[浏览器补充观察](evaluation/observations.md)完成概览、MCP 配置、新会话发起及同 `runId` 续查的页面路径；本次服务返回 `PARTIAL / ABNORMAL`，因此不将 `U-INS-007` 记作业务通过。旧 EXP-015 的三工具巡检结果、指定资产结果查询失败和浏览器 UI 冒烟证据保留。当前不生成 Research Release。

故障分析的 `sec-ops` 只读工具绑定已在隔离实例的[末轮 Run](runs/run-fb7b2d57-5441-41dc-ae88-4b8ecf272cc4/report.md)证实；`U-INS-003` 的[复测 Run](runs/run-410452e3-9a47-4963-8536-eaaeb073f8f1/report.md)保留全部给定事实与单位。三台故障目标 IP 在当前 SOC 范围未命中，巡检侧原始探测记录未取得，离线原因仍无法判定；早期机器通过但越界推断的 Run 均保留。知识库检索尚无服务绑定，其他业务路径和历史能力继承继续按[观察](evaluation/observations.md)逐项验证，Decision 维持 `continue`。

[旧版接口复核](evaluation/observations.md)表明当前服务没有正式故障分析运行和知识库工具；`U-FLT-001` 的正式结果、`U-QA-002` 的真实检索仍是未完成的业务路径。010 的代码 Variant 保持独立的 `inconclusive` Decision，不在本次继承中直接采纳。

[OpenAPI 回归整改](evaluation/observations.md#2026-10-12-openapi-回归与继承整改)已恢复并行 EXP-017-rb20 的规范读取和 Schema 转换，并补齐目标制品回归、继承检查退出码及来源复核规则。本地 `228:3230` 的实际装载、API 和简单浏览器检查通过；这是该技术回归的修复证据，不提升前述未完成业务路径的结论。Decision 维持 `continue`。
