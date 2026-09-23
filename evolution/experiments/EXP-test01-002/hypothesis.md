# 研究假设

Baseline 为 `git:70e805025a3bc90ec796597664fc3b2f53eea3bc`。若 dev 实例只开放 Web Profile 的 manifest 与本地包目录，并在镜像中提供锁定的 `dsh` 和 `pnpm` 命令，则 `dsh-codex-connect@0.1.0-alpha.4.39` 可以通过 DSH 原生命令安装，并在保留 HOME 的宿主重启后继续被 Profile 装载。

## 预期观察

- 插件 manifest 与 lockfile 记录锁定版本和完整性摘要。
- 重启前后组合配置各包含且仅包含一个 `llm-openai-codex` provider。
- `test01` 的受控 Preset 根和默认目标不变，verification 模式仍保持无私有插件的锁定边界。

## 停止条件

- 安装要求改写受控 Patch、全局指令、环境文件或镜像安装树。
- Profile manifest 失去官方基础 bundle，或插件无法在宿主重启后恢复。
- 验证要求把 OAuth、API Key 或认证 URL 写入仓库或研究记录。

## 限制

本实验只验证插件安装、配置装载与重启持久化；不执行 ChatGPT OAuth，不发起真实 Codex 模型请求，也不外推到生产可用性。
