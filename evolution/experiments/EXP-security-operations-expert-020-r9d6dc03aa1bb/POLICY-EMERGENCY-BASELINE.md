# 策略最新算法与应急指令 · 产品基线（不含 MCP 迁移）

本实验 `EXP-security-operations-expert-020-r9d6dc03aa1bb` 在本分支被用作**策略与应急指令的产品基线**：
在其既有能力（inspection / threat-analysis / UI / 语音）之上，合入 228 已验证的**策略最新算法**与**应急指令**实现。

## 来源

| 项 | 值 |
|---|---|
| 策略/指令来源 | A 线 `EXP-security-operations-expert-024-r31e1bc1fac7e`，Harness 提交 `bf78e452dc2892926fc39070f58ddda0173434cf` |
| 合入基线 | 本实验（远端 `main` @ `2938745`） |
| 范围声明 | **不含 MCP 会话迁移**（`policy-mcp-migration-isolation` 的会话/直连改造不在本次范围内） |

## 新增文件

| 文件 | 作用 |
|---|---|
| `managed/policy-selection-runtime.mjs` / `.ts` | 源/目的/执行设备多候选统一走 DSH 原生单选；选中后自动接续冻结请求；取消/漂移不接续 |
| `managed/operation-result-delivery.mjs` | 策略/应急的固定结果与原草稿在同一助手消息中交付，禁止模型二次扩写权威结果 |
| `managed/native-operation-question.mjs` | 原生提问桥（受控问题规格校验） |

## 更新文件

| 文件 | 变更要点 |
|---|---|
| `managed/policy-configuration-guard.mjs` | 加入端点解析/消歧路由与每轮初始化一致性 |
| `managed/policy-confirmation-runtime.mjs` | 受信签名确认链、结果版本一致性 |
| `managed/emergency-confirmation-runtime.mjs` | 应急原生确认与配对恢复语义 |
| `managed/security-operations-guard.mjs` | 策略路由新增 `resolve_policy_endpoints` / `choose_ambiguous_policy_endpoints`，并按轮次跟踪已装载 Skill |
| `managed/role-tool-matrix.yaml` | 角色矩阵加入上述两个端点解析工具 |
| `presets/security-operations-expert/agent.cordis.yml` | 装载 `policy-selection-runtime` 与 `operation-result-delivery` |
| `managed/web-profile.seed.patch.yml` | `policy-configuration` / `emergency-action` 由「50500 旧分组 + `enabled: false`」改为「从 AI Platform OpenAPI 发现 + `enabled: true`」 |
| `workspace/.agents/skills/policy-configuration/SKILL.md` | `operation=ADD` 与 `action=ALLOW\|DENY` 分离、CIDR 范围、中文过程说明与能力边界 |
| `workspace/.agents/skills/emergency-action/SKILL.md` | 处置目标与攻击来源的区分、参数填写、原生确认链 |

## 保留的上游独有内容（未修改）

`sec-ops` 工具白名单（16 个 graph/asset 工具）、`inspection`、threat-analysis 全套、`resources` / `schedule` / `threatAutomation` 路由组、`local-qwen` 模型配置、`threat-analysis/catalog`。

## 部署到 232 时需要改的一处

`managed/web-profile.seed.patch.yml` 中两个 `specUrl` 现按 232 规划指向：

```
http://172.16.138.232:58320/api/v1/policy-configurations/openapi.json
http://172.16.138.232:58320/api/v1/emergency-actions/openapi.json
```

232 上策略 Platform 实际监听的端口若不是 `58320`，替换该端口即可，其余无需修改。

## 校验记录

- 插件引用闭合：`agent.cordis.yml` 引用的 5 个 `/opt/dsh-managed/*.mjs` 均存在
- 相对 import 闭合：全部 `from './x.mjs'` 目标存在
- `node --check`：全部 `.mjs` 通过
- YAML 解析：`web-profile.seed.patch.yml`、`role-tool-matrix.yaml`、`control-boundary.yaml`、`agent.cordis.yml` 通过
- 未删除任何上游文件（`git diff --name-status origin/main` 仅 `M` 与新增）
