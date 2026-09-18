# 仓库测试

本目录保存仓库工具、校验器、解析器、快照恢复与迁移脚本的测试，不保存任何 Agent 业务 Case 或评测数据。

运行方式：

```bash
# Python 校验器与工具测试（146 项，含评测闭环契约）
python3 -m unittest discover -s tests -v

# 迁移工具自测（导入脚本随源放置）
python3 -B evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/test_import_sources.py

# MCP 桩工具清单派生与桩服务协议自测（8 项，桩服务部分需 Node）
python3 -B evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/test_derive_mcp_stub_tools.py

# DSH 容器适配层自测（宿主可跑的 mjs，需 Node；py 测试覆盖启动器与三树回执）
node --test runtime/adapters/dsh-container/test_startup_vector.mjs \
  runtime/adapters/dsh-container/test_tree_identity.mjs \
  runtime/adapters/dsh-container/test_module_boundary.mjs
node tests/experiments/test_security_guard.mjs
python3 -m unittest discover -s runtime/adapters/dsh-container -p 'test_*.py' -v   # 37 项
```

`runtime/adapters/dsh-container/test_home_submounts.mjs` 是**容器内**挂载语义探针（读取 `/proc/self/mountinfo`、断言 HOME 可写与受控子挂载只读及 `EROFS`/`EACCES`），不能在宿主机直接运行；它需要把适配层目录以只读方式挂进核验容器后再执行，宿主机批量 `node --test .../test_*.mjs` 不应包含它。

`tests/test_validators.py` 还覆盖来源选择器（`experiment:`/`snapshot:`/`release:`）、三角色挂载计划、`research-snapshot` 快照往返与篡改检测、`run_record.py` 收尾封存以及 Agent spec/eval/issues 校验器契约。

适配层测试覆盖启动器纯函数（`test_dsh_dev.py`：Compose 渲染、认证 URL 提取与 Token 会话探针、`url` 非交互失败关闭、脱敏、实例状态不落 Token、端口探测）。适配层的 `test_*.py`、`test_*.mjs` 与镜像内脚本身份摘要绑定，变更适配层后必须重跑对应测试并复核 `DSH_ADAPTER_PINNED_SHA256` 门禁摘要。

