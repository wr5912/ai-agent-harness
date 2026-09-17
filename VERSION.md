# 仓库治理版本

当前版本：`0.2.0`

该版本标识本仓库的目录语义、协作规则和演进工具契约，不是 Agent/Harness Release，也不表示已经创建同名 Git Tag。

本版本主要变化：验收与 Case 事实源迁至 Agent 级 `spec/`、`eval/`，Trial 事实按 `runs/<run-uuid>/` 独立归档；新增 `experiment:`/`snapshot:` 来源选择器、三角色挂载计划、完整研究快照与 Run 台账工具；`dsh-dev` 容器启动器与逐例评测执行器仍未实施。

当前状态：仓库治理版本已升级；未发布的 `security-operations-expert` 迁移仅为 Experiment Candidate，交付结论“退回整改”，尚无可部署 Agent/Harness Release。
