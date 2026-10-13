# API 重复比较与实例观察

本轮在当地 2026-10-12 执行，证据时间使用 UTC 2026-10-13。研究假设与来源取舍见[研究假设](../hypothesis.md)，评估口径仍只有 [Agent evaluation.md](../../../../agents/security-operations-expert/evaluation.md)。本观察中的语义复核由开发会话完成，尚无独立人类采纳。

## 来源与比较口径

直接来源为 EXP-017-r94 的 Git `5e1447d14a9c202aae05144034100a1ce685dee0`。标准镜像 `ai-agent-harness/dsh:21638c563-54f335ef05ac`、实际 Image ID `sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc`；锁定 Runtime 为 `21638c56315ae6a2b552d6091945d3144c9af32e`，模型为 `local-qwen / Qwen3.8-27B`。未重建镜像、修改 Runtime 或外部服务。

两次 Baseline 选择 `U-INS-003/007`、`U-QA-012/013`；Candidate 加上 `U-INS-002/004`、`U-QA-003/014` 四项回归，均通过 API 在隔离实例、新 Session 执行。同一比较期间不修改评估口径；四项公共 Case 快照一致。选择四项与八项时 Run 的评估集合摘要不同，不代表 Case 内容被修改。每条 Run 保留 Git 提交、dirty 路径、三棵资产树、镜像、模型、输入和完整回答。

[首次继承检查](evidence/inheritance-20261013.txt)与[最终继承检查](evidence/inheritance-final-20261013.txt)均记录来源 199 个文件、缺失 0、变化 2、退出码 1。逐项复核：`harness.yaml` 更新 Experiment 身份和 Baseline；`dsh/workspace/AGENTS.md` 是本次材料路由及格式合同变化。其余来源文件保持一致；Presets 和 Managed 两棵树摘要与 Baseline 一致。退出码 1 表示差异需要审查，不记作“无差异通过”，也不证明所有历史能力行为等效。

## Baseline 与早期 Candidate

| Run | 执行入口墙钟耗时 | 机器结果：通过/失败/不确定 | 原始证据复核 |
| --- | ---: | --- | --- |
| [Baseline 1](../../EXP-security-operations-expert-017-r94f3b07e080f/runs/run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92/report.md) | 291.339 s | 3 / 0 / 1 | `U-INS-003` 回答有代码围栏、输入外时间并尝试未请求的文件写入，严格全文解析失败；评审器自身也非 JSON。 |
| [Baseline 2](../../EXP-security-operations-expert-017-r94f3b07e080f/runs/run-4df73407-f103-42eb-b0e6-c8cb4fee3f26/report.md) | 192.110 s | 2 / 0 / 2 | `U-INS-003` 裸 JSON 保留四项事实与单位；`U-QA-012` 评审器非 JSON。 |
| [Candidate 启动失败](../runs/run-89838a0c-d23e-42af-9029-dd4343786fe6/report.md) | 3.208 s | 0 / 0 / 8 | 新目录缺少语音插件本地依赖，八项均为执行错误；未执行任何有效比较。 |
| [Candidate 初次修订 1](../runs/run-1d3487ad-6007-4484-8f1c-4b7b77490856/report.md) | 205.160 s | 6 / 1 / 1 | `U-INS-003` 实际为完整可解析 JSON，含事实与尚未执行建议；评审器反而以缺少这两项判失败。`U-QA-014` 评审器非 JSON。 |
| [Candidate 初次修订 2](../runs/run-a05e1855-ad22-4ffa-ac9c-719d128eac42/report.md) | 242.098 s | 7 / 1 / 0 | `U-INS-003` 又输出围栏，格式修订不足；尝试响应规划委派被 Guard 拒绝，没有实际子智能体执行。 |

两次 Baseline 的 Candidate 树和四项 Case 快照一致；第一次 Git clean，第二次 dirty 仅为前一次 Run。初次修订的两次有效 Candidate Run 也使用相同资产树和八项快照，差异不能归因于两次之间修改输入或 Harness。

启动失败后只在新 Candidate 插件目录补装忽略的本地依赖：普通 `npm ci --offline --ignore-scripts --no-audit --no-fund` 因既有 peer 锁冲突失败，`npm ci --offline --legacy-peer-deps --ignore-scripts --no-audit --no-fund` 安装成功；未执行安装脚本，未改锁文件或标准镜像。启动失败原 Run 保留。

初次修订只明确用户格式优先及写入条件；第二次失败的[原始轨迹](../runs/run-a05e1855-ad22-4ffa-ac9c-719d128eac42/evidence/U-INS-003/trace.jsonl)显示先加载巡检 Skill，再尝试 `delegate_response_planning`，收到“受信 Gate 未开启”后主 Agent 自行输出围栏。最终修订在同一 `AGENTS.md` 修正材料整理路由，并使默认 Markdown 明确以用户未指定格式为条件；没有移除 Guard、开放委派或剥除围栏以放宽验收。

## 最终修订的两次重复

| Run | 执行入口墙钟耗时 | 机器结果：通过/失败/不确定 | 原始证据复核 |
| --- | ---: | --- | --- |
| [最终修订 1](../runs/run-cc0cc86a-a93e-45eb-b8b6-090b16ab4c8a/report.md) | 213.362 s | 8 / 0 / 0 | 八项均完成；`U-INS-003` 完整回答可解析，零工具调用；巡检第二轮只查询原 `runId`。 |
| [最终修订 2](../runs/run-a42a52d3-6adc-4800-8ae5-4c97f4c3c0de/report.md) | 263.389 s | 5 / 1 / 2 | 八项均完成；`U-INS-003` 再次完整可解析、零工具调用；目录与巡检续查评审器非 JSON，漏洞追问评分与原文矛盾。 |

两次最终修订的三棵资产树、八项 Case 快照与评估集合摘要相同；实际模型路由、Image ID、Preset 和工作区均核对一致。`U-INS-003` 两次严格解析整个回答，没有去围栏或抽取片段；39、12、4、2 与台/套、项保留，未补造执行时间，辅助判断与建议明确未核验或未执行。第二次 JSON 的数量字段共用台/套说明，异常结论的“2 项”保留在辅助文本，未要求或验证固定字段 Schema。两次均无巡检、委派或写入工具调用。

`U-INS-007` 两次均在同 Session 第二轮只调用一次 `get_inspection_result`，复用各自首轮的 `runId`：第一次 `run-f6f8a8aa849d474ea3833e5f6a59afa1`，第二次 `run-743e97356ba444dc9107509f9bfb578b`。各自两轮的服务状态与回执一致，均为 `PARTIAL / ABNORMAL`、应检查和实际观察均 52 台，保留在线、离线、漏洞及基线证据缺口；报告地址来自服务原文，没有重发巡检。服务回执内报告含裸换行及附文，复核时读取 JSON 前缀并检查原文，未将回执称作严格可解析的完整 JSON，也未修改外部接口。该技术续查路径有证据，完整业务结果仍不通过。

`U-INS-002/004` 的两次轨迹都仅加载 Skill、查询目录，没有发起巡检或创建周期任务。第二次 `U-INS-002` 回答把模板名称链接到工作区，链接不代表模板页面，未验收这些导航。`U-QA-003` 保持故障只读边界，`U-QA-012` 未谎称已有最新检索。`U-QA-013` 第二次明确缺少漏洞编号、组件、版本及报告，要求补充材料，没有给出该未知漏洞的根因；评审却同时称“未指出缺少信息”和“给出了补充信息请求”，原失败评分保留。不过轨迹先调用了 `glob`、`schedule_list` 和取证 Skill，存在多余查询，不声称这一问答路由完全合格。`U-QA-014` 两次为英文回答，未把 CVE ID 当作严重度；没有全面核对其附加的编号格式、治理信息等事实。

Baseline 与初次修订使用 `review_mode: none`，最终两次使用 CLI 默认的 `review_mode: ai`。这是新增的场景级复核，不能声称整个评审配置未变；Case、机器判定输入与被测模型未改变。场景复核读取实际路由后以 `target-route-unsupported` 失败：现有 `scenario_analysis.py` 仅支持 `deepseek-official`，本轮 `local-qwen` 未获得该层复核，两次 `effective_verdict` 都是 `inconclusive`，不是八项整体通过。Case 自评与被测 Agent 同模型，也不是独立评审。

墙钟耗时在临时执行入口用单调时钟记录，包含准备、Case 执行、机器评审及适用的场景复核，不是单次模型响应或服务 SLA；四项 Baseline 与八项 Candidate 不能据总耗时比较性能。七条 Run 全部保留，其中一条启动失败、六条实际执行；不覆盖早期失败，也不由两次局部观察推断长期稳定。结论见 [Decision](../decision.md)。

## 证据定位成本

以 Baseline 2 的 `U-INS-007` 和 `U-QA-012` 分别重复五次本地读取。直接路径读取七处文件：`inputs.lock.json`、`results.jsonl`、`evidence/dsh-image.json`、`summary.json`、Case 的 `response.json`、`checks.json`、`tools.jsonl`。现有 `python3 runtime/adapters/dsh-container/run_record.py show --run run-4df73407-f103-42eb-b0e6-c8cb4fee3f26 --case <Case>` 聚合前六类信息，另读取原始 `tools.jsonl`，共两次操作。

| Case | 直接读取中位耗时 | CLI 加原始回执中位耗时 | 等价断言失败 |
| --- | ---: | ---: | ---: |
| `U-INS-007` | 4.09 ms | 98.91 ms | 0 / 5 |
| `U-QA-012` | 0.55 ms | 103.61 ms | 0 / 5 |

测量使用临时 TypeScript 探针，逐项断言来源、Git/dirty、模型、树摘要与文件数、评估摘要、Trial、完整输出、Session、实际装载、总结、镜像及原始工具回执等价。首次自检误将完整树清单与 CLI 树摘要比较，校正测量对象后才取得上表。这里仅测本机程序读取耗时与入口数，未测人类查证时间、漏读率或真实研究效率；CLI 执行更慢，不据此新建查询工具或平台。

## 两个隔离实例的身份、状态与时间

只操作新实例 `security-operations-expert-gap-a-20261012` 和 `security-operations-expert-gap-b-20261012`：A 装载本 Candidate，B 装载固定来源的未改工作树，两者共用上述标准镜像。通过 DSH API 创建不同 Session，核对 Preset 和工作区；三棵资产挂载只读，宿主与容器 `AGENTS.md` SHA256 相同，A/B 的 Harness 摘要不同。

[初次修订观察](evidence/instance-observation-20261013.json)及[最终修订观察](evidence/instance-observation-final-20261013.json)分别保留五个阶段、十条记录。最终记录在 UTC 05:25:11–05:25:28 观察 ready、prompting、completed、stopped、restarted：A 发起信息不足的漏洞问答后活动，B 持续空闲；A 完成后空闲；停止 A 后容器 exited、API 不可用、DSH 状态 unknown；重启 A 后原 Session 仍存在且已完成一轮。B 的容器启动时间和 Session 未变化。真实用户消息与上下文注入区分计数，活动由 `turn/start` 和 `turn/end` 推导；观察时间与最近事件时间分别记录，不把二者混为一谈。

临时探针首次把消息入队当作已活动，并将上下文消息计作用户消息，断言失败；随后依据实际 Turn 事件等待和计数后通过。首次失败未形成完整证据文件，本段保留该事实；它不是产品实例状态故障。重试沿用隔离实例 HOME、创建新 Session。最终停止本次两个探针实例，保留 HOME；既有周期实例 `security-operations-expert-eval-3b9d84b7` 未停止或重建。

这些是 API、事件及容器身份观察，没有平台页面或跨实例 UI 验收。待测服务等待上限尚未知；探针的 10 秒启动等待、120 秒完成等待是探针超时，不能称作服务 SLA。没有操作 `232:18120`。
