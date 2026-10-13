# ai-agent-harness 项目验收矩阵

更新日期：2026-10-12

本文是 **ai-agent-harness 项目与工具链**验证路径、当前证据和缺口的唯一维护位置。它直接回答三个问题：总共有多少条路径、每条做到什么程度、哪些检查应该进入自动化测试。

## 1. 直接答案：共有 12 条一级验证路径

当前共有 **12 条一级验证路径**，编号 `PA-01` 至 `PA-12`。一级路径是用户可以独立完成、并且能够独立成功或失败的一条完整工作链；内部命令和正反向检查不重复计数。

| 阶段 | ID | 一级验证路径 | 当前状态 |
|---|---|---|---|
| 准备 | `PA-01` | Research Mode、AI 协作入口与项目 Memory | 部分验证 |
| 准备 | `PA-02` | 规范来源、受控副本与适用范围 | 已验证（机器范围） |
| 准备 | `PA-03` | 仓库结构、项目技能与研究资产合同 | 已验证（机器范围） |
| 选择来源 | `PA-04` | Experiment 来源解析、被测身份与材料隔离 | 已验证（机器范围） |
| 启动 | `PA-05` | `dsh-dev` 实例完整生命周期 | 部分验证 |
| 装载 | `PA-06` | 被测容器的真实装载与只读边界 | 部分验证 |
| 修改 | `PA-07` | 宿主修改、装载观察与回退闭环 | 部分验证 |
| 交互 | `PA-08` | DSH Runtime API 与 Web UI 的 Session、消息与结果闭环 | 部分验证 |
| 派生 | `PA-09` | 新 Preset 创建、登记、重载与选择闭环 | 部分验证 |
| 记录 | `PA-10` | Research Run 的创建、记录、缺口与封存 | 已验证（机器范围） |
| 复用 | `PA-11` | Research Release 打包、解析与复现装载 | 未实现 |
| 平台 | `PA-12` | 全局 DSH 平台启动、认证与只读资产查询 | 部分验证；当前分支待实机复验 |

状态含义：

- **已验证（机器范围）**：稳定、确定性的合同已有自动化正反向检查；不包含人工语义判断。
- **部分验证**：已有实现和局部证据，但完整用户路径、真实环境或异常分支仍有缺口。
- **未验证**：可能已有设计或局部实现，但没有足以确认完整路径的证据。
- **未实现**：完整入口尚不存在，不能靠补一条测试把它描述为可用。

这 12 条只统计项目与工具链，不把每个 Harness 的研究输入数量或每个 Release 的复现次数算进去。新增稳定 CLI、运行模式或独立用户流程时，先判断它是既有路径中的步骤，还是能独立成功或失败的新一级路径；只有后者才增加总数。

## 2. 三种结论必须分开

| 层级 | 回答的问题 | 主要证据 | 不能据此声称 |
|---|---|---|---|
| 项目与工具链验证 | 仓库规则、CLI、来源解析和 DSH 接入是否按设计工作 | 本矩阵、`tests/`、技术探针 | 某个 Harness 改动有效 |
| Experiment Evaluation | 某项 Harness 变化在声明输入和环境下表现如何 | 假设、Run、观察、回归、Decision | 整个工具链或其他 Experiment 都可用 |
| Research Release 复现 | 某个不可变研究版本能否恢复并重新装载 | Release 清单、摘要、复现记录 | 已满足生产部署、安全或运维要求 |

这三层都属于研究项目，不包含生产部署验收。未来若需要生产工程，应另行定义权限、安全、运维和发布合同。

## 3. 逐条路径

2026-09-30 的 [EXP-010 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-010/evaluation/observations.md)补充了 `PA-04/05/06` 的 Candidate 来源、标准镜像、插件实际路由和评测实例启停证据；`PA-07` 观察到插件修复前后新 Session 的行为变化，尚无来源回退；`PA-08` 完成 7 个巡检 Case 的真实 API Turn，未完成浏览器巡检或真实 MCP 业务链；`PA-10` 封存两次完整 Run 并用 `run_record.py compare` 查证。外部巡检 MCP 拒绝连接，研究效果仍为 `inconclusive`，上述路径状态不因此提升。

2026-10-08 的 [EXP-011 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-011/evaluation/observations.md)补充了 `PA-05/06/08/10` 的独立镜像构建、真实 DSH Web 装载、桌面与窄屏浏览器交互、模型回复和浏览器 Run 证据；所选入口的结果和限制以该观察为准，不改变本矩阵的全项目路径状态。

2026-10-08 的 [EXP-012 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-012/evaluation/observations.md)补充了 `PA-04/05/06/07/08/10` 的来源、标准镜像、四工具实际注册和调用、Candidate 修改后新 Session、三个 Case 的真实 API Run、重复验证及同报告对照；[实例操作记录](../evolution/experiments/EXP-security-operations-expert-012/evaluation/evidence/research-tool-instance-20261008.json)证明一个实例重启前后目标与实际镜像及只读挂载一致，错误实例名被拒绝。机器评审曾误判续查，新 Run 已经原始记录复核；[Decision](../evolution/experiments/EXP-security-operations-expert-012/decision.md)仍是 AI 临时 `continue`，人类采纳、浏览器页面验收和稳定工具效率收益均未确认，路径状态不因此提升。

2026-10-09 的 [EXP-013 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-013/evaluation/observations.md)补充了 `PA-05/06/07/08` 的当前实例装载、三页 MCP 配置浏览器交互、实际 Web profile 保存和恢复、受控 MCP 分组端点调用及新 Web Session 模型回复证据。外部业务 MCP、语音和业务 Case 尚未验收，路径状态不因此提升。

2026-10-09 的 [EXP-014 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-014-r8b1bd54e8be7/evaluation/observations.md)补充了 `PA-03/04/05/06/08` 的融合来源、当前实例只读装载、MCP 授权与分组技术链路、浏览器新 Session、语音识别和播报证据。`ai_soc_*` 的 OpenAPI 规范未取得，业务 Run 未完成；路径状态不因此提升。

2026-10-10 的 [EXP-015 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-015-r904bdcd81005/evaluation/observations.md)补充了 `PA-03/04/05/06/07/08/10` 的 Web MCP 配置回流、四服务工具发现与分组鉴权、同名实例重建、新 HOME 恢复和六个真实新 Session Case 的[封存 Run](../evolution/experiments/EXP-security-operations-expert-015-r904bdcd81005/runs/run-d442726d-c74c-42f7-91c2-8bb881424c29/report.md)。巡检三项通过，故障分析一项无法判定，策略与应急各一项因上游结果未达业务预期而失败；修正巡检解析指令后又有[三项巡检补充 Run](../evolution/experiments/EXP-security-operations-expert-015-r904bdcd81005/runs/run-da0a2cdb-f9e3-41eb-b4f6-c2b23a3dd017/report.md)，均通过。[跨版本对照 Run](../evolution/experiments/EXP-security-operations-expert-015-r904bdcd81005/runs/run-7bc9d938-4522-4ea6-be33-5e2c04e19e11/report.md)与 EXP-012 的三个共同 Case 各为 3/3 通过，但 Case 口径和运行条件不同，且未验证本地 Qwen 组合。浏览器页面未在本次重验，全项目路径状态不因此提升。

2026-10-10 的 [EXP-015 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/evaluation/observations.md)补充了 `PA-04/05/06/08/10` 的新来源、隔离实例、三工具实际发现、非零实例概览和六个巡检 Case 的真实 API Run。常规巡检与两轮续查有工具回执；周期任务创建失败，指定资产结果查询有服务端错误，同路由模型自动评审仍需人工判读。平台身份链和浏览器业务路径尚未验收，路径状态不因此提升。

2026-10-11 的 [EXP-015 浏览器补充观察](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/evaluation/observations.md)为 `PA-08` 增加同一实例的目录查询、同 Session 两轮续查和概览→MCP 配置→业务对话的连续试跑，保存页面回答及原始工具轨迹。简化后的浏览器执行器在两个新 HOME 的正式 Run 中完成目录查询 UI 冒烟；新增失败 Run 定位在工作区连接阶段。浏览器结果不能代替 API 业务判定或跨实例平台身份链验收，路径状态不因此提升。

2026-10-11 的 [EXP-016 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-016-r77d4eb1119fb/evaluation/observations.md)补充了 `PA-06/07/08/10` 的可配置语音摘要插件实际装载、共用连接、取消与重连、历史冷加载及无插件/卸载浏览器证据。保留修复前失败后，[最终 Run](../evolution/experiments/EXP-security-operations-expert-016-r77d4eb1119fb/runs/run-7a091380-a7d6-4381-947b-2f6c5c876892/report.md)两项 Case 在受控模型和测试音调范围通过；真实模型摘要质量与真实语音效果尚未评估，Decision 为 `continue`，全项目路径状态不因此提升。

2026-10-12 的 [EXP-017 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-017-r94f3b07e080f/evaluation/observations.md)补充 `PA-05/06/08/10` 的新实例、真实 MCP 装载、周期任务创建、原 Session 恢复和两次到期巡检回执。[正式 API Run](../evolution/experiments/EXP-security-operations-expert-017-r94f3b07e080f/runs/run-fc23de09-a04f-4d74-8c05-b26dfe214eae/report.md)在首次到期前停止实例，失败结论保留；[追录 Run](../evolution/experiments/EXP-security-operations-expert-017-r94f3b07e080f/runs/run-3c86eb9a-b49b-435e-aad3-0610c8fab123/report.md)人工核对两次到期的目录、巡检发起和结果查询，`U-INS-005` 在此范围通过。[定向浏览器证据](../evolution/experiments/EXP-security-operations-expert-017-r94f3b07e080f/evaluation/evidence/browser-path-20261012/continuation/U-INS-007/checks.json)又在当前实例核对概览、MCP 配置、新会话与同 `runId` 续查；服务结果 `PARTIAL`，不判业务通过。长期周期稳定性、其他业务和跨实例平台身份链未由此验证，全项目路径状态不因此提升。

2026-10-12 的 [EXP-017 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-017-rb20b8c6b906f/evaluation/observations.md)补充了 `PA-04/05/06/08` 的匿名规范读取与授权回退、真实浏览器发现、DSH 工具 Schema、分组鉴权和业务调用证据。`tee` 不在当前 Agent Guard 工具范围，上游部分接口仍返回 403；没有业务 Case Run，全项目路径状态不因此提升。

2026-10-12 的 [EXP-017-r94 OpenAPI 回归与继承整改](../evolution/experiments/EXP-security-operations-expert-017-r94f3b07e080f/evaluation/observations.md#2026-10-12-openapi-回归与继承整改)补充 `PA-03/05/06/08` 的继承检查退出码、目标制品回归、同名实例保留 HOME 重建、实际 DSH Schema 和 Web 发现操作证据。技术回归已修复，业务授权与历史未决结论不因此改变，全项目路径状态不提升。

2026-10-12 的 [EXP-018 API 重复比较与实例观察](../evolution/experiments/EXP-security-operations-expert-018-rfbf7fd53a340/evaluation/observations.md)补充 `PA-04/05/06/07/08/10`：固定 EXP-017 来源后两次 Baseline、独立 Candidate 修订与重复 Run、同标准镜像的两个隔离实例身份及只读装载、活动/空闲/停止未知/重启恢复 Session 的 API 记录。失败 Run 和评审分歧保留，巡检 `PARTIAL` 不作为完整业务通过；本次只覆盖修改后新装载，不证明来源回退。证据定位步骤减少尚未证明人工效率收益，跨实例页面、`232:18120`、当前分支全局平台 `PA-12` 与 Research Release 均未由此验收，全项目路径状态不提升。

### PA-01 Research Mode、AI 协作入口与项目 Memory

- **要回答**：新的 AI 开发会话能否读到 Research Mode、中文优先、简洁优先、单一事实源、根因整改、精准修改和四项安全底线；收到 review 请求时能否定位项目审查原则并覆盖开发工具与目标智能体 Harness；是否能进入 Harness 引导式 SOP；Memory 是否只作为辅助上下文。
- **操作链**：读取根级 `AGENTS.md` 和 README → review 任务按需读取 `docs/项目审查原则.md` → Harness 任务进入 `harness-guided-workflow` 的讨论、计划、执行、验证流程 → 解析 `.codex/config.toml` → 在受信任的新会话观察规则和 Memory 是否生效 → 确认会话能找到本矩阵。
- **当前证据**：仓库检查可确认稳定协作入口、审查方法唯一正文、引导技能和 `features.memories = true`。
- **缺口**：实际生效还受项目是否受信任、用户配置和启动参数影响，需要新会话观察，因此是部分验证。
- **自动化边界**：文件存在、配置类型和稳定链接进入测试；“当前会话确实使用了 Memory”保留为实机观察。

### PA-02 规范来源、受控副本与适用范围

- **要回答**：来源身份是否没有漂移，Research Mode 是否明确区分当前合同与未来生产化参考。
- **操作链**：读取 `SOURCES.md` → 核对受控副本 SHA-256 和锁定 Commit → 读取 `PROJECT-INTERPRETATION.md` → 来源变化时人工判断影响。
- **当前证据**：`agent-engineering-spec` 已锁定到 `aa3f27ae0b785191d0a122a6857154640073d73b`，受控摘要、提交和稳定文档入口已有机器检查；任务路由、多轮引导和外部资产复用原则的当前采用方式记录在项目解释中。
- **自动化边界**：文件身份进入测试；“新来源是否适合当前研究”由人判断。

### PA-03 仓库结构、项目技能与研究资产合同

- **要回答**：研究资产是否放在正确位置，是否避免重复 Baseline/current 和定义投影，Experiment、Run 和 Research Release 是否具备最小可复现内容。
- **操作链**：由 `harness-guided-workflow` 判断创建、迁移、修改或优化任务并路由现有技能 → 只读检查外部资产 → 核对每个 Agent 只有一个 `evaluation.md` 当前业务测试源，Case 以场景归组，除名称、用户输入和预期外仅允许可选的 `fast` 标记 → 运行仓库校验 → 运行 Experiment 校验 → 用负向样例验证重复 `definition.md`、技术 Case、额外字段、未知选择、非法身份、空资产和危险链接会被拒绝。
- **当前证据**：引导技能已进入仓库必需技能清单；`inspect_source.py`、`validate_repository.py`、`validate_experiment.py` 及其测试覆盖当前确定性合同，评测合同测试覆盖场景与 `fast` 解析。
- **自动化边界**：结构、格式、引用和摘要进入测试；研究内容是否真实、有价值不由校验器打分。

### PA-04 Experiment 来源解析、被测身份与材料隔离

- **要回答**：选择的 Experiment 是否解析到正确 Agent、Preset 和资产；被测角色与评分角色是否只看见各自需要的材料。
- **操作链**：解析 `experiment:<id>` → 分别生成 `subject`、`scoring` 计划 → 核对评测实例的 `session_preset` 与 `target_preset` → 评分角色只读挂载 `/work/reference` → 反向确认被测角色没有参考答案和判断材料。
- **当前证据**：来源合同、挂载计划和角色隔离测试覆盖当前机器合同；全部已登记 Experiment 解析到同一份 `source.lock.json` 和同一个镜像构建指纹，来源覆盖版本字段会被拒绝，Candidate 不再持有 DSH 版本锁；[EXP-009 实机记录](../evolution/experiments/EXP-security-operations-expert-009/evaluation/evidence/dsh-dev-lifecycle-20260929.json)确认被测实例选择的来源、Preset 和只读挂载，且没有挂入评分参考目录；[`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/runs/run-a4abf894-4750-4113-8497-7fc08a3a36b5/evidence/T-AUTHORING-PLUGIN-PERSISTENCE/dsh-plugin-restart-20260922.json) 仅作为退役 `authoring` 与当时 `verification` 边界的历史实机记录。
- **自动化边界**：路径、字段和挂载计划进入测试；实际 DSH 加载属于 `PA-06`。

### PA-05 `dsh-dev` 实例完整生命周期

- **要回答**：本地实例能否从参数预览到停止完整运行，失败时是否如实报告。
- **操作链**：`up --dry-run` → `up` → `ps` → `url` → `logs` → `up --replace` → `down`；同时检查缺参数时的可用值列表、自动实例名与端口、端口竞态、缺少环境变量、单一 stdout JSON 和停止失败。
- **当前证据**：单元测试覆盖当前 eval-only CLI 合同、新建 Experiment 时只引用全仓 DSH 锁而不生成 Candidate 锁，以及旧实例的只读运维兼容；既有实机证据见 [`dsh-dev-identity-and-lifecycle-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-identity-and-lifecycle-20260919.json)、[`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 和 [`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/runs/run-a4abf894-4750-4113-8497-7fc08a3a36b5/evidence/T-AUTHORING-PLUGIN-PERSISTENCE/dsh-plugin-restart-20260922.json)，但这些实机记录早于本次模式收敛。
- **当前试点证据与缺口**：[EXP-009 生命周期记录](../evolution/experiments/EXP-security-operations-expert-009/evaluation/evidence/dsh-dev-lifecycle-20260929.json)在同一来源上完成 `up --dry-run`、`up`、`ps`、认证 `url` 探针、`logs`、`up --replace` 和 `down`，确认容器重建、HOME 保留及停止后无运行容器；缺少必填环境变量的替换请求在重启前被拒绝。尚未实测端口竞态或停止失败等其他异常分支。Docker 自动删除曾短暂卡在 `removing`，见 [`dsh-global-lock-image-20260928T104351Z.json`](../evolution/experiments/EXP-security-operations-expert-007/evaluation/evidence/dsh-global-lock-image-20260928T104351Z.json)，后续装载和 Run 已恢复。
- **自动化边界**：参数、状态转换和失败报告进入测试；Docker 进程、认证交接和真实停止状态用实机探针。

### PA-06 被测容器的真实装载与只读边界

- **要回答**：评测容器是否加载正确来源，并形成三棵 Candidate 资产只读、判分材料不可见的视图。
- **操作链**：确认镜像身份 → 启动评测实例 → 核对目标 Preset、Skill、Plugin/MCP 声明、三棵只读挂载和判分材料不可见性。
- **当前证据**：Compose、来源计划和装载探针测试覆盖当前机器合同；全仓版本锁对应的新镜像已核对 Image ID 与构建指纹，全部九个已登记来源的隔离 `verify-load` 均通过，见[装载证据](../evolution/experiments/EXP-security-operations-expert-007/evaluation/evidence/dsh-global-lock-load-20260928T112027Z.json)。EXP-007 的真实 Web 会话曾完成自动化任务创建、查看和删除，见其 [Decision](../evolution/experiments/EXP-security-operations-expert-007/decision.md)。语音隔离实例使用同一锁定来源的标准镜像，已核对四个 Candidate/依赖挂载均为只读，见[构建证据](../evolution/experiments/EXP-security-operations-expert-007/evaluation/evidence/dsh-image-build-20260929T102953Z-875853.json)及[语音 Run](../evolution/experiments/EXP-security-operations-expert-007/runs/run-fe58afad-133d-44fb-b92c-19bf74523083/report.md)。
- **当前试点证据与缺口**：[EXP-009 生命周期记录](../evolution/experiments/EXP-security-operations-expert-009/evaluation/evidence/dsh-dev-lifecycle-20260929.json)核对了容器内 Prompt 与宿主 Candidate 的摘要一致、三棵资产只读以及评分材料不可见；[Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-009/evaluation/observations.md)关联实际 API Session 和原始回答。九个来源的 `verify-load` 仍只证明配置组合；OAuth、定时触发和其他业务语义未因此获得验证。
- **自动化边界**：Compose 和计划合同进入测试；真实容器内可见内容用容器探针。

### PA-07 宿主修改、装载观察与回退闭环

- **要回答**：修改是否真正进入受 Git 管理的 Candidate，并在新会话中产生可观察变化。
- **操作链**：记录基线引用或资产摘要 → 宿主开发会话修改 Candidate → 复核 Git diff 与摘要 → 新评测容器、新 Session 观察 → 回退 → 再建会话确认旧行为消失。
- **当前证据**：[`dsh-dev-real-session-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json) 记录一次已退役容器开发模式下的 Skill 闭环；[`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/runs/run-a4abf894-4750-4113-8497-7fc08a3a36b5/evidence/T-AUTHORING-PLUGIN-PERSISTENCE/dsh-plugin-restart-20260922.json) 记录当时的插件命令和 HOME 持久化观察。当前 `mutation-receipt.py` 提供摘要、冻结、校验与缺席目标恢复。
- **当前试点证据与缺口**：[EXP-009 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-009/evaluation/observations.md)记录了 Prompt 修改、两次修订候选的新容器与 Session 观察，以及重新选择 EXP-008 来源后的资产摘要和回答；语义效果限定在所选问法。新 Preset、Plugin 变化和真实业务 MCP 的修改与回退仍未覆盖。
- **自动化边界**：摘要、冻结与恢复合同进入测试；模型行为和真实工具效果由 Experiment Run 记录。

### PA-08 DSH Runtime API 与 Web UI 的 Session、消息与结果闭环

- **要回答**：受管评测能否分别通过 DSH Runtime API 完成业务 Turn，并通过 Web UI 完成用户可见链路冒烟，两者不混算结果。
- **操作链**：启动 Web → 使用本次认证 URL → API 默认路径注册 Workspace、逐 Case 创建正确 Preset 的 Session、发送消息、等待 Turn 并导出轨迹；或显式选择浏览器路径，核对页面进入、新会话身份、发送和回答显示。
- **当前证据**：[`dsh-web-technical-preflight-20260915T054223Z.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-web-technical-preflight-20260915T054223Z.json) 记录技术预检。`dsh-eval` 已实现默认 API 与显式浏览器执行器；两者共享 Case、精确 Preset/Workspace 身份检查和证据格式，分别形成 Run。评审 Preset 放在评测适配层，与被测 Candidate 分离。命令结果用 `executor` 标明通道，运行态 Case 证据用 `transport` 标明通道。替身进程测试覆盖 `fast/full/--case` 选择、通道选择、每 Case 新 Session、多轮同 Session、启动、认证入口、结果封存、停止和 Token 不落盘；插件实验另记录了宿主重启后的 Profile 持久化。[`run-8941fbbc-8f7b-42f0-9890-d2f12249e79b`](../evolution/experiments/EXP-security-operations-expert-007/runs/run-8941fbbc-8f7b-42f0-9890-d2f12249e79b/report.md) 是本实现产生的真实 DSH Runtime API `full` Run：40 个 Case 全部完成，原始 Session、工具事件和逐 Case 评审证据均已封存，受管实例已停止。
- **当前新镜像证据**：[`run-2028f3b1-7a8c-42ea-9da6-2a59f5187262`](../evolution/experiments/EXP-security-operations-expert-007/runs/run-2028f3b1-7a8c-42ea-9da6-2a59f5187262/report.md) 以全仓锁构建的新镜像完成 `U-QA-003` 的真实 API Turn 和独立评审 Turn；评审请求的工具列表为空，机器判定 1/1 通过，受管实例已停止。
- **当前工具切片证据**：[EXP-009 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-009/evaluation/observations.md)关联两次修订 Candidate 的 `U-QA-012/013` 真实 API Run、对应基线及来源回退 Run；分别保留被测 Session、评审证据、实际模型路由和原始回答。机器两题通过，人工结论限定为所选问法下方法说明更完整。
- **语音浏览器证据**：同一标准镜像的隔离实例已封存 [`Qwen 浏览器 Run`](../evolution/experiments/EXP-security-operations-expert-007/runs/run-fe58afad-133d-44fb-b92c-19bf74523083/report.md)，真实麦克风、远程 ASR、语音发送、模型回复和 TTS 解码链路通过；[`默认 DeepSeek 浏览器 Run`](../evolution/experiments/EXP-security-operations-expert-007/runs/run-e6a57ade-9cfe-4a47-9637-85e07ee423fe/report.md) 因外部 MCP 工具 schema 悬空引用失败。
- **巡检浏览器补充证据**：[EXP-015-r632 观察](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/evaluation/observations.md)关联同一实例的 `U-INS-002/007` 页面试跑和连续导航，确认可见回答、一次发起及同 `runId` 续查；两个新 HOME 的正式浏览器 [Run 1](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/runs/run-1aa3c04c-8a53-482a-951a-16f06f12f827/report.md)、[Run 2](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/runs/run-1d3814b5-b1b1-4812-90a0-74f464ac8218/report.md)完成 `U-INS-002` UI 冒烟，核对目标会话与回答显示，业务结论均为 `inconclusive`；[新增失败 Run](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/runs/run-0631c1d6-4d37-40b3-bb13-9dffd754490c/report.md)在连接工作区时超时，未执行 Case。此前[另一新实例 Run](../evolution/experiments/EXP-security-operations-expert-015-r6328dfd1ae6e/runs/run-d3a1e3d5-dddc-42a6-9543-e02a3e129924/report.md)在执行 Case 前失败，原因尚未定位。
- **缺口**：[EXP-007 门户联调](security-operations-expert门户联调记录.md)历史试点曾在 iframe 中完成真实 Web 会话；当前免认证直连实例的浏览器工作台、模型回复、自动化任务入口及独立启用 `--skip-testing-notice` 后“内测声明”刷新不再弹出已验证，但门户代理切换后的 iframe 尚未重测。语音 Run 使用真实浏览器脚本与 `run_record.py` 封存，其他业务 Case 的浏览器链路及默认模型的语音回复仍待验证；现有 Run 不证明全部 MCP 业务语义，也不代表生产验收。
- **自动化边界**：确定性的通道编排与异常闭环进入测试；身份、工具目录和证据由执行器生成，仍需从真实 API Run 或浏览器冒烟 Run 核对；模型与 MCP 语义仍需人工判读。

### PA-09 新 Preset 创建、登记、重载与选择闭环

- **要回答**：新 Preset 是否由宿主开发会话写入 Candidate、登记来源，并被新容器、新 Session 实际选择。
- **操作链**：通过引导技能创建 Experiment Candidate → 复核差异与 Preset ID → 登记 `sources.json` → 启动新评测实例 → 在 Web 或 Runtime API 中选择 → 观察结果。
- **当前证据**：`dsh-dev init`、Preset 身份映射和来源一致性已有机器检查。
- **缺口**：还没有按当前宿主创建路径完成真实登记、装载、选择和观察的完整记录。
- **自动化边界**：身份和路径一致性进入测试；Web 选择及运行行为属于 E2E。

### PA-10 Research Run 的创建、记录、缺口与封存

- **要回答**：一次运行能否说明“用的哪版、输入是什么、观察到什么、有哪些失败和限制”。
- **操作链**：`init` → 逐项 `record` → 必要时 `gap` → `finalize` → 反向确认封存后不能追加结果；受管路径由 `dsh-eval` 完成同一闭环。
- **当前证据**：Run v2 将 `execution_status` 与 `verdict` 分离，要求材料化 `evidence_ref`，并在 `completed` 封存前覆盖全部锁定 Case。`run_record.py` 与 `dsh-eval` 的机器测试覆盖 `fast/full/--case` 选择、所选 Case 的完整输入和预期快照、完整场景目录、API/浏览器通道分离、证据、异常封存、场景分析摘要、报告中去重 Case 的覆盖与归因假设、封存后拒绝追加；`full` 归因测试还覆盖当前 Run 的只读挂载、一场景一 Session、受限只读工具和必读证据访问校验。插件实验另保留一次实际初始化、记录、缺口和封存回执。真实 [`full` Run 报告](../evolution/experiments/EXP-security-operations-expert-007/runs/run-8941fbbc-8f7b-42f0-9890-d2f12249e79b/report.md) 已封存 40/40 个 Case：机器判定为 32 通过、8 失败；[`analysis.json`](../evolution/experiments/EXP-security-operations-expert-007/runs/run-8941fbbc-8f7b-42f0-9890-d2f12249e79b/analysis.json) 记录 4 个独立场景 Session 对 40/40 个 Case 的完整复核，形成 24 条带支持 Case、反例 Case、原始证据引用、替代解释和证伪方法的缺口假设，报告正文同步呈现。
- **当前新镜像证据**：全仓锁对应的 [`U-QA-003` Run](../evolution/experiments/EXP-security-operations-expert-007/runs/run-2028f3b1-7a8c-42ea-9da6-2a59f5187262/report.md) 已封存完整输入、来源、目标与评审轨迹，机器判定 1/1 通过。[EXP-009 Evaluation 观察](../evolution/experiments/EXP-security-operations-expert-009/evaluation/observations.md)关联同一标准镜像下的新旧来源多次封存 Run、人工复核及 Decision；`run_record.py index/show/compare` 在两个真实查证任务中把多处证据定位收敛为查询入口，查找步骤减少，未测人工阅读时间。
- **语音 Run 证据**：`U-VOICE-001` 的 [Qwen 通过 Run](../evolution/experiments/EXP-security-operations-expert-007/runs/run-fe58afad-133d-44fb-b92c-19bf74523083/report.md)和[默认 DeepSeek 失败 Run](../evolution/experiments/EXP-security-operations-expert-007/runs/run-e6a57ade-9cfe-4a47-9637-85e07ee423fe/report.md)均已记录实际浏览器观察、来源、输入和限制并封存。
- **跨条件对照工具证据**：2026-10-07 的 Run 生命周期测试以两个不同预期模型封存共同 Case，确认新报告包含来源、冻结口径、Trial、观察、证据和模型差异；旧报告不改写。`compare` 将有共同结果标为可观察对照，将模型差异标为因果归因限制。此为机器合同验证，尚无本次中文优先和本地 Qwen 组合的新实机 Run。
- **缺口**：已有真实 API Run、模型请求、MCP 调用和场景归因路径；仍需由研究者独立审阅归因质量，并用后续重复 Run 检验可复现性。语音浏览器 Run 仅覆盖单 Case 的两种模型路径，默认模型失败；现有记录不构成 OAuth 或生产验收。
- **自动化边界**：schema、唯一 ID、状态转换、证据引用和封存进入测试；观察是否支持假设由人审阅。

### PA-11 Research Release 打包、解析与复现装载

- **要回答**：一个值得保留的研究版本能否按清单恢复并重新装载。
- **操作链**：从完成的 Experiment 选择版本 → 生成自包含 Release → 核对逐文件摘要 → `release:<id>` 解析 → 只读装载 → 核对实际身份和至少一个声明行为。
- **完成标准**：同一 Release 能从自身清单恢复；复现报告同时写明成功、失败和已知限制。
- **当前证据与缺口**：静态目录合同将由仓库校验器覆盖，但当前没有 Research Release，`dsh-dev` 也未实现 `release:<id>`，因此完整路径未实现。
- **自动化边界**：清单、摘要和解析进入测试；真实 DSH 重新装载用复现探针。该结论不包含生产部署验收。

### PA-12 全局 DSH 平台启动、认证与只读资产查询

- **要回答**：研究者能否通过系统全局 DSH 装载仓库平台插件，从原生认证进入只读资产首页，并获得与仓库一致的 Agent、Experiment、Run 及来源信息。
- **操作链**：`platform/dsh-platform prepare` → `start --dry-run` → `start` → 原生认证交接 → 打开“研究资产”首页 → 经真实 `inventory` RPC 核对清单与来源 → 刷新 → `Ctrl+C` 停止 → 重启并核对相同来源；命令和装载合同见[平台设计方案](DSH智能体运行管理平台设计方案.md#当前最小平台接入合同)。
- **当前证据（2026-10-12）**：本分支合入平台实现后，启动器 [10 项测试](../platform/test_dsh_platform.py)和[插件 8 项测试](../platform/plugin/test/)通过，TypeScript 检查与构建通过，仓库合同校验通过。只读查询在当前仓库识别 **2 个 Agent、20 个 Experiment、61 个 Run**，包括带 `-r<12hex>` 后缀的 Experiment；插件测试覆盖真实 Cordis RPC 注册、查询、刷新、失败恢复和卸载。来源提交 `5c0f50a` 的文档记录了源仓库上全局 DSH、原生认证和 Chromium 页面验证；其资产数量与当前分支不同，不能作为本分支的实机验收结果。
- **验证范围与限制**：当前环境的 `PATH` 中没有全局 `dsh`，因此本分支尚未执行 `prepare`、真实启动、认证交接、浏览器查询、停止和重启。当前已验证的是静态合同与插件行为；新 DSH 版本须重新核对兼容声明和实际装载。本路径不产生业务 Experiment Evaluation 或 Research Release 复现结论。
- **自动化边界**：只读预览、任意工作目录定位、发现和归属、缺少产物、版本不兼容及端口冲突进入确定性测试；真实 DSH 装载、认证 RPC 和用户可见页面用实机及浏览器验证。资产查询不需要 LLM API Key，不产生业务 Experiment Evaluation 结论。

## 4. 为什么是 12 条

| 稳定入口或能力 | 归入路径 |
|---|---|
| `AGENTS.md`、项目审查原则、`harness-guided-workflow`、Memory、AI 纠错记录 | `PA-01`、`PA-03` |
| `SOURCES.md`、受控副本、项目解释 | `PA-02` |
| 三个资产/研究校验工具 | `PA-03` |
| `source_contract.py` 与角色挂载计划 | `PA-04` |
| `dsh-dev up/ps/url/logs/down` | `PA-05` |
| 镜像构建、容器装载和边界探针 | `PA-06` |
| `mutation-receipt.py` 与宿主开发会话 | `PA-07` |
| `dsh-eval`、DSH Runtime API/Web UI、Session、消息与轨迹导出 | `PA-08`、`PA-10` |
| Preset 创建、登记、重载和选择 | `PA-09` |
| `run_record.py` 的 Run 记录、索引、查看与比较 | `PA-10` |
| Research Release 清单、解析和复现 | `PA-11` |
| `platform/dsh-platform`、平台 Cordis Host/客户端、原生认证与只读资产首页 | `PA-12` |

单元测试、负向样例、日志和证据文件用于证明某条路径，不因数量增加而成为新的一级路径。某个 Experiment 使用 1 个还是 100 个输入，也不改变项目级路径总数。

## 5. 哪些验证应该进入测试

| 验证类型 | 建议位置 | 原因 |
|---|---|---|
| 解析、schema、路径、摘要、状态转换、失败分支 | `tests/` 或 owning module 邻近的测试 | 稳定、快速、可重复，适合每次变更回归 |
| Docker 挂载、镜像、DSH 进程和实际装载 | 适配层探针；必要结果放 Experiment `evaluation/evidence/` | 依赖真实运行环境，单元测试不能替代 |
| Web 工作区、Session、消息和用户可见结果 | 浏览器 E2E 或带步骤的人工实录 | HTTP `200` 无法证明完整用户路径 |
| Harness 行为变化 | 对应 Experiment 的 Run、观察和 Decision | 结论依赖具体假设、输入、模型和环境 |
| Research Release 复现 | Release 清单检查加真实重新装载记录 | 静态完整性与实际行为需要分别证明 |

原则很简单：稳定、确定、可重复的合同进入自动化测试；依赖真实模型、MCP、浏览器或容器的路径保留可复现步骤和实机证据。二者不能互相替代。

## 6. 维护规则

- 项目治理、CLI、适配层或工作流变化时，先标出受影响的 `PA-xx`。
- 总数、总览行数和“为什么是 12 条”的入口映射必须一致。
- 新证据与该路径的完成标准一致时才提升状态；依赖变化或证据失效时应降级。
- 本矩阵不复制某个 Experiment 的输入、阈值或结论，只链接其主要事实源。
- 完成工作时分别报告：机器合同、真实运行路径、Experiment 结论和未验证项。
