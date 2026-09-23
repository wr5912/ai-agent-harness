---
name: fault-domain-security-device-config-drift
description: "安全设备配置偏离、配置核查违规、设备策略与业务影响关联等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为安全设备配置偏离导致或影响业务访问异常生成取证规划。典型输入包括：

- `安全设备配置偏离导致业务访问异常`
- `防火墙配置核查违规后业务访问失败`
- `设备配置过期、采集未配置、策略记录与实际不一致`

## 分诊边界

- 必须围绕明确业务影响展开；单纯配置违规通常只是风险，不直接作为故障根因。
- 若用户只说源目访问不通，默认走业务访问不通；只有明确配置偏离线索才进入本故障域。
- 配置核查工具不可用时，只能输出配置偏离方向未完成验证。

## 证据缺口解释

安全设备配置偏离要回答的是“设备配置是否偏离预期，并且这个偏离是否影响当前业务路径”。仅有设备身份或路径信息不够；必须拿到配置核查结果、违规明细和策略命中证据，才能把配置问题和业务故障建立关系。

- 配置核查结果：用来确认设备配置是否真的异常、配置数据是否新鲜。没有它，不能判断配置偏离是否存在。
- 配置违规明细：用来定位具体偏离项、实际配置值和影响对象。没有它，不能说明偏离了什么。
- 策略命中 / 拒绝日志：用来证明本次业务访问是否命中该偏离配置。没有它，不能把配置偏离确认为本次访问失败原因。

`evidence_gaps` 用来把“配置风险”与“业务故障根因”分开，避免只凭配置过期或违规就下结论。

## 方向选择

契约域固定为 `business-access-abnormal`。
`analysis_direction_ids` 可包含以下一个或多个方向；本 Skill 的**主方向**为 `security-device-config`：

- `base-reachability`：未携带专项线索的源目访问失败、访问超时、路径不可达、路径可达但业务失败。
- `policy-change`：明确出现策略变更、策略调整、ACL 变更、防火墙策略变更、策略 diff、变更后访问异常。
- `ha-switchover`：明确出现主备、HA、双机、切换、同步、备用接管、主备策略差异。
- `security-device-config`：明确出现安全设备配置偏离、配置核查、配置不一致、配置过期、合规违规且与业务访问异常有关。
- `path-compliance`：明确出现路径合规、应达路径、实际路径偏离、专项拓扑路径违规。
- `heterogeneous-policy-migration`：明确出现异构策略迁移、厂商迁移、迁移任务、迁移后访问异常。

无专项线索时保留 `security-device-config`；出现其它方向线索时追加对应方向，不得把本 Skill 的细分线索当作独立故障域。
## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "business-access-abnormal",
  "analysis_direction_ids": ["security-device-config"],
  "domain_display_name": "安全设备配置偏离导致业务访问异常",
  "planning_basis": {
    "device": {"ip": "<安全设备 IP，有则填写>"},
    "source": {"ip": "<当前输入源 IP，有则填写>"},
    "destination": {"ip": "<当前输入目标 IP，有则填写>"},
    "config_hint": "<用户给定配置偏离线索>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "device-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "device_identity",
      "object_role": "security_device",
      "resolved_arguments": {"ip": "<安全设备 IP，有则填写>", "keyword": "<安全设备名称，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询存在配置偏离线索的安全设备身份和基础状态"
    },
    {
      "tool_call_id": "source-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "source_asset_identity",
      "object_role": "source",
      "resolved_arguments": {"ip": "<当前输入源 IP，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询配置偏离影响链路的源资产身份和状态"
    },
    {
      "tool_call_id": "destination-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "destination_asset_identity",
      "object_role": "destination",
      "resolved_arguments": {"ip": "<当前输入目标 IP，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询配置偏离影响链路的目标资产身份和状态"
    },
    {
      "tool_call_id": "primary-reachability-path",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_path_query",
      "capability_id": "business_access_primary_reachability_path",
      "evidence_type": "primary_reachability_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP，有则填写>", "dstIp": "<当前输入目标 IP，有则填写>"},
      "depends_on": [],
      "parallel_group": "path",
      "priority": 2,
      "purpose": "查询安全设备配置偏离影响链路的基础路径可达性"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "device_identity",
      "config_check_result",
      "configuration_violation"
    ],
    "optional_evidence_types": [
      "primary_reachability_path",
      "policy_current_state",
      "policy_hit_or_deny_log",
      "related_event_window"
    ]
  },
  "candidate_guardrails": [
    "配置偏离必须和业务影响对象、路径、策略或时间窗口建立关系。",
    "设备采集过期只能形成证据缺口或风险信号，不能直接确认根因。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "config_check_result",
      "why_needed": "配置核查结果用于确认设备配置是否通过基线、合规或采集新鲜度检查，是判断配置偏离是否真实存在的入口证据。",
      "reason": "当前故障分析工具组未确认可用安全设备配置核查结果查询工具，无法取得配置核查状态、采集时间和失败项概览。",
      "effect": "不能确认配置核查是否失败、配置数据是否过期或配置项是否异常；只能把配置偏离列为待补验证方向。"
    },
    {
      "evidence_type": "configuration_violation",
      "why_needed": "配置违规明细用于定位具体偏离项、实际配置值、期望配置值和影响范围。",
      "reason": "当前故障分析工具组未确认可用安全设备配置违规明细查询工具，无法取得具体违规项和配置上下文。",
      "effect": "不能说明设备到底偏离了哪条 ACL、NAT、路由、对象组或安全域配置；不得把泛化配置异常写成具体根因。"
    },
    {
      "evidence_type": "policy_hit_or_deny_log",
      "why_needed": "策略命中或拒绝日志用于证明本次源目访问是否真实经过并命中了偏离配置。",
      "reason": "当前故障分析工具组未确认可用策略命中或拒绝日志查询工具，无法取得本次访问在设备上的处理结果。",
      "effect": "不能把配置偏离和本轮业务访问失败建立直接证据关系；只能输出配置偏离方向未完成验证。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `device_identity`
- `config_check_result`
- `configuration_violation`
- `policy_current_state`
- `primary_reachability_path`
