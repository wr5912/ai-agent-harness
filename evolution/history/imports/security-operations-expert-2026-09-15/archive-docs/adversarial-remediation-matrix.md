# 对抗性 Review 整改证据矩阵

本矩阵逐项对应 2026-08-12 对抗性 Review 的 54 项结论。状态只表达当前 Workspace 可证明的
事实，不以“已改文件”替代验证，也不以总测试通过率抵消关键安全门失败。

状态定义：

- `FIXED`：目标实现和适用 hard gates 均有当前证据；
- `PARTIAL`：已有整改或测试，但仍缺某一实现层/运行层证据；
- `ACCEPTED-PERSONAL`：只在 `personal-debug`、单用户人工在环范围接受；
- `OUT-OF-SCOPE`：必须由 Workspace 外的 Runtime、managed policy 或服务端实现；
- `POSITIVE`：原 Review 的正向确认，保持并防回归。

证据层：`S` 静态/config，`U` unit/contract，`A` adversarial，`R` safe runtime，`L` isolated live，
`E` 外部部署证据。状态升级为 `FIXED` 时必须覆盖该行列出的全部适用层。

| # | 状态 | 证据层 | 当前证据与剩余门禁 |
|---:|---|---|---|
| 1 | FIXED | S/U/R | Policy 正式入口唯一为 `prepare → status`；本地真实 Hook 序列覆盖确定性 request_id、可信 Post `operationId`、同 prompt status 放行及跨 prompt/伪 ID ask；legacy 已退出 discovery。 |
| 2 | FIXED | S/U | settings 使用 `//data` 宿主绝对锚点；checker/负例拒绝单 `/data` 以及 path-qualified Write/Notebook/Glob。 |
| 3 | FIXED | U/A | malformed PreToolUse 稳定输出 deny/exit 0，malformed PostToolUse 与未处理异常 exit 2/no stdout；settings adapter 均配置非零退出 fail-closed fallback。 |
| 4 | PARTIAL | S/U/A | `Bash(jq *)`、`rg/find/date` 可执行/写入型 broad allow 已移除并有 exploit 回归；模型子进程不继承 Secret 仍需 Runtime 证据。 |
| 5 | ACCEPTED-PERSONAL | S/A/E | personal-debug 明示不提供多租户默认拒读；生产 tenant filesystem 隔离由外部 Runtime 强制。 |
| 6 | ACCEPTED-PERSONAL | S/A/R | 个人模式保留精确父级能力，mutation ask、系统破坏 deny；生产仍须由 Runtime 按 route 缩面。 |
| 7 | FIXED | S/U/A | 无 server-wide MCP allow；checker 拒绝 wildcard，evil-server 同后缀测试证明新增/伪造工具不会继承精确例外。 |
| 8 | PARTIAL | S/U/R | Fault Agent 静态 exact tools、agent ownership 与冻结计划 Hook 已覆盖；actual SDK 每次运行的动态 effective surface 尚无取证。 |
| 9 | PARTIAL | S/U/R | 已移除 Skill `allowed-tools` 安全承诺，Agent 使用 exact tools/permission mode；仍缺实际 SDK options/effective surface 证据。 |
| 10 | FIXED | S/U/A/R | Workspace 内 response planning 已 manual-only、专用 `tools: []`/`dontAsk`、禁模型调用、严格 schema 与 deterministic Stop gate；fake gate、身份歧义及冻结候选越界均阻断。外部来源认证单列 #16/#46。 |
| 11 | PARTIAL | S/U/A/R | internal Skills 已隐藏并进入 exact ask；`user-invocable:false` 不等于模型权限，仍需 Runtime 的 route-scoped skills 证据。 |
| 12 | FIXED | U/A | missing/deferred/empty frozen args 均 ask，且空对象不建立可消费计划。 |
| 13 | FIXED | U/A | frozen args 使用 canonical exact equality；missing/extra/nested drift、重复及跨 prompt 均有拒绝回归。 |
| 14 | PARTIAL | U/A/R | trace 与 cleanup 在 personal-debug 始终 ask；生产 cleanup Runtime-only 仍缺外部部署证据。 |
| 15 | FIXED | U/A/R | KB `INIT→LIST_DONE→SEARCH_DONE/CLOSED` 已执行化；完整 eligible set、显式唯一子集、重复/跨 prompt/不可信 transcript 均有状态机负例。 |
| 16 | OUT-OF-SCOPE | A/R/E | 来源认证需服务端 tenant/session/snapshot/nonce 绑定；Workspace 只拒绝把文本格式当证明。 |
| 17 | FIXED | S/U | CLAUDE.md 已收敛为共享不变量与一级逻辑路由；详细 SOP/schema 下沉专属资产，语义契约测试防回归。 |
| 18 | FIXED | S/U | active `.claude/rules` 为空，重复 Rules 仅在 legacy；正式 authority 单一且测试锁定。 |
| 19 | PARTIAL | S/R | 主编排指令不得污染 Subagent；须从实际 subagent context 取证。 |
| 20 | FIXED | S/U/A/R | response input/output 均为 versioned、closed schema；Stop/SubagentStop validator 覆盖真实 transcript、request 对账、重复身份、候选/action/evidence 越界和 fake gate。 |
| 21 | PARTIAL | S/U | Manifest 已收敛为逻辑能力及显式 external requirements 声明；仍缺通用 lint 防止未来重新混入物理部署/observability 承诺。 |
| 22 | FIXED | S/U | checker 强制唯一顶层 `schema_version: agent-manifest/v1`，错误/缺失/漂移均有负例。 |
| 23 | FIXED | S/U | checker 强制 direct/delegated/guarded 均非空、capability id 无重复、capabilities exact closure、Agent binding 与 active agents 精确闭包。 |
| 24 | FIXED | S/U | capability contracts 分离 `data_effect` 与 `operational_effect`；Threat/Fault/Inspection 分别锁定 report-write、creates-run、starts-job。 |
| 25 | ACCEPTED-PERSONAL | S/E | personal-debug 可记录本机布局；生产物理路径必须由 Runtime profile 绑定。 |
| 26 | PARTIAL | S/U | 模型资产应引用 logical capability；须清理故障域模板中的散落物理名。 |
| 27 | PARTIAL | S/U | 物理 tool 名应局限在 binding/permission/contract；须对模型资产做范围 lint。 |
| 28 | PARTIAL | S/U | 平台名仅在身份确属业务契约时保留；可信判断必须使用逻辑角色和 Runtime metadata。 |
| 29 | PARTIAL | S/U/R | active commands 已为空，事件入口统一为 `security-investigation` Skill，两个旧 command 仅在 legacy；仍缺真实 CLI/SDK discovery smoke。 |
| 30 | FIXED | S/U | active 资产使用 `Agent`，正式 Agent 集合与 matcher 均有契约测试；旧 `Task` 不再作为当前入口。 |
| 31 | PARTIAL | S/U/A | fork Skill 必须显式消费 `$ARGUMENTS` 并拒绝空/隐形会话输入。 |
| 32 | ACCEPTED-PERSONAL | S/A/R | personal-debug 可由项目 Hook 防父级直调；生产仍需 inspection-agent 物理专属 MCP。 |
| 33 | PARTIAL | U/R | UUID、timezone、timeout 应由 Runtime 确定；须证明模型无法覆盖/复用。 |
| 34 | FIXED | S/U | legacy Policy Agent/command 已退出正式 discovery，preview 固定 ask；新流程不再依赖旧参数链。 |
| 35 | PARTIAL | S/U | Hook 可继续作 adapter；policy/state/schema 模块化程度与复杂度预算尚未完全关闭。 |
| 36 | FIXED | U/A | Fault/KB/Audit/Threat 状态覆盖 0700/0600、逐组件 NOFOLLOW、hardlink/symlink ancestor、锁、原子替换、并发单赢家及 TTL。 |
| 37 | FIXED | U/A/R | Fault 授权使用 session/cwd/prompt/tool/agent digest；可信 evidence/result 与 Post 事件精确绑定，最终正文由 digest-only SubagentStop 契约强制透传。 |
| 38 | FIXED | U/A | prompt-wide state key 为 canonical session scope + prompt digest + agent type 的完整 SHA-256；同 prompt sibling Agent 原子争用单文件，状态内 owner digest 严格绑定首个 Agent；跨 session/cwd/prompt/agent 与不落 raw identifier 均有测试。 |
| 39 | PARTIAL | U/A | 同事件多个 Hook 不得依赖执行顺序；需并发交错测试证明。 |
| 40 | FIXED | S/U | 正式 settings 不再注册 SessionStart，静态注入脚本仅留 legacy；回归测试锁定。 |
| 41 | PARTIAL | U/A/E | 审计需脱敏、mode、锁、10 MiB 轮转三份；生产 tenant 分区仍属外部部署。 |
| 42 | POSITIVE | S/U | 保持 `.mcp.json` `${VAR}`/Bearer 占位符，不将 URL 或 Token 固化到包内。 |
| 43 | PARTIAL | S/U/R | settings 不依赖未证明的域名变量插值；实际 effective network policy 仍需 Runtime 验证。 |
| 44 | PARTIAL | S/U/R | Threat/Inspection 仅由专职 Agent inline `mcpServers` 自描述并从父上下文移除；启动仍需校验 endpoint、exact tools/schema。 |
| 45 | OUT-OF-SCOPE | S/R/E | role-scoped MCP Server/Token 由连接器和服务端实现；Workspace 只声明所需 scope。 |
| 46 | OUT-OF-SCOPE | S/R/E | 托管 Runtime 必须固定 setting sources、禁 Auto Memory 并做 tenant filesystem 隔离。 |
| 47 | OUT-OF-SCOPE | S/R/E | managed settings/hooks/MCP allowlist 是组织信任根；项目 settings 不能自证不可覆盖。 |
| 48 | ACCEPTED-PERSONAL | S/U | `defaultMode: default` 仅适用于人工在环 personal-debug；后台 route 必须 `dontAsk`。 |
| 49 | FIXED | S/U | `.worktreeinclude` 仅允许空行/注释；checker 对任何 active pattern（含 local settings、`.env`、runtime state）均 fail。 |
| 50 | FIXED | S/U | active 资产无“232”等硬编码数量；eligible set 只来自同 prompt 实时 list，且测试证明无本地数量上限。 |
| 51 | PARTIAL | S/U | 模型 reference 只保留执行知识；部署/管理员验收说明迁往 docs。 |
| 52 | PARTIAL | S/U/R | UUID、默认值、schema 与设备固定参数逐步下沉 Runtime/tool schema；尚缺全路线证明。 |
| 53 | PARTIAL | S/U/R/L | README/canonical checker 已完成；本轮干净 staged `--release` 对 86 个当前内容文件通过，规范化 tar SHA-256 记录在本轮验收输出。尚缺导入 bootstrap、isolated live 与部署后 digest parity。 |
| 54 | PARTIAL | S/U/R | 静态 checker 已覆盖 manifest/binding、permissions、inline MCP 与发布工件；仍缺 Runtime startup `tools/list`、server identity 与 schema-hash negotiation。 |

## 硬门

以下任一失败时，候选不得宣称完成，即使其余 pytest 全绿：

1. 正式 happy path 不可达或 legacy/forbidden path 可达；
2. 安全 Hook 的 malformed/error path 非 fail-closed；
3. 父/子 Agent effective tool surface 超出 route contract；
4. frozen arguments、KB eligible set 或可信控制面 binding 不精确；
5. 默认测试发生外部连接或真实生产副作用；
6. 已通过的 threat-analysis critical regression 出现新增失败。
