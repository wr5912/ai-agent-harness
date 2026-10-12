# 研究假设

历史巡检 Run 显示，常规巡检和指定资产巡检的主 Session 需要模型逐步决定查询目录、选择任务、发起一次运行、按 `runId` 查询及组织答复；`U-INS-007` 还要在同一 Session 的下一轮复用 `runId`。这些步骤有可观察的目录与回执，可尝试固化为 DSH 原生插件中的 TypeScript 逻辑。预期所选代码路径的主 Session 模型请求数从每步一次降为零，且保持单次副作用、参数来源和失败停止语义。若使用同一服务和 Case，比较实际请求次数、耗时、CPU/内存与逐 Case 业务结果；耗时和资源改善不预设为必然。

本实验以 `git:5a230c991069a83d95fb509f7d0fb75619e05ebc` 的 EXP-009 Candidate 为 Baseline，复用 [`evaluation.md`](../../../../agents/security-operations-expert/evaluation.md) 的 `U-INS-001` 至 `007`，不改 Case 口径。`U-INS-003` 的静态事实 JSON 仍走原模型，故本轮研究的是**部分巡检路径**的低算力变体，不是整个 Harness 的零模型等效。`U-INS-005` 所需创建接口缺失，代码路径必须如实报告能力缺口，不能判通过。代码从本轮目录选任务，不固定任务 ID；副作用通过 Session 工具事件和稳定 `requestId` 限制为一次。工具失败、回执不合法、目录不唯一、报告未就绪时不得编造成功。

专项分析借鉴 `scenario-analysis` 的只读 Run 归因方式：先标出历史轨迹中可确定的节点、仍需模型或服务的节点、输入变化和可证伪检查，再由开发流程修改 Candidate。当前先保留分析和可运行切片；只有跨任务重复证明合同稳定时，再考虑独立的专项分析 Preset。候选源码为 TypeScript，使用 Node 22 的 `stripTypeScriptTypes` 生成同目录 ESM；`.ts` 是唯一可编辑来源，`.mjs` 仅供 DSH 装载。

## 停止条件

若新 Session 不能稳定装载插件，或真实巡检服务不可达，或任一副作用/回执与 Case 不符，不声称真实业务等效。仅通过静态检查或模拟工具事件时，Decision 保持 `continue`/`inconclusive`。客户低算力或无 GPU 环境的适用性还需相同硬件和服务条件的实测。
