# 仓库演进不变量

创建、迁移、评估或保存 Harness 研究资产时读取本文件。

## 生命周期与身份

```text
Baseline 引用 → Experiment（含 Candidate）→ Evaluation → Decision
                                                        └→ 可选 Research Release
```

- Agent ID、技能名和普通目录使用小写 kebab-case。
- Experiment 使用 `EXP-<agent-id>-NNN`。
- Run 使用 `run-<UUIDv4>`，每次执行独立保存，封存后不覆盖。
- Research Release 使用 `<agent-id>-v<semver>`，只能保存值得独立复用的研究版本。
- Baseline 使用 `git:<40 位 commit>`、`release:<id>` 或 `none:first-experiment` 引用，不复制 `evolution/baselines/`。
- 不维护 `agents/<agent-id>/current/`；需要复现时直接引用具体 Git 提交或 Research Release。

## 目录职责

- `agents/<agent-id>/`：Agent 的研究入口，以及按需存在的目标、输入和方法。
- `evolution/experiments/<id>/`：假设、Candidate、Evaluation、Run 和 Decision。
- `evolution/history/imports/`：外部来源原貌、清洗材料与处置记录；不作为现行 Harness 的第二份可编辑事实源。
- `releases/`：自包含、不可变、可校验的 Research Release；不表示生产可用。
- `runtime/`：DSH 兼容与装载适配，不复制 DSH Runtime 源码或私有运行数据。

只有出现真实内容时才创建目录。空文件、占位报告、纯 TODO 和 `.gitkeep` 不能证明资产完整。

## Experiment 最小合同

`change.yaml` 必须包含：

- `schema_version`
- 与目录一致的 `experiment_id`
- 与名称一致的 `agent_id`
- 合法 `baseline_ref`
- `status: active|completed`
- 完成时的 `outcome: adopt|continue|reject|inconclusive`

`hypothesis.md`、`candidate/` 和 `evaluation/` 应有与当前实验相关的实质内容。完成的 Experiment 还必须有实质 `decision.md`，写清结果、依据、回归、限制和下一步。研究失败或证据不足是合法结果，不要求生成 Release。

## Run 最小合同

Run 记录实际来源、Git 提交与 dirty 状态、必要资产摘要和逐项观察。每条结果至少包含：

```json
{
  "run_id": "run-<UUIDv4>",
  "trial_id": "本次 Run 内唯一 ID",
  "input_id": "输入或场景标识",
  "status": "completed|failed|error|skipped",
  "observation": "实际观察"
}
```

`failed` 和 `error` 需要 `failure_reason`。分数、耗时、Token、成本、模型和证据引用按研究需要增加，不设固定 17 列合同。

## Research Release 最小合同

Release 根目录至少包含 `manifest.yaml`、`harness.yaml`、`runtime.yaml`、`artifact-manifest.json` 和 `README.md`。`manifest.yaml` 使用以下字段：

- `schema_version`
- `release_id`
- `agent_id`
- `version`
- `source_experiment`
- `source_commit`
- `evaluation_ref`
- `runtime_compatibility`
- `artifact_digest`

Release 必须自包含实际 Harness 资产，逐文件清单与摘要可复算；不得包含 Session、缓存、附件、秘钥或整个 `$DSH_HOME`。README 应说明用途、复现方法、限制以及“不是生产部署批准”。

`artifact-manifest.json` 使用 `schema_version`、`tree_sha256` 和按路径排序的 `files`；每项记录 `path`、`sha256`、`size`。为避免摘要自引用，文件列表只排除根部 `manifest.yaml` 与 `artifact-manifest.json`；`manifest.yaml.artifact_digest` 等于 `sha256:<tree_sha256>`。

## 四项安全底线

- 不提交秘钥。
- 不自动执行不可信归档或其中的脚本、Hook、Plugin、Skill、Workflow、配置。
- 不进行未经用户授权的提交、推送、打 Tag、删除、覆盖、发布或外部写入。
- 如实记录结果、失败、未知状态和适用限制。

具体 Harness 的安全约束可以作为研究变量，但不自动变成全仓库的控制平台。
