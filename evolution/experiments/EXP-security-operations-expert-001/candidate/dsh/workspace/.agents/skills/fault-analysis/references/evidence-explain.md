# 证据解释表达边界参考

## 目标

解释 EvidencePackage 中证据对候选根因的支持、反证、缺口和时间窗口一致性。

## 输入

| 输入 | 说明 |
| --- | --- |
| EvidencePackage | 证据包 |
| ToolCallSummary | 工具调用摘要 |
| RuleHitRecordSet | 规则命中记录 |
| effective_time_window | 内部生效分析时间窗口 |

## 约束

| 约束 | 说明 |
| --- | --- |
| 不编造证据 | 只能解释已有证据和明确缺口 |
| 引用来源 | 每个判断必须能回溯到 evidence_ref、rule_hit_ref 或 tool_call_ref |
| 标明缺口 | 工具失败、权限不足、数据过期必须输出 evidence_gap |

## 输出

```json
{
  "evidence_explanations": [
    {
      "summary": "路径经过 fw-border-01，策略点存在。",
      "supporting_refs": [{"ref_type": "tool_call", "ref_id": "tool-topology-001"}],
      "impact": "支持策略阻断候选继续取证。"
    }
  ],
  "evidence_gaps": []
}
```
