# 仓库测试

本目录保存仓库工具、校验器、解析器、快照恢复与迁移脚本的测试，不保存任何 Agent 业务 Case 或评测数据。

运行方式：

```bash
# Python 校验器与工具测试（128 项，含评测闭环契约）
python3 -m unittest discover -s tests -v

# 迁移工具自测（导入脚本随源放置）
python3 -B evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/test_import_sources.py

# DSH 容器适配层自测（mjs，需 Node；py 测试覆盖来源合同与三树回执）
node --test runtime/adapters/dsh-container/test_*.mjs
node tests/experiments/test_security_guard.mjs
python3 -m unittest discover -s runtime/adapters/dsh-container -p 'test_*.py' -v
```

`tests/test_validators.py` 还覆盖来源选择器（`experiment:`/`snapshot:`/`release:`）、三角色挂载计划、`research-snapshot` 快照往返与篡改检测、`run_record.py` 收尾封存以及 Agent spec/eval/issues 校验器契约。

适配层的 `test_*.py`、`test_*.mjs` 与镜像内脚本身份摘要绑定，变更适配层后必须重跑对应测试并复核 `DSH_ADAPTER_PINNED_SHA256` 门禁摘要。

