# ai-agent-harness

用于管理可被 DSH 等 Agent Runtime 装载的 Agent / Harness 工程资产，并保存这些资产从需求、实验、评估到发布的完整演进证据。

本仓库管理的是业务能力及其运行支撑配置，不包含 DSH Runtime 源码，也不复制 Runtime 内部目录。DSH 从容器镜像启动时，应通过明确的 Runtime Adapter 和只读卷挂载装载仓库中的不可变 Release；会话、缓存、凭据和其他运行态数据不属于 Release。

## 当前状态

- 仓库治理版本：[0.1.0](./VERSION.md)。这不是 Agent/Harness Release，也不是 Git Tag。
- 当前尚未导入或发布任何 Agent/Harness 资产。
- 已提供的 `security-operations-expert` 旧 Harness 归档和历史交付目录仍是待摄取输入，不是本仓库中的 Baseline、Candidate 或 Release。
- 在取得具体 DSH 镜像或版本、Profile、宿主机与容器路径、挂载模式和启动方式前，不宣称任何资产已经通过 DSH 实机验收。

## 核心边界

| 平面 | 管理内容 | 不代表什么 |
|---|---|---|
| Harness 资产平面 | Task、Acceptance、Harness、Eval Set、Experiment、Baseline、Release、Runtime Adapter | 不授予运行权限，也不保存 Runtime 凭据或运行态数据 |
| DSH Runtime 平面 | 镜像、Profile、Preset、Plugin、MCP、工具权限、沙箱、网络、凭据和实际挂载 | 配置存在不代表 Harness 已评估或获准发布 |
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
│   ├── manifest.yaml
│   ├── current/                      # Release 制品晋升后生成的校验镜像；生产不直接挂载
│   ├── components/                   # Prompt/Preset/Skill/Tool/Policy/Workflow/Memory 等
│   └── delivery/                     # 六项交付内容及唯一机器证据
├── tasks/<task-domain>/              # Task 与 AC 的引用或生成投影
├── eval/                             # 跨 Agent 复用的 grader、选择器和报告索引
├── evolution/
│   ├── baselines/                    # 评估与交付通过后的稳定资产
│   ├── experiments/                  # EXP-<agent-id>-NNN
│   └── history/
├── plugins/                          # 确有需要时纳入版本管理的自定义扩展
├── mcp/                              # MCP 声明与 schema，不保存凭据
├── runtime/                          # 兼容矩阵与 Runtime Adapter
└── releases/<agent-id>-v<semver>/    # 可部署、不可变且自包含的 Harness 制品
    ├── manifest.yaml                 # Release/Baseline/Run/兼容范围/摘要绑定
    ├── harness.yaml
    ├── runtime.yaml
    ├── artifact-manifest.json        # 完整可装载资产树的逐文件摘要
    ├── evaluation-report.md
    └── CHANGELOG.md
```

目录语义和两套规范之间的裁决见[《项目规范解释与裁决》](./docs/standards/PROJECT-INTERPRETATION.md)。

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

3. 旧资产进入仓库前，先执行只读摄取检查；检查通过只代表归档机器规则通过，不等于内容可信、交付通过或可运行。
4. 新建 Agent 时从可核验的 `REQ-xxx` 和唯一 `AC-xxx` 事实源开始；没有实际内容时不要创建目标目录占位。
5. 形成候选版本后执行完整正式评估和对应复核，再生成 Release。禁止直接修改或发布生产 Harness。

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
