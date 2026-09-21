# 项目规范解释

本文说明受控来源在 `ai-agent-harness` 的 Research Mode 中怎样使用。它不修改受控原文；它明确哪些内容是当前合同，哪些只作为未来生产化参考。

## 1. 当前权威顺序

1. 根级 [`AGENTS.md`](../../AGENTS.md) 定义当前项目使命、Research Mode、开发边界和协作原则。
2. 本文解释受控来源如何适用于这个个人研究仓库。
3. 《Harness Repo 目录结构设计说明（v1.1）》和《Harness Asset Repository 规范（v1.0）》作为目录与资产模型的设计输入；保留原文和摘要，不要求把其中每个生产化目录都物化。
4. `agent-engineering-spec` 锁定提交只作为未来生产工程的参考，不是当前 Experiment 的默认门禁。

若来源中的生产化要求与 Research Mode 冲突，以当前研究范围为准，不自动引入稳定 Baseline、R1/R2/R3、审批、安全控制映射或生产部署流程。若未来正式启动生产化阶段，应另建清晰合同并重新评估这些来源，而不是静默改变本项目语义。

## 2. Baseline、Experiment 与 Decision

Baseline 是比较起点的引用，不是一套必须复制的目录：

- `git:<40 位 commit>`：以某个 Git 提交为对照；
- `release:<agent-id>-v<semver>`：以已有 Research Release 为对照；
- `none:first-experiment`：首次实验没有既有对照。

每项语义性 Harness 变化建立一个 `evolution/experiments/EXP-<agent-id>-NNN/`。最小内容包括：

- `change.yaml`：Experiment 身份、Baseline 引用、状态，以及完成后的结果；
- `hypothesis.md`：为什么修改、预期观察和停止条件；
- `candidate/`：本次要比较的 Harness 工作树；
- `evaluation/`：方法、观察、证据或总结；
- `decision.md`：`adopt`、`continue`、`reject` 或 `inconclusive` 的理由。

研究失败、停止和证据不足都是有效结果。只有实际运行值得复现时才创建 Run；只有某个研究版本值得独立保存和复用时才创建 Research Release。

## 3. 评估规模和事实边界

Evaluation 的规模由假设和拟得出的结论决定，不设固定 Case 数、固定输入数、R1/R2/R3 或全局安全用例门槛。

- 早期探索可以使用一个或少量高价值输入。
- 要扩大结论范围时，补充覆盖、反例和必要回归。
- 同一次比较运行期间保持 Harness、输入和判断口径稳定；口径变化后重新运行受影响部分。
- 需求、任务、测试数据、评估方法和测试验收按主要消费方式保存在一个 Markdown 或一个 JSONL；不要求固定目录模板，也不维护同内容投影。
- 原始观察不得为了形成漂亮结论而静默改写；重新执行使用新的 `run_id`。

运行记录位于：

```text
evolution/experiments/EXP-<agent-id>-NNN/runs/run-<UUIDv4>/
```

Run 至少记录实际来源、Git 提交及 dirty 状态、输入、逐项观察、失败和限制。静态检查或技术探针只能支撑其直接覆盖的结论。

## 4. Candidate 与 Research Release

`candidate/` 只是 Experiment 内的可修改工作树，不表示生产候选或发布准入。

Research Release 位于：

```text
releases/<agent-id>-v<semver>/
```

它用于保存值得复用的研究版本，必须自包含、不可变、可校验，并至少包含：

- `manifest.yaml`：身份、来源 Experiment、来源提交、评估引用、Runtime 兼容范围和制品摘要；
- `harness.yaml` 与实际 Harness 资产；
- `runtime.yaml`：重建所需的非秘密 Runtime 条件；
- `artifact-manifest.json`：逐文件摘要；
- `README.md`：用途、复现步骤、已知限制和非生产声明。

Research Release 不表示生产可用、上线批准或已经完成生产安全治理。Git Tag 不是 Release 制品；Release 也不能包含 Session、缓存、附件、秘钥或整个 `$DSH_HOME`。

本项目不维护 `evolution/baselines/` 和 `agents/<agent-id>/current/`。前者与 Git/Release 重复保存版本，后者会制造可变别名和第二份镜像；删除这两层后，具体引用仍能精确恢复研究版本。

## 5. DSH 装载与运行状态

Harness 资产说明“要装载什么”，DSH Runtime 负责实际装载和执行。源码修改不等于当前 Session 已经生效；需要用新进程或新 Session 核对实际来源和用户可见行为。

开发会话可以修改当前 Experiment 的 Candidate；被测会话只读装载同一 Candidate，并且不挂载参考答案或判断材料。该隔离用于保持比较可信，不意味着本项目要建设通用权限平台。

Runtime 的 Session、设置、缓存、附件和凭据位于独立数据根，不进入 Candidate 或 Research Release。运行时需要的秘钥只由环境或受控凭据机制注入，不提交到仓库。

## 6. 三层验证

本项目只维护以下三层结论：

| 层级 | 结论对象 | 主要证据 |
|---|---|---|
| 项目与工具链验证 | 仓库规则、CLI、来源解析、容器接入 | 项目验收矩阵、自动化测试、技术探针 |
| Experiment Evaluation | 某项 Harness 变化在声明范围内的效果 | 假设、输入、Run、观察、Decision |
| Research Release 复现 | 某个不可变研究版本能否恢复并重新装载 | Release 清单、摘要、复现记录 |

三层不能互相替代，也都不构成生产部署验收。进程存在、端口监听、HTTP `200`、`/health`、文件可见或机器校验通过，只能证明对应局部事实。

## 7. 命名与物化

- Agent ID、技能名和普通目录使用小写 kebab-case。
- Experiment 使用 `EXP-<agent-id>-NNN`。
- Research Release 使用 `<agent-id>-v<semver>`。
- Run 使用 `run-<UUIDv4>`。
- 只有出现真实资产、观察或复用需求时才创建目录；不使用空文件或占位报告伪造完整性。
- 外部来源原貌和迁移记录放在 `evolution/history/imports/`，不作为现行 Harness 的第二份可编辑事实源。
