# ai-agent-harness 项目验收矩阵

更新日期：2026-09-20

本文是 **ai-agent-harness 仓库自身**的验收路径与当前状态唯一维护位置。它回答仓库治理、开发工具链和 DSH 开发接入是否可用，不代替某个业务 Harness 的交付评估，也不代替不可变 Release 在目标 DSH 中的运行验收。

## 1. 直接答案：本项目共有 11 条一级验证路径

截至 2026-09-20，本项目验收范围共有 **11 条一级验证路径**，编号为 `PA-01` 至 `PA-11`。这里的“一级验证路径”是能够独立回答一个项目级问题的完整检查链；一条路径内部的命令、页面操作和正反向检查属于该路径的必要步骤，不重复计数。

这 11 条路径只统计 **ai-agent-harness 仓库及其开发工具链**。具体业务 Agent 有多少条验收路径，由它自己的 `REQ/AC` 和正式 Eval Set 决定；具体 Release 有多少次 DSH 验收，由实际发布数量和目标环境决定。后两者没有一个适用于全仓库的固定总数，也不并入这里的 11 条。

### 1.1 一页总览

| 阶段 | ID | 一级验证路径 | 当前状态 |
|---|---|---|---|
| 开发准备 | `PA-01` | AI 协作入口、根级规则与项目 Memory | 部分验证 |
| 开发准备 | `PA-02` | 规范来源、锁定版本与文档治理 | 已验证（机器范围） |
| 开发准备 | `PA-03` | 资产检查工具、仓库结构与事实源不变量 | 已验证（机器范围） |
| 开发准备 | `PA-04` | 来源解析、运行身份与判分材料隔离 | 已验证（机器范围） |
| 启动与装载 | `PA-05` | `dsh-dev` 实例完整生命周期 | 部分验证 |
| 启动与装载 | `PA-06` | Authoring/Verification 容器装载与边界 | 部分验证 |
| 修改与观察 | `PA-07` | Headless 编辑、保存、观察与回退闭环 | 部分验证 |
| 修改与观察 | `PA-08` | DSH Web 工作区、会话、消息与结果闭环 | 未验证 |
| 修改与观察 | `PA-09` | 新 Preset 创建、回流、装载与选择闭环 | 部分验证 |
| 证据与发布 | `PA-10` | Run 台账、输入锁、结果归档与封存 | 部分验证 |
| 证据与发布 | `PA-11` | 不可变 Release 解析、装载与生产核验支持 | 未实现 |

状态含义：

- **已验证（机器范围）**：已实现的确定性合同由当前自动化检查覆盖；仍需人工判断的业务语义不包含在该结论中。
- **部分验证**：已有局部自动化或真实运行证据，但完整用户路径、环境组合或结论链仍有缺口。
- **未验证**：可能已有实现或设计，但尚无足以确认该路径的当前证据。
- **未实现**：入口或完整能力尚不存在，不能通过补一条测试把它表述为可用。

状态描述的是截至更新日期已有证据，不是永久保证。实现、锁定镜像、装载机制或证据边界变化后，应重跑受影响路径并更新本矩阵。

## 2. 先确认这 11 条属于哪一层

| 层级 | 回答的问题 | 主要事实源 | 不能据此宣称 |
|---|---|---|---|
| 本项目验收 | 仓库规则、来源锁定、开发启动器、隔离、Run 工具和协作入口是否按设计工作 | 本矩阵、`tests/`、适配层测试与项目技术证据 | 某个业务 Agent 已满足其需求，或某个 Release 已上线 |
| Harness 交付验收 | 某个 Agent 的冻结候选是否满足 `REQ/AC`、Eval Set、安全硬门禁和 R1/R2/R3 要求 | `agents/<agent-id>/spec/acceptance.yaml`、`eval/cases.jsonl`、正式 Run 与交付记录 | 仓库所有开发路径都可用，或 DSH 已实际装载该 Release |
| DSH Release 验收 | 目标 DSH 是否装载了与已通过候选一致的具体不可变 Release，并完成真实协议和业务链 | `releases/<agent-id>-v<semver>/` 与 `dsh-release-verify` 运行证据 | 仅凭健康检查、容器启动或 Harness 的离线评估即认定上线成功 |

上面的固定总数 11 只属于第一行“本项目验收”。开始任务时先确定要回答哪一层的问题；一次工作可以跨层，但每层必须使用自己的证据和结论，不把项目单元测试、Harness Eval 或 DSH 健康检查相互替代。

## 3. 每条路径具体要验证什么

### 3.1 开发准备

#### PA-01 AI 协作入口、根级规则与项目 Memory

- **验证顺序**：读取根级 `AGENTS.md` 和项目入口 → 解析 `.codex/config.toml` → 在受信任的新开发会话中确认规则与 Memory 实际生效 → 能找到本矩阵并正确区分三层验收。
- **完成标准**：静态配置与稳定入口通过校验，并至少有一次新会话实际生效观察；不能只凭配置文件存在就声称当前会话已经启用。
- **现有证据与缺口**：仓库校验器已确认规则入口和布尔值 `features.memories = true`；新会话的有效配置仍受项目信任、用户级配置和启动参数影响，因此当前为部分验证。Memory 的用途、安全和事实源边界以根级 [`AGENTS.md`](../AGENTS.md#memory) 为准，本矩阵不重复维护。

#### PA-02 规范来源、锁定版本与文档治理

- **验证顺序**：读取 `SOURCES.md` → 核对锁定提交和受控副本 SHA-256 → 检查来源优先级 → 来源变化时人工评估语义影响。
- **完成标准**：机器检查确认文件身份未漂移；升级或冲突场景另有人工影响结论。摘要相同只能证明字节身份，不能代替语义判断。
- **现有证据与缺口**：当前固定提交、规范副本和摘要均由仓库校验器覆盖，机器范围已验证。

#### PA-03 资产检查工具、仓库结构与事实源不变量

- **验证顺序**：只读检查不可信外部资产 → 检查仓库目录与命名 → 检查 Agent、Experiment、Candidate、Baseline、Release 和 `current/` 的关系 → 检查 spec/eval/交付数据的唯一事实源与格式合同 → 用负向样例确认违规输入失败关闭。
- **完成标准**：`inspect_source.py`、`validate_repository.py` 和 `validate_delivery.py` 对合法输入给出各自范围内的机器结论；重复事实源、错误身份、可变 Release、非法链接、危险归档和占位资产等反例被拒绝。某个 Agent 的业务语义是否通过仍属于 Harness 交付验收。
- **现有证据与缺口**：`tests/test_validators.py` 已覆盖三类检查工具的当前确定性合同；新增拓扑、数据合同或生命周期规则时必须同步扩展。

#### PA-04 来源解析、运行身份与判分材料隔离

- **验证顺序**：解析 `experiment:<id>` → 推导目标 Agent、Preset 和资产根 → 分别生成 authoring、subject、scoring 挂载计划 → 正向确认开发/评分侧所需材料 → 反向确认被测侧看不到验收阈值、方法和预期答案。
- **完成标准**：来源、会话身份和优化目标可区分，三种角色得到正确挂载视图，任何判分材料暴露到 subject 都失败关闭。
- **现有证据与缺口**：来源合同、角色挂载测试及容器角色隔离探针覆盖当前机器合同；Runtime 或挂载设计变化后需重跑容器探针。

### 3.2 启动与装载

#### PA-05 `dsh-dev` 实例完整生命周期

- **验证顺序**：`plan` → `up` → `ps` → `url` 与认证会话 → `logs` → `up --replace` → `down`。同时验证错误来源、模式冲突、端口冲突、环境变量缺失、停止失败和状态未知时均不虚报成功。
- **完成标准**：每个正向步骤产生预期状态，失败分支保持旧实例或明确报告未知，不泄露 Token，也不把进程存在当作业务可用。
- **现有证据与缺口**：单元测试、[`dsh-dev-identity-and-lifecycle-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-identity-and-lifecycle-20260919.json) 和 [`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 已覆盖主要合同；仍需在受支持环境持续核对完整实机生命周期和异常恢复。

#### PA-06 Authoring/Verification 容器装载与边界

- **验证顺序**：构建或确认锁定镜像 → 运行访问预检 → 启动 Authoring 并核对开发身份、目标声明和可写/只读边界 → 启动 Verification 并反向确认开发身份与判分材料不存在 → 核对 Preset、Profile、Skill、Plugin、MCP 和模块边界 → 保存技术证据。
- **完成标准**：两种模式实际加载指定来源，挂载模式和模块边界与计划一致；技术装载结论不得写成业务评估或 Release 验收通过。
- **现有证据与缺口**：[`dsh-dev-live-load-20260918.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-live-load-20260918.json) 和 [`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 已记录当前镜像下的主要探针；镜像、Profile、适配层或挂载合同变化后必须重跑。

### 3.3 修改与观察

#### PA-07 Headless 编辑、保存、观察与回退闭环

- **验证顺序**：记录变更前回执 → 开发会话读取目标并修改 Candidate 行为资产 → 记录变更后回执与差异 → 宿主侧复核并保留变更 → 新被测会话观察新行为 → 回退或从受控冻结源恢复 → 再建新会话确认旧行为消失。
- **完成标准**：`mutation-receipt.py` 的 `before/after` 能证明改动范围，必要的 `freeze/restore` 能验证恢复来源；正向修改和反向回退都能在新会话中观察，且修改确实回到 Candidate 源码，不只停留在容器 HOME 或旧 Session。
- **现有证据与缺口**：[`dsh-dev-real-session-20260919.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json) 记录了一次真实模型、本地模拟 MCP 的 Skill 闭环；仍需覆盖其他资产类型、异常路径和真实业务 MCP。

#### PA-08 DSH Web 工作区、会话、消息与结果闭环

- **验证顺序**：启动 Web 实例 → 使用本次进程认证 URL 打开页面 → 注册计划给出的工作区 → 建立采用正确 Preset 的新 Session → 发送消息 → 观察回答、工具行为或明确错误 → 核对必要的源码、运行状态和记录。
- **完成标准**：浏览器中的实际用户交互从工作区选择走到可核对结果；页面能打开、HTTP `200` 或容器健康都不能替代。
- **现有证据与缺口**：[`dsh-web-technical-preflight-20260915T054223Z.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-web-technical-preflight-20260915T054223Z.json) 只提供技术预检，没有完整浏览器交互证据，因此当前未验证。

#### PA-09 新 Preset 创建、回流、装载与选择闭环

- **验证顺序**：在可写用户根复制或创建临时新 ID → 用新 Session 试跑 → 宿主侧复核差异 → 将内容合并回既有稳定 ID，或明确登记新的稳定 ID → 新容器重新装载 → 在 Web 中显式选择并观察 → 确认旧 Session 没有被误判为已更新。
- **完成标准**：容器内产物已回到受 Git 管理的 Candidate，Preset 身份、来源路径和 Profile 默认值一致，新容器/新 Session 实际加载目标版本。
- **现有证据与缺口**：已有可写根边界、`preset_id`/来源路径/Profile 交叉门禁，以及 [`dsh-review-followup-20260920.json`](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-review-followup-20260920.json) 的显式映射测试；尚未完成 Web 真实创建、回流和选择。Headless/ACP 不组成 Agent Preset，不能替代这条路径。

### 3.4 证据与发布

#### PA-10 Run 台账、输入锁、结果归档与封存

- **验证顺序**：`init` 建立独立 Run → 锁定 Git、Harness、spec/eval、镜像、模型和测试范围 → 逐 Trial 记录结果 → 记录缺口 → `finalize` 生成汇总并封存 → 反向确认完成后的执行事实不能覆盖。
- **完成标准**：研究 Run 与正式 Run 都能从自身记录回答“测了什么、用的哪一版、结果是什么、有什么缺口”，重跑使用新的 `run_id`。
- **现有证据与缺口**：`run_record.py` 单元测试覆盖工具合同；尚无现行 `runs/run-<UUIDv4>/` 可作为真实研究 Run 或正式 Run 的项目实录。

#### PA-11 不可变 Release 解析、装载与生产核验支持

- **验证顺序**：存在通过交付门禁的不可变 Release → `release:<id>` 解析到唯一制品 → 核对清单和摘要 → 只读挂载具体 Release → 核对 DSH 实际加载身份 → 通过对外协议执行完整任务链 → 核对用户结果、工具行为、最终业务状态和必要审计记录 → 验证停止或回滚方法。
- **完成标准**：项目工具链能够稳定选择和装载具体 Release；每个 Release 仍须单独执行 `dsh-release-verify`，不能把一次项目机制验证继承给以后所有 Release。
- **现有证据与缺口**：Release 结构和一致性已有静态合同，但 `dsh-dev` 当前只开放 `experiment:<id>`，尚无合格 Release 可执行完整路径，因此当前未实现。

本次工作只明确并加固上述合同，不执行 `PA-08`、`PA-09` 的 Web 真实用户路径，不创建正式 Eval、候选基线或 Release，也不把 Headless/ACP 的技术核验改写成 Web Preset 选择已完成。

## 4. 为什么当前总数是 11 条

当前稳定入口、公开能力和生命周期阶段均能归入下表。表中“归入现有路径”表示它是该完整检查链中的命令、工具或证据，不再单独增加一个一级编号。

| 入口或能力 | 归入路径 | 计数说明 |
|---|---|---|
| 根级 `AGENTS.md`、`.codex/config.toml`、项目 Memory、AI 纠错记录 | `PA-01` | 都服务于开发协作入口和会话规则 |
| `SOURCES.md`、受控规范副本、`PROJECT-INTERPRETATION.md` | `PA-02` | 共同回答规范身份、优先级和语义变更治理 |
| `inspect_source.py`、`validate_repository.py`、`validate_delivery.py` | `PA-03` | 是资产检查工具链；具体 Agent 的业务通过结论仍属于 Harness 交付验收 |
| `source_contract.py`、三角色挂载计划和判分材料隔离 | `PA-04` | 共同回答所选来源如何变成正确且隔离的运行视图 |
| `dsh-dev plan/up/ps/url/logs/down` 和 `up --replace` | `PA-05` | 是一个实例从计划、启动、观察到停止的完整生命周期 |
| `dsh-dev image build`、访问预检、`verify-load.sh`、容器/模块探针、只读查询插件技术核验 | `PA-06` | 都是 Runtime 实际装载和边界的检查步骤 |
| `mutation-receipt.py before/after/freeze/restore` 与 Headless 会话 | `PA-07` | 共同形成修改、保存、观察和恢复闭环 |
| DSH Web 的工作区、Session、消息和结果交互 | `PA-08` | 是独立于 Headless 的真实用户界面路径 |
| Preset 复制/创建、身份映射、源码回流、重载和选择 | `PA-09` | 是跨用户根、Candidate 和新 Session 的独立资产闭环 |
| `run_record.py init/record/gap/finalize` | `PA-10` | 是一次 Run 从输入锁到封存的完整证据链 |
| `release:<id>`、不可变制品映射和 `dsh-release-verify` | `PA-11` | 项目只验证装载支持；每个具体 Release 仍须单独验收 |

以下内容不增加项目级路径总数：

- 某个 Agent 的需求摄入、待复核输入渲染、Case、AC、Trial、R1/R2/R3 和安全控制检查属于 **Harness 交付验收**；其数量随 Agent 变化。
- 每个不可变 Release 在某个目标环境中的真实协议和业务链属于 **DSH Release 验收**；其执行次数随 Release 和环境变化。
- 单元测试、负向样例、探针和证据文件用于证明某条路径，不因数量增加而变成新的一级路径。

新增稳定 CLI 命令、Web 用户流程、运行模式或生命周期阶段时，必须先判断它是现有路径中的一个步骤，还是能够独立成功或失败的新一级路径：前者补入对应 `PA-xx`，后者新增编号并同步修改本节总数。仅重构内部函数、增加同类负向样例或更换证据文件，不增加一级路径数量。

## 5. 验证结果应该放在哪里

| 验证类型 | 主要位置 | 允许得出的结论 |
|---|---|---|
| 纯函数、解析、结构、失败关闭和确定性不变量 | `tests/` 或 owning module 邻近的 `test_*.py` / `test_*.mjs` | 对应机器合同通过 |
| 需要 Docker、挂载、镜像或 DSH 进程的技术探针 | `runtime/adapters/dsh-container/` 的探针；必要证据归入 Experiment 的 `evaluation/evidence/` | 指定环境下的技术装载或隔离成立 |
| 本项目完整开发路径 | 本矩阵对应 `PA-xx`，辅以可复现步骤和受控证据 | 该项目路径在声明范围内已验证或仍有缺口 |
| 具体业务 Harness 的能力与安全门禁 | `agents/<agent-id>/spec/`、`eval/`、逐 Run 结果和交付记录 | 冻结候选在相同口径下的交付评估结论 |
| 具体不可变 Release 的 DSH 上线 | Release 制品及 `dsh-release-verify` 证据 | 该 Release 在目标环境实际装载并完成声明的业务链 |

适合稳定、可重复且不依赖外部运行态的规则应进入测试。Web 手工交互、真实模型/MCP、生产装载等不能只做成宿主单元测试；它们要保留环境、步骤、实际结果和限制。反过来，一次实机记录也不能替代解析器和失败关闭规则的回归测试。

## 6. 维护规则

- 项目治理、启动器、适配层或工作流变更时，先标出受影响的 `PA-xx`，再选择单元测试、容器探针或完整路径验收。
- 一页总览的路径总数、`PA-xx` 行数和“为什么当前总数是 11 条”的覆盖映射必须一致；不能只新增一行而不更新总数和入口映射。
- 只有新证据与该行声明范围一致时才提升状态；证据失效、依赖变化或回归失败时及时降级并写明缺口。
- 本矩阵只维护项目级路径状态。业务 Harness 的 `AC-xxx`、Case、Trial 和 Release 结果只在各自事实源维护，这里最多引用，不复制阈值或通过结论。
- 完成工作时按层级分别报告已验证、未验证和不在本次范围内的内容；不得用“测试通过”笼统覆盖三层验收。
