# EXP-017 观察

2026-10-11。初始 Candidate 从本地尚未提交的 [EXP-015-r632 Candidate](../../EXP-security-operations-expert-015-r6328dfd1ae6e/candidate/harness.yaml) 派生；`baseline_ref` 记录本次拉取后的仓库提交 `c72506dee5d91b396da30c6c267a4ec11d226ae3`，不表示该提交已包含 EXP-015-r632。初始变化限于巡检 Skill、工作区指令、Guard 根工具可见性、能力清单及对应测试；`evaluation.md` 的 `U-INS-004/005` 更新为 DSH 提醒语义。外部巡检服务源码未改。

2026-10-12 继承复核发现初始 Candidate 漏掉 EXP-016 的语音摘要源码、构建产物与测试，以及 EXP-015-r904/EXP-016 的 Web MCP 直连种子、巡检报告容错解析和 `conclusionStatus` 回答约束。已将 EXP-016 Candidate 作为主来源合入，保留 EXP-017 的周期提醒改动。继续盘点远端分支发现 EXP-015-rbe 自动威胁研判来源，按远端最新固定提交 `c0f067e9752cef78fc6b20c6fd33c9df1e2a4dc5` 核对并融合其 Schedule 桥、待研判队列、SOC 目录、Python 研判与回写修复、角色工具范围、业务指令和测试；保留 EXP-016 较新的语音源码与构建制品，两个周期任务分别用不同的提醒内容路由。

对 EXP-016 固定提交核对 197 个 Candidate 文件、对 EXP-015-rbe 固定提交核对 101 个文件，EXP-017 均无文件缺失。相对 EXP-016 的 12 个差异路径包括 5 个自动研判实现文件、SOC 目录、角色矩阵、Guard、业务指令、巡检 Skill、Harness 能力清单和语音 README；相对 EXP-015-rbe 的 12 个差异路径主要是较新的语音资产、Schedule/巡检规则及相应说明和测试。逐项保留两边仍需的行为，不以文件数证明语义兼容。对本地 EXP-015-r632 的工作树做目录比较，没有仅存在于该来源的文件；其旧 Web MCP 种子和应急 MCP 环境变量由 EXP-016 的直连配置替代。该未提交来源的最终 Git 版本仍待固定。

逐版本检查 Candidate 路径是否存在于 EXP-017；表内数字仅是缺失路径数，内容差异和实际行为另按来源、测试与 Run 审查。下表 `NNN` 指 `EXP-security-operations-expert-NNN`，带 `-r` 的实验保留其后缀。

| 来源版本 | 缺失路径 | 核对结果与取舍 |
| --- | ---: | --- |
| 001 | 29 | 旧故障域、知识库、威胁分析 Skill 等路径未保留；002 因实时工具不可用收敛了部分路由，未证明全部旧语义等效。 |
| 002 | 1 | 旧 `mcp-servers.yaml` 未保留；当前使用 Web MCP 配置。 |
| 003 | 1 | 同上。 |
| 004 | 1 | 同上。 |
| 005 | 1 | 同上。 |
| 006 | 1 | 同上。 |
| 007 | 1 | 同上；其余 70 个路径仍在。 |
| 008 | 1 | 同上；其余 79 个路径仍在。 |
| 009 | 1 | 同上；其余 79 个路径仍在。 |
| 010 | 3 | 旧 MCP 配置及 TypeScript/ESM 巡检代码 Variant 未保留；该实验 Decision 为 `inconclusive`，没有等效证据，不能按 `end` 自动排除，也不能直接作为主线能力采纳。 |
| 011 | 1 | 旧 MCP 配置未保留；其余 87 个路径仍在。 |
| 012 | 1 | 旧 MCP 配置未保留；其余 79 个路径仍在。 |
| 013 | 0 | 路径齐全；新 Session 行为仍需核对。 |
| 013-r26ecd1295ab4 | 1 | 旧 MCP 配置未保留；运行概览等其他路径仍在。 |
| 014-r8b1bd54e8be7 | 0 | 路径齐全；组合行为仍需核对。 |
| 015-r904bdcd81005 | 0 | 路径齐全；Web MCP 直连与巡检解析已定向复核。 |
| 015-r6328dfd1ae6e | 0 | 对本地未提交 Candidate 工作树核对，无独有路径；提交后的固定版本仍需复核。 |
| 015-rbe8b91182ebf | 0 | 对远端固定提交核对 101 个文件；自动研判测试通过，真实业务行为未复验。 |
| 016-r77d4eb1119fb | 0 | 对固定提交核对 197 个文件；语音构建和摘要测试通过，真实音频未复验。 |

这份审计不能证明 EXP-017 已继承所有历史行为：001 的旧 Skill 语义、010 的探索性代码 Variant，以及各版本的真实会话组合效果仍有未决证据。版本号不作为继承顺序；等效算力 `end` 变体只有在固定、可恢复的同 Agent 主线父版和等效证据成立时才作为终端分支，研究阶段不要求父版已发布。

融合后自动研判 Node 11 项、Python 6 项，Guard 与巡检 MCP 范围 3 项通过；仓库合同校验无错误或告警。语音插件在隔离目录按锁文件使用 `npm ci --legacy-peer-deps --ignore-scripts` 安装后，摘要测试与构建通过；未用目标模型和真实音频复验。首次 `dsh-dev up --source experiment:EXP-security-operations-expert-017-r94f3b07e080f --mode eval --dry-run` 解析出锁定镜像和三棵只读挂载，当时缺少模型连接环境变量；随后取得本地凭据并完成下述新实例验证。

锁定的 DSH Runtime `21638c56315ae6a2b552d6091945d3144c9af32e` 中，Web Profile 使用 `@deepseek-ai/dsh-experimental-schedule-bundle`，该插件注册 `schedule_create` 等工具。`schedule_create` 可用 `every_seconds: 600` 创建绑定 Session 的周期提醒；到期时宿主恢复原 Session 并投递含提醒 ID、到期时间和提示内容的消息。锁定版本的到期消息明确要求将提示内容视作非新指令；提醒投递不能直接证明巡检调用。用户原授权和当前目录必须在到期时重新核对。

新实例暴露了 Web MCP 装载的共同根因：巡检分组种子未配置 `sharedToken` 时，`mcp-manager` 跳过已启用的 Agent MCP 挂载。EXP-017 Candidate 已在 Agent 代理侧生成本地随机令牌并用于挂载鉴权，分组代理仍按其原有配置工作；随后新 Session 能实际调用巡检三工具。仓库 `tests/test_validators.py` 的 61 项测试通过。

[正式 API Run](../runs/run-fc23de09-a04f-4d74-8c05-b26dfe214eae/report.md)在新 Session 查询真实目录，选中描述包含“当前资产清单”的设备状态专项巡检模板，调用 `schedule_create` 创建 `every_seconds: 600` 的周期任务 `schedule-8a4af9bf-f25e-4c5c-b9bd-86eb1dc7cdd6`。该 Run 的评测器在第一轮到期前自动停止实例，因此原报告仍为失败；这不等于任务创建失败。

保持原 HOME 并恢复同一实例后，原 Session 在 2026-10-12 08:41:49Z 和 08:51:49Z 两次真实到期时自动续接。每次均重新调用 `list_executable_inspections`，以各自 `requestId` 省略 `scope` 调用一次 `start_inspection`，再按对应 `runId` 调用 `get_inspection_result`；没有人工补发巡检消息。两次分别得到 `run-fb24bdd2cd8e400ba4308e44f586a417`、`run-90daae23558a46f6bb722eaa09985b20`，均为 `SUCCEEDED/COMPLETE`，范围为“全域设备（以本次冻结清单为准）”，各观察 51 台，其中 34 台在线、17 台离线，业务结论 `ABNORMAL`。持久化投递记录、原 Session 事件和服务工具回执保存在[人工追录 Run 的原始证据](../runs/run-3c86eb9a-b49b-435e-aad3-0610c8fab123/evidence/U-INS-005/periodic-due.json)，该 [Run 报告](../runs/run-3c86eb9a-b49b-435e-aad3-0610c8fab123/report.md)按这两次到期判 `U-INS-005` 通过；两个 Run 的 Candidate 树和评估口径摘要相同。

追录 Run 建于两次到期之后，只证明当前实例、当前绑定服务和这两个到期时点的完整闭环，不将原正式 Run 改判为自动通过，也不证明长期稳定。`ABNORMAL` 是设备离线的业务结果，不是周期执行失败；服务报告没有给出离线根因。旧 [EXP-015 Run](../../EXP-security-operations-expert-015-r6328dfd1ae6e/runs/run-9ab7cd25-42cf-451c-a0cb-c468b81243e8/report.md)保持原判定。历史版本语义继承及其他业务能力仍按各自证据继续核对；浏览器路径见下文。

同一实例 `security-operations-expert-eval-3b9d84b7` 的[来源与状态](evidence/browser-path-20261012/source-state.json)显示运行中、期望镜像与只读挂载匹配；[页面探针](evidence/browser-path-20261012/overview-mcp.json)确认概览有 35 次工具调用、2 次 Skill 加载，`inspection` MCP 分组已启用。浏览器从概览、MCP 配置进入新会话，首轮发起常规巡检，随后在同一 Session 续查。[续查证据](evidence/browser-path-20261012/continuation/U-INS-007/checks.json)记录两轮完成且第二轮回答在页面显示；[原始事件](evidence/browser-path-20261012/continuation/U-INS-007/trace.jsonl)显示首轮查询目录、发起一次巡检并查询结果，第二轮仅按原 `runId` `run-f145f22b6af84bec896861bc74b5a157` 再查结果。两次结果均为 `PARTIAL / ABNORMAL`，观察 51 台（34 台在线、17 台离线），回答说明了部分检查未完成并沿用服务返回的报告链接。该次只证明当前来源、实例的页面路径和真实工具回执；服务结果是部分完成，不能据此把 `U-INS-007` 判为业务通过。

定向浏览器探针首次在概览指标异步加载时失败；第二次的 120 秒等待先于首轮实际完成而超时，临时汇总代码又发生变量作用域错误。[失败摘要](evidence/browser-path-20261012/path-summary.json)和[首轮截图](evidence/browser-path-20261012/U-INS-007/failure.png)保留原貌。原 Session 后续完成首轮，才执行上述同 Session 续查；这些临时探针没有修改仓库的简化浏览器评测器，也没有改判已有正式 Run。

2026-10-12 继续核对故障分析入口：当前绑定的 `sec-ops` MCP 在保留服务签发 Session 的 `initialize → notifications/initialized → tools/list` 路径下可发现工具；一次只读资产清单调用返回业务 `code: 200`。EXP-017 Web MCP 种子原将该服务禁用，导致此前[故障 Run](../runs/run-524cc39e-47af-4f0d-8039-76ce4a80f91a/report.md)出现子 Agent 工具未注册。现已启用该服务，并仅选择角色矩阵的 15 个只读故障查询工具；隔离实例的[首轮复测](../runs/run-c85219b5-c17e-4fa1-aac5-7d6e7f610986/report.md)确认子 Agent 实际调用了 SOC 工具。该轮 `U-FLT-002` 与 `U-INS-003` 均获机器通过，但原始回答分别把资产查询未命中推成未纳管根因、对离线数量作无基准高低判断，不能据此宣称业务结果通过。

收紧事实与推断边界后，[第二轮复测](../runs/run-410452e3-9a47-4963-8536-eaaeb073f8f1/report.md)两项机器通过；`U-INS-003` 的原始回答为单个可解析 JSON，完整保留 39、12、4、2 及单位，事实与尚未执行的提示分开。`U-FLT-002` 仍在开头把 SOC 未命中排序为较可能的巡检原因；[第三轮复测](../runs/run-03640284-1951-4b53-9539-3ca691ccfa0a/report.md)也有同类跨系统推断。最终将规则限定为无同一对象、时段的交叉证据时只分别描述各系统观察。[末轮故障复测](../runs/run-fb7b2d57-5441-41dc-ae88-4b8ecf272cc4/report.md)机器通过，原始工具事件只有 Skill、委派和 `sec-ops` 只读查询；三台目标 IP 在本次 SOC 资产清单和图谱查询均未命中，路径查询的 `verdict` 为 `UNKNOWN`。回答明确未确认三台离线原因，也未对可能原因排序。未取得巡检侧原始探测记录及同一时段关联，因此目标设备实际状态与根因仍为 `inconclusive`；同路由机器评测通过不覆盖这个证据缺口。上述各 Run 均为隔离实例，评测后已停止，原周期巡检实例未改动。

对 001 的缺失路径进一步按业务语义核对：旧 `fault-analysis` 依赖 `fault_analysis_start`、取证结果提交、收口、状态和结果查询等正式运行接口；当前 EXP-017 的 `fault-analysis` 只做 SOC 只读取证，不能产生旧流程的正式结果。[当前服务的会话化工具目录](evidence/sec-ops-legacy-tool-discovery-20261012.json)包含 163 个工具，EXP-017 选择的 15 个只读工具均在目录中，但没有 `fault_analysis_*` 或 `weknora_knowledge__*`；旧知识库 Skill 也没有可调用的服务。因此 `U-FLT-001` 所需正式故障结果和 `U-QA-002` 所需真实知识库检索仍未打通，不能以 `U-FLT-002` 的只读取证通过替代。001 的研究假设是旧资产迁入 DSH 并观察装载，旧路径存在不等于该业务流程已被采纳或验证。010 的 TypeScript 巡检代码 Variant 的 Decision 为 `inconclusive`，其等效性和算力收益需要同服务独立 Run；本次不把它合入主线，也不将未合入本身判作当前主线故障。
