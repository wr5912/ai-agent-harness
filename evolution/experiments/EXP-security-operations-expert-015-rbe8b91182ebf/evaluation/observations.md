# EXP-015 自动研判实验观察

2026-10-11。Candidate 以 `git:7fa05adb3bbcaf01729bfb53e49726403017eed9` 中的 `EXP-security-operations-expert-015-r904bdcd81005` 为底座，迁移自动研判语义及其直接依赖的 409 错误传递、Qwen JSON 围栏解析和分析超时失败回写修复。EXP-015 的 MCP Manager、Web UI、语音插件、业务 Guard 和程序化 SOC Gateway 保持为当前实现；没有迁移 EXP-011 的 DSH Runtime 源码补丁、旧 MCP Client 注册、历史 Run 或运行状态。

受信 Schedule 桥只接受 Runtime 标记的 Schedule 消息及精确合同 `{"type":"threat-analysis.pending","version":1,"batchSize":1}`。每 120 秒心跳最多实际研判一条事件；同一插件实例已有研判时立即返回 `skipped_busy`，过期心跳返回 `skipped_stale`，均不建立补跑队列。待研判列表最多读取第一页 100 条，事件 ID 去重后顺序尝试；认领返回 HTTP 409 时记录 `skipped_locked` 并继续寻找一条可认领事件。分析内核预算为 30 分钟，手动和自动工具外层预算分别为 36 和 45 分钟；批次回复显示事件 ID 与 Run ID。普通用户消息即使包含相同 JSON，也不能通过工具内的受信来源校验。

SOC Gateway 的当前资源目录包含 `ai_soc_correlate__get_correlate_incident_judge_pending`，实际只读调用返回 `result.data.rows`。隔离实例 `security-operations-exp015-auto-check` 使用标准镜像 `ai-agent-harness/dsh:21638c563-54f335ef05ac`，镜像 ID 为 `sha256:2cfbb30906d871a9bd43445194339a52c7952de3b6fb2a7b1d688cfb5ad8bcfc`；最终 Candidate 三棵资产只读装载后 DSH 正常启动。容器内通过本 Candidate 的 `dsh_runner.pending` 读取 50 条样本，50 条均为合法事件 ID，并返回总数信息。分析阶段由 Python 在 30 分钟后受控中断，手动工具的 36 分钟和自动工具的 45 分钟外层预算为 SOC 失败回写与交付留出余量。探针没有创建 Schedule、认领事件或执行大模型研判；完成后已停止并移除实例容器，独立 HOME 卷保留。

候选测试共 17 项通过：Node 11 项覆盖精确合同、合并心跳、固定适配器、异常结果终止交付、批次交付、ID 去重与异常形状、主/子 Agent 可见性、超时层级、专用路由恢复、自然语言创建与删除指令、空列表、重叠心跳、旧心跳、409 后继续及普通消息拒绝；Python 6 项覆盖当前目录、受限分页参数、认领冲突错误码保留、SOC 幂等重试、Qwen 单层完整 `json` 围栏和超时后 SOC 失败回写。仓库与 Experiment 校验无错误或告警；仓库校验器测试 58 项、来源合同测试 20 项均通过。

通用 `verify-load.sh` 未计为通过：Candidate 插件依赖按仓库要求安装在被挂载的 `managed/**/node_modules` 后，宿主摘要会跳过 `node_modules`，容器摘要却会计入，因而报告 `host/container asset tree mismatch: managed`。实际隔离实例和容器内只读探针已通过，但不能替代该装载校验，也不能证明真实持续 Schedule、完整单事件取证、大模型结论、SOC 回写和报告下载成功。心跳互斥与上次完成时间仍是插件进程内状态；容器重启后主要依赖心跳时间和 SOC 409 阻止重复认领。同 Session 的批次若混入其他提醒，本桥不劫持该轮，自动研判会等待下一次纯自动心跳；持续自动研判仍应使用独立 Session。SOC 结果回写以相同 judgementId/runId 最多尝试两次；两次均失败时仍可能留在“研判中”，本轮只保留本地请求与失败状态，不对结果未知的远端状态冒险覆写。本 Experiment 保持 `active`；下一步应在合并后用新 Session 创建一次持续任务，观察至少一次新鲜心跳和一次重叠心跳，再依据真实结果作 Decision。
