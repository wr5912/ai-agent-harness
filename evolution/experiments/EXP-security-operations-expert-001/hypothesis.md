# 迁移假设

将旧 Runtime 中可复用的业务指令、25 个 Skill、四个角色契约和两个响应规划 Schema 重写为 DSH 原生 Workspace、Preset、MCP、toolFilter 与 monotonic guard，可以在不继承旧 Hook 和宽松权限配置的前提下保留安全运营能力语义。

本次存在会改变实施路线的关键不确定性：当前 DSH 是快速演进的开发预览版本，Preset、全局 MCP 工具、子 Agent 工具衰减、workspace watcher 和容器只读挂载必须以锁定提交进行真实装载验证。因此采用 `exploration` 路径，先完成静态契约和 8 条确定性技术场景，再决定是否进入业务 AC 复核和候选基线冻结。

探索停止条件为：来源身份无法闭合、DSH 锁定提交无法构建、Profile 无法 fail-closed、角色工具集合无法单调衰减、响应规划无法保持零工具、Candidate 写边界越出 workspace，或只读验证快照仍可修改。命中任一条件即停止晋升，不通过放宽权限绕过。

旧交付的 200 条输入不是探索样本，也不是正式 Eval Set；它们在业务逐条复核和 AC 绑定前仅作为 pending 迁移材料。

