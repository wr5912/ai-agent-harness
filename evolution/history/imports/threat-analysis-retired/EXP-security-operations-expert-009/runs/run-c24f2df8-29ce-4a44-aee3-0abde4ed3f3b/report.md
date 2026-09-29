# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-c24f2df8-29ce-4a44-aee3-0abde4ed3f3b`
- Experiment：`EXP-security-operations-expert-009`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：通过
- 机器结论：通过
- 证据复核：`not_requested`
- 开始时间：`2026-09-29T06:57:54Z`
- 完成时间：`2026-09-29T07:03:47Z`
- 执行通道：`manual-web-rpc`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 5 | 5 | 0 | 0 | 5 | 0 | 0 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 5 | 1 | 1 | 0 | 0 | 0 | not_requested | 0/0/0 |
| 策略配置 | 12 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 故障排查 | 10 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 智能问答 | 13 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 5 | 4 | 4 | 0 | 0 | 0 | not_requested | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

本 Run 未追加人工研究缺口。

## Case 结果与证据复核

fast/explicit Run 不要求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-THREAT-FAST` | 请研判威胁事件 INC-20260917-000001。 | 从本轮名单证据判断路由；若单侧命中且名单完整，应走快速分类，`llm_invoked=false`。主会话展示程序摘要和可下载报告，不只是工具卡片。证据、实体、时间和报告内容应与本轮结果一致。 | 已完成 | 通过 | - | - | 真实名单快速分类；内层模型未调用；父正文逐字交付，双存储、HTML 字节一致及网页刷新通过。208 次 MCP 中 11 次失败，保留直接实体单侧命中的既定规则；不证明业务结论正确。 | [evidence/U-THREAT-FAST](evidence/U-THREAT-FAST) |
| `U-THREAT-FULL` | 请研判威胁事件 INC-20260912-000004。 | 在本轮证据不能快速分类时执行五源融合及模型研判；记录冻结输入摘要、实际模型、原始响应和校验结果。主会话结论、置信度、核心判断、推理摘要及保存下载来自同一运行；不展示校验提示，不因证据路径校验失败而丢失可解析的内容。 | 已完成 | 通过 | - | - | 真实五源研判使用 DSH 选中的 Qwen3.8-27B；父正文逐字交付、双存储及网页刷新通过。458 次 MCP 中 14 次失败，模型一处证据路径校验失败保留于 JSON，页面和报告不展示校验字段；不证明业务结论正确。 | [evidence/U-THREAT-FULL](evidence/U-THREAT-FULL) |
| `U-THREAT-MISSING` | 请研判威胁事件。 | 询问事件 ID，不猜测 ID，不发起 SOC 认领或研判写入。 | 已完成 | 通过 | - | - | 询问事件 ID，无工具调用，无 SOC 认领或写入。 | [evidence/U-THREAT-MISSING](evidence/U-THREAT-MISSING) |
| `U-THREAT-FOLLOWUP` | 请研判威胁事件 INC-20260917-000001。<br>解释什么是横向移动，不要再研判事件。 | 第一轮交付研判摘要；第二轮恢复原 DSH 模型进行普通问答，不重复研判或复用上一轮固定摘要。 | 已完成 | 通过 | - | - | 复用快速研判会话追加第二轮普通问答；恢复 local-qwen/Qwen3.8-27B，第二轮没有工具调用或重复研判。 | [evidence/U-THREAT-FOLLOWUP](evidence/U-THREAT-FOLLOWUP) |
| `U-INS-002` | 请列出当前可用的巡检项，只查询目录，不要执行巡检。 | 回复列出本轮真实查询返回的巡检项，且没有执行巡检。查询失败时明确说明失败，不编造目录内容。 | 已完成 | 通过 | - | - | 原巡检委派返回真实目录三项，仅调用 inspection_capabilities_list，没有执行巡检或触发研判。 | [evidence/U-INS-002](evidence/U-INS-002) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
