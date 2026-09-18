# 取证规划表达边界参考

## 目标

本文件说明故障分析智能体在调用运行时服务前，如何组织 `agent_planning_result`。

规划职责属于故障分析能力和具体故障域 Skill：它们负责识别故障域、选择取证能力、在当前 `Runtime MCP 声明` 挂载的故障分析工具组 server key 下选择可用 SOC 只读工具，并声明业务证据契约。当前环境通常使用 `sec-ops`，因此计划工具名前缀为 `mcp__sec-ops__...`。运行时服务不维护 MCP 工具目录、不从工具名反推业务能力，只冻结本轮已提交的结构化计划，并校验后续工具回填是否匹配冻结计划。

## 输入

| 输入 | 说明 |
| --- | --- |
| 当前用户问题 | 当前轮输入优先于历史上下文，用于抽取源、目标、资产、漏洞、配置异常或策略线索；“巡检：”“工单：”等只作为来源前缀处理 |
| 上游上下文 | Gov 在同会话中给到的异常摘要、工单摘要、历史对话或任务包，只能作为补充上下文 |
| 故障域 Skill | 负责本故障域的分诊边界、证据类型、候选根因门禁和输出约束 |
| 当前可见 MCP 工具 | 来自 `Runtime MCP 声明` 挂载的故障分析工具组，只能在运行时冻结计划后执行 |
| 查询预算和权限上下文 | 用于限制计划规模、并发、超时和只读边界 |

## 硬约束

| 约束 | 说明 |
| --- | --- |
| 先规划后冻结 | 调用运行时服务前必须提交 `agent_planning_result`；运行时返回冻结计划后才允许执行 SOC 工具 |
| 工具不写死 | Runtime 不保存 MCP 工具目录；故障域 Skill 也不写死环境专属工具清单，只从当前可见工具中选择 |
| 不猜工具 | 当前可见工具不能覆盖某项能力时，记录 `evidence_gaps`，不得编造工具名 |
| 能力显式声明 | 每个计划项必须声明 `capability_id` 和 `evidence_type`，运行时不从工具名推断 |
| 证据契约随计划提交 | 新增故障域或新增证据类型时，先在故障域 Skill 中声明证据契约，再交给运行时冻结 |
| 只读取证 | 计划中的 SOC 工具必须是只读查询，不得包含处置、写入、策略变更或隔离动作 |
| 依赖显式 | 依赖前序资产 ID、设备 ID、业务 ID 的计划项必须声明 `depends_on` 和 `argument_resolution.runtime_argument_sources`，只写空参数或只写依赖关系都不是可冻结计划 |
| 当前问题优先 | 当前输入对象和症状优先于历史上下文；冲突无法消解时计划应阻断，不能静默使用历史对象 |
| 候选受门禁约束 | 某方向核心工具不可用时，只能输出该方向未完成验证，不得输出对应根因候选 |
| 禁止空计划 | 除显式 invalid 计划外，`tool_call_plan` 不得为空；不得先调用 SOC 工具探测后再补计划 |

## `agent_planning_result` 模板

```json
{
  "domain_id": "business-access-unreachable",
  "domain_display_name": "业务访问不通 / 源目网络不可达",
  "planning_basis": {
    "current_question_objects_preferred": true,
    "source": {"ip": "<REDACTED_PRIVATE_IP>"},
    "destination": {"ip": "<REDACTED_PRIVATE_IP>"},
    "time_window": "近 24 小时"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "source-asset-identity",
      "tool_name": "<当前 Runtime MCP 声明 故障分析工具组中真实可见的只读工具名>",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "source_asset_identity",
      "object_role": "source",
      "resolved_arguments": {"ip": "<REDACTED_PRIVATE_IP>"},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询源资产身份、在线状态和探测状态"
    },
    {
      "tool_call_id": "destination-asset-identity",
      "tool_name": "<当前 Runtime MCP 声明 故障分析工具组中真实可见的只读工具名>",
      "capability_id": "business_access_object_identity_resolution",
      "evidence_type": "destination_asset_identity",
      "object_role": "destination",
      "resolved_arguments": {"ip": "<REDACTED_PRIVATE_IP>"},
      "depends_on": [],
      "parallel_group": "object_identity",
      "priority": 1,
      "purpose": "查询目标资产身份、在线状态和探测状态"
    },
    {
      "tool_call_id": "primary-reachability-path",
      "tool_name": "<当前 Runtime MCP 声明 故障分析工具组中真实可见的只读工具名>",
      "capability_id": "business_access_primary_reachability_path",
      "evidence_type": "primary_reachability_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {"srcIp": "<REDACTED_PRIVATE_IP>", "dstIp": "<REDACTED_PRIVATE_IP>"},
      "depends_on": [],
      "parallel_group": "path",
      "priority": 2,
      "purpose": "查询源到目标的路径可达性和断点线索"
    },
    {
      "tool_call_id": "asset-based-reachability-path",
      "tool_name": "<当前 Runtime MCP 声明 故障分析工具组中真实可见的只读工具名>",
      "capability_id": "business_access_asset_based_reachability_path",
      "evidence_type": "asset_based_reachability_path",
      "object_role": "source_to_destination",
      "resolved_arguments": {
        "sourceAssetId": null,
        "destinationAssetId": null
      },
      "depends_on": ["source-asset-identity", "destination-asset-identity"],
      "parallel_group": "path",
      "priority": 3,
      "purpose": "用资产标识交叉验证路径可达性",
      "argument_resolution": {
        "status": "deferred_until_dependency_result",
        "runtime_argument_sources": [
          {"argument": "sourceAssetId", "from_tool_call_id": "source-asset-identity", "path": "$.assetId"},
          {"argument": "destinationAssetId", "from_tool_call_id": "destination-asset-identity", "path": "$.assetId"}
        ]
      }
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
  "evidence_gaps": [
    {
      "evidence_type": "policy_or_acl_state",
      "reason": "当前可见 MCP 工具未覆盖策略命中或拒绝日志查询",
      "effect": "不能确认是否被 ACL、防火墙、NAT 或安全策略拦截"
    }
  ],
  "candidate_guardrails": [
    "路径可达时不得输出源侧网关或路由缺失候选根因。",
    "策略变更工具不可用时不得输出策略变更候选根因。",
    "HA 工具不可用时不得输出主备策略差异候选根因。"
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

## 计划失败表达

无法形成可冻结计划时，`agent_planning_result` 应明确不可执行原因：

```json
{
  "domain_id": "business-access-unreachable",
  "planning_status": "invalid",
  "blocking_reasons": [
    "当前输入和历史上下文中的源目对象冲突，无法确定本轮排查对象"
  ],
  "tool_call_plan": [],
  "evidence_contract": {
    "required_evidence_types": []
  }
}
```

这种情况下运行时会返回“计划未完成”，智能体不得直接调用 SOC 工具补救，也不得输出根因候选。
