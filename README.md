# ai-agent-harness

本项目用于在本地开发和比较基于 DSH（DeepSeek Harness）的智能体。开发者可以选择一套 Harness 启动 DSH 容器，修改提示词、技能、Preset 和插件配置，运行目标智能体，并用 Git 保存研究结果。项目重点研究 Harness 优化、Harness 资产管理，以及不同 Variant 的效果差异。

当前已实现开发启动器 `runtime/adapters/dsh-container/dsh-dev` 的基础命令，以及来源解析、回执、Run 台账和仓库校验工具。**开发闭环已在真实模型与本地模拟 MCP 条件下走通一次**：开发会话读到开发者身份与解析出的目标、在目标工作区完成修改、改动保存到候选、被测会话观察到该变化；回退后观察结果随之消失（见 `dsh-dev-real-session-20260919.json`）。仍待完成的是正式 Eval Set 与候选基线下的业务评估，以及 web 界面工作区注册流程本身的操作核验。这些是当前状态，不是最终能力声明。

## 现在能做什么

| 能力 | 状态 | 入口 |
|---|---|---|
| 解析所选来源，确定目标 Agent、preset、资产路径与容器挂载 | 已实现 | `source_contract.py` |
| 启动开发会话（`--mode dev`）或被测目标会话（`--mode eval`） | 已实现，需要 Docker 与运行时环境变量 | `dsh-dev plan` / `up` / `ps` / `url` / `logs` / `down` |
| 重载实例配置或迁移旧版实例状态 | 已实现 | `dsh-dev up --replace` |
| 构建锁定 DSH 提交的本地镜像 | 已实现 | `dsh-dev image build` |
| 记录变更前后回执，核对资产树摘要 | 已实现 | `mutation-receipt.py` |
| 归档一次运行（输入锁、Trial、缺口、汇总） | 已实现 | `run_record.py` |
| 校验仓库结构、Agent spec/eval、交付证据 | 已实现 | `.agents/skills/*/scripts/` |
| 用真实模型和真实 MCP 跑完整业务任务链 | 未完成 | 需要注入模型与 MCP 凭据后按验收口径执行 |

`dsh-dev` 支持的来源选择器只有 `experiment:<id>`；`release:<id>` 要等第一个不可变 Release 发布并接好容器映射后才开放。

## 从哪里开始

1. 读根级 [`AGENTS.md`](./AGENTS.md)。它的“开发对象与修改边界”定义了本项目的四类对象——开发智能体的运行配置、被开发或优化的 Harness 资产、需求、测试数据与评估标准、运行状态与运行记录——并说明每一类由谁负责、允许怎么改。后面的开发对象判断都以它为准。
2. 读[来源锁定](./docs/standards/SOURCES.md)和[项目规范解释](./docs/standards/PROJECT-INTERPRETATION.md)，确认规范版本与本地取舍。
3. 按任务选择项目技能：

   | 技能 | 使用时机 |
   |---|---|
   | `legacy-asset-intake` | 只读清点旧归档或历史交付，不解包入库、不执行其中内容 |
   | `harness-evolution` | 建立需求、变更分类、Experiment、Candidate 和晋升路径 |
   | `baseline-eval` | 设计或校验 Eval Set、候选基线、Trial 和结果契约 |
   | `security-control-boundary` | 定义数据、权限、审批、动作和失败安全边界 |
   | `delivery-review` | 核验交付内容、机器证据及 R1/R2/R3 结论边界 |
   | `dsh-release-verify` | 验证 Release、DSH 装载结果和真实协议任务链 |
   | `ai-correction-log` | 用户反馈纠错时抽取问题要点，按天追加到 `AI纠错记录/` |

4. 需要启动容器时，先确认 Docker 可用、目标镜像已构建，并按 `.env` 之外的方式注入运行时环境变量（见下一节）。

### 启动一个本地实例

下面先起一个开发实例再起一个评测实例；两者的 `session_preset` 与要注册的工作区不同，但 `target_preset` 都是所选来源声明的同一业务目标。

```bash
# 1. 只解析来源并打印计划，不启动任何容器。计划里 session_preset 是本次会话身份，
#    target_preset 是待优化目标，workspace_to_register 是随后要在界面注册的工作区。
python3 runtime/adapters/dsh-container/dsh-dev plan \
  --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3081

# 2. 构建锁定提交的镜像（首次或镜像内容变化后；适配层脚本走挂载，不需要重建）
python3 runtime/adapters/dsh-container/dsh-dev image build

# 3. 注入运行时环境变量后启动开发实例。dev 模式等同 shell 权限，必须显式确认；
#    注册工作区是 /work，会话身份来自受控只读的 /work/AGENTS.md。
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3081 \
  --accept-cordis-trust

# 4. 另起一个评测实例：注册工作区是 /work/harness/workspace，会话运行目标 preset。
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 --mode eval --name secops-eval --port 3082

# 5. 取本次进程的认证 URL；非交互终端必须显式加 --non-interactive
python3 runtime/adapters/dsh-container/dsh-dev url secops-dev

# 6. 查看状态与停止。停止失败或无法确认时不报告成功
python3 runtime/adapters/dsh-container/dsh-dev ps
python3 runtime/adapters/dsh-container/dsh-dev down secops-dev
```

改了 preset、managed 或适配层脚本之后，容器里的进程不会因为挂载内容变化而自动重启：

```bash
# 一条命令完成重载：先停同名实例自身的容器（HOME 数据卷保留）再按新配置启动
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3081 \
  --accept-cordis-trust --replace

# 等价做法：先 down，再同名 up
```

前置条件与边界：

- `up` 需要运行时环境变量已注入（变量名由所选来源声明，见 `sources.json`）。缺少时默认拒绝启动；只有技术装载核验才可用 `--allow-missing-env` 显式降级。
- 实例配置生成在仓库外（`$XDG_STATE_HOME/dsh-dev/<name>/`），Token 不落盘、不入仓库、不回显到日志。
- 容器使用 host 网络但只绑定 `127.0.0.1`。`--mode dev` 的会话具备 shell 与执行模型 JS 的能力，等同 shell 权限，需要 `--accept-cordis-trust` 显式确认。
- 首次打开 DSH Web 需要手工注册工作区，路径按模式不同：`--mode dev` 注册 `/work`，`--mode eval` 注册 `/work/harness/workspace`；以 `plan.workspace_to_register` 为准。DSH 在该锁定提交上没有受支持的工作区预注册入口。换实例名等于换 HOME 卷，需要重新选择一次。
- 同名实例不得改端口；`up` 检测到端口被本实例自身占用时，会提示先 `down` 或使用 `--replace`，不会自动改端口。

## 两类会话与判分材料

启动器区分两种用户模式，它们看见的资产不同：

| | `--mode dev`（开发会话） | `--mode eval`（被测目标会话） |
|---|---|---|
| `session_preset`（本次会话身份） | 出厂 `cordis` 创造模式 | 所选来源声明的目标 preset |
| `target_preset`（待优化/待评估目标） | 所选来源声明的业务 preset | 同 `session_preset` |
| 注册工作区 | `/work` | `/work/harness/workspace` |
| 目标工作区 | 可写（同一候选源码） | 只读 |
| `/work/spec`（需求、任务、验收标准） | 只读挂载 | 不挂载 |
| `/work/eval-reference`（评估方法、测试预置、预期答案） | 只读挂载 | 不挂载 |

开发会话运行的是创造模式，但它要优化的目标仍是来源声明的业务 preset——`session_preset` 与 `target_preset` 在开发模式下不同，报告目标时用后者。

判分材料不进入被测容器，是因为只读挂载只限制写入、不限制读取：把验收阈值和预期答案挂进被测容器，再依赖被测实现自己的文件访问限制去挡，等于让被测对象保护的边界去保护测试本身。开发会话需要这些材料来阅读和核对，所以照常挂载；容器内它们是只读的，维护在宿主侧完成。

## 主要目录

本仓库按资产职责、生命周期和证据等级组织目录，而不是按文件类型、物理服务或权限层机械分层。需求与评测输入、可修改的 Candidate、按次归档且完成后不可改写的 Run 事实、不可变 Release 和 Runtime 运行状态分别维护；每类事实只设一个主要维护位置，索引、报告和镜像不得成为第二套可编辑事实源。资产越接近生产，可变性越低，生产只使用明确版本的不可变 Release。目录位置说明维护和追溯关系，本身不等于权限或安全控制。

目录只在出现真实内容时物化，不预建空 Agent、空 Eval、空报告或空平台。下列路径同时包含当前入口，以及到达对应生命周期后才会物化的关键位置。

```text
AGENTS.md                                # 项目级协作规则，含四类对象定义
.codex/config.toml                       # 当前开发智能体配置，不是业务 Harness 或 DSH 配置
.agents/skills/                          # 维护本仓库的 Codex 技能，不是业务 Agent Skill
docs/
  standards/                             # 受控规范副本、来源锁定与项目解释
agents/<agent-id>/
  spec/                                  # 需求、任务与验收标准的唯一事实源
  eval/
    cases.jsonl                          # 正式 Eval Case 唯一事实源；通过复核后才物化
    methods.yaml                         # 评估方法与聚合规则
    fixtures/                            # 测试预置与前置状态，不是 Runtime 状态
    pending/                             # 待人工复核输入，不得用于正式 Run 或通过结论
  delivery/                              # 正式交付文档与引用视图，不存 Trial 事实
  current/                               # Release 后生成的同摘要校验镜像，不作为生产挂载源
evolution/
  experiments/EXP-<agent-id>-NNN/
    candidate/
      dsh/
        workspace/                       # 行为资产；Authoring 可写，核验只读
        presets/                         # DSH Preset 源码；运行容器只读装载
        managed/                         # Guard、MCP、Profile/Patch 等受控配置；容器内只读
      delivery/                          # 候选交付记录，不表示评估或发布通过
    evaluation/
      evidence/                          # 迁移、构建、装载与审计证据，不代替业务验收
      tools/                             # 摄入、派生与审阅工具，不是 DSH 资产
    runs/run-<UUIDv4>/                   # 每次执行的独立 Trial 事实，完成后不可覆盖
    snapshots/
      README.md                          # 已退役研究快照到 Git 提交的恢复映射
      frozen-sources/fr-<UUIDv4>/        # 可选三树冻结副本，不是 Baseline 或 Release
  baselines/<agent-id>-v<semver>/        # 通过评估后与 Release 同时晋升的稳定资产
  history/
    imports/<agent-id>-YYYY-MM-DD/       # 按接收批次保存来源副本、清洗材料和处置清单
plugins/                                 # 自定义扩展源码；治理工具或业务资产按本次用途判断
runtime/adapters/dsh-container/          # 锁定 DSH 的容器装载适配层
tests/                                   # 仓库工具、校验器与解析器测试，不存业务 Eval Case
releases/<agent-id>-v<semver>/           # 不可变、自包含的生产装载资产
AI纠错记录/                               # 按天追加的 AI 纠错记录
```

`evolution/history/imports/` 只用于来源追溯和迁移审计。每个批次可以包含归档来源副本、清洗后的历史材料、批次说明和来源处置清单；它们不是现行 `spec/`、`eval/` 或 Candidate 的第二套可编辑事实源，也不会随目标 Harness 装载。需要改变当前需求、评估资料或 Harness 时，应修改对应现行资产并按演进流程保存，不回写历史批次来改变当前行为。

上表只展开会影响修改位置、事实源、装载方式或结论判断的边界目录。Plugin Profile、Runtime 核验控制和测试分组等实现细节继续由各目录的局部 README 说明，根 README 不维护一份重复的完整文件树。

## 演进主线

```text
需求来源与任务边界 → direct 或 exploration → Experiment 与 Candidate
                         ├─ Git 提交（研究版本） → 比较/派生 Variant 或记录停止结论
                         └─ 正式交付 → 补齐 REQ/AC 与完整候选基线 baseline_id
                                      → 正式自测与 R1/R2/R3 交付复核
                                      → 不可变 Release → DSH 真实任务链验证
                                      → 反馈、失败案例与下一轮回归
```

每项语义性 Harness 变更都进入 Experiment。研究实验可以停止、不采用或证据不足；研究版本用 Git 保存和比较，**不默认复制整套源码快照**。早期物化的 `snapshots/research/` 副本已从工作树移除，其内容按 [`snapshots/README.md`](./evolution/experiments/EXP-security-operations-expert-001/snapshots/README.md) 的映射从 Git 提交恢复。按需生成的 `snapshots/frozen-sources/` 只冻结 Candidate 的三棵实际挂载树，用于字节核对和恢复；它不包含完整冻结组合，也不是研究版本、候选基线、稳定 Baseline 或 Release。进入正式交付后，必须补齐候选基线、正式自测、交付复核和发布一致性检查。

## 当前进度

- 仓库治理版本：[0.2.0](./VERSION.md)。这不是 Agent/Harness Release，也不是 Git Tag。
- `security-operations-expert` 的旧 Harness 业务语义和初版交付材料已迁入 [`EXP-security-operations-expert-001`](./evolution/experiments/EXP-security-operations-expert-001/) 的 Candidate 与清洗历史；旧归档中的 Hook、宽松权限配置、部署脚本和环境文件未原样激活。
- 五类场景（响应处置、巡检、故障排查、策略配置、知识问答）的需求、任务与验收标准已摄入 `agents/security-operations-expert/spec/`：34 项 `REQ-001..034`、34 项任务、39 项 `AC-001..039`（确认状态：待交付负责人确认）。评估方法与测试预置位于 `agents/security-operations-expert/eval/`。
- 当前交付结论为“退回整改”：321 条待复核输入（200 条旧候选、115 条设计样例、6 条用户补充输入）仍待逐条领域复核和 `AC-xxx` 绑定，没有正式 Trial、候选基线、稳定 Baseline、Release 或 `current/`。
- `plugins/asset-query-cli/` 是独立的只读管理入口原型，已在锁定镜像中验证无模型、无业务 MCP 时的目录查询、JSON 输出与退出语义。

## 常用只读检查

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/legacy-asset-intake/scripts/inspect_source.py <archive-or-directory>
python3 .agents/skills/harness-evolution/scripts/validate_repository.py .
python3 .agents/skills/baseline-eval/scripts/validate_delivery.py agents/<agent-id>
```

三个脚本都输出 JSON。退出码 `0` 只表示其覆盖的机器规则通过，`1` 表示存在阻断项或必须复核的风险，`2` 表示输入或读取错误。

评测闭环的宿主侧工具：

```bash
# 解析来源并生成三角色挂载计划；被测角色默认不含判分材料
python3 runtime/adapters/dsh-container/source_contract.py --source experiment:EXP-<agent-id>-NNN --mount-plan subject
# 变更前后回执
python3 runtime/adapters/dsh-container/mutation-receipt.py --source experiment:EXP-<agent-id>-NNN before
python3 runtime/adapters/dsh-container/mutation-receipt.py --source experiment:EXP-<agent-id>-NNN after <before-receipt>
# Run 台账：init → record → gap → finalize
python3 runtime/adapters/dsh-container/run_record.py --repo . init --agent <agent-id> --experiment EXP-<agent-id>-NNN --source experiment:EXP-<agent-id>-NNN --kind research
python3 runtime/adapters/dsh-container/run_record.py --repo . record --run <run-uuid> trial.json
python3 runtime/adapters/dsh-container/run_record.py --repo . finalize --run <run-uuid> --status completed
# 待复核输入的阅读视图（只读渲染，不产生第二份事实源）
python3 evolution/experiments/EXP-<agent-id>-NNN/evaluation/tools/render_pending_review.py --agent-dir agents/<agent-id>
```

## 规范来源

- [Harness Repo 目录结构设计说明（v1.1）](./docs/standards/Harness_Repo目录结构设计说明_v1.1.md)
- [Harness Asset Repository 规范（v1.0）](./docs/standards/Harness_Asset_Repository规范_v1.0.md)
- [来源锁定与文件摘要](./docs/standards/SOURCES.md)
- [`agent-engineering-spec` 锁定提交](https://github.com/wr5912/agent-engineering-spec/commit/1afe0eec1bb786e5313bb0a06717871fd14ebe28)

原始规范、项目裁决与实现发生分歧时，按[来源优先级](./docs/standards/PROJECT-INTERPRETATION.md#1-来源优先级)处理；项目裁决只能补齐本仓库的歧义，不得降低上游安全、评估或发布门禁。

## 验收口径

正式交付必须能够追溯 `REQ → AC → Eval Case → Trial → Run 归档 → 交付结论 → Release`。DSH 发布验收必须核对装载的 Release 与通过的候选基线一致，并通过对外实际协议完成至少一条完整任务链；涉及工具或写操作时还要检查最终业务状态和审计证据。

静态校验、脚本退出码 `0`、进程存在、端口监听、HTTP `200` 或 `/health` 只证明对应局部检查通过，不构成交付评估或发布授权。真实安全动作仍由 DSH Runtime 与领域 MCP 服务端强制执行鉴权、租户/对象绑定、参数与数量约束、幂等、审批及审计；仓库中的策略文字不能替代这些服务端控制。

仓库变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
