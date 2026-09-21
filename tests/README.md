# 仓库测试

本目录保存稳定、确定、可重复的机器合同测试。它们覆盖项目验收矩阵中的部分 `PA-xx`，不替代真实 DSH、浏览器、模型、MCP 或 Experiment 行为观察。

## 运行方式

```bash
# 项目技能、仓库合同和 Research Run
python3 -m unittest discover -s tests -v

# MCP 桩的 owning tests
python3 -B evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/test_derive_mcp_stub_tools.py

# DSH 适配层
python3 -m unittest discover -s runtime/adapters/dsh-container -p 'test_*.py' -v
node --test runtime/adapters/dsh-container/test_startup_vector.mjs \
  runtime/adapters/dsh-container/test_tree_identity.mjs \
  runtime/adapters/dsh-container/test_module_boundary.mjs
node tests/experiments/test_security_guard.mjs
```

`test_home_submounts.mjs` 读取容器内 `/proc/self/mountinfo`，只在核验容器中执行，不加入宿主机的 Node 批量测试。

## 测试与实机验证的边界

| 内容 | 放置位置 | 能证明什么 |
|---|---|---|
| schema、路径、摘要、状态转换、失败分支 | `tests/` 或 owning module 邻近测试 | 对应机器合同没有回归 |
| Docker 挂载、镜像与实际 DSH 装载 | 适配层探针和 Experiment evidence | 声明环境中的技术事实 |
| Web 工作区、Session、消息和结果 | `PA-08` 的浏览器 E2E 或人工实录 | 完整用户路径在该环境可用 |
| Harness 变化 | 对应 Experiment 的 Run 和 Decision | 声明输入、模型和环境下的研究观察 |
| Research Release 复现 | 静态清单测试加实际重新装载 | 该具体研究版本可恢复 |

自动化测试成功不表示 Harness 改动有效，也不表示生产可用。反过来，一次实机记录也不能替代稳定解析器和状态机的回归测试。
