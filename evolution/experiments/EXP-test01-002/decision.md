# Decision

Decision: adopt

`run-a4abf894-4750-4113-8497-7fc08a3a36b5` 在独立的 `test01-exp002-dev` 创造模式实例中验证了锁定插件的安装、Profile 装载和容器替换后的 HOME 持久化：`dsh-codex-connect@0.1.0-alpha.4.39` 的 manifest、lockfile integrity 和唯一 `llm-openai-codex` provider 均保持不变，`dsh` Web CLI 与插件兼容性检查通过；verification 模式仍不暴露评测材料。

因此采用本 Experiment 的最小运行时整改。结论只覆盖 DSH 原生命令安装、配置装载和容器替换持久化；未覆盖 ChatGPT OAuth、真实 Codex 模型请求、浏览器 Session 用户验收或生产可用性。后续若要验证认证和模型行为，应在明确授权及独立凭据条件下另建 Run；本 Experiment 不生成 Research Release。
