# 平台个人工作台示例验收

本 Experiment 由平台“新建智能体”向导于 2026-10-16 创建，用于验证真实角色、用例维护与再次评测链。Baseline 为 `none:first-experiment`，不继承安全专家业务 Harness。角色正文唯一维护于 Candidate 工作区的 `AGENTS.md`。

首次通过页面新增 `U-SUMMARY-001`，使用用户给定的基础模拟资产状态。[首轮 Run](../runs/run-d8867c0c-4717-4f65-b61a-f88976cbab31/report.md)完成身份与摘要两个 fast Case，2/2 通过。随后通过 Run 的逐例结果创建 `U-SUMMARY-002` 草稿，确认只复制冻结输入、预期为空；独立补充表格输出预期后保存。[第二轮 Run](../runs/run-c067d20b-0a4c-48cb-a78d-5a6e03e6172a/report.md) fast 3/3 通过。实际回答保留资产、状态、给定时间及数据来源，并明确未查询外部服务。

两轮使用标准 Runtime 镜像及 `deepseek-official/deepseek-flash/off`，独立评测实例结束后自动停止，未操作现有业务实例。实际模型与工具记录保存在各 Run；语义结果为同一路由自评，未请求额外 AI 证据复核，不能据此声称人员采纳或泛化收益。

页面对照两个共同 Case 的冻结口径相同，新 Case 仅第二轮执行；用例集合不同、工作树 dirty、预期模型字段未显式指定均保留为比较限制，`causal_comparable=false`。平台保存 [Decision continue](../decision.md)，保留示例用于后续个人工作台使用。`U-ROLE-001` 未选入 fast，本轮不计为通过；未验证真实业务服务或模型训练。

平台任务及浏览器证据入口见[本轮实施说明](../../../../docs/platform-design/13_个人工作台与决策样本实施.md)。原始封存 Run 保持不变。
