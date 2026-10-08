# 巡检执行路径归因

本文件是对历史 Run 的只读分析，不是当前 Case 口径。业务输入和预期只以 [`evaluation.md`](../../../../agents/security-operations-expert/evaluation.md) 为准。历史 EXP-008 巡检 Run 曾使用未纳入锁定镜像的 MCP 客户端覆盖层，故只能提供工具协议与路径线索，不能作为本次同条件效果基线。

| 节点 | 历史轨迹依据 | 固化判断 |
|---|---|---|
| 识别目录查询与一次巡检 | [U-INS-002 工具轨迹](../../EXP-security-operations-expert-008/runs/run-bcdc9957-c531-4554-a4e7-79bd3f8c6404/evidence/U-INS-002/tools.jsonl)、[U-INS-001 工具轨迹](../../EXP-security-operations-expert-008/runs/run-a739c37c-d72b-425f-9a65-ff064616c580/evidence/U-INS-001/tools.jsonl) | 仅明确问法进入代码路径；其余请求保留原模型路由。 |
| 从目录选择任务 | 同上目录回执包含 `taskId`、`definitionVersion`、`matchPhrases` 和 `defaultForChat` | 只选唯一匹配且无必填额外输入的本轮模板；不固化模板 ID。 |
| 发起一次运行 | [U-INS-006 工具轨迹](../../EXP-security-operations-expert-008/runs/run-bcdc9957-c531-4554-a4e7-79bd3f8c6404/evidence/U-INS-006/tools.jsonl) | 指定资产带本轮资产 ID；常规巡检省略 `scope`；从 Session 和 Turn 派生稳定 `requestId`，回执不明时停止。 |
| 查询与续查 | [U-INS-007 工具轨迹](../../EXP-security-operations-expert-008/runs/run-bcdc9957-c531-4554-a4e7-79bd3f8c6404/evidence/U-INS-007/tools.jsonl) | 只从实际发起回执取 `runId`；同 Session 下一轮复用它，不再次发起。 |
| 组织报告 | [U-INS-001 工具轨迹](../../EXP-security-operations-expert-008/runs/run-a739c37c-d72b-425f-9a65-ff064616c580/evidence/U-INS-001/tools.jsonl) | 按状态、设备数量、结论、摘要和报告正文复述；`PARTIAL` 明示缺口，报告未就绪时不给下载地址。 |

因此，本轮 TypeScript 插件只是上述可判定路径的**手工固化实现**。`U-INS-003` 的开放式研判仍需模型；`U-INS-005` 缺少创建接口，不能用现有工具伪装完成。本轮实际运行及未取得的业务证据见 [Evaluation 观察](observations.md)；同条件 Baseline、有效巡检工具回执和资源采样缺失，无法判断业务等效或算力收益。

专项分析能力可借鉴 `scenario-analysis` 的独立只读 Session、证据引用、替代解释和证伪方法。若后续跨多个任务确有重复需求，再把“封存 Run → 节点归因 → 可固化判定 → 人工审查方案”做成独立 Preset；代码生成仍由开发流程负责，运行效果仍由新的 DSH Session 和 Run 验证。
