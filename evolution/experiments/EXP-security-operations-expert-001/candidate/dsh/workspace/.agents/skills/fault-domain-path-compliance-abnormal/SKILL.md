---
name: fault-domain-path-compliance-abnormal
description: "路径合规异常、实际路径与应达路径不一致、专项拓扑路径违规等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为路径合规异常生成故障分析取证规划。典型问题信号包括：

- `拓扑显示可达，但路径合规失败`
- `实际路径和应走路径不一致`
- `专项拓扑里的业务路径违规`
- `路径合规巡检发现 <REDACTED_PRIVATE_IP> 到 <REDACTED_PRIVATE_IP> 不符合预期`

本 Skill 只负责规划，不执行 SOC 取证工具。SOC 工具必须等故障分析运行时冻结计划后再调用。

## 分诊边界

- 必须有路径合规、应达路径、违规路径、专项拓扑、实际路径偏离等信号，才进入本故障域。
- 普通访问不通、超时、不可达默认进入业务访问不通故障域，不得因为出现“路径”二字误入本故障域。
- 路径合规失败不等于业务已经中断；必须同时查看实际路径、合规违规、拓扑覆盖和策略点证据。
- 当前 MCP 缺少应达路径、专项拓扑路径、违规处置状态等接口时，只能输出“路径合规方向未完成验证”，不得确认路径合规为最终根因。

## 证据缺口解释

路径合规类问题不是只问“当前能不能通”，而是要回答“当前实际路径是否符合预期”。因此仅有实际路径和违规列表还不够，至少还需要三类补充证据：

- 应达路径：用来说明业务按设计应该经过哪些设备、安全域或链路。如果没有它，只能知道当前路径是什么，不能判断当前路径偏离了哪一段设计。
- 专项拓扑路径：用来说明这个业务在专项拓扑、业务拓扑或安全域拓扑里的预期关系。如果没有它，合规结论只能停留在通用拓扑层，不能覆盖专项业务视角。
- 路径策略点：用来说明偏离或违规是否落在防火墙策略、安全域、NAT、ACL 等控制点上。如果没有它，不能把“路径不合规”进一步解释成“被策略阻断”“绕过安全域”或“NAT 配置异常”。

所以 `evidence_gaps` 不是为了凑字段，而是为了限制结论边界：缺哪类证据，就明确哪类判断不能下，避免把“路径合规方向存疑”说成“路径合规就是根因”。

## 方向选择

契约域固定为 `business-access-abnormal`。
`analysis_direction_ids` 可包含以下一个或多个方向；本 Skill 的**主方向**为 `path-compliance`：

- `base-reachability`：未携带专项线索的源目访问失败、访问超时、路径不可达、路径可达但业务失败。
- `policy-change`：明确出现策略变更、策略调整、ACL 变更、防火墙策略变更、策略 diff、变更后访问异常。
- `ha-switchover`：明确出现主备、HA、双机、切换、同步、备用接管、主备策略差异。
- `security-device-config`：明确出现安全设备配置偏离、配置核查、配置不一致、配置过期、合规违规且与业务访问异常有关。
- `path-compliance`：明确出现路径合规、应达路径、实际路径偏离、专项拓扑路径违规。
- `heterogeneous-policy-migration`：明确出现异构策略迁移、厂商迁移、迁移任务、迁移后访问异常。

无专项线索时保留 `path-compliance`；出现其它方向线索时追加对应方向，不得把本 Skill 的细分线索当作独立故障域。
## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "business-access-abnormal",
  "analysis_direction_ids": ["path-compliance"],
  "domain_display_name": "路径合规异常",
  "planning_basis": {
    "source": {"ip": "<当前输入源 IP，有则填写>"},
    "destination": {"ip": "<当前输入目标 IP，有则填写>"},
    "biz_hint": "<用户给定业务或专项拓扑线索，有则填写>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "source-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "path_compliance_object_identity_resolution",
      "evidence_type": "source_asset_identity",
      "object_role": "source",
      "resolved_arguments": {"ip": "<当前输入源 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询路径合规对象的源资产身份和基础状态"
    },
    {
      "tool_call_id": "destination-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "path_compliance_object_identity_resolution",
      "evidence_type": "destination_asset_identity",
      "object_role": "destination",
      "resolved_arguments": {"ip": "<当前输入目标 IP>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询路径合规对象的目标资产身份和基础状态"
    },
    {
      "tool_call_id": "actual-reachability-path",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_path_query",
      "capability_id": "path_compliance_actual_path",
      "evidence_type": "actual_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": [],
      "parallel_group": "path",
      "priority": 2,
      "purpose": "查询当前源目实际路径、跳数、可达性和路径数据质量"
    },
    {
      "tool_call_id": "path-compliance-violations",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_compliance_violations",
      "capability_id": "path_compliance_violation_lookup",
      "evidence_type": "path_compliance_violation",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>", "pageSize": 20},
      "depends_on": ["actual-reachability-path"],
      "parallel_group": "compliance",
      "priority": 3,
      "purpose": "查询源目路径是否存在合规违规、违规节点和违规原因"
    },
    {
      "tool_call_id": "path-coverage",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_coverage",
      "capability_id": "path_compliance_data_quality",
      "evidence_type": "path_data_quality",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<当前输入源 IP>", "dstIp": "<当前输入目标 IP>"},
      "depends_on": ["actual-reachability-path"],
      "parallel_group": "compliance",
      "priority": 4,
      "purpose": "查询拓扑覆盖率和数据新鲜度，判断合规结论是否可靠"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "actual_path",
      "path_compliance_violation"
    ],
    "optional_evidence_types": [
      "source_asset_identity",
      "destination_asset_identity",
      "expected_path",
      "special_topology_path",
      "path_data_quality",
      "path_policy_point"
    ]
  },
  "candidate_guardrails": [
    "没有合规违规证据时，不得输出路径合规异常作为候选根因。",
    "路径可达但合规失败时，只能说明路径偏离预期或存在风险，不能直接确认业务不可用根因。",
    "拓扑覆盖不足或配置过期时，必须把数据质量列为证据缺口。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "expected_path",
      "why_needed": "路径合规的核心是比较“实际路径”和“应达路径”。应达路径代表业务设计上应该经过的设备、安全域、链路或控制点。",
      "reason": "当前故障分析工具组未确认可用应达路径查询工具，无法取得该业务链路的设计路径。",
      "effect": "只能说明当前实际路径和已返回的合规违规情况，不能准确指出实际路径偏离了哪一段设计路径，也不能确认路径偏离就是本次故障根因。"
    },
    {
      "evidence_type": "special_topology_path",
      "why_needed": "专项拓扑用于表达特定业务、区域、安全域或专线场景下的路径要求，可能与通用拓扑视角不同。",
      "reason": "当前故障分析工具组未确认可用专项拓扑路径查询工具，无法取得业务专项拓扑中的源目关系和预期路径。",
      "effect": "不能判断当前路径是否违反专项拓扑要求；如果用户问题来自专项拓扑巡检，只能输出专项拓扑证据缺失，不能确认专项路径违规。"
    },
    {
      "evidence_type": "path_policy_point",
      "why_needed": "路径违规常见落点是防火墙、安全域、ACL、NAT 或路由策略等控制点，需要知道异常路径经过了哪些策略点。",
      "reason": "当前故障分析工具组未确认可用路径涉及策略点查询工具，无法把路径节点与防火墙策略、安全域、NAT 或 ACL 控制点关联起来。",
      "effect": "不能把路径合规异常进一步解释为策略阻断、NAT 异常、安全域绕行或 ACL 拒绝；这些方向只能作为待补验证项。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `actual_path`
- `path_compliance_violation`
- `expected_path`
- `special_topology_path`
- `path_data_quality`
- `path_policy_point`

若当前可见 MCP 工具无法支撑合规规则、应达路径或专项拓扑能力，不要编造工具名；在 `evidence_gaps` 中记录“路径合规方向未完成验证”。
