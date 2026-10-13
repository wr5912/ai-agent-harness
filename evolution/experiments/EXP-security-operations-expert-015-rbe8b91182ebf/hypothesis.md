# 研究假设

基于 `git:7fa05adb3bbcaf01729bfb53e49726403017eed9` 中的 `EXP-security-operations-expert-015-r904bdcd81005` Candidate，保留其 Web、语音、`mcp-manager`、巡检、策略、应急和手动威胁研判能力，迁移自动威胁研判语义及其直接依赖的 409 错误传递、Qwen JSON 围栏解析和分析超时失败回写修复。旧 EXP-011 仅作为迁移清点对象，不复用其编号、运行记录、镜像证据、旧 MCP 注册或 Runtime 补丁。

若 Schedule 以固定 JSON `{"type":"threat-analysis.pending","version":1,"batchSize":1}` 触发，程序应直接读取 SOC 待研判队列，每轮最多认领并研判一条事件，回复中展示事件 ID 和 Run ID。120 秒心跳到达时，如上一条仍在执行则跳过且不建立补跑队列；积压心跳过期后也应跳过。普通用户消息、改写 JSON 或非 Schedule 来源不得调用批处理入口。

Candidate 继续使用 EXP-015 的 `SOC_MCP_BASE_URL` 程序化 Gateway 和 `REPORT_MCP_URL`，不重新注册 `mcp__threat-soc__*` 或 `mcp__report__*`，不修改标准 DSH 镜像。现有手动单事件研判、`mcp-manager`、巡检三工具合同和其他业务路由不得回归。

先以确定性测试验证受信触发解析、单实例互斥、旧心跳、空队列、认领冲突、事件 ID/Run ID 展示及 SOC 队列解析，再验证来源合同、Experiment 合同、仓库合同和容器装载。真实 Schedule 只执行一次最小心跳；外部 SOC、报告服务或模型不可用时如实记为 `inconclusive`，不得据静态测试或容器启动宣称业务通过。
