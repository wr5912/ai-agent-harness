# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-42cf6b55-0e59-46c8-96c4-3bc7f6d9a061`
- Experiment：`EXP-security-operations-expert-008`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-09-30T01:46:17Z`
- 完成时间：`2026-09-30T01:47:11Z`
- 执行通道：`browser-cdp-voice`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 1 | 1 | 0 | 0 | 1 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 独立应急指令 | 1 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 10 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 13 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 5 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 语音交互 | 1 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

fast/explicit Run 不要求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-VOICE-001` | 你好，这是语音测试。 | 浏览器麦克风录入后显示可编辑的转写草稿；说出发送触发词后只提交测试语句，不把触发词写入消息。当前 Session 收到模型的实际回复，点击该回复的朗读按钮后进入浏览器音频播放流程；原生会话和输入功能仍可用。 | 已完成 | 通过 | - | - | 3102 重启后 0.0.3 安装包的 27 个文件与 Candidate 逐字节一致。新 Session 使用默认 DeepSeek-V41-Flash；浏览器麦克风实时转写出可编辑的“你好，这是语音测试。”草稿，独立识别“确认发送”后仅调用一次 /api/session/prompt，用户消息未包含口令。助手出现非空回复，点击朗读后观察到一次音频解码和一次 AudioBufferSourceNode.start；输入框仍可编辑。浏览器通过本机 127.0.0.1 访问，未验证局域网纯 HTTP 麦克风或实体扬声器出声。 | [evidence/U-VOICE-001/browser-output.log](evidence/U-VOICE-001/browser-output.log) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
