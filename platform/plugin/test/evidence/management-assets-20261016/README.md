# 管理助手业务资产验收 · 2026-10-16

本记录来自隔离的平台与数据工作区，覆盖管理助手从数据根装载业务规则、Skill，以及研究工具的实际使用。[摘要](summary.json)保留结果、摘要和运行编号；本文仅记录隔离验收，正式部署验证另附。

| 验证范围 | 实际结果 |
| --- | --- |
| 管理助手装载 | 通用管理、特性整理、算力变体、决策样本、任务构建五类只读模型任务完成；请求包含数据根规则、表达 Skill 和可信工作区上下文。实际路由为 `deepseek-flash/max`。 |
| 历史与缺失资产 | 旧会话继续对话，原 37 条事件摘要不变；移除表达 Skill 时保留历史读取并阻止新任务，提示所缺资产。验收后恢复 Skill。 |
| 研究工具闭环 | 经平台 RPC 固定父版并派生 Candidate，编辑假设、业务指令和观察，执行相同两项用例，再比较、保存 Decision 并回读。两份保存摘要一致，研究合同校验通过。 |
| 产物交付 | 真实 UI 报告与 Run ZIP 下载均为 HTTP 200；ZIP 含 39 个文件和两条业务轨迹，五台资产报告的摘要与工具导出一致，正文明确模拟范围。 |

研究对象是 `inspection-delivery-demo`，用例为完整分页交付和限第一页读取。首轮两侧的业务用例均通过，但 DSH 工具回执格式适配导致证据复核失败；修复后创建两个新 Run，两侧均为 2/2 通过且复核完成。首轮失败 Run 的 66 个文件摘要未变。回执驱动 10 项及下游证据校验 4 项回归通过，错误回执和读取覆盖校验仍生效。

Decision 为 `completed/inconclusive`：父版本来已经通过，本轮不证明改进收益。业务模型为 `deepseek-flash/off`，证据复核使用独立 Session、同一模型路由；外部数据是动态基础 Mock 台账，不代表真实设备检测。比较只能描述观察，不能推断因果收益。平台报告与 ZIP 已取回；业务实例原 CSV 链接未独立完成 HTTP 验收。四次研究 Run 合计 62 次模型调用、632,485 tokens，实际费用未知；临时评测实例均已清理。

| 截图 | 入口 |
| --- | --- |
| 评测报告 | [查看](research-candidate-report.png) |
| 逐例结果 | [查看](research-candidate-cases.png) |
| 管理助手用法咨询 | [查看](assistant-conversation.png) |
| 缺少业务 Skill 提示 | [查看](missing-business-assets.png) |

完整研究证据保存在本机 `/home/admin/.local/state/hep-management-assets-20261016-221733/acceptance/research-evidence.tar.gz`，校验摘要见 `summary.json`。程序仓库仅保存上述摘要和截图，不存放原始 Session、完整 Run 或凭据。
