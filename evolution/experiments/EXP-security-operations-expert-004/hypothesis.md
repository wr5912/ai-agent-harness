# 研究假设

将 inspection MCP 的四个实时合同工具配置给专用巡检子 Agent，并由主 Agent 统一委派，可使“执行一次常规巡检”完成 `start → collect → finalize` 全链路，同时不扩大主 Agent、故障分析或响应规划的工具权限。

本实验以用户提供的参考调用轨迹为行为参照，以新 DSH Web Session 的用户可见结果和完成轨迹为共同证据。两者必须对应同一次运行；只通过静态合同或只返回能力说明均不算通过。

## 预期观察

- 主 Agent 精确看见 12 个工具，其中包含 `delegate_inspection`，不直接看见 inspection MCP 工具。
- 巡检子 Agent 精确看见 4 个 inspection MCP 工具。
- 对明确的常规全量即时巡检请求，依次调用 `inspection_runs_start_with_plan`、`inspection_runs_collect_evidence` 和 `inspection_runs_finalize`，后两步复用首步返回的 `run_id`。
- Web 最终返回真实巡检报告；故障分析仍为 15 个只读工具，响应规划仍为零工具。

## 停止条件

- 实时 MCP 目录与四工具合同不一致；
- 子 Agent 无法在同一运行中完成三步调用；
- 验证会触发策略变更、计划任务或响应处置。
