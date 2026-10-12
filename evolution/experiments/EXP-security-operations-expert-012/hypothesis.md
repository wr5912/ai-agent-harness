# 研究假设

历史 EXP-010 的巡检 Run 在 `U-INS-001` 暴露了工具未注册和真实业务链未完成的问题。本实验第一次预检 Run `run-e512f852-0e0d-4ba1-8bde-902407b04f75` 再次观察到 `UNKNOWN_TOOL`，实际巡检 MCP 只提供 `inspection_capabilities_list`、`inspection_runs_start_with_plan`、`inspection_runs_collect_evidence`、`inspection_runs_finalize`。旧 Skill、Guard 与测试口径仍引用三工具合同。先依据服务现行 Schema 更新唯一 `evaluation.md` 中相关 Case，随后在同一测试口径下比较旧 Candidate 与对齐合同的 Candidate。

Baseline 为本分支起点提交 `97236e16ebca8e49623959ec9afdfe77002bbdb9` 中的 EXP-009 Candidate；本实验的 Candidate 从该目录复制。业务变更限定在巡检 Skill、主 Agent 路由说明及其直接消费者 Guard 和角色工具矩阵；保持一个标准 DSH 镜像。用 `U-INS-001` 检查真实完成，以 `U-INS-002` 和 `U-INS-007` 查回归。两边均需新实例和新 Session，固定 Case 摘要、镜像、模型、巡检 MCP 与依赖条件，分别封存 Run、原始回答与工具调用，再比较。至少重复一次，分别记录原命令流程和最小 CLI 的操作步骤、耗时、错误与人工核对量。

若巡检服务、工具注册或模型凭据不可用，保留失败或未知状态，不把静态检查、旧 Run 或本地替身当作业务效果证据。本轮 Decision 先由 AI 按原始记录作临时判断；真实业务采纳仍需研究者亲自核对原始记录。
