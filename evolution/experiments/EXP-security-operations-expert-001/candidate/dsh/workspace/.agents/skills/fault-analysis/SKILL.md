---
name: fault-analysis
description: "面向 SOC 场景执行故障分析。适用于用户提供故障问题、告警、工单、业务访问异常、资产关联异常或增量分析请求时。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 安全约束

- 命中故障分析后，最终结果前禁止输出任何可见文本。不得向用户展示“正在识别”“读取 Skill”“确认 MCP 工具”“生成计划”“冻结计划”“并行取证”“提交结果”“分析收口”“查询状态”等过程说明；这些内容只能进入 Trace。第一段可见正文必须来自 `fault_analysis_get_result.user_response_markdown` 或运行时返回的阻断说明。
- “我收到故障排查请求”“让我先加载故障域”“现在构建取证计划”“任务已创建”“正在执行 L1/L2”“提交返回 400”“尝试调整 JSON”“改用替代工具”“收口失败后我基于已完成取证给出结论”等过程句都属于内部编排说明，普通正文一律不得输出。
- 本故障分析能力是故障分析的唯一正式入口；主 Agent 识别到故障排查意图后必须先调用本能力，不得直接调用故障分析 Runtime MCP 或 SOC 取证工具。
- 本故障分析能力在当前主会话加载并读取完整用户输入、前序上下文摘要和当前可见 MCP 工具；不得以 fork 空任务、可选 args 或子会话状态替代当前用户问题。
- 故障分析只做分析、取证编排、证据解释和用户可读表达，不执行响应处置动作。
- 故障域识别、取证能力选择、MCP 工具选择和业务证据解释由本能力及故障域 Skill 负责；故障分析运行时服务只负责冻结计划、校验提交、统一收口、入库和报告。
- 不执行 Bash。
- 不运行本地 Python。
- 不自行执行规则命中。
- 不手算候选根因置信度。
- 不凭经验补造工具结果。
- 不在运行时收口失败、报告未生成、入库未完成或最终结果未取得时，基于已经看到的 SOC 工具结果自行拼写“受限完成”“直接原因”“初步结论”“建议下一步”或故障分析报告。
- 不调用隔离、封禁、策略修改、账号禁用、删除等写操作。
- 不自行扩写完整内部产物；可下载故障分析报告必须使用 `get_result` 返回的下载报告引用。
- 故障分析 MCP 主流程工具不可用时停止正式分析，不允许退回本地脚本、手工规则或经验报告。
- 故障分析正式取证只允许执行运行时已冻结计划中的 SOC 只读工具；不得自行增加计划外 SOC 工具。MCP 工具是否存在由 Gov / `Runtime MCP 声明` 当前挂载环境决定，运行时不维护 MCP 工具目录。
- 内部英文状态、规则 ID、产物文件名和字段名不得作为面向用户的主输出内容。
- 用户正文和 Trace 必须分层：内部工具方法名、完整 MCP 工具名、MCP server 前缀、运行时内部字段名和英文枚举只允许留在 Trace、审计记录或用户明确要求排查 Trace 的技术说明中；普通最终正文必须压成中文业务表达。若故障分析启动工具连接失败，正文只能表达为“故障分析运行时服务无法连接，无法创建正式分析任务”；若计划未完成，正文只能表达为“故障分析计划未完成，无法创建可执行取证计划”。不得在普通正文中出现 `fault_analysis_start`、`fault_diagnosis MCP`、`mcp__sec-ops__...` 等内部名称。
- 故障分析执行期间默认静默处理，不向用户展示内部计划生成、字段修正、参数格式调整、工具能力查看、MCP 调用、运行目录、取证编号、英文原因码或重试过程。最终正文只能展示用户可理解的故障分析结果；不得出现 `agent_planning_result`、`run_dir`、`ToolCallPlan`、`MCP 工具`、`fault_analysis_*`、`NO_ROUTE`、`src_no_gateway` 等内部字段、工具名或原因码。
- 面向用户的过程说明不得出现 `fault-analysis Skill`、`fault-analysis` 或 `Skill`，应表达为“故障分析能力”或“故障分析流程”。内部技能标识只用于路由，调用前不得输出“让我调用 fault-analysis Skill”“调用 Skill”等过程说明。
- 若内部推理曾误判为威胁研判、巡检执行或其他子智能体路由，必须静默回到故障分析主流程；不得向用户输出“误触发”“重新处理”“尝试其他工具名”等过程解释。
- 同一用户请求内只允许创建一次正式故障分析运行。只要启动分析已经返回 `run_id` 或 `run_dir`，无论后续 SOC 取证工具失败、计划外工具被拒、配置缺口、收口失败或报告暂未就绪，都不得再次调用启动分析工具、不得改写用户问题重新分诊、不得创建第二个运行来覆盖第一个运行的问题。只能围绕当前 `run_id` 继续回填取证结果、分析收口、查询状态或获取结果；若当前运行不能完成，按当前运行返回受限完成、流程阻断或分析失败。只有用户明确发起新一轮重新分析，或启动分析未返回 `run_id` / `run_dir` 时，才允许创建新的正式故障分析运行。
- 调用启动分析工具前必须先完成 `agent_planning_result`。可执行计划必须包含故障域、证据契约和非空工具计划；每个计划项必须声明工具名、能力、证据类型、对象角色、参数、依赖和用途。故障域 Skill 中的 `tool_call_plan` 示例必须被填充为当前对象的真实计划，严禁复制空数组、占位符工具名或“稍后补齐”的计划。第一次故障分析 MCP 调用必须是携带完整 `agent_planning_result` 的启动分析调用；无法生成可执行计划时，只能提交带明确阻断原因的 invalid 计划，或直接向用户说明“故障分析计划未完成，无法创建可执行取证计划”，不得先启动再补计划。
- 计划自检必须校验依赖闭包：每个 `depends_on` 和每个 `runtime_argument_sources[].from_tool_call_id` 都必须引用本计划内已存在的 `tool_call_id`，不得出现拼写漂移、自身依赖或引用历史计划项。自检失败时不得启动正式分析任务。
- 计划未完成或计划无效属于内部流程问题。面向用户只能使用固定公开话术：“故障分析计划未完成，无法创建可执行取证计划。本轮不会执行正式取证，也不会输出根因结论。请修复故障分析取证计划配置后重新发起。”不得解释内部依赖名、字段名、工具名、状态码或运行目录；不得要求用户补端口、协议、时间窗口、资产名称等与本次内部计划错误无关的信息。
- 生成 `agent_planning_result` 不依赖先查 SOC 数据。只能依据当前用户输入、前序上下文摘要、当前可见工具列表和故障域 Skill 模板生成取证计划；不得以“先确认当前配置的 MCP 工具能力”为理由调用任何 SOC 工具，也不得以“先查询资产/路径/事件来生成计划”为理由调用任何 SOC 工具。若无法从当前可见工具列表确定可执行工具名，必须返回计划未完成，不得调用启动分析工具提交空计划。启动分析工具如果返回计划未完成、计划无效或终止型结果，必须立即停止，并只输出返回中的用户可见说明；不得继续查询状态、读取 Trace、提交伪结果、分析收口或重新创建运行。
- 生成取证计划时不得调用 `ListMcpResourcesTool`、`ReadMcpResourceDirTool`、`skill-manager` 资源或 `sec-ops` 资源列表探路；故障域 Skill 模板已经给出计划骨架，工具是否真实存在以后续冻结计划和实际调用结果为准。
- `fault_analysis_submit_tool_result` 只用于回填冻结计划内 SOC 工具的真实执行结果，不得用来提交、补写、修复或冻结取证计划。
- `fault_analysis_finalize` 只用于所有计划项已执行、失败、跳过或降级后的分析收口，不得用来冻结计划、补计划、试探运行状态或弥补未执行取证。
- `fault_analysis_get_trace` 只用于用户明确要求排查 Trace 或技术复盘；普通故障流程不得通过读取 Trace 来反推协议、生成计划或补救错误路径。
- 即使运行时返回的内部执行说明中出现 cleanup、get_trace、full_plan_ref、run_dir、重新创建运行等调试提示，普通故障流程也不得执行清理、读 Trace、重建运行或把这些内部字段输出给用户。
- 若 `fault_analysis_finalize`、状态查询或最终结果查询返回运行时内部异常、代码异常、产物缺失、入库失败或报告生成失败，普通正文只能输出：“本轮故障分析已被运行时收口异常阻断，无法生成可信最终结果、下载报告或入库记录。请修复故障分析运行时服务后重新发起。”如已有运行编号，可以附加运行编号。不得继续同步重试、不得改参数重试、不得用已完成取证结果自行输出根因、候选根因或处置建议。
- 当前输入里的源对象、目标对象和异常信号优先于历史上下文。历史上下文只能补充时间、业务背景或上游摘要；若历史源目与当前输入冲突，不得静默使用历史 IP，不得反转当前源目，必须按当前输入生成计划，无法消解时按计划未完成处理。

## 输入

用户可能提供自然语言问题，也可能由 Gov 传入结构化任务包；也可能在同一会话中承接前序上游异常上下文。优先读取 `AGENTS.md`。高危漏洞、CVE、暴露风险异常、资产离线、探测不可达、访问路径不可达、主机安全配置异常、资产纳管或资产关联异常都属于故障分析输入，不得退回普通安全运营查询。

正式请求、响应、状态码、规则结果、报告材料和入库结果以 MCP 工具 schema、运行产物引用和返回结果为准。workspace 保留智能体指令、故障域 Skill、业务证据契约、提示词边界和 MCP 调用协议；Runtime MCP 保留运行状态、存储、报告和统一收口规则。

`fault_analysis_start` 接收用户问题或 Gov 任务包。最小输入必须包含：

- `original_question`：用户原始问题。
- `session_id` 或 `conversation_id`：有则传入，没有则由运行时生成占位标识。
- `task_id`：有则传入，没有则由运行时生成。
- `trigger_type`：用户直接提问时使用 `chat`。
- `agent_planning_result`：启动前已由本能力和主故障域 Skill 生成；除显式 invalid 计划外，不得为空，不得在启动后再补。

缺少端口、协议、时间窗口、资产名称、错误表现等字段时，不阻断启动；运行时会记录缺失字段和默认假设。

入口归一化边界：

- 如果当前输入、任务包或上游上下文中已经包含“巡检：”“工单：”“告警：”等来源前缀，应只把后面的异常对象、异常现象和已知事实作为故障分析问题信号；来源前缀本身不得作为故障域、候选根因或证据。
- 如果当前输入、任务包或上游上下文中已经包含上游异常结果、摘要、运行记录片段或用户基于上游结果的追问，应把这些上下文随 `fault_analysis_start` 一并传入。
- 不要求固定 Gov 内部字段名，不关心 Gov 如何完成同会话上下文传递。
- 故障分析智能体不得调用巡检 MCP、巡检服务接口或数据库去反查 run_id；run_id 只能作为上下文引用，不作为跨服务读取凭据。
- 运行时会把访问路径不可达、资产离线或不可达、漏洞、主机安全配置异常、资产纳管或资产关联异常、路径合规异常、检测 / 告警链路异常、异构策略迁移后访问异常、级联数据同步异常、身份认证与登录访问异常等问题信号接入对应故障域正式流程；证据是否充足只由正式取证结果决定。
- 若当前可见 MCP 工具无法支撑某个取证能力，必须在 `agent_planning_result` 中记录证据缺口或未完成验证项；不得退回通用安全运营模板，不得把巡检风险直接写成已确认根因。

默认假设只用于流程启动、查询范围约束和证据缺口记录。默认假设不得作为事实证据、规则命中依据、根因结论依据或置信度加分依据。

默认假设边界：

- 时间窗口默认值只用于事件、日志和变更线索查询，不代表故障真实发生时间。
- 端口或协议缺失时，可以先做源目对象、路径、拓扑、策略概览、事件和资产状态类取证，不得默认具体端口、协议或服务监听状态。
- 资产名称缺失时，可以用 IP 做资产解析，不得编造资产名称、业务系统归属或服务角色。
- 错误表现缺失时，只能记录为“具体错误表现未知”，不得默认超时、拒绝、丢包、DNS 失败等具体故障表现。
- 缺失字段影响端口级策略、服务状态、时间一致性或错误类型判断时，必须进入证据缺口、置信度限制或人工补充项。

## 工作流

MCP 运行入口：
- 启动分析：`mcp__sec-ops__fault_diagnosis__fault_analysis_start`
- 提交 SOC 工具结果：`mcp__sec-ops__fault_diagnosis__fault_analysis_submit_tool_result`
- 完成分析：`mcp__sec-ops__fault_diagnosis__fault_analysis_finalize`
- 查询状态：`mcp__sec-ops__fault_diagnosis__fault_analysis_get_status`
- 查询结果：`mcp__sec-ops__fault_diagnosis__fault_analysis_get_result`
- 查询轨迹：`mcp__sec-ops__fault_diagnosis__fault_analysis_get_trace`

故障域 Skill 选择清单：

- 普通源目访问不通、超时、路径不可达：`fault-domain-business-access-unreachable`
- 单资产离线、不可达、探测失败、采集异常：`fault-domain-asset-runtime-status`
- 资产未纳管、归属缺失、业务影响范围异常：`fault-domain-asset-association-abnormal`
- 明确策略变更、策略当前态 / 历史 / 差异后访问异常：`fault-domain-policy-change-access-abnormal`
- 明确主备切换、HA 同步、双机策略差异后访问异常：`fault-domain-ha-policy-drift`
- 安全设备配置偏离、防火墙 / 交换机 / 路由器配置异常：`fault-domain-security-device-config-drift`
- 主机基线、弱口令、SSH/RDP/安全配置风险：`fault-domain-host-security-configuration-risk`
- 高危漏洞、CVE、暴露服务、漏洞利用风险：`fault-domain-vulnerability-exposure-risk`
- 路径合规失败、应达路径和实际路径不一致、专项拓扑路径违规：`fault-domain-path-compliance-abnormal`
- 日志到告警链路、检测规则、关联规则、检测任务、告警漏报误报延迟：`fault-domain-detection-alert-pipeline-abnormal`
- 异构策略迁移、厂商策略迁移、迁移后对象组 / 服务组 / NAT 异常：`fault-domain-heterogeneous-policy-migration-access-abnormal`
- 上下级 SOC 数据不一致、级联同步失败、级联链路异常：`fault-domain-cascade-data-sync-abnormal`
- 用户名口令、人脸、指纹、指静脉、认证服务器、权限菜单、403 等登录认证异常：`fault-domain-identity-auth-login-abnormal`

1. 构造或校验故障分析任务包，保留 `session_id` / `conversation_id`、`task_id`、原始问题，以及当前输入中已经包含的上游异常上下文。
2. 根据当前问题选择一个主故障域 Skill；当前输入对象优先于历史上下文，源 IP、目标 IP 不得反转。故障域 Skill 负责生成 `agent_planning_result`，其中必须包含 `domain_id`、`tool_call_plan`、`evidence_contract`、`candidate_causes` 或候选生成规则、`output_policy`。
3. `agent_planning_result.tool_call_plan[]` 必须逐项声明 `tool_call_id`、`tool_name`、`capability_id`、`evidence_type`、`object_role`、`resolved_arguments`、`depends_on` 和 `purpose`；业务证据契约由故障域 Skill 随计划提交，运行时不从工具名反推能力。
4. 调用启动分析工具前执行计划自检：除显式 invalid 计划外，`agent_planning_result.tool_call_plan` 必须为非空数组，且每个计划项具备第 3 步字段；每个 `depends_on` 和 `runtime_argument_sources[].from_tool_call_id` 必须引用同一计划内已存在的计划项。自检失败时不得调用启动分析工具，不得尝试直接 SOC 取证，不得读取 Trace 探路，不得重建运行。
5. 调用 `mcp__sec-ops__fault_diagnosis__fault_analysis_start`，入参必须包含原始问题和 `agent_planning_result`。这是本轮第一次故障分析 MCP 调用；如果无法在本次调用前生成完整计划，禁止调用该工具。
6. 读取返回的 `run_id`、`run_dir`、缺失字段、默认假设、分析状态和运行时冻结后的执行计划。取证计划列表位于 `tool_call_plan.tool_call_plan`。
   - 同一用户请求内，本步骤成功返回 `run_id` / `run_dir` 后不得再次执行第 5 步；后续异常只能在当前运行内收口或返回当前运行的失败 / 阻断状态。
7. 若运行时返回计划未完成、计划无效或 `terminal=true`，说明本轮没有可执行冻结计划；不得调用 SOC 工具，不得提交伪工具结果，不得调用分析收口，不得查询状态，不得读取 Trace 探路，不得清理当前运行后重建，不得输出根因结论。普通正文只能使用固定公开话术，不得复述状态码、依赖名、字段名或工具名。
8. 除运行时明确标记为 invalid 的阻断信封外，空取证计划一律视为计划未完成，按固定受限话术结束。不得绕过冻结计划直接输出 `user_response_markdown`。如产品需要“无取证即终态”，必须由 Runtime 另行实现版本化且可验证的 terminal schema。
9. 按 `tool_call_plan.tool_call_plan` 调用冻结计划内 SOC 只读查询工具。
10. 执行计划项前检查 `argument_resolution`；兼容历史扁平字段 `argument_resolution_status`。`deferred_until_dependency_result` 只允许存在于启动前的规划意图，fault Runtime 必须解析依赖并在正式冻结计划中返回 `ready` 与完整 `resolved_arguments`。Runtime 返回的计划项若仍为 deferred、参数为空或含未解析值，停止取证并返回运行时阻断状态或请求人工确认；模型不得从前置结果自行补参后直接调用。
11. 只允许使用 Runtime 返回的 `ready` 冻结参数；不得把 `<...>`、空 `assetId`、空 `vid` 或未解析占位符传给 SOC 工具。
12. 每个工具结果调用 `mcp__sec-ops__fault_diagnosis__fault_analysis_submit_tool_result`，提交 `run_dir`、工具名、调用参数、`capability_id`、`evidence_type`、状态、真实返回和 `result_summary`。`result_summary` 是确定性状态投影，只能按 `status` 精确取固定值：成功为“取证调用已成功完成，原始结果已按可信返回提交。”，失败为“取证调用执行失败，原始错误已按可信返回提交。”，超时为“取证调用执行超时，原始错误已按可信返回提交。”；不得自行概括、解释或改写证据，不得把完整原始 JSON 塞入摘要。真实字段只保留在受信 `content` / `error` 中。
13. 所有计划工具完成、失败、超时或降级后，调用 `mcp__sec-ops__fault_diagnosis__fault_analysis_finalize`；默认使用异步收口，不得为压缩轮次强制设置 `wait_for_completion: true` 或 `synchronous: true`。
14. `finalize` 返回后台处理中时，最多调用 `mcp__sec-ops__fault_diagnosis__fault_analysis_get_status` 3 次查询进度；3 次是单次 Agent 会话内防止空转的轮询上限，不是后端报告任务的重试上限。状态为 `response_ready` 后调用 `mcp__sec-ops__fault_diagnosis__fault_analysis_get_result` 获取面向会话的瘦结果。
15. 最终回复必须逐字输出 `fault_analysis_get_result.user_response_markdown`，与受信正文精确一致，不得做格式整理、净化、补充、删减或改写；Runtime 对该字段的内容安全、中文表达、运行编号和下载入口负责，SubagentStop 守卫会校验最终正文摘要。

故障分析工具链执行期间不得输出过程说明；工具调用、计划生成、字段补齐、参数修正、失败重试和阶段进度都只记录在 Trace。未成功调用 `fault_analysis_get_result` 前，不得向用户输出任何普通文本、阶段提示、取证摘要或正式故障分析结论。不得输出 `call-001`、`call-005`、L1/L2、工具函数名、`agent_planning_result`、`run_dir`、`ToolCallPlan`、`MCP 工具`、`fault_analysis_start`、`fault_analysis_submit_tool_result`、`finalize`、`get_status`、`get_result`、artifact、产物文件名、英文状态码、“第几轮并行”、“补充字段”“调整参数格式”“查看 MCP 工具能力”“误触发威胁研判”或“尝试其他工具名”等内部编排细节，也不得复述工具返回 JSON。`fault_analysis_finalize` 是运行收口和落库步骤，不是最终答复来源。即使 `finalize` 返回中已经包含可读结论，也必须继续调用 `fault_analysis_get_result`；未成功调用 `get_result` 前，不得输出正式故障分析结论。若 3 次状态查询后仍未就绪，只返回“报告仍在生成中，本次会话已达到等待上限，暂不能返回完整报告。请稍后重新发起同一问题，或将运行编号提供给管理员后台查询。”以及 `run_id`，不得输出 `run_dir`、刷新提示、已取证据摘要、故障结论、候选根因或内部原因码；也不得在本轮会话内自行重新创建正式分析运行。

如果运行时已识别出当前输入中的源 IP、目标 IP、资产名称或巡检上下文，不得对用户输出“未能从原始输入中正确提取源 IP 和目标 IP”“需要重新启动并提供清晰参数”等与运行时结果相反的判断。只有运行时明确返回对象缺失、角色冲突或需要补充信息时，才按返回正文说明。

如果 `fault_analysis_get_status` 或 `fault_analysis_get_result` 返回 `status=flow_blocked`、`result_shape=flow_blocked_summary`，或显示主流程取证被平台工具调用规则、权限、配置阻断，则仅逐字输出 `user_response_markdown`；不得输出根因判断、候选根因、业务处置建议、补充端口 / 协议 / 时间 / 资产名称等普通证据不足建议，也不得把阻断解释成 SOC 数据为空。

如果启动正式分析任务后返回计划未完成、计划无效或 `terminal=true`，说明智能体没有提交可冻结的结构化取证计划，或计划缺少必要元字段。此时停止正式取证，不得直接调用 SOC 工具补救，不得用 `fault_analysis_submit_tool_result` 补交计划，不得用 `fault_analysis_finalize` 试图冻结计划，不得查询状态，不得读取 Trace 探路，不得清理后重建运行，不得输出根因判断；普通正文只能使用固定公开话术：“故障分析计划未完成，无法创建可执行取证计划。本轮不会执行正式取证，也不会输出根因结论。请修复故障分析取证计划配置后重新发起。”

如果收口、状态查询或最终结果查询显示运行时内部异常、代码异常、产物缺失、报告未生成或入库未完成，说明本轮没有可展示的正式分析结果。此时不得把已经执行的取证结果整理成替代报告，不得输出“基于已完成取证结果”“初步结论”“直接原因”“受限完成”或普通补查建议；只输出固定阻断话术和运行编号。

如果 `fault_analysis_get_result` 返回 `user_response_markdown`，最终回复必须与该字段逐字一致。不得改写成自己的表格、编号步骤、风险等级、处置建议或安全运营模板，不得净化、添加运行编号或另行拼接下载链接；这些内容如有需要，必须由 Runtime 在受信字段中一次性生成。

`fault_analysis_start` 返回的是执行版瘦身计划，只保留正式取证需要的工具名、依赖、参数来源、提交要求和执行规则。完整计划保存在运行轨迹中，仅用于审计回溯，不由普通执行返回暴露引用，也不得用于扩大正式取证工具范围。

每次 SOC 工具执行结束后，必须提交：

- `run_dir`
- `tool_call_id`
- `tool_name`
- `capability_id`
- `evidence_type`
- `object_role`
- `input`
- `status`
- `content`
- `result_summary`
- `error`，仅工具失败时提供

`fault_analysis_finalize` 负责标准化工具结果、归一化证据、执行规则命中、组装候选根因、执行轻量竞争根因复核、计算置信度、写入分析记录、生成根因分析报告、生成故障分析报告输入包、生成可下载故障分析报告、生成 Gov / 用户可读响应，并清理运行期原始大对象。业务取证能力和业务证据契约来自本次 `agent_planning_result`，运行时只保证结构、状态、存储和报告一致。

清理步骤不会删除整个 `run_dir`。`run_dir` 中的结构化产物会保留，用于后续 `fault_analysis_get_result`、`fault_analysis_get_trace`、界面回溯和问题复盘。

## 参考资料

以下文件只作为表达边界参考，按需要读取，不替代 MCP 返回的结构化结果：

- 分诊表达边界：`references/triage.md`
- 取证计划解释边界：`references/evidence-plan.md`
- 证据解释边界：`references/evidence-explain.md`
- 候选根因表达边界：`references/hypothesis.md`
- 报告材料组织边界：`references/report-organize.md`

## 输出

输出内容必须来自 MCP 返回结果，并使用中文表达：

- 逐字输出 `user_response_markdown`，不增加任何前后缀。
- 不得添加运行编号、入库记录数量、下载入口或可回溯说明；Runtime 必须将允许展示的内容写入受信正文。
- 内部规则 ID、英文枚举值、产物文件名和字段名不得作为主输出内容。
- 输出前必须做正文净化自检；最终正文不得出现 `call-数字`、`ToolCallPlan`、`agent_planning_result`、`run_dir`、`MCP 工具`、`soc_graph__...`、`ai_soc_graph__...`、`soc_master__...`、`ai_soc_event__...`、`mcp__sec-ops__...`、`fault_diagnosis MCP`、`fault-analysis Skill`、`fault-analysis`、`Skill`、`fault_analysis_start`、`fault_analysis_submit_tool_result`、`src_no_gateway`、`NO_ROUTE`、`SRC_NOT_FOUND`、`DST_NOT_FOUND`、`planning_required`、`planning_invalid`、`plan_incomplete`、`online`、`offline`、`reachable`、`unreachable`、`succeeded`、`failed`、`skipped`、`finalize`、`get_status`、`get_result`、L1、L2、artifact、`16-user-response.json`、“我成功”、“误触发威胁研判”等内部取证编号、工具函数名、原因码、英文状态、病句或产物名。
- 最终结果前不得输出过程说明、阶段提示、内部工具名、取证编号、并行组、层级或产物文件名；完整过程只保留在 Trace。

默认返回结构中：

- `result_shape=conversation_summary` 表示面向会话展示的结果摘要。
- `result_shape=flow_blocked_summary` 表示主流程已被平台规则、权限或配置阻断，只能输出阻断说明。
- `user_response_markdown` 是用户可见首选文本。
- `downloadable_reports` 是本轮可下载故障分析报告引用；如 `user_response_markdown` 已包含下载入口，不要重复扩写。
- `storage_write_result.record_count` 是本轮写入记录数量。
- `artifact_refs` 只用于说明可回溯产物，不要求展示给普通用户。

内部字段输出给用户时必须翻译为中文。示例：

| 内部值 | 用户表达 |
| --- | --- |
| `call-001` / `call-002` | 源资产取证 / 目标资产取证 |
| `call-003` | 主路径可达性取证 |
| `call-004` | 路径交叉验证 |
| `call-005` | 资产路径取证 |
| `call-006` | 事件和告警取证 |
| `ai_soc_graph__get_graph_path_query` | 网络路径查询 |
| `ai_soc_graph__get_reachability_path` | 资产可达性路径查询 |
| `ai_soc_master__list_8` | 资产信息查询 |
| `ai_soc_event__post_event_search` | 事件和告警检索 |
| `src_no_gateway` | 源侧网关缺失 |
| `NO_ROUTE` | 无可用路由路径 |
| `SRC_NOT_FOUND` | 源 IP 未纳管或未识别为资产 |
| `DST_NOT_FOUND` | 目标 IP 未纳管或未识别为资产 |
| `planning_required` | 智能体未提交可冻结取证计划 |
| `planning_invalid` | 智能体提交的取证计划缺少必要元字段 |
| `online` / `reachable` | 在线 / 可达 |
| `offline` / `unreachable` | 离线 / 不可达 |
| `succeeded` | 成功 |
| `failed` | 失败 |
| `skipped` | 跳过 |
| `我成功` | 成功 |
| `fault_analysis_start` | 创建正式分析任务 |
| `fault_analysis_submit_tool_result` | 回填取证结果 |
| `partial` | 受限完成：已有候选结论，但证据不足以确认最终根因 |
| `candidate_only` | 只能输出候选根因，不能确认最终根因 |
| `manual_required` | 需要人工补充验证 |
| `blocked` | 当前阻塞 |
| `route_data_gap` | 路由数据缺口 |
| `evidence_insufficient_cap` | 证据不足导致置信度封顶 |
| `fault_analysis_finalize` / `finalize` | 分析收口、生成报告和写入记录 |
| `fault_analysis_get_status` / `get_status` | 查询报告生成状态 |
| `fault_analysis_get_result` / `get_result` | 获取最终分析结果 |
| `fault_diagnosis MCP` | 故障分析运行时服务 |
| `mcp__sec-ops__...` | 冻结计划内的 SOC 只读取证能力 |
| `wait_for_completion` / `synchronous` | 同步等待 |
| `response_ready` | 报告已生成 |
| `flow_blocked` | 故障分析流程被平台规则阻断 |
| `run_dir` | 运行目录或后台记录位置 |

SOC 工具失败时，将失败记录提交给 `fault_analysis_submit_tool_result`，由 `fault_analysis_finalize` 统一判断。若取证失败属于普通接口失败或数据缺口，按运行时结果输出降级说明、证据缺口和下一步补查建议；若取证失败属于平台规则、权限或配置阻断，必须输出流程阻断说明，不得输出业务补查建议。
