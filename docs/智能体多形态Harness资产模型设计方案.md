# 智能体多形态 Harness 资产模型设计方案

> 状态：Proposal，尚未实施；本文提出下一版资产契约，不是现行 Schema、已验收能力或发布授权。
>
> 适用范围：本仓库只交付**供容器内 DSH Agent Runtime 装载**的 Agent/Harness 资产。构建工具可以在宿主侧运行，但业务 Variant 不能变成另一个独立 Runtime。
>
> 权威边界：[规范来源锁定](./standards/SOURCES.md)与[项目规范解释](./standards/PROJECT-INTERPRETATION.md)仍然有效。本文与锁定规范冲突时，先修订受控规范、校验器和测试，再启用新契约；不得用本提案绕过现行门禁。

## 1. 目标、现状与非目标

同一个业务 Agent 需要面向离线、受限网络、有限模型预算和充足资源等环境提供不同实现。关键不是复制四套 Prompt，而是在**同一业务任务与安全约束**下，明确每种实现能服务的范围、资源预算、DSH 装载组合、独立评估结果和不可变制品。

本方案交付的模型是：一个 `agent_id` 管业务身份和唯一需求事实源；多个 Variant 表示不同 DSH Harness 实现；部署 Target 描述环境约束；Tier 只描述模型推理预算级别。Transformation 从已发布资产生成**待评估候选**，不能把源 Release 的结论复制给目标。每个获准 Variant 独立形成 Release；可选 Release Set 只索引这些 Release，部署仍挂载其中**一个具体 Release**。

当前仓库仍采用单 Variant 资产/校验模型。[security-operations-expert 的 manifest](../agents/security-operations-expert/manifest.yaml)处于 Experiment、退回整改状态，不存在可作为转换输入的稳定 Release。因此本文既不宣称四个 Tier 可用，也不指示现在创建 `variants/`、`release-sets/` 等空目录。

非目标：开发 DSH Runtime、引入独立 Python/其他 Agent Runtime、建设通用 Harness IR/编译平台、同步复制四套交付记录或 Eval Case、用更低算力降低安全硬门禁、自动跨 Tier 回退、让生产容器自修改资产。管理平台与可选语音能力分别见[《DSH智能体研发管理平台边界设计方案》](./DSH智能体研发管理平台边界设计方案.md)。

## 2. 领域对象与不变量

| 对象 | 身份与所有权 | 关键关系及不变量 |
|---|---|---|
| Agent | `agent_id`，如 `security-operations-expert` | 拥有唯一任务、需求、AC、Case 事实源；不是某一种推理预算。 |
| Variant | Agent 内唯一 `variant_id`；小写 kebab-case | 一种可冻结的 DSH Profile/Preset/Plugin/工具组合；可支持多个 Target，必须明示任务范围。 |
| Target | 唯一 `target_id` | 描述 CPU/内存、网络、模型许可、数据驻留、时延、成本及安全条件；环境声明不是业务通过证据。 |
| Tier | `t0`、`t1`、`t2`、`t3` | 分类标签，不是资产主键；一个 Tier 可有多个 Variant，四个 Tier 不要求齐备。 |
| Transformation | 不可变方法版本与一次构建记录 | 输入必须指向已通过评估的源 Release 与摘要；输出是新的 Experiment Candidate 和可审 diff。 |
| Candidate Baseline / Run | `bl-<UUIDv4>` / `run-<UUIDv4>` | 冻结项改变换 Baseline ID；同一冻结组合重跑只换 Run ID，旧结果不覆盖。 |
| Stable Baseline / Release | `agent_id + variant_id + semver + digest` | 仅同一已通过交付评估的候选可晋升；Release 自包含、不可变、可校验，含兼容范围、评估报告、变更记录。 |
| Release Set | Agent 内有版本的不可变索引 | 引用多个 Variant Release 的身份、摘要和适用 Target；自身不是 DSH 挂载目标，也不继承评估结论。 |

项目特有验收标准的唯一可编辑来源仍是 Agent 的 `delivery/交付记录.md` 模板一；`tasks/**/acceptance.yaml` 只能是引用或投影。Eval Case 的唯一来源仍是 `agents/<agent-id>/delivery/eval/cases.jsonl`，`core`、`boundary`、`safety`、`regression` 是标签。Variant 可以存 Case 选择器、范围映射和运行证据，不得维护另一套 AC 阈值或复制 Case。正式运行写新的 `results.csv` Trial 行，不能覆写历史。[现行评估契约](../.agents/skills/baseline-eval/references/delivery-contract.md)

### 2.1 任务范围不是门禁豁免

一个受限 Variant 可以预先声明只承接某些任务，但必须先由需求/验收负责人确认：该目标环境需要哪些任务、不可服务输入如何明确拒绝或转人工、用户如何知道能力边界。范围内的 `REQ-xxx → AC-xxx → Case` 硬门禁保持原值；缺少覆盖、误导性“成功”、越权或危险副作用均阻断晋升。不能在评估失败后把失败任务追标为 `unsupported`，也不能用平均分抵消阻断 Case。

## 3. 拟议资产契约

以下目录仅是下一版规范的候选拓扑，**尚未创建，也不能由当前校验器直接验收**：

```text
agents/<agent-id>/delivery/                  # Agent 唯一需求、AC、Case 来源
agents/<agent-id>/variants/<variant-id>/      # Variant 的实现和装载声明
deployment/targets/<target-id>.yaml          # 可复用的环境约束
transformations/<transformation-id>/         # 有实际规则和构建记录时才创建
evolution/experiments/EXP-<agent-id>-NNN/    # 元数据关联目标 variant_id
evolution/baselines/<agent-id>/<variant-id>-v<semver>/
releases/<agent-id>/<variant-id>-v<semver>/
release-sets/<agent-id>-v<semver>/            # 索引，不作为卷源
```

契约最少应保留三个可验证的引用：Variant 指向适用 Target 和 DSH 装载组合；Baseline 指向冻结的 Variant/Target/需求范围/Case 选择器/Runtime 投影；Release 指向同摘要 Baseline、评估和兼容范围。引用一旦进入 Release 必须可解析为该 Release 内的自包含内容或不可变且经校验的证据，不允许运行时追随可变 `current/`、源 Variant 或网络上的“最新”资源。

下面是**设计示例，不是已生效 Schema，也不能作为可部署配置**。字段名和枚举需在规范升级时定稿：

```yaml
# deployment/targets/edge-offline.yaml；仅为提案字段
schema_version: proposal-v2
target_id: edge-offline
tier: t0
resources: {cpu_cores_max: 2, memory_mib_max: 2048}
model: {local_llm_calls_max: 0, remote_llm_calls_max: 0}
network: {egress: denied}
data_boundary: local-only
latency_ms_p95_max: 1500
required_controls: [tenant-scope, object-allowlist, approval-for-write]
```

```yaml
# agents/security-operations-expert/variants/deterministic-chat/variant.yaml
# 仅示意字段，不表示本 Agent 已实现该能力
schema_version: proposal-v2
agent_id: security-operations-expert
variant_id: deterministic-chat
tier: t0
target_ids: [edge-offline]
offered_task_ids: [<existing-task-id>] # 应引用真实任务 ID，不生成新验收源
unserved_input: explicit-refusal       # 或受控转人工
dsh:
  profile: deterministic-chat
  preset: deterministic-chat
  agent_factory: deterministic-chat-factory
  plugins: [approved-rule-plugin]
source_release: null                   # 派生时必须填不可变 Release 身份和摘要
```

Transformation 记录应含源 Release ID/树摘要、规则及版本、输入 Case/任务映射、构建环境、生成 diff、人工复核人和输出 Experiment/Candidate ID。它不是可直接发布的“编译结果”。Release Set 的最小成员是 `variant_id`、具体 Release 身份、Release 树摘要、已验证的 Target 集合和范围摘要；任何成员变更都生成新 Set 版本，不原地改写。Set 不需要覆盖四个 Tier。例如：

```yaml
# release-sets/<agent-id>-v<semver>/set.yaml；仅为提案字段，不可部署
schema_version: proposal-v2
agent_id: <agent-id>
set_version: <semver>
members:
  - variant_id: <variant-id>
    release_id: <immutable-release-id>
    release_tree_sha256: <verified-64-hex-digest>
    target_ids: [<verified-target-id>]
    scope_digest: <verified-64-hex-digest>
```

## 4. DSH 装载与四类运行形态

DSH 的 Profile 决定插件/服务组合，Preset 提供 Agent 行为配置；在需要替换默认决策循环时，可由 DSH 插件注册自定义 AgentFactory/Loop。官方当前文档描述 `ctx.agents.setFactory()` 且不允许重复工厂；Session 及 Conversation 也有扩展契约，但**本仓库锁定的 DSH 镜像组合是否兼容仍需容器实测**，不能把官网接口当作已通过集成验收。[DSH 架构](https://deepseek-harness.github.io/deepseek-harness/en/reference/)、[AgentFactory](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/core)、[Session](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)

| Tier | 服务请求时模型预算 | 推荐的 DSH 内部实现 | 超界行为 |
|---|---|---|---|
| T0 零推理 | 本地和远端 LLM 调用均为 0 | DSH 的确定性 AgentFactory/Plugin、规则或状态机、受控工具；可保持 Chat 请求/响应外形 | 输入超范围、规则冲突或状态未知时明确失败/转人工 |
| T1 低预算 | 极少且固定上界的调用/Token | 规则优先，仅在限定节点调用模型 | 预算耗尽时停止，不偷偷升级 T2 |
| T2 中预算 | 有界调用、Loop、Token、工具、耗时、成本 | DSH 有界决策链 | 超时或部分成功保留审计，停止危险续行 |
| T3 充足预算 | 更宽的动态规划预算，但仍有硬上限 | DSH Agentic 组合 | 同样受权限、审批和故障安全约束 |

“零算力”只指**服务请求中没有 LLM 推理**，不等于没有 CPU、内存、存储、网络或 DSH 进程；构建/编译时可使用其他算力。T0 的 Chat 是请求/响应协议和 Session 行为，不是模型调用的同义词；仅把 Preset 提示词改成“不要用模型”不足以建立无模型路径。T0 必须证明模型路径不可达、所有输入分支可解释，且 DSH Session 创建、恢复及对外响应契约仍然成立。

部署方在**新 Session 建立前**根据 Target 和获准范围选定一个具体 Variant Release，锁定镜像摘要、Profile、挂载路径/模式、资产摘要及有效模型/工具/权限投影。运行中不自动切换 Tier 或 Release；若确有升级/降级需求，应由上层显式结束或迁移 Session，并重新执行权限与一致性核验。生产容器只读挂载具体 Release；`current/` 只可作同摘要校验镜像，不能作生产挂载。[当前容器适配说明](../runtime/adapters/dsh-container/README.md)

高风险控制必须由 Runtime 或服务端在工具调用边界强制执行租户、对象、参数、数量、审批、幂等和失败安全。T0 的规则与 T3 的模型都不能绕过这些控制；“Prompt 写了禁止”不是强制点。必须留有 `CTRL → AC → Case → 强制点 → 最终状态/审计` 的证据链。

## 5. 从源资产到独立 Release

完整生命周期为：

1. **确定来源与范围。** 确认可核验需求、非目标和 `REQ/AC`；派生时输入只能是交付评估通过的不可变源 Release 和摘要。若首个稳定 Release 尚不存在，先完成原 Agent 的交付，不能以 Candidate 或 `current/` 冒充源。
2. **创建 Experiment。** 沿用 `EXP-<agent-id>-NNN`，在元数据中指定 Variant、Target、源 Release、预期预算、要验证的关键不确定性。路径字段仍为 `direct` 或真正改变实施路线时的 `exploration`；探索样本不产正式交付结论。
3. **转换并复核。** 规则化、决策表、固定工具序列、模型缩减或 Loop 限界可以生成 Candidate；保存方法版本、输入/输出映射和 diff。隔离 Authoring 容器只允许 DSH 修改该 Experiment 的 Candidate 行为资产；Profile、Guard、MCP、凭据及正式证据不作为可写 Candidate。宿主侧复核后，在新 Verification 容器和新 Session 中重新加载。
4. **冻结与评估。** 冻结代码/配置、目标约束、任务范围、AC/Case 选择器、模型/工具/权限投影和预算，生成新 `bl-<UUIDv4>`。每次运行有新的 `run-<UUIDv4>`，失败和重跑证据均保留；任一冻结项变化重新建 Baseline。
5. **独立交付审查与晋升。** R2 仅能对受限范围给结论；R3 对完整冻结范围进行独立正式运行。只有同一候选通过全部规定审查后才能生成自包含、不可变、可校验 Release，再按需要生成新的 Release Set。Git Tag 不能代替制品，技术探针不能代替业务验收。

Release 的兼容范围至少绑定 DSH 镜像/版本、Profile/插件装载、Target、任务范围、模型/工具约束及挂载约定。发布后修改任一内容须形成新 Release；回滚应选回旧的已验证 Release，不能在原目录原地改写。生产反馈回到新 Experiment，而不是生产内自我修补。

## 6. 评估设计和对比实验

每个 Variant 使用同一 Agent 的 AC 与 Case 事实源，以选择器冻结自己的服务范围、共用对照 Case 和目标特有边界 Case。正式评估的一般门槛是至少 50 个有效 Case 和 50 条逐条质量复核、实质不同的 User Input；有限范围只在锁定规范的全部前提、清单和覆盖证明成立时使用，否则回退一般门槛。机器校验成功只说明确定性检查通过，不能代替内容真实性、业务能力或 R3 结论。[评估契约](../.agents/skills/baseline-eval/references/delivery-contract.md)

对照记录至少包括：任务正确性与覆盖、拒绝/转人工的准确性、越权/审批/幂等与最终状态、LLM 调用及 Token、CPU/内存、P95 时延、成本、超时和依赖故障后的可恢复性。共同 Case 才可直接比较业务质量；目标专属 Case 应分别报告，不把“更省算力”当成“同等能力”。验证 T0 时应通过调用计数/隔离网络证明本地和远端模型调用均为 0；验证 T1/T2/T3 时故意触发预算、模型异常和依赖故障。安全 Case 既要证明非法动作被阻断，也要证明合法审批路径可用。

最小试点选 `security-operations-expert` 中**一个真实任务及其 AC**，但前提是先完成该 Agent 的正式交付与首个稳定 Release。随后从该 Release 派生一个 `bounded-dsh` Candidate，与源在共用 Case 上比较；只有发现可确定性化的实际子任务时，再单独建立 T0 Candidate。每个 Candidate 独立评估，暂不预建四套空资产。

## 7. 兼容迁移、验收门槛与未决项

现行 v1 目录是 `evolution/baselines/<agent-id>-v<semver>/`、`releases/<agent-id>-v<semver>/`。拟议 v2 把 `variant_id` 纳入路径与身份；不能直接把旧目录重命名、改变旧 Release 摘要或让生产读取混合树。迁移顺序如下：

1. 为受控规范新增版本，定义 Schema/身份/摘要算法、v1→v2 映射、旧 `current/` 的退役或显式映射规则，以及 Release Set 的完整性和兼容边界；更新 `SOURCES.md`，保留旧规范原文。
2. 升级校验器、交付/发布契约和测试，先证明 v1 制品继续按旧规则可读、v2 制品按新规则可验证；容器适配层再支持显式选择一个具体 v2 Release。未完成前不物化上述 v2 路径。
3. 在锁定 DSH 镜像与实际挂载下，验证一个 Variant 的 Session 创建/恢复、请求响应、工具安全强制点和故障路径；对 T0 验证无模型调用，对多 Variant 验证没有隐式跨级切换。
4. 完成真实 Case、R2/R3、Release 树摘要、只读生产挂载和回滚演练后才可宣布试点可发布。既有 Release（若将来存在）保持不变，迁移只能通过明确的新制品与审查。

未决的实现细节包括：锁定 DSH 版本对自定义 AgentFactory/Loop 的实际兼容性、v2 Schema 字段、Target 可测资源指标、`current/` 的最终替代方式和 Session 显式迁移协议。这些在试点前用原型与规范修订裁决；不作为默认已实现能力。

## 附录：原始方案的取舍记录

本方案参考《ai-agent-harness多形态Harness-Variant资产模型升级方案.md》（SHA-256：`a55ef67b11099291af6f71f438cbb079a406c2cbf4b667a87e6822b349e42d53`）。采纳独立 Variant、Tier 与 Target 分离、Transformation 仅产 Candidate、各 Release 自包含及分阶段试点。修正“Family”额外身份为现有 `agent_id`；不采用独立 `code/python/other-runtime` 作为本仓库可发布类型，不复制 Variant 专属 AC/Case，不允许 `unsupported` 绕过硬门禁，也不改 `EXP-<agent-id>-NNN` 命名。原始方案是设计输入，不是规范权威或运行证据。
