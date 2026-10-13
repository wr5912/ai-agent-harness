# 研究假设

以 `git:43210919dae956437347b5cf81a6f981bb5eba66` 中 EXP-014 的 Candidate 为 Baseline。现用 `18150/mcp/inspection` 在完整 MCP 握手后提供 `list_executable_inspections`、`start_inspection`、`get_inspection_result`，而 Baseline 的业务 Skill、Guard、角色矩阵和 Case 仍期待旧四工具合同。仅调整这些直接消费巡检工具的资产及评测口径，保留 EXP-014 的运行概览、MCP 管理和其他业务能力。

预期：新实例启用该服务后，新 Session 能看到三个巡检工具；`U-INS-002` 只查询目录；`U-INS-001` 从本轮目录选择常规模板，发起一次运行并按同一 `runId` 查询至报告就绪；`U-INS-007` 续查时不重复发起。用 `U-INS-004` 检查任务创建边界，并按需要检查 `U-INS-006` 的资产范围。业务输入和预期以 [`evaluation.md`](../../../agents/security-operations-expert/evaluation.md) 为唯一来源。

若新实例不能发现工具、不能得到同一 Session 的工具回执，或报告缺少评测要求的设备数量，则该假设不能判为成立。已有 EXP-008、EXP-012 在不同 Runtime 或服务状态下的 Run 仅作历史线索；本次结果不得外推为整个平台或其他业务能力已验收。
