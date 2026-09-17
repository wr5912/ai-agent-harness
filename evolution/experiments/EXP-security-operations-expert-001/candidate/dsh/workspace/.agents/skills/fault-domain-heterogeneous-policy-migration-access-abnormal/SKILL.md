---
name: fault-domain-heterogeneous-policy-migration-access-abnormal
description: "异构策略迁移后业务访问异常、厂商策略语义不一致、对象组服务组 NAT 迁移缺失等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为异构策略迁移后访问异常生成故障分析取证规划。典型问题信号包括：

- `策略迁移后业务不通`
- `异构策略迁移后访问失败`
- `不同厂商防火墙迁移后端口不通`
- `迁移任务成功但实际业务超时`

本故障域聚焦迁移前后策略语义、对象组、服务组、NAT 和业务五元组是否一致。

## 分诊边界

- 必须明确出现异构迁移、策略迁移、厂商迁移、迁移任务、迁移后访问异常等信号。
- 普通策略变更后异常进入策略变更故障域；普通访问不通进入业务访问不通故障域。
- 没有迁移任务、迁移映射或迁移前后差异证据时，不得输出“迁移导致访问异常”为候选根因。

## 证据缺口解释

异构策略迁移后访问异常要回答的是“源厂商策略迁到目标厂商后，当前业务五元组的语义是否保持一致”。路径和资产证据只能说明访问链路；要证明迁移问题，必须取得迁移任务、迁移映射、语义差异和迁移后策略命中。

- 迁移任务状态：用来确认是否真的发生迁移、迁移是否完成或失败。没有它，不能把问题和迁移关联。
- 迁移策略映射：用来确认原策略映射到目标策略的关系。没有它，不能判断规则是否迁漏或映射错误。
- 迁移语义差异：用来比较对象组、服务组、NAT、动作等跨厂商语义。没有它，不能说明迁移后访问语义是否变化。
- 迁移后策略命中：用来证明当前访问是否命中迁移后的规则。没有它，不能确认迁移导致本次访问失败。

`evidence_gaps` 用来防止把普通策略变更或普通访问不通误写成异构迁移问题。

## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "heterogeneous-policy-migration-access-abnormal",
  "domain_display_name": "异构策略迁移后访问异常",
  "planning_basis": {
    "source": {"ip": "<当前输入源 IP，有则填写>"},
    "destination": {"ip": "<当前输入目标 IP，有则填写>"},
    "migration_hint": "<迁移任务、源厂商、目标厂商或策略线索，有则填写>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "source-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "migration_access_object_identity_resolution",
      "evidence_type": "source_asset_identity",
      "object_role": "source",
      "resolved_arguments": {"ip": "<当前输入源 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询迁移后异常访问的源资产身份和状态"
    },
    {
      "tool_call_id": "destination-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "migration_access_object_identity_resolution",
      "evidence_type": "destination_asset_identity",
      "object_role": "destination",
      "resolved_arguments": {"ip": "<当前输入目标 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询迁移后异常访问的目标资产身份和状态"
    },
    {
      "tool_call_id": "primary-reachability-path",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_path_query",
      "capability_id": "migration_access_path_context",
      "evidence_type": "primary_reachability_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": [],
      "parallel_group": "path",
      "priority": 2,
      "purpose": "确认本次访问路径是否经过迁移策略影响的设备"
    },
    {
      "tool_call_id": "host-pair-port-flow",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_flow_host_pair_ports",
      "capability_id": "migration_access_flow_observation",
      "evidence_type": "service_port_state",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": ["primary-reachability-path"],
      "parallel_group": "flow",
      "priority": 3,
      "purpose": "查询迁移后是否存在源目端口级流量观测"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "migration_task_state",
      "migration_policy_mapping",
      "migration_semantic_diff"
    ],
    "optional_evidence_types": [
      "source_asset_identity",
      "destination_asset_identity",
      "primary_reachability_path",
      "service_port_state",
      "policy_current_state",
      "policy_change_diff",
      "nat_mapping_diff"
    ]
  },
  "candidate_guardrails": [
    "没有迁移任务或迁移映射证据时，不得输出异构策略迁移作为候选根因。",
    "迁移任务成功不等于策略语义正确，必须检查五元组、对象组、服务组和 NAT 映射。",
    "只看到路径不可达时，应按业务访问不通表达，不得强行归因到迁移。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "migration_task_state",
      "why_needed": "迁移任务状态用于确认是否存在与本次业务相关的迁移任务、迁移时间、迁移范围和执行结果。",
      "reason": "当前故障分析工具组未确认可用策略迁移任务查询工具，无法取得迁移任务记录。",
      "effect": "不能确认是否存在相关迁移任务及迁移状态；不得把普通访问异常归因到策略迁移。"
    },
    {
      "evidence_type": "migration_policy_mapping",
      "why_needed": "迁移策略映射用于确认源厂商策略、对象组、服务组和 NAT 规则迁移后对应到哪些目标策略。",
      "reason": "当前故障分析工具组未确认可用迁移前后策略映射查询工具，无法取得源策略到目标策略的映射关系。",
      "effect": "不能判断原策略是否正确映射到目标策略，也不能确认是否存在规则漏迁或对象映射错误。"
    },
    {
      "evidence_type": "migration_semantic_diff",
      "why_needed": "迁移语义差异用于比较不同厂商之间对象组、服务组、NAT、动作、方向和默认策略语义是否保持一致。",
      "reason": "当前故障分析工具组未确认可用迁移语义差异查询工具，无法取得跨厂商语义对比结果。",
      "effect": "不能确认对象组、服务组、NAT 或动作语义是否变化；不得确认迁移语义不一致导致访问异常。"
    },
    {
      "evidence_type": "policy_hit_or_deny_log",
      "why_needed": "迁移后五元组策略命中用于证明当前源、目的、端口和协议在迁移后的设备上被允许还是拒绝。",
      "reason": "当前故障分析工具组未确认可用迁移后五元组策略命中查询工具，无法取得迁移后设备上的真实处理结果。",
      "effect": "不能证明迁移后本次访问被允许或拒绝；只能把迁移后策略命中列为待补验证。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `migration_task_state`
- `migration_policy_mapping`
- `migration_semantic_diff`
- `primary_reachability_path`
- `policy_hit_or_deny_log`
- `nat_mapping_diff`

缺少迁移类 MCP 时，可以保留资产、路径、端口观测等基础取证，但输出中只能说明“迁移方向未完成验证”。
