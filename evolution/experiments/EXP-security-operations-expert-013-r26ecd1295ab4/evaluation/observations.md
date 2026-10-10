# 2026-10-09 验证记录

EXP-013 以 [EXP-011](../../EXP-security-operations-expert-011/) 的完整 Candidate 为起点，并入 [EXP-012](../../EXP-security-operations-expert-012/) 的巡检四工具合同，只在 `security-operations-ui` 插件内采集运行概览数据。实验 ID 采用 `NNN-r12hex`，供并行分支独立创建；既有纯编号实验未迁移。模型使用 `deepseek-flash`、推理强度 `off`。

| 验证范围 | 结果与依据 | 边界 |
| --- | --- | --- |
| 构建与工具链 | 标准 DSH 镜像构建成功，记录见 [镜像证据](evidence/dsh-image-build-20261009T082631Z-702198.json)；前端 `npm run build`、`npm test`，插件事件测试、Experiment/仓库校验及适配器测试通过。 | 只证明本地构建、静态合同与测试覆盖，不能代替真实 Session。 |
| 实际页面 | 隔离实例 `soe-exp013-probe` 的运行概览 API 返回主会话与三种子智能体卡片；浏览器中概览可见。真实委派完成并重启实例后，页面显示主会话 1、故障分析完成 1，详情可打开子会话；见[浏览器证据](evidence/overview-browser-after-20261009.json)。 | 四张卡片当前均为 `idle`，表示没有正在运行的会话；威胁研判、响应规划及失败状态尚未经过真实运行。 |
| 真实委派 | 新 Session `session-5a18afab-3bbc-4b73-89b8-b2185ca09137` 委派故障分析，插件 API 将 `delegate_fault_analysis` 记录为 `completed=1`，保留子 Session、起止时间和结束原因；见 [运行证据](evidence/overview-runtime-20261009.json)。 | 证明 DSH 事件到概览 API 的实际路径；未评价故障分析回答质量，也未实跑威胁研判、响应规划或失败路径。 |
| 巡检 Evaluation | [Run](../runs/run-4e9e6cc8-5544-4f17-bf0d-1c9c6a840318/report.md) 执行 `U-INS-002`，机器判定 `failed`。模型先加载 `security-inspection` Skill，却未调用巡检目录工具，而越界调用策略工具。其中 `prepare_policy_configuration` 返回 `accepted=true`，创建的 Operation 最终状态为 `failed`，未产生可确认 DRAFT，也未执行策略。 | 此 Run 使用修正 Guard 前的 Candidate；原始证据保留，不以随后代码修改改写结果。策略服务留有一次非预期 Operation 记录。 |
| 巡检服务合同 | 对当前 `INSPECTION_MCP_URL` 只读调用 MCP `initialize`、`tools/list`，实际仅返回 `list_executable_inspections`、`start_inspection`、`get_inspection_result`；见 [工具目录证据](evidence/inspection-tools-list-20261009.json)。EXP-012 已验证的四工具名称均未出现。 | 当前服务与 Candidate 合同不一致，不能把 EXP-012 在先前 Run 中通过的行为推定为本次运行可用。未取得可用四工具地址前，不再发起巡检模型请求。 |
| 越界防护修正 | Candidate Guard 现依据本轮加载的 Skill 锁定策略、应急或其他业务域；策略、应急工具要求先加载对应 Skill。新增测试覆盖巡检 Skill 后的跨域拒绝、下一轮策略路由及应急确认查询。 | 目前只通过插件单元测试；尚无修正后新实例/新 Session 的业务 Run。 |

本节验证结束时实例已停止，独立 DSH HOME 卷保留。当前可确认专用运行概览的主会话、故障子会话事件采集与浏览器展示可用；巡检融合在现用服务上未通过，整体 Decision 保持 `continue`。

## 2026-10-09 运行活动计数追加验证

针对 `PA-06/08`，运行概览现在按主智能体和三个子智能体分别显示近 24 小时的工具调用次数与 Skill 加载次数。工具调用按 DSH `tools/result` 的最终结果计数，成功与失败均计入；Skill 加载按成功的 `skill` 工具结果或用户显式调用后产生的 `skill-invocation` 事件计数。统计从本次采集启用后开始，旧事件不回补；持久记录仅保存会话 ID、时间与计数，不保存 Skill 内容或工具参数。

`npm run build`、`node test-overview.mjs`、`npm test` 通过。重启只读挂载当前 Candidate 的 `soe-exp013-probe` 后，实际概览 API 返回四个角色的 `toolCalls` 和 `skillLoads` 字段；认证浏览器页面渲染四张卡片及两个计数，当前均为 0。此验证覆盖插件装载、API 与零值展示；新增计数尚未经过真实工具调用或真实 Skill 加载的非零端到端验证，不能据此评价业务效果。
