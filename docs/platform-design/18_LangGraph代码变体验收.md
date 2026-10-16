# LangGraph 代码变体验收

本文记录 2026-10-16 本轮整改的实际证据和当前结论。代码合同、接口和操作流程分别引用 [03](03_存储架构与数据契约.md#当前代码变体与固定外部输入)、[04](04_核心业务闭环与服务接口.md)和 [06](06_界面与前后端渐进建设.md#36-不同算力需求的近似等效变体)，本文不另行维护这些合同。

当前已完成程序确定性验证、资产关联告警共同基准的真实 DSH 模型诊断，以及第一阶段管理助手自主生成、编译和本地冻结。该阶段的变体因 Guard 文件损坏而没有完成目标 Session 装载，第一阶段任务已取消。第二阶段修复后取得两侧 Run，但工作流返回值违反 DSH 的 lossless JSON 合同，模型回退原子工具完成部分任务，该阶段也已取消。第三阶段在新的干净程序上完成两侧各两次 Run，变体八项工作流均实际完成，机器比较满足预定质量与资源指标；管理任务已完成，最终只读界面已核对真实任务卡、源码和刷新恢复比较。结果只支持四项固定输入中的观察，不能据此认定总体等效、真实 SOC 收益或自动标记 `end`。固定 Mock 输入上的模型运行也不证明真实 SOC 的业务收益。

## 验收对象与来源

首轮试点是资产关联告警查询。共同基准完整继承原有能力，在两侧共同使用原子只读工具 `get_soc_asset_by_asset_id` 和 `list_detect_alert`。本轮没有为试点构建派生 Runtime 镜像，也没有修改外部服务源码。优化工作流须由真实平台管理助手生成，基准准备没有预写图代码。

| 对象 | 本轮实际定位与状态 |
| --- | --- |
| 原程序工作区 | `/home/admin/work/ai-agent-harness-copy1`，分支 `feat/PLATFORM-langgraph-compute-variants`；业务验收时未在此提交或推送 |
| 隔离程序 | `/tmp/hep-langgraph-20261016/program`；第一阶段使用干净技术提交 `30a05d6cc6deba3a11f475a0b342ad8d919d1601`，第二阶段使用干净技术提交 `93c3428141172363837e94e42ed5bd891e71476d`，第三阶段使用干净技术提交 `5f42c9c64f6fd8e4fdf57223960573bdb288abde`，均为隔离本地快照 |
| 隔离数据 | `/tmp/hep-langgraph-20261016/data`；本轮 Run 和冻结均在此进行，未推送 |
| 继承来源 | `EXP-security-operations-expert-021-rdd331f9f2e30`，固定数据提交 `8f1c88ba14227bda685bd374150bf95e91df41e2` |
| 共同基准 | `EXP-security-operations-expert-023-r2233d74f6fb3`；隔离数据本地冻结提交 `de3a0fc64e267cae544603e0a37275b176df22b2` |
| 已派生代码变体 | `EXP-security-operations-expert-024-r290c02339cb3`；第一阶段冻结提交 `1cdf01062f61916f0384de08a364af3116732383`；第二阶段继续修复该对象，没有重复派生 |

本机的[基准冻结回执](/tmp/hep-langgraph-20261016/baseline-freeze.json)和[确切差异预览](/tmp/hep-langgraph-20261016/baseline-freeze-preview.json)记录本次选定资产和 Case 的冻结。以下 `/tmp/` 链接保留本机隔离验收的原件定位，不表示已向远端发布。选定证据已经复制到下文的本地归档；原件保持原位，长期副本及来源对应以归档 manifest 为准。

## 技术来源与本轮取舍

2026-10-16 重新核对用户指定的 A1 官方仓库，以下源码链接固定到 `604e0e21e539ed359827501dabf5477ee3493408`；LangGraph 依据其官方 JavaScript 文档，实际依赖版本以程序锁文件为准。A1 提供设计参考，本轮没有安装、运行或集成其 Python 编译器；当前采用平台管理助手生成 TypeScript，再装载到 DSH 的实现路线。

| 官方来源与机制 | 本轮采用或未采用 | 本仓库对应位置 |
| --- | --- | --- |
| [A1 的 Agent、AOT 与 JIT 入口](https://github.com/stanford-mast/a1/blob/604e0e21e539ed359827501dabf5477ee3493408/README.md)：描述、输入输出 Schema 和工具组成 Agent；AOT 生成可复用 Tool，JIT 面向一次输入生成执行代码 | 采用把稳定流程提前转成可复用工具的思路。生成输入包含固定父版、实际工具契约、任务与 Case；没有实现任意 `AGENTS.md` 的通用编译器，也没有在每条业务请求上运行 JIT | [本轮实际生成技能](https://github.com/wr5912/harness-engineering-platform/blob/0d2762c175ac87ac3b3b31e6c498366035a78c6c/platform/skills/compute-variant-research/SKILL.md)、[能力发现](../../platform/plugin/src/tasks/capabilities.ts)、[固定编译](../../platform/plugin/src/agents/compute-build.ts) |
| [A1 的生成、验证与候选排序](https://github.com/stanford-mast/a1/blob/604e0e21e539ed359827501dabf5477ee3493408/src/a1/runtime.py#L248)：生成多个候选，验证通过后按 Cost 选择，再转成工具 | 采用源码、构建、实际装载和评测分开验真的路径；未移植 A1 的 Python SDK、多候选自动搜索或默认排序器。当前每个 Variant 保存唯一业务 TypeScript 源码，构建回执固定源码与 ESM 身份 | [构建](../../platform/plugin/src/agents/compute-build.ts)、[本地冻结](../../platform/plugin/src/agents/compute-freeze.ts)、[共享工作流](../../platform/plugin/src/workflows/runtime.ts) |
| [A1 的 BaseVerify](https://github.com/stanford-mast/a1/blob/604e0e21e539ed359827501dabf5477ee3493408/src/a1/codecheck.py#L167)：语法、类型、操作约束及常量工具入参检查 | 借鉴可执行合同检查；本轮使用 TypeScript、草稿语法校验和 DSH 原生工具校验。它们不证明业务等效；该结论仍由同一固定输入上的新 Session、原始 Run 与重复比较支持 | [草稿校验](../../platform/plugin/src/agents/index.ts)、[工作流输出校验](../../platform/plugin/src/workflows/runtime.ts)、[比较](../../platform/plugin/src/agents/compute-variants.ts) |
| [A1 的 BaseCost](https://github.com/stanford-mast/a1/blob/604e0e21e539ed359827501dabf5477ee3493408/src/a1/codecost.py#L265)：按控制流、工具权重与循环深度估计成本 | 未把静态估计当成节省证据。本轮读取实际模型 attempt、原始 usage 与工具轨迹，区分目标、评审和生成投入；漏记、回执未知或模型路由不一致会阻止资源比较成立 | [模型观察](../../platform/plugin/src/evaluation/model-attempts.ts)、[统一核算](../../platform/plugin/src/evaluation/model-usage.ts)、[比较](../../platform/plugin/src/agents/compute-variants.ts) |
| [A1 的 AOT 缓存键](https://github.com/stanford-mast/a1/blob/604e0e21e539ed359827501dabf5477ee3493408/src/a1/runtime.py#L770)：使用 Agent 名称、描述和工具名称计算缓存键 | 未照搬这一缓存身份。当前固定实际源码、runner、构建制品、组合版本与实现摘要，并独立核对外部输入摘要；不因工具同名就假设实现相同 | [构建摘要](../../platform/plugin/src/agents/compute-build.ts)、[固定组合绑定](../../platform/plugin/src/workflows/fixed-composition.ts)、[MCP 执行器](../../platform/plugin/src/mcp/executor.ts) |
| [LangGraph 官方 Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api#compiling-your-graph)：State、节点、边组成图，先 `compile()` 再执行；编译只提供基础图结构检查 | 直接使用锁定的 `@langchain/langgraph`，组合与生成工作流共用顺序图编译器；确定性分支留在业务代码。工具经过 DSH 原生管线，必要 LLM 经过统一观察；没有额外建设图执行引擎、节点缓存或持久恢复服务 | [共享图编译](../../platform/plugin/src/workflows/graph.ts)、[工作流执行](../../platform/plugin/src/workflows/runtime.ts)、[组合复用](../../platform/plugin/src/mcp/nested.ts) |

以上对应关系说明已融入的技术选择，不代表 A1 或 LangGraph 自身保证本次优化有效。尤其是图能编译、原生工具能返回或模型回退后答对，都不能替代目标工作流实际成功和两侧可比资源证据。

## 固定输入及其适用范围

唯一可编辑样本是共同基准 Candidate 中的 `dsh/managed/compute-workflow/fixtures.json`，模式为 `mock-replay`，SHA-256 为 `b6b17d57c8a1a5132d8c75884801cd11d1b03ae317ddfaee41f11893f72b6714`。[样本原文件](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-023-r2233d74f6fb3/candidate/dsh/managed/compute-workflow/fixtures.json)保留捕获时间、工具规格、来源和受控覆盖说明。

| Case | 资产 ID 与固定行为 | 来源边界 |
| --- | --- | --- |
| `U-ASSET-ALERTS-001` | `9106`：资产存在，告警查询返回一组一条 | 从本机既有 Mock 只读服务实际 GET 捕获，再固定重放；没有查询真实 SOC |
| `U-ASSET-ALERTS-MISSING` | `999999`：资产查询 HTTP 404，停止告警查询 | 从同一 Mock 服务实际 GET 捕获 404；没有伪造资产或补造后续告警 |
| `U-ASSET-ALERTS-EMPTY` | `9107`：资产存在，告警为空 | 资产来自 Mock 捕获，告警响应是显式受控覆盖，只验证空结果分支 |
| `U-ASSET-ALERTS-FAIL` | `9108`：资产存在，告警 HTTP 200、业务码 503 | 显式受控存在资产和业务失败响应；在线 Mock 的该资产实际为 404，该覆盖不表示在线事实 |

共享 TypeScript 原子执行器只在外部接口边界重放这些固定响应，回执携带 `fixed_input_sha256` 和来源；没有用模型假输出代替工具执行。每个 Run 将样本原始字节复制到 `evidence/external-inputs.json`，锁文件保存模式和摘要。后续 Candidate 修改不会回写已经封存的 Run。正式两侧比较仍需核对同一输入摘要及完整原始工具轨迹，不能把外部数据随时间变化造成的结果差异认作代码变体的效果。

## 程序与传输验证

| 验证 | 已取得结果 | 证明范围 |
| --- | --- | --- |
| 插件完整测试 | 405/405 通过，[最终程序日志](/tmp/hep-langgraph-20261016/plugin-tests-final.log) | 覆盖构建冻结、助手任务、界面状态、来源比较、用量与 MCP 等程序合同，包括任务上下文延续、排他作用域、冻结模型回执、Candidate 相对编辑路径、严格 JSON 输出和比较状态恢复；不代替业务模型比较 |
| API 失败诊断回归 | [9/9 通过](../../runtime/adapters/dsh-container/test_dsh_eval_review_trace.mjs) | 在测试 HTTP 边界验证 Session 创建失败的原生错误码、插件入口与原因封存，失败时不派发 prompt，以及既有轨迹与修复 attempt；不把模拟 Runtime 响应当实际装载成功 |
| Run 快照测试 | [8/8 通过](../../tests/test_run_snapshot.py) | 覆盖原始字节和摘要封存、`mock-replay/replay`、无效模式清理及不存在样本时不补造冻结声明 |
| LangGraph Runtime | [真实图执行测试](../../platform/plugin/test/workflow-runtime.test.mjs)通过 | 执行两个原生子工具、传参和身份传播、失败与取消停止、ESM 来源及图内模型请求计量；工具与模型响应由测试边界提供 |
| 固定 MCP 组合 | [固定组合与真实 HTTP 测试](../../platform/plugin/test/mcp.test.mjs)及[原生取消测试](../../platform/plugin/test/native-composition-cancel.test.mjs)通过 | 使用官方 MCP SDK 和本机 HTTP 边界验证组认证、固定旧版本、实现冲突前拒绝业务请求、执行身份、未知回执及取消传播；不等同于真实 SOC 服务验收 |

最终计量消费者补充无请求开始证据的 attempt 合同：空 `assistant/attempt` 保持未知，不直接算成一次远程调用；已证明的模型请求下界仍保留，真实远程失败与重试继续计数，历史 schema 1 的响应次数口径保持原义。相关 19 项与 33 项定向测试通过，最终完整插件测试为上表的 405/405。复核第三阶段四个正式 Run 后，请求与 token 指标均保持不变，没有修改原始 Session、Run、Candidate 或其程序来源。最后消费者程序的 Git 身份由本轮归档 `manifest.json` 的 `program.head` 定位，不把该技术提交追认为业务 Run 的程序版本。

隔离程序的[第一阶段准备日志](/tmp/hep-langgraph-20261016/prepare.log)、[第二阶段准备日志](/tmp/hep-langgraph-20261016/prepare-phase2.log)与[第三阶段准备日志](/tmp/hep-langgraph-20261016/prepare-phase3.log)记录依赖准备、TypeScript 检查、插件构建和 Profile 定位。完整测试曾因误用系统 Python 3.8 失败，[该次失败日志](/tmp/hep-langgraph-20261016/plugin-tests-phase3-python38.log)保留；随后通过 PATH shim 和 `HARNESS_PYTHON=/usr/bin/python3` 使用 Python 3.10 重跑，得到第三阶段的 400/400；最终消费者修复后另得到表中的 405/405，没有为 Python 3.8 修改实现。最终 prepare 另见[日志](/tmp/hep-langgraph-20261016/prepare-final.log)。首轮原子工具试点没有调用固定 MCP 组合；该传输验证属于可复用程序路径的技术证据。

## 共同基准的实际 DSH 诊断

| Run | 结果与证据 |
| --- | --- |
| `run-240a4f77-accc-4fa2-aa08-fab226f31528` | 首次实例启动因依赖问题失败；4 项执行错误、整体 `inconclusive`，没有可用目标轨迹。[原始执行记录](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-023-r2233d74f6fb3/runs/run-240a4f77-accc-4fa2-aa08-fab226f31528/execution.json)及中断证据保留，不覆盖为后续成功 |
| `run-e7cc31ca-bc16-4434-8a36-6fa2208d0e47` | 实际 DSH 新 Session 执行上述 4 Case，4 项完成、4 项 `passed`，来源校验 `matched`；评测实例已停止。[原始汇总](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-023-r2233d74f6fb3/runs/run-e7cc31ca-bc16-4434-8a36-6fa2208d0e47/summary.json)与[输入锁文件](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-023-r2233d74f6fb3/runs/run-e7cc31ca-bc16-4434-8a36-6fa2208d0e47/inputs.lock.json)可核对 |

成功诊断的锁文件记录程序来源为原工作区 `00cc4ec342c04772229a19f625a86b43e80f848f` 加 dirty 状态，数据来源为 `de3a0fc64e267cae544603e0a37275b176df22b2` 加 dirty 状态，并固定实际 Candidate 摘要 `dd3787b7888cdf7a5f91671374eed68d0b1bf080697b87369feefe0c4046d131`。这一 Run 不能事后改称由最终隔离程序技术提交执行。

从其原始 `trace.jsonl` 和 `judge-trace.jsonl` 按角色核算：

| Case | 目标实际模型请求 | Case 评审请求 | 合计 |
| --- | ---: | ---: | ---: |
| `U-ASSET-ALERTS-001` | 3 | 1 | 4 |
| `U-ASSET-ALERTS-MISSING` | 2 | 1 | 3 |
| `U-ASSET-ALERTS-EMPTY` | 3 | 1 | 4 |
| `U-ASSET-ALERTS-FAIL` | 3 | 1 | 4 |
| 总计 | 11 | 4 | 15 |

本次 `review:none` 没有执行额外场景复核与归因，逐 Case 语义评审仍实际发生。上表只计这一诊断 Run，不包含管理助手生成、后续正式比较或其他会话；调用计量完整，不据此推算费用或节省比例。

## 第一阶段生成、失败和取消

管理 Session `session-4b96ece1-46fb-436a-83cc-1de3ab82b318` 在第一阶段实际派生了 024，生成 `dsh/managed/compute-workflow/index.ts`、完成固定编译，并经独立确认冻结。冻结提交中记录的构建摘要为 `7de7e5153101135f4a92dca9e8306886b4278e565a9ec2afb0468edd988a7424`，ESM 摘要为 `93b7f87c80e15223167c753105e74d47d98dc7a24f167f21979f8c1aff1b9f4a`。这些回执证明源码与制品已经生成，未证明整个 Preset 可启动。

实际变体 Run `run-4725581e-45d9-4c45-8e65-ea63f20de8ed` 的四项 Case 均在 `target-session-create` 阶段失败，整体 `inconclusive`，没有目标模型轨迹。[原始检查](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/runs/run-4725581e-45d9-4c45-8e65-ea63f20de8ed/evidence/U-ASSET-ALERTS-001/checks.json)当时只保存 `session/create` 的 `runtime-rpc-failed`；后续[真实原生 RPC 探针](/tmp/hep-langgraph-20261016/probes/variant-load-20261016T123236Z/session-create.json)取得 `agent-preset/invalid`，原因是 `security-operations-guard` 的 `/opt/dsh-managed/security-operations-guard.mjs` 为 `never started`。两份记录保留各自实际信息，没有反写旧 Run 的错误码。

[Guard 诊断](/tmp/hep-langgraph-20261016/probes/variant-load-20261016T123236Z/guard-diagnosis.json)进一步确认，助手把完整 Guard 模块覆盖成了 137 字节的 `assetAlerts: Object.freeze([...])` 局部属性片段，摘要为 `f953f40cde6c0722ec5cb2581c263a41b3a16c2c34bf031817df9044b6b2cacb`。`node --check` 返回 `Unexpected end of input`，该文件已经进入第一阶段冻结提交。此时工作流 wrapper 尚未执行，不能把这次失败解释为图内工具或模型业务失败。新程序补充完整 JS 语法预检，并明确保存接口接收完整文件正文。

第一阶段还暴露出平台会话问题：向同一 Session 追加没有 `context` 的指导时，固定 `task_context` 被清空，通用与算力任务作用域叠加，`assistant/status` 返回 `tools.presentAs("native") conflicts`。第二阶段程序保留缺省固定上下文，并统一排他切换和释放作用域；相关真实 HTTP 与程序回归已纳入上表。冻结预览原先还把完整编译产物差异带入模型上下文；新程序仅向模型投影真实文件清单、摘要和预览身份，完整差异仍保留在持久提案、RPC 与原生确认卡，回归核对没有截断确认正文。这些整改不改写历史 Session 或失败 Run。

第一阶段随后经实际 endpoint 取消。原 Session 的 `seq=752` 执行记录保存状态 `cancelled`、修复 1 轮、已观测模型调用 89 次，其中管理助手 74 次、已观测评测 15 次；原任务 ID、开始时间、截止时间和计数保持不变。该 15 次评测消耗不能归到没有目标 Session 的失败变体 Run。取消状态以[原始 Session 串帧日志](/tmp/hep-langgraph-20261016/data/.local/platform-home/sessions/--tmp-hep-langgraph-20261016-data--/session-4b96ece1-46fb-436a-83cc-1de3ab82b318/session.v4.jsonl.zstd)为依据；本机脱敏导出 `phase1-cancelled-status.json` 当前存在 JSON 解析问题，未作为可解析回执使用。

第一阶段的[只读界面记录](/tmp/hep-langgraph-20261016/ui-readonly.json)及[原生任务卡截图](/tmp/hep-langgraph-20261016/ui-native-task-card.png)验证真实侧栏选择该 Session 后显示任务状态与预算；[阶段与源码截图](/tmp/hep-langgraph-20261016/ui-compute-progress-panel.png)验证 024 的生成、构建和冻结状态，以及读取的 TypeScript 与当时 Candidate 摘要一致。观察者没有发消息、确认业务或操作任务。早期选择器及等待历史装载的探针失败保留，不计为产品缺陷；当时没有捕获等待确认态，不能用已执行卡片代替待确认卡验收。旧浏览器上下文现已关闭，后续阶段界面尚待另行只读观察。

## 第二阶段运行、失败和取消

第二阶段管理 Session 为 `session-05f99fa0-4521-4f58-b790-45964d3ed317`，在干净程序 `93c3428141172363837e94e42ed5bd891e71476d` 上修复既有 024；管理者只提供实际探针事实，没有手工代写业务资产。早期 `run-abaa7220-64eb-4a15-8feb-539349a50ce1` 因 Candidate 编辑路径授权合同不一致，四项均执行错误、整体 `inconclusive`，保留[原始汇总](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/runs/run-abaa7220-64eb-4a15-8feb-539349a50ce1/summary.json)，不追认为修复后的成功运行。

| 对象与 Run | 真实机器评分 | 装载与结论边界 |
| --- | --- | --- |
| 父版 `run-cbb25954-1a45-4da2-bf3a-387aa7355190`、`run-ec4f1a61-60db-426a-a65f-16466177697e` | 各 4/4 `passed` | 共同基准在该阶段两次完成；不是新程序第三阶段的比较证据 |
| 变体 `run-4cc4d380-0b60-4e78-b6e2-929b3ef93f5d` | 4/4 `passed` | 原始工具轨迹包含 `INVALID_TOOL_OUTPUT: value is not lossless JSON`；模型随后退回原子调用，不能认定工作流成功或资源节省 |
| 变体 `run-d7df8dfe-4f2b-44a9-a97d-7467d94a0750` | 3/4 `passed`、1 项 `failed` | 同样存在工作流输出被拒与原子回退，且有任务失败；不能确认等效 |

两次变体的[第一份原始工具轨迹](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/runs/run-4cc4d380-0b60-4e78-b6e2-929b3ef93f5d/evidence/U-ASSET-ALERTS-001/tools.jsonl)和[第二份原始工具轨迹](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/runs/run-d7df8dfe-4f2b-44a9-a97d-7467d94a0750/evidence/U-ASSET-ALERTS-001/tools.jsonl)保留真实拒绝与后续执行。核对锁定 DSH SDK 后确认，生成代码正常结果中的 `detail: undefined` 等可选值不满足无损 JSON 合同。新的共享 Runtime 严格检查输出并返回结构化失败，同时修正自身失败轨迹的可选字段；它不会靠删除业务字段把无效输出冒充成功。生成技能同步明确省略无值字段或使用 `null`，并要求新 Session 重新验证。

第二阶段经实际 endpoint 取消，[可解析取消回执](/tmp/hep-langgraph-20261016/phase2-cancelled-status.json)保存 `cancelled`、已观测模型调用 97 次，其中管理助手 31 次、评测 66 次。原任务身份、预算与计数保留；研究投入还须累计第一阶段的 89 次，不因新阶段重新开始而清零。

[第二阶段读取错误](/tmp/hep-langgraph-20261016/phase2-assistant-read-reset.json)保留了 Playwright 读取连接的 `ECONNRESET`。服务仍存活，监测复用同一 Session 继续，没有据此重建业务会话或把它判为作用域问题复现。

## 第三阶段实际装载与比较

第三阶段管理 Session 为 `session-13320cb8-df3e-4272-b37b-72bc2b0cacbc`，使用干净程序 `5f42c9c64f6fd8e4fdf57223960573bdb288abde` 和数据冻结提交 `664b05eaea08adc2862b1bc665e2cc61536fe603`，继续既有 024，没有重复派生。当前 Candidate 摘要为 `4966a5a1857f1faa3331655cd20e0520ea00c886359f60f8e9d36453f6d15c2b`，构建摘要为 `e422d8fd170c2e53e3c12e8cd8799017f515e9588d9b62f8221653e919523327`，ESM 摘要为 `e8390cd5cadf4e819191792d708a502f7d01aa97fc3cf38fd85830c87c486d21`。

| 两侧正式 Run | 封存结果 |
| --- | --- |
| 父版 [`run-58e7239f-402c-4438-a2e1-d2bbc893d582`](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-023-r2233d74f6fb3/runs/run-58e7239f-402c-4438-a2e1-d2bbc893d582/summary.json)、[`run-45e4c7a6-64a0-4732-b0ba-9f278dbfd49f`](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-023-r2233d74f6fb3/runs/run-45e4c7a6-64a0-4732-b0ba-9f278dbfd49f/summary.json) | 各 4/4 `passed`，合计 8/8 |
| 变体 [`run-4a733904-8c1a-42dc-98da-182b36319e85`](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/runs/run-4a733904-8c1a-42dc-98da-182b36319e85/summary.json)、[`run-e62ad619-6ed4-449c-ba8a-f116bb3b0e54`](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/runs/run-e62ad619-6ed4-449c-ba8a-f116bb3b0e54/summary.json) | 各 4/4 `passed`，合计 8/8；八项 wrapper 回执均为图 `completed`、`complete:true`，图内 `infer` 为 0 |

工作流成功回执对应实际两原子工具和固定构建身份，未沿用第二阶段输出拒绝后的原子回退作为成功证据。图内无模型调用只说明此固定流程由确定性代码执行；外层 DSH 仍实际调用模型，每项变体任务为 2 次，并非整条任务零模型。

[不可变机器比较回执](/tmp/hep-langgraph-20261016/data/evolution/experiments/EXP-security-operations-expert-024-r290c02339cb3/evaluation/compute-comparison-382c6d7b4fad568a52fbf14a96469c3d205b41c4654a37c57c1fcfc23399e786.json)摘要为 `382c6d7b4fad568a52fbf14a96469c3d205b41c4654a37c57c1fcfc23399e786`。四 Case 每侧均有两次独立 Run，质量、可比性和资源记录检查均通过，限制数组为空，`eligible_for_end:true`。这表示冻结计划下的机器观察指标达成，仍由用户审阅完整输出和业务事实后决定是否确认 `end`。

| 目标执行资源 | 父版 | 变体 | 观察改善 |
| --- | ---: | ---: | ---: |
| 实际模型请求，八项任务合计 | 22 | 16 | 27.27% |
| 输入 token，八项任务合计 | 198818 | 121557 | 38.86% |
| 输出 token，八项任务合计 | 4788 | 4722 | 1.38% |
| 总 token，八项任务合计 | 203606 | 126279 | 37.98% |
| 主 Session 耗时，各 Case 等权平均 | 5597.375 ms | 5008.375 ms | 10.52% |

上述表格只计被测目标。将同轮逐 Case 语义评审计入后，两次父版 Run 的总 token 分别为 112866、113665，两次变体为 83721、82852；两侧合计为 226531→166573，减少约 26.47%。这仍不包含管理助手的生成与修复投入；其 token 总量未知，不能将目标执行的 37.98% 写成整轮研究总成本改善。缺资产 Case 的实际模型请求保持 2 次，平均耗时从 4147 ms 增至 4781 ms，回退 15.29%，输出 token 从 442 增至 463，回退 4.75%；正常资产 Case 输出 token 从 641 增至 707.5，回退 10.37%。不能用整体平均掩盖这些回退，也不能把 token 或短样本耗时换算为已经测得的硬件算力或供应商费用节省。

第三阶段另有[父侧初始化失败 job](/tmp/hep-langgraph-20261016/data/.local/evaluation-jobs/2770b631-6a52-4a2b-9c01-2903df0272bb.json)，没有形成 Run。原件保留；缺少原始具体 `error_codes`，当前不能认定具体根因。助手随后自行补足上述新父版 Run，没有改写失败 job 或复用旧 Run。

[真实助手交付记录](/tmp/hep-langgraph-20261016/phase3-assistant-live.json)确认 `platform_task deliver` 已完成，任务状态 `completed`、修复 0 轮，最终实际观测 80 次模型请求，其中管理助手 26 次、评测 54 次。最后一份 `execution` 快照记录 79 次；随后同一任务的 `model-call seq=288`、`delivery-accepted seq=289` 与最终消息记录共同支撑收尾的第 80 次，不以较早快照少计一次。两侧目标请求 38 次与逐 Case 评审 16 次组成本阶段 54 次评测投入。

按任务预算与其实际模型派发事件的口径，前三个管理任务累计 266 次，为管理助手 131 次、评测 135 次；另有独立共同基准成功诊断的 15 次，共计 281 次。前两阶段失败和取消的投入没有清零。这些数只说明上述任务预算口径，不含开发 Codex、未记录外部消耗，也未测量费用或摊销回本次数。独立核算还发现第一阶段一个发生于 provider 请求前作用域冲突的空 `assistant/attempt`，没有可确认的远程开始证据；它应保留为未知，不能直接加成一次供应商请求或账单。管理 token 仅有已观察下界，总量未知；这一缺口不影响第三阶段四个正式 Run 中完整记录的目标资源比较。

## 最终只读界面观察

[第三阶段只读记录](/tmp/hep-langgraph-20261016/phase3-ui-readonly.json)验证原生侧栏实际选择上述 Session 后显示[完成任务卡](/tmp/hep-langgraph-20261016/phase3-ui-task-final.png)：模型调用 80/120、助手 26 次，交付完成。观察通过顶导航、实际智能体、024 版本与算力变体 Tab 进入，未发送消息、修改任务或确认任何业务。

[五阶段状态](/tmp/hep-langgraph-20261016/phase3-ui-progress.png)均为“已验证”；[实际比较](/tmp/hep-langgraph-20261016/phase3-ui-comparison.png)显示冻结四 Case 的两侧重复结果、资源和限制。读取的 TypeScript 共 13235 字符，原文 SHA-256 `fcbe78d6bbeb12626da27d961b5142763ce2be90ca2bf470d9ba950a741f448e`，与当时 Candidate 文件逐字节一致。整页刷新后[恢复的比较界面](/tmp/hep-langgraph-20261016/phase3-ui-reloaded-comparison.png)仍使用同一不可变回执及所选 Run；人员审阅框未勾选，没有确认 `end`。客户端错误为零，观察浏览器完成后关闭。

原生会话默认折叠已完成的执行步骤。只读打开“已完成，用时…”及外层工具组后，实际[已执行冻结卡](/tmp/hep-langgraph-20261016/phase3-ui-freeze-executed.png)可见；[冻结来源记录](/tmp/hep-langgraph-20261016/phase3-ui-freeze-readonly.json)核对持久 proposal 状态 `completed`、预览摘要 `015376042c98e2bbe4c503fb1f16437cf06c33904b193f5fd18cabc311fc0147`，完整原始差异 14012 字节，摘要 `9c9a728b1e1ec6f7612416fda695c72336733bd39e0b964cb99be46ae89fa696`。这份完整差异来自真实持久提案，没有重新提出或确认任何操作；直接点击隐藏 summary 的早期探针失败单独保留，没有据此判定产品故障。两组观察浏览器均已关闭。

第一轮 UI 探针在 Tab 外壳出现、来源复核尚未完成时过早读取按钮数量，产生[选择器等待失败记录](/tmp/hep-langgraph-20261016/phase3-ui-first-selector-probe.json)。后续等待实际按钮与刷新完成后通过，未把探针等待错误写成产品失败。此前监测器保存的新会话空页也不证明待确认卡已显示。本轮未拍到真实待确认态，不能用已执行冻结或完成任务截图替代这一项。

## 本地证据归档与隔离服务

本轮证据已封存于 [`/home/admin/harness-engineering-platform-data/.local/verification/langgraph-20261016/`](/home/admin/harness-engineering-platform-data/.local/verification/langgraph-20261016/manifest.json)。[manifest.json](/home/admin/harness-engineering-platform-data/.local/verification/langgraph-20261016/manifest.json) 的 SHA-256 为 `2ef2ddea2815033d4f0fa369f2426cfb13b4c82b3f6bc08d515f0c2385c82716`；[SHA256SUMS](/home/admin/harness-engineering-platform-data/.local/verification/langgraph-20261016/SHA256SUMS)记录清单和证据摘要。归档包含 13 个真实 Run、三个管理 Session 的明示结构化投影、三份完整原生冻结提案及结算、生成/比较/最终消费者回读、必要截图与程序和数据增量 Git bundle，共 506 个文件。原 Run 字节没有改写，原目录没有移动；Session 投影保留计量事件、原件定位与摘要，大正文省略有明确标记，完整确认差异另存于原生冻结回执。

归档前预检阻断为零，已按三个实际凭据值扫描所选文本、Session 与增量 Git 对象，没有命中；只有经过原公开模型证据核实的精确无鉴权兼容占位值单独排除，理由记录在 manifest，未打印或封存实际凭据值。归档后独立回读 504 个证据条目、505 行校验和及 495 个源文件对应，摘要和长度均一致；两个 bundle 的 `verify` 和目标 head 均通过。程序 bundle 以 `00cc4ec342c04772229a19f625a86b43e80f848f` 为前置对象，数据 bundle 以 `8f1c88ba14227bda685bd374150bf95e91df41e2` 为前置对象。授权的三处 Runtime 观测源码改动另外保存为 `source-changes/runtime-extension.patch`，manifest 记录原 blob/ref 和当前摘要，不伪装成数据冻结提交。运行 HOME、配置和凭据快照、依赖目录及 Memory 均未复制，未创建 Research Release。

[最终消费者回读](/home/admin/harness-engineering-platform-data/.local/verification/langgraph-20261016/receipts/final-consumer-check.json)在最后消费者程序上再次核对五阶段、原比较回执、完成任务 80 次和 `end:false`，没有发送新模型消息。原程序工作区与原数据根的 Git HEAD 分别保持 `00cc4ec342c04772229a19f625a86b43e80f848f`、`8f1c88ba14227bda685bd374150bf95e91df41e2`；本轮新增的是授权的本地证据目录，既有 EXP-022 和未跟踪数据保持原状。

归档时隔离服务入口为 `http://127.0.0.1:3115/hep/`，Node PID `3604038`，日志 `/tmp/hep-langgraph-20261016/platform-final.log`；停止命令为 `kill -TERM 3604038`。正式 `3090` 未切换。最后重启只复核已有证据，第三阶段四个业务 Run 的程序来源仍是此前明确记录的 `5f42c9c64f6fd8e4fdf57223960573bdb288abde`。

归档后首次 LAN 人工查看使用 [024 算力变体页面](http://10.0.160.32:3115/hep/#/agents?agent_id=security-operations-expert&experiment_id=EXP-security-operations-expert-024-r290c02339cb3&tab=compute-variants)，也可进入[管理对话](http://10.0.160.32:3115/hep/#/conversations)后从原生侧栏选择已有会话；管理对话地址没有指定 Session 的深链接参数，沿用原平台登录账号。当时监听 `10.0.160.32:3115`，Node PID `3622071`，日志 `/tmp/hep-langgraph-20261016/platform-lan-review.log`，停止命令为 `kill -TERM 3622071`；正式 `3090` 未切换，临时程序技术提交未修改。这是首次 LAN 观察时的历史定位，后续同页变体浏览与独立名称验收已经重启隔离服务；当前入口、装载来源、进程和日志统一见[项目验收矩阵 PA-12](../ai-agent-harness项目验收矩阵.md#pa-12-全局-dsh-平台启动认证与研究工具)。

[LAN 浏览器实测](/tmp/hep-langgraph-20261016/lan-review-links.json)已直接打开该 024 深链接，五阶段均显示“已验证”，实际比较及 27.27% 请求改善可见，客户端错误为零；观察浏览器已关闭。这次仅复核现有证据，没有发送模型消息或修改归档原件。

## 当前结论与未完成项

| 验收环节 | 当前状态 |
| --- | --- |
| 固定父版、共同原子能力和四项固定输入 | 已创建并本地冻结；输入与捕获、受控覆盖身份明确 |
| 真实模型诊断共同基准 | 已完成 4/4；证明该固定输入上的基准可执行 |
| 管理助手自主写入 TypeScript 图 | 已由实际管理助手生成及修复既有 024；保存与构建身份固定 |
| 目标独立构建、本地冻结与新 Session 实际装载 | 第三阶段已完成；八项实际图回执 completed/complete，前两阶段失败保留 |
| 父版与代码变体独立重复比较 | 第三阶段同程序、同冻结输入下各两次 Run，四 Case 均满足预定指标；不可变回执已保存 |
| 任务等效与资源收益 | 本轮固定四 Case 观察通过，目标请求减少 27.27%、总 token 减少 37.98%；局部耗时和输出回退、前期投入及外部 Mock 边界已列明 |
| 管理任务交付与最终界面复核 | 已完成；实际任务80次、源码一致、刷新恢复同一比较回执；未捕获待确认卡 |
| 人员确认 `end` | 未确认，当前仍是探索性 Experiment |

本记录保留实际失败、修复、生成、正式比较和归档身份，原始 Run 保持不变。本轮尚不构成 Research Release 复现或正式服务发布验收，`PA-10/PA-12` 的对应边界见[项目验收矩阵](../ai-agent-harness项目验收矩阵.md)。
