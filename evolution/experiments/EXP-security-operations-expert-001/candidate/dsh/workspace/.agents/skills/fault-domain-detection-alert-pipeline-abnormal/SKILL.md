---
name: fault-domain-detection-alert-pipeline-abnormal
description: "检测规则、关联规则、日志到告警链路、检测任务失败、告警漏报误报延迟等故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为检测 / 告警链路异常生成故障分析取证规划。典型问题信号包括：

- `日志有但没有告警`
- `检测规则未命中`
- `关联规则异常`
- `检测任务失败`
- `告警漏报、误报、延迟`

本 Skill 只分析检测链路是否正常，不做威胁研判，不判断攻击是否成立。

## 分诊边界

- 必须有日志、告警、检测规则、关联规则、检测任务、白名单、漏报误报等信号。
- 如果用户是在问某个告警是否为攻击，应进入威胁研判，不进入本故障域。
- 如果只是业务访问不通但没有检测链路上下文，不得进入本故障域。
- 日志无返回不能直接等于“没有异常”；必须区分日志源未采集、规则未启用、白名单抑制、任务失败和查询窗口不匹配。

## 证据缺口解释

检测 / 告警链路异常要回答的是“原始日志、检测规则、关联规则、任务执行和告警输出之间哪一段断了”。事件检索只能说明当前窗口查到了什么；要判断漏报、误报或延迟，必须补齐规则状态、告警生成链路、白名单命中和任务状态。

- 检测规则状态：用来判断规则是否启用、阈值是否变化、规则是否可执行。没有它，不能判断规则未命中是否异常。
- 告警生成链路：用来解释日志为什么生成或没有生成告警。没有它，不能确认是链路故障还是规则逻辑未命中。
- 白名单命中：用来判断告警是否被抑制。没有它，不能把“没有告警”解释成“没有风险”。
- 检测任务状态：用来判断任务是否运行、是否失败、是否延迟。没有它，不能区分任务没跑和规则没命中。

`evidence_gaps` 用来防止把“未检索到告警”误写成“没有异常”。

## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "detection-alert-pipeline-abnormal",
  "domain_display_name": "检测 / 告警链路异常",
  "planning_basis": {
    "asset": {"ip": "<当前输入资产 IP，有则填写>"},
    "rule_hint": "<规则名、规则 ID 或检测任务线索，有则填写>",
    "event_hint": "<日志、告警或事件线索，有则填写>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "detection_pipeline_object_identity",
      "evidence_type": "asset_identity",
      "object_role": "asset",
      "resolved_arguments": {"ip": "<当前输入资产 IP，有则填写>", "keyword": "<当前输入资产名称，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "asset",
      "priority": 1,
      "purpose": "查询检测链路关联资产是否纳管及基础状态"
    },
    {
      "tool_call_id": "event-window-search",
      "tool_name": "mcp__sec-ops__ai_soc_event__post_event_search",
      "capability_id": "detection_pipeline_event_window",
      "evidence_type": "raw_log_or_event_window",
      "object_role": "asset_or_rule",
      "resolved_arguments": {
        "query": "<围绕资产 IP、规则名、告警名或用户给定关键词生成只读检索条件>",
        "timeRange": "<用户给定或默认查询窗口>",
        "pageSize": 50
      },
      "depends_on": [],
      "parallel_group": "event",
      "priority": 2,
      "purpose": "查询同窗口日志、事件和告警线索，判断是否存在输入事件或告警输出"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "raw_log_or_event_window",
      "detection_rule_state",
      "alert_generation_state"
    ],
    "optional_evidence_types": [
      "asset_identity",
      "correlation_rule_state",
      "detection_task_state",
      "whitelist_hit",
      "log_source_collection_state",
      "rule_change_history"
    ]
  },
  "candidate_guardrails": [
    "没有规则状态、任务状态或告警生成链路证据时，不得确认检测链路故障。",
    "事件检索为空时只能说明本次检索未命中，不能直接输出没有日志或没有告警。",
    "本故障域不输出攻击结论，只输出检测链路、规则链路或数据链路候选问题。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "detection_rule_state",
      "why_needed": "检测规则状态用于确认规则是否启用、阈值是否变化、规则版本是否正确以及规则是否可执行。",
      "reason": "当前故障分析工具组未确认可用检测规则状态查询工具，无法取得规则启停、版本、阈值和运行状态。",
      "effect": "不能判断规则未命中是正常逻辑结果、规则关闭、阈值变化还是规则异常；不得确认检测规则故障。"
    },
    {
      "evidence_type": "alert_generation_state",
      "why_needed": "告警生成链路用于追踪原始日志、解析、规则匹配、聚合、关联和告警输出之间的转换过程。",
      "reason": "当前故障分析工具组未确认可用告警生成链路查询工具，无法取得日志到告警的处理轨迹。",
      "effect": "不能解释日志为什么没有生成告警，也不能确认是漏报、延迟、关联失败还是正常未命中。"
    },
    {
      "evidence_type": "whitelist_hit",
      "why_needed": "白名单命中用于判断原本应产生的告警是否被白名单、抑制规则或降噪策略过滤。",
      "reason": "当前故障分析工具组未确认可用告警白名单命中查询工具，无法取得抑制记录。",
      "effect": "不能判断告警是否被白名单或抑制规则过滤；不得把无告警直接解释为无风险。"
    },
    {
      "evidence_type": "detection_task_state",
      "why_needed": "检测任务状态用于确认任务是否运行、是否失败、是否延迟，以及数据源是否被任务覆盖。",
      "reason": "当前故障分析工具组未确认可用检测任务状态查询工具，无法取得任务运行和失败记录。",
      "effect": "不能区分规则未命中、检测任务未运行、任务失败或数据源未覆盖；只能输出检测链路方向未完成验证。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `raw_log_or_event_window`
- `detection_rule_state`
- `alert_generation_state`
- `correlation_rule_state`
- `detection_task_state`
- `whitelist_hit`
- `log_source_collection_state`

若当前可见 MCP 工具无法支撑规则、任务、白名单或告警链路能力，应保留事件窗口取证并把缺失能力写入 `evidence_gaps`。
