# ai-agent-harness

## 项目背景

本项目面向个人开发者，是以仅供容器内 DSH（DeepSeek Harness）Agent Runtime 装载的 Agent / Harness 工程资产（DSH-only Harness）为对象的自用探索研究项目。仓库管理业务能力及其运行支撑配置，保存资产从需求、实验、评估到发布的演进证据。DSH 从容器镜像启动，通过卷装载 Experiment Candidate 或不可变 Release；容器主要用于本地开发、实验和验证。

本仓库不包含 DSH Runtime 源码或内部目录，也不把会话、缓存、凭据等运行态数据作为 Harness 资产。隔离的 Authoring 容器只允许 DSH 读写 Experiment Candidate 的行为工作区；受控 Profile、Guard、MCP 绑定、评估证据和 Release 不由模型写入，凭据由受信 Runtime 注入。研究者可以修改下一版候选的 Preset、Profile/Patch、插件及非秘密依赖声明，复核、构建后在新容器和新 Session 中验证。当前阶段优先关注研究价值、开发便利性和实验结果的可追溯性，安全性不是首要考虑；现有安全红线、正式评估和发布门禁仍然适用。

项目围绕三个核心研究点展开：

- **Harness 改进优化：**基于 DSH 研究和优化 Harness 的组成、行为与执行方式，通过实验持续改进其能力、效果、稳定性和成本。
- **Harness 资产管理：**管理 Harness 及其相关配置、插件依赖、版本、实验和演化关系，使研究成果能够保存、还原、比较和复用。
- **Harness 多 Variant 实现：**研究如何将 Harness 派生或转换为适应不同任务范围、运行条件和能力约束的多个 Variant，并验证各 Variant 的适用范围与实际效果。

为支撑上述三个核心点，研究面可按需扩展至 DSH 框架与核心机制、官方及社区开源插件、相关可复用组件和插件扩展方法。研究范围不局限于提示词、Skill 或资产文件管理，但相关探索应与三个核心研究点建立明确联系。

技术路线坚持“插件扩展优先，框架修改最小化”：优先利用 DSH 现有能力、配置组合及可直接复用的开源插件，通过自定义 DSH 插件补充所需能力，尽可能少修改或完全不修改 DSH 框架源码。深入研究框架机制，是为了理解能力边界、有效利用扩展机制，并支撑 Harness 优化与 Variant 实现，而不是以改造框架为目标。只有现有能力和插件扩展确实无法满足核心研究需求时，才考虑必要的最小化框架修改；这类修改应在独立的 DSH 源码研究或上游协作中处理，不将 Runtime 源码混入本仓库的 Harness 资产。

项目规划提供[研发管理 CLI](./docs/DSH智能体研发管理平台边界设计方案.md)，方便开发者管理 Harness 资产及相关研究过程；提供 launcher，用于选择指定 Harness 及其运行配置并启动本地 DSH 容器。[DSH 只读资产查询原型](./plugins/asset-query-cli/README.md)已经验证应用级命令入口，但不等于完整管理 CLI；launcher 仍处于设计阶段。两者是职责清晰的研究支撑工具，不反向限制研究深度。当前优先验证核心研究与工具的实际价值，待价值明确后再考虑提供简易 Web 界面。

## 当前状态

- 仓库治理版本：[0.2.0](./VERSION.md)。这不是 Agent/Harness Release，也不是 Git Tag。
- 已将 `security-operations-expert` 的旧 Harness 业务语义和初版交付材料迁入 [`EXP-security-operations-expert-001`](./evolution/experiments/EXP-security-operations-expert-001/) 的 Candidate 与清洗历史。旧归档中的 Hook、宽松权限配置、部署脚本和环境文件未原样激活。
- 五类场景（响应处置、巡检、故障排查、策略配置、知识问答）的需求、任务与验收标准已按《网络安全运营五类场景_需求任务测试评估与验收标准 V0.2》摄入 `agents/security-operations-expert/spec/`：34 项 `REQ-001..034`、34 项任务、39 项 `AC-001..039`（确认状态：待交付负责人确认）。评估方法与预置场景位于 `agents/security-operations-expert/eval/`；115 条 V0.2 设计样例（`D-*`）、6 条用户补充输入与 200 条旧候选同为待领域复核输入，不构成正式 Eval Set。
- 当前交付结论为“退回整改”：历史检查有实质失败，321 条待复核输入（200 条旧候选＋115 条设计样例＋6 条用户补充输入）仍待领域专家逐条复核和 `AC-xxx` 绑定，没有正式 Trial、候选基线、稳定 Baseline、Release 或 `current/`。
- `plugins/asset-query-cli/` 是独立的只读管理入口原型：在锁定 DSH 镜像中验证了无模型、无业务 MCP 的目录查询、JSON 输出和退出语义；它不判断资产有效性或评估结论。
- 即使容器构建、Profile 展开、只读挂载及 Mock MCP 等技术检查通过，也只证明迁移路线的局部可行性；没有真实模型、真实 MCP、审批与完整业务链的 R3 证据时，不宣称 DSH 已交付或可上线。

## 核心边界

| 平面 | 管理内容 | 不代表什么 |
|---|---|---|
| Harness 资产平面 | Task、Acceptance、Harness、Eval Set、Experiment、Baseline、Release、Runtime Adapter | 不授予运行权限，也不保存 Runtime 凭据或运行态数据 |
| DSH Runtime 平面 | 镜像、Profile、Preset、Plugin、MCP、工具权限、沙箱、网络、凭据和实际挂载 | 容器中可组合 Candidate 行为资产；配置存在不代表 Harness 已评估或获准发布 |
| Codex 项目协作平面 | 根级 `AGENTS.md`、`.agents/skills/` 和 `.codex/config.toml` | 不是 DSH 挂载资产，不得充当生产控制面 |

## 演进主线

```text
需求来源与任务边界 → direct 或 exploration → Experiment 与 Candidate
                         ├─ 研究快照 → 比较/派生 Variant/记录停止或不采用结论
                         └─ 正式交付 → 补齐 REQ/AC 与完整候选基线 baseline_id
                                      → 正式自测与 R1/R2/R3 交付复核
                                      → 不可变 Release → DSH 真实任务链验证
                                      → 反馈、失败案例与下一轮回归
```

每项语义性 Harness 变更都进入 Experiment。`direct` 表示实施路线已明确，可以直接开发；`exploration` 仅用于会改变实施路线的关键不确定性，并先以 5～20 个真实或高度接近真实的样本探索。研究可以失败或证据不足而停止；用于比较和派生的研究快照需可还原，但不是正式 `baseline_id`。进入正式交付后，两条路径均不能跳过候选基线、正式自测、交付复核和发布一致性检查。[研究与交付边界](./docs/standards/PROJECT-INTERPRETATION.md#3-experiment-与开发路径)

## 目标目录

目录按实际资产按需创建；本仓库不预建空 Agent、空 Eval、空报告或空平台目录。

```text
.
├── AGENTS.md                         # 项目级协作与治理规则
├── .agents/skills/                   # 支撑仓库演进的 Codex 项目技能
├── .codex/config.toml                # 最小项目级 Codex 配置
├── docs/standards/                   # 受控规范原文、来源锁定和项目裁决
├── agents/<agent-id>/
│   ├── manifest.yaml                # 当前 Agent 身份与生命周期
│   ├── spec/                         # 业务规格：需求、任务与验收标准的唯一事实源
│   │   ├── requirements.md
│   │   ├── tasks.yaml
│   │   └── acceptance.yaml
│   ├── eval/                         # 评测输入；不存实际运行结果
│   │   ├── cases.jsonl              # 本 Agent 的 Case 唯一事实源
│   │   ├── fixtures/                # 用例附件、环境初始数据或其锁定引用
│   │   ├── methods.yaml             # 方法、评分器与 AC/Case 绑定
│   │   ├── plans/                   # 选择范围、重复次数与重置规则
│   │   └── pending/                 # 待复核输入；不得冒充正式用例
│   ├── issues/                       # 跨 Run/Experiment 的问题跟踪状态
│   ├── variants/                     # 实际出现 Variant 时创建
│   ├── current/                     # 仅 Release 晋升后生成；生产不直接挂载
│   ├── components/                  # 稳定组件确有内容时才创建
│   └── delivery/                    # 正式六项交付内容，引用 spec/eval/Run 事实
├── tasks/<task-domain>/              # Task 与 AC 的引用或生成投影
├── eval/                             # 跨 Agent 复用的 grader、选择器和报告索引
├── evolution/
│   ├── baselines/                    # 评估与交付通过后的稳定资产
│   ├── experiments/                  # EXP-<agent-id>-NNN
│   │   ├── candidate/               # 可修改 Harness；不混入评测结果
│   │   ├── snapshots/               # frozen-sources 旧三树 + research/<snap-id> 完整快照
│   │   ├── runs/<run-uuid>/         # 每次执行独立归档，失败也保留
│   │   └── evaluation/              # 技术/迁移证据
│   └── history/                      # 清洗历史证据，不随 Candidate/Release 装载
├── plugins/                          # 确有需要时纳入版本管理的自定义扩展
├── mcp/                              # MCP 声明与 schema，不保存凭据
├── runtime/adapters/dsh-container/   # 锁定 DSH 源码的薄容器装载适配层
├── tests/                            # 仓库工具、校验器、解析器与快照恢复的测试
├── releases/<agent-id>-v<semver>/    # 可部署、不可变且自包含的 Harness 制品
│   ├── manifest.yaml                 # Release/Baseline/Run/兼容范围/摘要绑定
│   ├── harness.yaml
│   ├── runtime.yaml
│   ├── artifact-manifest.json        # 完整可装载资产树的逐文件摘要
│   ├── evaluation-report.md
│   └── CHANGELOG.md
├── .local/                           # 可选本地入口；忽略的 HOME/缓存/临时工作区
└── AI纠错记录/                        # 按天追加的 AI 纠错记录（随仓库版本控制）
```

目录语义和两套规范之间的裁决见[《项目规范解释与裁决》](./docs/standards/PROJECT-INTERPRETATION.md)。

## security-operations-expert 候选迁移

当前候选把 25 个旧业务 Skill 改写为容器内 DSH 可直接发现的 `workspace/.agents/skills/<name>/SKILL.md`，并以 DSH `agent.cordis.yml`、受控 Profile Patch、三个 MCP Client、四个受限委派角色和原生 Guard 表达原先的 Harness 语义。迁移不复制旧 `.claude`、`CLAUDE.md`、`.mcp.json`、活动 Hook 或宽松权限设置到可装载树。

资产分为三个容器挂载平面：

| 阶段 | 工作区行为资产 | Preset 与 managed 控制 | 证据与发布 |
|---|---|---|---|
| Authoring Experiment | 隔离候选工作区可读写；容器内 DSH 可自组合、自修改，当前 Session 可实时看到探索行为 | 只读；凭据从 Runtime 注入 | 历史/评估不挂载；改动只形成待审 diff，进入核验态前须经宿主侧校验并用新容器、新 Session 重建 |
| Verification Candidate | 所选来源在容器中只读；比较时先物化快照 | 只读 | 默认 Compose 仍绑定可变宿主 Candidate，只能做局部技术检查；研究比较须改用经摘要复核的快照，不产生正式交付结论 |
| Release/生产 | 只挂具体不可变 Release，全部只读 | 只读 | 反馈进入下一轮 Experiment；不在生产自修改 |

容器启动、停止、镜像固定、挂载和局部检查见 [`dsh-container` 适配说明](./runtime/adapters/dsh-container/README.md)。真实安全动作仍由 DSH Runtime 与领域 MCP 服务端执行强制鉴权、租户/对象绑定、参数与数量约束、幂等、审批及审计；Prompt 或本仓库中的策略文字不能替代这些服务端控制。

面向本机开发者的容器启动器仍处于设计阶段，命令及 host 网络、Token URL 的拟议合同见[《DSH 容器开发启动器设计方案》](./docs/DSH容器开发启动器设计方案.md)；`dsh-dev up/url/open` 目前不可运行，其前置的来源选择器、三角色挂载计划、研究快照与 Run 台账已在适配层实现。

当前 Candidate 的 `workspace/.env` 只有注释，是 Docker 首次只读子文件挂载所需的目标；实际容器会用适配层同字节的受控空环境层覆盖，不能在它或 DSH_HOME 的 `.env` 中放端点、变量或凭据。

正式评估不只核对文件摘要和 Plugin 名单，还要记录 DSH 在隔离新 Session 中实际采用的模型、permission preset、Agent preset 与 Profile。运行态 `DSH_HOME/settings.yaml` 可改变这些有效默认值，但不属于 Harness Release；偏离冻结组合时不能沿用原候选基线结论。

## 快速开始

1. 先阅读根级 [`AGENTS.md`](./AGENTS.md)、[来源锁定](./docs/standards/SOURCES.md)和[项目裁决](./docs/standards/PROJECT-INTERPRETATION.md)。
2. 根据任务选择 `.agents/skills/` 中的项目技能：

   | 技能 | 使用时机 |
   |---|---|
   | `legacy-asset-intake` | 只读清点旧归档或历史交付，不解包入库、不执行其中内容 |
   | `harness-evolution` | 建立需求、变更分类、Experiment、Candidate 和晋升路径 |
   | `baseline-eval` | 设计或校验 Eval Set、候选基线、Trial、Run 和结果契约 |
   | `security-control-boundary` | 定义数据、权限、审批、动作和失败安全边界 |
   | `delivery-review` | 核验六项交付内容、机器证据及 R1/R2/R3 结论边界 |
   | `dsh-release-verify` | 验证 Release、DSH 挂载、装载结果和真实协议任务链 |
   | `ai-correction-log` | 用户反馈纠错时抽取问题要点，按天追加到 `AI纠错记录/` |

3. 旧资产进入仓库前，先执行只读摄取检查；本仓库已有的迁移输入则以 [`source-manifest.json`](./evolution/history/imports/security-operations-expert-2026-09-15/source-manifest.json) 记录逐文件摘要和处置。检查通过只代表归档机器规则通过，不等于内容可信、交付通过或可运行。
4. 新建 Agent 时从可核验的任务来源、`REQ-xxx` 和非目标开始；探索先固定判定标准与安全红线，正式开发前补齐唯一事实源中的全部适用 `AC-xxx`。没有实际内容时不要创建目标目录占位。
5. 研究比较先保存可还原快照、运行条件和结论；只有选择正式交付才冻结完整候选基线、执行正式评估和对应复核，再生成 Release。Authoring 中的自修改不自动晋升、发布或改变交付结论；禁止直接修改生产 Harness。

常用的只读机器检查：

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/legacy-asset-intake/scripts/inspect_source.py <archive-or-directory>
python3 .agents/skills/harness-evolution/scripts/validate_repository.py .
python3 .agents/skills/baseline-eval/scripts/validate_delivery.py agents/<agent-id>
```

三个脚本都输出 JSON。退出码 `0` 只表示其覆盖的机器规则通过；`1` 表示存在阻断项或必须复核的风险，`2` 表示输入或读取错误。

评测闭环的宿主侧工具（详见[启动器设计](./docs/DSH容器开发启动器设计方案.md)）：

```bash
# 解析来源并生成三角色挂载计划（authoring/subject/scoring）
python3 runtime/adapters/dsh-container/source_contract.py --source experiment:EXP-<agent-id>-NNN --mount-plan subject
# 冻结完整研究快照（需要 agents/<id>/spec 与 agents/<id>/eval 已物化）并复核
python3 runtime/adapters/dsh-container/mutation-receipt.py --source experiment:EXP-<agent-id>-NNN research-snapshot
python3 runtime/adapters/dsh-container/mutation-receipt.py research-snapshot-verify <snapshots/research/snap-<uuid>>
# Run 台账：init → record → gap → finalize
python3 runtime/adapters/dsh-container/run_record.py --repo . init --agent <agent-id> --experiment EXP-<agent-id>-NNN --source snapshot:<snap-uuid> --kind research
python3 runtime/adapters/dsh-container/run_record.py --repo . record --run <run-uuid> trial.json
python3 runtime/adapters/dsh-container/run_record.py --repo . finalize --run <run-uuid> --status completed
```

## 规范来源

- [Harness Repo 目录结构设计说明（v1.1）](./docs/standards/Harness_Repo目录结构设计说明_v1.1.md)
- [Harness Asset Repository 规范（v1.0）](./docs/standards/Harness_Asset_Repository规范_v1.0.md)
- [来源锁定与文件摘要](./docs/standards/SOURCES.md)
- [`agent-engineering-spec` 锁定提交](https://github.com/wr5912/agent-engineering-spec/commit/1afe0eec1bb786e5313bb0a06717871fd14ebe28)

原始规范、项目裁决与实现发生分歧时，按[来源优先级](./docs/standards/PROJECT-INTERPRETATION.md#1-来源优先级)处理；项目裁决只能补齐本仓库的歧义，不得降低上游安全、评估或发布门禁。

## 验收口径

- 静态校验、脚本退出码 `0`、进程存在、端口监听、HTTP `200` 或 `/health` 只证明对应局部检查通过。
- 正式交付必须能够追溯 `REQ → AC → Eval Case → Trial → Run 归档 → 交付结论 → Release`。
- DSH 发布验收必须核对装载的 Release 与通过的候选基线一致，并通过对外实际协议完成至少一条完整任务链；涉及工具或写操作时还要检查最终业务状态和审计证据。
- 仓库变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
