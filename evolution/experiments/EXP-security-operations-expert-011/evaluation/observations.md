# Evaluation 观察

2026-10-08，以 EXP-008 Candidate 为起点，在真实 DSH Web 评测实例 `security-operations-expert-exp011-ui`（本机端口 3185）验证 EXP-011。参照对象仅为 AI Console 的“智能对话”页；本 Candidate 初版把参照页使用的品牌标志和 AI-SOC 头像保存为 [`logo-v1.webp`](../candidate/dsh/managed/security-operations-ui/assets/logo-v1.webp) 与 [`agent-avatar.png`](../candidate/dsh/managed/security-operations-ui/assets/agent-avatar.png)。当前 Web 插件头像改用 [`live-chatbot.gif`](../candidate/dsh/managed/security-operations-ui/assets/live-chatbot.gif)，这些资源从 Harness 资产目录内嵌加载，不请求参照站点。

| 范围 | 真实环境观察 | 证据 |
| --- | --- | --- |
| 镜像和装载 | 锁定 DSH 提交 `21638c56315ae6a2b552d6091945d3144c9af32e` 构建成功；实例使用镜像 `sha256:a283e19474b2606d6623d1992638fc94ae49263bf14e6f40b38d3e716c21ba74`，构建指纹为 `sha256:cd699270959430ac07e68231f928420e0db5f0b5aa0954603daece6b47d27881`。 | [构建记录](evidence/dsh-image-build-20261008T102420Z-820988.json) |
| 桌面与窄屏效果 | 浏览器显示本地品牌图片、AI-SOC 头像、六张推荐卡片、两张数字员工卡片、推荐／数字员工／收藏页签及系统消息面板；390px 宽度无横向溢出，图片解码成功，检查时无浏览器脚本错误。 | [桌面截图](evidence/web-desktop-20261008.png)、[窄屏截图](evidence/web-mobile-20261008.png) |
| 页面交互 | 推荐与数字员工搜索可过滤卡片；点击推荐或数字员工卡片只写入 DSH 原生输入框草稿。新会话没有收藏时显示空状态；在 DSH 原生会话列表置顶后，收藏页出现该会话，点击可返回原会话。右侧状态面板在对话完成后显示完成。 | [收藏截图](evidence/web-favorites-20261008.png)、[对话截图](evidence/web-chat-20261008.png) |
| 真实对话 | 在同一实例的新 Session 中发送“请用一句中文说明你是哪个智能体，不调用工具。”；本地 Qwen 模型返回“我是运行在容器内 DSH 的防御性网络安全运营专家智能体。” | [对话截图](evidence/web-chat-20261008.png) |
| 语音功能补验 | 原实例未挂载插件依赖，`voice-mode` 因无法导入 `@deepseek-ai/schemastery` 而未激活。独立实例 `security-operations-expert-exp011-voice-1008`（3205）使用同一标准镜像和只读 `managed/` 挂载，未传 `--plugin-node-modules`；浏览器通过本机 3192 端口的 HTTPS 入口进入安全上下文。Chrome 虚拟麦克风播放合成语音后，页面显示转写草稿，说出“确认发送”可发送不含口令的消息，Qwen 在新 Session 中回复。点击回复的朗读按钮后，浏览器调用 `decodeAudioData` 和 `AudioBufferSourceNode.start` 各一次，页面未报脚本错误。 | [语音对话截图](evidence/voice-e2e-20261008.png) |
| 威胁研判数字员工 | 显式浏览器 Run `U-THREAT-MENTION` 通过：父 Session 调用 `delegate_threat_analysis` 并原样传递事件 ID，子 Session 调用 `analyze_threat_incident`，回执与答复一致。 | [Run 报告](../runs/run-d6fe4696-6ee4-41ce-876d-718a5ce3e18f/report.md) |
| 故障分析数字员工 | 卡片插入 `@故障分析子智能体`，浏览器中可见子智能体的故障分析答复；但浏览器评测等待父 Session 完成时，180 秒和 300 秒两次均超时，没有封存完整轨迹或语义结论。 | [首次 Run](../runs/run-d6fe4696-6ee4-41ce-876d-718a5ce3e18f/report.md)、[复测 Run](../runs/run-4d4e6f9d-eac3-46f4-9b9a-8fec14ae8c85/report.md)、[超时截图](../runs/run-4d4e6f9d-eac3-46f4-9b9a-8fec14ae8c85/evidence/U-FLT-MENTION/failure.png) |

2026-10-08 修正空会话欢迎区的样式选择器并替换头像后，在运行中的 `security-operations-expert-exp011-voice-1008` 实例使用 Chrome 复核：“探索未至之境”和“预览版”均已隐藏；欢迎区和两张数字员工卡片均显示动态 GIF，图像解码和动画正常，点击卡片仍可把子智能体名称写入草稿。见[本次界面截图](evidence/web-live-chatbot-20261008.png)。

首轮浏览器 Run 因 Candidate 的本地模型 URL 重复 `/v1` 而停止，修正后下一轮因评测器误选子 Session 导致身份／证据失配；两次诊断分别封存在 [首次 Run](../runs/run-79499894-4f2a-48d2-a93b-ffe83174fb3d/report.md)和 [第二次 Run](../runs/run-fb2d26cc-6c29-4cf1-9912-8de3d194e704/report.md)。评测器现按父 Session 筛选新建会话；上述失败记录未改写。`U-FLT-MENTION` 仍以无法判定保留，不将截图中的子智能体答复冒充完整父会话结果。

构建流程给构建输入指纹派生独立镜像标签，避免不同构建输入争用同一标准镜像标签；TUNA、npmmirror 和 pnpm 缓存用于本次真实构建。已验证一次镜像构建及其身份，未做两人同时构建的压力测试，也不以单次耗时声称速度收益。界面复刻覆盖任务要求的主要布局与入口；DSH 原生侧栏和输入框保留自身样式，没有逐像素对齐参照页。其他推荐卡片对应的外部 MCP 业务结果、本次故障分析父会话完成行为及所有模型条件下的稳定性，尚无完整端到端证据。

语音补验使用浏览器虚拟麦克风和合成语音；识别结果有个别字词误差，首次发送的完整消息为“这是语音测试。”，没有把“确认发送”写入消息。物理麦克风、扬声器听感及浏览器对自签名证书的首次信任流程未验证。此补验是独立技术观察，未作为 `U-VOICE-001` 的封存 Run 或所有语音场景通过的结论。

2026-10-08，在运行中的 `security-operations-expert-exp011-voice-1008` 实例使用全新 Chrome 浏览器环境复核工作区视图：首次打开时，“单列表”在“视图选项 → 分组方式”中显示选中，持久化的 `groupBy` 为 `flat`；手动改为“按工作区”后刷新，`groupBy` 仍为 `workspace`。此修改只作用于尚无工作区视图记录的浏览器；已有记录保留用户原先的分组选择。插件本地构建、类型检查和界面测试通过。
