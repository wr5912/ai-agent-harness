# 多 Variant Harness 研究方法

> 状态：研究方法。当前未物化 Variant 专用目录或 Release；只有真实实验需要时才创建对应资产。

## 1. 目标

同一个业务 Agent 可以派生不同 Harness Variant，用来研究提示、Skill、Preset、插件组合、模型或算力配置的影响。本项目关心的是：变化是什么、在相同输入下表现怎样、代价与限制是什么。

Variant 不是新的权限等级、发布通道或四套重复交付。它只是一个带明确差异的 Experiment Candidate。

## 2. 最小对象

| 对象 | 含义 | 推荐表达 |
|---|---|---|
| Target | 想服务的任务或约束，例如低延迟、离线、低成本 | 写入 Experiment 假设 |
| Baseline | 对照版本 | `git:<commit>`、`release:<id>` 或 `none:first-experiment` |
| Variant | 相对 Baseline 的一组明确变化 | 一个新的 Experiment Candidate |
| Evaluation | 在共同输入和环境下的观察 | Run 与研究总结 |
| Decision | 是否采用或继续研究 | `adopt/continue/reject/inconclusive` |
| Research Release | 值得独立复用的不可变研究版本 | `releases/<agent-id>-v<semver>/` |

不新增 `family_id`、`variant_id` 注册表、Release Set、Tier 审批或独立 Baseline 树，除非后续真实使用证明 Git 和 Experiment 无法清楚表达。

## 3. 如何建立 Variant

1. 选择可恢复的 Baseline 引用。
2. 写清 Target 和假设，例如“减少工具调用能否在这类只读问答上保持结果质量并降低延迟”。
3. 只修改与假设直接相关的内容；不要顺手重构其他 Prompt、Skill 或插件。
4. 用相同输入、判断口径和尽可能相同的环境运行 Baseline 与 Candidate。
5. 分别记录质量、失败、成本、延迟和未覆盖范围；没有区别也是有效结果。
6. 作出 Decision。只有需要长期复用时才生成 Research Release。

Transformation 只是创建 Candidate 的方法，不自动继承源版本的观察或结论。通过 LLM 重写、规则裁剪、人工修改或复制 Preset 得到的内容，都要在目标 Experiment 中重新观察。

## 4. 算力层级只是研究变量

可以用以下术语描述目标，但它们不是固定产品等级：

| 名称 | 含义示例 |
|---|---|
| `no-compute` | 不调用本地或远端模型，只用确定性规则或检索 |
| `low-compute` | 使用较小模型、较短上下文或较少步骤 |
| `medium-compute` | 在质量与成本之间做折中 |
| `full-compute` | 使用当前允许的完整模型与工具预算 |

具体模型、推理强度、上下文、工具次数和停止条件必须写进 Run；不要只凭层级名称推断能力。运行中不自动跨层切换，除非“动态选择”本身就是本次假设并被明确记录。

## 5. 怎样比较

比较范围由研究问题决定：

- 一个早期假设可以先使用一个或少量有区分力的输入；
- 想声称适用于更多任务时，再补共同输入、边界输入和已知回归；
- Baseline 与 Candidate 使用相同口径；口径变化后重跑受影响部分；
- Target 专属输入单独报告，不把不同任务的分数硬合并；
- T0/no-compute 若声称没有模型调用，应记录可观察的调用事实，而不是只看配置名。

不设置固定 50 Case、R1/R2/R3 或统一质量阈值。评估规模应与拟得出的结论相称。

## 6. 推荐的当前目录表达

```text
evolution/experiments/EXP-<agent-id>-NNN/
  change.yaml          # baseline_ref、status、outcome
  hypothesis.md        # Target、假设、停止条件
  candidate/           # Variant 的具体资产
  evaluation/          # 输入、方法、观察和证据
  runs/run-<UUIDv4>/   # 独立执行事实
  decision.md
```

不同 Variant 使用不同 Experiment，无需预建 `agents/<id>/variants/` 或 `evolution/baselines/<id>/<variant>/`。当某个 Variant 值得长期复用时，可以直接生成一个自包含 Research Release，并在其 README 说明 Target、来源、证据与限制。

## 7. 当前最小试点

对 `security-operations-expert` 选择一个范围明确的只读任务：

1. 以当前 Experiment 的可恢复 Git 版本为 Baseline；
2. 只改变一个 Harness 因素，例如工具路由或提示结构；
3. 在少量共同输入上分别运行并记录真实观察；
4. 保留采用、不采用或证据不足的结论；
5. 不等待生产交付材料，也不预建四套空 Variant。

如果试点证明需要稳定复用，再考虑 Research Release；如果没有收益，保留 Decision 后结束实验即可。
