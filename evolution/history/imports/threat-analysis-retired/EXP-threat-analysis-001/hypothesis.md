# 迁移假设

保留现有固定 Python 流程，通过 DSH 原生工具调用，可以在新 Session 中完成事件 ID 到研判结果的链路，并且不向研判模型泄露审计包、人工标签或既有结论。来源与必要适配见 [migration.md](migration.md)，评估口径见 [evaluation.md](../../../agents/threat-analysis/evaluation.md)。

实施顺序为依赖闭包迁入、最小工具与 Preset 接入、确定性回归、真实 DSH Session 评估。涉及 PA-03、PA-04、PA-05、PA-06、PA-08、PA-09、PA-10。静态通过不替代真实运行。若缺少连接配置或契约拒绝结果，如实记录，不放宽契约。

## 运行方式

运行资产全部位于本仓库的 [candidate/](candidate/)：`harness.yaml` 声明装载合同，镜像条件由仓库统一的 `runtime/adapters/dsh-container/source.lock.json` 锁定，`dsh/presets/` 保存 DSH 身份，`dsh/workspace/` 保存业务工作区，`dsh/managed/` 保存工具插件、Python 取证融合代码、MCP 工具目录和[完整研判提示词](candidate/dsh/managed/threat-analysis/prompts/threat-analysis-system.txt)。`agents/threat-analysis/` 是当前业务资料与评估入口，不能单独作为运行制品。

在另一台机器运行时，携带本仓库及上述资产，准备 Docker 和锁定的 DSH 镜像，再注入下述环境变量。无需原验证项目、其 `.local/` 目录或 Python 环境，也不需要迁移旧实例 HOME。凭据由部署环境独立提供，不从原项目文件读取；现有启动器、Docker/DSH Runtime 和 MCP、模型服务仍是运行条件。源码、镜像及实例的关系见[容器适配说明](../../../runtime/adapters/dsh-container/README.md)。

在可信宿主会话注入 `SOC_MCP_BASE_URL`（网关根地址）、`LOCAL_LLM_BASE_URL`（兼容 OpenAI 的 Qwen `/v1` 地址）、`LOCAL_LLM_API_KEY` 和 `DEEPSEEK_API_KEY`。后者供 DSH 默认 Provider 初始化，实际本实验选择 local-qwen。不要把这些值写入 candidate、Run 或普通日志。

```bash
# 首次构建包含 Python 标准库和时区数据库的 DSH 镜像
bash runtime/adapters/dsh-container/build-image.sh --source EXP-threat-analysis-001
# 解析来源与评估计划
runtime/adapters/dsh-container/dsh-eval --source experiment:EXP-threat-analysis-001 --dry-run
# 快速评估档（U-REPLAY-0917；实际路由取决于实时名单）；每次生成独立 Run
runtime/adapters/dsh-container/dsh-eval --source experiment:EXP-threat-analysis-001 --timeout-seconds 900
# 全量六例比较（含完整五源链及场景复核）
runtime/adapters/dsh-container/dsh-eval --source experiment:EXP-threat-analysis-001 --mode full --timeout-seconds 900
# 交互运行；在 Web 中选择 /work/harness/workspace 后输入事件 ID
runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-threat-analysis-001 --mode eval --name threat-analysis
# 启动成功后获取网页地址；在网页选择已有工作区，不新建目录
runtime/adapters/dsh-container/dsh-dev url threat-analysis
```

工具内部原始取证、冻结输入、模型响应及契约校验写入实例 HOME 的 `threat-analysis/run-<UUIDv4>/`；DSH 工具响应包含此 run_id。`dsh-eval` 的正式比较记录保存在本 Experiment 的 `runs/`。快速分类中的 `llm_invoked=false` 仅指内部研判模型，外层 DSH 仍使用模型完成工具调用。

## 快速输出契约补全验证（2026-09-24）

本次继续补齐迁入链路原已约定的输出合同。在 DSH 外层 [agent.cordis.yml](candidate/dsh/presets/threat-analysis/agent.cordis.yml) 明确快速分类 `result` 的字段及来源枚举，要求完整保留命中证据引用；五源内层提示词仍只用于完整研判。快速结果由固定代码产生，外层 Qwen 负责调用和原样交付，不增加一次内层模型研判。

假设是将字段和分支明确写入外层提示词后，新的 Qwen Session 能按既有快速合同交付，并保留完整研判和失败分支。对照为此前三例 DSH Run；此次按 Agent evaluation.md 扩充至原六个事件，逐例检查实际名单路由、完整 JSON 与工具一致、快速字段及来源/结论一致性，并从 Session 事件时间记录总耗时与工具耗时。若实时名单发生变化，按本轮实际命中记录，不能以历史命中代替实时验证。

原报告所用内层提示词不处理快速分类；旧快速输出本身已经包含约定字段。因此此次是补全提示词约束和验证覆盖，不把尚未复现的格式失败写成已确认根因。模型、MCP 和业务逻辑保持现有配置；不改数据库、接口、前端或权限，不增加依赖到运行资产。

## 快速研判交付修正（2026-09-27）

按用户确认方案继续迁移实验：只修改外层 Preset 的分支交付规则与 Agent 评测消费者。假设为快速分类成功时最终答复与工具 result 逐值一致，全部命中及 evidence_refs 不丢失；五源和失败分支保持完整工具 JSON。用 INC-20260917-000001 在新 Session 验证；若真实数据不再快速命中或模型改写结果，记录失败，不扩大结论。涉及 PA-07、PA-08、PA-09、PA-10，不调整分类、融合及证据契约。

## 程序直接交付与保存接口占位（2026-09-27）

同一迁移实验继续验证：使用 DSH 原生 concludeTurn 与工具输出渲染，在快速分类成功后直接交付 result，避免外层模型再次生成长 JSON。完整运行信息放在工具结果元数据，网页可见内容仅为 result。只改变快速成功分支；分类算法、五源推理和失败交付保持原逻辑。对照为本地 Session 中工具返回后仍等待约 326 秒的观察；新 Session 检查本轮正常完成、工具后无 assistant/message、结果及全部引用可见。涉及 PA-07、PA-08、PA-09、PA-10。

用户要求的摘要与报告 MCP 先占位，接口约定及当前状态集中在 [Agent 定义](../../../agents/threat-analysis/evaluation.md#摘要报告与保存接口)。本轮不模拟远端保存。

## 摘要与 HTML 报告直接交付（2026-09-28）

用户已确认两条路径的摘要与报告设计，继续在本迁移 Experiment 实施。假设：固定代码能从原始结果生成完整字段的摘要 JSON、网页 Markdown 与 HTML 报告，借助 DSH keyed tool view 默认展开摘要；两条路径均 concludeTurn，省去工具后的外层模型生成。MCP 保存接口继续未配置，不产生外部写入或虚假 URL。不改变分类、融合、模型提示词与证据契约。

实施顺序：先补投影、转义、全量引用、失败状态和终止语义测试；再实现固定模板与浏览器插件；最后用新 DSH 进程和新 Session 验证快速及完整路径。使用 DSH 原生客户端模块和 MarkdownText，不修改 Runtime 或重建镜像。涉及 PA-03、PA-06、PA-07、PA-08。若实时输入无法形成完整结论，保留失败，使用已保存正式结果的独立回放只验证格式，不将回放写成真实 MCP 端到端成功。比较口径见 Agent evaluation.md。

## 正式助手回复修正（2026-09-28）

用户指出结果只存在于工具区域，不符合正常对话。继续本实验：移除工具网页组件和 concludeTurn，使用 DSH 原生 agent/request 与本地 LLM 适配器，将已生成的 Markdown 作为正式助手消息持久化，不向外部模型发起第二次生成。工具区仅显示状态和运行 ID。快速、完整及失败共用该交付路径，不改算法、摘要模板、报告和输出契约。

比较检查正式回复与 delivery.markdown 逐字一致、来源为本地固定输出、网页默认可见及刷新恢复、下一轮继续使用原模型；新增会话隔离与缺失交付数据测试。沿用现有本地实例，新进程装载 candidate，不重建镜像。涉及 PA-03、PA-06、PA-07、PA-08；不以局部交付验证代替研判正确性或 Research Release 复现。

## 校验与结果交付分离（2026-09-28）

按用户确认方案继续本实验，涉及 PA-03、PA-06、PA-07、PA-08。严格输出契约保持不变；假设为已有模型 JSON 的校验失败不会阻断阅读内容，且正式回复、摘要及报告能明确区分模型判断与校验状态。修改 runner、阅读视图、外层 Preset 及评估消费者；不修改研判规则、内层提示词或原始历史运行。以缺失/错误类型字段、无可解析对象和正常快速分类作回归，并对用户失败 Run 只读重放、在当前 DSH 实例中新建会话核验。不可解析内容不补造结果，保存 MCP 仍未配置。

## 存储接入与配置核对（2026-09-28）

继续本迁移实验，Baseline 仍为 none:first-experiment；本轮开始时 Git 为 159d8d2，工作树包含尚未提交的迁移资产。涉及 PA-03、PA-06、PA-07、PA-08、PA-10。假设：程序可在不新增模型生成、不改变分类与融合的前提下，在本地生成符合 SOC 修订字段的 JSON，将 HTML 保存到报告 MCP，并在正式助手回复提供真实下载链接；存储失败独立于研判状态。

实施范围：新增 managed/threat-analysis/result_storage.py；修改 dsh_runner.py、result_delivery.py、threat-analysis.mjs 与 patch 的存储配置；补 tests/experiments/test_threat_storage.py。先覆盖协议错误、回写字段、Unicode/UTF-8 上限及报告保存失败，再接入；运行 Python/Node 回归，真实保存并回读下载，在新 DSH Session 验证快速与完整路径。工具地址集中于 DSH patch，不新增用户必须导出的存储环境变量。网页摘要保留既定内容，SOC 的短 summary 单独生成，不截断原始 reasoning_summary 或报告。

本轮只分析慢调用及配置依赖，不调整名单决策、取证顺序、并发或模型算法。SOC claim/result/fail 工具尚在开发，通用 persistence 保存不表示 SOC 状态回写；不接入 pending 或自动认领。报告接口错误或报告超限时明确报告保存失败，保留本地结果；SOC 字段无法映射时只记录本地回写数据构建错误。若无法完成真实下载或 DSH 可见性验证，记录限制，不宣称链路已完成。

接口边界澄清：persistence MCP 仅用于报告文件和下载 URL；SOC 回写接口尚未提供。本次仅在本地生成 writeback.json，撤回将该 JSON 写入通用存储的计划。报告保存失败与研判状态分开记录。

## 网页摘要校验字段遗漏修正（2026-09-28）

继续当前 Experiment，涉及 PA-08。之前只隐藏 warnings，failed 分支及旧测试仍要求网页展示校验问题。按用户已确认要求，将 failed 的校验说明限制到报告视图，并同步 Preset 和当前评估口径。比较通过、警告、失败及结构异常结果的摘要投影；确认 JSON 与报告保留校验、原始结果不变。使用已有真实失败结果在容器新 Python 进程重放展示层，不重复 MCP 取证或模型推理。

## 配置归并（2026-09-28）

按用户要求先归并容易重复的配置，涉及 PA-07、PA-08。假设：DSH patch 统一提供内层模型选择、共享模型连接、SOC 网关与目录映射、报告连接，可以避免修改多个代码位置，且不改变快速分流和完整研判。先修改调用边界测试确认旧实现失败，再修改插件配置传递与 Python 消费者，最后执行回归、原生 YAML 装载及实例重启检查。配置现状集中记录于 Agent evaluation.md 的“配置入口”。保留两层模型选择和现有协议；不接入尚未提供的 SOC 回写，不新增真实研判以保持用户刚清理的环境。


## 2026-09-28 模块整理

假设：保留当前取证入口的实际依赖、移除旧流程并改用职责命名后，固定输入的分类、五源融合、模型请求与契约行为保持一致。比较整理前后的固定输入输出及现有回归测试，并在容器新 Python 进程核对实际装载；发现行为差异时先定位，不以放宽契约通过验证。此次不调整提示词、研判算法和 MCP 或模型配置。


## 2026-09-28 摘要展示收敛

按用户给定字段收敛完整研判网页摘要，报告移除校验警告展示。沿用本 Experiment 基线引用，比较修改前工作树；涉及 PA-07、PA-08。假设：固定生成代码可稳定输出约定摘要，同时保留报告详情和 JSON 校验数据。复用交付与存储测试，覆盖格式异常、校验通过／警告／失败及快速路径，并在当前容器新进程验证装载；不调用外部 MCP 或模型。


## 2026-09-28 报告校验字段展示修正

本次修正前的 candidate 在校验失败时仍展示状态、错误及说明。假设：移除 result_delivery.py 的该展示分支，可使报告与摘要都不展示校验信息，同时保持 JSON validation、结论和存储协议不变。沿用本 Experiment 的 Baseline；范围为 PA-07、PA-08 的输出投影。


## 2026-09-28 SOC 研判回写接入

继续当前 Experiment（Baseline 沿用既有引用），涉及 PA-07、PA-08。假设：复用现有 MCP 网关，按真实工具定义增加认领、结果和失败回写，可独立完成 SOC 数据保存与 persistence 报告下载，不改变研判算法、冻结输入或正式回复方式。当前接口口径以 [Agent 评估](../../../agents/threat-analysis/evaluation.md#摘要报告与保存接口) 为唯一维护入口，取代上文尚未提供接口的历史限制。

修改范围为 result_storage.py、dsh_runner.py、认领失败的展示、三个工具映射与直接相关回归。比较快速／完整结果字段、校验失败仍回写结果、认领冲突不取证、两端独立失败和 URL 来源；在现有容器运行真实两路径并逐字节核对报告，使用同一请求核对 SOC 幂等回放。失败回写和冲突用模拟响应验证，不人为破坏真实服务或给真实事件写入伪造失败。工具成功不代表研判业务正确；本轮不开发 SOC 自动触发、任务调度或前端重试按钮，不创建 Research Release。


## 2026-09-28 同步远端主分支并验证新版 DSH

比较同步前 `git:159d8d2721dd0964e4247b2eeafe82f9abca8f77` 的本地 dirty Candidate 与同步 `origin/main` 后的同一 Candidate；本轮涉及 PA-05、PA-06、PA-08。假设：按上游统一版本锁和 Preset 注册机制适配后，DSH 升级不改变快速／完整研判、固定摘要交付、SOC 回写及 persistence 下载行为。保留既有业务算法与测试口径，仅修改直接受 Runtime 升级影响的资产；运行已有确定性回归、实际装载、新 Session 两路径及网页显示检查。真实取证与模型响应可能变化，因此不以结论逐字相同判断兼容性，也不将接口成功当作业务判断正确。
