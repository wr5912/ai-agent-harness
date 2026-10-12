# Evaluation 观察

2026-09-30，按唯一当前 [巡检 Case 口径](../../../../agents/security-operations-expert/evaluation.md)执行 `U-INS-001`～`007`。Candidate 使用同一个标准 DSH 镜像（Image ID `sha256:7a3b6821bed818e492bf5f1c0c7930e2a4d8c52e3ccdeb2619fd42e3223b090c`）；两个 Run 均由 `dsh-eval` 创建独立实例和 API Session，来源 Git 均为 `dirty=false`，运行后实例已停止。首次 Run 锁定 `fe1726ca`，第二次锁定修复后的 `91b822e9`。本轮路径推导见 [路径分析](path-analysis.md)。

| Run | 机器结果 | 实际观察 |
| --- | --- | --- |
| [首次 Candidate Run](../runs/run-548ae419-80a4-47dc-9fd2-94d972f29010/report.md) | 3 通过、4 失败 | 插件已进入 `inspection-code` 路由，但巡检工具未注册；目录查询收到 `UNKNOWN_TOOL`。这暴露了插件只假定 MCP 工具存在的缺陷。 |
| [修复后 Candidate Run](../runs/run-1841ca35-cc52-4895-a887-be8f74d0907e/report.md) | 2 通过、3 失败、2 无法判定 | 插件先查 DSH 实际工具注册；缺席时明确说明无法巡检，不发出虚假的工具调用。巡检路径无工具回执，也无成功业务结果。 |

第二次 Run 的原始 Session 中，`U-INS-001/002/004/005/006/007` 均使用 `inspection-code/deterministic-inspection` 路由，且没有工具调用；`U-INS-003` 仍走 `deepseek-official/deepseek-flash` 做开放式研判。`U-INS-003/004` 机器通过；`U-INS-001/002` 因没有同一 Session 的目录回执而无法判定；`U-INS-005` 的十分钟周期任务没有创建接口，`U-INS-006/007` 没有成功目录、启动和续查而失败。逐 Case 原始回答、工具事件和判定均在相应 Run 的 `evidence/` 内。首次 Run 的 `UNKNOWN_TOOL` 已不再出现，但这只证明缺席工具时的停止行为。

本轮配置的巡检 MCP 地址在 2026-09-30 再次进行 TCP 连接探测，得到 `ConnectionRefusedError`；DSH Session 的可用工具列表亦无 `mcp__inspection__*`。未伪造目录或报告，也未修改 Case 预期。历史 EXP-008 巡检 Run 使用过未纳入锁定镜像的 MCP 客户端覆盖层，只能提供协议线索，不能作为同条件效果 Baseline。`run_record.py compare` 可并列查证两次 Candidate Run，但返回 `comparable=false`（Run 级 `model` 未记录，实际路由需逐 Case 读轨迹），且两次 Candidate 代码版本不同；通过数不可解读为等效性提升。

确定性测试已覆盖目录选择、资产 `scope`、稳定 `requestId`、按 `runId` 续查、运行中与 `PARTIAL` 的输出、设备数量和工具缺席停止；生成 ESM 与 TypeScript 逻辑一致，标准镜像可导入 ESM。真实 API Run 证明插件装载和分流，但外部服务拒绝连接，目录选择、真实副作用、报告内容和下载地址均未形成端到端业务证据。没有可用的同条件 Baseline/Candidate 效果对比、浏览器巡检 Run、无 LLM Key 业务 Session 或 CPU/内存/时延采样；不能宣称客户低算力局域网可等效运行。评审本身仍使用模型，不能将整条评测链路的模型成本视为零。

服务恢复后先核对 `server/discover` 与三项真实工具声明，再用相同镜像、冻结 Case 分别取得 Baseline 和 Candidate 新 Run；核对任务唯一性、启动次数和参数、跨轮 `runId`、设备数、`PARTIAL` 与下载地址，再测模型调用、耗时和资源使用。业务效果成立后再考虑把本次只读路径归因沉淀成类似 `scenario-analysis` 的独立专项 Preset；当前方案不自动生成代码。
