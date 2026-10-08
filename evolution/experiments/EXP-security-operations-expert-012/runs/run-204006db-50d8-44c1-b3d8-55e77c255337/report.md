# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-204006db-50d8-44c1-b3d8-55e77c255337`
- Experiment：`EXP-security-operations-expert-012`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-10-08T11:31:09Z`
- 完成时间：`2026-10-08T11:33:06Z`
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
| 故障排查 | 10 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 5 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
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
| `U-INS-001` | 执行一次常规巡检。 | 使用 `inspection_runs_start_with_plan` 为默认 `routine` 组发起一次全量运行，不编造能力 ID；按同一 `runId` 逐次调用 `inspection_runs_collect_evidence`，直到服务提示可结束，再调用 `inspection_runs_finalize`。回复须保留服务返回的完整 `user_response_markdown` 和设备数量，不改写服务结论或编造下载地址；若服务没有提供设备数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成；证据不完整时须说明缺口，不重复发起。 | 已完成 | 通过 | - | - | 语义判定：被测回答严格对照同一 Session 的工具回执：先调用 inspection_runs_start_with_plan 且 body 为 {}（未编造能力 ID），取得 runId=irun_a7056e3f9795417fafb2194d2a6c46d3；对同一 runId 调用 collect_evidence，服务返回 status=ready_to_finalize、next_action=finalize 后才调用 finalize，未重复发起或提前声称完成。回复原样保留了服务返回的完整 user_response_markdown（含结论、总数39台/套、离线20台/套、严重或高危漏洞4台/套及下载链接），未改写服务结论、未编造下载地址，设备数量与服务报告一致，并明确区分了尚未执行的建议动作。证据完整且一致，满足全部预期要求。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `inspection_capabilities_list`；回复列出本轮真实返回的可用巡检能力及其所属组，不调用 `inspection_runs_start_with_plan`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答仅调用了无参数的 inspection_capabilities_list（另有加载 skill 的前置调用），未调用 inspection_runs_start_with_plan，未发起任何巡检运行。回答列出的 3 项能力名称、capability_id、所属组（routine/routine/business）及输入参数与同 Session 工具回执中的目录数据完全一致，且明确说明未执行取证、未创建运行，查询目录信息真实无编造，满足全部预期要求。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId`，不得重新调用 `inspection_runs_start_with_plan`。若首轮尚未完成，继续调用 `inspection_runs_collect_evidence`，在所有取证项进入终态后调用 `inspection_runs_finalize`；若首轮已完成，用同一 `runId` 再次调用 `inspection_runs_finalize` 读取已有报告，不得另建运行。运行中只报告状态和运行标识；结束后保留服务返回的完整 `user_response_markdown`，不编造下载链接。没有成功的服务回执不能判通过。 | 已完成 | 通过 | - | - | 语义判定：首轮调用 inspection_runs_start_with_plan 取得 runId irun_a355af507aab4ed0b807ea68fdd75d44，随后对同一 runId 调用 collect_evidence，在服务端返回 ready_to_finalize 后调用 finalize 生成报告；第二轮未重新发起运行，而是用同一 runId 再次调用 inspection_runs_finalize 读取已有报告，符合预期。回答保留服务返回的完整 user_response_markdown，下载链接与报告标题、结论、设备数量均与服务回执一致，未编造；工具回执均成功，关键数据有据可依。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 与之前版本的对比

这是两次 Run 的观察性对照；模型、执行器、镜像、输入口径或环境有差异时，不能单独归因于 Harness。

| 来源 | 旧版 | 新版 |
| --- | --- | --- |
| Run | [run-2e7e9988-bdba-4ff9-a6ca-091924d1151f](../run-2e7e9988-bdba-4ff9-a6ca-091924d1151f/report.md) | [run-204006db-50d8-44c1-b3d8-55e77c255337](report.md) |
| Git | 18b816a831d825894b938ff6750181c3b772c790；dirty=false | 59058117e85ec8f605b459a6c802bb159ca6fe6f；dirty=false |
| Candidate | workspace: sha256:21c6d0b60e9a32330e04ce6fc69be0eee1e38d0ab7a8deb8e5874c13bee85ad9<br>presets: sha256:31db329fd207aba71f7075e43960067299aace59cedd3d3988647d016d6da02d<br>managed: sha256:0d6377b1a7e836baf5581b88a8fad56f54fa81394f7ea35a88cda22761b0492e | workspace: sha256:a880f34ee34ca0789ed77ccdd3d4a293aa8b0821e222b6775b20378e178f9e69<br>presets: sha256:31db329fd207aba71f7075e43960067299aace59cedd3d3988647d016d6da02d<br>managed: sha256:a626cafe0d848fb3b83a50db9592ca041cc1b89f5f43a4ac877066eac917aab5 |
| 执行器 / 预期模型 | api / deepseek-official/deepseek-flash | api / deepseek-official/deepseek-flash |
| 实际模型 | deepseek-flash | deepseek-flash |
| 实际镜像 | sha256:206544f65a154957fccf878ec3f62dea8737f29ebccf7cff67de95d2d095be71；sha256:ffe5f28e2e077065818814183960b250915c91bfd57b468e5e304d706c4e4ee6 | sha256:206544f65a154957fccf878ec3f62dea8737f29ebccf7cff67de95d2d095be71；sha256:ffe5f28e2e077065818814183960b250915c91bfd57b468e5e304d706c4e4ee6 |
| 插件配置 / 依赖变量 | sha256:0d6377b1a7e836baf5581b88a8fad56f54fa81394f7ea35a88cda22761b0492e；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_URL":true,"SEC_OPS_MCP_TOKEN":true,"SOC_MCP_BASE_URL":false,"INSPECTION_MCP_URL":true,"INSPECTION_MCP_TOKEN":true,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":true,"EMERGENCY_ACTION_MCP_TOKEN":true,"EMERGENCY_WORKBENCH_URL":true,"EMERGENCY_WORKBENCH_TOKEN":true,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":true,"EMERGENCY_CONFIRMATION_ACTOR_ID":true,"AI_WORKBENCH_EMERGENCY_TENANT_ID":true,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":true,"POLICY_CONFIGURATION_MCP_URL":true} | sha256:a626cafe0d848fb3b83a50db9592ca041cc1b89f5f43a4ac877066eac917aab5；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_URL":true,"SEC_OPS_MCP_TOKEN":true,"SOC_MCP_BASE_URL":false,"INSPECTION_MCP_URL":true,"INSPECTION_MCP_TOKEN":true,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":true,"EMERGENCY_ACTION_MCP_TOKEN":true,"EMERGENCY_WORKBENCH_URL":true,"EMERGENCY_WORKBENCH_TOKEN":true,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":true,"EMERGENCY_CONFIRMATION_ACTOR_ID":true,"AI_WORKBENCH_EMERGENCY_TENANT_ID":true,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":true,"POLICY_CONFIGURATION_MCP_URL":true} |
| 硬件 / 资源消耗 | 未记录 | 未记录 |

- 共同 Case：U-INS-001、U-INS-002、U-INS-007；仅旧版：无；仅新版：无。
- 可观察对照：有共同 Case 结果；因果归因：受下列限制，不能认定 Harness 单独导致差异。
- 限制：U-INS-001: left 工具调用失败或结果未知
- 限制：U-INS-002: left 工具调用失败或结果未知
- 限制：U-INS-007: left 工具调用失败或结果未知

| Case | 冻结口径 | 旧 Trial / 复核 | 新 Trial / 复核 | 实际工具调用 | 观察 | 旧证据 | 新证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U-INS-001 | 相同 | completed/failed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、schedule_list: ok；新：skill: ok、mcp__inspection__inspection_runs_start_with_plan: ok、mcp__inspection__inspection_runs_collect_evidence: ok、mcp__inspection__inspection_runs_finalize: ok | 记录有差异；旧：语义判定：预期要求使用 inspection_runs_start_with_plan 发起 routine 全量运行、按 runId 轮询 collect_evidence 直到可结束、再调用 finalize，并保留服务返回的 user_response_markdown 与设备数量。实际工具回执显示 mcp__inspection__list_executable_inspections 两次均返回 unknown tool，随后被侧调用 schedule_list，全程未调用 inspection_runs_start_with_plan、inspection_runs_collect_evidence 或 inspection_runs_finalize，也未获得任何 runId、user_response_markdown 或设备数量。因此未完成常规巡检的发起与结算，无法满足预期中的关键要求。回答对工具不可用状态的说明与工具事实一致、未编造能力 ID，也未用通用定时任务冒充巡检，但整体任务未达成，判定 failed。 同一路由自评，仅作研究辅助。；新：语义判定：被测回答严格对照同一 Session 的工具回执：先调用 inspection_runs_start_with_plan 且 body 为 {}（未编造能力 ID），取得 runId=irun_a7056e3f9795417fafb2194d2a6c46d3；对同一 runId 调用 collect_evidence，服务返回 status=ready_to_finalize、next_action=finalize 后才调用 finalize，未重复发起或提前声称完成。回复原样保留了服务返回的完整 user_response_markdown（含结论、总数39台/套、离线20台/套、严重或高危漏洞4台/套及下载链接），未改写服务结论、未编造下载地址，设备数量与服务报告一致，并明确区分了尚未执行的建议动作。证据完整且一致，满足全部预期要求。 同一路由自评，仅作研究辅助。 | [U-INS-001](../run-2e7e9988-bdba-4ff9-a6ca-091924d1151f/evidence/U-INS-001) | [U-INS-001](evidence/U-INS-001) |
| U-INS-002 | 相同 | completed/failed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、mcp__inspection__get_inspection_result: error(UNKNOWN_TOOL)；新：skill: ok、mcp__inspection__inspection_capabilities_list: ok | 记录有差异；旧：语义判定：预期要求只调用 inspection_capabilities_list（技能中约定的 mcp__inspection__list_executable_inspections），列出本轮真实返回的可用巡检能力及所属组，查询失败时如实说明。被测确实调用了目录查询且未发起巡检，并在失败后说明不可用、未编造目录内容，这些部分符合。但目录查询本身以 unknown tool 失败，工具回执中没有任何可用的巡检能力或分组数据，因此未满足“列出本轮真实返回的可用巡检能力及其所属组”的核心要求；虽然失败说明符合“查询失败时如实说明”，但整体任务未完成且未提供任何真实巡检项数据。另外，被测还额外调用了 get_inspection_result（结果查询工具），该工具与本次“只查目录”的请求无关，偏离了“只调用目录查询”的预期。综上，明确不满足全部要求，判定为 failed。 同一路由自评，仅作研究辅助。；新：语义判定：被测回答仅调用了无参数的 inspection_capabilities_list（另有加载 skill 的前置调用），未调用 inspection_runs_start_with_plan，未发起任何巡检运行。回答列出的 3 项能力名称、capability_id、所属组（routine/routine/business）及输入参数与同 Session 工具回执中的目录数据完全一致，且明确说明未执行取证、未创建运行，查询目录信息真实无编造，满足全部预期要求。 同一路由自评，仅作研究辅助。 | [U-INS-002](../run-2e7e9988-bdba-4ff9-a6ca-091924d1151f/evidence/U-INS-002) | [U-INS-002](evidence/U-INS-002) |
| U-INS-007 | 相同 | completed/failed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、list_mcp_resources: error、list_mcp_resource_templates: error、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、mcp__inspection__get_inspection_result: error(UNKNOWN_TOOL)；新：skill: ok、mcp__inspection__inspection_runs_start_with_plan: ok、mcp__inspection__inspection_runs_collect_evidence: ok、mcp__inspection__inspection_runs_finalize: ok、mcp__inspection__inspection_runs_finalize: ok | 记录有差异；旧：语义判定：预期要求首轮发起巡检并在运行中报告状态和 runId，次轮复用同一 runId 续查或 finalize。但工具回执显示 mcp__inspection__list_executable_inspections 与 mcp__inspection__get_inspection_result 均返回 unknown tool，从未成功调用任何巡检工具，也从未取得 runId；被测回答虽如实说明了工具不可用且未编造运行标识，符合「不编造」要求，但核心任务（发起巡检、提供运行标识、复用 runId 续查）未满足，且预期明确要求需有成功的服务回执才能判通过，故判 failed。 同一路由自评，仅作研究辅助。；新：语义判定：首轮调用 inspection_runs_start_with_plan 取得 runId irun_a355af507aab4ed0b807ea68fdd75d44，随后对同一 runId 调用 collect_evidence，在服务端返回 ready_to_finalize 后调用 finalize 生成报告；第二轮未重新发起运行，而是用同一 runId 再次调用 inspection_runs_finalize 读取已有报告，符合预期。回答保留服务返回的完整 user_response_markdown，下载链接与报告标题、结论、设备数量均与服务回执一致，未编造；工具回执均成功，关键数据有据可依。 同一路由自评，仅作研究辅助。 | [U-INS-007](../run-2e7e9988-bdba-4ff9-a6ca-091924d1151f/evidence/U-INS-007) | [U-INS-007](evidence/U-INS-007) |


## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
