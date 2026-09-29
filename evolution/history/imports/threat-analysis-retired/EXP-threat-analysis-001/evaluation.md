# 迁移评估

本轮证据支持固定流程已接入 DSH 并可实际运行，不支持所有研判结论正确。评估口径唯一维护在 [Agent evaluation.md](../../../agents/threat-analysis/evaluation.md)，运行命令见 [hypothesis.md](hypothesis.md)。

## 失败与限制

首轮 [run-baa872a8-ea47-43eb-b80f-3e437e7a743d](runs/run-baa872a8-ea47-43eb-b80f-3e437e7a743d/report.md) 因评测容器用户无法写入宿主证据目录而封存为 inconclusive。只读恢复的[工具观察](evaluation/evidence/first-tool-observation.json)证明首例实际完成取证和 Qwen 调用，原始结论为误报，但违反“误报不能包含已观察攻击路径”的原契约，没有正式结果。外层还添加了解释文字。随后统一评测执行器与宿主 UID/GID，并用 DSH 的 complete persona 明确原样交付；未修改该 Run。

白名单误分类、history 未接真实查询、部分关联告警缺失均未在本次改动中解决。模型契约对部分证据值不一致仅给出 warnings；本次保留此行为，不能将 passed_with_warnings 描述为证据完全正确。实时数据与迁移前验证时不同，历史黑名单例本轮进入五源。失败路径有首轮内部证据和确定性测试，修正后尚未重新观察到真实 contract_failed 的外层交付。

## 最终实际运行

[run-fd0c6101-a733-43e8-b84c-b7247182483a](runs/run-fd0c6101-a733-43e8-b84c-b7247182483a/report.md) 使用三个新 DSH Session，经 Runtime API 执行，3/3 接入检查通过并封存，实例已停止。检查涵盖 Preset、工作区、唯一工具目录、一次真实工具调用及用户回复与工具 JSON 一致。未运行浏览器 UI 冒烟。

| 事件 ID | 本次路由 | MCP 调用 / 失败 | 原始模型结论或快速分类结果 | 原契约状态 |
|---|---|---|---|---|
| INC-20260910-000003 | five_source | 259 / 0 | 可疑（模型） | passed_with_warnings，6 条 |
| INC-20260915-000002 | fast_classification | 208 / 77 | 误报（白名单，已知误分类例） | 不适用；内层模型未调用 |
| INC-20260912-000004 | five_source | 458 / 6 | 真实告警（模型） | passed_with_warnings，6 条 |

取证失败计数包含关联告警等查询失败，不能解读为名单查询必然不完整；原快速分类规则仍由名单完整性和已有直接实体命中决定。

[内部产物核对](evaluation/evidence/final-tool-observations.json)确认两例模型输入摘要与冻结五源一致，system prompt SHA-256 与迁移前提示词一致，均存在正式契约输出；快速分类没有 model 目录。内层请求名沿用 Qwen3.6-27B，实际响应为 Qwen3.8-27B；外层为 local-qwen/Qwen3.8-27B。请求代码只组织固定提示词与冻结输入，没有读取人工标签、审计包或旧结论。

实际镜像和输入身份见 Run 与[构建回执](evaluation/evidence/image-build.json)，源码记录为 Git 提交加 dirty 状态。迁移来源、闭包摘要及适配范围见 [migration.md](migration.md)。原始内部产物保留在该实例 HOME 卷，未复制为 Harness 资产；Run 保存用户可见响应和 Session 轨迹。

## 验证范围

首次迁移的流程及 Python 适配测试 182 项通过（另有 10 个 subtests）；仓库测试 53 项、运行适配器测试 90 项通过。原生工具 Node 测试 1 项、通用工具目录检查 2 项通过。首次迁移闭包除入口增加可选 argv 外与源文件一致，当时内置研判提示词内容未改动。

项目与工具链验证覆盖本次来源解析、镜像构建、装载、Runtime API 和 Run 封存路径。Experiment 结论限于本表三个输入的迁移可运行性；未重做六例准确性评估。没有创建或验证 Research Release。

## 提示词同步与证据引用复核

2026-09-24 按用户指定的本机来源提示词同步快速分类输出规则，继续在本迁移实验中验证。内置文件补充互斥输出分支、`verdict` / `matches` 结构、六个必备命中字段和引用完整性要求；仅将来源中的“本验证链路”改为“本智能体”，原五源研判规则逐字保留。同步后 SHA-256 为 `a1b469bf00e1d2032804d6696ef3b6f771733cc46e54f4f3e7e195c07d7f17b1`。上面的历史 Run 不覆盖本次提示词变更。

快速分类由代码直接返回，不调用内层模型。当前外层 Preset 要求保留完整工具 JSON，快速分类结构位于 `result`；仅同步内置提示词不会将网页最终答复变成裸 `verdict` / `matches` 对象。本次未变更该交付方式，也未放宽契约或引入自动修复。

同步后执行现有 Python 回归，182 项及 10 个 subtests 通过；原生工具 Node 测试 1 项通过，仓库与实验合同校验通过。尚未用新提示词执行真实模型或网页验证，不能将这些检查视为输出质量改善的证据。

对本地实例原始运行 `run-54d4cd7a-26a0-48c9-9d2f-fd78fc86258f` 的冻结输入和模型输出进行只读复核：16 条证据引用中 12 条路径无效。在内存中为这些引用补入唯一活动分段后，10 条可定位，其中 8 条值完全一致、2 条值不一致；另 2 条网络引用指向的记录仅有 `process_ref` 和 `observed_at`，不存在模型引用的 `destination_ip` / `destination_port`，整体契约仍失败。原始产物未改写。这只能支持区分可确定修复的路径错误与证据内容问题，不能据此估计所有事件的失败率。

## 快速研判交付修正（2026-09-27）

按用户确认方案修改外层 Preset：快速分类成功时只交付工具 result，五源及失败分支保留完整工具 JSON；同步六个用例的检查消费者。Python 回归 182 项及 10 个 subtests、原生工具 Node 测试 1 项通过。额外执行评测脚本的 27 项合成检查，覆盖新格式、拒绝旧包装、拒绝引用截断及五源成功/失败交付；仓库与实验校验通过。

独立实例评测 [run-60d12ba9-aa40-4073-b3dc-7b82f6657daf](runs/run-60d12ba9-aa40-4073-b3dc-7b82f6657daf/report.md) 在启动阶段失败，原因为镜像标签的构建指纹与当前仓库不一致，没有执行 Case，结论为 inconclusive。为核对本地实际使用路径，保留原镜像并重启现有 threat-analysis 容器，再用新 Runtime API Session 执行目标事件；此路径不等于独立实例复现，也不包含浏览器操作验收。

新 Session `session-9c81ef4d-212e-4606-822f-a79d5654e66b` 的[实际观察](evaluation/evidence/fast-delivery-observation.json)确认新规则进入上下文。事件 INC-20260917-000001 进入 fast_classification，MCP 调用 208 次、失败 1 次，内层模型未调用；最终答复顶层仅 verdict、matches，与工具 result 逐值一致，1 条命中的 412 条证据引用全部保留。原始工具运行 `run-4f225c9b-c5e9-43e0-adef-490f899aea1d` 与 Session 轨迹保留在实例 HOME。该观察支持本例交付修正生效；不证明白名单分类正确或所有长结果都能稳定交付。五源及失败分支本轮只做合成回归，未重跑真实五源事件。

## 程序直接交付（2026-09-27）

采用 DSH 原生 concludeTurn，在快速分类成功后结束本轮；工具输出内容仅渲染 result，完整运行对象保存在 tool/result 的 data.meta.threat_analysis。当前网页不使用 Host presentResult，因此不依赖该展示器。Agent 评测消费者同步读取元数据，并检查可见结果逐值一致和工具后没有第二次模型回复。

[新会话观察](evaluation/evidence/terminal-fast-delivery-observation.json)：INC-20260917-000001 总耗时 17.926 秒，MCP 208 次、失败 0 次，内层模型未调用；外层仅一次模型回复用于发起工具调用，工具后无 assistant/message，本轮正常 completed。1 条名单命中的 414 条引用保留完整。此前同事件观察总耗时 343.743 秒，其中工具后等待 326.459 秒；该比较支持本例消除二次生成等待，不是固定性能保证。

通过 Chromium 打开实际网页和该会话，展开工具卡后解析可见 JSON：顶层只有 verdict、matches，414 条引用完整，无 run_id 包装。当前网页默认折叠工具卡，需点击展开，不存在另一个助手答复气泡。浏览器核验为打开已完成会话，提交请求使用 Runtime API。

原生工具 Node 回归 2 项通过；真实轨迹检查 3 项通过（直接交付、拒绝二次回复、拒绝引用截断），五源成功/失败合成检查 12 项通过。仓库及 Experiment 合同校验通过。未重跑真实五源事件，不改变算法、提示词推理规则或证据合同，不创建 Research Release。摘要和报告 MCP 按用户要求仅留接口占位，无远端保存或下载 URL 验证。

## 摘要与完整报告直接交付（2026-09-28）

按确认方案增加固定代码投影及 DSH 原生工具网页组件。成功结果落盘 summary.json、summary.md、report.html，原始 result 保留；两条路径均直接结束本轮，不再次调用外层模型。保存 MCP 未接入，页面如实显示待接入，无下载 URL。字段与运行方式见 Agent definition，模板以 candidate 中代码为唯一维护来源。

[本地实例观察](evaluation/evidence/summary-report-delivery-observation.json)记录源码摘要、Git dirty 状态、镜像和新 Session：

| 输入 | 实际路由与结果 | 耗时 | MCP 调用 / 失败 | 工具后模型回复 |
|---|---|---|---|---|
| INC-20260917-000001 | 快速分类完成；误报（名单结果） | 18.137 秒 | 208 / 0 | 0 |
| INC-20260912-000004 | 五源完成模型调用，但 contract_failed | 180.550 秒 | 458 / 6 | 0 |

Chromium 打开这两个实际会话：快速摘要默认可见，无需展开工具；失败会话显示无正式结论的说明。快速 HTML 报告包含全部 414 条引用，1280 与 390 像素宽度下无页面横向溢出。请求由 Runtime API 提交，浏览器核验已完成会话，不声称覆盖浏览器输入全链路。

完整成功格式另以既有有效结果 run-3d9844b6-3da8-46ac-8450-363ff7465807 只读渲染，原文件不变；摘要含完整规定字段，报告包含事实与证据，校验警告可见。它仅证明结果展示，不能代替本次真实完整研判成功。本轮未放宽输出契约、重试模型或调整分类算法。

项目与工具链验证：178 项原算法测试、6 项 Python 适配/投影测试、3 项 Node 工具/网页组件测试通过；仓库和 Experiment 合同通过，六例评测计划 dry-run 可解析。本次用当前已运行实例核验，独立实例及 Research Release 未复现。对应 PA-03、PA-06、PA-07、PA-08 的局部证据，结论仍为 continue。

## 正式助手回复修正（2026-09-28）

上一轮工具网页组件只把摘要放进工具区域，虽可见但没有正式助手回复，本轮按用户反馈替换该交付方式。移除网页插件与 concludeTurn，注册 DSH 原生本地适配器，将 delivery.markdown 逐字输出为 assistant/message，工具区仅展示状态及运行 ID；原始结果和报告保存不变。下一轮恢复原模型，不重复交付旧摘要。

初始探针只拦截流而没有注册适配器，首轮可交付但续聊被 session/model-unavailable 拒绝。补齐原生注册后，新进程恢复该会话并成功续聊；最终版本另用新会话复测。该失败及修正后观察保存在[交付证据](evaluation/evidence/formal-assistant-delivery-observation.json)，没有改写历史记录。

| 输入 | 实际结果 | 耗时 | MCP 调用 / 失败 | 工具后正式助手回复 |
|---|---|---|---|---|
| INC-20260917-000001 | 快速分类完成；误报（名单结果） | 17.516 秒 | 208 / 0 | 1 条本地摘要，与生成内容一致 |
| INC-20260912-000004 | 五源模型调用后 contract_failed | 153.117 秒 | 458 / 6 | 1 条本地失败说明，与生成内容一致 |

两例正式消息来源均为 threat-analysis-delivery/fixed-summary，其流由本地程序生成，无外部模型请求；快分类内层模型也未调用。快速路径保留 1 条命中及 414 条引用；完整路径没有伪造结论。最终版本的快速会话第二轮回答正常，来源恢复 local-qwen，无工具调用或旧摘要重复。

Chromium 核验快速摘要位于正常对话正文，默认无需展开工具；页面刷新后仍可见，保存状态显示待接入；完整失败说明也在正文可见，刷新后保留。请求通过 Runtime API 提交，浏览器仅核验显示及刷新，不声称覆盖浏览器输入全链路。

项目与工具链验证：3 项 Node 回归、6 项 Python 投影/适配回归、六个评测消费者的 24 项接受/拒绝检查及两份实际 Session 检查通过；仓库和 Experiment 合同通过，六例计划 dry-run 可解析。消费者改为检查正式助手消息、固定输出来源及逐字一致，拒绝只有工具输出、模型改写或缺失回复。原算法未变，本轮未重复算法全集。覆盖 PA-03、PA-06、PA-07、PA-08 的局部交付行为。

Experiment 结论为 continue：本轮支持正常对话交付和续聊恢复；不证明名单结论正确，也没有新的完整研判成功证据。保存 MCP 尚未提供，无远端保存或下载 URL。复用本地实例，不代表独立实例或 Research Release 已复现。

## 校验与结果交付分离（2026-09-28）

[本轮证据](evaluation/evidence/validation-delivery-separation-observation.json)记录代码摘要、实例镜像、两个新 Session、原始结果一致性和网页观察。严格校验器及内层提示词未修改，仍保留首个校验错误，不声称已经穷尽全部问题。

- INC-20260912-000004：run-583de395-f803-425b-bc11-d248a27ee3b6，约 174 秒，458 次 MCP、6 次失败。模型原始判断为真实告警，同一证据路径仍无法解析，validation.status=failed。执行状态为 completed，result 与 model-analysis-output.json 逐值一致；summary.json、summary.md 和 report.html 已生成，未生成只允许校验通过后产生的 forced-analysis-output.json。
- 工具后只有一条正式助手消息，逐字等于程序 Markdown，由 threat-analysis-delivery/fixed-summary 交付。浏览器显示摘要、真实告警及“模型结论，校验未通过”；刷新后仍存在。新 Session 的导出轨迹包含更新后的 Preset。
- INC-20260917-000001：run-51793bef-598e-403d-8c86-5f108ac7d6ac，约 20.5 秒，208 次 MCP、无失败；仍为快速分类、llm_invoked=false，validation.status=not_applicable_fast_classification，1 条命中、414 条引用。正式回复与程序摘要一致。
- 用户原失败 Run run-4c7b2324-414f-45a5-adc9-b4415b224c2e 只读重放可生成含失败提示的摘要和报告，历史文件不改写。两个新会话均通过当前 Agent evaluation.md 中对应检查。
- 新增失败回归先复现阻断与模板异常，再修正；8 项交付/入口测试、178 项原算法测试、3 项本地适配器测试通过。仓库及 Experiment 校验、评估 dry-run、六段评估脚本解析和本次文档链接检查通过。

采用交付与校验分离的行为；本轮证明的是失败结果可明确展示，不是证据引用已正确。字段类型不适用模板时展示字段原文；无法解析 JSON 对象或请求失败仍不补造结论。保存 MCP 未接入。本轮复用本地实例，不代表独立实例或 Research Release 复现。

## 存储文案与接口探查（2026-09-28）

按用户要求统一为“摘要存储 / 报告存储 / 报告下载”，共享模板同时影响 Markdown 与 HTML。当前实例新进程只读重渲染用户运行，两种输出均已确认；8 项交付/入口回归通过。报告 MCP 的工具目录与只读查询可用，但下载 URL 和保存成功响应仍未知，详见[只读探查记录](evaluation/evidence/persistence-mcp-probe.md)。本轮未写入远端，也未将存储占位改为成功状态；不声称已完成存储接入。涉及 PA-03、PA-07，网页新交互未复测。

## 网页隐藏校验提示（2026-09-28）

按用户要求，采用仅在完整报告中渲染“校验提示”的调整；假设是网页摘要不再显示该字段，同时 JSON 校验记录、HTML 报告警告和校验失败标记不丢失。修改现有警告回归先复现失败，调整模板后 8 项交付/入口测试通过。当前容器新 Python 进程使用合成警告输入确认挂载模板的 Markdown 不含该字段、HTML 与摘要 JSON 仍保留警告。涉及 PA-03、PA-07；没有重新调用模型、MCP 或进行网页交互，未改写历史结果。此项局部调整采用，不扩大为研判准确性结论。存储接口后续等待条件见 Agent definition.md。


## 同步主分支后的接入验证（2026-09-28）

工作分支合入远程 main 的 159d8d2，恢复同步前本地工作并解决冲突；备份 stash 保留，未提交或推送。按新主分支将 Agent 定义并入 evaluation.md，六个用例改用新评测格式，移除已退出工具链的 check_scripts 消费者。34 个 Candidate 文件与同步前备份一致，未调整取证、分类、融合、提示词或交付算法。

[同步观察](evaluation/evidence/main-sync-observation.json)记录源码、镜像及两条真实路径。新镜像构建成功，本地 threat-analysis 实例已替换启动并保留原 HOME；浏览器入口仍通过 `runtime/adapters/dsh-container/dsh-dev url threat-analysis` 获取。

- 快速路径 INC-20260917-000001：31.494 秒，208 次 MCP、0 次失败；完成快速分类，内层模型未调用，工具后只有一条本地固定助手回复，内容逐字等于生成摘要。Chromium 核验摘要及存储占位在刷新前后可见；该次请求通过 Runtime API 提交。
- 完整路径 INC-20260912-000004：260.652 秒，458 次 MCP、6 次失败，模型请求约 97.5 秒；通过独立评测实例的网页输入。模型原始结论为真实告警，证据路径无法解析，validation.status=failed，但执行状态 completed；结果原文与冻结输入摘要保持一致，摘要与 HTML 报告均生成，正式助手回复逐字等于程序摘要。该结果不证明模型证据正确。
- 独立浏览器 [Run](runs/run-c2eca146-bfea-4a86-be40-1ed879ec78dc/report.md) 在完整研判后以 identity-drift 停止，第二例未执行，结论为 inconclusive。失败截图显示完整摘要已交付；不能据此宣称新主分支的独立评测链通过。失败 Run 保留，不覆盖历史记录。

项目与工具链：8 项 Python 适配/交付、178 项原算法、3 项 Node 交付、72 项 dsh-dev、53 项 validator 测试，以及评测公共模块测试通过；仓库与 Experiment 校验、两例 dry-run 通过。首次校验暴露定义文件重复，合并为 evaluation.md 后通过。涉及 PA-03、PA-06、PA-07、PA-08、PA-10 的局部验证。评测身份问题仍需定位，Decision 为 continue；没有 Research Release 复现。本轮未调用存储 MCP。

## 报告存储接入与耗时核查（2026-09-28）

当前报告 MCP 已接入，SOC 回写 MCP 仍未提供；边界、输入和产物以 [Agent 评估定义](../../../agents/threat-analysis/evaluation.md#摘要报告与保存接口) 为准。[本轮观察](evaluation/evidence/storage-and-latency-observation.md)记录慢调用根因、配置依赖、真实两路径、下载逐字节核对及浏览器检查。快速与完整研判分别用时 24.518 / 136.626 秒，均保存 HTML 并返回实际下载链接；摘要不发送到该服务。本次未优化取证耗时。完整结果仍校验 failed，不表示证据正确。

16 项 Python、3 项 Node 和仓库/Experiment 校验通过。采用报告接入和本地回写数据生成，Decision 保持 continue；SOC 回写、配置进一步归并、服务端错误根因和模型证据正确性仍未解决。本轮只证明对应 PA-03、PA-06、PA-07、PA-08、PA-10 的局部行为，不替代独立评测链或 Research Release 复现。

## 配置归并（2026-09-28）

配置当前事实见 [Agent 配置入口](../../../agents/threat-analysis/evaluation.md#配置入口)。先修改调用边界测试，旧实现出现 6 项预期失败；归并后 16 项 Python 测试、3 项 Node 插件测试通过，覆盖配置模型名称实际传入、快速路径不调用内层模型、缺失模型配置、报告失败与正式交付。仓库与 Experiment 合同校验、git diff --check 通过。容器内使用 DSH 原生 entryListSchema 验证 YAML 引用、共享连接和目录存在，通过；实例重启后匿名网页请求返回 401，证明服务响应但不代表登录及研判成功。

本轮未发起真实事件、模型或报告保存调用，也未执行登录后的网页端到端测试；已有运行目录未清理。保留当前两层模型选择，未修改取证、融合、提示词、校验或底层通信协议；未完成 DSH 原生 MCP/内层模型客户端接管，未做 Research Release 复现。


## 当前模块整理（2026-09-28）

将最终取证入口及其实际依赖合入 evidence_collection.py；领域投影、五源合同和输入精简分别只保留一个无验证版本后缀的模块。模型调用改为 model_inference.py，去除未使用的独立模型 CLI、环境变量读取和默认模型。删除旧入口、旧图构造与旧研判目标解析；进一步确认旧告警切片和初始证据选择也没有当前消费者，随之删除。当前模块职责唯一维护在 [Agent 代码入口](../../../agents/threat-analysis/evaluation.md#当前代码入口)。

必要的分页、台账、图摘要和登录聚合函数保留。登录字段保留原字符串语义，避免合并时错误使用会 strip 的实体字段转换。调用者、测试与错误文案同步改名；新取证 manifest 的内部 schema_version 从验证时代标识改为 1.0，与当前智能体结果标识一致，不改已有产物。提示词、名单规则、五源融合算法、模型参数与 MCP 配置未改动。Python 模块从 18 个减至 13 个，代码约减少 3200 行。

比较基线是本轮整理前的工作树（Git HEAD 159d8d2，dirty），临时副本位于 /tmp/threat-code-baseline-13_fow7k；该临时副本不作为部署依赖或长期版本来源。基线 178 项流程测试通过。整理后流程测试 126 项、DSH 交付与存储测试 16 项、原生工具 Node 测试 3 项通过。删去的 52 项只覆盖已移除的旧实现：旧投影 20、旧合同 9、旧目标解析 6、旧图构造 10、旧取证规划 3、旧活动切片和初始证据选择 4；登录聚合、台账及截断分页测试迁入当前模块测试，没有删除当前流程断言。

用相同测试输入分别执行基线与整理后代码，记录分类、投影、精简、完整度计算、模型请求和五源冻结函数返回值：34 组测试中的 56 次返回值一致，仅归一化运行时 queried_at，并映射改名前后的测试标识。归一化内容 SHA-256：7a4562787fca86745b40d863cb882741912a66a6d6ee688707640c90d23e2b51。临时比较数据保存在基线目录中，固定输入及长期回归断言仍由 tests/experiments/threat-analysis 维护。

项目与工具链验证：现有 threat-analysis 容器在新 Python 进程中从 /opt/dsh-managed/threat-analysis 加载新模块，执行同一批 142 项 Python 测试通过；真实挂载源指向本 Experiment candidate。Node 3 项、仓库及 Experiment 合同校验通过。宿主默认 Python 缺少 PyYAML，系统 Python 缺少 tomli；使用 PYTHONPATH=/usr/lib/python3/dist-packages python3 复用现有依赖后校验通过，未更改项目依赖。git diff --check 通过。

本轮只支持模块整理未改变已覆盖的确定性行为；未调用真实 MCP 或模型，未新增网页端到端研判，也没有创建 Research Release。历史 Run、迁移来源和既有产物保持原样。


## 2026-09-28 摘要展示收敛

按用户提供的字段清单修改 result_delivery.py；当前展示口径统一维护在 agents/threat-analysis/evaluation.md 的“摘要、报告与保存接口”。详细研判字段仅进入报告，报告移除校验提示和警告正文；JSON 校验数据、报告中的失败状态与错误、快速分类展示和存储协议保持原行为。摘要对原始主张或其他发现的异常结构按文字展示，详细字段异常不再使摘要回退为完整原文。

项目与工具链验证（PA-07、PA-08 的局部范围）：宿主 16 项交付／存储 Python 测试、3 项 Node 插件测试通过；当前 threat-analysis 容器挂载源指向本 candidate，在新 Python 进程执行相同 16 项测试通过。Experiment 合同校验和 git diff --check 通过。

Experiment Evaluation：固定输入确认摘要仅包含约定分组和字段，报告仍有事实、反向证据和引用明细但无校验警告，JSON 保留原校验状态；覆盖校验 passed、passed_with_warnings、failed，以及异常字段和快速路径。未调用真实 MCP、模型或上传报告，未进行浏览器端到端验证；已有摘要和已上传报告不会被改写。未创建 Research Release。


## 2026-09-28 报告校验字段展示修正

更新已有测试后先复现校验失败报告仍含校验字段的问题；删除共用报告渲染中的校验失败展示分支，并更新交付落盘断言。宿主 16 项交付／存储测试通过；当前 threat-analysis 容器的新 Python 进程覆盖两条路由与四种校验状态共 8 种组合，确认 Markdown 和 HTML 不含校验字段及测试错误／警告文本，summary JSON 保留 validation。未调用真实 MCP、模型、报告上传或浏览器端到端流程；旧报告不改写。


## SOC 认领及研判回写接入（2026-09-28）

沿用当前 Experiment；开发基线 HEAD 为 `159d8d2721dd0964e4247b2eeafe82f9abca8f77`，工作树 dirty，当前 Candidate 未提交。容器 threat-analysis 使用镜像 `sha256:00e772d789a3a3cb64deadcdc31b6ecedb0b69e148b52a8ee90f6aae8398ee08`，只读挂载本仓库 managed 目录。通过 DSH 原生 entryListSchema 读取现有 patch，解析环境引用后，在容器新 Python 进程调用实际 dsh_runner；没有重建镜像或修改模型选择。当前接口职责见 [Agent 评估](../../../agents/threat-analysis/evaluation.md#摘要报告与保存接口)。

| 观察 | 快速路径 | 完整路径 |
| --- | --- | --- |
| 事件 | INC-20260917-000001 | INC-20260912-000004 |
| 运行 ID | run-421a48dc-864b-4819-9031-34aeda776633 | run-9461b759-64b9-47f9-bba9-c49412185ad8 |
| SOC judgementId | JDG-2104770524388077569 | JDG-2104770754047193089 |
| 工具耗时 | 16.456 秒 | 143.683 秒 |
| 取证 MCP | 208 次 | 458 次，6 次失败 |
| 内层模型 | 未调用 | 请求配置 Qwen3.6-27B，实际响应 Qwen3.8-27B；SOC 按响应值保存 |
| 执行及校验 | completed / not_applicable_fast_classification | completed / passed_with_warnings，4 条证据值不匹配警告 |
| SOC / persistence | 均保存成功 | 均保存成功 |
| HTML UTF-8 大小 | 30717 字节 | 9407 字节 |
| SOC 摘要长度 | 63 Unicode 码点 | 319 Unicode 码点 |

两次都通过 SOC 历史查询确认 DONE，summary、resultJson、validationStatus 和 reportBytes 与请求一致；完整路径模型名与实际响应一致。两份 persistence 下载文件与本地 report.html、SOC 请求中的 reportHtml 逐字节相等。SOC 回写也返回 reportUrl，但网页仍只使用 persistence downloadUrl。完整路径摘要／报告不含程序生成的校验字段，JSON 保留全部警告；该结果不证明证据值或业务结论正确。

快速路径使用原 judgementId、runId、body 再次回写，服务返回 replayed=true；新响应保存在运行目录的 retry-686bf581-1465-4f73-a453-7057a19eba0a，不改写原始响应，不重复取证或模型调用。上述原始证据位于容器 `$DSH_HOME/threat-analysis/<run_id>/`，包括 soc-claim、soc-result 请求／响应、soc-history-readback.json、writeback.json、报告及原始研判文件。

先增加回归后观察到旧实现缺失 SOC 客户端及快速路径错误传空字段；实现后 22 项 Python 交付／存储测试、9 项只读网关测试、3 项 Node 正式交付测试通过。覆盖认领冲突停止执行、真实失败走 fail、可解析校验失败走 result、SOC 字段不可映射仍可保存报告、两端独立失败、下载 URL 来源、大小和摘要限制。仓库及 Experiment 合同校验通过，文档本地链接、Python 语法和工具映射唯一性检查通过。

PA-07／PA-08 的本轮证据证明容器内当前工具加载及真实双存储链路；本轮未重新通过网页输入或核对刷新行为，未在真实 SOC 制造冲突或写入伪造失败；validationStatus=failed 通过模拟回归覆盖，真实完整路径本次为 passed_with_warnings。没有自动调度、自动保存重试或 Research Release 复现。

## 2026-09-28 同步远端主分支并验证新版 DSH

从 `159d8d2721dd0964e4247b2eeafe82f9abca8f77` 快进到 `origin/main` 的 `3b64e7de45e29ba759281aca581ddae1a58b7c00`；两侧均包含本地未提交 Candidate。同步前备份并 stash，恢复时合并验收矩阵和纠错记录的双方内容，没有提交或推送。业务 Python、提示词及正式交付插件与同步前一致。

上游 DSH 升级到 `21638c56315ae6a2b552d6091945d3144c9af32e`（0.1.7-rc.2），需要把 Preset 切换为注册机制、使用镜像内 persona / agent-instructions 模块路径，并删除 Candidate 重复版本锁，统一使用仓库 source.lock.json。来源清单原把全局研判工具误标成 Preset Guard，本轮改为配置组合中核对实际全局插件路径。新镜像构建及隔离装载通过，来源、镜像和观测详情见 [本轮证据](evaluation/evidence/main-sync-20260928.json)。

旧验证卷的受控空 patch 注释与上游不同，旧实例的模块链接缓存也与新版依赖集合不一致，两者均导致首次装载／重启被明确拒绝。独立验证使用新卷；业务实例仅更新已核对等于旧版的受控空 patch，并备份、重建全部指向 /opt/dsh 的生成模块链接。未删除会话、研判记录或用户设置。最终 threat-analysis 已运行新镜像，端口仍为 3085。

项目与工具链验证：仓库 68 项 Python 测试、适配层 107 项 Python 测试及 11 项 Node 测试通过；来源清单修正后另跑相关 15 项测试通过。威胁研判 126 项算法测试、22 项交付／存储测试、3 项 Node 插件测试通过；仓库和 Experiment 合同校验通过。隔离 verify-load 只证明挂载与组合，真实业务另由下列新 Session 验证。

| 观察 | 快速路径 | 完整路径 |
| --- | --- | --- |
| 事件 | INC-20260917-000001 | INC-20260912-000004 |
| 运行 ID | run-a558e0e3-26ea-4a60-8f5b-3d7ff4cc1329 | run-23d047f4-cf39-4441-8387-d4e735cbf022 |
| Turn 耗时（含外层工具选择及交付） | 18.036 秒 | 132.339 秒 |
| 内层模型 | 未调用 | 调用，实际响应 Qwen3.8-27B |
| MCP | 208 次，0 次失败 | 458 次，6 次失败 |
| 执行／校验 | completed / not_applicable_fast_classification | completed / passed_with_warnings，3 条证据值不匹配 |
| SOC 回写／persistence | 均保存成功 | 均保存成功 |
| HTML 大小 | 30717 字节 | 8322 字节 |

两次工具后均只有一条正式助手回复，逐字等于程序生成的 Markdown；最后的 request/header 使用本地 threat-analysis-delivery / fixed-summary，没有外层模型二次生成。两条路径的 SOC reportHtml、本地 report.html 和 persistence 下载文件逐字节相等，summary 长度符合接口限制，网页下载继续使用 persistence URL。浏览器打开两个会话并刷新后，摘要、保存状态与下载链接均可见；页面和报告无校验字段，JSON 保留校验记录。输入由 Runtime API 提交，本轮没有通过浏览器键盘输入事件，也没有重跑文件夹创建交互。

完整路径 6 次失败均为 get_detect_alert_by_alert_id，和同步前保存的 run-9461b759-64b9-47f9-bba9-c49412185ad8 相同；该基线和本轮均为 395 次 success_with_data、42 次 success_empty、15 次 truncated、6 次 failed。模型证据值不匹配也是既有类型问题，本轮不据此宣称证据正确。两例支持本次升级未破坏已覆盖的取证、交付、双存储和网页显示；没有覆盖全部事件、全部交互或 Research Release 复现。原始业务产物仍位于容器 $DSH_HOME/threat-analysis/<run_id>/，会话可通过证据中的 Session ID 导出。
