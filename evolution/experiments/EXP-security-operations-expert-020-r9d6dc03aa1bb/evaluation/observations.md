# EXP020 威胁研判 MCP 分组接入观察

本轮基于 `EXP-security-operations-expert-019-rc442472a242a` 的 Candidate，将威胁研判固定流程从旧 SOC 资源网关与独立报告地址迁移为本实例网页 MCP 配置中的 `threat-analysis-runtime` 分组。模型侧仍只暴露 `analyze_threat_incident` 与受信 Schedule 入口；SOC 和报告原始能力没有加入模型工具面。

## 确定性验证

- Candidate Node 合同测试 20 项通过，覆盖 OpenAPI 成功和失败状态元数据、MCP 分组 Tool/Resource/Resource Template、成员发现失败隔离、自动研判合同及运行级分组桥；pending 模式只发现 Tool，不会因无关 Resource/Resource Template 成员不可用而提前失败。
- Python 威胁研判回归 9 项通过，覆盖本机桥请求、固定状态入口、409 传递、同一 judgementId/body 重试、报告非阻断及分析超时后的失败回写。
- `validate_repository.py` 与 `validate_experiment.py` 均无错误或告警；来源解析成功，`test_source_contract.py` 20 项通过。
- TypeScript 已使用锁定 DSH 镜像中的编译器重新生成 MJS，相关 MJS 语法检查通过。

这些检查证明源码合同和局部适配成立，不代表真实威胁研判闭环已经完成。

## 实例装载与真实分组观察

- 使用标准镜像 `ai-agent-harness/dsh:21638c563-54f335ef05ac` 替换启动 `security-operations-expert-exp020-web`，端口保持 `3097`，实例 HOME 卷保留。
- 启动环境只增加 `THREAT_ANALYSIS_MCP_TOKEN`；SOC 与报告上游地址、上游凭据和分组成员仍由网页 MCP 配置维护。
- 重启后有效配置仍包含 11 个服务器；`threat-analysis-runtime` 包含 7 个成员、10 个 Tool、1 个 Resource 和 9 个 Resource Template，共享 Token 已配置。
- 通过真实分组端点发现到 10/1/9 项能力；报告保存工具与 pending 工具均存在。装载收尾代码后，运行级桥的手工模式 18 项必需 SOC 映射预检和 pending 单项预检均通过。
- 初次真实 pending 和手工研判分别暴露了上游鉴权与接口授权问题；网页修正 `X-API-Key` 并由 SOC 侧补齐权限后，401/403 阻断已解除。这些问题属于实例网页配置和外部 SOC 权限，不是 Candidate 中保存的连接地址或凭据。
- 自动研判 `INC-20260918-000006` 后续完成 `run-8d0a74cb-bca1-4662-9980-f8eccb5204f1`：Qwen 模型被调用，29 次 MCP 调用无失败，SOC 结果与报告均保存成功。高调用量事件 `INC-20260907-000001` 也有多次完成记录；例如 `run-2f2a6010-1881-4640-ab7f-36e1f1080eb4` 完成 519 次 MCP 调用且无失败，SOC 结果与报告均保存成功。
- 这些运行证明“网页配置 → 分组 MCP → 运行级桥 → 固定取证与模型 → SOC 回写和报告保存”的真实链路已经可达，也证明持续 Schedule 能继续选择后续事件；它们是实例运行观察，尚未封存为独立 Research Run，不能据此判断研判结论的业务准确率或全部既有能力无回归。

## HTTP 状态保留

OpenAPI Tool 适配器过去只返回 `isError` 和响应正文，会丢失 `Response.status`；非空正文中又不保证出现 `409`，下游无法稳定区分认领冲突与其他失败。本轮在 MCP 标准 `_meta["io.deepseek.dsh/openapi-response"].status` 中保留真实状态，运行级桥优先读取该字段。测试已覆盖正文不含状态码而 `_meta.status=409` 的场景，自动研判可据此进入 `skipped_locked`。

## 失败观察与当前限制

- `INC-20260907-000001` 的 `run-6afa165c-8a06-4908-8c7a-933bb8ad19f1` 完成 520 次 MCP 调用且无失败，但 Qwen 推理达到模型桥 300 秒截止后返回 `model_failed`；SOC 失败状态回写成功。同一事件随后能够完成，说明这不是固定 MCP 配置错误，但当前桥会把内部模型异常统一转换为 HTTP 502，仍缺少可定位的脱敏错误信息。
- `INC-20260918-000006` 曾在创建 Run 前返回一次 `execution_failed`，仅记录 `ProtocolError`；下一次心跳成功完成上述 `run-8d0a...`。现有证据把范围缩小到分组 Resource/Resource Template 能力发现阶段的瞬时协议错误，但日志没有保留具体方法和上游错误，不能进一步确认根因。
- 真实运行已覆盖高调用量 `search_event` 路径，但尚未用受控边界样例系统验证 OpenAPI 适配器单次 20 秒和 1 MiB 限制，也未完成结构化材料、巡检和只读故障取证的正式回归。
- 当前实例运行记录证明技术闭环可达，不代替带业务真值的威胁研判准确率评估；Experiment 保持 `active`，不形成 Decision。

## 能力继承补齐（2026-10-15）

EXP020 的 `baseline_ref` 为 `git:0ae67c84`，该提交早于 `b44d871e`（统一 DSH 应用 URL 并保留代理前缀）。因此 EXP019 Candidate 已有的应用基址修复没有进入 EXP020，概览、MCP 管理和语音三类浏览器请求在门户 `/agent/` 入口下会绕过代理前缀并落到门户后端。本轮按“同步缺失能力”处理，不改变 EXP020 原有的威胁研判 MCP 分组、策略与应急实现。

- 从 `EXP-security-operations-expert-019-rc442472a242a` 移植的能力：`security-operations-ui` 概览请求、`mcp-manager` 三处调用与分组链接、`dsh-voice-hub` 的 `client.tsx`/`asr.ts`/`settings-form.tsx`/`service-settings.tsx` 全部 `location.origin` 拼接，以及对应三种前缀回归用例。`security-operations-ui/src`、`mcp-manager/src`、`dsh-voice-hub/src` 的四个语音文件与来源修复版逐字节一致。
- 由 232 部署目录回流的能力（此前只存在于部署副本，仓库内没有）：`security-operations-guard.mjs` 把 `ctx.tools.restrict` 的 scoped 工具异常降级为告警，避免中断整个 turn；`policy-configuration` Skill 增加 `body` 顶层形状、自检三条、禁止自行解析资产与意图判定四段合同。回流后部署目录与仓库 Candidate 202 个文件逐字节一致。
- 守卫补齐：`security-operations-ui/test-ui.mjs` 与 `dsh-voice-hub/test/wake-flow.test.mjs` 恢复 `/`、`/assistant/`、`/portal/apps/assistant/` 三种前缀断言，`platform/plugin/test/bundle.test.mjs` 的 MCP 前缀用例扩展到 EXP020，使同类丢失能在仓库内直接失败。
- 制品的实际来源：`security-operations-ui/client.js` 由锁定 esbuild 从修改后的 `client.tsx` 重建，并与已提交产物在反向替换后逐字节一致；`mcp-manager/client.js` 由该包的 `build.mjs` 重新生成；`dsh-voice-hub/lib/client.js` 用同一 esbuild 配置与相同 `__BUILD_TAG__` 重建，重建结果与已提交产物的差异仅为本次 URL 改写（25 增 20 删），未引入其他代码变化。`security-operations-ui` 的 `tsc --noEmit` 因本仓未安装 `@types/react` 未能执行，构建由 esbuild 完成且产物已通过行为断言。
- 入口与装载验证：232 的 `security-operations-expert-exp020-lan` 实例（`ai-agent-harness/dsh:21638c563-54f335ef05ac`，宿主网络，18120）在同步后重启；容器内 `/opt/dsh-managed` 三个客户端产物哈希与本机测试所用文件一致；`http://127.0.0.1:18120/` 与 `https://172.16.138.232:18060/agent/` 均返回 200，`/agent/api/security-operations/overview` 返回 200，直连 `http://127.0.0.1:18120/api/security-operations/overview` 返回 200 且四个角色为 `idle`。
- 未验证：本轮没有浏览器可用，未在真实浏览器中复验门户 iframe 的概览渲染、MCP 分组链接与语音上传路径；三种前缀的请求地址由对实例实际加载产物的确定性断言覆盖，不代替浏览器行为验收。重启后实例 HTTP 服务约需 90 秒才可用，本轮未定位该启动等待的成因。
- 既有失败保持原样，未由本次改动引入：`tests/mcp-scope-guard.test.mjs` 2 项、`tests/threat-analysis-automation.test.mjs` 1 项失败，`tests/mcp-resources.test.mjs` 依赖容器内 `/opt/dsh-managed` 路径无法在宿主运行；三者在本次改动前的同一提交上结果完全相同。
- `web-profile.seed.patch.yml` 仍把策略与应急 `specUrl` 指向 `172.16.138.232:58320`，而该端口当前只监听 `127.0.0.1`；本实例的其他路由不受影响，该上游地址是否需调整留给部署侧确认。

## MCP 分组恢复（2026-10-15）

232 实例 `security-operations-expert-exp020-lan` 的 `threat-analysis-runtime` 分组在部署前被清空为 `members: []`（生效配置 `/var/lib/dsh/profiles/web/cordis.patch.yml` 中 7 个成员服务器的定义仍在，仅分组选择为空）。按原表恢复为 7 个成员：`ai-soc-correlate`、`ai-soc-event`、`ai-soc-graph`、`report-write`、`ai-soc-detect`、`ai-soc-ingest`、`ai-soc-master`。

- 恢复结果与配置选择逐项一致：10 个工具、1 个资源、9 个资源模板；分组端点为 `http://172.16.138.232:18120/mcp/groups/threat-analysis-runtime`（宿主网络监听 `18120`，共享 Token 未变更）。
- 两项容易被误配的匹配规则：分组成员 `names` 必须保存**原始工具名**（服务端 `toolsFor` 用原始名与发现结果比对，界面展示的 `mcp__<服务器>__<工具>` 是暴露时加前缀），写成带前缀的名字会导致 `tools/list` 返回 0；`resourceUris` 与 `resourceTemplates` 必须与上游发现结果逐字一致（本次发现使用的是宿主地址 `172.16.138.232`，写成清单里的 `172.16.138.223` 会导致两类列举返回 0）。
- 该分组由实例 HOME 卷中的运行配置持久化，`web-profile.seed.patch.yml` 只提供首次 seed，未写回该文件；实例下轮重建时分组仍以 HOME 卷为准。
- 本轮未执行 `tools/call` 与 `resources/read`，只核验了 `initialize` 与三类列举；分组内工具的实际上游行为仍由威胁研判链路的既有观察覆盖。
- 观察到的启动行为：容器重启后 HTTP 服务有时数秒内可用，有时需约 90–100 秒；期间 TCP 可连接但无响应，`/api/mcp-manager` 与 `/mcp/groups/*` 一度返回空结果或超时。本轮未定位该启动等待的成因，也不把它归因为 Candidate 变更。
