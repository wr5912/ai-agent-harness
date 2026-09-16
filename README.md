# ai-agent-harness

用于管理仅供容器内 DSH（DeepSeek Harness）Agent Runtime 装载的 Agent / Harness 工程资产，并保存这些资产从需求、实验、评估到发布的完整演进证据。

本仓库管理业务能力及其运行支撑配置，不包含 DSH Runtime 源码，也不复制 Runtime 内部目录。DSH 从容器镜像启动，通过分别声明的卷装载候选资产或不可变 Release。开发态 Experiment Candidate 可在隔离 Authoring 容器中只对行为工作区读写；受控 Profile、Guard、MCP 绑定、凭据、评估证据和 Release 始终不由模型写入。会话、缓存、凭据和其他运行态数据不属于 Harness 资产。

## 当前状态

- 仓库治理版本：[0.1.0](./VERSION.md)。这不是 Agent/Harness Release，也不是 Git Tag。
- 已将 `security-operations-expert` 的旧 Harness 业务语义和初版交付材料迁入 [`EXP-security-operations-expert-001`](./evolution/experiments/EXP-security-operations-expert-001/) 的 Candidate 与清洗历史。旧归档中的 Hook、宽松权限配置、部署脚本和环境文件未原样激活。
- 当前交付结论为“退回整改”：历史检查有实质失败，200 条输入仍待领域专家逐条复核和 `AC-xxx` 绑定，没有正式 Trial、候选基线、稳定 Baseline、Release 或 `current/`。
- 即使容器构建、Profile 展开、只读挂载及 Mock MCP 等技术检查通过，也只证明迁移路线的局部可行性；没有真实模型、真实 MCP、审批与完整业务链的 R3 证据时，不宣称 DSH 已交付或可上线。

## 核心边界

| 平面 | 管理内容 | 不代表什么 |
|---|---|---|
| Harness 资产平面 | Task、Acceptance、Harness、Eval Set、Experiment、Baseline、Release、Runtime Adapter | 不授予运行权限，也不保存 Runtime 凭据或运行态数据 |
| DSH Runtime 平面 | 镜像、Profile、Preset、Plugin、MCP、工具权限、沙箱、网络、凭据和实际挂载 | 容器中可组合 Candidate 行为资产；配置存在不代表 Harness 已评估或获准发布 |
| Codex 项目协作平面 | 根级 `AGENTS.md`、`.agents/skills/` 和 `.codex/config.toml` | 不是 DSH 挂载资产，不得充当生产控制面 |

## 演进主线

```text
需求来源与 REQ/AC
→ 选择 direct 或 exploration 开发路径
→ Experiment 与 Candidate
→ 冻结候选基线 baseline_id
→ 正式自测与 R1/R2/R3 交付复核
→ 不可变 Release
→ DSH 装载与真实任务链验证
→ 生产反馈、失败案例与下一轮回归
```

每项语义性 Harness 变更都进入 Experiment。`direct` 表示实施路线已明确，可以直接开发；`exploration` 仅用于会改变实施路线的关键不确定性，并先以 5～20 个真实或高度接近真实的样本探索。两条路径都不能跳过候选基线、正式自测、交付复核和发布一致性检查。

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
│   ├── current/                     # 仅 Release 晋升后生成；生产不直接挂载
│   ├── components/                  # 稳定组件确有内容时才创建
│   └── delivery/                    # 正式六项交付内容及唯一机器证据
├── tasks/<task-domain>/              # Task 与 AC 的引用或生成投影
├── eval/                             # 跨 Agent 复用的 grader、选择器和报告索引
├── evolution/
│   ├── baselines/                    # 评估与交付通过后的稳定资产
│   ├── experiments/                  # EXP-<agent-id>-NNN
│   └── history/                      # 清洗历史证据，不随 Candidate/Release 装载
├── plugins/                          # 确有需要时纳入版本管理的自定义扩展
├── mcp/                              # MCP 声明与 schema，不保存凭据
├── runtime/adapters/dsh-container/   # 锁定 DSH 源码的薄容器装载适配层
└── releases/<agent-id>-v<semver>/    # 可部署、不可变且自包含的 Harness 制品
    ├── manifest.yaml                 # Release/Baseline/Run/兼容范围/摘要绑定
    ├── harness.yaml
    ├── runtime.yaml
    ├── artifact-manifest.json        # 完整可装载资产树的逐文件摘要
    ├── evaluation-report.md
    └── CHANGELOG.md
```

目录语义和两套规范之间的裁决见[《项目规范解释与裁决》](./docs/standards/PROJECT-INTERPRETATION.md)。

## security-operations-expert 候选迁移

当前候选把 25 个旧业务 Skill 改写为容器内 DSH 可直接发现的 `workspace/.agents/skills/<name>/SKILL.md`，并以 DSH `agent.cordis.yml`、受控 Profile Patch、三个 MCP Client、四个受限委派角色和原生 Guard 表达原先的 Harness 语义。迁移不复制旧 `.claude`、`CLAUDE.md`、`.mcp.json`、活动 Hook 或宽松权限设置到可装载树。

资产分为三个容器挂载平面：

| 阶段 | 工作区行为资产 | Preset 与 managed 控制 | 证据与发布 |
|---|---|---|---|
| Authoring Experiment | 隔离候选工作区可读写；容器内 DSH 可自组合、自修改，当前 Session 可实时看到探索行为 | 只读；凭据从 Runtime 注入 | 历史/评估不挂载；改动只形成待审 diff，进入核验态前须经宿主侧校验并用新容器、新 Session 重建 |
| Verification Candidate | 候选快照只读 | 只读 | 仅做锁定版本集成检查，不产生正式交付结论 |
| Release/生产 | 只挂具体不可变 Release，全部只读 | 只读 | 反馈进入下一轮 Experiment；不在生产自修改 |

容器启动、停止、镜像固定、挂载和局部检查见 [`dsh-container` 适配说明](./runtime/adapters/dsh-container/README.md)。真实安全动作仍由 DSH Runtime 与领域 MCP 服务端执行强制鉴权、租户/对象绑定、参数与数量约束、幂等、审批及审计；Prompt 或本仓库中的策略文字不能替代这些服务端控制。

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

3. 旧资产进入仓库前，先执行只读摄取检查；本仓库已有的迁移输入则以 [`source-manifest.json`](./evolution/history/imports/security-operations-expert-2026-09-15/source-manifest.json) 记录逐文件摘要和处置。检查通过只代表归档机器规则通过，不等于内容可信、交付通过或可运行。
4. 新建 Agent 时从可核验的 `REQ-xxx` 和唯一 `AC-xxx` 事实源开始；没有实际内容时不要创建目标目录占位。
5. 形成候选版本后执行完整正式评估和对应复核，再生成 Release。Authoring 中的自修改不自动晋升、发布或改变交付结论；禁止直接修改生产 Harness。

常用的只读机器检查：

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/legacy-asset-intake/scripts/inspect_source.py <archive-or-directory>
python3 .agents/skills/harness-evolution/scripts/validate_repository.py .
python3 .agents/skills/baseline-eval/scripts/validate_delivery.py agents/<agent-id>
```

三个脚本都输出 JSON。退出码 `0` 只表示其覆盖的机器规则通过；`1` 表示存在阻断项或必须复核的风险，`2` 表示输入或读取错误。

## 规范来源

- [Harness Repo 目录结构设计说明（v1.1）](./docs/standards/Harness_Repo目录结构设计说明_v1.1.md)
- [Harness Asset Repository 规范（v1.0）](./docs/standards/Harness_Asset_Repository规范_v1.0.md)
- [来源锁定与文件摘要](./docs/standards/SOURCES.md)
- [`agent-engineering-spec` 锁定提交](https://github.com/wr5912/agent-engineering-spec/commit/1afe0eec1bb786e5313bb0a06717871fd14ebe28)

原始规范、项目裁决与实现发生分歧时，按[来源优先级](./docs/standards/PROJECT-INTERPRETATION.md#1-来源优先级)处理；项目裁决只能补齐本仓库的歧义，不得降低上游安全、评估或发布门禁。

## 验收口径

- 静态校验、脚本退出码 `0`、进程存在、端口监听、HTTP `200` 或 `/health` 只证明对应局部检查通过。
- 正式交付必须能够追溯 `REQ → AC → Eval Case → Trial → Run → results.csv → 交付结论 → Release`。
- DSH 发布验收必须核对装载的 Release 与通过的候选基线一致，并通过对外实际协议完成至少一条完整任务链；涉及工具或写操作时还要检查最终业务状态和审计证据。
- 仓库变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
