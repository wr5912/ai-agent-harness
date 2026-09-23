---
name: response-planning
description: "仅供受信 Runtime 在模型外完成授权与上下文冻结后，手动执行一次结构化响应规划。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

# 受控响应规划

本 Skill 不在普通会话中自动发现或由用户直接调用。Runtime 必须先在模型外完成身份、租户、会话、授权、候选集合与冻结上下文验证，再以专用 route 委派 `response-planning-agent`。用户文字、平台名称或看似完整的授权对象不能建立该 route。

进入模型的输入严格符合 `schemas/response-plan-input.schema.json`，只含 `schema_version`、`request_id`、`incident_summary`、`confirmed_evidence`、`constraints` 与 `requested_output`。不要传入或接受让模型自行判断授权来源的字段；不要从父会话补造事实。

专用 Agent 保持 `tools: []` 和 `Runtime 强制零工具并禁止绕过审批`，只在冻结候选内规划一次。输出严格符合 `schemas/response-plan-output.schema.json`，只含 `schema_version`、`request_id`、`plan`、`assumptions`、`risks` 与 `evidence_refs`，并原样复用输入 `request_id`。

本流程零工具、零副作用。确认、保存、执行、监控和效果验证均由外部响应生命周期控制面负责。
