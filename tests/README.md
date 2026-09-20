# 仓库测试

本目录保存仓库工具、校验器、解析器、快照恢复与迁移脚本的确定性测试，不保存任何 Agent 业务 Case 或评测数据。它们是[项目验收矩阵](../docs/ai-agent-harness项目验收矩阵.md)中部分 `PA-xx` 的机器证据，不能替代具体 Harness 的交付评估或 DSH Release 运行验收。

运行方式：

```bash
# Python 校验器与工具测试（含评测闭环合同）
python3 -m unittest discover -s tests -v

# 迁移工具自测（导入脚本随源放置）
python3 -B evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/test_import_sources.py

# MCP 桩工具清单派生与桩服务协议自测（桩服务部分需 Node）
python3 -B evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/test_derive_mcp_stub_tools.py

# DSH 容器适配层自测（宿主可跑的 mjs，需 Node）
node --test runtime/adapters/dsh-container/test_startup_vector.mjs \
  runtime/adapters/dsh-container/test_tree_identity.mjs \
  runtime/adapters/dsh-container/test_module_boundary.mjs
node tests/experiments/test_security_guard.mjs
python3 -m unittest discover -s runtime/adapters/dsh-container -p 'test_*.py' -v
```

## 验证类型与结论边界

| 类型 | 放置位置 | 结论边界 |
|---|---|---|
| 结构、解析、失败关闭、确定性不变量 | 本目录或 owning module 邻近测试 | 只证明对应机器合同通过 |
| Docker、挂载、镜像与 DSH 进程探针 | `runtime/adapters/dsh-container/`；必要证据归入 Experiment | 只证明声明环境中的技术装载或隔离 |
| Web、真实模型/MCP 和完整开发路径 | 项目验收矩阵对应 `PA-xx` 及受控运行证据 | 证明所记录范围内的项目路径，不证明业务 Agent 交付 |
| Agent 能力、安全门禁与正式评估 | `agents/<agent-id>/spec/`、`eval/` 和逐 Run 归档 | 具体冻结候选的 Harness 交付结论 |
| 不可变 Release 的目标环境装载 | Release 制品与 `dsh-release-verify` 证据 | 具体 Release 的 DSH 运行验收结论 |

`runtime/adapters/dsh-container/test_home_submounts.mjs` 是**容器内**挂载语义探针（读取 `/proc/self/mountinfo`、断言 HOME 可写、受控子挂载、适配层脚本目录只读、开发会话判分材料只读、开发身份文件只读且被测容器完全没有这些路径及 `EROFS`/`EACCES`），不能在宿主机直接运行；它需要把适配层目录以只读方式挂进核验容器后再执行，宿主机批量 `node --test .../test_*.mjs` 不应包含它。

`tests/test_validators.py` 还覆盖来源选择器合同（`experiment:` 正向解析；尚未接线的 `release:` 与已退役的 `snapshot:` 失败关闭）、三角色挂载计划与判分材料隔离、`run_record.py` 的 Git 版本记录与收尾封存、以及 Agent spec/eval/issues 校验器契约。

适配层测试覆盖启动器纯函数（`test_dsh_dev.py`：Compose 渲染、`dev`/`eval` 模式别名与判分材料按角色挂载、目标 preset 由来源声明推出、开发模式信任门禁、`down` 在命令失败/仍有容器运行/状态未知时不报告停止成功、认证 URL 提取与 Token 会话探针、`url` 非交互失败关闭、脱敏、实例状态不落 Token、端口探测）与来源合同（`test_source_contract.py`：开发叠加层字段、preset ID 推导、`snapshot:` 失败关闭、符号链接与硬链接拒绝）。适配层的 `test_*.py`、`test_*.mjs` 与镜像内脚本身份摘要绑定，变更适配层后必须重跑对应测试并复核 `DSH_ADAPTER_PINNED_SHA256` 门禁摘要。

容器级核验（需要 Docker 与已构建的本地镜像，不进入上面的单元测试）。适配层脚本以只读挂载进入容器，因此改脚本后**不需要重建镜像**，直接重跑即可：

```bash
bash runtime/adapters/dsh-container/verify-load.sh authoring --source experiment:EXP-security-operations-expert-001
bash runtime/adapters/dsh-container/verify-load.sh verification --source experiment:EXP-security-operations-expert-001
node --test runtime/adapters/dsh-container/test_home_submounts.mjs   # 仅在核验容器内执行
```

待复核输入的阅读视图由 `evolution/experiments/<EXP>/evaluation/tools/render_pending_review.py` 按需生成，只读 JSONL，不作为第二份可编辑事实源：

```bash
python3 evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/render_pending_review.py \
  --agent-dir agents/security-operations-expert
```
