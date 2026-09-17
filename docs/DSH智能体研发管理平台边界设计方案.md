# DSH 智能体研发管理平台边界设计方案

> 状态：Proposal，尚未实施。本文的 `platform/dsh-cli/`、`harness-admin` Profile、命令、状态卷和 Web 管理视图均是拟议实现，**不是当前可执行功能**。
>
> 适用范围：管理本仓库中**仅供容器内 DSH Agent Runtime 装载**的 Agent/Harness 资产和研发证据；不开发 DSH Runtime，不把 Session、凭据、缓存或管理工具本身纳入业务 Agent Release。
>
> 权威依据：[规范来源锁定](./standards/SOURCES.md)、[项目规范解释](./standards/PROJECT-INTERPRETATION.md)。多形态资产的细节见[《智能体多形态Harness资产模型设计方案》](./智能体多形态Harness资产模型设计方案.md)；两份提案都不能降低现行规范门禁。

## 1. 产品目标、使用者与首版边界

平台要让维护者从可核验的任务/验收出发，检查资产、运行隔离评估、定位缺口、创建受控 Experiment，并在人工复核后提出 Release 建议。它管理的是**研发与交付决策链**，不是替代面向最终用户的 Agent 会话。首版以一个仓库、单操作员的本地 CLI 为目标，服务于开发者、评估员和 Release 负责人；三种职责可以由组织中的不同人承担，机器命令不能代替独立复核。

首版应交付可重复的最小闭环：`校验资产 → 冻结范围并运行 Eval → 汇总缺口 → 创建 Experiment/Candidate → 重新验证 → 提出 Release`。同仓代码可复用统一的领域用例，但 CLI、业务 Agent Harness、DSH Web 必须有不同的装载与权限边界。暂不建设多租户门户、分布式任务调度、中心数据库、自动发布、生产自改进或语音平台。

### 当前事实与提案区分

当前仓库只有面向 `security-operations-expert` Experiment Candidate 的[DSH 容器薄适配层](../runtime/adapters/dsh-container/README.md)。它区分 Authoring/Verification 挂载，但只能证明局部构建和装载技术集成；现有 Compose 未发布宿主机端口，Web 默认绑定容器内回环，不能从此推断用户浏览器可访问或 Agent 业务通过。[该 Agent 的 manifest](../agents/security-operations-expert/manifest.yaml)仍标记 Experiment 和退回整改；没有可供 Variant 转换的稳定 Release。管理 CLI、管理 Profile 和下述命令目前都不存在。

## 2. 与 `dsh web` 的关系及组件结构

`dsh web` 面向 Agent Session、消息、工具交互及运行时审批；管理平台面向 Git 资产、候选基线、正式评估、缺口及发布提案。两者可以采用 DSH/Cordis 插件机制，但**不共用管理权限、进程、DSH_HOME 或治理数据的事实源**。DSH 官方当前文档以 Bundle 组织插件/配置、以 Profile 选择可启动组合，并提供 Bundle 接入 CLI 参数的方式；锁定镜像上的具体 API 和参数兼容性仍需实测。[DSH 架构](https://deepseek-harness.github.io/deepseek-harness/en/reference/)、[插件打包](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)

```text
本仓库 Git（Task/AC/Case、Harness、Experiment、Release、证据引用）
       │
       ├── 业务 Agent Release ──只读卷──> 目标 DSH Agent 容器
       │
       └── platform/dsh-cli/（拟议管理 Bundle 源码）
                      │ 固定构建、来源校验
                      ▼
            harness-admin Profile（拟议；一次性 CLI 进程）
                      ├── 管理用例：校验/评估/缺口/Experiment/发布提案
                      ├── 独立 DSH_HOME + 仓库外操作状态卷
                      └── 最小授权 Runner ──> 隔离 DSH 验证容器

            dsh web Profile（独立进程）──> Agent 会话与运行时审批
                      └── 未来可选：调用同一受控管理用例的只读/审批视图
```

推荐将管理 Bundle 的源码放在同仓拟议的 `platform/dsh-cli/`，与业务 Release 的插件资产分离，并独立记录包版本、来源、DSH 兼容范围和构建摘要。根级 `AGENTS.md`、`.codex/`、`.agents/skills/` 是仓库研发协作工具，绝不能随业务 Release 装载。Web 未来若需要管理页面，只做调用受控管理用例的视图；浏览器不持有 Git 写权限、发布凭据或容器编排权限，Web Session 审批也不能替代 R2/R3 或 Release 审批。

## 3. 启动、运行与数据所有权

拟议的打包方式是：在受控构建阶段将固定版本管理 Bundle 与 `harness-admin` Profile 装入固定 DSH 镜像，记录镜像/Bundle 摘要；运行时以一次性容器执行命令。该 Profile 使用独立 `DSH_HOME`，不挂载生产 Agent 的 HOME；受信启动步骤应把固定 Profile/Bundle 置于 DSH 可读取的位置并核对摘要，运行期使这些可执行配置只读，仅让必要的 Session/作业状态可写。每条命令只取得所需仓库目录和权限。依赖不能在运行期从可写 HOME 静默安装。启动前验证 DSH 锁定版本能解析所需 CLI 参数、加载 Profile/Bundle，并可在容器中以实际挂载路径运行。下面仅是**概念调用形态，不是现行命令或经过验证的 DSH 语法**：

```text
dsh --profile harness-admin assets validate --repo /work/repo --agent security-operations-expert --output json
dsh --profile harness-admin eval run --repo /work/repo --agent security-operations-expert --baseline bl-... --output json
dsh --profile harness-admin gaps report --repo /work/repo --run run-... --output json
dsh --profile harness-admin experiment create --repo /work/repo --agent security-operations-expert --output json
dsh --profile harness-admin variant build --repo /work/repo --source-release <id> --target <id> --output json
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
| 操作回执、运行中任务、重试与恢复游标 | 仓库外隔离状态卷；必要时用轻量持久存储 | 只存作业状态和非秘密引用，不作为资产权威，也不纳入 Release。 |
| DSH Session、settings、credentials、附件 | 每个业务/管理/验证实例独立的 `DSH_HOME` | 不导入 Git、不直接修改生产 HOME；验证容器用新 HOME/Session。 |
| 生效权限、审批、租户、工具状态 | 目标 Runtime 和领域服务端强制，回传最终状态及审计 | CLI 的配置或 Prompt 声明不能代替实际强制点。 |
| 容器创建/停止、卷授权 | 宿主侧受控 Runner 或等价窄接口 | 不把不受限 Docker Socket 交给管理 Bundle 或 Web。 |

Git 提供版本和审核入口，操作状态卷提供崩溃恢复，DSH_HOME 保存会话运行态；三者不能互相冒充。敏感内容、密钥、Token、私有 URL、完整凭据或音频不进入 Git、日志或命令 JSON。部署/验收前必须记录固定镜像、Profile、宿主与容器路径、挂载模式、实际 Release 摘要、启动及停止方式。

## 4. CLI 命令契约与端到端操作链

首版命令以明确输入、可审输出、受限副作用为准。这里定义的是设计合同；具体参数和 Schema 编号需在实现时版本化并通过兼容测试固定。

| 命令 | 必需输入与副作用 | 输出/停止条件 |
|---|---|---|
| `assets validate` | 仓库、Agent/范围；只读 | 来源锁定、Schema、引用、摘要、Git 状态及人工待审项；机器通过不等于交付通过。 |
| `eval run` | 已冻结的 `baseline_id`、范围、Runner/镜像、Case 选择器；创建新 Run 和隔离 Session，按契约追加 Trial | `run_id`、逐 Case 证据、最终状态；超时/依赖异常标为不完整或错误，不得写成通过。 |
| `gaps report` | 固定 Run 与其 Baseline 摘要；只读 | 按 `REQ/AC/Case/CTRL` 关联缺口、证据和建议，不自动改 Harness 或门禁。 |
| `experiment create` | Agent、目标任务、来源缺口、操作者、预期路径；有限写入 | 新 `EXP-<agent-id>-NNN` 和工作区；已有冲突或不可信输入时失败，不覆盖用户改动。 |
| `variant build` | 已交付源 Release 的 ID/摘要、Target、转换方法/版本；有限写入 | 新 Experiment Candidate、diff、来源/映射证据；没有源 Release 或 v2 契约时不可执行。 |
| `release inspect` / `release propose` | 固定 Baseline、评估/复核证据、预期兼容范围；只读或只生成提案记录 | 自包含性、摘要、同基线一致性与缺口；不自动 promote、打 Tag、推送或替换生产。 |

典型流程中，开发者先以 `assets validate` 对照规范/当前 Git 树确认任务、AC、Case 和装载组合；评估员在冻结候选上运行 `eval run`，再以 `gaps report` 复盘。发现缺口时创建新 Experiment，隔离 Authoring 容器可以自组合/自修改**该 Candidate 的行为工作区**，但受控 Profile、Guard、MCP、凭据与旧证据保持只读；宿主复核 diff 后，用新 Verification 容器和新 Session 重新加载。任一冻结项改动生成新 Baseline，不在旧 Run 上覆盖重试。只有规定的独立评估和审查通过，Release 负责人才能采纳 `release propose` 的建议并按现行流程生成不可变 Release。生产只读挂载具体 Release，不运行自动优化。[容器装载边界](../runtime/adapters/dsh-container/README.md)

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
| ③ 智能体测试评估 | 冻结范围、隔离运行、Trial/Run、缺口和 R2/R3 证据 | 机器命令不能自封业务/人工通过。 |
| ④ 受控优化 | 缺口回流新 Experiment、Candidate diff、复核、重新评估 | 不在生产自修改或自动审批。 |
| ⑤ 不同算力 Variant | 从不可变源 Release 产生 DSH Candidate，独立验证/发布 | 不把其他 Runtime 制品包装成 DSH Release，不一次预建四套。 |
| ⑥ 摘要性语音 | 可选插件的触发/隐私/失败接口可被纳入测试资产 | 语音生成和播放不属于 CLI 核心或 Release 管理。 |

### 可选语音播报：独立运行时插件

摘要性语音应由另一个可选 DSH 插件处理已提交的完整回答、计划或步骤完成事件；策略决定触发点、可播报数据分类、长度、预算和用户同意。插件异步生成摘要/TTS，写入可恢复的 `requested/ready/failed` 非模型事件；客户端依用户设置决定是否播放。音频放受控存储，Session 中只放短期可授权引用、事件类型、摘要/时长和失败状态，不嵌入原始音频、长期签名 URL 或秘密。以 Session ID、源事件序号和策略摘要消重，故障时不阻断原回答、不重进主 Agent Loop、不触发工具或长期记忆。

T0 使用确定性摘要/模板且不得调用 LLM；T1/T2 的摘要也计入整体预算，T3 可按获准策略调用独立摘要模型。对敏感内容执行租户/权限、脱敏和保留期控制。如果播报改变用户可见任务结果，其插件、策略、模型预算和有效 Runtime 投影必须进入候选基线、Eval 和 Release。DSH 当前官方文档说明 Session 事件和 Conversation 节点具有扩展点；本项目锁定版本、事件恢复和 Web 呈现仍需原型及端到端验收。[Session](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)、[Conversation](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/conversation)

## 7. 实施顺序与验收门槛

1. **合同先行。** 固定 CLI JSON/退出类别、状态机、权限矩阵和最小日志；沿用现行规范。多 Variant 命令暂不启用，直至[多形态方案](./智能体多形态Harness资产模型设计方案.md)所需的受控规范新版本、校验器和测试完成。
2. **只读切片。** 按需创建 `platform/dsh-cli/`，固定 Bundle/Profile/镜像，证明锁定 DSH 版本可解析命令；先实现 `assets validate` 和 `release inspect` 的只读路径。验证独立 HOME、只读挂载、错误输出与秘密脱敏。
3. **隔离评估切片。** 加入窄授权 Runner、状态卷、`eval run` 和 `gaps report`；核验非法输入、重复执行、超时、Runner 崩溃、证据追加与人工 R2/R3 分离。每次验证记录真实对外协议、用户可见结果、工具行为、最终状态和审计。
4. **受控写入与提案。** 加入 `experiment create`、新容器/新 Session 复核及 `release propose`；只有首个稳定源 Release 和 v2 契约存在后才试点 `variant build`。人工审批、制品生成和部署仍走独立发布流程，不由 CLI 静默完成。
5. **按实际瓶颈扩展。** 出现多用户、跨节点长期任务或中心审批的真实需求后，再把管理用例提取成独立控制面/Worker；CLI 留作客户端，Web 仅消费同一受控接口，不新建资产权威。

首版可验收的结果是：在固定镜像和真实容器挂载下完成一条“任务/AC/Case → 候选 Baseline → 隔离 Run/Trial → 缺口 → 新 Experiment → 新容器复核 → Release 提案”的可追溯链；重复命令与崩溃恢复不产生双写，权限越界和摘要不一致被阻断，人工评估与发布结论没有被机器检查冒充。它**不等于**已经生成业务 Release、DSH 上线或 T0/T1/T2/T3 全部可用。

本提案不要求当前修改 `README.md`、`AGENTS.md`、容器 Compose、受控规范或业务 Candidate。实施各切片时应单独审查实际代码、装载和真实任务证据。
