# EXP-012 Evaluation 观察

本实验以 `U-INS-001` 验证真实常规巡检，以 `U-INS-002`（只查询能力）和 `U-INS-007`（同一运行续查）检查直接相关的旧能力。完整输入和预期只维护在[评测定义](../../../../agents/security-operations-expert/evaluation.md)；下列 Run 保存当时锁定的副本及原始回答、工具调用和服务回执。

## 对照条件与观察

| 路径 | Run 与提交 | 三个 Case 的机器结果 | 原始记录复核 |
| --- | --- | --- | --- |
| 旧 Candidate，原生 `dsh-eval` | [旧版 Run](../runs/run-2e7e9988-bdba-4ff9-a6ca-091924d1151f/report.md)，`18b816a8`，dirty=false | 0/3 | 巡检工具未注册，旧工具名调用返回 `UNKNOWN_TOOL`；三个业务目标均未完成。 |
| 新 Candidate，`research-tool run` | [新版 Run](../runs/run-204006db-50d8-44c1-b3d8-55e77c255337/report.md)，`59058117`，dirty=false | 3/3 | 三项原始工具调用符合预期；`U-INS-007` 第二轮再次 `finalize` 同一 `runId`。 |
| 同一新 Candidate，原生 `dsh-eval` 复跑 | [复跑 Run](../runs/run-7e7fbbe1-2fd4-4579-9f84-b9f6624fb93d/report.md)，`e68b742e`，dirty=false | 3/3 | 逐项重查回答和回执，仍满足上述行为。 |

三次 Run 均选择相同的 `U-INS-001/002/007` 输入和预期，`evaluation_sha256=263c602b4ffbc0ee104f83011d829a7cc435f028ddad5aae054aedf785c13c67`；执行通道为 DSH Runtime API，模型请求为 `deepseek-official/deepseek-flash`，实际模型为 `deepseek-flash`，镜像构建指纹为 `sha256:206544f65a154957fccf878ec3f62dea8737f29ebccf7cff67de95d2d095be71`，Image ID 为 `sha256:ffe5f28e2e077065818814183960b250915c91bfd57b468e5e304d706c4e4ee6`。两次新版 Run 的 Candidate、来源、Case、依赖变量在锁定记录中一致；三次均无未提交修改。巡检 MCP 在新版两次 Run 中实际注册并成功返回，所需环境变量在锁定记录中标为存在；原始服务状态可能随时间变化，不能将差异全部归因于 Harness，也不计算“提升百分比”。

旧版的角色工具矩阵、Guard、Skill 和主 Agent 仍采用三工具名称，实际 Session 没有注册巡检工具。新版把这些直接消费方统一到服务现行四工具合同；[新版 Run](../runs/run-204006db-50d8-44c1-b3d8-55e77c255337/report.md)和[复跑 Run](../runs/run-7e7fbbe1-2fd4-4579-9f84-b9f6624fb93d/report.md)的 Session 都注册了四项巡检工具。`U-INS-001` 依次成功 `start_with_plan`、`collect_evidence`、`finalize`，并在回答中保留服务返回的完整报告和设备数量；`U-INS-002` 只调用 `inspection_capabilities_list`，列出服务返回的三项能力而没有创建运行；`U-INS-007` 第二轮复用首轮 `runId` 再次 `finalize`，两次报告摘要相同，第二轮回答包含服务报告。各 Case 的原始回执位于相应 Run 的 `evidence/U-INS-.../tools.jsonl`，回答位于 `response.json`。

能力来源是本 Experiment 的 `candidate/`：业务路由与 `security-inspection` Skill、角色工具矩阵和 Guard 选择四项工具；Candidate 的 Profile 补丁把 `security-operations-mcp-inspection` 配置为锁定 DSH Runtime（`@deepseek-ai/dsh` `0.1.7-rc.2`）中的 `@deepseek-ai/dsh-mcp-client`，依赖 `INSPECTION_MCP_URL` 与 `INSPECTION_MCP_TOKEN`。`mcp-servers.yaml` 说明服务名与前缀，`inputs.lock.json` 保存 Candidate 摘要、Runtime 和依赖存在性，Run 的工具列表与成功回执证明本次实际可用。适用范围仅为所选常规巡检、能力查询和续查，不包括周期任务创建或其他 MCP 业务能力。

另有[反例 Run](../runs/run-cc114ffc-dc56-4029-864b-59b367646d4c/report.md)：机器把 `U-INS-007` 判为通过，但第二轮只再次调用 `collect_evidence` 并复述旧报告，没有重新读取已完成报告。修订 Skill 后的两次 Run 才在第二轮成功 `finalize`。因此机器 3/3 只是线索，以上结论依赖本轮 AI 对原始 Session 的逐条复核；评审模型与被测模型同路由，评审结果不等于独立人工验收。

## 工具流程与实例核对

[流程测量原件](evidence/research-tool-workflow-20261008.json)在同一新 Candidate 上记录：原流程定位来源、Run 和实例需要 `source_contract`、`run_record index/show`、`dsh-dev ps` 共 4 条外部命令，20.782 秒；`research-tool context --source ... --run ...` 为 1 条，20.460 秒。运行本身两边均为 1 条命令；原生复跑从 Run 创建到封存为 132 秒，新入口 Run 为 117 秒。这是两次模型与服务执行的观察值，不能证明工具缩短运行时间。两边选错来源次数均为 0，仍各需人工核对 3 个 Case 的回答和工具轨迹；先前机器误判说明这一步不能省。工具将状态、工具调用与证据位置放进一次输出，减少资料定位命令数，但尚未证明重复、稳定的总工时或错误率收益，因此不扩展到第二个智能体。

[实例操作原件](evidence/research-tool-instance-20261008.json)记录了 `p1-inspection-probe` 的真实重启：新旧容器 ID 不同，前后运行状态、目标 Preset、标准镜像和三棵 Candidate 只读挂载均匹配；错误实例名返回退出码 2 和明确原因。这说明现有 DSH Profile、插件和 `dsh-dev` 已能支持本次最小状态查询与操作，不需要修改 DSH 框架。没有开放运行状态页或 MCP 管理页，第 35 项针对页面投入使用前的真实验收本轮不适用；这次 CLI 与 API 验证不能替代浏览器页面验收。

本轮未测试其他四个巡检 Case、浏览器页面、资源消耗或生产运行；真实业务采纳仍待研究者亲自复核原始记录。
