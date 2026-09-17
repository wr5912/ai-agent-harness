# 根因候选表达边界参考

## 目标

基于证据、规则命中、反证和证据缺口生成候选根因集合，不直接绕过规则输出最终根因。

## 输入

| 输入 | 说明 |
| --- | --- |
| EvidencePackage | 证据包 |
| RuleHitRecordSet | 规则命中 |
| evidence_gaps | 证据缺口 |
| confidence_policy | 置信度策略，用于约束需要输出哪些评分因子材料，不在本阶段直接打最终分 |

## 约束

| 约束 | 说明 |
| --- | --- |
| 候选不是结论 | 只能生成候选根因，是否推荐由候选级置信度计算和根因输出约束规则决定 |
| 必须列反证 | 每个候选必须说明支持证据和反证或缺失证据 |
| 必须列竞争关系 | 每个候选应说明与其他候选的竞争关系；竞争根因不等同互斥根因，要区分可并存、互斥、主次和证据冲突 |
| 不直接打最终分 | 根因候选一次性汇总只输出置信度计算因子材料，候选级置信度计算阶段按 confidence-policy 确定性计算候选级置信度 |
| 不输出排序字段 | 根因候选一次性汇总不输出 `rank`、`confidence`、`raw_score`、`final_score`，这些只能由候选级置信度计算阶段产生 |

## 输出

```json
{
  "rca_hypothesis_set": [
    {
      "hypothesis_id": "hyp-001",
      "candidate_code": "policy_deny_hit",
      "root_cause_type": "policy_block",
      "hypothesis_state": "candidate_before_confidence",
      "summary": "策略阻断候选，需要策略命中确认。",
      "confidence_factor_inputs": {
        "evidence_strength_basis": [],
        "rule_hit_strength_basis": [],
        "link_relation_consistency_basis": [],
        "time_window_consistency_basis": [],
        "counter_evidence_exclusion_basis": []
      },
      "supporting_evidence_refs": [],
      "counter_evidence_refs": [],
      "competing_hypotheses": [
        {
          "hypothesis_id": "hyp-002",
          "relationship_type": "primary_secondary",
          "reason": "链路异常也可能解释访问不通，但当前证据更支持策略阻断作为第一候选。"
        }
      ],
      "rule_hit_refs": []
    }
  ]
}
```
