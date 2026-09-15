# 故障排查交付包测试

本目录校验故障排查智能体交付包本身，不替代 Runtime、Workbench、Workspace 源码测试或正式 Eval Trial。

在 `故障排查_delivery` 目录执行：

```bash
python3 -B -m pytest -p no:cacheprovider -q tests
```

检查范围：

- 六件套文档及 `eval/cases.jsonl`、`eval/results.csv` 是否齐全；
- 50 条候选 Case 是否可解析，ID 和用户输入是否唯一；
- Case 必填字段、枚举、安全控制、需求和场景引用是否有效；
- Results CSV 表头及已有结果行是否符合数据契约；
- Eval 与 Results 当前 SHA-256 是否已写入相关交付文档。

源码与 Workspace 定向测试仍在原位置执行：

```bash
cd ai/fault-diagnosis/runtime-mcp
python3 -B -m pytest -p no:cacheprovider -q tests

cd ../../ai-workbench
mvn -pl ai-troubleshooting -am test -DskipTests=false

cd ../security-operations-expert/workspace
python3 -B -m pytest -p no:cacheprovider -q \
  tests/test_fault_analysis_assets.py tests/test_fault_analysis_behavior.py
```

本目录测试通过只表示交付包结构和机器证据一致，不会覆盖 `06_自测与交付评估报告.md` 已记录的源码测试失败，也不表示 50 条正式 Eval Trial 已通过。
