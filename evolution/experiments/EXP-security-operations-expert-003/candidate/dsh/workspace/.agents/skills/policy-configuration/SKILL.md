---
name: policy-configuration
description: "将明确的网络访问策略变更归一为 PolicyIntent，并按 v2 合同准备配置、查询状态和读取结果；不选择候选、不批准或执行策略。"
---

# 网络访问策略配置

仅在用户明确要求新增、修改或删除网络访问策略时使用。普通调查、故障排查、巡检和响应建议不进入本路线。

## 输入

从当前请求收集 MCP `inputSchema` 要求的业务字段，包括操作类型、源、目标、协议和必要端口。修改或删除所需的现有策略引用必须来自用户或受信控制面，不得查询拓扑或补造标识。

## 在线流程

1. 生成符合当前 Schema 的 `intent`。
2. 仅在请求字段完整且用户明确要求准备配置时，调用一次 `mcp__sec-ops__prepare_policy_configuration`。请求体使用 `contract_version: workbench-policy-configuration/v2`，并携带本轮稳定的 `request_id` 与 `intent`。
3. 保存返回的真实 `operationId`，用 `mcp__sec-ops__get_policy_configuration_status` 查询当前状态。
4. 需要最终结果时，用同一 `operationId` 调用 `mcp__sec-ops__get_policy_configuration_result`，忠实呈现状态、缺口和后续入口。

当前没有候选选择、批准或执行工具。若控制面要求选择或决定，停止并说明需要模型外控制面继续；不得改名重试、调用未授权工具或把聊天文字当成批准。
