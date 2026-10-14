# security-operations-expert 迁移历史

本目录保存 2026-09-15 接收的旧 Harness 和初版交付材料的可审计迁移记录。原始归档与目录仍保留在仓库外，未复制原压缩包。

`source-manifest.json` 对 86 个归档文件和 50 个交付文件逐一记录摘要、大小、处置原因和目标。`delivery-docs/` 与 `archive-docs/` 是清洗后历史材料的 2026-10-13 本地术语修订版，不会被 DSH Profile 挂载，也不是当前正式交付事实源。旧 Hook、测试、部署脚本、环境文件和 Runtime 配置仅保留摘要，未执行、未激活。

旧 `CLAUDE.md`、`agent.yaml` 和四个角色配置标记为 `manual-transform`，清单绑定其人工合并目标的摘要；脚本没有自动生成这些目标。

修订前的本地副本可从 Git 提交 `6560e86291100d9bab89016e2194e64a19654d08` 的同路径恢复；`source-manifest.json` 的 `entries` 和 `generated_outputs` 保留摄取时的原始与清洗摘要，不用本地修订结果覆盖。对应 Experiment 的 `evaluation/evidence/source-inventory.json` 同样是摄取快照，不是当前文件摘要表。当前业务评估以 Agent 的 `evaluation.md` 为准，术语见[项目术语表](../../../../docs/项目术语表.md)。

历史摄取流程的一次写入、摘要确认与漂移拒绝约束仍用于解释当时处置；本次未重跑摄取，也不以历史生成目标摘要判断当前可编辑资产是否未经修改。
