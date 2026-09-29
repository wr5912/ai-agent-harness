---
name: emergency-action
description: 独立应急指令：将用户明确要求的单动作、单目标处置提交 Workbench 准备，展示冻结摘要并查询后台结果。用户要求执行应急指令、隔离一个目标或查询/修改/取消应急操作时使用；一般调查、策略配置、响应剧本规划不使用。
---

# 独立应急指令

使用 emergency-action MCP 的六个工具：prepare_emergency_action、revise_emergency_action、get_emergency_action、list_emergency_actions、get_emergency_action_result、cancel_emergency_action。工具命名可能带资源前缀，以实际目录为准。不要加载策略或响应业务 Skill 代替此流程。

1. 先从用户原话提取明确的设备 IP、设备 ID 或主机名作为 target_hint；目标不明确时先请用户补充。将原始意图、target_hint 和已知参数交给 prepare，action_key 仅在用户明确指定 SOC 动作键时提供，由 Workbench 先查资产，再核对该设备可执行的动作。用户明确说出的源 IP 和端口分别填写 `params.src_ip`、`params.port`，例如“封禁源 IP 198.51.100.77 的 443 端口”应传 `{"src_ip":"198.51.100.77","port":"443"}`；账号用户名填写 `params.user`，不要填写 `params.account`。不可省略已明确的参数，也不可猜测未提供的值。MCP 的 prepare、revise、cancel 工具将 JSON 请求体放在 `body` 字段中；操作号放在工具顶层 `operationId`。request_id 是本次命令的唯一幂等键，重试原命令时保持不变。不得把目标提示自行认定为稳定目标，不得编造目录、参数或授权。
2. 以 Workbench 的 required_next_action 为准：CLARIFY/SELECT_TARGET 时只询问缺失项；UNAVAILABLE 时说明 readiness 中的缺失能力并结束本轮，不声称已提交。修改使用 revise，携带当前 expected_version、新的 request_id 和完整 intent，完整提交替换内容。拿到冻结草案后必须核对动作是否与用户原话相同：解除封禁对应 `host-unblock-ip` 或带端口的 `host-unblock-ip-port`，不能把 `host-block-ip` / `host-block-ip-port` 当作解除。若初次草案动作相反，仅在 Workbench 回执给出可修订状态且能明确选择原目标动作时修订一次；修订未得到正确草案则说明无法准备，不展示错误草案的确认方式。
3. CONFIRM 时用简短的对话摘要展示：动作与目标（优先可识别的设备名/IP，必要时附 agent ID）、会改变执行含义的参数、操作号，以及“请在本会话单独发送‘确认执行’”。可能中断业务或难以恢复时，再用一句话说明主要影响/恢复方式。默认不展开检查清单、内部状态、版本、snapshot_digest、过期时间和完整冻结 JSON；用户追问时再按需说明。后台仍保存完整冻结摘要，受控确认仍严格绑定操作号、版本、摘要和有效期；SOC 审批与用户确认是两步。
4. 当前 DSH Web 的用户在同一会话对最新有效草案单独发送“确认执行”时，受控运行时会绑定会话、草案版本与摘要并签名提交。模型没有确认工具，不生成或转发 confirmation_event_ref，不调用原始 SOC manual/execute，不指定 operator、triggerSource 或跳过审批。受控运行时的结果是本轮确认状态依据；不得把刚入队的 `QUEUED/UNKNOWN/NOT_SUBMITTED` 当作终态。
5. WAIT 表示已排队、受理或后台查账，简短告知当前状态与操作号后结束本轮。不要 Bash sleep 或自行循环查询。用户稍后查询时调用 get/result；不知道操作号时 list，不猜测“最新的就是当前的”。SOC 动作台账 `SUCCESS` 或 Workbench 从 SOC 同步的 `SUCCEEDED`，按当前阶段判为指令执行成功；审批中、执行中、失败和提交状态待查账分别如实表述。确认回执和后续查询都默认用最多两行：`执行结果：成功/失败/审批拒绝` 或 `当前进度：待审批/执行中/处理中`；下一行 `操作号：...`，若有 SOC 执行号则同行附上。操作号只出现一次；不复述 Workbench 阶段、审批/执行枚举或同步状态。用户未明确询问设备证据时，不解释原始回显、`affected`/`error`，也不据此猜测设备是否真正生效；询问时如实说明证据局限。设备原始回显缺失不把 SOC 的成功降为未知。
6. 取消仅用于尚未提交的操作，携带当前版本；已提交不可用本地取消冒充 SOC 撤销。以 SOC 权威状态确定结果，不自动发起补偿或第二个动作。

readiness 分项为 read、prepare、confirm、submit、reconcile。可查询不等于可提交。提交超时的 SUBMISSION_UNKNOWN 表示可能已受理，后台仅按原请求号查账，禁止重新 prepare/confirm 来规避未知状态。

## DSH 工具与当前停点

只允许 `mcp__emergency-action__prepare_emergency_action`、`revise_emergency_action`、`get_emergency_action`、`list_emergency_actions`、`get_emergency_action_result`、`cancel_emergency_action` 六个同前缀工具。`prepare`、`revise`、`cancel` 的请求体放在 `body`；`revise/get/result/cancel` 的操作号放在顶层 `operationId`。到达 `CONFIRM` 时只展示冻结草案的关键内容和操作号，等待用户在同一会话单独发送“确认执行”；确认后的结果由受控运行时提交并回传，模型按简短状态如实转述。
