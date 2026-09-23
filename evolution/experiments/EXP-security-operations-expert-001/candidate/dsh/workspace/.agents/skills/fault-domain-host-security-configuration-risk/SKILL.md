---
name: fault-domain-host-security-configuration-risk
description: "主机安全配置异常、安全基线核查失败、弱配置风险等故障风险域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为主机安全配置和安全基线异常生成故障分析取证规划。典型问题信号包括：

- `SSH 配置不合规`
- `安全基线核查失败`
- `弱口令、危险服务、关键配置偏离`

本故障域分析配置风险是否可能造成业务或安全影响，不执行加固或修复。

## 分诊边界

- 用户明确提到基线、主机配置、安全配置、弱口令、SSH/RDP/口令策略等进入本故障域。
- 若用户同时描述业务访问失败，应补充业务访问链路取证，不能只凭基线异常确认访问故障。
- 安全基线失败通常是风险信号，必须结合资产、业务归属、暴露面、事件或访问链路判断影响。

## 证据缺口解释

主机安全配置风险要回答的是“配置项是否真的失败，以及失败项会造成什么安全或业务影响”。资产风险概览只能说明存在风险线索；要形成可信结论，需要基线检查结果、失败项明细和实际配置值。

- 基线核查结果：用来确认检查任务是否执行、是否失败、失败发生在什么时候。没有它，不能说明风险是当前有效还是历史记录。
- 配置违规明细：用来说明具体配置项、实际值和偏离基准。没有它，不能解释为什么不合规，也不能判断影响。

`evidence_gaps` 用来避免把“基线风险方向”写成“已确认配置故障”。

## 方向选择

契约域固定为 `host-security-configuration-risk`。
识别到下列线索时，在 `analysis_direction_ids` 中列出对应方向（可多选）：

- `baseline-failure`：安全基线失败、基线核查不通过。
- `weak-password`：弱口令、弱密码、默认口令风险。
- `critical-config-noncompliance`：关键配置不合规、SSH 配置不合规、配置违规。
- `service-config-risk`：服务配置、远程登录配置、端口配置或服务未加固。
- `business-impact-scope`：配置风险影响的业务系统和影响范围。

无专项线索时 `analysis_direction_ids` 可省略，由故障分析运行时按域展开取证计划。
## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "host-security-configuration-risk",
  "domain_display_name": "主机安全配置风险",
  "planning_basis": {
    "asset": {"ip": "<当前输入资产 IP 或名称>"},
    "baseline_item": "<用户给定配置项，有则填写>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "host_config_object_identity",
      "evidence_type": "asset_identity",
      "object_role": "asset",
      "resolved_arguments": {"ip": "<当前输入资产 IP，有则填写>", "keyword": "<当前输入资产名称，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "asset",
      "priority": 1,
      "purpose": "查询主机配置风险对应资产是否纳管及基础状态"
    },
    {
      "tool_call_id": "asset-risk-context",
      "tool_name": "mcp__sec-ops__ai_soc_master__vulnerabilities",
      "capability_id": "host_config_business_context",
      "evidence_type": "risk_item",
      "object_role": "asset",
      "resolved_arguments": {"assetId": null},
      "depends_on": ["asset-identity"],
      "parallel_group": "risk",
      "priority": 2,
      "purpose": "补充资产相关风险记录，辅助判断基线异常的影响范围",
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
      "baseline_check_result"
    ],
    "optional_evidence_types": [
      "configuration_violation",
      "asset_business_context",
      "related_event_window",
      "exposure_risk"
    ]
  },
  "candidate_guardrails": [
    "基线失败只能形成配置风险候选，不得直接确认业务不可用根因。",
    "弱口令、漏洞、违规配置要按风险影响表达，避免输出处置动作。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "baseline_check_result",
      "why_needed": "基线核查结果用于确认检查任务是否实际执行、哪些检查项失败、失败时间和检查依据。",
      "reason": "当前故障分析工具组未确认可用主机安全基线结果查询工具，无法取得基线任务和检查结论。",
      "effect": "不能确认具体基线项是否失败、失败是否仍有效或是否只是历史风险记录；不得直接输出配置失败为根因。"
    },
    {
      "evidence_type": "configuration_violation",
      "why_needed": "配置违规明细用于说明失败项的实际配置值、期望配置值和偏离基准。",
      "reason": "当前故障分析工具组未确认可用主机配置违规明细查询工具，无法取得具体配置项和实际值。",
      "effect": "不能定位具体配置项、配置值或偏离基准；只能输出主机配置风险未完成验证。"
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
- `baseline_check_result`
- `configuration_violation`
- `asset_business_context`
- `related_event_window`
