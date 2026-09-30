---
name: policy-configuration
description: 用户明确要求新增主机到主机网络访问策略时，经 Workbench V2 准备普通或指定设备 DRAFT；多候选排序，确认前不下发。
---

# 网络访问策略配置（迁移候选）

本 Skill 选择性迁移旧链路能力。只覆盖明确要求放通、允许或开通访问的 `ADD`，对象为 IPv4 主机到主机、TCP/UDP 单目的端口。阻断、拒绝、禁止访问是相反动作，不能借 `ADD` 放行策略工具提交；用户询问、故障排查、巡检以及 MODIFY/DELETE 也不进入本轮策略写入路线。超出能力时说明当前边界并停止，不调用准备工具。不得建议把拒绝需求改述为放通，或直接转入只支持单目标封禁的应急路线。DSH 主 Agent 是低权限协议客户端；设备身份、拓扑可达、候选冻结、Preview 和 DRAFT 均由 Workbench 判断，不能自行查询拓扑、设备映射、直接调用 Preview 或猜测设备。

## 参数与设备门禁

- 用户必须给出源 IPv4、目的 IPv4、TCP/UDP 协议、1–65535 的目的端口和明确的新增意图；缺失时只追问，不调用工具。
- 参数不足时只列出本轮用户尚未提供的必需参数及本路线能力边界；不得把本 Skill 的结构示例、其他会话内容或模型推测当作已确认参数，也不得声称当前会话已有草稿、Operation、taskId 或设备选择。只有本会话真实工具回执才能建立这些状态。
- 只续查当前会话成功 prepare 回执中的 operation ID。用户提供、其他会话或文档中的操作号不能作为续查依据；当前会话尚无操作号时直接说明无法查询，不要求用户贴旧操作号。
- intent 使用 `workbench-policy-intent/v1`、`policy_kind=NETWORK_ACCESS`、`operation=ADD`、IP selector、`target_external_id=null`。除下述经旧链路证实的 `device_query` 外，不补造额外字段。
- 用户明确指定防火墙名称、设备 ID 或管理 IP 时，将原话中的单一设备线索原样放入 `intent.device_query`；不指定设备时省略该字段。不得把 ADD 的设备线索改写为 DELETE 文档字段 `device_name`，也不得丢弃约束后按普通开通。调用前核对 MCP 工具参数表包含 `device_query`；若工具客户端拒绝该字段，停止并记录为客户端合同障碍，不暗中换字段或声称成功。
- 用户给多个设备或描述有歧义时先澄清；用户指定设备不在路径、未在线、无 ACL 能力或解析失败，以 Workbench 的失败结果为准，不能改选其他设备。
- 本轮不接受网段、MODIFY、DELETE，也不把“关闭/停用”解释为 DELETE。
- 用户把单个 IPv4 称为“网段”但没有给出掩码时，先澄清要单主机还是具体 CIDR；不得默认为主机并准备草稿。用户要求有效期、截止时间或持续时长时，本轮先说明限时下发与到期语义尚未端到端验证并停止，不得省略时间约束后生成永久策略，也不得自行推算起止时间后声称已包含有效期。
- 本地原生 Guard 拒绝工具调用时，准确说明是当前 DSH 运行时门禁拦截；只有 Workbench 或 SOC 实际返回拒绝，才说对应服务拒绝。工具调用被拦截后不得推断上游已受理、已拒绝或已执行。

普通开通的结构示例（地址仅示意，实际值必须来自用户）：

```json
{
  "contract_version": "workbench-policy-configuration/v2",
  "request_id": "本轮生成并保存的唯一幂等 ID",
  "intent": {
    "schema_version": "workbench-policy-intent/v1",
    "policy_kind": "NETWORK_ACCESS",
    "operation": "ADD",
    "source": {"selector_type": "IP", "value": "192.0.2.10"},
    "destination": {"selector_type": "IP", "value": "198.51.100.20"},
    "protocol": "TCP",
    "destination_port": 443,
    "target_external_id": null
  }
}
```

指定设备时在同一 `intent` 增加 `"device_query": "用户原话中的设备名称或 ID"`；上述地址仅示意，不能照填。

## 条件协议

1. 装载 Skill 且确认参数完整后、首次 prepare 前，先向用户输出且只输出一次固定过渡语：`已进入策略配置流程，正在提交资产与可达路径分析请求……`。随后立即调用 `mcp__policy-configuration__prepare_policy_configuration`，不要再添加计划、英文旁白或未经证实的阶段结论。此句仅说明请求正在发起，不代表资产、路径或草稿已经校验完成；参数不完整时不输出。对完整请求只调用一次 prepare；同一业务轮次生成一个唯一 `request_id` 并保存，绝不因失败或超时重新 prepare。只接受成功响应 `data.operation_id` 作为后续工具的 `operationId`，不得自行拼造；若响应没有可用的 operation ID，停止并报告。
2. 每次成功返回后，根据当前权威投影选择唯一下一步：
   - `waiting_user + awaiting_confirmation + task_status=DRAFT + confirmation_required=true + result_code=DRAFT_READY`：直接调用 `get_policy_configuration_result`。
   - `created/running`：用相同 operationId 调用 `get_policy_configuration_status`。
   - status 为 `running + awaiting_candidate_selection + selection.status=PENDING` 且含至少两个候选：按下节调用 select。
   - status 为 `waiting_user + awaiting_confirmation + can_decide=true`：调用 result。
   - `WAITING_EXTERNAL`：停止，返回 operationId 和可恢复说明；下次只续查，不重做 prepare。
   - `failed/cancelled`：报告真实终态，不改选、不重试 prepare。
   - 状态、ID、摘要或字段缺失、冲突、未知：停止并报告诊断。
3. status 与 result 各最多调用 3 次（失败尝试也计数）。select 最多一次；服务端拒绝时停止并报告错误，不尝试改选。
4. result 返回后只在权威 DRAFT 已就绪时原样输出完整的 `data.result_markdown`；其中若有“配置预览”与命令数组，逐字保留，由 DSH 页面负责格式化展示，不能摘要、省略或自行补造。保留 taskId、DRAFT 状态和确认提示，不额外声称设备已生效。成功响应中的 `data` 是权威业务投影；`code` 不是成功或业务状态时不能据此推进。

## 候选排序

仅在最新 status 表明 `awaiting_candidate_selection`、`PENDING`，且含两个以上候选时调用 `mcp__policy-configuration__select_policy_configuration_candidate`。只使用用户意图和冻结候选事实；明确业务偏好优先，其次看 `traffic_direction`、`relative_position`、`coverage`、`reason_codes`，证据不足时按 `path_order_ascending` 稳定排序。`ranked_candidate_ids` 必须包含最新集合的每个 ID 恰好一次；`candidate_set_digest` 原样复制；`reason_codes` 只填稳定审计代码。选中后 Preview 或复核失败，不自动改选第二名。

select 的参数由同一 Operation ID 和最新 status 的冻结集合组成，结构如下；示例值不是实际候选，不能照填：

```json
{
  "operationId": "op_...",
  "body": {
    "candidate_set_digest": "sha256:...",
    "ranked_candidate_ids": ["candidate-a", "candidate-b"],
    "reason_codes": ["path_order_tiebreak"]
  }
}
```

## 确认边界

用户在同一会话中单独回复“执行”时，DSH 受信插件从会话内 Workbench 最新 DRAFT 工具返回值绑定 operation ID 和摘要，调用聚合确认接口。模型不可调用 `confirm_policy_configuration`、`decide_policy_configuration` 或 SOC 写入工具；只原样呈现插件注入的 Workbench 确认结果。`DRAFT` 和 `confirmation.accepted=true` 都不代表策略已下发；以 `execution` 和 `failure_scope` 判断。任何改参、旧任务号、疑问或否定均不触发确认。
