# 研究假设

在不修改 DSH Runtime 的前提下，一个随 Candidate 装载的双端插件即可复用 Web 原生会话侧栏、输入区和右侧栏扩展点，形成接近 AI-SOC 参考图的三栏布局。快捷任务只写入草稿，不自动提交；右栏只呈现当前 Session 的真实状态。

Candidate 继承 EXP-security-operations-expert-006，仅新增 `security-operations-ui` 插件并通过现有 Profile patch 装载。

## 预期观察

- 左侧仍为 DSH 原生会话历史，中间保留原生输入并显示六个安全运营快捷任务，右侧自动打开“系统消息”。
- 点击快捷任务只填充原生输入框，不发起请求。
- 页面刷新后插件仍由 EXP-007 Candidate 装载，其他 Experiment 与 DSH Runtime 源码不变。
- 小屏下任务卡片降为两列或一列，键盘可以聚焦并触发每张卡片。

## 停止条件

- 插件必须改写 DSH Runtime 才能工作；
- 快捷任务绕过原生输入流程自动发送；
- 插件破坏原生会话历史、模型选择、附件或发送能力。
