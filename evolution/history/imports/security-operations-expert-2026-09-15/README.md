# security-operations-expert 迁移历史

本目录保存 2026-09-15 接收的旧 Harness 和初版交付材料的可审计迁移记录。原始归档与目录仍保留在仓库外，未复制原压缩包。

`source-manifest.json` 对 86 个归档文件和 50 个交付文件逐一记录摘要、大小、处置原因和目标。`delivery-docs/` 与 `archive-docs/` 仅是清洗后的历史证据，不会被 DSH Profile 挂载，也不是当前正式交付事实源。旧 Hook、测试、部署脚本、环境文件和 Runtime 配置仅保留摘要，未执行、未激活。

旧 `CLAUDE.md`、`agent.yaml` 和四个角色配置标记为 `manual-transform`，清单绑定其人工合并目标的摘要；脚本没有自动生成这些目标。

摄取脚本默认只允许一次写入。若需要显式刷新，先确认本目录 `source-manifest.json` 与 Experiment 的 `evaluation/source-inventory.json` 摘要相同，再传入 `--refresh-generated --expect-existing-manifests-sha256 <确认过的摘要>`；任一旧清单或生成目标漂移均拒绝覆盖。
