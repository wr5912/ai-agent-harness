# 报告接入与耗时核查（2026-09-28）

本次在 Git 159d8d2 的未提交迁移资产上继续 EXP-threat-analysis-001。当前行为和评估口径以 agents/threat-analysis/evaluation.md 为准；本文件记录观察，不维护另一份接口规范。

## 用户慢调用

Session session-1500ceb3-0e6e-4d9d-b4e6-81c5d5c66d08；Run run-c8deb835-9459-44cd-98bd-9c08ee380fcf；事件 INC-20260917-000001。

总耗时 108.321 秒，Session 统计模型耗时 2.509 秒，工具耗时 105.242 秒；工具结果至回合结束约 0.107 秒。route=fast_classification，llm_invoked=false。外层首次模型用于工具路由，结果由本地固定适配器交付，没有内层研判或外层第二次生成。

共 208 次 MCP：1 次事件、205 次逐条关联告警、1 次白名单、1 次情报。告警成功 160 次、失败 45 次，失败响应均为 HTTP 500；告警单次最长 31.038 秒。告警耗时之和 1232.598 秒是 12 worker 并行请求累计值，不能当墙钟时间。白名单 171ms、情报 243ms。代码先完成关联告警查询，再查询名单和分类，因此快路径仍会等待告警。尚无服务端日志，不推断 500 的后端根因。

对照历史同事件 Run run-a927ffba-848e-4e6e-9463-e4a5350360aa 为 208 次调用、零失败，总耗时 31.494 秒。实时服务状态与样本返回不同，不能将此视为本次代码优化收益。本次没有修改取证顺序或分类规则。若后续优化，可先核实批量告警接口是否能保持等价实体覆盖，避免提前返回漏掉黑白名单冲突。

## 配置审查

candidate 已包含代码、提示词、契约与 MCP 工具目录，不运行原验证项目中的文件。仍需要 SOC_MCP_BASE_URL、LOCAL_LLM_BASE_URL、LOCAL_LLM_API_KEY；DEEPSEEK_API_KEY 用于当前 DSH 默认 Provider 初始化。内层模型请求名 Qwen3.6-27B 在 runner 中固定，外层 DSH 使用 Qwen3.8-27B，尚未统一读取 DSH 模型配置。MCP 目录中的资源 ID 依赖当前网关注册，迁移其他环境仍需对应注册或调整目录。

新报告地址放在 DSH patch 的 persistenceUrl，由插件传给子进程，不要求用户额外导出存储环境变量。当前尚不能声称仅配置任意 DSH Provider 即可完成全部研判配置。后续应让内层复用 DSH 的模型选择与凭据解析，再将工具绑定收敛到 DSH 配置；本次不扩大修改运行架构。

## SOC 对接边界

按 issue #102 修订字段生成本地 writeback.json；validationStatus 与 resultJson.validation.status 一致，四种取值保持不变。summary 是独立不超过 500 字的文字，网页结构化摘要保持原设计。超长推理摘要使用固定短概述，原文完整保留。reportHtml 为原始 HTML 字符串。无法映射字段时写本地 writeback-error.json，不阻止报告交付。

SOC claim/result/fail 尚未提供，不发送回写、不更新 SOC 研判状态。快速结果中的 evidence_refs 是实体证据路径（例如 incident.sourceIp 或 alerts 下字段），不能直接当成告警 ID 跳转。后续实际 MCP 提供时仍需核实 model=null、agentVersion、报告存储与 SOC reportHtml 的关系及下载访问约定。

## 新快速路径验证

新实例 threat-analysis-storage-check，Session session-adfffdba-c2bf-4ba8-9136-d54287372e30，Run run-eb7de3c2-6059-4c99-954b-50b94347c5ba。总耗时 24.518 秒，208 次取证调用、1 次失败，快速分类 completed、llm_invoked=false。单次工具调用，随后一条正式助手消息与 delivery.markdown 逐字一致。通过网页相同 Runtime API 提交。

报告保存 ID file-06c18ad5-1f29-4396-bdd7-572a473f3f80，下载 30581 字节，与实例本地 report.html 逐字节相同，SHA-256 7336f260e4e34674957a2a47489e385c0771434eed4b70d346d678d137229e32。本地 writeback.json 的 HTML、原始 result、校验状态均一致，summary 长度 63。摘要存储状态 not_configured；没有远端 JSON 保存调用。

Chromium 打开快速会话确认正式摘要、运行 ID 和实际 HTML 下载链接可见；刷新后仍一致，网页不展示“校验提示”。最初定位器误用事件 ID 作为自动生成标题而超时，核对页面后按实际标题重试成功，此失败不属于产品缺陷。

## 新完整路径验证

原实例 threat-analysis，Session session-4bf56c99-a410-415e-a6e8-b5fe6a3cc54c，Run run-e637a00d-58fb-4bd4-8887-03e30526d1a4。136.626 秒，458 次取证调用、6 次失败；five_source、llm_invoked=true、completed。原始模型证据路径仍无法解析，validation.status=failed；严格校验未放宽，摘要和报告照常生成。正式助手消息逐字等于程序 Markdown。

报告 ID file-b667f5df-8a9b-4cb0-9383-f79b0fa77049，下载 9721 字节，与本地报告逐字节一致，SHA-256 56c346e20483def9af02b90f9193532faf41e00bf354ca99c4653ff2ab5fdb09。summary 长度 231，本地回写数据内外校验状态一致，原始 result 未改写，摘要回写保持待接入。

Chromium 打开上述完整会话，确认正式摘要、运行 ID、摘要存储待接入和实际报告下载链接可见；刷新后仍一致，没有“校验提示”字段。首次按旧标题选中了其他会话，改用本次实际标题后验证通过。

原实例替换启动过程中 Docker 移除容器短暂阻塞，最终完成；原 HOME 保留，端口仍为 3085。独立快速实例使用 3088。两实例使用相同锁定镜像 sha256:00e772d789a3a3cb64deadcdc31b6ecedb0b69e148b52a8ee90f6aae8398ee08，本次没有重建镜像。

完成验证后已停止独立快速实例，保留其 HOME；原 threat-analysis 实例继续提供网页验证。

## 验证与限制

16 项 Python、3 项 Node 测试通过，覆盖不发送摘要、报告失败不丢研判、真实 URL、UTF-8 限额和插件配置传递。仓库及 Experiment 校验通过。无独立 reviewer 工具，完成逐文件自审。未重新执行全量算法评估，也未修复之前独立 dsh-eval 的 identity-drift；不将本轮局部运行验证写成全链工具验收或 Research Release 复现。

## 网页校验字段回归修正（2026-09-28）

用户指出完整摘要仍有“校验状态”“校验问题”。此前浏览器检查仅断言没有“校验提示”，甚至以“校验未通过”判断摘要存在，验证范围错误，不能证明所有校验信息已隐藏。根因是 failed 分支未受 report 条件限制，旧回归断言仍要求摘要展示失败详情。

先修改回归测试，复现三个子用例失败；将失败校验区块限定为 report 后，同步修正 runner 的旧断言并增加通过、警告、失败覆盖。16 项 Python、3 项 Node 通过，仓库及 Experiment 校验通过。在运行中的 threat-analysis 容器新 Python 进程读取此前 run-e637a00d-58fb-4bd4-8887-03e30526d1a4/result.json，重新投影后摘要无三个校验字段，报告与 JSON 保留 failed 和错误，原始结果未修改。容器与宿主 result_delivery.py SHA-256 均为 5c541387bfe05ae7737630fd0d78b7e63663f8ed9870b4f4bcb17cca0cfd017c。

每次工具调用启动新 Python 进程，代码由 candidate 挂载，不需要重建镜像。历史会话和已保存报告不重写；本次未重新发起真实模型/MCP 端到端会话，不声称已完成修正后新会话的浏览器验证。
