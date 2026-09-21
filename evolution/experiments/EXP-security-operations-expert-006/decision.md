# 研究决定：adopt

采用来源声明驱动的运行时环境变量透传，并在当前 Harness 中使用 DSH 原生 `llm-pi-ai` 注册本地 Qwen 路由。同一 DSH 实例保留 DeepSeek 默认模型，同时可在 Web 模型选择器中切换到 `Qwen3.8-27B`，不需要新增模型管理组件或修改 DSH Runtime。

Run `run-fe9c0374-41b5-4cb4-bd0d-8379c3678ce8` 的 6 项试验全部完成。Playwright 验证模型选择器同时列出 DeepSeek 与 Local Qwen；Qwen 对最小连通性消息返回预期结果，Session 的 `model/selection`、`request/header` 和 `assistant/message` 均记录 `local-qwen/Qwen3.8-27B`；切回 DeepSeek 后原默认路由正常。启动器、来源合同、仓库合同和 Guard 回归均通过。

结论限于多模型装载、选择、调用和轨迹归属。Qwen 在安全巡检等业务任务上的质量尚未比较，不构成 Research Release 或生产部署验收。
