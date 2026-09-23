---
name: fault-domain-business-access-unreachable
description: "业务访问不通、源目访问失败、访问超时、路径不可达等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为“源对象到目标对象访问失败”生成故障分析取证规划。典型问题信号包括：

- `<REDACTED_PRIVATE_IP> 无法访问 <REDACTED_PRIVATE_IP>`
- `源 IP 到目标服务器业务超时`
- `源到目标路径不可达`
- `拓扑可达但业务访问仍失败`

本 Skill 只负责规划，不执行 SOC 取证工具。SOC 工具必须等故障分析运行时冻结计划后再调用。

## 固定规划原则

- 普通源目访问不通默认使用本文件的固定最小计划骨架，不需要调用资源列表、工具目录或 SOC 查询来“发现工具”。
- 当前 `Runtime MCP 声明` 中故障分析工具组的 server key 为 `sec-ops`，因此计划里的工具名前缀使用 `mcp__sec-ops__...`。
- 不得把 server key 写成 `fault-analysis`，也不得在正文或计划说明中解释 server 前缀。
- 若某个计划工具在实际执行时不可用，按冻结计划提交失败结果，由运行时统一形成证据缺口；不得在计划生成前改用分组外工具或自行寻找替代工具。
- 生成计划时只替换当前输入中的源 IP、目标 IP 和必要时间窗口；不要改写 `tool_call_id`、依赖名称、`capability_id` 或 `evidence_type`。

## 分诊边界

- 普通“无法访问 / 不通 / 超时 / 不可达”默认进入本故障域。
- 只有用户明确提到主备切换、HA 同步、策略变更、配置偏离，才考虑其他专门故障域。
- 当前输入中的源 IP、目标 IP 优先于历史上下文；若当前输入和历史上下文冲突且无法确定对象，计划应标记为不可冻结。
- 拓扑可达但业务超时，不得输出路由缺失作为候选根因；应转向端口、服务、策略命中、目标服务状态等缺口。

## 证据缺口解释

业务访问不通要回答的是“源到目标为什么访问失败”。资产和路径证据只能说明对象是否纳管、路径是否可达；如果要进一步确认是否由安全策略、NAT、ACL、同窗口告警或服务异常导致，还需要补充交叉证据。

- 同窗口事件 / 告警：用来判断故障窗口内是否出现设备异常、拒绝访问、服务异常、变更或安全告警。没有它，只能基于路径和资产状态给候选，不能用事件链路佐证根因。
- 策略 / ACL / NAT 状态：用来判断访问失败是不是被防火墙、安全域、ACL 或 NAT 影响。没有它，不能把“不通”直接解释为“策略阻断”。

`evidence_gaps` 用来约束结论：缺哪类证据，就明确哪类根因不能确认，避免把“待补验证方向”写成“已确认原因”。

## 方向选择

契约域固定为 `business-access-abnormal`。
`analysis_direction_ids` 可包含以下一个或多个方向；本 Skill 的**主方向**为 `base-reachability`：

- `base-reachability`：未携带专项线索的源目访问失败、访问超时、路径不可达、路径可达但业务失败。
- `policy-change`：明确出现策略变更、策略调整、ACL 变更、防火墙策略变更、策略 diff、变更后访问异常。
- `ha-switchover`：明确出现主备、HA、双机、切换、同步、备用接管、主备策略差异。
- `security-device-config`：明确出现安全设备配置偏离、配置核查、配置不一致、配置过期、合规违规且与业务访问异常有关。
- `path-compliance`：明确出现路径合规、应达路径、实际路径偏离、专项拓扑路径违规。
- `heterogeneous-policy-migration`：明确出现异构策略迁移、厂商迁移、迁移任务、迁移后访问异常。

无专项线索时保留 `base-reachability`；出现其它方向线索时追加对应方向，不得把本 Skill 的细分线索当作独立故障域。
## 规划契约

输出给故障分析主流程的 `agent_planning_result` 必须包含：

```json
{
  "domain_id": "business-access-abnormal",
  "analysis_direction_ids": ["base-reachability"],
  "domain_display_name": "业务访问不通 / 源目网络不可达",
  "planning_basis": {
    "current_question_objects_preferred": true,
    "source": {"ip": "<当前输入源 IP>"},
    "destination": {"ip": "<当前输入目标 IP>"},
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
      "purpose": "查询源资产纳管状态、在线状态和基础信息"
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
      "purpose": "查询目标资产纳管状态、在线状态和基础信息"
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
      "purpose": "查询源到目标的网络路径可达性和断点线索"
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
      "purpose": "交叉验证源目网段之间是否存在历史流量或旁路线索"
    },
    {
      "tool_call_id": "asset-reachability-path",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_reachability_path_by_ip",
      "capability_id": "business_access_asset_based_reachability_path",
      "evidence_type": "asset_based_reachability_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": ["source-asset-identity", "destination-asset-identity"],
      "parallel_group": "path",
      "priority": 4,
      "purpose": "从资产可达性视角复核源到目标路径"
    },
    {
      "tool_call_id": "host-pair-port-flow",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_flow_host_pair_ports",
      "capability_id": "business_access_topology_context_lookup",
      "evidence_type": "service_port_state",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": ["primary-reachability-path"],
      "parallel_group": "flow",
      "priority": 5,
      "purpose": "查询源目之间是否存在端口级流量观测记录"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "source_asset_identity",
      "destination_asset_identity",
      "primary_reachability_path",
      "path_cross_check"
    ],
    "optional_evidence_types": [
      "asset_based_reachability_path",
      "related_event_window",
      "policy_or_acl_state",
      "service_port_state"
    ]
  },
  "candidate_guardrails": [
    "路径可达时不得输出源侧网关或路由缺失候选根因。",
    "源或目标未纳管只能说明平台无法完成拓扑验证，不得等同真实网络断点。",
    "事件工具不可用时只能记录证据缺口，不得写成无事件支撑的确认结论。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "related_event_window",
      "why_needed": "同窗口事件和告警可以把访问失败与设备异常、拒绝日志、服务异常、策略变更或安全事件建立时间关联。",
      "reason": "当前故障分析工具组未确认可用事件和告警检索工具，无法取得故障窗口内的交叉验证记录。",
      "effect": "不能用事件链路验证候选根因；若路径或资产证据不足，只能输出受限候选，不能确认最终根因。"
    },
    {
      "evidence_type": "policy_or_acl_state",
      "why_needed": "源目访问失败常见原因包括防火墙策略、ACL、NAT 或安全域配置，需要策略命中和拒绝证据才能确认是否被控制点拦截。",
      "reason": "当前故障分析工具组未确认可用策略命中、拒绝日志或 NAT / ACL 查询工具，无法取得本次源目五元组在控制点上的真实处理结果。",
      "effect": "不能确认访问失败是否由安全策略、NAT 或 ACL 导致；这些方向只能作为待补验证项。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

## 计划项要求

每个可执行计划项必须声明：

- `tool_call_id`
- `tool_name`：只能使用当前 `Runtime MCP 声明` 中故障分析工具组实际挂载 server key 对应的工具名；当前环境使用 `mcp__sec-ops__...`。
- `capability_id`
- `evidence_type`
- `object_role`
- `resolved_arguments`
- `depends_on`
- `purpose`

推荐证据类型：

- `source_asset_identity`
- `destination_asset_identity`
- `primary_reachability_path`
- `path_cross_check`
- `asset_based_reachability_path`
- `related_event_window`

若当前可见 MCP 工具无法支撑某项能力，不要编造工具名；在 `evidence_gaps` 中记录“能力未完成验证”。

禁止事项：

- 不调用 `ListMcpResourcesTool`、`ReadMcpResourceDirTool`、`skill-manager` 资源或 `sec-ops` 资源目录来生成计划。
- 不把计划生成过程输出给用户。
- 不在计划阶段查询资产、路径、事件、策略或端口数据。
