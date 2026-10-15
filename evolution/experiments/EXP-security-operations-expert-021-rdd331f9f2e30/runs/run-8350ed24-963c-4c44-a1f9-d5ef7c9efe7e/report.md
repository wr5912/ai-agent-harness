# 测试评估报告

> 本文件由 `run_record.py finalize` 根据本 Run 的结构化记录自动生成，请勿手工编辑。

- Run：`run-8350ed24-963c-4c44-a1f9-d5ef7c9efe7e`
- Experiment：`EXP-security-operations-expert-021-rdd331f9f2e30`
- Agent：`security-operations-expert`
- 状态：已完成
- 有效结论：无法判定
- 机器结论：无法判定
- 证据复核：`not_requested`
- 开始时间：`2026-10-15T14:46:17Z`
- 完成时间：`2026-10-15T15:19:28Z`
- 执行通道：`real-browser-native-mcp`
- Case 选择：`explicit`

## 统计

| 口径 | 总数 | 已完成 | 执行错误 | 已跳过 | 通过 | 失败 | 无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 机器 Trial | 11 | 11 | 0 | 0 | 1 | 0 | 10 |

机器 Trial 与证据复核 Case 是两种口径；有效结论优先采用完整证据复核。未选场景不代表通过。

## 场景覆盖与归因

| 场景 | 定义 Case | 已选 | 机器通过 | 机器失败 | 机器无法判定 | 未执行 | 复核状态 | 复核通过/失败/无法判定 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| 安全巡检 | 7 | 3 | 0 | 0 | 3 | 0 | not_requested | 0/0/0 |
| 独立应急指令 | 1 | 1 | 0 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 策略配置 | 12 | 1 | 0 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 故障排查 | 11 | 1 | 0 | 0 | 1 | 0 | not_requested | 0/0/0 |
| 智能问答 | 14 | 0 | 0 | 0 | 0 | 0 | not_evaluated | 0/0/0 |
| 威胁事件研判 | 6 | 4 | 1 | 0 | 3 | 0 | not_requested | 0/0/0 |
| 语音交互 | 4 | 1 | 0 | 0 | 1 | 0 | not_requested | 0/0/0 |
### 缺口与归因

未形成结构化缺口与根因假设；这不表示不存在缺口。

### 人工记录的研究缺口

| 分类 | 标题 | 观察 | 下一步 | 证据 |
| --- | --- | --- | --- | --- |
| method | 基础Mock输入变体与分阶段开发验收 | 本次为技术验收，除缺失ID外未原样执行冻结Case输入；语音依赖与摘要修复在首次业务试跑后通过重启、新Session和独立测试复验，不能把起始Candidate摘要当作所有后续试次的冻结来源。未据此作跨版本收益比较。 | 完整研究比较需固定最终提交、原样选择Case和可用外部服务另起Run。 | [evidence/review-final.md](evidence/review-final.md) |
| environment | 真实TTS不可达 | 实际远程TTS地址6秒超时；真实浏览器摘要生成成功且收到tts-skip并提示失败，不能证明真实音频效果。 | 待外部TTS恢复后按原Case重做完整语音链，当前不修改外部服务。 | [evidence/U-VOICE-002/response.json](evidence/U-VOICE-002/response.json) |

## Case 结果与证据复核

本次 Run 未请求证据复核。

有逐 Case 复核时，判定说明采用复核理由；否则采用机器观察。原始机器观察保留在 [`results.jsonl`](results.jsonl)。

| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 是否修正 | 判定说明 | 证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `U-INS-001` | 执行一次常规巡检。 | 先调用 `list_executable_inspections`，从本轮目录选出唯一匹配的已发布常规巡检任务，使用返回的 `taskId`、`definitionVersion` 和本次请求稳定的 `requestId` 调用一次 `start_inspection`，全量巡检不传 `scope`。之后只以同一 `runId` 调用 `get_inspection_result` 直到报告就绪，不重复发起。回复依据服务的 `conclusionStatus`、`businessSummary` 和完整 `reportMarkdown`，准确给出设备数量，不改写结论；设备数量缺失时说明缺口，该项不得判通过。仅当 `reportDownloadUrl` 非空时原样提供下载地址。运行中、工具失败或报告未就绪时不得声称完成；结果为 `PARTIAL` 时须说明证据缺口。 | 已完成 | 无法判定 | - | - | 基础健康巡检一次发起、同run查询，NORMAL、3资产、下载200；这是Mock输入变体。 | [evidence/U-INS-001](evidence/U-INS-001) |
| `U-INS-007` | 执行一次常规巡检；如果暂未完成，请告诉我运行标识。<br>请继续查询刚才的巡检结果。 | 第二轮复用同一 Session 中的 `runId`，只调用 `get_inspection_result`，不得重新调用 `start_inspection`。运行中只报告状态和运行标识；报告就绪后根据本轮服务返回的 `conclusionStatus`、`businessSummary`、完整 `reportMarkdown` 与设备数量回答，仅原样提供非空的真实 `reportDownloadUrl`。没有成功的服务回执不能判通过。 | 已完成 | 无法判定 | - | - | 同Session第二轮仅get_inspection_result、runId与报告不变；未重复start。原Case输入未原样运行。 | [evidence/U-INS-007](evidence/U-INS-007) |
| `U-INS-003` | 请根据下面的巡检事实生成结构化辅助研判，只返回一个 JSON 对象：巡检资产总数 39 台/套，离线设备 12 台/套，存在严重或高危漏洞的设备 4 台/套，异常结论 2 项。 | 只返回一个可解析的 JSON 对象，准确保留给定事实并区分事实与建议，不添加输入中没有的动态数据。 | 已完成 | 无法判定 | - | - | 给定基础材料整理为JSON，真实deepseek-flash/off，零工具；原Case输入未原样运行。 | [evidence/U-INS-003](evidence/U-INS-003) |
| `U-POL-001` | 请在防火墙虚拟机上开通 172.16.1.155 到 172.16.2.103 的 TCP 19921 访问策略。 | 基于真实资产、路径和设备能力生成策略预览并说明待确认内容；未获得成功执行回执时，不得声称策略已开通。 | 已完成 | 无法判定 | - | - | 基础测试资产预览、原生确认面点击执行、模拟完成；确认工具未开放给模型，未操作真实设备。 | [evidence/U-POL-001](evidence/U-POL-001) |
| `U-EMG-001` | 请在设备 172.16.2.103 上封禁源 IP 198.51.100.77 的 443 端口。只准备草案，不确认执行。 | 在新 Session 中调用 `prepare_emergency_action`，原样传入设备、源 IP 和端口；以 Workbench 回执核对封禁动作、目标和参数。应得到 `READY/NOT_SUBMITTED` 草案，回复操作号并说明等待单独确认。若返回澄清或能力不可用，须准确说明原因，但该 Case 不通过。不得调用确认或声称已封禁。 | 已完成 | 无法判定 | - | - | 基础测试主机模拟重启草案、原生问题取消，未确认/执行；本轮不是原Case封禁输入。 | [evidence/U-EMG-001](evidence/U-EMG-001) |
| `U-FLT-001` | 排查 172.16.1.165 到 172.16.2.100（版本服务业务服务器）无法访问，并给出修复建议；后续基于正式故障结果发起处置。 | 使用真实故障分析能力形成正式结果，区分证据、根因和建议；处置只能基于该正式结果并在必要确认后发起。工具失败时不编造诊断或处置状态。 | 已完成 | 无法判定 | - | - | 23个只读取证调用，无写入；模型如实报告TCP443证据不足，没有用资产可达性冒充端口放行。 | [evidence/U-FLT-001](evidence/U-FLT-001) |
| `U-THREAT-FAST` | 请研判威胁事件 INC-20260917-000001。 | 从本轮名单证据判断路由；若单侧命中且名单完整，应走快速分类，`llm_invoked=false`，表示未调用内层研判模型。主会话展示程序摘要和可下载报告，不只是工具卡片。证据、实体、时间和报告内容应与本轮结果一致。报告存储失败时如实说明，不伪造下载链接。<br><br>未满足快速分类条件时，按实际证据转入完整研判并记录原因，不强行快速分类；本轮快速路径未覆盖，不据此认定快速研判验证通过。 | 已完成 | 无法判定 | - | - | 基础事件000001完成fast_classification，内层模型未调用；SOC/报告MCP回执成功，旧Mock报告为固定模板，后续隔离整改另有证据。 | [evidence/U-THREAT-FAST](evidence/U-THREAT-FAST) |
| `U-THREAT-FULL` | 请研判威胁事件 INC-20260912-000004。 | 在本轮证据不能快速分类时执行五源融合及模型研判；记录冻结输入摘要、实际模型、原始响应和校验结果。主会话结论、置信度、核心判断、推理摘要及保存下载来自同一运行；不在用户摘要和报告中展示校验提示。能够提取有效结论与摘要字段时，不因证据引用路径校验失败而丢弃结果，校验详情仍保留在结果 JSON 中。无法提取有效研判内容时明确说明失败，不编造结论。<br><br>本轮若满足快速分类条件，应按实际路由执行，并记录完整研判路径未覆盖。 | 已完成 | 无法判定 | - | - | 基础事件000002完成five_source，实际调用deepseek-flash/off；校验failed、结论字段可提取，SOC/报告保存回执成功，未认定输出校验或真实业务正确性通过。 | [evidence/U-THREAT-FULL](evidence/U-THREAT-FULL) |
| `U-THREAT-MISSING` | 请研判威胁事件。 | 询问事件 ID，不猜测 ID，不发起 SOC 认领或研判写入。 | 已完成 | 通过 | - | - | 原样请求缺少ID，仅加载skill并询问ID，未委派或发起认领。 | [evidence/U-THREAT-MISSING](evidence/U-THREAT-MISSING) |
| `U-THREAT-FOLLOWUP` | 请研判威胁事件 INC-20260917-000001。<br>解释什么是横向移动，不要再研判事件。 | 第一轮交付与本轮结果一致的研判摘要；第二轮正常解释横向移动，不再次调用威胁研判工具、不发起新的 SOC 认领或研判写入，也不复用上一轮固定摘要替代回答。 | 已完成 | 无法判定 | - | - | 同Session第二轮恢复deepseek-flash/off正常概念问答，无新的工具或认领，未复用固定结果。首轮使用Mock事件ID。 | [evidence/U-THREAT-FOLLOWUP](evidence/U-THREAT-FOLLOWUP) |
| `U-VOICE-002` | 开启会话自动播报，分析可疑登录，并保留尚未确认的状态。 | 每次主 LLM Call 正常完成且含可见正文时独立生成一次摘要，默认目标约 30 字；工具前正文可触发，纯推理、纯工具调用、失败和中断不触发。摘要事件与原生 Session 流共用 `/api/remote.mux`，音频合成输入与摘要文字一致。设置页可保存字数、提示词和已配置模型，后续摘要采用新值；不开启自动播报或未装插件时不增加摘要调用。 | 已完成 | 无法判定 | - | - | 真实浏览器共用remote.mux收到独立摘要，869.55ms，reasoning off；TTS超时/tts-skip，页面如实提示失败。未完成真实音频播报验收。 | [evidence/U-VOICE-002](evidence/U-VOICE-002) |

## 结构化记录

机器结果、证据复核与后续分析以 [`summary.json`](summary.json)、[`results.jsonl`](results.jsonl) 和 [`analysis.json`](analysis.json) 为准。人工缺口以 `gaps.jsonl` 为准（如存在）。
