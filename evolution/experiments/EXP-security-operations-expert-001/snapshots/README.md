# 历史研究快照：恢复映射

本目录不再保存全量源码快照。源码版本由 Git 管理；每个 Run 使用的源码版本、镜像、模型与测试范围记录在 `../runs/` 与 `../evaluation/evidence/` 中。

早期曾用 `snapshots/research/<snap-id>/` 复制整套 Harness、spec、eval 与依赖清单。该做法与 Git 重复保存同一份源码，并引入一套独立的身份、权限与摘要校验规则；权限校验在 `umask` 不同的检出环境会产生误报，且 `snapshot:` 运行入口把当前镜像静默当作历史组合使用。因此默认生成已停止，工作树中的重复副本已移除，历史内容改为按下表从 Git 恢复。

## 快照恢复表

| snap-id | 最后所在提交 | 原路径 | 文件数 | 内容 |
|---|---|---|---|---|
| `snap-d0802d2a-ae8f-4d51-8101-b52bee291a2b` | `7952f49c4e9bdbf81721dee13142d2d8d83e05fe` | `evolution/experiments/EXP-security-operations-expert-001/snapshots/research/snap-d0802d2a-ae8f-4d51-8101-b52bee291a2b` | 60 | `harness/dsh`、`spec/`、`eval/`、`snapshot.json`、`dependencies.lock.json` |

恢复整棵快照：

```bash
cd <repo-root>
git archive 7952f49c4e9bdbf81721dee13142d2d8d83e05fe \
  evolution/experiments/EXP-security-operations-expert-001/snapshots/research/snap-d0802d2a-ae8f-4d51-8101-b52bee291a2b \
  | tar -x -C /tmp/snapshot-restore
```

只查看某个文件：

```bash
git show 7952f49c4e9bdbf81721dee13142d2d8d83e05fe:<原路径>/snapshot.json
```

## 使用限制

- 该快照生成于 `role-tool-matrix.yaml` 修正之前，只代表当时的内容，不是当前候选，也不是已评估基线。它不携带任何评估结论。
- 恢复出来的目录是普通源码副本。它没有冻结校验入口，也不参与 `dsh-dev` 的来源选择；需要比较或派生时，把需要保留的内容提交到研究分支，按普通 Git 版本使用。
- 历史证据文件（`../evaluation/evidence/`）中对该 snap-id 的引用保持原样，不随本次收敛改写；其对应内容可按下表恢复。
