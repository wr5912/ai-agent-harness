# 规范来源锁定

本文件记录本仓库初始化时实际采用的规范版本、不可变定位信息和内容摘要。受控原文不得直接修改；上游规范升级时应新增版本副本、更新本文件并评估迁移影响。

核对日期：2026-09-15。

## 仓库结构与资产生命周期规范

| 规范 | 受控副本 | SHA-256 | 状态 |
|---|---|---|---|
| Harness Repo 目录结构设计说明 v1.1 | [`Harness_Repo目录结构设计说明_v1.1.md`](./Harness_Repo目录结构设计说明_v1.1.md) | `47e91605ebff45baf269c7f85218ce69c58ada0a6cd78c8f7d8e5524bea44705` | 与提供的原文件逐字节一致 |
| Harness Asset Repository 规范 v1.0 | [`Harness_Asset_Repository规范_v1.0.md`](./Harness_Asset_Repository规范_v1.0.md) | `9a83b79a4b48cac99f8f56e69f9b63e2d9c78bb3db5f75be6f7e4501685fd502` | 与提供的原文件逐字节一致 |

上述摘要用于证明本仓库受控副本在初始化时与输入文件一致，不表示规范内容已经经过外部标准组织认证。

## 智能体研发规范

- 仓库：`git@github.com:wr5912/agent-engineering-spec.git`
- 锁定提交：[`1afe0eec1bb786e5313bb0a06717871fd14ebe28`](https://github.com/wr5912/agent-engineering-spec/commit/1afe0eec1bb786e5313bb0a06717871fd14ebe28)
- 初始化核验：本地 `main`、`origin/main` 和上述提交一致，工作树无未提交变更。
- Tag 边界：`v1.2` 是一个 annotated tag；其 Tag Object 为 `f97358c964fc96f05e3b8202e127fcf5a5c038f1`，解引用后指向 Commit `fa51364796c6c338d45372527a1c6733d3236198`，不是当前锁定提交。不得以 `v1.2` 替代本文件记录的 Commit 引用。
- 保留方式：仅记录 Git 来源、Commit、采用文件和文件摘要，不在本仓库复制整套规范正文。

| 采用文件 | SHA-256 | 本项目采用内容摘要 |
|---|---|---|
| `README.md` | `7bc832778351844ec2e10310ff496b5266b64c9cc1ecfc735f8433db7d7d412e` | 使用入口、主线与文档导航 |
| `00_总纲.md` | `d2c8400cf1ba3174b421ab3442c65d04f0d92931775c007278600585f341a85f` | 权威术语、角色、状态、风险与证据红线 |
| `01_研发流程与按需探索验证.md` | `a80762d91d43d91e8732ef5f8e5b202e59e927669d660ebb0cb63523441cda0e` | direct/exploration 路径、候选基线、复核与失败路由 |
| `02_需求定义与场景输入规范.md` | `e13d303ec50359371f1cd820ba8b693d85f150eda143adfefa3e6516ae8474e3` | `REQ-xxx`、`AC-xxx`、任务边界与输入覆盖 |
| `03_Harness开发与变更规范.md` | `177b48f33a3325d5fe644c537c66b054143d35cfcdc1fbb536df7338b852e8eb` | Harness 设计、A/B/C 变更、迁移和冻结项 |
| `04_评估测试与回归规范.md` | `99f20205f58dd3838805801f64843fd73125a24c9775a2e3c731276314556bd7` | 单一 Eval Set、正式范围、Case/Trial/Run 和机器结果契约 |
| `05_安全控制边界规范.md` | `d7852918e136e10446ba815cf77d9edcee28a9a26c5ec4d1d59ab6e275b93a9c` | 数据、工具、权限、审批、隔离和失败安全 |
| `06_交付评估与发布规范.md` | `ba374e48f141e72b16084ffd3268311e914645993349ef768003606628ad773a` | 唯一交付目录、R1/R2/R3、发布验证和回滚 |
| `07_研发交付六件套模板.md` | `2c220dc317f07a67c554e7971642d2ad40734b1fe4c5a9bc6e1063cee36aec18` | 六项交付内容、ID 生成与填写接口 |
| `08_最小实践示例_告警研判与处置.md` | `107d8c1f98869f49fb31b6f8192d6c089925e36c04f9afe989f9fbb7b341a237` | 安全运营场景的完整研发、整改与发布示例 |
| `09_研发检查清单.md` | `5d59c30a11dda7bc0c7c333ff442330cf232dc01e71e86ef4160134b328af12d` | 开发、交付和发布前的执行清单 |

## 更新与核验规则

1. 受控副本内容发生变化时，必须把它视为新来源版本，不得只更新摘要后继续声称是原 v1.1/v1.0。
2. `agent-engineering-spec` 升级时，先锁定新的 Commit，再逐项比较采用文件和硬门禁；Tag 只作辅助名称，不能代替 Commit。
3. 来源升级不会自动修改已有 Agent/Harness Release。需要采用新规则时，记录影响范围；影响冻结项的变化进入新的 Experiment 和候选基线。
4. 项目如何消解三项来源之间的目录与术语差异，见[《项目规范解释与裁决》](./PROJECT-INTERPRETATION.md)。
