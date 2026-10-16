# DSH Harness 研究管理 CLI 设计方案

> 状态：当前平台通过全局 DSH 提供智能体、评测、实例与工具管理，底层复用本地研究 CLI。本文维护研究 CLI 的用途与边界；平台组合、启动与装载合同统一见[平台设计方案](platform-design/02_系统架构与部署设计.md#当前最小平台接入合同)。

## 1. 为什么先做 CLI

平台服务个人开发者，程序与业务研究资产分别维护。当前真正需要的是：选定来源、在宿主开发会话中编辑 Candidate、启动只读 DSH 评测实例、保存 Run、比较观察。它们都是本地、低并发、Git 驱动的操作，用项目技能和几个可组合的 CLI 已经足够。

平台的创建、修改、评测和实例管理复用这些确定性入口；业务流程由数据仓库的管理 Skill 维护。扩展平台能力仍须针对实际瓶颈，不能因为“以后可能做平台”就引入数据库、账户体系、审批流、任务队列或状态服务。

## 2. 当前已有入口

| 入口 | 当前用途 | 边界 |
|---|---|---|
| `harness-guided-workflow` | 多轮引导新建、迁移、修改或优化 Harness | 复用现有研究文件，不另建流程状态 |
| `dsh-dev` | 创建最小 Agent/首次 Experiment，解析来源，构建镜像，启动、查看和停止只读评测实例 | `init` 不覆盖已有资产；新实例只支持 `--mode eval`；CLI 不判断 Harness 效果 |
| `dsh-eval` | 默认通过 DSH Runtime API 执行所选业务 Case；显式选择浏览器时做 UI 冒烟；保存同一 Session 的回答与轨迹并封存 Run | 两种通道分别形成 Run；只自动判定确定性合同，业务语义保留 `inconclusive` |
| `source_contract.py` | 把来源解析成 Agent、Preset 和挂载计划 | 当前只支持 `experiment:<id>` |
| `mutation-receipt.py` | 摘要、冻结、校验或恢复 Candidate 的三棵挂载树 | 不记录变更差异，不替代 Git 或人工复核 |
| `run_record.py` | 创建、追加、封存 Research Run，并按 Agent 索引、查看、比较已有 Run | 不执行任务；`compare.comparable` 仅表示共同 Case 有两侧结果，`causal_comparable` 核对已记录的条件，均不判断业务等效 |
| `validate_repository.py` | 检查仓库、Experiment 和 Research Release 的确定性合同 | 退出码 `0` 不表示假设成立 |
| `validate_experiment.py` | 检查一个 Experiment 的最小研究记录 | 不要求固定 Case 数或生产门禁 |
| `plugins/asset-query-cli/` | 只读列出 DSH 资产的原型 | 不是管理平台，也不执行写操作 |
| `platform/dsh-platform` | 准备并启动全局 DSH 的 Harness 工程平台 | 读取原有研究目录；接入合同和验证状态分别见平台设计方案与 `PA-12` |

这些入口可以继续各自演进，不急于包成一个总命令。只有重复参数或重复解析已经造成真实维护成本时，才抽取共享模块。

## 3. 研究流程与工具合同

管理助手的研究流程见[数据工作区研究方法](https://github.com/wr5912/harness-engineering-platform-data/blob/main/docs/harness-research/controlled-improvement.md)。本文件维护 CLI 的执行边界。Git 保存资产与版本，Run 保存实际执行观察，原生 HOME 保存会话与设置；三者按实际定位读取。脚本位于程序根，操作目标由 `HARNESS_ASSET_ROOT` 指向数据根，不依赖 shell cwd。

## 4. 后续 CLI 的选择标准

新增命令前先回答：

1. 当前是否至少有两个真实操作反复需要它？
2. 现有命令或短脚本是否已经足够？
3. 它是否能减少来源选错、结果丢失或不可复现，而不是只增加抽象？
4. 输出是否能直接被人读懂，并清楚区分成功、失败和未知？
5. 删除这个命令后，是否会失去当前研究能力？

只有答案支持新增时才实现。优先扩展 owning CLI，平台按需复用同一入口与事实源。

当前已知的后续能力缺口是：

- `release:<id>` 的解析与只读装载；

它仍应先以本地命令实现和验证。现有 `run_record.py compare` 已提供两个 Run 的并列视图；`dsh-eval --compare-to` 会将封存的对照写入新 Run 报告。未出现实际需求前，不规划发布审批、自动优化、分布式 Runner、操作状态卷或多租户管理。

## 5. 数据和安全边界

- 平台和实例密码及非 LLM API 凭据可使用 Agent 的实例专用仓库文件；LLM API Key 只保存在被 Git 忽略的 `*.llm-api-key` 文件中，不提交或推送到远端。CLI 只在运行时注入值，不在参数、普通输出或 Run 中展开。
- 外部归档先用 `legacy-asset-intake` 只读检查，不自动执行其中内容。
- CLI 不进行用户未授权的提交、推送、打 Tag、删除、覆盖、发布或外部写入。
- 命令如实报告失败和未知状态，不把目录存在、容器启动或 HTTP `200` 写成研究成功。
- 浏览器认证 URL 只在进程间传递，不进入 Run、状态文件或普通输出；每个运行态 Case 使用新的 Session。
- Session、缓存、附件和整个 `$DSH_HOME` 不进入 Git、Candidate 或 Research Release。

具体业务 Harness 的工具约束、Guard 或审批可以作为实验变量，但不要求 CLI 建设一套通用权限平台。

## 6. 何时扩展平台能力

当前平台能力与证据以项目验收矩阵为准。下列问题在真实使用中重复出现，并且现有工具无法合理解决时，再评估相应扩展：

- 多名研究者需要同时编辑同一资产并频繁冲突；
- 大量长时间 Run 需要跨机器排队、恢复和调度；
- 研究资产数量使本地索引明显不可用；
- 需要给非开发者提供稳定的只读结果界面。

届时先记录瓶颈、使用频率和最小目标，再决定具体能力与验证方式。生产平台仍属于独立工程阶段，不是 Research Mode 的默认终点。
