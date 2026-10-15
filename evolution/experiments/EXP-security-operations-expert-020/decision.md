# Decision：continue

保留本轮摘要专用思考策略、输出预算、含排队的独立时限、finish 后立即发布，以及 HTTP identity 和 PCM 首段播放整改。主调用保持既有有效设置。[最终 Run](runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/report.md)在受控模型、测试音调和真实浏览器范围通过 U-VOICE-002/003；[失败 Run](runs/run-7a28e33d-83e4-4289-a6ac-2e2622c455e8/report.md)保留了 gzip 缓存首段的实际发现，修正后重新执行，没有覆盖失败事实。

真实 `deepseek-flash` [比较 Run](runs/run-36bf0c84-678c-45c2-9e40-f5876e2c4586/report.md)共 18 次请求，全部在期限内无可见正文；当前环境真实 TTS 不可达，本地 Qwen 按用户要求不连接。因此本轮不能判断真实摘要 2 秒、首声 3 秒或改善 50% 的目标，也无法评估真实语义与听感。超时跳过是等待边界，不能当成成功生成提速。

模型和语音服务恢复可用后，以同一 U-VOICE-004 口径重新执行独立 Run，核对否定、风险和未完成状态、字数、逐段耗时、听感和播放中取消。新增模型先核对 DSH 路由公开能力和请求协议，不能宣称所有服务都支持关闭思考。完整继承的其他业务 Harness 能力沿用已有结论，本轮没有重评。

本轮只交付可复核 Candidate 与验证记录，不替换 Agent 当前来源、不创建 Research Release、不发布 npm 包。具体改动、来源和限制集中见 [Evaluation 观察](evaluation/observations.md)。
