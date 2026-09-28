# ai-agent-harness 项目验收矩阵

更新日期：2026-09-24

本文是 **ai-agent-harness 项目与工具链**验证路径、当前证据和缺口的唯一维护位置。它直接回答三个问题：总共有多少条路径、每条做到什么程度、哪些检查应该进入自动化测试。

## 1. 直接答案：共有 11 条一级验证路径

当前共有 **11 条一级验证路径**，编号 `PA-01` 至 `PA-11`。一级路径是用户可以独立完成、并且能够独立成功或失败的一条完整工作链；内部命令和正反向检查不重复计数。

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

状态含义：

- **已验证（机器范围）**：稳定、确定性的合同已有自动化正反向检查；不包含人工语义判断。
- **部分验证**：已有实现和局部证据，但完整用户路径、真实环境或异常分支仍有缺口。
- **未验证**：可能已有设计或局部实现，但没有足以确认完整路径的证据。
- **未实现**：完整入口尚不存在，不能靠补一条测试把它描述为可用。

这 11 条只统计项目与工具链，不把每个 Harness 的研究输入数量或每个 Release 的复现次数算进去。新增稳定 CLI、运行模式或独立用户流程时，先判断它是既有路径中的步骤，还是能独立成功或失败的新一级路径；只有后者才增加总数。

## 2. 三种结论必须分开

| 层级 | 回答的问题 | 主要证据 | 不能据此声称 |
|---|---|---|---|
| 项目与工具链验证 | 仓库规则、CLI、来源解析和 DSH 接入是否按设计工作 | 本矩阵、`tests/`、技术探针 | 某个 Harness 改动有效 |
| Experiment Evaluation | 某项 Harness 变化在声明输入和环境下表现如何 | 假设、Run、观察、回归、Decision | 整个工具链或其他 Experiment 都可用 |
| Research Release 复现 | 某个不可变研究版本能否恢复并重新装载 | Release 清单、摘要、复现记录 | 已满足生产部署、安全或运维要求 |

这三层都属于研究项目，不包含生产部署验收。未来若需要生产工程，应另行定义权限、安全、运维和发布合同。

## 3. 逐条路径

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
- **当前证据**：来源合同、挂载计划和角色隔离测试覆盖当前机器合同；[`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json) 仅作为退役 `authoring` 与当时 `verification` 边界的历史实机记录。
- **自动化边界**：路径、字段和挂载计划进入测试；实际 DSH 加载属于 `PA-06`。

### PA-05 `dsh-dev` 实例完整生命周期

- **要回答**：本地实例能否从参数预览到停止完整运行，失败时是否如实报告。
- **操作链**：`up --dry-run` → `up` → `ps` → `url` → `logs` → `up --replace` → `down`；同时检查缺参数时的可用值列表、自动实例名与端口、端口竞态、缺少环境变量、单一 stdout JSON 和停止失败。
- **当前证据**：单元测试覆盖当前 eval-only CLI 合同及旧实例的只读运维兼容；既有实机证据见 [`dsh-dev-identity-and-lifecycle-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-identity-and-lifecycle-20260919.json)、[`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 和 [`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json)，但这些实机记录早于本次模式收敛。
- **缺口**：当前 eval-only 合同尚未在同一实例重新跑完 `up`、`url`、`logs`、`up --replace`、`down` 及异常恢复；不同 Docker/DSH 环境下仍需持续观察。
- **自动化边界**：参数、状态转换和失败报告进入测试；Docker 进程、认证交接和真实停止状态用实机探针。

### PA-06 被测容器的真实装载与只读边界

- **要回答**：评测容器是否加载正确来源，并形成三棵 Candidate 资产只读、判分材料不可见的视图。
- **操作链**：确认镜像身份 → 启动评测实例 → 核对目标 Preset、Skill、Plugin/MCP 声明、三棵只读挂载和判分材料不可见性。
- **当前证据**：Compose、来源计划和装载探针测试覆盖当前机器合同；[`dsh-dev-live-load-20260918.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-live-load-20260918.json)、[`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 和 [`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json) 是模式收敛前的历史实机证据。
- **缺口**：当前 eval-only Compose 尚未重跑真实装载；也未执行 OAuth、真实模型请求或浏览器 Session，技术装载不说明业务能力有效。
- **自动化边界**：Compose 和计划合同进入测试；真实容器内可见内容用容器探针。

### PA-07 宿主修改、装载观察与回退闭环

- **要回答**：修改是否真正进入受 Git 管理的 Candidate，并在新会话中产生可观察变化。
- **操作链**：记录基线引用或资产摘要 → 宿主开发会话修改 Candidate → 复核 Git diff 与摘要 → 新评测容器、新 Session 观察 → 回退 → 再建会话确认旧行为消失。
- **当前证据**：[`dsh-dev-real-session-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json) 记录一次已退役容器开发模式下的 Skill 闭环；[`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json) 记录当时的插件命令和 HOME 持久化观察。当前 `mutation-receipt.py` 提供摘要、冻结、校验与缺席目标恢复。
- **缺口**：尚未按“宿主修改 → 当前 eval-only 新实例 → 回退 → 再观察”重跑完整语义闭环；未覆盖 Prompt、Preset、Plugin 行为及真实业务 MCP。
- **自动化边界**：摘要、冻结与恢复合同进入测试；模型行为和真实工具效果由 Experiment Run 记录。

### PA-08 DSH Runtime API 与 Web UI 的 Session、消息与结果闭环

- **要回答**：受管评测能否分别通过 DSH Runtime API 完成业务 Turn，并通过 Web UI 完成用户可见链路冒烟，两者不混算结果。
- **操作链**：启动 Web → 使用本次认证 URL → API 默认路径注册 Workspace、逐 Case 创建正确 Preset 的 Session、发送消息、等待 Turn 并导出轨迹；或显式选择浏览器路径，核对初始提示、工作区、模型、发送和显示。
- **当前证据**：[`dsh-web-technical-preflight-20260915T054223Z.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-web-technical-preflight-20260915T054223Z.json) 记录技术预检。`dsh-eval` 已实现默认 API 与显式浏览器执行器；两者共享 Case、精确 Preset/Workspace 身份检查和证据格式，分别形成 Run。评审 Preset 放在评测适配层，与被测 Candidate 分离。命令结果用 `executor` 标明通道，运行态 Case 证据用 `transport` 标明通道。替身进程测试覆盖 `fast/full/--case` 选择、通道选择、每 Case 新 Session、多轮同 Session、启动、认证入口、结果封存、停止和 Token 不落盘；插件实验另记录了宿主重启后的 Profile 持久化。[`run-8941fbbc-8f7b-42f0-9890-d2f12249e79b`](../evolution/experiments/EXP-security-operations-expert-007/runs/run-8941fbbc-8f7b-42f0-9890-d2f12249e79b/report.md) 是本实现产生的真实 DSH Runtime API `full` Run：40 个 Case 全部完成，原始 Session、工具事件和逐 Case 评审证据均已封存，受管实例已停止。
- **缺口**：真实 API 路径已经验证；当前仍无本实现产生的 Playwright 封存 Run，页面定位器和浏览器用户可见链路尚未实机验收。该 Run 的模型与 MCP 语义结论属于对应 Experiment 的研究证据，不代表生产验收。
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
- **缺口**：真实 API Run、模型请求、MCP 调用和场景归因路径已经验证；仍需由研究者独立审阅归因质量，并用后续重复 Run 检验可复现性。当前没有 Playwright 封存 Run，也不构成 OAuth 或生产验收。
- **自动化边界**：schema、唯一 ID、状态转换、证据引用和封存进入测试；观察是否支持假设由人审阅。

### PA-11 Research Release 打包、解析与复现装载

- **要回答**：一个值得保留的研究版本能否按清单恢复并重新装载。
- **操作链**：从完成的 Experiment 选择版本 → 生成自包含 Release → 核对逐文件摘要 → `release:<id>` 解析 → 只读装载 → 核对实际身份和至少一个声明行为。
- **完成标准**：同一 Release 能从自身清单恢复；复现报告同时写明成功、失败和已知限制。
- **当前证据与缺口**：静态目录合同将由仓库校验器覆盖，但当前没有 Research Release，`dsh-dev` 也未实现 `release:<id>`，因此完整路径未实现。
- **自动化边界**：清单、摘要和解析进入测试；真实 DSH 重新装载用复现探针。该结论不包含生产部署验收。

## 4. 为什么是 11 条

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
| `run_record.py` | `PA-10` |
| Research Release 清单、解析和复现 | `PA-11` |

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
- 总数、总览行数和“为什么是 11 条”的入口映射必须一致。
- 新证据与该路径的完成标准一致时才提升状态；依赖变化或证据失效时应降级。
- 本矩阵不复制某个 Experiment 的输入、阈值或结论，只链接其主要事实源。
- 完成工作时分别报告：机器合同、真实运行路径、Experiment 结论和未验证项。
