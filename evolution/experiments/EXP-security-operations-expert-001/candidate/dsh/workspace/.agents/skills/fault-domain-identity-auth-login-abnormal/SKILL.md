---
name: fault-domain-identity-auth-login-abnormal
description: "用户名口令、人脸、指纹、指静脉、认证服务器、权限菜单、登录 403 等身份认证与登录访问异常故障域规划。只生成故障分析 agent_planning_result，不直接执行 SOC 取证工具。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## 职责

为身份认证与登录访问异常生成故障分析取证规划。典型问题信号包括：

- `用户名口令登录失败`
- `人脸识别登录失败`
- `指纹仪登录失败`
- `指静脉登录失败`
- `认证服务器不可达`
- `登录成功但无菜单 / 403`
- `认证终端到认证服务器连接失败`

本 Skill 只分析登录认证链路、账号状态、权限授权、认证设备和网络路径，不执行账号解锁、授权调整或策略变更。

## 分诊边界

- 明确出现登录、认证、账号、口令、人脸、指纹、指静脉、权限、菜单、403、认证服务器、认证终端等信号时进入本故障域。
- 如果只有源 IP 到目标 IP 访问不通，没有认证语义，进入业务访问不通故障域。
- 登录失败不能只按网络不通解释；必须同时考虑账号状态、认证方式绑定、认证日志、认证服务健康、终端设备和权限菜单。
- 缺少账号 / 认证类 MCP 时，只能输出“认证方向未完成验证”，不得确认账号锁定、密码错误、权限缺失或设备故障。

## 证据缺口解释

身份认证与登录访问异常要回答的是“登录失败发生在账号、认证方式、认证服务、终端设备、网络路径还是权限菜单”。资产和路径证据只能说明认证设备或服务器是否可达；要判断具体登录原因，必须取得账号状态、认证方式绑定、角色菜单权限、生物识别设备状态和认证策略变更。

- 账号状态：用来判断账号是否锁定、禁用、过期或被密码策略限制。没有它，不能确认账号类原因。
- 认证方式绑定：用来判断人脸、指纹、指静脉等模板是否存在且绑定正确。没有它，不能确认生物识别失败原因。
- 角色 / 菜单权限：用来判断登录成功后无菜单、403 或无权限。没有它，不能确认授权问题。
- 生物识别设备状态：用来判断采集设备、驱动或 SDK 是否异常。没有它，不能确认设备侧问题。
- 认证策略变更：用来判断密码策略、生物识别策略或认证服务配置是否近期变化。没有它，不能把登录失败与策略变化关联。

`evidence_gaps` 用来防止把登录失败粗暴归因到密码错误、网络不通或权限缺失。

## 方向选择

契约域固定为 `identity-auth-login-abnormal`。
识别到下列线索时，在 `analysis_direction_ids` 中列出对应方向（可多选）：

- `account-password-auth`：用户名口令登录失败、密码错误、账号锁定、账号禁用或过期。
- `biometric-auth-device`：人脸、指纹、指静脉、生物识别终端或采集设备异常。
- `auth-server-abnormal`：认证服务器、认证网关、LDAP / AD / Radius / CAS 服务异常。
- `auth-network-path`：认证终端到认证服务器链路不可达、超时或策略阻断。
- `auth-policy-or-permission`：登录后无菜单、403、角色权限、菜单权限或认证策略异常。

无专项线索时 `analysis_direction_ids` 可省略，由故障分析运行时按域展开取证计划。
## 规划契约

`agent_planning_result` 必须包含：

```json
{
  "domain_id": "identity-auth-login-abnormal",
  "domain_display_name": "身份认证与登录访问异常",
  "planning_basis": {
    "account": {"username": "<当前输入用户名，有则填写>"},
    "client": {"ip": "<登录终端 IP，有则填写>"},
    "auth_server": {"ip": "<认证服务器 IP，有则填写>"},
    "login_type": "<password/face/fingerprint/finger_vein/unknown>",
    "time_window": "<用户给定或默认查询窗口>"
  },
  "tool_call_plan": [
    {
      "tool_call_id": "client-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "identity_auth_client_identity",
      "evidence_type": "client_asset_identity",
      "object_role": "client",
      "resolved_arguments": {"ip": "<登录终端 IP，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "asset",
      "priority": 1,
      "purpose": "查询登录终端或认证设备是否纳管及基础状态"
    },
    {
      "tool_call_id": "auth-server-asset-identity",
      "tool_name": "mcp__sec-ops__ai_soc_master__list_8",
      "capability_id": "identity_auth_server_identity",
      "evidence_type": "auth_server_asset_identity",
      "object_role": "auth_server",
      "resolved_arguments": {"ip": "<认证服务器 IP，有则填写>", "keyword": "<认证服务器名称，有则填写>", "pageSize": 10},
      "depends_on": [],
      "parallel_group": "asset",
      "priority": 1,
      "purpose": "查询认证服务器、认证网关或认证设备是否纳管及运行状态"
    },
    {
      "tool_call_id": "auth-path",
      "tool_name": "mcp__sec-ops__ai_soc_graph__get_graph_path_query",
      "capability_id": "identity_auth_network_path",
      "evidence_type": "auth_network_path",
      "object_role": "client_to_auth_server",
      "resolved_arguments": {"srcIp": "<登录终端 IP>", "dstIp": "<认证服务器 IP>"},
      "depends_on": [],
      "parallel_group": "path",
      "priority": 2,
      "purpose": "查询登录终端到认证服务之间是否存在网络或策略路径问题"
    },
    {
      "tool_call_id": "login-event-window",
      "tool_name": "mcp__sec-ops__ai_soc_event__post_event_search",
      "capability_id": "identity_auth_login_event_window",
      "evidence_type": "login_failure_event_window",
      "object_role": "account_or_client",
      "resolved_arguments": {
        "query": "<围绕用户名、终端 IP、认证服务器 IP、登录方式生成只读检索条件>",
        "timeRange": "<用户给定或默认查询窗口>",
        "pageSize": 50
      },
      "depends_on": [],
      "parallel_group": "event",
      "priority": 3,
      "purpose": "查询登录失败、认证失败、权限拒绝、设备异常或策略拦截相关日志"
    }
  ],
  "evidence_contract": {
    "required_evidence_types": [
      "account_state",
      "login_failure_event_window",
      "auth_method_binding"
    ],
    "optional_evidence_types": [
      "client_asset_identity",
      "auth_server_asset_identity",
      "auth_network_path",
      "role_permission",
      "menu_permission",
      "auth_server_health",
      "biometric_device_state",
      "biometric_match_log",
      "auth_policy_change"
    ]
  },
  "candidate_guardrails": [
    "没有账号状态证据时，不得输出账号锁定、禁用、过期或密码错误为候选根因。",
    "没有认证日志或认证服务证据时，不得确认认证服务器异常。",
    "登录成功但无菜单或 403，必须优先检查角色、菜单、权限和白名单证据，不得只按网络故障处理。",
    "生物识别失败必须区分模板未绑定、采集设备离线、比对失败、驱动或 SDK 异常。"
  ],
  "evidence_gaps": [
    {
      "evidence_type": "account_state",
      "why_needed": "账号状态用于确认用户是否被禁用、锁定、过期、密码错误次数超限或受密码策略限制。",
      "reason": "当前故障分析工具组未确认可用用户账号状态查询工具，无法取得账号生命周期和锁定状态。",
      "effect": "不能确认账号是否禁用、锁定、过期或密码策略异常；不得把登录失败直接归因到账号问题。"
    },
    {
      "evidence_type": "auth_method_binding",
      "why_needed": "认证方式绑定用于确认用户是否已绑定口令、人脸、指纹、指静脉等认证要素，以及绑定是否有效。",
      "reason": "当前故障分析工具组未确认可用认证方式绑定查询工具，无法取得用户认证要素绑定关系。",
      "effect": "不能确认人脸、指纹或指静脉模板是否已绑定或失效；不得确认生物识别失败原因。"
    },
    {
      "evidence_type": "role_permission",
      "why_needed": "角色权限用于判断用户登录后是否具备访问目标系统、功能或接口的授权。",
      "reason": "当前故障分析工具组未确认可用角色权限查询工具，无法取得用户角色和权限点。",
      "effect": "不能解释登录成功后无权限或 403 的原因；不得确认角色授权异常。"
    },
    {
      "evidence_type": "menu_permission",
      "why_needed": "菜单权限用于判断用户是否被授予对应菜单、按钮或路由权限，是定位登录成功但无菜单问题的核心证据。",
      "reason": "当前故障分析工具组未确认可用菜单权限查询工具，无法取得菜单、路由和权限码授权状态。",
      "effect": "不能定位菜单缺失、权限码异常或运维白名单影响；不得确认菜单权限故障。"
    },
    {
      "evidence_type": "biometric_device_state",
      "why_needed": "生物识别设备状态用于判断人脸、指纹、指静脉采集设备、驱动、SDK 或终端是否正常。",
      "reason": "当前故障分析工具组未确认可用生物识别设备状态查询工具，无法取得设备在线、驱动和采集状态。",
      "effect": "不能判断人脸、指纹或指静脉失败是否由设备离线、驱动或 SDK 异常导致；只能列为待补验证。"
    },
    {
      "evidence_type": "auth_policy_change",
      "why_needed": "认证策略变更用于判断密码策略、生物识别策略、认证服务器配置或登录控制策略是否在故障窗口附近发生变化。",
      "reason": "当前故障分析工具组未确认可用认证策略变更查询工具，无法取得认证配置和策略变更记录。",
      "effect": "不能判断近期认证策略、密码策略或生物识别策略变更是否相关；不得把登录失败归因到策略变更。"
    }
  ],
  "output_policy": {
    "forbid_internal_terms": true,
    "fixed_report_link_label": "故障分析报告"
  }
}
```

推荐证据类型：

- `account_state`
- `login_failure_event_window`
- `auth_method_binding`
- `role_permission`
- `menu_permission`
- `auth_server_health`
- `auth_network_path`
- `biometric_device_state`
- `biometric_match_log`

认证类工具未补齐时，可以保留终端 / 认证服务器资产、网络路径、登录事件窗口等基础取证；但不得把认证失败原因写成确定结论。
