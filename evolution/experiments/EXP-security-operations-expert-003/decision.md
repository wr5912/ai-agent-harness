# 研究决定：adopt

采用在 `agent/created` 阶段通过 DSH 原生 `tools.restrict` 收敛各 Agent 工具视图的 Candidate。封存 Run 的 7 项试验全部完成：父 Agent 的新 Web Session 请求头精确包含合同声明的 12 个工具，故障分析子 Agent 精确包含 15 个只读取证工具；巡检仅调用能力查询，未配置路线明确报告不可用，未发生有业务副作用的工具调用。

静态合同、实时 MCP `tools/list` 和 Guard 回归同时通过；响应规划子 Agent 的零工具交集、可信输入 Gate 与结构化输出校验由确定性测试覆盖。本次未向运行实例注入响应规划所需的冻结可信输入，因此没有触发该子 Agent 的实时委派；结论限于当前锁定 DSH 镜像、模型与 MCP 目录，不表示生产部署验收。
