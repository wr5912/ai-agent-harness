# 研究假设

在 `agent/created` 生命周期中按委派深度调用 DSH 原生 `agent.ctx.tools.restrict`，可同时收敛模型提示、工具查找和执行面：父 Agent 只看见角色矩阵声明的 12 个工具，故障分析子 Agent 只看见 15 个只读取证工具，响应规划子 Agent 仍为零工具。

本实验沿用 `EXP-security-operations-expert-002` 已验证的精确 MCP 合同，只比较 Agent 作用域工具视图。验证同时读取 Playwright 用户界面结果与同一 Session 的 DSH 完成轨迹；任一侧不一致即不算通过。

## 预期观察

- 静态合同能从角色矩阵推导父、子 Agent 的精确可见集合。
- 新 DSH Web Session 的 `request/header` 只包含 12 个父 Agent 工具。
- 巡检能力查询最多调用 `inspection_capabilities_list`，不会暴露或调用巡检运行工具。
- 威胁分析和知识库路线明确不可用，策略边界和响应规划 Gate 保持不变。

## 停止条件

- `tools.restrict` 无法在首次模型请求前生效；
- UI 与完成轨迹无法关联到同一新 Session；
- 验证需要调用策略准备、选择、决策或巡检运行等有业务副作用的工具。
