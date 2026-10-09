---
name: threat-analysis
description: 对明确的 SOC 威胁事件 ID 执行固定取证、快速分类或完整研判，保存 SOC 结果及可下载报告。
---

收到研判请求后，提取原始 `INC-YYYYMMDD-NNNNNN`，通过 `delegate_threat_analysis` 委派一次。prompt 只传事件 ID 和研判请求，不携带人工标签或已有结论。多个 ID 分别委派，不改写 ID；没有有效 ID 时询问用户。

专用子智能体仅调用 `analyze_threat_incident`。代码完成 SOC 认领、真实 MCP 取证、名单分类或五源融合、冻结输入模型推理、校验、摘要与报告、SOC 回写和报告存储。名单快速分类不调用内部模型。结果校验与业务结论是不同事实；历史研判源尚未接入。

正式摘要由程序直接交付主会话，下载链接只来自报告 persistence MCP。不得从 SOC 回写响应猜下载链接，不再调用模型改写摘要。取证、模型和存储失败均保留真实状态，不编造结论或保存成功。
