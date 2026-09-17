# 故障分析表达边界参考

用于存放故障分析大模型表达边界参考。大模型只用于理解问题、解释证据和组织中文表达，不直接生成不受证据约束的根因结论。

正式分诊、必查清单、取证计划、规则命中、候选组装、置信度计算、报告材料和入库均以 MCP 返回的结构化结果为准。这些参考文件只描述表达边界，不作为本地规则或契约来源。

参考文件：

| 模板 | 用途 |
| --- | --- |
| triage | 故障域分诊和触发对象理解 |
| evidence-plan | 辅助理解 MCP 返回的取证计划和取证意图，不替代 MCP 计划 |
| evidence-explain | 解释证据含义、缺口和冲突 |
| hypothesis | 辅助解释候选根因，不自行生成排序和置信度 |
| report-organize | 组织 MCP 返回的根因分析报告和故障分析报告输入包材料 |

## 输出字段约束

参考文件本身是 Markdown，但大模型输出必须能映射到 MCP 返回的结构化对象。

| 模板 | 必须服务的结构化对象 |
| --- | --- |
| `triage.md` | `TriageResult`、`EvidenceGap` |
| `evidence-plan.md` | `ToolCallPlan`、`PlanAdjustmentRecord` |
| `evidence-explain.md` | `EvidencePackage`、`EvidenceItem`、`EvidenceGap` |
| `hypothesis.md` | `RcaHypothesisSet`、`RootCauseCandidateList` |
| `report-organize.md` | `RootCauseAnalysisReport`、`FaultAnalysisReportPayload` |

`hypothesis.md` 输出候选根因时必须包含竞争关系说明。竞争根因不等同互斥根因，可通过 `competing_hypotheses.relationship_type` 表达可并存、互斥、主次、证据冲突或未知关系。

## 大模型输出边界字段说明

| 字段 | 含义 |
| --- | --- |
| `model_usage` | workflow 中声明的大模型用途 |
| `structured_output_required` | 输出必须能映射到 schema 或记录对象 |
| `no_free_scoring` | 大模型不得自由生成置信度分数 |
| `evidence_refs_required` | 解释、候选或报告必须引用证据 |
| `gap_required_when_uncertain` | 不确定时必须输出证据缺口，不得补造结论 |
