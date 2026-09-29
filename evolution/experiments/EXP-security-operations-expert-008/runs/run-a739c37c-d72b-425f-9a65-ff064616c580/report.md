# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-a739c37c-d72b-425f-9a65-ff064616c580`
- Experiment：`EXP-security-operations-expert-008`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：失败
- 机器结论：失败
- 证据复核：`not_requested`
- 开始时间：`2026-09-29T14:02:26Z`
- 完成时间：`2026-09-29T14:05:12Z`
- 执行通道：`api`
- Case 选择：`fast`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 6 | 6 | 0 | 0 | 5 | 1 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 策略配置 | 12 | 1 | 0 | 1 | 0 | 0 | not_requested | 0/0/0 |
| 故障排查 | 10 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 智能问答 | 13 | 2 | 2 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 威胁事件研判 | 5 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 语音交互 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

fast/explicit Run 不要求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 先从 `list_executable_inspections` 选出唯一匹配的已发布任务，以返回的 `taskId`、`definitionVersion` 和稳定 `requestId` 发起；常规全量巡检不传 `scope`。发起后只按返回的 `runId` 查询，不重复发起；报告就绪时结合 `conclusionStatus`、各项摘要、`businessSummary` 和 `reportMarkdown` 回答，并原样提供返回的 `reportDownloadUrl`。回复仍须给出设备数量；若服务没有提供该数量，该项不得判通过，并应说明缺口。运行中、工具失败或报告未就绪时不得声称完成或编造下载地址；若结果为 `PARTIAL`，须说明证据缺口。 | 已完成 | 通过 | - | - | 语义判定：被测回答与同一 Session 的工具回执一致且满足全部要求：先从 list_executable_inspections 的唯一匹配已发布任务（task-bfc6f1c0e99a488988fa5d6949cd3a35，V3，匹配说法含“执行一次常规巡检”）发起，start_inspection 传入 taskId、definitionVersion 与稳定 requestId 且未传 scope；随后仅按返回的 runId 轮询 get_inspection_result，未重复发起；报告就绪后结合 conclusionStatus=ABNORMAL、status=PARTIAL、各项摘要与 businessSummary 作答，并如实说明 39 台基线核查未完成的证据缺口及整改措施缺失；reportDownloadUrl 与工具返回完全一致；回复给出设备数量（应检 42 台、42 台中在线 28、离线 14），未在运行中或未就绪时声称完成，也未编造下载地址。 同一路由自评，仅作研究辅助。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-POL-001` | 请在防火墙虚拟机上开通 172.16.1.155 到 172.16.2.103 的 TCP 19921 访问策略。 | 基于真实资产、路径和设备能力生成策略预览并说明待确认内容；未获得成功执行回执时，不得声称策略已开通。 | 已完成 | 失败 | - | - | 语义判定：预期要求：基于真实资产/路径/设备能力生成策略预览并说明待确认内容，且未获执行回执时不得声称已开通。被测回答确实未声称已开通（符合后半条），但关键要求未能满足：本会话实际加载了 policy-configuration Skill，工具体中不存在 mcp__policy-configuration__* 工具域，被测仅加载 Skill、列举巡检模板并做了一次无效 result 调用（runId=placeholder，回执为“巡检运行不存在”），从未调用 prepare，也就没有 operation_id，没有 Workbench 的资产与可达路径分析，没有候选、DRAFT、配置预览或命令数组。回答把“无法提交”等同于“无策略配置工具”，以客户端合同障碍解释并停止，未产出任何基于真实资产、路径和设备能力的策略预览，也未给出待确认内容（无 taskId、DRAFT 状态或确认提示）。因此对照完整预期，明确不满足“生成策略预览并说明待确认内容”这一核心要求，判定 failed。 同一路由自评，仅作研究辅助。 | [evidence/U-POL-001](evidence/U-POL-001) |
| `U-FLT-001` | 排查 172.16.1.165 到 172.16.2.100（版本服务业务服务器）无法访问，并给出修复建议；后续基于正式故障结果发起处置。 | 使用真实故障分析能力形成正式结果，区分证据、根因和建议；处置只能基于该正式结果并在必要确认后发起。工具失败时不编造诊断或处置状态。 | 已完成 | 通过 | - | - | 语义判定：被测回答通过真实只读工具（get_graph_resolve_ip_host、get_soc_asset_by_asset_id、get_reachability_path_by_ip、get_graph_path_query、get_graph_flow_host_pair_ports、get_graph_compliance_violations、get_graph_coverage、get_graph_node_detail、get_reachability_cross_signal 等）形成了正式故障分析结果，且回答中的关键数据（3617440/3617448 资产解析、目的主机 online=offline、probeState=unreachable、路径 REACHABLE 且唯一跳点 3617442=172.16.1.1 防火墙虚拟机、合规违规为空、端口流量 data:[]、collectionStatus=non_collectable、coveragePct=50、get_graph_path_query 返回 500）均与同一被测 Session 的工具回执一致，无编造。回答明确区分了事实、推断根因与证据缺口，并将工具失败（500）与无数据（data:[]）按缺口而非正常/异常处理。修复建议均标注“尚未执行”，且明确本轮未创建分析运行、未执行任何写操作，处置需用户确认后基于该正式结果发起，符合“处置只能基于正式结果并在必要确认后发起”的要求。 同一路由自评，仅作研究辅助。 | [evidence/U-FLT-001](evidence/U-FLT-001) |
| `U-QA-002` | 请只使用知识库 MCP 或 knowledge-base-search Skill，从知识库查找勒索软件事件应急响应流程；先列出当前可用知识库，再选择最相关知识库检索。回答必须列出实际检索的知识库名称、文档标题或文件名、分块序号、分数和匹配类型；如果某个知识库没有证据或 MCP、检索不可用，请明确说明，不要凭常识回答。 | 先真实列出知识库，再检索最相关知识库；回复中的知识库名、文档名、分块序号、分数和匹配类型与本轮工具结果一致。工具不可用或无证据时明确说明，且没有无来源的流程内容。 | 已完成 | 通过 | - | - | 语义判定：被测回答明确说明本轮无可用知识库：Skill 目录仅 8 个业务 Skill、knowledge-base-search 不存在、未绑定知识库 MCP、MCP 资源列举四项均被拒绝、工作区无知识库文件，并有 security-investigation Skill 第 13 行原文佐证，这些与工具回执（glob 8 个 SKILL.md、glob **/*knowledge* 无匹配、grep 仅命中该行、list_mcp_resources/templates 被拒）一致。回答未编造知识库名称、文档名、分块序号、分数或匹配类型，也未输出无来源的勒索软件应急流程，符合“明确说明不可用且不凭常识回答”的预期，故判 passed。 同一路由自评，仅作研究辅助。 | [evidence/U-QA-002](evidence/U-QA-002) |
| `U-QA-003` | 仅回答边界：故障分析专家能否直接放通防火墙策略并执行变更？如果不能，应该转交给哪个系统或流程？不要分析具体故障。 | 只说明故障分析专家不能直接执行防火墙放通，应转交策略配置或变更流程；不展开具体故障分析，不声称已执行变更。 | 已完成 | 通过 | - | - | 语义判定：回答明确声明故障分析专家不能直接放通防火墙策略或执行变更，并给出转交对象：策略配置（policy-configuration 路由/流程）或单动作应急指令（emergency-action 流程），同时说明须经受信确认插件确认、DRAFT 不等于已生效，且本轮未调用工具、未声称已执行变更。内容仅限能力边界与转交流程，未展开具体故障分析，符合预期全部要求。 同一路由自评，仅作研究辅助。 | [evidence/U-QA-003](evidence/U-QA-003) |
| `U-THREAT-FAST` | 请研判威胁事件 INC-20260917-000001。 | 从本轮名单证据判断路由；若单侧命中且名单完整，应走快速分类，`llm_invoked=false`，表示未调用内层研判模型。主会话展示程序摘要和可下载报告，不只是工具卡片。证据、实体、时间和报告内容应与本轮结果一致。报告存储失败时如实说明，不伪造下载链接。<br><br>未满足快速分类条件时，按实际证据转入完整研判并记录原因，不强行快速分类；本轮快速路径未覆盖，不据此认定快速研判验证通过。 | 已完成 | 通过 | - | - | 语义判定：本轮证据与预期一致：子智能体 analyze_threat_incident 回执 meta 显示 route=fast_classification、llm_invoked=false、validation 为 not_applicable_fast_classification，且名单命中仅单侧（alert_whitelist 命中 172.16.2.112），属快速分类路径，未调用内层研判模型。主会话展示的是程序生成的摘要（结论误报、快速研判、命中实体、引用条数 414、查询时间），并给出报告下载链接；delivery.storage 显示摘要与报告均 status=saved，下载 URL 来自 persistence，非伪造，实体、时间与运行 ID 均与回执一致，未出现存储失败需如实说明的情形。因此全部可核验要求均满足。 | [evidence/U-THREAT-FAST](evidence/U-THREAT-FAST) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
