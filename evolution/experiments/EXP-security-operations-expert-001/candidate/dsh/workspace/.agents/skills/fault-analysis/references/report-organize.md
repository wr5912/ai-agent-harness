# 报告材料组织表达边界参考

## 目标

组织根因分析报告和故障分析报告输入包材料。

## 输入

| 输入 | 说明 |
| --- | --- |
| AnalysisExecutionRecord | 分析执行记录 |
| AnalysisResultRecord | 分析结果记录 |
| EvidencePackage | 证据包 |
| RuleHitRecordSet | 规则命中 |
| ToolCallSummary | 工具调用摘要 |

## 约束

| 约束 | 说明 |
| --- | --- |
| 两类报告区分 | RootCauseAnalysisReport 面向响应处置；<br>FaultAnalysisReportPayload<br>面向报告生成智能体 |
| 不重复取证 | 故障分析报告输入包必须携带完整分析过程和引用 |
| 保留缺口 | 证据缺口、降级原因和不确定性必须进入报告材料 |

## 输出

```json
{
  "root_cause_analysis_report": {
    "report_state": "candidate",
    "disposition_suggestions": [],
    "verification_requirements": []
  },
  "fault_analysis_report_payload": {
    "analysis_process": [],
    "evidence_gaps": []
  }
}
```
