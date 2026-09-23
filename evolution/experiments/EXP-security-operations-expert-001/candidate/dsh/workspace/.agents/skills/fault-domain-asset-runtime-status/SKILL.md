---
name: fault-domain-asset-runtime-status
description: "资产离线、不可达、探测失败、采集异常等资产运行状态故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为资产运行状态异常生成故障分析取证规划。典型问题信号包括：

- `<REDACTED_PRIVATE_IP> 离线/不可达`
- `某主机探测失败`
- `设备离线、不可采集、心跳异常`

本 Skill 只规划，不直接执行 SOC 取证工具。

## 分诊边界

- 单资产离线、探测不可达、采集异常进入本故障域。
- 若用户明确给出源目访问关系，应优先由业务访问不通故障域处理，并把目标离线作为候选信号。
- 只看到“离线/不可达”不能直接确认服务器宕机；需要资产状态、探测状态、最后发现时间、采集能力、业务归属或同窗口事件支撑。

## 证据缺口解释

资产运行状态异常要回答的是“资产是真离线、探测不可达、采集异常，还是平台数据缺失”。资产身份和图节点状态只能给出当前视角的状态；要判断离线原因和可信度，还需要采集能力、心跳、运行事件和业务上下文。

- 采集能力：用来区分资产真实异常和采集配置缺失、采集链路异常。没有它，不能确认“不可采集”是不是故障本身。
- 同窗口事件 / 告警：用来判断资产离线是否伴随 Agent 异常、设备掉线、接口异常、服务故障或安全事件。没有它，只能说明状态异常，不能解释原因。

`evidence_gaps` 用来防止把“平台探测不到”直接写成“服务器宕机”。

## 方向选择

契约域固定为 `asset-runtime-status`。
识别到下列线索时，在 `analysis_direction_ids` 中列出对应方向（可多选）：

- `asset-offline-or-unreachable`：离线、探测不可达、设备不可达、主机离线。
- `asset-collection-abnormal`：采集异常、不可采集、心跳异常、Agent 异常。
- `asset-resource-abnormal`：CPU、内存、磁盘、负载等资源异常。
- `asset-interface-abnormal`：接口 down、网卡异常、链路 down、端口 down。
- `asset-hardware-software-abnormal`：硬件、电源、风扇、磁盘、进程或服务运行异常。

无专项线索时 `analysis_direction_ids` 可省略，由故障分析运行时按域展开取证计划。
## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "asset-runtime-status",
  "domain_display_name": "资产运行状态异常",
  "planning_basis": {
    "asset": {"ip": "<当前输入资产 IP 或名称>"},
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "asset_runtime_object_identity",
      "evidence_type": "asset_identity",
      "object_role": "asset",
      "resolved_arguments": {"ip": "<当前输入资产 IP，有则填写>", "keyword": "<当前输入资产名称，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "asset",
      "priority": 1,
      "purpose": "查询资产是否纳管、基础身份、在线状态和探测状态"
    },
    {
      "tool_call_id": "asset-runtime-state",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_node_detail",
      "capability_id": "asset_runtime_state_detail",
      "evidence_type": "asset_runtime_state",
      "object_role": "asset",
      "resolved_arguments": {"vid": null},
      "depends_on": ["asset-identity"],
      "parallel_group": "asset",
      "priority": 2,
      "purpose": "复核资产图节点运行状态、探测状态和告警统计",
      "argument_resolution": {
        "status": "deferred_until_dependency_result",
        "runtime_argument_sources": [
          {"argument": "vid", "from_tool_call_id": "asset-identity", "path": "$.assetId", "format": "asset:{value}"}
        ]
      }
    },
    {
      "tool_call_id": "asset-detail",
      "tool_name": "mcp__sec-ops__ai_soc_master__detail",
      "capability_id": "asset_runtime_state_detail",
      "evidence_type": "asset_runtime_state",
      "object_role": "asset",
      "resolved_arguments": {"assetId": null},
      "depends_on": ["asset-identity"],
      "parallel_group": "asset",
      "priority": 3,
      "purpose": "查询资产档案、生命周期、网络分区和采集状态",
      "argument_resolution": {
        "status": "deferred_until_dependency_result",
        "runtime_argument_sources": [
          {"argument": "assetId", "from_tool_call_id": "asset-identity", "path": "$.assetId"}
        ]
      }
    },
    {
      "tool_call_id": "asset-business-context",
      "tool_name": "mcp__sec-ops__ai_soc_master__listbizbyasset",
      "capability_id": "asset_runtime_business_context",
      "evidence_type": "asset_business_context",
      "object_role": "asset",
      "resolved_arguments": {"assetId": null},
      "depends_on": ["asset-identity"],
      "parallel_group": "asset",
      "priority": 4,
      "purpose": "查询异常资产关联业务系统和影响范围",
      "argument_resolution": {
        "status": "deferred_until_dependency_result",
        "runtime_argument_sources": [
          {"argument": "assetId", "from_tool_call_id": "asset-identity", "path": "$.assetId"}
        ]
      }
    },
    {
      "tool_call_id": "asset-collection",
      "tool_name": "mcp__sec-ops__ai_soc_ingest__get_admin_ingest_devic_ad206f9cdb7c",
      "capability_id": "asset_runtime_collection_capability",
      "evidence_type": "asset_collection_capability",
      "object_role": "asset",
      "resolved_arguments": {"assetId": null},
      "depends_on": ["asset-identity"],
      "parallel_group": "asset",
      "priority": 5,
      "purpose": "查询资产采集配置和采集能力",
      "argument_resolution": {
        "status": "deferred_until_dependency_result",
        "runtime_argument_sources": [
          {"argument": "assetId", "from_tool_call_id": "asset-identity", "path": "$.assetId"}
        ]
      }
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "asset_identity",
      "asset_runtime_state"
    ],
    "optional_evidence_types": [
      "asset_collection_capability",
      "asset_business_context",
      "related_event_window",
      "neighbor_or_path_context"
    ]
  },
  "candidate_guardrails": [
    "资产离线、探测不可达、采集异常只能形成候选原因，不能单独确认最终根因。",
    "资产未纳管时必须输出对象识别缺口，不得输出真实设备离线结论。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "asset_collection_capability",
      "why_needed": "采集能力证据用于判断资产是否配置了采集、探测或心跳能力，以及这些能力当前是否可用。",
      "reason": "当前故障分析工具组未确认可用采集能力详情工具，无法取得采集配置、采集任务和心跳能力明细。",
      "effect": "不能区分资产真实离线、采集配置缺失、采集链路异常或心跳数据缺失；只能输出资产运行状态方向受限完成。"
    },
    {
      "evidence_type": "related_event_window",
      "why_needed": "同窗口事件和告警可用于验证资产离线是否伴随 Agent 异常、接口 down、服务故障、采集失败或安全事件。",
      "reason": "当前故障分析工具组未确认可用事件和告警检索工具，无法取得故障窗口内的运行事件。",
      "effect": "不能用事件链路交叉验证资产离线原因；不得仅凭离线状态确认最终根因。"
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
- `asset_runtime_state`
- `asset_collection_capability`
- `asset_business_context`
- `related_event_window`

依赖资产 ID、图节点 ID、设备 ID 或业务 ID 的计划项必须同时声明 `depends_on` 和 `argument_resolution.runtime_argument_sources`；只写空 `resolved_arguments` 或只写 `depends_on` 都是不完整计划。

没有可用 MCP 工具时，应在 `evidence_gaps` 中记录“资产运行状态未完成验证”，不得绕过冻结计划直接查询。
