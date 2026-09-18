# 仓库治理版本

当前版本：`0.3.0`

该版本标识本仓库的目录语义、协作规则和演进工具契约，不是 Agent/Harness Release，也不表示已经创建同名 Git Tag。

本版本主要变化：根级协作规则新增"开发对象与修改边界"和"文档与数据质量"两章，把四类对象、本地研究纪律与数据语义要求写进唯一入口；来源选择器收敛为 `experiment:<id>`，整套源码研究快照退役并改为按恢复映射从 Git 取回；判分材料不再进入被测容器；`dsh-dev` 停止误报成功并由来源声明决定目标 preset。逐例评测执行器仍未实施。

当前状态：仓库治理版本已升级；未发布的 `security-operations-expert` 迁移仅为 Experiment Candidate，交付结论"退回整改"，尚无可部署 Agent/Harness Release。
