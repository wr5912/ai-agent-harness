# 项目规范解释与裁决

本文将三项锁定来源应用到 `ai-agent-harness`，解决其在研究版本管理、Baseline、Experiment、Acceptance、Eval Set、Release/current 和 DSH 装载方面的命名或目录歧义。本文是项目级解释，不修改受控原文，也不得降低上游安全、评估或发布门禁。

## 1. 来源优先级

三项来源按各自适用范围共同生效：

1. 研发、评估、安全、交付和发布门禁采用 `agent-engineering-spec` 锁定 Commit。
2. 仓库的资产种类和目标拓扑采用《Harness Repo 目录结构设计说明（v1.1）》。
3. Harness 生命周期、Runtime 解耦和持续优化原则采用《Harness Asset Repository 规范（v1.0）》。
4. 本文只在上述来源没有给出唯一实现，或将它们组合后存在歧义时作项目裁决。

若来源发生实质冲突，先按适用范围区分。仍无法消解时，安全与证据采用更严格规则，并暂停相关 Candidate 晋升或 Release，等待维护者记录裁决；不得静默采用较宽松规则。

## 2. 研究版本管理与两种 Baseline

研究中需要比较或派生时，用普通 Git 工作流保存和取回版本：把要保留的源码提交到研究分支或正常历史。**不默认复制整套源码快照**——全量副本与 Git 重复保存同一份内容，还会引入一套独立的身份与权限校验规则，而完整 POSIX 权限在 `umask` 不同的检出环境本来就无法重现。

需要同时运行不同版本时按实际需要临时使用独立目录或 `git worktree`；它是可选手段，不是所有研究的强制流程。每次执行在 `runs/<run-uuid>/inputs.lock.json` 记录实际提交、是否包含未提交修改、Harness 与 spec/eval 树摘要，以及镜像与依赖身份。未提交修改无法仅凭 `HEAD` 还原，必须如实记录，不得声称该次运行对应某个提交的完整内容。

研究版本的结论允许未评估、失败或证据不足，但不能沿用其来源的通过结论；它也不是 `bl-<UUIDv4>` 候选基线，不要求具备正式评估的完整冻结项，不能直接晋升 Release。早期物化的 `snapshots/research/<snap-id>/` 内容改由 Git 按 `evolution/experiments/<id>/snapshots/README.md` 的恢复映射取回。

| 名称 | 标识与位置 | 形成时间 | 含义 |
|---|---|---|---|
| 候选基线 | `bl-<UUIDv4>`，记录于具体 Agent 的交付记录 | 首次正式自测前 | 冻结需求与验收、Harness、Runtime、模型、控制、Eval Set、评估实现、执行规则和环境的待测组合；不代表已通过或可发布 |
| 稳定资产 Baseline | `evolution/baselines/<agent-id>-v<semver>/` | 候选基线完成正式评估、规定复核并通过交付评估后，与 Release 一起晋升 | 下一轮演进可复用的、已验证 Harness 制品；必须保留 Runtime、依赖、Eval 结论和 Release 引用 |

规则：

- `baseline_id` 是一次冻结组合的身份，不因同一组合重跑而变化；重跑生成新的 `run_id`。
- 稳定资产 Baseline 是仓库生命周期状态，不得用尚未执行的模板、旧归档或“看起来可用”的配置占位。
- 新建 Agent 没有既有稳定资产 Baseline 时，起点可以明确记录为 `N/A（首次交付）`，随后从 Task/Acceptance 建立第一个 Experiment 和 Candidate。
- 任一冻结项变化都形成新的候选基线；旧运行保留为历史证据，不能覆盖或改写。
- 研究版本用 Git 恢复和对照。正式候选基线还必须冻结需求/AC、Eval Set、评分与执行规则、Runtime 有效投影和环境等锁定规范规定的全部项目。只凭 Git HEAD、文件摘要或只读挂载，不足以证明正式运行期间内容不变；开发者按第 7.1 节的运行纪律保证本次运行期间不改写相关资产。

## 3. Experiment 与开发路径

每项会改变 Agent 行为、能力、控制边界或冻结组合的语义性 Harness 变更都进入 `evolution/experiments/EXP-<agent-id>-NNN/`。仓库自身的说明文字、工具维护等治理变更，只有实际改变某个 Agent 的交付或冻结组合时才进入该 Agent 的 Experiment。

Experiment 的 `development_path` 只能为：

- `direct`：任务、验收、路线和影响范围已经明确，不存在会改变实施路线的关键不确定性。直接实现并运行受影响范围的针对性检查。
- `exploration`：存在会改变实施路线的关键不确定性。先记录问题、预期结果、停止条件和不可降低的安全红线，再用 5～20 个真实或高度接近真实的样本探索。

`direct` 不等于绕过 Experiment；`exploration` 的样本和结果也不能替代正式 Eval。研究实验可以记录为继续、不采用、停止或证据不足，保留假设、候选、逐样本观察、失败原因和下一步，不需要为未交付的研究强制生成 `baseline_id` 或 Release。选择进入正式交付时，两条开发路径均须补齐已确认的全部 `REQ/AC`、完整候选基线冻结项、本次正式评估范围及规定复核；探索结果不能冒充这些结论。实验结束状态和内容引用若要进入机器契约，须由校验器及测试明确支持，不靠文档字段自行生效。

## 4. Acceptance 唯一事实源

验收要求、判定作用、阈值和阈值依据的唯一维护位置，按以下规则确定：

- `agents/<agent-id>/spec/acceptance.yaml` 存在时，它是该 Agent 的唯一事实源；同目录 `requirements.md` 维护 `REQ-xxx` 需求，`tasks.yaml` 维护业务任务定义、输入输出与适用范围。
- `spec/` 尚未物化时，交付记录模板一（或拆分版 `01_智能体需求定义.md`）暂代事实源；`spec/acceptance.yaml` 一旦建立，交付记录中出现的全部 `AC-xxx` 必须与其逐项一致，不得再独立编辑阈值。
- 同一 Agent 不得同时维护两套可编辑验收标准。

《Harness Repo 目录结构设计说明》中的 `tasks/<task-domain>/acceptance.yaml` 按以下方式使用：

- 可以只保存 `AC-xxx` 与唯一事实源的不可变引用；
- 也可以由唯一事实源生成只读投影，供工具索引；若投影包含阈值，必须可重建且与来源逐项一致；
- 禁止在投影中独立新增、修改或放宽验收要求；
- 没有实际跨 Agent 复用或机器索引需求时，不创建该文件。

机器校验器接受 `source_ref` 或 `acceptance_source` 精确指向 `agents/<agent-id>/spec/acceptance.yaml#AC-xxx` 或指向交付记录需求定义中的 `AC-xxx`；引用必须可解析且确实包含所引用的验收项，不得附带阈值等可编辑字段。以后若实现生成投影，必须先一并交付生成器、来源摘要和逐项一致性检查，再扩展机器契约；不能先提交一份无法证明只读派生关系的副本。

评估实现只在交付记录模板三中通过 `AC-xxx` 绑定用例、方法、数据、结果字段、Trial 和聚合规则，不复制或修改事实源阈值。

## 5. 单一 Eval Set、Run 归档与目录映射

每个 Agent 仅维护一个 Case 事实源：

```text
agents/<agent-id>/eval/cases.jsonl
```

旧材料摄取阶段的待复核输入只能保存在：

```text
agents/<agent-id>/eval/pending/*.pending.jsonl
```

pending 是迁移材料，不是正式 Eval Set，不得被正式 Run、Trial 或验收结论引用；只有完成逐条领域质量复核、唯一 `AC-xxx` 绑定和冻结范围后，才可物化正式 Case 事实源。仅有输入条数或旧文档中的 `synthetic_reviewed` 声明，不构成复核通过。

`core`、`boundary`、`safety`、`regression` 是每个 Case 的 `tags` 枚举，可组合使用；同一 Case 无论被多少标签、验收项视图或矩阵格引用，都只计一次。Trial 执行事实按 Run 独立归档：

```text
evolution/experiments/EXP-<agent-id>-NNN/runs/<run-uuid>/results.jsonl
```

每次执行产生新的 `run-<UUIDv4>`，历史 Run 不得覆盖或改写；`run.yaml` 记录实验、来源选择器、研究/正式性质、状态与起止，`inputs.lock.json` 记录本次的 Git 版本（提交、是否有未提交修改）与 Harness/spec/eval 树摘要，`gaps.jsonl` 保存本次发现，`summary.json` 由执行事实计算。`agents/<id>/delivery/eval/results.csv` 不再作为 Trial 事实源；尚未实现由新 Run 事实生成的兼容视图前，不得出现该文件。评估方法位于 `agents/<id>/eval/methods.yaml` 与被引用的版本化评分实现，Run 必须记录其精确版本。

顶层 `eval/` 仅在产生真实复用内容时创建，并按以下方式解释 v1.1 的目录建议：

- `eval/datasets/smoke/`：引用 Case ID 或可复现筛选条件的最小可运行视图；
- `eval/datasets/regression/`：选择 `tags` 含 `regression` 的视图；
- `eval/datasets/capability/`：按需求、验收项或本次能力影响范围形成的视图；
- `eval/datasets/safety/`：选择 `tags` 含 `safety` 的视图；
- `eval/graders/`：可被多个 Agent 引用且已版本化的评分实现；
- `eval/reports/`：不可变结果归档的索引或派生报告，不是 `results.jsonl` 的第二事实源。

这些位置不得复制 `cases.jsonl` 或维护相互冲突的结果。尚无内容时不创建空目录。

## 6. Candidate、Release 与 current

研究与交付的关系如下：

```text
Experiment Candidate ──→ Git 提交（研究版本） ──→ 比较/派生新 Experiment 或记录停止结论
        │
        └─ 进入正式交付 → 冻结完整候选基线 baseline_id → 正式自测通过
                       → 完成与风险相匹配的 R1/R2/R3 复核 → 交付评估通过
                       → 生成 releases/<agent-id>-v<semver>/
                       → 生成同摘要的稳定资产 Baseline 和 current 校验镜像
```

提交到 Git 的研究版本可作为 Variant 研究的来源；生产/正式发布只能使用经过同一候选基线完整交付评估的 Release。源 Release 也可供研究派生，但源的评估结论不转移给目标 Candidate。

Release 是可部署 Harness Artifact，不是 Git Tag。每个 Release 必须：

- 自包含实际装载所需的 Harness 资产，不依赖 `current/` 或其他可变路径；
- 记录 Agent/Harness 版本、通过的 `baseline_id`、采用的 `run_id`、Runtime 兼容范围、完整性摘要、评估报告和变更记录；
- 通过逐文件 `artifact-manifest.json` 固定完整可装载资产树；同名稳定 Baseline 与 Release 的相对路径、文件摘要、字节数、权限 mode 和树摘要必须完全一致，不能只比较 `harness.yaml`；
- 在形成不可变定位信息后禁止原地修改；任何修改产生新的语义版本和候选基线；
- 能够从自身或其清单核对到交付评估通过的同一冻结组合。

`agents/<agent-id>/current/` 只在 Release 生成后更新，是便于查看和工具发现的校验镜像。其 Release ID 和内容摘要必须与对应 Release 一致，不得作为生产 DSH 挂载目标，也不得先于 Release 手工修改。稳定资产 Baseline、Release 和 current 若包含同一逻辑资产，其摘要必须一致。

## 7. DSH 双平面与挂载契约

本项目资产仅供容器内 DSH Agent Runtime 装载。Harness Candidate 或 Release 说明“运行什么”；DSH Runtime 强制“如何运行、允许做什么”。二者必须同时可核验：

| 仓库受控资产与交付平面 | DSH Runtime 平面 |
|---|---|
| Task、AC、Prompt、Skill、Workflow、Policy 声明、Preset/Plugin/MCP 声明、Eval、Release | 镜像、Profile、实际 Plugin/MCP、工具 allowlist、沙箱、网络、凭据、资源限制、挂载和运行态数据 |

这组双平面回答“由仓库声明运行什么”与“Runtime 实际如何运行和强制控制”，不是根级 `AGENTS.md` 的四类开发对象。左侧会横跨被开发 Harness、需求与评测资料及正式 Release，但不会因此把验收阈值、Eval 或交付记录变成可由业务 Agent 自修改的行为资产；四类对象各自的修改与保存规则仍分别适用。

开发、验证和发布按阶段隔离：

| 阶段 | 可变行为资产 | 受控配置和凭据 | 挂载/身份规则 |
|---|---|---|---|
| Experiment Authoring | 仅当前 Candidate 的 Workspace 可在隔离容器中 RW；DSH 可以自组合、自修改，当前 Session 可实时观察探索行为并生成提案 | Preset、Profile、Guard、MCP 等控制 RO；历史/评估不挂载；凭据仅由受信 Runtime 注入，不作为 Candidate 资产 | 宿主侧记录改动前后摘要、diff 和待审回执；进入核验态或正式评估前，经复核后用新容器、新 Session 重建加载 |
| Candidate Verification | 所选来源的 Candidate 树 RO | 受控配置 RO；运行态数据独立 | 核实际镜像/Profile/路径/摘要和局部装载；结果仍是探索或候选技术证据 |
| Release/生产 | 具体 Release 全部 RO；生产 DSH 不自修改 | 受控配置 RO；凭据只由 Runtime 注入 | 只挂不可变 `releases/<agent-id>-v<semver>/`；反馈回新 Experiment |

Authoring 中的模型写入不能授予执行权限、改变 `AC-xxx` 阈值、修改正式 Eval、冻结候选基线、发布 Release 或覆盖历史。研究者可在新候选源码中修改 Preset、Profile/Patch、插件及非秘密依赖声明，但受控运行配置在当前容器内仍只读；这些修改须经宿主侧复核、构建和新容器/新 Session 装载后才可观察生效，不暗示热更新。模型外 Runtime/领域服务须独立核验租户、对象、参数、数量、幂等、审批、失败安全和审计；Prompt 和静态文件声明都不等于这些控制已经落实。

### 7.1 三角色运行视图

同一份源资产按运行角色生成不同挂载视图；宿主侧来源解析与挂载计划必须区分三种角色，不能把执行者来源与修改目标压成同一个 `--source` 概念：

| 内容 | 优化执行（authoring） | 被测执行（subject） | 评分/分析（scoring） |
|---|---|---|---|
| 目标 Candidate 工作区 | 可写 | 只读（同一候选源码） | 通常不需要；诊断时只读 |
| Preset/Profile/插件 | 当前运行配置固定；修改下一版候选后重新装载 | 只读装载同一版本 | 评估侧记录版本 |
| 规格：需求/任务/验收标准（`/work/spec`） | 可读 | **不挂载** | 可读 |
| 评测材料：方法、预置、预期答案（`/work/eval-reference`） | 可读 | **不挂载** | 可读 |
| 明确声明不含预期答案的被测输入（`/work/eval-input`） | 不适用 | 仅在显式声明时只读挂载 | 读取输入与被测输出 |
| 隐藏答案/参考判分材料 | 作为开发者可见，用于维护 | 不提供 | 按方法使用 |
| 任务工作目录 | 可写 | 独立可写 | 独立可写或只读 |
| 输出目录 | 写优化记录，不覆盖历史 Run | 写任务输出与轨迹 | 写评分、验收与缺口 |
| DSH_HOME | 独立运行态 | 新 HOME/新 Session；按计划管理用例隔离 | 不复用被测会话的推理上下文 |

容器路径合同：

```text
/work/harness/workspace   # Harness 行为资产
/opt/dsh-presets          # Preset，RO
/opt/dsh-managed          # 受控配置，RO
/work/spec                # 判分材料：需求/任务/验收标准；仅 authoring 与 scoring 挂载，RO
/work/eval-reference      # 判分材料：评估方法、测试预置、预期答案；仅 authoring 与 scoring 挂载，RO
/work/eval-input          # 显式声明不含预期答案的被测输入；仅 subject 在声明时挂载，RO
/work/task                # 本次用例工作区，RW
/work/output              # 当前 Run 输出出口，RW
/var/lib/dsh              # 独立 DSH_HOME，RW，不直接作为实验档案
```

只读只限制写入，不限制读取。因此判分材料不能靠“挂成只读”来隔离：验收阈值、评估方法、测试预置与预期答案根本不进入被测容器。被测侧唯一可能拿到的评测材料是显式声明的 `/work/eval-input`，声明者必须先确认该目录不含预期答案。Harness 只读不等于整个业务执行只能只读——生成文件、调用写操作或修改任务数据可能正是被测能力，应在独立工作区运行，不能因此意外换掉原任务所需的权限配置。引入独立工作目录时必须验证 DSH 的 CWD、Skill 发现和 Prompt 投影仍与待测组合一致。

### 7.2 冻结组合与 Run 事实

研究比较或正式评估前，须固定**完整冻结组合**：Harness 候选元数据、受控配置、规格、评测输入、方法与计划、依赖身份，并记录为可复核的身份（提交、树摘要、镜像与依赖锁）。只有三棵挂载树的摘要不足以唯一说明“这次评测测了哪个组合”，而开发者按第 7.1 节的运行纪律保证评测期间不修改这些内容。每次执行（无论成功、失败或取消）归档到独立 `runs/<run-uuid>/`，结果事实、环境、输入锁、缺口与汇总由该 Run 自含；重新评分产生独立记录，不静默改写原 Run。

插件研究至少区分源码来源和版本、构建产物及其依赖摘要、插件入口、Bundle/Patch/Profile 顺序、DSH 兼容范围和实际展开的有效配置。包存在不等于插件已激活；比较运行须记录实际装载结果。研究运行如果包含未提交修改，必须在 `inputs.lock.json` 的 `git_version` 中如实标注；只在可变工作目录上加只读容器挂载，并不能阻止宿主同时修改源目录，因此评测期间不修改相关资产由开发者保证，而不是由挂载方式保证。

正式 Trial 还须冻结并记录 Runtime 的**有效投影**：实际模型/provider/reasoning effort、模型 `baseURL` 与重试参数、Session 采用的 permission preset、Agent preset、Profile 和隔离的新 Session 身份。`DSH_HOME/settings.yaml` 是运行态 typed namespace，不整体当作 Harness 制品，也不能因 Profile/Plugin 名单未变就忽略其中的模型、请求终点或权限默认值变化。环境变量、MCP 端点、凭据标识和网络代理须记录受信来源与有效值的非秘密摘要；不得让工作区或数据卷中的 `.env` 悄悄补齐/覆盖这些输入。运行态凭据和会话历史不进入 Release；一旦有效投影偏离本次候选基线，停止该次正式结论并重新确定冻结组合。

发布时遵守：

1. DSH 挂载明确的 `releases/<agent-id>-v<semver>/`，默认只读；不得挂载 `current/` 作为生产来源。
2. Runtime Adapter 记录 Candidate/Release 源路径如何映射到容器目标路径及阶段模式，运行态数据放到独立数据卷；凭据只由 Runtime 注入，不进入资产树。
3. 记录 DSH 镜像版本或摘要、Profile、宿主机与容器路径、只读/读写模式、启动方式、Runtime 配置摘要和停止方法。
4. 启动后核对实际加载的 Agent、Preset、Skill、Tool、Policy、Plugin 和 MCP 与 Release/Runtime 清单一致。
5. 使用对外实际协议执行至少一条完整任务链，核对用户可见结果、工具与审批行为、最终业务状态和必要审计记录。

容器启动、文件可见、进程存在、端口监听、HTTP `200`、`/health`、模型列表、Mock MCP 或插件单测成功都只证明局部状态，不能替代第 4、5 项。任何 Runtime 配置或挂载内容与通过候选基线不一致，都必须停止发布；修改冻结项后重新建立候选基线并评估。

根级 `AGENTS.md`、`.agents/skills/` 和 `.codex/config.toml` 属于仓库协作平面，默认不得随 Agent Release 挂载到 DSH，也不得被用作 Runtime 权限或安全策略。

## 8. 命名、物化与历史

- Agent ID、技能名和普通目录使用小写 kebab-case。
- Experiment 使用 `EXP-<agent-id>-NNN`；稳定资产 Baseline 和 Release 使用 `<agent-id>-v<semver>`。
- 执行 Run 使用 `run-<UUIDv4>`，跨 Run 问题使用 `iss-<UUIDv4>`（文件位于 `agents/<agent-id>/issues/`）。研究版本使用 Git 提交标识，不引入第二套 `snap-<UUIDv4>` 身份。
- 只有存在真实资产、证据或复用需求时才物化目录。禁止通过 `.gitkeep`、空配置、空报告或占位数据伪造完整性。
- 历史通过 Git Commit、Tag、不可变 Release 和 Run 事实追溯，不建立 `latest`、`final-final` 或重复交付目录。早期快照内容按 `snapshots/README.md` 的恢复映射从 Git 取回。
- `current/` 是 Release 后生成的校验镜像，不是 `latest` 别名，也不改变 Release 的不可变性要求。
