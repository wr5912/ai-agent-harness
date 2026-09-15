# 仓库演进不变量

需要创建、迁移、晋升或审计 Harness 资产时读取本文件。

## 生命周期与身份

- 所有语义性修改：`Baseline → Experiment → Candidate → Evaluation → Release`。
- `EXP-<agent-id>-NNN` 是实验记录；`<agent-id>-v<semver>` 是稳定 Baseline 与 Release 的名称。
- `<semver>` 严格采用 SemVer 2.0 标识符规则；Agent、Release manifest 的顶层 `agent_id` 必须唯一且与目录一致。
- 候选基线使用 `bl-<UUIDv4>`，它是首次正式自测前冻结的待测组合，不等于 `evolution/baselines/` 中已经验证的稳定资产。
- 任一冻结项变化都产生新的候选基线；同一候选基线重跑只产生新的 `run_id`。

## 目录职责

- `agents/<agent-id>/`：当前业务 Agent/Harness 定义；不得绑定为 `dsh-agent`。
- `tasks/`：任务定义；`acceptance.yaml` 只能引用或投影交付记录中的 `AC-xxx`，不得成为第二套可编辑验收标准。
- 评估用例只有一个事实源，通过 `core`、`boundary`、`safety`、`regression` 标签形成逻辑子集，不复制 Case。
- `evolution/experiments/`：假设、变化、候选、评估和决定；`evolution/baselines/`：已经验证通过的稳定快照。
- `releases/`：可部署、不可变、自包含资产，至少绑定 Harness、Runtime 兼容范围、评估报告和变更记录。
- `runtime/` 只记录兼容性和适配；不得复制 DSH Runtime 源码或私有运行数据。
- 当前项目可装载 Harness 仅适用容器内 DSH。Experiment `candidate/dsh/workspace/` 是 Authoring 中唯一模型可读写的行为工作区；`candidate/dsh/presets/` 与 `candidate/dsh/managed/` 由受控平面只读装载，迁移历史与评估证据不挂载。容器内 DSH 可以自组合、自修改行为资产，但写入只形成待审 Candidate diff，复核后新容器、新 Session 激活。
- `candidate/delivery/eval/cases.pending.jsonl` 只是旧材料摄取暂存，不是正式 Eval Case 事实源；不得把迁移输入数量、旧 `synthetic_reviewed` 声明或空结果文件记为正式评估通过。

## 发布一致性

生产环境挂载具体 Release，不挂载可变 `current/`，也不挂载 Experiment Candidate。Release 的完整可装载树必须只读，生产 DSH 不自修改。稳定 Baseline 与 Release 必须同名、同时晋升，并使用相同的完整可装载资产树。项目采用以下最小、确定性发布契约：

- 稳定 Baseline 根部包含 `harness.yaml`、`runtime.yaml`、`artifact-manifest.json` 和 `evaluation.json`；Release 根部包含前三项以及 `manifest.yaml`、`evaluation-report.md`、`CHANGELOG.md`。
- `runtime.yaml` 使用唯一顶层标量 `runtime_compatibility` 记录非占位的兼容范围。复杂 Runtime 配置作为其他资产文件保存。
- `artifact-manifest.json` 精确列出每个可装载文件的相对路径、SHA-256、字节数和权限 mode，并给出规范化文件列表的 `tree_sha256`。字段按 JSON 类型严格比较，字节数必须是整数，不能用布尔值或浮点数冒充。Baseline 计算时排除自身的 `evaluation.json` 和 `artifact-manifest.json`；Release 另排除 `manifest.yaml`、`evaluation-report.md` 和 `CHANGELOG.md`。两边的文件列表和树摘要必须完全一致。
- `evaluation.json` 是无重复键、无 `NaN`/Infinity 的 JSON 对象；schema 1.0 只允许 `schema_version`、`status`、`release_id`、`agent_id`、`version`、`baseline_id`、`adopted_run_id`、`formal_run_status`、`delivery_review_status`、`runtime_compatibility`、`artifact_digest`、`blocking_failures` 和 `safety_violations` 这组封闭字段。它必须绑定目录对应的身份、合法 ID、兼容范围和资产摘要，并记录正式运行、交付复核均为 `pass`、两项计数均为 JSON 整数 `0`。需要新增字段时先升级 schema 和校验器。
- Release `manifest.yaml` 使用唯一、非空的顶层标量；`schema_version: 1.0` 精确包含 `schema_version`、`release_id`、`agent_id`、`version`、`baseline_id`、`adopted_run_id`、`runtime_compatibility`、`artifact_digest`、`evaluation_status` 和 `delivery_review_status`，这些身份必须与目录和 Baseline 一致。新增字段应先升级 schema 和校验器，不能留下未受约束的第二结论。
- `evaluation-report.md` 的 YAML frontmatter 重复绑定 `release_id`、`baseline_id`、`adopted_run_id`、`formal_run_status: pass` 和 `delivery_review_status: pass`。正文固定以“评估报告 / 机器结论 / 人工证据”三级结构开头；机器结论段只能依次写“正式评估运行结论：通过”和“交付评估结论：通过”，这两个保留字段不得在人工证据中再次出现。人工证据的自然语言不参与机器结论推断，必须由交付复核者确认其与固定结论一致。`CHANGELOG.md` 必须包含当前 Release 标识和至少一项实质变更。

Release 只能存在一个可识别的 Harness 主文件候选，并归属于同名 Agent。已有 Release 的 Agent 必须由 manifest 唯一绑定具体 Release，且 `agents/<agent-id>/current/` 的完整可装载资产树与该 Release 内容一致；发布后的修改进入新 Experiment，不覆盖旧 Release。

`artifact-manifest.json` 的确定性结构为：

```json
{
  "schema_version": "1.0",
  "tree_sha256": "sha256:<64 lowercase hex>",
  "files": [
    {"mode": "0644", "path": "harness.yaml", "sha256": "<64 lowercase hex>", "size": 123}
  ]
}
```

`files` 按 Unicode 相对路径升序排列。`tree_sha256` 是将该数组以 UTF-8、`sort_keys=true`、`ensure_ascii=false`、无多余空白的 JSON 序列化后计算的 SHA-256。

## Task 与 Experiment 最小机器契约

- `task-definition.yaml` 使用唯一、非空的顶层标量，`task_id` 与目录名一致，并提供非占位的 `goal`、`input_contract` 和 `requirement_source`。
- 可选 `acceptance.yaml` 必须唯一声明 `source_ref` 或 `acceptance_source`，值为 `agents/<agent-id>/delivery/交付记录.md#AC-xxx` 或拆分版需求定义的同类引用；目标必须是仓库内真实文件且确实包含该 AC。
- `change.yaml` 至少包含与目录一致的 `experiment_id`、名称中对应的既有 `agent_id` 以及 `development_path: direct|exploration`。`hypothesis.md` 和 `decision.md` 必须有标题之外的实质内容，`candidate/` 与 `evaluation/` 必须各有真实内容；`TODO`、`TBD`、空 JSON/YAML、只藏在 HTML 注释中的文本，以及仅用 Markdown 强调、行内代码、引用、列表、任务项或代码围栏包装的占位内容都不算真实资产。围栏内存在非占位代码时仍视为真实内容。

治理路径的每一级和资产根与结构容器的子项都必须是真实目录；普通文件不得通过父级符号链接逃逸仓库。治理与资产文件拒绝符号链接、硬链接、特殊文件、零字节文件和纯占位目录。资产扫描上限为 100,000 个节点、256 层、单文件 64 MiB、文本文件 4 MiB、资产总量 1 GiB；超过限制时 fail-closed，不继续以无界遍历或读取形成结论。

Harness YAML 通过 PyYAML `SafeLoader` 的重复键、节点数和 alias 数受限变体解析，并拒绝空文档和纯 TODO 占位结构；依赖版本见 `scripts/requirements.txt`。缺少该依赖时，已物化 YAML 资产不能通过校验。

## 权威来源

- `docs/standards/Harness_Repo目录结构设计说明_v1.1.md`
- `docs/standards/Harness_Asset_Repository规范_v1.0.md`
- `docs/standards/SOURCES.md` 锁定的 `agent-engineering-spec`
- 本项目对三者的冲突消解：`docs/standards/PROJECT-INTERPRETATION.md`
