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

### 有限选项决策模型的候选路径

多算力 Variant 的“等效”指同一任务合同下的业务结果和可接受的失败范围。接口兼容或一次分流正确，都不足以证明整条任务等效。先区分确定性规则可以完成的步骤、需要从有限选项中判断的步骤，以及仍需开放式研判和证据说明的步骤。Jev、Laya 适合研究有限选项判断，不能代替生成式分析或真实工具回执。

| 候选 | 算力与接入边界 | 研究时需要注意 |
|---|---|---|
| [TypeSafe Jev](https://docs.typesafe.ai/models) | 公开接入方式是远端 `/v1/systemone` API，返回 [`noul`、`choice`、`score`](https://docs.typesafe.ai/primitives) 等类型化判断 | 本地有算力不等于能本地运行 Jev；把远端模型调用计入总成本。官方说明英语效果最好，中文输入需要单独验证。 |
| [腾讯云 EdgeOne Makers 的 Jev](https://cloud.tencent.com/document/product/1552/138731) | 远端 `https://ai-gateway.edgeone.link/v1/systemone`，模型别名 `@makers/jev`，使用 Makers API Key 鉴权 | 与 TypeSafe 直连是不同接入渠道；记录响应中的实际模型版本、用量及费用。 |
| [Laya](https://github.com/NandhaKishorM/laya) | 开放权重，可在本地运行，也提供兼容 `/v1/systemone` 的 HTTP 服务 | 协议兼容不代表与 Jev 的准确率或概率校准等效；单独记录模型版本、本地硬件占用和中文任务表现。 |

腾讯云的调用密钥保存在本地忽略文件 `.tencent-edgeone-jev.llm-api-key`，变量名为 `MAKERS_MODELS_KEY`。EdgeOne 教程使用 `state` 和 `questions` 请求体；社区插件 `dsh-jev-decide` 默认使用 TypeSafe 地址及 `jev-latest`，复用前需验证插件配置能否切换地址、模型别名和请求格式，不能视作已经完成接入。

DSH 社区的 [dsh-jev-decide](https://github.com/nanami-0713/dsh-jev-decide) 把 Jev 注册为 Agent 工具，适合验证明确的判断点；调用仍由对话模型决定，装上插件本身不证明减少了主模型调用。[dsh-jev](https://github.com/buberlo/dsh-jev) 还探索了工具筛选和请求路由，但截至 2026-10-10 仓库已归档，适合作为设计参考。这些都是社区插件，不需要修改 DSH 源码。[DeepSeek 社区的 prefix completion 与 logprobs 实验](https://github.com/deepseek-ai/deepseek-harness/discussions/7301) 是另一条有限选项判断研究路线，并非 Jev；其概率质量和调用代价需独立比较。

若要验证这类 Variant，先在 `security-operations-expert` 中选择一个只读、选项明确的判断点，以现有任务路径为 Baseline。Jev 与 Laya 分别作为不同 Experiment 的 Candidate，避免一次改变决策模型、提示词和工具链。用相同输入与判断口径记录最终业务结果、误分流与不确定时的回退、中文及边界输入、主模型和决策模型调用、延迟、远端费用与本地资源占用。

先用新 Session 验证插件与决策服务实际被调用，再以 Run 判断效果。[EXP-010 的结论](../evolution/experiments/EXP-security-operations-expert-010/decision.md) 仍是 `inconclusive`，不能据此声称业务等效或算力收益。一项[配对研究预印本](https://arxiv.org/abs/2610.02267)也显示 Jev 与 Laya 在不同决策点上的表现差异明显，不能把通用基准结果直接当成本项目结论。

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
evolution/experiments/EXP-<agent-id>-NNN-r<12位随机十六进制>/
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
