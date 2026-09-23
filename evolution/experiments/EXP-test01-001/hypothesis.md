# 研究假设

Baseline 为 `none:first-experiment`。若最小 Candidate 声明 `test01` Preset，并由来源合同装载到 DSH Web Profile，则全新 Session 对身份问题的回复会明确包含 `test01`。

## 预期观察

- 来源合同、Candidate 资产与运行锁可通过静态校验。
- 全新 dev 实例可选择 `test01` Preset。
- 全新 Session 的回复满足 `AC-001`。

## 停止条件

- 来源或 Candidate 不能被 DSH 装载。
- Web 中无法选择目标 Preset 或真实消息失败。
- 验证需要把凭据值写入仓库或研究记录。

## 限制

本实验只验证一个身份输入，不外推到工具能力、复杂任务质量或生产可用性。
