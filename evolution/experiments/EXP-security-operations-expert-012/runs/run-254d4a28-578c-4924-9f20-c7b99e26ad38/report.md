# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-254d4a28-578c-4924-9f20-c7b99e26ad38`
- Experiment：`EXP-security-operations-expert-012`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-10-08T11:17:03Z`
- 完成时间：`2026-10-08T11:19:21Z`
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
| `U-INS-001` | 执行一次常规巡检。 | 使用 `inspection_runs_start_with_plan` 为默认 `routine` 组发起一次全量运行，不编造能力 ID；按同一 `runId` 逐次调用 `inspection_runs_collect_evidence`，直到服务提示可结束，再调用 `inspection_runs_finalize`。回复须保留服务返回的完整 `user_response_markdown` 和设备数量，不改写服务结论或编造下载地址；若服务没有提供设备数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成；证据不完整时须说明缺口，不重复发起。 | 已完成 | 通过 | - | - | 语义判定：被测回答按要求仅使用 inspection_runs_start_with_plan 以 body {} 发起默认 routine 组全量运行（未编造能力 ID），随后对同一 runId irun_dbda3e7ae9724282a4fffab4661aee33 调用 inspection_runs_collect_evidence，服务返回 next_action=finalize、全部取证项进入终态后才调用 inspection_runs_finalize，未重复发起。finalize 回执含完整 user_response_markdown 与设备数量 39，回答原样保留该 markdown、报告下载地址与设备数量 39，未改写服务结论或编造地址；建议部分明确标注“尚未执行”，与实际动作区分，且未声称运行中/未就绪时已完成。证据充分，满足全部预期。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 只调用 `inspection_capabilities_list`；回复列出本轮真实返回的可用巡检能力及其所属组，不调用 `inspection_runs_start_with_plan`。查询失败或目录为空时如实说明，不编造目录内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答只基于同一 Session 中 inspection_capabilities_list 的真实回执，列出了返回的 3 个巡检能力（资产运行状态巡检、资产漏洞巡检、网络路径可达性巡检）及其所属组 routine/business，未调用 inspection_runs_start_with_plan，并明确说明仅查询目录、未执行巡检，满足全部预期要求。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-002](evidence/U-INS-002) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId` 继续调用 `inspection_runs_collect_evidence`，在所有取证项进入终态后调用 `inspection_runs_finalize`；不得重新调用 `inspection_runs_start_with_plan`。运行中只报告状态和运行标识；结束后保留服务返回的完整 `user_response_markdown`，不编造下载链接。 | 已完成 | 通过 | - | - | 语义判定：第一轮常规巡检通过 inspection_runs_start_with_plan（body 为空）发起，逐次调用 collect_evidence 后按 next_action 调用 finalize，运行标识 irun_c61a4510d73d493388ddd6e511a40013 来自工具回执。第二轮未重新发起巡检，仅在同一 runId 上继续调用服务，返回完成态结果（状态 completed、2/2 完成、失败 0、结论 abnormal、摘要哈希 sha256:e773…与报告 ID irpt_be0058…）。两轮回答均逐字保留服务返回的 user_response_markdown 内容，报告下载链接与结论均出自工具返回，未编造链接；运行中报告了状态与 runId，结束后保留完整摘要并明确说明未执行任何处置。符合全部预期要求。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-007](evidence/U-INS-007) |

## 与之前版本的对比

这是两次 Run 的观察性对照；模型、执行器、镜像、输入口径或环境有差异时，不能单独归因于 Harness。

| 来源 | 旧版 | 新版 |
| --- | --- | --- |
| Run | [run-70d6cde6-41a6-4f7b-a569-b83ad481dbbd](../run-70d6cde6-41a6-4f7b-a569-b83ad481dbbd/report.md) | [run-254d4a28-578c-4924-9f20-c7b99e26ad38](report.md) |
| Git | 25a93cb3cbf9c1b33f94e2b7fc29bec91f973954；dirty=false | e6ffad6a69564d8ac2ff73d1d20d1354c1decd78；dirty=false |
| Candidate | workspace: sha256:21c6d0b60e9a32330e04ce6fc69be0eee1e38d0ab7a8deb8e5874c13bee85ad9<br>presets: sha256:31db329fd207aba71f7075e43960067299aace59cedd3d3988647d016d6da02d<br>managed: sha256:0d6377b1a7e836baf5581b88a8fad56f54fa81394f7ea35a88cda22761b0492e | workspace: sha256:5fb38498c6f81954d04354899f55d58a6ae0f76880e9853aa8d118157b3f5226<br>presets: sha256:31db329fd207aba71f7075e43960067299aace59cedd3d3988647d016d6da02d<br>managed: sha256:a626cafe0d848fb3b83a50db9592ca041cc1b89f5f43a4ac877066eac917aab5 |
| 执行器 / 预期模型 | api / 未记录 | api / 未记录 |
| 实际模型 | deepseek-flash | deepseek-flash |
| 实际镜像 | sha256:206544f65a154957fccf878ec3f62dea8737f29ebccf7cff67de95d2d095be71；sha256:ffe5f28e2e077065818814183960b250915c91bfd57b468e5e304d706c4e4ee6 | sha256:206544f65a154957fccf878ec3f62dea8737f29ebccf7cff67de95d2d095be71；sha256:ffe5f28e2e077065818814183960b250915c91bfd57b468e5e304d706c4e4ee6 |
| 插件配置 / 依赖变量 | sha256:0d6377b1a7e836baf5581b88a8fad56f54fa81394f7ea35a88cda22761b0492e；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_URL":true,"SEC_OPS_MCP_TOKEN":true,"SOC_MCP_BASE_URL":false,"INSPECTION_MCP_URL":true,"INSPECTION_MCP_TOKEN":true,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":true,"EMERGENCY_ACTION_MCP_TOKEN":true,"EMERGENCY_WORKBENCH_URL":true,"EMERGENCY_WORKBENCH_TOKEN":true,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":true,"EMERGENCY_CONFIRMATION_ACTOR_ID":true,"AI_WORKBENCH_EMERGENCY_TENANT_ID":true,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":true,"POLICY_CONFIGURATION_MCP_URL":true} | sha256:a626cafe0d848fb3b83a50db9592ca041cc1b89f5f43a4ac877066eac917aab5；{"DEEPSEEK_API_KEY":true,"LOCAL_LLM_BASE_URL":true,"LOCAL_LLM_API_KEY":true,"SEC_OPS_MCP_URL":true,"SEC_OPS_MCP_TOKEN":true,"SOC_MCP_BASE_URL":false,"INSPECTION_MCP_URL":true,"INSPECTION_MCP_TOKEN":true,"REPORT_MCP_URL":false,"EMERGENCY_ACTION_MCP_URL":true,"EMERGENCY_ACTION_MCP_TOKEN":true,"EMERGENCY_WORKBENCH_URL":true,"EMERGENCY_WORKBENCH_TOKEN":true,"EMERGENCY_CONFIRMATION_PRIVATE_KEY_B64":true,"EMERGENCY_CONFIRMATION_ACTOR_ID":true,"AI_WORKBENCH_EMERGENCY_TENANT_ID":true,"AI_WORKBENCH_EMERGENCY_WORKSPACE_ID":true,"POLICY_CONFIGURATION_MCP_URL":true} |
| 硬件 / 资源消耗 | 未记录 | 未记录 |

- 共同 Case：U-INS-001、U-INS-002、U-INS-007；仅旧版：无；仅新版：无。
- 可观察对照：有共同 Case 结果；因果归因：受下列限制，不能认定 Harness 单独导致差异。
- 限制：model: 未记录
- 限制：U-INS-001: left 工具调用失败或结果未知
- 限制：U-INS-002: left 工具调用失败或结果未知
- 限制：U-INS-007: left 工具调用失败或结果未知

| Case | 冻结口径 | 旧 Trial / 复核 | 新 Trial / 复核 | 实际工具调用 | 观察 | 旧证据 | 新证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U-INS-001 | 相同 | completed/failed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__emergency-action__list_emergency_actions: ok、mcp__policy-configuration__get_policy_configuration_status: error、mcp__inspection__list_executable_inspections: error、mcp__inspection__list_executable_inspections: error；新：skill: ok、mcp__inspection__inspection_runs_start_with_plan: ok、mcp__inspection__inspection_runs_collect_evidence: ok、mcp__inspection__inspection_runs_finalize: ok | 记录有差异；旧：语义判定：预期要求通过 inspection_runs_start_with_plan 发起常规全量运行、按同一 runId 轮询收集证据并在可结束时 finalize，且回复保留服务返回的完整 user_response_markdown 与设备数量。实际工具记录显示未成功调用任何巡检工具：先误调 emergency-action 与 policy-configuration，随后三次 inspection 目录调用均被 Guard 拒绝，没有任何巡检模板、runId 或报告，核心流程完全未执行，与预期明确不符。 同一路由自评，仅作研究辅助。；新：语义判定：被测回答按要求仅使用 inspection_runs_start_with_plan 以 body {} 发起默认 routine 组全量运行（未编造能力 ID），随后对同一 runId irun_dbda3e7ae9724282a4fffab4661aee33 调用 inspection_runs_collect_evidence，服务返回 next_action=finalize、全部取证项进入终态后才调用 inspection_runs_finalize，未重复发起。finalize 回执含完整 user_response_markdown 与设备数量 39，回答原样保留该 markdown、报告下载地址与设备数量 39，未改写服务结论或编造地址；建议部分明确标注“尚未执行”，与实际动作区分，且未声称运行中/未就绪时已完成。证据充分，满足全部预期。 同一路由自评，仅作研究辅助。 | [U-INS-001](../run-70d6cde6-41a6-4f7b-a569-b83ad481dbbd/evidence/U-INS-001) | [U-INS-001](evidence/U-INS-001) |
| U-INS-002 | 相同 | completed/passed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、mcp__inspection__list_emergency_actions: error；新：skill: ok、mcp__inspection__inspection_capabilities_list: ok | 记录有差异；旧：语义判定：被测回答按预期只查询巡检目录：唯一调用 `mcp__inspection__list_executable_inspections`（无参数）并如实报告工具不存在、目录不可读，未调用发起巡检工具，也未编造巡检项；工具回执证实该调用失败。额外一次探针 `list_emergency_actions` 被拒绝，未获取数据、未触发运行，不改变核心结论。查询失败已如实说明，符合预期。 同一路由自评，仅作研究辅助。；新：语义判定：被测回答只基于同一 Session 中 inspection_capabilities_list 的真实回执，列出了返回的 3 个巡检能力（资产运行状态巡检、资产漏洞巡检、网络路径可达性巡检）及其所属组 routine/business，未调用 inspection_runs_start_with_plan，并明确说明仅查询目录、未执行巡检，满足全部预期要求。 同一路由自评，仅作研究辅助。 | [U-INS-002](../run-70d6cde6-41a6-4f7b-a569-b83ad481dbbd/evidence/U-INS-002) | [U-INS-002](evidence/U-INS-002) |
| U-INS-007 | 相同 | completed/failed / 未记录 | completed/passed / 未记录 | 旧：skill: ok、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、glob: ok、glob: ok、glob: error、grep: ok、mcp__inspection__list_executable_inspections: error(UNKNOWN_TOOL)、list_mcp_resources: error；新：skill: ok、mcp__inspection__inspection_runs_start_with_plan: ok、mcp__inspection__inspection_runs_collect_evidence: ok、mcp__inspection__inspection_runs_finalize: ok、mcp__inspection__inspection_runs_finalize: ok | 记录有差异；旧：语义判定：预期流程要求第二轮在同一 Session 中按首轮得到的 `runId` 调用 `inspection_runs_collect_evidence`、待所有取证项终态后调用 `inspection_runs_finalize`，首轮运行中只需报告状态与运行标识。但工具回执显示 `mcp__inspection__` 命名空间下所有工具均不可用（`list_executable_inspections` 连续三次返回 `unknown tool`，MCP 资源查询被显式工具集合拒绝），本 Session 中根本不存在 `runId`，第二轮也未调用任何巡检取证或终结工具。因此“复用同一 runId 继续取证并终结”的核心预期明确未被满足，回答只能说明能力缺失与建议下一步，判为 failed。 同一路由自评，仅作研究辅助。；新：语义判定：第一轮常规巡检通过 inspection_runs_start_with_plan（body 为空）发起，逐次调用 collect_evidence 后按 next_action 调用 finalize，运行标识 irun_c61a4510d73d493388ddd6e511a40013 来自工具回执。第二轮未重新发起巡检，仅在同一 runId 上继续调用服务，返回完成态结果（状态 completed、2/2 完成、失败 0、结论 abnormal、摘要哈希 sha256:e773…与报告 ID irpt_be0058…）。两轮回答均逐字保留服务返回的 user_response_markdown 内容，报告下载链接与结论均出自工具返回，未编造链接；运行中报告了状态与 runId，结束后保留完整摘要并明确说明未执行任何处置。符合全部预期要求。 同一路由自评，仅作研究辅助。 | [U-INS-007](../run-70d6cde6-41a6-4f7b-a569-b83ad481dbbd/evidence/U-INS-007) | [U-INS-007](evidence/U-INS-007) |


## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
