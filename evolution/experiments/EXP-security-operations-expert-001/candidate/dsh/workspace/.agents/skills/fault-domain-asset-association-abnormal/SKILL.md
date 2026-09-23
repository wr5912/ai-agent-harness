---
name: fault-domain-asset-association-abnormal
description: "资产未纳管、资产库无记录、业务归属缺失、对象识别异常等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为资产关联或对象识别异常生成故障分析取证规划。典型问题信号包括：

- `<REDACTED_PRIVATE_IP> 未纳管`
- `资产库总数为 0，业务影响范围判断异常`
- `IP 无业务归属或来源记录`

本故障域解释“平台无法识别对象”对故障分析的影响，不把未纳管直接等同真实网络故障。

## 分诊边界

- 用户明确提到未纳管、资产库无记录、业务归属缺失、对象识别异常，进入本故障域。
- 若同时有源目访问失败，未纳管是证据缺口或候选因素，业务访问故障域仍应参与。
- 总数为 0 只代表当前查询条件下未命中资产库，不代表设备一定不存在。

## 证据缺口解释

资产关联异常要回答的是“平台为什么识别不了对象，以及这种识别缺口会影响哪些分析”。资产库查询只能证明当前条件下是否命中记录；要判断业务影响、来源冲突或未纳管对象是否真实活跃，还需要业务归属、来源记录、未纳管发现和拓扑上下文。

- 业务归属：用来判断该 IP 或资产影响哪个业务系统、责任边界和影响范围。没有它，只能说明对象识别异常，不能说明业务影响范围。
- 未纳管发现：用来交叉验证资产库查不到的 IP 是否仍在网络中活跃。没有它，不能区分“设备不存在”和“设备存在但未纳管”。

`evidence_gaps` 的作用是把“资产库无记录”限制在平台识别缺口，避免误写成真实设备不存在、业务无影响或网络必然异常。

## 方向选择

契约域固定为 `asset-association-abnormal`。
识别到下列线索时，在 `analysis_direction_ids` 中列出对应方向（可多选）：

- `unmanaged-asset`：未纳管、资产库无记录、IP 未识别为资产。
- `business-ownership-missing`：业务归属缺失、未关联业务系统、影响范围判断异常。
- `asset-duplicate-or-mismatch`：资产重复、IP 冲突、对象错配、主机名或 MAC 不一致。
- `asset-source-record-abnormal`：来源记录异常、采集上报和人工登记冲突、来源时间线异常。
- `asset-sync-stale`：资产同步滞后、资产目录长时间未更新、资产数据不同步。

无专项线索时 `analysis_direction_ids` 可省略，由故障分析运行时按域展开取证计划。
## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "asset-association-abnormal",
  "domain_display_name": "资产关联或对象识别异常",
  "planning_basis": {
    "asset": {"ip": "<当前输入资产 IP>"},
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "asset_association_object_identity",
      "evidence_type": "asset_identity",
      "object_role": "asset",
      "resolved_arguments": {"ip": "<当前输入资产 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "asset",
      "priority": 1,
      "purpose": "查询 IP 是否在资产库中存在记录，确认未纳管或对象识别缺口"
    },
    {
      "tool_call_id": "topology-coverage-context",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_coverage",
      "capability_id": "asset_association_graph_context",
      "evidence_type": "topology_node_context",
      "object_role": "asset",
      "resolved_arguments": {},
      "depends_on": ["asset-identity"],
      "parallel_group": "topology",
      "priority": 2,
      "purpose": "查询拓扑覆盖情况，辅助判断资产未纳管是否影响路径和范围分析"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "asset_identity"
    ],
    "optional_evidence_types": [
      "asset_business_context",
      "asset_source_record",
      "topology_node_context",
      "unmanaged_asset_discovery",
      "related_event_window"
    ]
  },
  "candidate_guardrails": [
    "未纳管是对象识别异常或平台证据缺口，不得直接确认真实设备故障。",
    "依赖资产标识的后续取证无法执行时，应写为前置依赖缺失。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "asset_business_context",
      "why_needed": "业务归属用于判断未纳管或识别异常对象是否属于某个业务系统，以及会影响哪些业务链路和责任边界。",
      "reason": "当前故障分析工具组未确认可用业务归属查询工具，无法取得该对象与业务系统的关联关系。",
      "effect": "不能确认该 IP 影响的业务系统、责任人或影响范围；只能说明业务归属未完成验证。"
    },
    {
      "evidence_type": "unmanaged_asset_discovery",
      "why_needed": "未纳管发现可以用扫描、流量或 ARP 等线索证明资产库无记录的 IP 是否仍在网络中活跃。",
      "reason": "当前故障分析工具组未确认可用未纳管发现明细工具，无法取得该 IP 的活跃证据和发现来源。",
      "effect": "不能区分设备不存在、采集缺失、资产未入库或来源同步异常；不得把资产库无记录直接解释为设备不存在。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `asset_identity`
- `asset_business_context`
- `asset_source_record`
- `topology_node_context`
- `unmanaged_asset_discovery`
