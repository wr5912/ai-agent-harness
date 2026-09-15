---
name: fault-domain-ha-policy-drift
description: "主备/HA 策略差异、主备切换后访问异常、配置同步异常等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为主备或 HA 策略差异导致的业务访问异常生成取证规划。HA 指 High Availability，高可用主备或集群容灾机制。典型输入包括：

- `主备防火墙切换后访问失败`
- `HA 同步异常导致策略不一致`
- `备用设备接管后业务访问异常`

## 分诊边界

- 必须有明确“主备、HA、切换、同步、备用接管、双机热备”等信号，才进入本故障域。
- 普通访问不通不得因为历史上下文或系统字段出现 `handoff`、`chat-session` 等词而进入本故障域。
- HA 工具全部不可用时，只能输出“主备方向未完成验证”，不得输出“主备策略差异导致访问异常”作为候选根因。

## 证据缺口解释

HA 场景要回答的是“故障是否发生在主备切换、同步失败或备机接管后策略不一致”。普通路径查询只能说明源目网络视角是否可达；要证明 HA 相关根因，必须知道主备对象是谁、当前由谁承载流量、策略是否同步、切换时间是否与故障窗口一致。

- 主备对象：用来确认参与本次访问路径的 HA 设备或集群成员。没有它，不能证明问题与 HA 设备有关。
- 主备策略差异：用来比较主备设备上的策略、对象组、服务组、NAT 或路由是否一致。没有它，不能说主备策略不同步。
- HA 同步状态：用来判断是否存在同步失败、切换异常或备机接管异常。没有它，不能把故障时间与 HA 状态变化关联起来。

`evidence_gaps` 用来防止普通访问不通被误归因到 HA。

## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "ha-policy-drift",
  "domain_display_name": "主备 / HA 策略差异导致业务访问异常",
  "planning_basis": {
    "source": {"ip": "<当前输入源 IP，有则填写>"},
    "destination": {"ip": "<当前输入目标 IP，有则填写>"},
    "ha_hint": "<用户给定主备/HA/切换线索>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
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
      "purpose": "查询主备切换影响链路的源资产身份和状态"
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
      "purpose": "查询主备切换影响链路的目标资产身份和状态"
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
      "purpose": "查询主备切换后源到目标的基础路径可达性"
    },
    {
      "tool_call_id": "path-cross-signal",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_reachability_cross_signal",
      "capability_id": "business_access_path_cross_check",
      "evidence_type": "path_cross_check",
      "object_role": "source_to_destination",
      "resolved_arguments": {},
      "depends_on": ["primary-reachability-path"],
      "parallel_group": "path",
      "priority": 3,
      "purpose": "交叉验证主备切换场景下是否存在历史流量或旁路线索"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "ha_pair_identity",
      "ha_policy_diff",
      "ha_sync_status"
    ],
    "optional_evidence_types": [
      "source_asset_identity",
      "destination_asset_identity",
      "primary_reachability_path",
      "policy_hit_or_deny_log",
      "related_event_window"
    ]
  },
  "candidate_guardrails": [
    "没有主备对象或策略差异证据时，不得输出主备策略差异候选根因。",
    "路径可达只能说明网络层初步可达，不能替代主备策略差异验证。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "ha_pair_identity",
      "why_needed": "主备对象证据用于确认本次业务路径是否经过某组 HA 设备，以及主设备、备设备或集群成员分别是谁。",
      "reason": "当前故障分析工具组未确认可用主备对象查询工具，无法取得本次路径相关的 HA 关系。",
      "effect": "不能证明本次访问异常与 HA 设备有关；不得把普通路径异常直接解释为主备问题。"
    },
    {
      "evidence_type": "ha_policy_diff",
      "why_needed": "主备策略差异证据用于比较主备设备上的策略、对象组、服务组、NAT 或路由是否一致。",
      "reason": "当前故障分析工具组未确认可用主备策略差异查询工具，无法取得主备配置对比结果。",
      "effect": "不能验证主备策略是否存在差异；不得输出“主备策略差异导致访问异常”作为候选根因。"
    },
    {
      "evidence_type": "ha_sync_status",
      "why_needed": "HA 同步状态用于判断配置、会话、路由或策略是否同步成功，以及切换时间是否与故障窗口重合。",
      "reason": "当前故障分析工具组未确认可用 HA 同步状态查询工具，无法取得同步状态、切换历史或接管记录。",
      "effect": "不能确认是否存在同步失败、切换异常或备用接管异常；只能把 HA 方向列为待补验证。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `ha_pair_identity`
- `ha_policy_diff`
- `ha_sync_status`
- `policy_hit_or_deny_log`
- `primary_reachability_path`
