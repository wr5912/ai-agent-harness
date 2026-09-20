# 仓库治理版本

当前版本：`0.4.1`

该版本标识本仓库的目录语义、协作规则和演进工具契约，不是 Agent/Harness Release，也不表示已经创建同名 Git Tag。

本版本主要变化：`up --replace` 在停旧实例前核对来源、模式、端口并预检新 Compose；独立 `verify-load.sh authoring` 复用来源合同生成本次目标声明，核对 `/work/AGENTS.local.md` 的只读挂载、摘要和目标字段；业务 Agent ID 与运行时 preset ID 改为显式映射，不再要求字符串相等，默认用稳定 ID 回流；阅读视图拒绝指向未来 JSONL 输入的悬空软链；项目验收矩阵与证据范围同步更新。

当前状态：Headless 下的 Skill 修改小闭环和模拟 MCP 工具链已有真实模型记录；Web 工作区注册与 preset 的创建、回流、显式选择仍是 `PA-08`/`PA-09` 的未完成路径。未发布的 `security-operations-expert` 仍只是 Experiment Candidate，交付结论"退回整改"，尚无可部署 Agent/Harness Release。
