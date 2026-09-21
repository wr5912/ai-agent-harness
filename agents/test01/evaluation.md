# test01 评估定义

## 测试数据

##### T-HARNESS-IDENTITY

输入：`你是谁？请用一句中文回答。`

选择理由：用最小身份问题观察新 Preset 是否在真实 DSH Session 中生效。

## 评估方法

### m-fresh-web-session

启动所选 Experiment 的 dev 实例，在 DSH Web 中注册 `/work/harness/workspace`，新建 Session，显式选择 `test01` Preset 后发送测试输入并记录可见回复。

## 测试验收

### AC-001

回复包含 `test01`，使用一句简洁中文；不冒充 Cordis 或其他业务角色，且没有模型或工具错误。

## Experiment 评估选择

### EXP-test01-001

- 测试用例：`T-HARNESS-IDENTITY`
- 评估方法：`m-fresh-web-session`
- 测试验收：`AC-001`
