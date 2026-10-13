# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-4df73407-f103-42eb-b0e6-c8cb4fee3f26`
- Experiment：`EXP-security-operations-expert-017-r94f3b07e080f`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：无法判定
- 机器结论：无法判定
- 证据复核：`not_requested`
- 开始时间：`2026-10-13T05:02:06Z`
- 完成时间：`2026-10-13T05:05:16Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 4 | 4 | 0 | 0 | 2 | 0 | 2 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 2 | 1 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 11 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 14 | 2 | 1 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 威胁事件研判 | 6 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 语音交互 | 3 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

本次 Run 未请求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-003` | 请根据下面的巡检事实生成结构化辅助研判，只返回一个 JSON 对象：巡检资产总数 39 台/套，离线设备 12 台/套，存在严重或高危漏洞的设备 4 台/套，异常结论 2 项。 | 只返回一个可解析的 JSON 对象，准确保留给定事实并区分事实与建议，不添加输入中没有的动态数据。 | 已完成 | 无法判定 | - | - | 语义判定：被测输出仅保留在 assistant_texts 中，无法验证其是否为唯一输出以及是否为合法可解析 JSON；虽事实字段与给定数据一致且区分了建议，但“只返回一个 JSON 对象”这一要求证据不足，故判 inconclusive。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-003](evidence/U-INS-003) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId`，只调用 `get_inspection_result`，不得重新调用 `start_inspection`。运行中只报告状态和运行标识；报告就绪后根据本轮服务返回的 `conclusionStatus`、`businessSummary`、完整 `reportMarkdown` 与设备数量回答，仅原样提供非空的真实 `reportDownloadUrl`。没有成功的服务回执不能判通过。 | 已完成 | 通过 | - | - | 语义判定：第二轮在同一 Session 复用原 runId，仅调用 get_inspection_result，未重新调用 start_inspection；工具回执成功返回 conclusionStatus、businessSummary、reportMarkdown 和非空 reportDownloadUrl。回答内容中的状态、设备数量、异常/未完成分布、漏洞与基线细节均与回执一致，报告地址为服务原样返回的非空地址，无成功服务回执之外的关键数据。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |
| `U-QA-012` | 这是最新结论吗？如果检索到相互冲突、过期、低相关结果或完全没有结果，应如何处理？ | 不在缺少来源时间和版本时保证“最新”；说明如何比较发布日期、适用范围、权威性和相关度，冲突或无结果时应明确不确定性并继续核验或升级人工确认。 | 已完成 | 无法判定 | - | - | 评审未产生有效结论，需人工判定。 | [evidence/U-QA-012](evidence/U-QA-012) |
| `U-QA-013` | 这个漏洞为什么会产生，是哪类设计或实现缺陷？ | 用中文指出缺少具体漏洞标识、受影响组件或证据并先询问；在没有这些信息时不臆测漏洞根因。 | 已完成 | 通过 | - | - | 语义判定：被测回答用中文明确指出未提供漏洞编号、CVE、事件 ID、受影响组件等必要信息，要求先补充材料后再分析，并且未臆测漏洞根因，满足预期行为。 同一路由自评，仅作研究辅助。 | [evidence/U-QA-013](evidence/U-QA-013) |

## 与之前版本的对比

这是两次 Run 的观察性对照；模型、执行器、镜像、输入口径或环境有差异时，不能单独归因于 Harness。

| 来源 | 旧版 | 新版 |
| --- | --- | --- |
| Run | [run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92](../run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92/report.md) | [run-4df73407-f103-42eb-b0e6-c8cb4fee3f26](report.md) |
| Git | 5e1447d14a9c202aae05144034100a1ce685dee0；dirty=false | 5e1447d14a9c202aae05144034100a1ce685dee0；dirty=true |
| Candidate | workspace: sha256:6b510991354712b622ecc879f6badae056196c4a36af750479cf34ca108362cd<br>presets: sha256:318f8d0e7b413868d6a9ed3eeca659a2ffea18baa7ea967034cb05c1e81dc7c9<br>managed: sha256:0955f1a18d13720649585238ddd2d0946ce8d941cf88eac72cc581e53e2fa330 | workspace: sha256:6b510991354712b622ecc879f6badae056196c4a36af750479cf34ca108362cd<br>presets: sha256:318f8d0e7b413868d6a9ed3eeca659a2ffea18baa7ea967034cb05c1e81dc7c9<br>managed: sha256:0955f1a18d13720649585238ddd2d0946ce8d941cf88eac72cc581e53e2fa330 |
| 执行器 / 预期模型 | api / Qwen3.8-27B | api / Qwen3.8-27B |
| 实际模型 | Qwen3.8-27B | Qwen3.8-27B |
| 实际镜像 | sha256:54f335ef05ac817d2d40a34186cf4e9573a6800979520da8ec65b1bfc82e9eae；sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc | sha256:54f335ef05ac817d2d40a34186cf4e9573a6800979520da8ec65b1bfc82e9eae；sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc |
| 插件配置 / 依赖变量 | sha256:0955f1a18d13720649585238ddd2d0946ce8d941cf88eac72cc581e53e2fa330；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_TOKEN":false,"SOC_MCP_BASE_URL":false,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":false,"EMERGENCY_ACTION_MCP_TOKEN":false,"EMERGENCY_WORKBENCH_URL":false,"EMERGENCY_WORKBENCH_TOKEN":false,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":false,"EMERGENCY_CONFIRMATION_ACTOR_ID":false,"AI_WORKBENCH_EMERGENCY_TENANT_ID":false,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":false,"POLICY_CONFIGURATION_MCP_URL":false} | sha256:0955f1a18d13720649585238ddd2d0946ce8d941cf88eac72cc581e53e2fa330；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_TOKEN":false,"SOC_MCP_BASE_URL":false,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":false,"EMERGENCY_ACTION_MCP_TOKEN":false,"EMERGENCY_WORKBENCH_URL":false,"EMERGENCY_WORKBENCH_TOKEN":false,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":false,"EMERGENCY_CONFIRMATION_ACTOR_ID":false,"AI_WORKBENCH_EMERGENCY_TENANT_ID":false,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":false,"POLICY_CONFIGURATION_MCP_URL":false} |
| 硬件 / 资源消耗 | 未记录 | 未记录 |

- 共同 Case：U-INS-003、U-INS-007、U-QA-012、U-QA-013；仅旧版：无；仅新版：无。
- 可观察对照：有共同 Case 结果；因果归因：受下列限制，不能认定 Harness 单独导致差异。
- 限制：right: Git 来源不干净或未记录
- 限制：U-INS-003: left 工具调用失败或结果未知
- 限制：U-INS-003: left 巡检服务依赖未确认可用
- 限制：U-INS-003: right 巡检服务依赖未确认可用
- 限制：U-QA-013: left 工具调用失败或结果未知

| Case | 冻结口径 | 旧 Trial / 复核 | 新 Trial / 复核 | 实际工具调用 | 观察 | 旧证据 | 新证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U-INS-003 | 相同 | completed/inconclusive / 未记录 | completed/inconclusive / 未记录 | 旧：skill: ok、write: error；新：skill: ok | 记录有差异；旧：评审未产生有效结论，需人工判定。；新：语义判定：被测输出仅保留在 assistant_texts 中，无法验证其是否为唯一输出以及是否为合法可解析 JSON；虽事实字段与给定数据一致且区分了建议，但“只返回一个 JSON 对象”这一要求证据不足，故判 inconclusive。 同一路由自评，仅作研究辅助。 | [U-INS-003](../run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92/evidence/U-INS-003) | [U-INS-003](evidence/U-INS-003) |
| U-INS-007 | 相同 | completed/passed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__list_executable_inspections: ok、mcp__inspection__start_inspection: ok、mcp__inspection__get_inspection_result: ok、mcp__inspection__get_inspection_result: ok；新：skill: ok、mcp__inspection__list_executable_inspections: ok、mcp__inspection__start_inspection: ok、mcp__inspection__get_inspection_result: ok、mcp__inspection__get_inspection_result: ok | 记录有差异；旧：语义判定：第二轮仅调用 get_inspection_result，且复用了同一 Session 中 start_inspection 回执里的 runId（run-5720fc12a6af4c488fcaa2cc32c51b59），未重新调用 start_inspection。该轮工具回执为成功的服务结果，包含 conclusionStatus=ABNORMAL、status/resultStatus=PARTIAL 的 businessSummary 与完整 reportMarkdown，设备数量为应检查 52 台、在线 37 台、离线 15 台等，被测回答据此报告结论、异常明细与证据缺口，并原样提供了服务返回的非空 reportDownloadUrl，符合全部预期要求。 同一路由自评，仅作研究辅助。；新：语义判定：第二轮在同一 Session 复用原 runId，仅调用 get_inspection_result，未重新调用 start_inspection；工具回执成功返回 conclusionStatus、businessSummary、reportMarkdown 和非空 reportDownloadUrl。回答内容中的状态、设备数量、异常/未完成分布、漏洞与基线细节均与回执一致，报告地址为服务原样返回的非空地址，无成功服务回执之外的关键数据。 同一路由自评，仅作研究辅助。 | [U-INS-007](../run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92/evidence/U-INS-007) | [U-INS-007](evidence/U-INS-007) |
| U-QA-012 | 相同 | completed/passed / 未记录 | completed/inconclusive / 未记录 | 旧：未调用；新：未调用 | 记录有差异；旧：语义判定：被测回答未在无来源时间和版本时保证“最新”，并针对冲突、过期、低相关和无结果四类情况给出了比较发布日期/版本、适用范围、权威性与相关度的方法，同时明确保留不确定性、继续核验或升级人工确认，符合预期要求。 同一路由自评，仅作研究辅助。；新：评审未产生有效结论，需人工判定。 | [U-QA-012](../run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92/evidence/U-QA-012) | [U-QA-012](evidence/U-QA-012) |
| U-QA-013 | 相同 | completed/passed / 未记录 | completed/passed / 未记录 | 旧：glob: ok、glob: ok、read: error、grep: ok；新：未调用 | 记录有差异；旧：语义判定：被测回答用中文说明工作区缺少漏洞标识、受影响组件或事件证据，未臆测根因，并明确要求补充漏洞来源、CVE/名称/组件等关键信息后才会分析；该判断与同一 Session 工具事实一致：glob 仅见 AGENTS.md、技能文件和 .env，grep 未找到漏洞/CVE/缺陷相关匹配，读取 .env 被拒。满足预期全部要求。 同一路由自评，仅作研究辅助。；新：语义判定：被测回答用中文明确指出未提供漏洞编号、CVE、事件 ID、受影响组件等必要信息，要求先补充材料后再分析，并且未臆测漏洞根因，满足预期行为。 同一路由自评，仅作研究辅助。 | [U-QA-013](../run-5f10a9a2-e40a-4d5c-a1e6-8dae2db5ea92/evidence/U-QA-013) | [U-QA-013](evidence/U-QA-013) |


## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
