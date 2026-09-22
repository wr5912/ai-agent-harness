# ai-agent-harness 项目验收矩阵

更新日期：2026-09-22

本文是 **ai-agent-harness 项目与工具链**验证路径、当前证据和缺口的唯一维护位置。它直接回答三个问题：总共有多少条路径、每条做到什么程度、哪些检查应该进入自动化测试。

## 1. 直接答案：共有 11 条一级验证路径

当前共有 **11 条一级验证路径**，编号 `PA-01` 至 `PA-11`。一级路径是用户可以独立完成、并且能够独立成功或失败的一条完整工作链；内部命令和正反向检查不重复计数。

| 阶段 | ID | 一级验证路径 | 当前状态 |
|---|---|---|---|
| 准备 | `PA-01` | Research Mode、AI 协作入口与项目 Memory | 部分验证 |
| 准备 | `PA-02` | 规范来源、受控副本与适用范围 | 已验证（机器范围） |
| 准备 | `PA-03` | 仓库结构、项目技能与研究资产合同 | 已验证（机器范围） |
| 选择来源 | `PA-04` | Experiment 来源解析、会话身份与材料隔离 | 已验证（机器范围） |
| 启动 | `PA-05` | `dsh-dev` 实例完整生命周期 | 部分验证 |
| 装载 | `PA-06` | 开发/被测容器的真实装载与边界 | 部分验证 |
| 修改 | `PA-07` | Headless 修改、回流、观察与回退闭环 | 部分验证 |
| 交互 | `PA-08` | DSH Runtime API 与 Web UI 的 Session、消息与结果闭环 | 部分验证 |
| 派生 | `PA-09` | 新 Preset 创建、回流、重载与选择闭环 | 部分验证 |
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

- **要回答**：新的 AI 开发会话能否读到 Research Mode、中文优先、简洁优先、单一事实源、根因整改、精准修改和四项安全底线；Memory 是否只作为辅助上下文。
- **操作链**：读取根级 `AGENTS.md` 和 README → 解析 `.codex/config.toml` → 在受信任的新会话观察规则和 Memory 是否生效 → 确认会话能找到本矩阵。
- **当前证据**：仓库检查可确认稳定入口和 `features.memories = true`。
- **缺口**：实际生效还受项目是否受信任、用户配置和启动参数影响，需要新会话观察，因此是部分验证。
- **自动化边界**：文件存在、配置类型和稳定链接进入测试；“当前会话确实使用了 Memory”保留为实机观察。

### PA-02 规范来源、受控副本与适用范围

- **要回答**：来源身份是否没有漂移，Research Mode 是否明确区分当前合同与未来生产化参考。
- **操作链**：读取 `SOURCES.md` → 核对受控副本 SHA-256 和锁定 Commit → 读取 `PROJECT-INTERPRETATION.md` → 来源变化时人工判断影响。
- **当前证据**：摘要、提交和稳定文档入口已有机器检查。
- **自动化边界**：文件身份进入测试；“新来源是否适合当前研究”由人判断。

### PA-03 仓库结构、项目技能与研究资产合同

- **要回答**：研究资产是否放在正确位置，是否避免重复 Baseline/current 和定义投影，Experiment、Run 和 Research Release 是否具备最小可复现内容。
- **操作链**：只读检查外部资产 → 核对 `definition.md` 与 `evaluation.md` 各自只有一个职责和一个可编辑源 → 运行仓库校验 → 运行 Experiment 校验 → 用负向样例验证未知选择、本地评测计划、非法身份、空资产和危险链接会被拒绝。
- **当前证据**：`inspect_source.py`、`validate_repository.py`、`validate_experiment.py` 及其测试覆盖当前确定性合同。
- **自动化边界**：结构、格式、引用和摘要进入测试；研究内容是否真实、有价值不由校验器打分。

### PA-04 Experiment 来源解析、会话身份与材料隔离

- **要回答**：选择的 Experiment 是否解析到正确 Agent、Preset 和资产；开发会话与被测会话是否看见正确内容。
- **操作链**：解析 `experiment:<id>` → 分别生成 authoring、subject、scoring 计划 → 核对 `session_preset` 与 `target_preset` → 开发/评分角色只挂一个 `/work/reference` → 反向确认被测会话没有参考答案和判断材料。
- **当前证据**：来源合同、挂载计划和角色隔离测试覆盖当前机器合同；[`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json) 记录同一 `EXP-test01-002` 来源在 authoring 与 verification 模式下的实际边界。
- **自动化边界**：路径、字段和挂载计划进入测试；实际 DSH 加载属于 `PA-06`。

### PA-05 `dsh-dev` 实例完整生命周期

- **要回答**：本地实例能否从参数预览到停止完整运行，失败时是否如实报告。
- **操作链**：`up --dry-run` → `up` → `ps` → `url` → `logs` → `up --replace` → `down`；同时检查缺参数时的可用值列表、自动实例名与端口、端口竞态、缺少环境变量、单一 stdout JSON 和停止失败。
- **当前证据**：单元测试已覆盖当前 CLI 合同；既有实机证据见 [`dsh-dev-identity-and-lifecycle-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-identity-and-lifecycle-20260919.json) 和 [`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json)，本次独立实例的 `up --replace` 与运行状态见 [`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json)。
- **缺口**：本次未对同一实例重新跑完 `url`、`logs`、`down` 及异常恢复；不同 Docker/DSH 环境下的完整实机生命周期仍需持续观察。
- **自动化边界**：参数、状态转换和失败报告进入测试；Docker 进程、认证交接和真实停止状态用实机探针。

### PA-06 开发/被测容器的真实装载与边界

- **要回答**：两种模式是否实际加载同一来源，并形成预期的可写/只读视图。
- **操作链**：确认镜像身份 → 启动开发实例 → 核对开发身份、目标声明和共享研究资料挂载 → 启动被测实例 → 核对目标 Preset、Skill、Plugin/MCP 声明及材料不可见性。
- **当前证据**：[`dsh-dev-live-load-20260918.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-live-load-20260918.json)、[`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 和 [`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json) 记录当前镜像下的主要探针、插件装载和 verification 负向边界。
- **缺口**：镜像、Profile、适配层或挂载合同变化后需要重跑；本次未执行 OAuth、真实模型请求或浏览器 Session，技术装载不说明业务能力有效。
- **自动化边界**：Compose 和计划合同进入测试；真实容器内可见内容用容器探针。

### PA-07 Headless 修改、回流、观察与回退闭环

- **要回答**：修改是否真正进入受 Git 管理的 Candidate，并在新会话中产生可观察变化。
- **操作链**：变更前回执 → 开发会话修改 → 变更后回执 → 宿主复核 → 新被测会话观察 → 回退 → 再建会话确认旧行为消失。
- **当前证据**：[`dsh-dev-real-session-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json) 记录一次真实模型与本地模拟 MCP 的 Skill 闭环；本次插件命令和 HOME 持久化的技术观察见 [`dsh-plugin-restart-20260922.json`](../evolution/experiments/EXP-test01-002/evaluation/evidence/dsh-plugin-restart-20260922.json)。
- **缺口**：本次未修改 Candidate Harness 内容，也未执行回退和新 Session 语义观察；尚未覆盖 Prompt、Preset、Plugin 行为及真实业务 MCP 的完整闭环。
- **自动化边界**：回执、摘要和回流路径进入测试；模型行为和真实工具效果由 Experiment Run 记录。

### PA-08 DSH Runtime API 与 Web UI 的 Session、消息与结果闭环

- **要回答**：受管评测能否分别通过 DSH Runtime API 完成业务 Turn，并通过 Web UI 完成用户可见链路冒烟，两者不混算结果。
- **操作链**：启动 Web → 使用本次认证 URL → API 默认路径注册 Workspace、逐 Case 创建正确 Preset 的 Session、发送消息、等待 Turn 并导出轨迹；或显式选择浏览器路径，核对初始提示、工作区、模型、发送和显示。
- **当前证据**：[`dsh-web-technical-preflight-20260915T054223Z.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-web-technical-preflight-20260915T054223Z.json) 记录技术预检。`dsh-eval` 已实现默认 API 与显式浏览器执行器；两者共享 Case、精确 Preset/Workspace 身份检查和证据格式，分别形成 Run。命令结果用 `executor` 标明通道，运行态 Case 证据用 `transport` 标明通道。替身进程测试覆盖通道选择、API 默认排除浏览器专属 Case、启动、认证入口、结果封存、停止和 Token 不落盘；插件实验另记录了宿主重启后的 Profile 持久化。
- **缺口**：当前口径尚无本实现产生的真实 DSH Runtime API 或 Playwright 封存 Run；页面定位器、模型目录和真实 MCP 行为仍需实机验证，本次插件实验也未执行浏览器对话验收。
- **自动化边界**：确定性的通道编排与异常闭环进入测试；身份、工具目录和证据由执行器生成，仍需从真实 API Run 或浏览器冒烟 Run 核对；模型与 MCP 语义仍需人工判读。

### PA-09 新 Preset 创建、回流、重载与选择闭环

- **要回答**：新 Preset 是否从临时用户根安全回到 Candidate，并被新容器、新 Session 实际选择。
- **操作链**：创建临时新 ID → 试跑 → 复核差异 → 合并回既有 ID 或登记新 ID → 重载 → 在 Web 中选择 → 观察结果。
- **当前证据**：已有可写根、Preset 身份映射和来源一致性的机器检查。
- **缺口**：还没有 Web 中真实创建、回流、选择和观察的完整记录。
- **自动化边界**：身份和路径一致性进入测试；Web 选择及运行行为属于 E2E。

### PA-10 Research Run 的创建、记录、缺口与封存

- **要回答**：一次运行能否说明“用的哪版、输入是什么、观察到什么、有哪些失败和限制”。
- **操作链**：`init` → 逐项 `record` → 必要时 `gap` → `finalize` → 反向确认封存后不能追加结果；受管路径由 `dsh-eval` 完成同一闭环。
- **当前证据**：Run v2 将 `execution_status` 与 `verdict` 分离，要求材料化 `evidence_ref`，并在 `completed` 封存前覆盖全部锁定 Case。`run_record.py` 与 `dsh-eval` 的机器测试覆盖输入子集锁定、API/浏览器通道分离、证据、异常封存、摘要和封存后拒绝追加；插件实验另保留一次实际初始化、记录、缺口和封存回执。
- **缺口**：当前口径尚无本实现产生的真实 DSH Runtime API 或 Playwright 封存 Run；插件实验 Run 未覆盖 OAuth、真实模型请求或生产验收，仍需用实际 Experiment 检验记录是否足以复现比较结论。
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
| `AGENTS.md`、Memory、AI 纠错记录 | `PA-01` |
| `SOURCES.md`、受控副本、项目解释 | `PA-02` |
| 三个资产/研究校验工具 | `PA-03` |
| `source_contract.py` 与角色挂载计划 | `PA-04` |
| `dsh-dev up/ps/url/logs/down` | `PA-05` |
| 镜像构建、容器装载和边界探针 | `PA-06` |
| `mutation-receipt.py` 与 Headless 会话 | `PA-07` |
| `dsh-eval`、DSH Runtime API/Web UI、Session、消息与轨迹导出 | `PA-08`、`PA-10` |
| Preset 创建、回流、重载和选择 | `PA-09` |
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
