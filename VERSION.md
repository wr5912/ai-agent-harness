# 仓库治理版本

当前版本：`0.6.0`

该版本标识仓库协作规则、研究资产语义和本地工具合同，不是 Agent/Harness Research Release，也不表示已经创建同名 Git Tag。

本版本在 Research Mode 中落实按职责划分的单一事实源。`security-operations-expert` 的需求与任务维护在 `definition.md`，测试数据、评估方法、测试验收和 Experiment 选择维护在 `evaluation.md`；Experiment 不保存本地评测计划，Run 自动锁定当次摘要和选择。DSH 适配层仍使用一个 `/work/reference` 只读挂载承载这两份资料。

项目技能收敛为 `legacy-asset-intake`、`harness-evolution`、`research-eval` 和 `ai-correction-log`。Run 使用轻量观察合同。当前仍没有 Research Release，`release:<id>` 解析与装载尚未实现；DSH Web 完整交互和新 Preset Web 选择仍分别是 `PA-08`、`PA-09` 的缺口。
