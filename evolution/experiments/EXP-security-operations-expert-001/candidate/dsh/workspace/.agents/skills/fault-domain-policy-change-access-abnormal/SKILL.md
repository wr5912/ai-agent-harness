---
name: fault-domain-policy-change-access-abnormal
description: "策略变更后业务访问异常、策略当前态、历史变更、差异验证等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为策略变更后业务访问异常生成故障分析取证规划。典型输入包括：

- `策略变更后业务访问异常`
- `防火墙策略调整后访问失败`
- `变更前后策略 diff 显示放行规则缺失`

本故障域聚焦“策略变更与故障时间、访问对象、策略命中”的证据闭环。

## 分诊边界

- 必须有明确策略变更、规则调整、策略当前态/历史/diff、变更后异常等上下文。
- 普通访问不通不得因为历史上下文里出现过策略词而进入本故障域。
- 策略工具全部不可用时，只能输出“策略变更方向未完成验证”，不得输出策略变更为候选根因。

## 证据缺口解释

策略变更后访问异常要回答的是“哪次策略变更影响了当前源目访问”。路径和资产证据只能说明访问链路；要证明策略变更是候选根因，必须拿到当前策略、变更历史和变更前后差异，并且与本次源目、端口、协议和故障时间窗口建立关系。

- 策略当前态：用来判断当前策略是否允许或拒绝本次访问。没有它，不能确认当前规则状态。
- 策略变更历史：用来把策略变更时间与故障发生时间关联。没有它，不能证明“变更后才异常”。
- 策略差异：用来定位变更前后规则、对象组、服务组、NAT 或动作变化。没有它，不能说明到底改了什么。

`evidence_gaps` 用来防止普通访问不通被历史策略词污染，误归因到策略变更。

## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "policy-change-access-abnormal",
  "domain_display_name": "策略变更后业务访问异常",
  "planning_basis": {
    "source": {"ip": "<当前输入源 IP，有则填写>"},
    "destination": {"ip": "<当前输入目标 IP，有则填写>"},
    "change_hint": "<用户给定策略变更线索>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "source-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "source_asset_identity",
      "object_role": "source",
      "resolved_arguments": {"ip": "<当前输入源 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询策略变更影响链路的源资产身份和状态"
    },
    {
      "tool_call_id": "destination-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "destination_asset_identity",
      "object_role": "destination",
      "resolved_arguments": {"ip": "<当前输入目标 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询策略变更影响链路的目标资产身份和状态"
    },
    {
      "tool_call_id": "primary-reachability-path",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_path_query",
      "capability_id": "business_access_primary_reachability_path",
      "evidence_type": "primary_reachability_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": [],
      "parallel_group": "path",
      "priority": 2,
      "purpose": "查询策略变更影响链路的基础路径可达性"
    },
    {
      "tool_call_id": "host-pair-port-flow",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_flow_host_pair_ports",
      "capability_id": "business_access_path_cross_check",
      "evidence_type": "service_port_state",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": ["primary-reachability-path"],
      "parallel_group": "flow",
      "priority": 3,
      "purpose": "查询源目之间是否存在端口级流量观测记录"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "source_asset_identity",
      "destination_asset_identity",
      "policy_current_state",
      "policy_change_history",
      "policy_change_diff"
    ],
    "optional_evidence_types": [
      "primary_reachability_path",
      "policy_hit_or_deny_log",
      "related_event_window"
    ]
  },
  "candidate_guardrails": [
    "没有策略当前态、历史或差异证据时，不得输出策略变更作为候选根因。",
    "策略差异必须和当前源目、端口协议或故障时间窗口建立关系。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "policy_current_state",
      "why_needed": "策略当前态用于判断当前规则、对象组、服务组、NAT 和动作是否允许本次源目访问。",
      "reason": "当前故障分析工具组未确认可用策略当前态查询工具，无法取得当前策略配置。",
      "effect": "不能验证当前策略是否放行或拒绝本轮源目访问；不得把策略方向写成已确认根因。"
    },
    {
      "evidence_type": "policy_change_history",
      "why_needed": "策略变更历史用于确认谁在什么时间修改了哪条策略，以及变更时间是否落在故障窗口附近。",
      "reason": "当前故障分析工具组未确认可用策略变更历史查询工具，无法取得变更记录和操作时间。",
      "effect": "不能把策略变更时间与故障发生时间建立证据关联；只能说明变更关联未完成验证。"
    },
    {
      "evidence_type": "policy_change_diff",
      "why_needed": "策略差异用于比较变更前后规则、对象组、服务组、NAT 或动作变化，定位是否影响当前五元组。",
      "reason": "当前故障分析工具组未确认可用策略差异查询工具，无法取得变更前后的差异明细。",
      "effect": "不能确认变更前后是否出现规则缺失、对象组变化、端口遗漏、NAT 变化或动作变化；不得确认策略变更导致访问异常。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `policy_current_state`
- `policy_change_history`
- `policy_change_diff`
- `policy_hit_or_deny_log`
- `primary_reachability_path`
