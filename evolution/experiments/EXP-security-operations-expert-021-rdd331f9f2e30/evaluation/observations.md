# 融合 Evaluation 观察

本轮基于两份已固定来源建立独立 Candidate，引用与能力取舍见 [change.yaml](../change.yaml) 和 [假设](../hypothesis.md)。归档接收、原始状态和摘要保留在[来源记录](../../EXP-security-operations-expert-020-r9d6dc03aa1bb/source-import.md)，没有把归档原观察作为本轮通过证据。

## 来源与装载

本地主线 203 个文件没有缺失；归档 205 个选择文件完整固定后按功能融合。11 个威胁核心算法、提示词和样式在两个来源及新 Candidate 中逐字节相同；语音预算、PCM 顺序、取消及受信自动任务继续保留。三方共同改动及必要制品已逐项检查，差异清单见 [主来源](evidence/inherit-main-final.txt)、[归档来源](evidence/inherit-archive-final.txt)。差异检查返回 1 表示共同文件需要审查，不表示缺失。

实际使用锁定官方提交 `21638c56315ae6a2b552d6091945d3144c9af32e` 构建的标准 Runtime 镜像，Image ID 为 `sha256:dea01573415290bd9fe33cc0e8333da1003ec12fa0ed460fa33a2c500d7b019c`；重建原因是镜像构建输入中的来源合同变化，没有为 Harness 派生镜像。新实例 `secops-fusion-021` 在 3084，以独立 HOME 装载三棵只读 Candidate。平台经真实 UI 重启后，环境、HOME、来源和配置保持，见[重启证据](evidence/platform-acceptance/instance-restart-preservation.json)。

MCP 连接与资源范围通过实例的原生 MCP 配置界面保存，实际发现并选择 10 个工具、1 个资源和9个模板。Token 由插件读取，没有另设 `THREAT_ANALYSIS_MCP_TOKEN`。策略与应急原生确认的 HTTP 地址及测试签名环境使用声明的环境变量，因为该自定义确认边界不由 MCP 插件配置。实际主模型均为 `deepseek-official / deepseek-flash / off`。

## 真实业务观察

| 路径 | 实际观察及边界 |
| --- | --- |
| 给定材料整理 | 基础资产材料输出 JSON，零工具调用；没有以材料中的业务术语发起操作。 |
| 巡检及续查 | 目录→一次发起→同运行查询，3 个测试资产、`NORMAL`；同 Session 第二轮只有查询工具，未重复发起。 |
| 只读故障分析 | 子 Agent 使用 SOC 只读证据；资产路径可达不能证明 TCP443 放行，回答明确证据不足，没有变更或处置。 |
| 策略配置 | 实际解析端点、准备草案，经原生确认选择执行后仅更新 Mock 状态；另一次“服务器”多候选经原生单选确定源，草案选择取消。确认工具未开放给模型。 |
| 应急草案 | 生成基础主机模拟重启草案，原生面选择取消；没有真实设备操作。 |
| 快速研判 | 基础事件 000001 走 `fast_classification`，`llm_invoked=false`，固定摘要与 SOC/报告回执来自同一运行。 |
| 完整研判 | 基础事件 000002 走 `five_source`，实际调用 DeepSeek；可提取结论，输出校验 `failed`，未把状态 `completed` 当成质量通过。 |
| 研判后普通问答 | 第二轮恢复实际 DeepSeek 路由，没有再次委派、认领或复用固定摘要。 |
| 自动任务 | 自然语言实际创建 120 秒任务，受信 Schedule 空队列心跳完成；删除时暴露旧心跳劫持下一用户轮的问题；已改用本轮实际接纳的消息冻结触发，最终真实心跳完成，随后同一旧历史 Session 仅调用 schedule_list/schedule_delete，回到 deepseek-flash/off 并成功删除任务。首次失败及[最终复验](evidence/automation-delete-final.json)均保留。 |
| 语音摘要 | 浏览器共用原生 remote.mux 收到摘要；普通回复约870ms、首轮固定交付约923ms，后者保留“取消、未准备、未提交、未执行”。真实 TTS 不可达，页面明确跳过播报，未完成音频验收。 |

[首轮技术 Run](../runs/run-8350ed24-963c-4c44-a1f9-d5ef7c9efe7e/report.md)已封存，记录11项试次，其中只有缺失 ID 原样输入判通过，其余基础 Mock 变体为 `inconclusive`；没有把改过资产或事件 ID 的输入当作原 Case 通过。期间语音修复、环境及实际输入差异均在 Run 缺口中记录，不能用于跨版效果比较。后续[首轮固定交付摘要](evidence/zeroheader-voice.json)、[原生端点选择](evidence/policy-selection-ui.txt)及[报告整改后的 E2E](evidence/post-report-e2e/acceptance-final.json)作为独立观测，不倒改封存 Run。

## 报告与 Mock 边界

报告服务始终只提供基本模拟数据。首次下载的三个旧模板缺少本次身份，该失败在 Run 中保留；Mock 随后改为按已接受的回写关联安全元数据，绝不保存或反射上传的任意 HTML、摘要或 `resultJson` 自由正文。实际保存回执明确 `originalContentStored:false`，不是完整报告原文持久化。Mock 固定版本为 `50575526b05b303d39ccc3cd0bfa95fba3234128`。

独立新 Mock 下重新执行快速、完整研判和巡检，三报告均 HTTP200，运行、事件和路由或巡检任务身份匹配。首次手动 fast 被残留自动任务抢先认领，失败与后台成功回执保留；原生 UI 删除测试任务后，在另一全新 Mock 中补验手动 fast，通过且原 Token、20项选择不变。没有清空共享53001、旧53002或失败试次的数据。完整路径的校验仍为 `failed`，具体错误见上述 E2E 证据，不声称研究质量通过。

## 回归与结论限制

平台184项、工具链195项、Candidate Node40项和 Python11项通过；语音全套33个脚本通过，包含6项正式交付摘要与9项延迟/PCM反例。语音测试环境按生产依赖树加可信已有构建器运行，生产装载另外在标准镜像、无开发依赖下验证。Mock全套137项通过；独立真实MCP保存→下载也通过，见[安全报告边界](evidence/mock-report-boundary/result.json)。

首次错误Python/Node环境及预览脚本失败保留，使用系统Python3.10与Node24的最终统一工具链195项通过。组件测试不代替实机；平台验收、浏览器范围、未制造的在线发布竞态以及原始脚本限制均见[平台证据](evidence/platform-acceptance/acceptance-final.json)。

当前证据支持两来源能力在基本 Mock 下共同工作，并支持已确证实施缺陷的整改；不支持总体摘要性能改善、所有原 Case 通过、真实 SOC 判断正确性、真实语音效果或生产可用性。既有响应规划的受信入口和其他历史业务分支未逐项重跑，本轮只核对继承及直接受影响边界。没有创建 Research Release，也未切换原3081实例。

本轮暂存差异的20处空白告警均逐行核对为主来源已存在的内容（含第三方制品）；没有为了通过空白检查改写继承内容，见[来源核对](evidence/whitespace-origin.json)。本次实际修改块的差异检查通过。
