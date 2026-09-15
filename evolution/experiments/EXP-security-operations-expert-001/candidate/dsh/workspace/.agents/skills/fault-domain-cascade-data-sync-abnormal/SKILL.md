---
name: fault-domain-cascade-data-sync-abnormal
description: "上下级 SOC 级联数据同步异常、资产告警拓扑上下级不一致、级联链路异常等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为级联数据同步异常生成故障分析取证规划。典型问题信号包括：

- `下级有资产，上级查不到`
- `上下级 SOC 告警数量不一致`
- `级联同步延迟导致拓扑证据缺失`
- `级联链路异常，故障分析证据不一致`

本故障域只分析级联关系、同步状态、数据差异和证据新鲜度，不替代具体业务访问、资产运行或告警链路故障域。

## 分诊边界

- 必须有级联、上下级、同步、上级查不到、下级有数据、级联链路等信号。
- 单纯资产未纳管进入资产关联异常；单纯日志无告警进入检测 / 告警链路异常。
- 级联 MCP 不可用时，只能输出“级联数据同步方向未完成验证”，不得确认级联故障。

## 证据缺口解释

级联数据同步异常要回答的是“上下级 SOC 之间哪类数据没有同步、为什么没有同步、是否影响当前故障分析证据”。当前节点对象查询只能说明本节点看到什么；要判断级联问题，必须取得级联关系、链路状态、数据差异和权限 / 过滤规则。

- 级联关系：用来确认数据应该从哪个节点同步到哪个节点。没有它，不能判断上下级方向。
- 级联链路状态：用来判断同步链路是否断连、认证失败或延迟。没有它，不能解释同步失败原因。
- 上下级数据差异：用来证明资产、告警、拓扑等对象在不同节点确实不一致。没有它，不能确认数据差异。
- 级联权限 / 过滤规则：用来判断数据缺失是否是策略过滤或权限限制。没有它，不能把缺失归因到链路故障。

`evidence_gaps` 用来防止把“当前节点查不到”直接写成“级联同步异常”。

## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "cascade-data-sync-abnormal",
  "domain_display_name": "级联数据同步异常",
  "planning_basis": {
    "object": {"ip": "<当前输入资产 IP，有则填写>", "id": "<资产、告警、拓扑对象 ID，有则填写>"},
    "cascade_hint": "<上级、下级、节点、数据类型或同步线索，有则填写>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "object-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "cascade_sync_object_identity",
      "evidence_type": "asset_identity",
      "object_role": "sync_object",
      "resolved_arguments": {"ip": "<当前输入资产 IP，有则填写>", "keyword": "<当前输入对象名称，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object",
      "priority": 1,
      "purpose": "查询级联差异对象在当前节点是否存在及基础状态"
    },
    {
      "tool_call_id": "event-window-search",
      "tool_name": "mcp__sec-ops__ai_soc_event__post_event_search",
      "capability_id": "cascade_sync_event_context",
      "evidence_type": "sync_related_event_window",
      "object_role": "sync_object",
      "resolved_arguments": {
        "query": "<围绕级联、同步、节点、对象 ID 或资产 IP 生成只读检索条件>",
        "timeRange": "<用户给定或默认查询窗口>",
        "pageSize": 50
      },
      "depends_on": [],
      "parallel_group": "event",
      "priority": 2,
      "purpose": "查询级联同步失败、认证失败、链路断连或延迟相关事件"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "cascade_relation",
      "cascade_link_state",
      "cascade_data_diff"
    ],
    "optional_evidence_types": [
      "asset_identity",
      "sync_related_event_window",
      "cascade_sync_state",
      "cascade_failure_record",
      "cascade_data_freshness",
      "cascade_filter_or_permission"
    ]
  },
  "candidate_guardrails": [
    "没有级联关系、同步状态或数据差异证据时，不得输出级联同步异常作为候选根因。",
    "当前节点查不到数据只能说明本节点证据缺失，不能直接推断下级存在或不存在。",
    "级联数据延迟只影响证据可信度，不能直接等同业务故障根因。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "cascade_relation",
      "why_needed": "级联关系用于确认上下级节点、数据流向、同步范围和对象应归属的节点。",
      "reason": "当前故障分析工具组未确认可用级联关系查询工具，无法取得节点关系和同步拓扑。",
      "effect": "不能确认上下级节点关系和数据流向；不得判断某对象应该从哪个节点同步。"
    },
    {
      "evidence_type": "cascade_link_state",
      "why_needed": "级联链路状态用于判断上下级通信是否正常，是否存在断连、认证失败、延迟或队列积压。",
      "reason": "当前故障分析工具组未确认可用级联链路状态查询工具，无法取得链路健康和延迟状态。",
      "effect": "不能判断级联链路是否断连、认证失败或延迟；只能记录级联链路状态未完成验证。"
    },
    {
      "evidence_type": "cascade_data_diff",
      "why_needed": "上下级数据差异用于直接比较资产、告警、拓扑或规则对象在不同节点上的存在性、版本和更新时间。",
      "reason": "当前故障分析工具组未确认可用上下级数据差异查询工具，无法取得跨节点对象对比结果。",
      "effect": "不能证明资产、告警或拓扑对象在上下级之间不一致；不得确认级联数据同步异常。"
    },
    {
      "evidence_type": "cascade_filter_or_permission",
      "why_needed": "级联权限或过滤规则用于判断数据缺失是否由上送范围、过滤策略、租户权限或节点授权控制导致。",
      "reason": "当前故障分析工具组未确认可用级联权限或过滤规则查询工具，无法取得过滤和授权配置。",
      "effect": "不能判断数据缺失是否由过滤、授权或上送策略导致；不得把权限过滤误判为同步链路故障。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `cascade_relation`
- `cascade_link_state`
- `cascade_sync_state`
- `cascade_data_diff`
- `cascade_data_freshness`
- `cascade_filter_or_permission`

当前若没有稳定级联 MCP，可只规划当前节点对象和同窗口事件取证，并把级联专用证据列为缺口；不得把当前节点数据缺失直接解释成级联故障。
