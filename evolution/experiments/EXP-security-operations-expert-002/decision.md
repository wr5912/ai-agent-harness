# 研究决定：continue

精确 MCP 名称、角色矩阵和 Guard 执行边界值得保留，但本 Candidate 不作为最终结果。静态检查与实时 `tools/list` 均通过，DSH Web 中的回答也符合能力边界；对应完成轨迹却显示父 Agent 的 `request/header` 收到了 176 个工具 schema，而合同只声明 12 个父 Agent 工具。

这说明执行阶段拒绝不能替代模型工具视图收敛。既有响应规划 Gate 回归未受影响，未观察到越权工具调用，也未执行有业务副作用的工具。后续由 `EXP-security-operations-expert-003` 在每个 Agent 创建时应用 DSH 原生 `tools.restrict`，并以新实例、新 Session 的轨迹重新验证。
