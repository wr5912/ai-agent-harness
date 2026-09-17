# 策略配置交付包测试

本目录校验策略配置智能能力交付包本身，不替代源码模块测试或正式 Eval Trial。

在 `策略配置_delivery` 目录执行：

```bash
python3 -B -m pytest -p no:cacheprovider -q tests
```

检查范围：

- 六件套文档及 `eval/cases.jsonl`、`eval/results.csv` 是否齐全；
- 50 条候选 Case 是否可解析，ID 和用户输入是否唯一；
- Case 必填字段、枚举、安全控制、需求和场景引用是否有效；
- Results CSV 表头及已有结果行是否符合数据契约；
- Eval 与 Results 当前 SHA-256 是否写入相关交付文档。

源码与 Workspace 定向测试仍在原位置执行：

```bash
cd ai/ai-workbench
mvn -pl ai-policy -am test -DskipTests=false

cd ../security-operations-expert/workspace
python3 -B -m pytest -p no:cacheprovider -q \
  tests/test_policy_configuration.py \
  tests/test_policy_route_intent.py \
  tests/test_policy_route_guard.py \
  tests/test_policy_preview_handoff.py

cd ../../ai-console-service
npm test -- --run \
  test/policy-configuration-chat.service.spec.ts \
  test/policy-configuration-conversation-decision.spec.ts
```

本目录测试通过只表示交付包结构和机器证据一致，不表示 50 条正式 Eval Trial 已通过。

