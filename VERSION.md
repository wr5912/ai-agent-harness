# 仓库治理版本

当前版本：`0.4.0`

该版本标识本仓库的目录语义、协作规则和演进工具契约，不是 Agent/Harness Release，也不表示已经创建同名 Git Tag。

本版本主要变化：启动器把"本次会话身份"（`session_preset`）与"待优化/待评估目标"（`target_preset`）拆成两个字段，并在计划、实例记录与输出中一致使用；实例状态 schema 升到 `1.3`，旧实例可以停止、查询和迁移，新增 `up --replace` 作为真实重载入口；来源声明、候选声明与受控 patch 的生效默认 preset 由门禁强制一致；阅读视图工具拒绝写回输入并正确处理 Markdown 特殊字符；`requirements.md` 改为索引表加条目段落。逐例评测执行器与真实开发会话验证仍未完成。

当前状态：仓库治理版本已升级；未发布的 `security-operations-expert` 迁移仅为 Experiment Candidate，交付结论"退回整改"，尚无可部署 Agent/Harness Release。
