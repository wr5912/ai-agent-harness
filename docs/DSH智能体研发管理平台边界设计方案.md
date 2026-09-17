# DSH 智能体研发管理平台边界设计方案

> 状态：Proposal，尚未实施。本文的 `platform/dsh-cli/`、`harness-admin` Profile、命令、状态卷和 Web 管理视图均是拟议实现，**不是当前可执行功能**。
>
> 适用范围：支撑本仓库中**仅供容器内 DSH Agent Runtime 装载**的 Agent/Harness 研究、资产管理与可选正式交付；可研究 DSH 机制并优先通过插件扩展，不把 Session、凭据、缓存或管理工具本身纳入业务 Agent Release。
>
> 权威依据：[规范来源锁定](./standards/SOURCES.md)、[项目规范解释](./standards/PROJECT-INTERPRETATION.md)。多形态资产的细节见[《智能体多形态Harness资产模型设计方案》](./智能体多形态Harness资产模型设计方案.md)；两份提案都不能降低现行规范门禁。

## 1. 产品目标、使用者与首版边界

管理工具首先服务个人开发者的 Harness 改进、资产演化与 Variant 研究：选择来源、检查实际插件组合、冻结可还原内容、运行和比较结果，并保存继续或停止的结论。正式交付与 Release 是独立阶段，不是每次研究的出口。它不替代面向最终用户的 Agent 会话；首版只需一个仓库、单操作员的本地入口。进入正式交付时，机器命令不能代替规定的独立复核。

优先验证的闭环是：`选择资产 → 创建 Experiment → 修改或复用插件组合 → 冻结研究快照 → 新运行 → 比较 → 保留、继续或停止`。只有选择正式交付时，才补齐 `REQ/AC`、完整候选基线、正式 Eval、R1/R2/R3 和 Release。CLI、业务 Harness 与 DSH Web 的事实源和权限保持清晰；逻辑职责不要求立即拆成多个常驻服务。暂不建设多租户门户、分布式调度、中心数据库、自动发布、生产自改进或语音平台。

### 当前事实与提案区分

当前仓库已有面向 `security-operations-expert` Experiment Candidate 的[DSH 容器薄适配层](../runtime/adapters/dsh-container/README.md)，以及独立的[DSH 只读资产查询原型](../plugins/asset-query-cli/README.md)。后者已在锁定镜像、无模型/业务 MCP 的隔离容器中验证 `inventory` JSON、帮助与非法参数退出；它只列目录，不执行资产校验或研究管理，也不代表完整管理 CLI 已实现。现有业务 Compose 未发布宿主机端口，Web 默认绑定容器内回环，不能从此推断浏览器可访问或 Agent 业务通过。[该 Agent 的 manifest](../agents/security-operations-expert/manifest.yaml)仍标记 Experiment 和退回整改；尚无稳定 Release、研究快照或本方案中的完整命令集。

## 2. 与 `dsh web` 的关系及组件结构

`dsh web` 面向 Agent Session、消息、工具交互及运行时审批；管理入口面向 Git 资产、实验来源/结果、研究比较及可选交付提案。DSH 原生管理插件、宿主 CLI 或共享用例加双入口均可作为候选；[只读查询原型](../plugins/asset-query-cli/README.md)已验证无模型/业务 MCP 的参数、JSON 和退出码，取消、清理及写操作仍需验证，不能由此直接选定完整入口。会话内命令不是进程级 CLI 的替代。管理与业务的权限、`DSH_HOME` 和事实源必须分开，是否需要独立常驻进程/Runner 则由实际操作决定。[DSH 架构](https://deepseek-harness.github.io/deepseek-harness/en/reference/)、[插件打包](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

```text
本仓库 Git（Task/AC/Case、Harness、Experiment、Release、证据引用）
       │
       ├── 业务 Agent Release ──只读卷──> 目标 DSH Agent 容器
       │
       └── 管理入口：宿主 CLI 或 platform/dsh-cli/（拟议 Bundle）
                      │ 固定构建、来源校验
                      ▼
            harness-admin Profile（拟议；最小只读原型先验证）
                      ├── 管理用例：查看/冻结/恢复/比较/派生/可选交付
                      ├── 独立 DSH_HOME；长期任务出现时再引入操作状态卷
                      └── 有执行需求时经宿主窄接口启动隔离 DSH 容器

            dsh web Profile（独立进程）──> Agent 会话与运行时审批
                      └── 未来可选：调用同一受控管理用例的只读/审批视图
```

若原生命令原型证明适用，可将管理 Bundle 的源码放在同仓拟议的 `platform/dsh-cli/`，与业务 Release 的插件资产分离，并独立记录包版本、来源、DSH 兼容范围和构建摘要。根级 `AGENTS.md`、`.codex/`、`.agents/skills/` 是仓库研发协作工具，绝不能随业务 Release 装载。Web 未来若需要管理页面，只做调用受控管理用例的视图；浏览器不持有 Git 写权限、发布凭据或容器编排权限，Web Session 审批也不能替代 R2/R3 或 Release 审批。

## 3. 启动、运行与数据所有权

只读查询原型以独立 `DSH_HOME`、最小 Profile 和一次性容器运行，已证明锁定 DSH 能在无模型密钥或业务 MCP 时解析并退出。若扩展为管理工具，应固定 Bundle/Profile 来源及构建摘要；宿主 CLI 则可直接调用同一资产规则。写操作及长任务出现后，再决定是否需要仓库外状态卷、宿主执行接口与恢复游标。无论采用哪种入口，依赖和有效 Profile/Bundle 必须可核验，不从可写 HOME 静默补齐。下面仅是**未来完整命令的概念调用形态，不是现行命令或经过验证的完整 DSH 语法**：

```text
dsh --profile harness-admin assets validate --repo /work/repo --agent security-operations-expert --output json
dsh --profile harness-admin assets inspect --repo /work/repo --agent security-operations-expert --output json
dsh --profile harness-admin research freeze --repo /work/repo --experiment <id> --output json
dsh --profile harness-admin research compare --repo /work/repo --left <run-or-snapshot> --right <run-or-snapshot> --output json
dsh --profile harness-admin eval run --repo /work/repo --agent security-operations-expert --baseline bl-... --output json
dsh --profile harness-admin gaps report --repo /work/repo --run run-... --output json
dsh --profile harness-admin experiment create --repo /work/repo --agent security-operations-expert --output json
dsh --profile harness-admin variant build --repo /work/repo --source <frozen-ref> --target <id> --output json
dsh --profile harness-admin release inspect --repo /work/repo --release <id> --output json
dsh --profile harness-admin release propose --repo /work/repo --release <id> --output json
```

只读校验在容器中的拟议启动形态如下；`<...>` 是必须由部署者固定、核验的占位值，**整段不是当前可执行部署命令**。写入/评估命令须另给受限工作区或证据卷，不能简单去掉仓库卷的 `readonly`：

```text
docker run --rm \
  --mount type=bind,src=<absolute-repo-path>,dst=/work/repo,readonly \
  --mount type=volume,src=<isolated-admin-home>,dst=/var/lib/dsh \
  -e DSH_HOME=/var/lib/dsh \
  <pinned-management-image> \
  dsh --profile harness-admin assets validate --repo /work/repo \
    --agent security-operations-expert --output json
```

| 数据或权限 | 事实源/存放位置 | 管理 CLI 的边界 |
|---|---|---|
| Task、项目特有 AC、Case、Harness、Experiment、Baseline、Release 元数据 | 本仓库 Git；AC 在 Agent 交付记录模板一，Case 在唯一 `cases.jsonl` | 遵守规范和 Git 冲突预检；不能在数据库另建可编辑阈值。 |
| Trial、R1/R2/R3 和审计证据 | 仓库规定的唯一追加型结果/记录；大型或敏感证据以受控 URI、对象版本、SHA-256 与访问方式引用 | 不覆盖历史；不得把命令退出 0 当作人工复核或业务通过。 |
| 研究快照、插件锁定与有效配置投影 | 仓库中的真实内容或可取回的不可变引用；秘密只留运行态 | 区分源码、构建制品、实际激活组合及其评估状态；研究快照不冒充正式候选基线。 |
| 操作回执、运行中任务、重试与恢复游标 | 长任务确有需要时使用仓库外隔离状态卷 | 只存作业状态和非秘密引用，不作为资产权威，也不纳入 Release。 |
| DSH Session、settings、credentials、附件 | 每个业务/管理/验证实例独立的 `DSH_HOME` | 不导入 Git、不直接修改生产 HOME；验证容器用新 HOME/Session。 |
| 生效权限、审批、租户、工具状态 | 目标 Runtime 和领域服务端强制，回传最终状态及审计 | CLI 的配置或 Prompt 声明不能代替实际强制点。 |
| 容器创建/停止、卷授权 | 宿主侧受控 Runner 或等价窄接口 | 不把不受限 Docker Socket 交给管理 Bundle 或 Web。 |

Git 提供版本和审核入口，必要时的操作状态卷提供崩溃恢复，DSH_HOME 保存会话运行态；三者不能互相冒充。敏感内容、密钥、Token、私有 URL、完整凭据或音频不进入 Git、日志或命令 JSON。运行研究时记录源快照、镜像、实际 Profile/插件、非秘密有效配置、挂载与停止方式；部署 Release 时另核其完整摘要。

## 4. CLI 命令契约与端到端操作链

以下是逐步实现的候选命令合同，不表示首版必须全部交付。具体参数和 Schema 编号需在实现时版本化并通过兼容测试固定。

| 命令 | 必需输入与副作用 | 输出/停止条件 |
|---|---|---|
| `assets validate` | 仓库、Agent/范围；只读 | 来源锁定、Schema、引用、摘要、Git 状态及人工待审项；机器通过不等于交付通过。 |
| `assets inspect` | Agent/Experiment/快照；只读 | 来源、插件源码/制品、Bundle/Patch/Profile 顺序、实际展开配置与缺失项；包存在不等于插件激活。 |
| `research freeze` / `research restore` | Experiment 当前内容/不可变快照；物化或恢复到新工作区 | 包含未提交和必要未跟踪文件的真实内容及摘要；恢复不覆盖现有工作树，研究快照不生成 `baseline_id`。 |
| `research compare` | 两个可还原来源及对应 Run；只读 | 配对任务集、有效配置差异、结果分布、失败和外部条件；证据不足可作为结论。 |
| `eval run` | 已冻结的 `baseline_id`、范围、Runner/镜像、Case 选择器；创建新 Run 和隔离 Session，按契约追加 Trial | `run_id`、逐 Case 证据、最终状态；超时/依赖异常标为不完整或错误，不得写成通过。 |
| `gaps report` | 固定 Run 与其 Baseline 摘要；只读 | 按 `REQ/AC/Case/CTRL` 关联缺口、证据和建议，不自动改 Harness 或门禁。 |
| `experiment create` | Agent、目标任务、来源缺口、操作者、预期路径；有限写入 | 新 `EXP-<agent-id>-NNN` 和工作区；已有冲突或不可信输入时失败，不覆盖用户改动。 |
| `variant build` | 可还原研究快照或源 Release 的身份/摘要、原评估状态、Target、转换方法/版本；有限写入 | 新 Experiment Candidate、diff、来源/映射证据；不继承源结论，正式发布仍经完整交付门禁。 |
| `release inspect` / `release propose` | 固定 Baseline、评估/复核证据、预期兼容范围；只读或只生成提案记录 | 自包含性、摘要、同基线一致性与缺口；不自动 promote、打 Tag、推送或替换生产。 |

研究者先查看来源和插件组合，创建 Experiment，修改行为资产或提出下一版 Preset/Profile/插件源码变更。当前 Authoring 容器中的受控配置、凭据与历史证据只读；宿主复核候选 diff、构建插件并在新容器/新 Session 验证实际装载。用于比较的版本先物化研究快照，运行结果可为采用、不采用或证据不足，不自动产生正式 Baseline。若决定交付，才补齐全部冻结项和正式 Eval；规定复核通过后才能生成不可变 Release。生产只读挂载具体 Release，不运行自动优化。[容器装载边界](../runtime/adapters/dsh-container/README.md)

正式评估一般须不少于 50 个有效 Case、50 条逐条质量复核的实质不同 User Input；仅满足锁定规范全部有限范围条件时才可缩小，否则回退一般门槛。R2 只得范围结论，R3 才能对完整冻结范围形成独立正式运行结论。业务最终状态、工具效果、审批和审计记录必须由真实 DSH 任务链核对；装载探针、HTTP 200 或机器校验成功均不能代替。[评估契约](../.agents/skills/baseline-eval/references/delivery-contract.md)

### 4.1 机器接口与失败语义

`--output json` 至少输出版本化 `schema_version`、`operation_id`、`status`、实际存在的 `agent_id/variant_id/baseline_id/run_id`、脱敏 `evidence_refs`、可机器识别的 `error_code` 和安全的诊断摘要。状态至少区分 `completed`、`blocked`、`incomplete`、`failed`；不适用字段应省略而非伪造。退出类别至少区分成功、参数/输入无效、门禁未通过、依赖/执行故障、权限拒绝；具体数字在实现测试中固定，不应把“Case 不通过”和“Runner 失联”映射成同一种成功/失败布尔值。日志与指标关联 operation、Baseline、Run 和容器执行 ID，不输出秘密或未经脱敏的用户内容。以下结构仅示意，不表示校验已通过：

```json
{
  "schema_version": "proposal-v0",
  "operation_id": "<stable-request-id>",
  "status": "blocked",
  "agent_id": "security-operations-expert",
  "evidence_refs": [],
  "error_code": "ASSET_VALIDATION_FAILED",
  "summary": "资产校验未通过；详见脱敏诊断"
}
```

写入与外部执行要用稳定 `operation_id` 和请求摘要做幂等预检：相同请求重试返回既有回执/状态，不重复创建 Experiment、Trial、Release 或高风险动作；不同请求复用同 ID 则冲突。评估的**新一次有意运行**必须取得新的 `run_id`，不能把自动网络重试当作新正式运行。崩溃后先从状态卷和实际 Runner/证据核对最终状态；无法确认时标记 `incomplete/unknown` 并人工处置，不凭超时猜测失败后重复执行。仓库写入应核对目标路径和 Git 树版本，冲突即停止并保留回执。

## 5. 安全、健壮性与可验证要求

管理 Profile 默认没有仓库写权限；只有明确写命令取得目标子树的最小权限，受控规范、历史证据和 Release 仍只读。Runner 必须校验镜像/Bundle/Release 来源与摘要、路径穿越和符号链接、挂载模式、网络和资源预算；来自旧 Harness/归档的内容先只读清点，不直接加载、执行或发布。密钥由受信环境注入、短期使用，不作为 Candidate 资产。高风险工具在 Runtime/服务端强制租户、对象、参数、数量、审批、幂等与失败安全，形成 `CTRL → AC → Case → 强制点 → 最终状态/审计` 的证据链；非法请求被阻断之外，还要核验合法审批后路径可用。[安全检查契约](../.agents/skills/security-control-boundary/references/review-checklist.md)

首版不需要分布式平台，但各命令和 Runner 需明确输入校验、单步/总超时、有界退避重试、可取消点、隔离、依赖故障后的降级与熔断策略。重试只适用于可证明幂等的读取或调用；写入状态未知时失败关闭并核对，不盲目重发。日志、关键指标和告警至少覆盖命令失败率、排队/运行时长、超时、证据缺失、摘要不一致、权限拒绝和 Runner 悬挂；敏感内容应脱敏。单元测试覆盖契约/状态机，集成测试覆盖真实 DSH Profile 与卷，压力测试覆盖声明的并发边界，故障注入覆盖模型/MCP/网络异常、容器退出、部分成功、重复命令及恢复。没有实际负载与业务链证据时不能宣称“高并发生产稳定”。

## 6. 六项总体需求的归属

| 需求 | 本平台/仓库的最小责任 | 明确排除或交给其他边界 |
|---|---|---|
| ① 稳定健壮 | 命令/Runner 的校验、超时、幂等、隔离、恢复、可观测与故障测试 | 领域工具的最终权限与幂等仍由 Runtime/服务端强制。 |
| ② 研发资产管理 | Git 唯一 Task/AC/Case/Eval/Experiment/Release 事实源与可审引用 | 不建第二套可编辑阈值或空平台目录。 |
| ③ 智能体测试评估 | 研究阶段保存可比较运行；交付阶段冻结完整范围、隔离 Trial/Run 和 R2/R3 证据 | 研究结果不自封业务/人工交付通过。 |
| ④ 受控优化 | 缺口回流新 Experiment、Candidate diff、复核与比较；可合法结束无收益实验 | 不在生产自修改或自动审批。 |
| ⑤ 不同算力 Variant | 从可还原研究快照或具体 Release 派生 DSH Candidate，独立验证 | 不继承源评估结论，不把其他 Runtime 制品包装成 DSH Release。 |
| ⑥ 摘要性语音 | 可选插件的触发/隐私/失败接口可被纳入测试资产 | 语音生成和播放不属于 CLI 核心或 Release 管理。 |

### 可选语音播报：独立运行时插件

摘要性语音应由另一个可选 DSH 插件处理已提交的完整回答、计划或步骤完成事件；策略决定触发点、可播报数据分类、长度、预算和用户同意。插件异步生成摘要/TTS，写入可恢复的 `requested/ready/failed` 非模型事件；客户端依用户设置决定是否播放。音频放受控存储，Session 中只放短期可授权引用、事件类型、摘要/时长和失败状态，不嵌入原始音频、长期签名 URL 或秘密。以 Session ID、源事件序号和策略摘要消重，故障时不阻断原回答、不重进主 Agent Loop、不触发工具或长期记忆。

T0 使用确定性摘要/模板且不得调用 LLM；T1/T2 的摘要也计入整体预算，T3 可按获准策略调用独立摘要模型。对敏感内容执行租户/权限、脱敏和保留期控制。如果播报改变用户可见任务结果，其插件、策略、模型预算和有效 Runtime 投影必须进入候选基线、Eval 和 Release。DSH 当前官方文档说明 Session 事件和 Conversation 节点具有扩展点；本项目锁定版本、事件恢复和 Web 呈现仍需原型及端到端验收。[Session](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)、[Conversation](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/conversation)

## 7. 实施顺序与验收门槛

1. **评估管理入口。** 已有只读查询原型证明锁定 DSH 在无模型/MCP 下可执行应用级 `inventory`；下一步核对取消、清理、来源解析和宿主 CLI 成本，再决定最终入口，不能把目录查询当作完整管理能力。
2. **建立研究闭环。** 先实现共同来源解析、内容冻结/恢复、插件有效组合检查与新运行记录；用一次真实插件变更形成两个可还原版本和配对结果。长期任务未出现前不预设状态服务。
3. **验证 Variant 派生。** 从可还原冻结候选选择一个有界任务，记录转换方法、源评估状态与目标独立结论；正式 v2 目录和 Release 合同须待受控规范、校验器和测试升级后才启用。
4. **按需接入正式交付。** 加入完整 `eval run`、缺口报告、规定 R1/R2/R3 和 Release 提案；人工复核、制品生成和部署仍走独立发布流程，不由 CLI 静默完成。
5. **按实际瓶颈扩展。** 只有出现多用户、跨节点长期任务或中心审批的真实需求后，再提取常驻控制面/Worker；Web 仅消费同一受控用例，不新建资产权威。

首个可验收结果是一条“源资产 → 插件组合变化 → 可还原快照 → 新 Session 运行 → 配对比较 → 继续或停止”的真实研究链；来源和实际加载能够核对，故障可诊断，结论不冒充业务交付通过。正式交付链、Release、T0/T1/T2/T3 各自在对应阶段验收。

实施各切片时，须同步核对代码、装载和真实任务证据；本文的示例命令不能进入可执行快速开始流程，直到对应实现与测试存在。
