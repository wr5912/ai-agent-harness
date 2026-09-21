# 研究假设

在通用启动器按来源声明透传运行时环境变量后，Harness 只需使用 DSH 原生 `llm-pi-ai` 配置一个 OpenAI Chat Completions 路由，即可让同一容器实例同时保留 DeepSeek 默认模型并提供本地 Qwen 模型选择，无需新增模型管理组件或改写 DSH Runtime。

Candidate 继承 EXP-security-operations-expert-005 已采用的业务 Harness，只增加 `local-qwen/Qwen3.8-27B` 模型路由；模型地址和凭据仅以环境变量名进入资产。

## 预期观察

- 两份通用 Compose 模板不包含任何业务环境变量名，实例生成结果按所选 source 的 `required_env_names` 精确透传。
- 全新 eval 实例仍以现有 DeepSeek 模型为默认值，模型选择器同时显示 `Qwen3.8-27B`。
- 切换到 `local-qwen/Qwen3.8-27B` 后，真实 Web 消息成功返回，执行轨迹记录所选 provider 与 model。
- 仓库和 Run 证据不保存 API Key、Token、认证 URL 或模型服务凭据值。

## 停止条件

- 新路由覆盖或破坏现有 DeepSeek 默认路由；
- 模型仅在静态配置中存在，但无法通过全新 Web Session 发起真实请求；
- 验证需要改写 DSH Runtime 或把凭据值写入仓库。
