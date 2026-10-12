# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-7bc9d938-4522-4ea6-be33-5e2c04e19e11`
- Experiment：`EXP-security-operations-expert-015-r904bdcd81005`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-10-12T03:07:44Z`
- 完成时间：`2026-10-12T03:09:28Z`
- 执行通道：`api`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 3 | 3 | 0 | 0 | 3 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 3 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 11 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 6 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 语音交互 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

本次 Run 未请求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 先调用 `list_executable_inspections` 选择真实可执行的常规模板；用该模板的 `taskId`、`definitionVersion` 和本次请求稳定的 `requestId` 调用一次 `start_inspection`，省略 `scope`。按同一 `runId` 调用 `get_inspection_result` 直到报告就绪；运行中不得声称完成或重复发起。回复依据服务的 `conclusionStatus`、`businessSummary`、完整 `reportMarkdown` 和设备数量，不改写结论或编造下载地址；设备数量缺失时说明缺口，该项不得判通过。只有非空 `reportDownloadUrl` 才提供下载地址。 | 已完成 | 通过 | - | - | 语义判定：被测会话先调用 list_executable_inspections 获取真实可执行模板，选定 defaultForChat 的综合巡检模板（taskId=task-bfc6f1c0e99a488988fa5d6949cd3a35，definitionVersion=V5），随后以稳定 requestId 调用一次 start_inspection 且省略 scope；再以同一 runId 反复调用 get_inspection_result，直至返回 status=PARTIAL 的就绪结果，未在运行中宣称完成，也未重复发起。回复内容与工具回执一致：结论状态 ABNORMAL/PARTIAL、businessSummary 与完整 reportMarkdown 摘要、设备数量（应检查 50 台、在线 36/离线 14、异常涉及 20 台、部分未完成 21 台、基线 26 台未纳入判定、重叠 13 台不相加）均如实转述，未改写结论；报告下载地址仅取用非空 reportDownloadUrl，无编造。设备数量在该被测会话的工具回执中得到明确支持，无缺口，故判定满足全部预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `list_executable_inspections`；回复列出本轮真实返回的可执行模板及其巡检项，不调用 `start_inspection`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答只调用了 list_executable_inspections（seq 20，arguments 为空对象），未调用 start_inspection，符合“只查询目录、不执行巡检”。回复列出的 5 个模板名称、巡检项、版本（V2/V2/V2/V5/V1）、运行入参（业务可达性巡检必填 srcIp/dstIp，其余为空）、defaultForChat（仅设备综合巡检为 true）以及 matchPhrases（仅设备综合巡检有 4 条，其余为空）均与该工具回执逐项一致，未编造目录内容；同时明确说明未发起巡检、无 runId。全部预期要求满足。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId`，只调用 `get_inspection_result`，不得重新调用 `start_inspection`。运行中只报告状态和运行标识；报告就绪后根据本轮服务返回的 `conclusionStatus`、`businessSummary`、完整 `reportMarkdown` 与设备数量回答，仅提供非空的真实 `reportDownloadUrl`。没有成功的服务回执不能判通过。 | 已完成 | 通过 | - | - | 语义判定：第二轮仅调用了一次 get_inspection_result（runId=run-4e4192c94f0d41adb7c9258e46df88de），未再次调用 start_inspection，复用了第一轮 Session 内同一 runId。第二轮工具回执返回 status/resultStatus=PARTIAL、conclusionStatus=ABNORMAL、errorMessage、businessSummary、完整 reportMarkdown 及非空真实 reportDownloadUrl；被测回答据此报告了状态与运行标识、结论字段、设备数量（应检 50 台、在线 36/离线 14、异常 20 台、21 台未完成、26 台未纳入判定）及下载链接，未在运行中谎称完成，也未编造未返回的数据，关键数据均有同一 Session 工具回执支撑，符合预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 与之前版本的对比

这是两次 Run 的观察性对照；模型、执行器、镜像、输入口径或环境有差异时，不能单独归因于 Harness。

| 来源 | 旧版 | 新版 |
| --- | --- | --- |
| Run | [run-204006db-50d8-44c1-b3d8-55e77c255337](../../../EXP-security-operations-expert-012/runs/run-204006db-50d8-44c1-b3d8-55e77c255337/report.md) | [run-7bc9d938-4522-4ea6-be33-5e2c04e19e11](report.md) |
| Git | 59058117e85ec8f605b459a6c802bb159ca6fe6f；dirty=false | 047bb6a0202864a58755f84c22e5a01e2021d209；dirty=true |
| Candidate | workspace: sha256:a880f34ee34ca0789ed77ccdd3d4a293aa8b0821e222b6775b20378e178f9e69<br>presets: sha256:31db329fd207aba71f7075e43960067299aace59cedd3d3988647d016d6da02d<br>managed: sha256:a626cafe0d848fb3b83a50db9592ca041cc1b89f5f43a4ac877066eac917aab5 | workspace: sha256:c2f6a34ba1b6b93107e8043d9393f1f78dd3e9a0b529e65511815c748b1a9170<br>presets: sha256:318f8d0e7b413868d6a9ed3eeca659a2ffea18baa7ea967034cb05c1e81dc7c9<br>managed: sha256:9bb483a967a14a40da04da1e7887dec68b60b395041fa43be4ef2ad60217500e |
| 执行器 / 预期模型 | api / deepseek-official/deepseek-flash | api / deepseek-official/deepseek-flash |
| 实际模型 | deepseek-flash | deepseek-flash |
| 实际镜像 | sha256:206544f65a154957fccf878ec3f62dea8737f29ebccf7cff67de95d2d095be71；sha256:ffe5f28e2e077065818814183960b250915c91bfd57b468e5e304d706c4e4ee6 | sha256:54f335ef05ac817d2d40a34186cf4e9573a6800979520da8ec65b1bfc82e9eae；sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc |
| 插件配置 / 依赖变量 | sha256:a626cafe0d848fb3b83a50db9592ca041cc1b89f5f43a4ac877066eac917aab5；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_URL":true,"SEC_OPS_MCP_TOKEN":true,"SOC_MCP_BASE_URL":false,"INSPECTION_MCP_URL":true,"INSPECTION_MCP_TOKEN":true,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":true,"EMERGENCY_ACTION_MCP_TOKEN":true,"EMERGENCY_WORKBENCH_URL":true,"EMERGENCY_WORKBENCH_TOKEN":true,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":true,"EMERGENCY_CONFIRMATION_ACTOR_ID":true,"AI_WORKBENCH_EMERGENCY_TENANT_ID":true,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":true,"POLICY_CONFIGURATION_MCP_URL":true} | sha256:9bb483a967a14a40da04da1e7887dec68b60b395041fa43be4ef2ad60217500e；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_TOKEN":true,"SOC_MCP_BASE_URL":true,"REPORT_MCP_URL":true,"EMERGENCY_WORKBENCH_URL":true,"EMERGENCY_WORKBENCH_TOKEN":true,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":false,"EMERGENCY_CONFIRMATION_ACTOR_ID":true,"AI_WORKBENCH_EMERGENCY_TENANT_ID":true,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":true,"POLICY_CONFIGURATION_MCP_URL":true} |
| 硬件 / 资源消耗 | 未记录 | 未记录 |

- 共同 Case：U-INS-001、U-INS-002、U-INS-007；仅旧版：无；仅新版：无。
- 可观察对照：有共同 Case 结果；因果归因：受下列限制，不能认定 Harness 单独导致差异。
- 限制：configured_capabilities: 不同
- 限制：dependency_env: 不同
- 限制：right: Git 来源不干净或未记录
- 限制：image_build_fingerprint: 不同
- 限制：local_image_id: 不同
- 限制：U-INS-001: 冻结 Case 口径不同
- 限制：U-INS-002: 冻结 Case 口径不同
- 限制：U-INS-007: 冻结 Case 口径不同

| Case | 冻结口径 | 旧 Trial / 复核 | 新 Trial / 复核 | 实际工具调用 | 观察 | 旧证据 | 新证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U-INS-001 | 不同 | completed/passed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__inspection_runs_start_with_plan: ok、mcp__inspection__inspection_runs_collect_evidence: ok、mcp__inspection__inspection_runs_finalize: ok；新：mcp__inspection__list_executable_inspections: ok、mcp__inspection__start_inspection: ok、mcp__inspection__get_inspection_result: ok | 记录有差异；旧：语义判定：被测回答严格对照同一 Session 的工具回执：先调用 inspection_runs_start_with_plan 且 body 为 {}（未编造能力 ID），取得 runId=irun_a7056e3f9795417fafb2194d2a6c46d3；对同一 runId 调用 collect_evidence，服务返回 status=ready_to_finalize、next_action=finalize 后才调用 finalize，未重复发起或提前声称完成。回复原样保留了服务返回的完整 user_response_markdown（含结论、总数39台/套、离线20台/套、严重或高危漏洞4台/套及下载链接），未改写服务结论、未编造下载地址，设备数量与服务报告一致，并明确区分了尚未执行的建议动作。证据完整且一致，满足全部预期要求。 同一路由自评，仅作研究辅助。；新：语义判定：被测会话先调用 list_executable_inspections 获取真实可执行模板，选定 defaultForChat 的综合巡检模板（taskId=task-bfc6f1c0e99a488988fa5d6949cd3a35，definitionVersion=V5），随后以稳定 requestId 调用一次 start_inspection 且省略 scope；再以同一 runId 反复调用 get_inspection_result，直至返回 status=PARTIAL 的就绪结果，未在运行中宣称完成，也未重复发起。回复内容与工具回执一致：结论状态 ABNORMAL/PARTIAL、businessSummary 与完整 reportMarkdown 摘要、设备数量（应检查 50 台、在线 36/离线 14、异常涉及 20 台、部分未完成 21 台、基线 26 台未纳入判定、重叠 13 台不相加）均如实转述，未改写结论；报告下载地址仅取用非空 reportDownloadUrl，无编造。设备数量在该被测会话的工具回执中得到明确支持，无缺口，故判定满足全部预期。 同一路由自评，仅作研究辅助。 | [U-INS-001](../../../EXP-security-operations-expert-012/runs/run-204006db-50d8-44c1-b3d8-55e77c255337/evidence/U-INS-001) | [U-INS-001](evidence/U-INS-001) |
| U-INS-002 | 不同 | completed/passed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__inspection_capabilities_list: ok；新：mcp__inspection__list_executable_inspections: ok | 记录有差异；旧：语义判定：被测回答仅调用了无参数的 inspection_capabilities_list（另有加载 skill 的前置调用），未调用 inspection_runs_start_with_plan，未发起任何巡检运行。回答列出的 3 项能力名称、capability_id、所属组（routine/routine/business）及输入参数与同 Session 工具回执中的目录数据完全一致，且明确说明未执行取证、未创建运行，查询目录信息真实无编造，满足全部预期要求。 同一路由自评，仅作研究辅助。；新：语义判定：被测回答只调用了 list_executable_inspections（seq 20，arguments 为空对象），未调用 start_inspection，符合“只查询目录、不执行巡检”。回复列出的 5 个模板名称、巡检项、版本（V2/V2/V2/V5/V1）、运行入参（业务可达性巡检必填 srcIp/dstIp，其余为空）、defaultForChat（仅设备综合巡检为 true）以及 matchPhrases（仅设备综合巡检有 4 条，其余为空）均与该工具回执逐项一致，未编造目录内容；同时明确说明未发起巡检、无 runId。全部预期要求满足。 同一路由自评，仅作研究辅助。 | [U-INS-002](../../../EXP-security-operations-expert-012/runs/run-204006db-50d8-44c1-b3d8-55e77c255337/evidence/U-INS-002) | [U-INS-002](evidence/U-INS-002) |
| U-INS-007 | 不同 | completed/passed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__inspection_runs_start_with_plan: ok、mcp__inspection__inspection_runs_collect_evidence: ok、mcp__inspection__inspection_runs_finalize: ok、mcp__inspection__inspection_runs_finalize: ok；新：mcp__inspection__list_executable_inspections: ok、mcp__inspection__start_inspection: ok、mcp__inspection__get_inspection_result: ok、mcp__inspection__get_inspection_result: ok | 记录有差异；旧：语义判定：首轮调用 inspection_runs_start_with_plan 取得 runId irun_a355af507aab4ed0b807ea68fdd75d44，随后对同一 runId 调用 collect_evidence，在服务端返回 ready_to_finalize 后调用 finalize 生成报告；第二轮未重新发起运行，而是用同一 runId 再次调用 inspection_runs_finalize 读取已有报告，符合预期。回答保留服务返回的完整 user_response_markdown，下载链接与报告标题、结论、设备数量均与服务回执一致，未编造；工具回执均成功，关键数据有据可依。 同一路由自评，仅作研究辅助。；新：语义判定：第二轮仅调用了一次 get_inspection_result（runId=run-4e4192c94f0d41adb7c9258e46df88de），未再次调用 start_inspection，复用了第一轮 Session 内同一 runId。第二轮工具回执返回 status/resultStatus=PARTIAL、conclusionStatus=ABNORMAL、errorMessage、businessSummary、完整 reportMarkdown 及非空真实 reportDownloadUrl；被测回答据此报告了状态与运行标识、结论字段、设备数量（应检 50 台、在线 36/离线 14、异常 20 台、21 台未完成、26 台未纳入判定）及下载链接，未在运行中谎称完成，也未编造未返回的数据，关键数据均有同一 Session 工具回执支撑，符合预期。 同一路由自评，仅作研究辅助。 | [U-INS-007](../../../EXP-security-operations-expert-012/runs/run-204006db-50d8-44c1-b3d8-55e77c255337/evidence/U-INS-007) | [U-INS-007](evidence/U-INS-007) |


## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
