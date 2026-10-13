---
name: harness-evolution
description: 以 Research Mode 创建、修改、迁移或审计 DSH Harness Experiment，记录 Baseline 引用、Candidate、Evaluation、Decision 和可选 Research Release。用于 Harness 资产演进；不用于建设生产发布或权限治理平台。
---

# Harness 研究演进

用最短的可复现路径验证 Harness 变化是否有价值。不要把未来生产需求提前变成当前实验的基础设施。

## 工作流程

1. 按根级 `AGENTS.md` 确认本次涉及的对象、修改范围、保存位置和验证方式。
2. 选择 Baseline 引用：`git:<commit>`、`release:<id>` 或首次实验的 `none:first-experiment`。已有 Agent 还须在创建前及 Decision 前用 `git ls-remote --heads` 核对远端分支最新提交，并盘点可访问的 Git refs、工作树和同 Agent Experiment，找出仍需保留的主线能力及并行来源；编号只标识创建顺序，不代表继承关系。基于同一 Agent 完整、可恢复且来源固定的主线版本派生、已验证等效的算力 `end` 版本是终端分支，不列为后续主线必继承来源；研究阶段优先选已发布父版，没有时可用固定 Git 提交或 Research Release。没有固定父版或等效证据时不能用 `end` 名义排除来源。来源被拒绝或某能力被替代时，在 `hypothesis.md` 说明取舍。
3. 建立 `EXP-<agent-id>-NNN-r<12位随机十六进制>`（旧编号实验保留），写清假设、预期观察、停止条件和 Candidate 变化。`hypothesis.md` 记录直接来源的 Experiment ID、固定 Git commit 或 Research Release、保留能力及冲突取舍；未提交的来源只作为临时工作树引用，提交后重新核对并固定版本。Baseline 是比较起点，不能证明 Candidate 已继承来源。
4. 使用足以回答当前问题的最小 Evaluation。先从少量高价值输入开始；需要扩大结论时再补覆盖和回归。
5. 完成集成后、作出 Decision 前，重新按第 2 步盘点来源，将新增来源的保留、替代或舍弃理由补入 `hypothesis.md`。对每个固定 Git 来源运行下面的文件差异检查；缺失文件须恢复或说明替代，内容变化须逐项审查，并用受影响的真实行为验证保留能力。回归测试必须加载目标 Candidate 的实际生成制品，不能只测来源版本；再核对该制品与运行实例加载的来源一致。保存真实观察、失败、未知状态和限制，作出 `adopt`、`continue`、`reject` 或 `inconclusive` 决定。
6. 只有版本确实值得独立复用时，才生成自包含、不可变、可校验的 Research Release。

涉及目录、身份或 Release 时，读取[仓库演进不变量](references/repository-invariants.md)。需要检查仓库时运行：

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/harness-evolution/scripts/validate_repository.py [repo-root]
node --experimental-strip-types .agents/skills/harness-evolution/scripts/check_inheritance.mts <来源 Experiment ID> <来源 Git commit> <目标 Experiment ID>
```

差异检查在来源文件全部一致时返回 `0`，存在缺失或变化时返回 `1`（待审查），参数格式不正确时返回 `2`。预期变化仍需记录取舍和验证证据，不要求把目标还原成来源，也不因非零退出码直接否定研究结果。该检查不能证明语义兼容，也不能发现未纳入来源集合的并行版本；后两项必须按上述盘点与 Evaluation 核对。

## 边界

- 每一处结构和字段都应服务当前研究、复现或装载；不添加未被当前问题使用的治理层。
- `candidate/` 是可修改工作树，不是生产候选或准入状态。
- Evaluation 不要求固定数量、REQ/AC、R1/R2/R3 或安全控制映射。
- DSH 源码、Session、缓存、附件和整个 `$DSH_HOME` 不进入 Harness 资产；平台和实例凭据保存在 Agent 的实例专用路径，LLM API Key 不进入 Git 或 Research Release。
- 源码修改后，用新进程或新 Session 核对实际装载；文件存在和脚本退出码 `0` 不等于假设成立。
- 校验器只检查确定性合同，不评价研究价值，也不授予发布或生产结论。
