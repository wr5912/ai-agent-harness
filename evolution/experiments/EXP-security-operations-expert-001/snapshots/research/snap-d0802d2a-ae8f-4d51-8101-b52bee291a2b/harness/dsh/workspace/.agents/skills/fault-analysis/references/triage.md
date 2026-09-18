# 故障域分诊表达边界参考

## 目标

根据直接会话问题或 Gov 下发的 FaultAnalysisRequest，识别故障域、影响范围、优先取证方向和分诊置信度。

## 输入

| 输入 | 说明 |
| --- | --- |
| original_question | 原始问题 |
| trigger_payload | 外部触发原始载荷，例如告警、API 请求或工单内容 |
| normalized_question | 标准化问题，可由 Gov 提供，也可由故障分析能力包生成 |
| target_objects | Gov 请求携带的原始分析对象，可能为空或不完整 |
| normalized_target_objects | 故障分析能力包归一化后的分析对象 |
| effective_time_window | 内部生效分析时间窗口 |
| upstream_context_summary | 上游上下文摘要 |

## 约束

| 约束 | 说明 |
| --- | --- |
| 规则优先 | 已有明确规则或对象类型时优先按规则分诊 |
| 不输出根因 | 本步骤只输出故障域和取证方向 |
| 保留不确定性 | 多个故障域竞争时输出候选故障域和置信度 |
| 兜底受限 | 低置信时只能输出有限兜底探测动作，不能生成最终根因 |
| 交互协议不内置 | Gov 平台统一交互协议由 Gov 平台侧定义，本能力包不新增 Gov 协议字段 |
| 一期直接交互 | 用户手动切换到故障分析智能体时，可围绕缺失字段直接追问用户；<br>其他调用方式先输出 clarification_questions |
| 不混用置信度 | confidence 只表示故障域分诊把握程度，不是根因候选置信度 |
| 不自由打分 | confidence 必须来自 MCP 分诊结果，不得由大模型自行打分 |

## 分诊置信度阈值

| 分数区间 | triage_action | 处理方式 |
| --- | --- | --- |
| `>= 0.70` | `proceed_specific_sop` | 进入对应正式故障域 SOP 和必查清单 |
| `0.40 - 0.69` | `generic_triage_probe` | 不直接进入正式 SOP；只做有限兜底探测，用于识别对象、补齐最小上下文或重新路由到正式故障域 |
| `< 0.40` | `manual_required` / `unsupported` | 不强套正式故障域 SOP；处于故障分析智能体直接会话时可追问用户，否则返回补充信息建议或暂不支持 |

无法识别最小分析对象时，无论分诊置信度是多少，都必须输出 `manual_required`。有限兜底探测不能替代正式故障域 SOP，也不能进入根因规则、候选和置信度计算。

分诊置信度必须输出计算明细，包括因子分、扣分、硬停止规则、最终分数和阈值结果。

## 输出

```json
{
  "fault_domain": "business_access_abnormal",
  "severity": "high",
  "impact_scope": "source_segment_to_target_segment",
  "evidence_direction": ["asset", "route_path", "device_status", "policy", "change"],
  "confidence": 0.78,
  "confidence_basis": [
    "用户描述源网段到目标网段不可达",
    "对象类型包含源网段和目标业务系统",
    "命中 business_access_abnormal 正式故障域表达"
  ],
  "alternative_fault_domains": [
    {
      "fault_domain": "business_service_abnormal",
      "confidence": 0.42,
      "reason": "目标业务系统不可访问也可能由应用服务异常导致，但当前描述更偏网络连通性。"
    }
  ],
  "triage_action": "proceed_specific_sop",
  "clarification_questions": [],
  "reason": "用户描述源网段到目标网段不可达，符合网络不通场景。"
}
```
