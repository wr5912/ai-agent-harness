# EXP-015 观察

2026-10-10。以 `git:43210919dae956437347b5cf81a6f981bb5eba66` 中 EXP-014 的 Candidate 为基线，仅把巡检 Skill、Guard、角色工具矩阵、工作区指令及相关测试改为现用三工具合同；业务 Case 的输入和预期仍由 [`evaluation.md`](../../../../agents/security-operations-expert/evaluation.md) 维护。原 EXP-014 的运行实例挂载另一个 checkout，本次在当前仓库来源启动隔离实例 `security-operations-expert-inspection015`。标准 DSH 镜像 ID 为 `sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc`，构建指纹为 `sha256:54f335ef05ac817d2d40a34186cf4e9573a6800979520da8ec65b1bfc82e9eae`；评测 Run 已核对容器镜像身份，实例的 Candidate 挂载为只读。实例 HOME 内配置 MCP 代理 Token 后重启，新 Session 发现 `list_executable_inspections`、`start_inspection`、`get_inspection_result`，目录返回五个可执行模板。Token 未写入 Candidate 或 Run。

| Run | 已选 Case | 结果与原始证据 |
| --- | --- | --- |
| [`run-ce7a63cc-17a4-41db-9ea6-ac95044e67fe`](../runs/run-ce7a63cc-17a4-41db-9ea6-ac95044e67fe/report.md) | U-INS-002 | 通过。新 Session 只查询目录，未发起巡检。 |
| [`run-7180cf84-d36f-4b8e-a140-d20511955120`](../runs/run-7180cf84-d36f-4b8e-a140-d20511955120/report.md) | U-INS-001、007 | U-INS-001 通过：按目录发起一次常规巡检，再按同一 `runId` 取得服务报告；报告显示应检查 50 台、在线 36 台、离线 14 台、异常 20 台，状态为 `PARTIAL`、结论为 `ABNORMAL`，回答原样给出服务提供的报告地址。U-INS-007 的两轮实际轨迹复用同一 `runId` 且第二轮只查询结果，但评审模型多返回一个无关字段，旧解析器将其记为 `inconclusive`；保留原 Run。 |
| [`run-9ab7cd25-42cf-451c-a0cb-c468b81243e8`](../runs/run-9ab7cd25-42cf-451c-a0cb-c468b81243e8/report.md) | U-INS-004、005、006、007 | 004 通过：如实说明无法创建任务；005 失败：服务缺少十分钟周期巡检任务创建接口，Agent 未伪称成功；006 通过其指定资产发起合同，实际按 `A-001` 范围发起一次运行，但结果查询两次返回服务端 `JSONArray` 转 `JSONObject` 错误，未取得资产结果；007 通过：第二轮只用同一 `runId` 续查，取得服务报告，未重复发起。 |

`U-INS-007` 解析失败属于评测工具误拒绝有效结论：公共判分解析器现只读取并校验必需的 `verdict`、`reason`，针对性测试通过；新 Run 重新验证了该 Case。所有逐 Case 自动判定均由与被测 Agent 相同的模型路由作出，属于研究辅助；上述结论另核对了同一 Session 的工具调用、参数和回执。U-INS-003 与其他业务场景未选，不代表通过。`U-INS-006` 的通过只覆盖指定范围的**发起**，不能写成资产级报告成功。

同一实例的[运行概览快照](evidence/overview-instance-20261010.json)经认证 API 返回 HTTP 200、主会话活动计数非零；主会话累计 14 个、近 24 小时工具调用 25 次、Skill 加载 7 次，采样时活动会话为 0。该 API 把本次评审 Session 也计入主会话，且不能独立证明宿主容器健康或跨实例 Agent 身份。MCP 管理与巡检业务在本实例同时装载。三处 OpenAPI 规范虽可获取，仍未发现预期的 `ai_soc_*` Operation，见 [EXP-014 只读探测](../../EXP-security-operations-expert-014-r8b1bd54e8be7/evaluation/evidence/openapi-spec-probe-20261010.json)；未执行该业务接口调用。

2026-10-11 在同一隔离实例追加真实浏览器试跑：[U-INS-002](evidence/browser-pilot-20261011-f/U-INS-002/checks.json)显示目录回答并只调用 `list_executable_inspections`；[U-INS-007](evidence/browser-pilot-20261011-g/U-INS-007/checks.json)在同一浏览器 Session 完成两轮，第一轮调用一次 `start_inspection`，两轮使用同一 `runId` 查询结果，第二轮未再次发起。[原始工具轨迹](evidence/browser-pilot-20261011-g/U-INS-007/tools.jsonl)与页面回答锚点均已核对。此前的[失败试跑](evidence/browser-pilot-20261011-e/U-INS-002/checks.json)保留原状；评测器原先只把新 ID 当成新 Session，遗漏了页面复用的空 Session，修正后两项通过。试跑使用既有实例及其 HOME，历史版本的判定模型与被测模型同路由，属于补充证据，不是独立实例产生的正式浏览器 Run。

同日[完整页面路径复测](evidence/browser-path-full-20261011-b.json)从实例概览进入 MCP 配置页，再建立浏览器 Session 发起常规巡检并在同一 Session 续查；两轮回答均在页面可见，第二轮没有重新发起。[第一次路径探针](evidence/browser-path-full-20261011.json)的身份字段和服务计数定位有误，保留其失败记录。收窄 `dsh-eval-browser.mjs` 后，[第一次 UI 冒烟](evidence/browser-smoke-20261011/U-INS-002/checks.json)因把中文“新建会话”错写为“新会话”而失败；[修正后冒烟](evidence/browser-smoke-20261011-b/U-INS-002/checks.json)完成一个目标 Preset 与 Workspace 均匹配的新 Session，页面显示非空回答，执行状态为 `completed`、业务 `verdict` 为 `inconclusive`。这些探针失败来自页面假设失配，没有证据指向浏览器引擎不稳定。简化后的浏览器通道不再创建评审 Session，仅检查 UI 链路；业务结论仍依据 API Run 和原始工具回执。上述试跑复用已有实例及 HOME。

随后在不同新 HOME 运行正式浏览器评测：[Run 1](../runs/run-1aa3c04c-8a53-482a-951a-16f06f12f827/report.md)与[Run 2](../runs/run-1d3814b5-b1b1-4812-90a0-74f464ac8218/report.md)均完成 `U-INS-002`，目标 Preset、Workspace、消息发送与非空页面回答通过，执行状态为 `completed`，业务结论保持 `inconclusive`。首次新 HOME 的[失败 Run](../runs/run-64451185-7d80-4186-8bfd-b88aa9f83d1c/report.md)揭示工作区选择器先出现“Add workspace”菜单，再出现路径弹窗；修正该定位后独立驱动试跑通过。[另两次失败 Run](../runs/run-8dfbcf39-1446-41ae-819d-cb0edc326f98/report.md)、[Run](../runs/run-d3a1e3d5-dddc-42a6-9543-e02a3e129924/report.md)仍保留，后一次在执行 Case 前失败，原执行器没有留下足以归因的启动详情；现已增加阶段化失败记录供后续定位。两次正式成功只覆盖新实例的简单 UI 冒烟，完整页面路径仍仅在原实例走通一次。

[新增失败 Run](../runs/run-0631c1d6-4d37-40b3-bb13-9dffd754490c/report.md)保留了阶段化证据：`workspace-connect` 等待工作区选择文本框满 120 秒后超时，尚未执行 Case。证据能定位到首次工作区页面假设或加载路径，不足以判定浏览器引擎故障。浏览器通道继续只承担 UI 冒烟，业务结论以 API Run 为准。

本次证据支持现用巡检合同的新来源装载、目录查询、常规全量巡检及两轮续查，浏览器补充试跑覆盖目录与两轮续查的用户可见回答。巡检服务源码已有 REST 任务创建入口及周期调度类型，当前 MCP 三工具没有创建入口；指定资产结果查询和平台跨实例身份也仍有明确缺口。API 通道的正式 Run 用于研究业务行为，浏览器通道的正式 Run 只用于 UI 冒烟；均不等于平台业务验收，也不证明其他业务场景或 Research Release 可复现。

已找到独立的 `ai-soc-platform` 仓库中 `ai-inspection/ai-inspection-server` 的巡检 MCP 与报告源码，本地拉取的 `master` 参考提交为 `c82287d9cb1f8152a57f0e1a0f0626a5395326e8`。[REST 详情只读对照](evidence/inspection-rest-detail-probe-20261011.json)显示，普通巡检 `runId` 返回 HTTP 200、应用码 200，而上述 `A-001` 运行返回 HTTP 500、应用码 500；错误跨越 MCP 与 REST 详情查询。服务仓库 `docs/validation/2026-10-07-232-inspection-recheck.md` 的历史服务日志把同类数组转对象异常定位到 `InspectionReportHtmlRenderer.hasBaselineReportWithoutConclusion` 第 563 行；本地源码已只对对象型结果检查 `run` 与 `findings`，定向 Maven 测试 5 项通过。该历史栈不能代替本次 `A-001` 的服务端栈。服务仓库 `docs/validation/2026-10-09-inspection-mcp-discover-filter-deployment.md` 记录 232 现用 JAR 摘要 `c63d363d89270d5c0c66ef73d541be22aeb23ef069637ce7289e104be7f5fea1`，发布范围仅为 `server/discover` 过滤器；报告修复没有发布。本轮 SSH 无法认证到 232，未复核现时 JAR，也未执行部署。

本地服务聚合构建 `./mvnw -B -q -pl ai-server -am -DskipTests package` 退出码为 0；`InspectionReportHtmlRenderer.class` 的 SHA-256 为 `0ecb6bca9eea013648f70446205b10d982f6f73199d00d12826ac52323811731`，与本地聚合 JAR 内嵌类一致。以合成旧类作基线演练定向补包，逐条目比对只有该嵌套类内容变化；这不能代替拿到 232 现用 JAR 后的摘要核对和实际发布。Maven 仍输出既有 P3C 内部错误，不能视为 P3C 检查通过。

2026-10-11 21:59 -07:00 再次只读请求上述两个历史 `runId` 的 REST 详情：常规运行 HTTP/业务码均为 200、437915 字节；`A-001` 范围运行 HTTP/业务码均为 500、54 字节。现用服务在这一可复测路径上仍未恢复；本次未创建新的巡检运行。

`U-INS-005` 当次 Run 的输入只写“每 10 分钟”，缺少目标资产 ID；当时服务的固定目标合同不支持 `ALL`。2026-10-11 用户随后明确允许当前绑定的巡检服务创建全量周期任务，当前 Case 已改为“每次执行读取当时资产清单”；旧 Run 保留原判定。服务仓库曾形成 G1 v0.9 与 G2 v0.4 草案，本轮已撤回由我写入该外部仓库的状态和草案文件；其审批、接口开发及发布不再列为本仓库的整改前置项。

后续确认 `@deepseek-ai/dsh-experimental-schedule-bundle` 可在 DSH 会话中创建周期提醒，由每次到期消息触发一次巡检研究；旧 Run 的失败判定保持原状，见 [EXP-017](../../EXP-security-operations-expert-017-r94f3b07e080f/decision.md)。

本地启动前，语音插件的忽略目录 `node_modules` 依据相同 `package-lock.json` 从已有实验工作树复制；该依赖目录未进入 Git，异机复现需按锁文件安装依赖。

评测后已停止并移除隔离实例容器，保留其 HOME 卷以便核对；`docker ps -a` 按该 Compose 项目过滤无残留容器。
