# 摘要播报延迟整改观察

整改基于远端 `main@8416a373f89ffeec4b611f5a1419513b41cee5bb` 和 EXP-019 完整 Candidate。原工作树未覆盖；开发分支为 `fix/AGENT-security-operations-expert-speech-latency`。本轮涉及 PA-04/05/06/07/08/10，不提升项目路径状态。

## 根因与对应变化

| 实际代码路径 | 原有等待原因 | 本次整改 |
| --- | --- | --- |
| `src/speech-summary.ts` | 辅助调用没有选择推理档位，继承路由默认；输出无专用预算 | 从 `resolveModelInfo` 获取能力，只为摘要选择 off/none，无法关闭时选公开最低档；输出预算按字数约束 |
| 同一会话摘要队列 | 没有独立总时限，上游不响应取消时后续摘要持续积压 | 每项包含排队的总时限 15 秒；超时释放队列并拒绝迟到结果 |
| 辅助流消费 | 已收到成功 finish，仍等待整个迭代器和连接清理 | finish 后立即发布可见摘要，清理不再增加发布等待 |
| `src/tts-remote.ts`、`src/tts-queue.ts` | 远程 PCM 全部收齐后打包 WAV，再发送；重试扩大等待 | 对齐 PCM 即时下发，首包 10 秒、流中空闲 5 秒上限；摘要不反复重试，流中失败不整句重播 |
| 远程 TTS 的 HTTP 请求 | 自动 gzip 压缩可能缓存 PCM 首段，即使 HTTP 200 已返回仍没有音频 | 请求 `Accept-Encoding: identity`，以真实压缩流回归验证首段不再等待整句 |
| `src/client.tsx` | 客户端等待 final、整句拼接与解码 | Web Audio 直接调度 PCM；按句保持顺序，取消代次贯穿浏览器；无 Web Audio 时仍可收齐生成 WAV |
| 诊断链路 | 只看到总等待，无法区分主流收尾、摘要与合成 | 关联来源消息，分别记录主流收尾、提交、摘要排队/生成、TTS 排队/首包及浏览器起播 |

主 Session 调用没有新增摘要策略或输出上限；只读监听其时序。单次手动朗读仍读取全文。当前 Qwen 自定义路由补齐公开能力和 `qwen-chat-template` 声明，保留已记录的主调用 xhigh 默认值；该本地服务本轮未启动，实际服务器行为未验证。新增模型依赖 DSH 对该路由的真实能力和协议声明，能力未知时不会宣称关闭已生效。

## 机器合同与来源

插件构建、服务端/客户端 TypeScript 检查、全部 32 个测试入口通过；新增延迟测试 9 项及实际客户端让位处理 7 项通过。覆盖成功 finish 后慢清理、非协作取消、排队时限、半个 PCM 采样、首段提前转发、部分流失败不重播、独立会话取消、交错音频句序、WAV 后备和关闭请求后仍有推理的诊断。构建、测试和仓库合同原始输出保存在[预检证据](../runs/run-4152be01-3020-4424-8cb7-1a58ca8cb755/evidence/preflight.json)旁；预检冻结后继续修正客户端，因此该 Run 明确取消，不作为最终 Candidate 验收。

[继承检查](evidence/inheritance.txt)核对父 Candidate 的 200 个文件，缺失 0、变化 18；退出码 1 表示这些必要变化待审查，不表示文件遗失。变化限于本轮功能源码、对应构建产物、测试、说明、Qwen 声明和 Experiment 身份；原有 Preset、Guard、MCP 与工作区资产完整保留。

[协议截获证据](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/reasoning-wire.json)使用 Runtime 锁定提交 `21638c56315ae6a2b552d6091945d3144c9af32e` 标准镜像中的真实 pi-ai 0.85.1 及官方 DeepSeek 适配器，无模型网络请求：DeepSeek Chat Completions 与 Messages 的 `thinking.type=disabled`、千问云端 `enable_thinking=false`、千问本地 `chat_template_kwargs.enable_thinking=false`、通用 `reasoning_effort=none` 均通过，同时检查主调用思考设置保留、128 token 预算及厂商字段不混发。这证明请求构造，不能证明远端服务执行了参数。

## 原生 Runtime 与浏览器比较

已按全仓锁重建[标准镜像](evidence/image-build.json)，没有制作插件派生镜像。隔离实例使用相同镜像，Candidate 插件、业务工作区及依赖只读挂载，运行 HOME 在仓库外。实际镜像、入口、挂载与配置见[运行来源](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/runtime.json)。测试使用受控模型和 24 kHz 测试音调，真实 LLM 密钥没有传入容器。

第一次浏览器执行暴露并保留了[失败 Run](../runs/run-7a28e33d-83e4-4289-a6ac-2e2622c455e8/report.md)：模型已经正确生成 off/128 token 摘要，但 gzip 压缩使 TTS 首段迟迟无法被消费。对同一原生 HTTP 端点的[压缩诊断](../runs/run-7a28e33d-83e4-4289-a6ac-2e2622c455e8/evidence/compression-diagnosis.json)显示默认请求头在 2 秒内未取得音频，identity 请求约 4ms 取得 4800 字节；该值是本地探针首段耗时，不是真实语音服务或模型速度。

整改后的[浏览器主链路](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/browser/live/live.json)核对：摘要 off、主调用 high；TTS 服务保持 HTTP 响应未结束时，浏览器 AudioContext 的时钟已经到达已调度音源的开始时刻；摘要文字与合成输入一致，原生与语音流共用 `/api/remote.mux`。实际设置页修改对下一条摘要生效；关闭播报、新回合、显式打断、切换会话、断线取消和重连仅接收未来事件均通过，页面错误为零。

同镜像下的[原版对照](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/browser/baseline/baseline.json)复现辅助调用继承 high，并在 TTS 响应保持打开时不播放、释放响应后才播放。这里“首包”指测试服务已经开始写响应，不声称原版客户端已读到 PCM，也不单独量化 gzip、服务端整句缓存和客户端整句缓存各自的贡献。

隔离实例首次启动遇到测试挂载目录缺失、临时目录原生加载限制和核心依赖路径问题，均修正在仓库外的测试启动配置，未修改 Runtime 源码。一次冷加载探针早于监听就绪而连接拒绝，保留在最终 Run 的 `evidence/browser/cold-startup-race/`；等待实际端点就绪后重跑。最终成功记录与前置失败各自保留，不覆盖事实。

[最终 Run](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/report.md)的 U-VOICE-002/003 在上述受控范围通过；[历史冷加载](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/browser/cold/cold.json)、[无插件](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/browser/absent/absent.json)和[实际卸载](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/browser/unload/unload.json)均通过，页面错误为零。最终加载资产的 workspace、presets、managed 文件摘要与 Run 冻结输入一致，构建、类型检查和 32 个测试入口再次通过，见[汇总及原始日志入口](../runs/run-26bf374a-4cfc-4f30-9dcf-d05a8b892b81/evidence/verification.json)。

测试完成后已停止 `voice-latency-exp020`（原测试端口 3386）与 `voice-latency-baseline`（原测试端口 3387），两者均为 exited、PID 0，见[停止状态](evidence/runtime-stop.json)。运行 HOME 和 Session 留在仓库外，没有回流 Candidate；其他容器和原工作树保持原样。

## 真实 DeepSeek 与服务限制

[真实文本比较](../runs/run-36bf0c84-678c-45c2-9e40-f5876e2c4586/evidence/deepseek-summary.json)读取 U-VOICE-004 三类事实，每类各执行三次原版与整改版，共 18 次；使用相同 `deepseek-flash`、相同摘要提示词、实际两个版本的 `SpeechSummaryQueue`，交替版本顺序。HTTP 是此比较的外部适配边界，不冒充完整 Runtime 运行。原版继承供应商默认推理和预算，整改版发送关闭思考和 128 token 预算；密钥只从被忽略的本地文件读取。

18 次均收到 HTTP 200，但在各自期限内没有可见正文；单独连通性探针观察到 SSE 保活注释。原版 9 次触及测试看门狗 45 秒，整改版 9 次在约 15 秒跳过，成功摘要均为 0。两组等待中位数约为 45001ms 与 15001ms，这只是失败等待边界，**不是成功生成的提速数据**。无法评估 2 秒目标、语义保真或字数偏差，也不能据此确认供应商排队、负载或模型可用性中的具体原因。

另外以 Runtime 官方路由使用的原生 Messages 地址请求关闭思考，结果同样为 HTTP 200、保活消息和 15 秒无正文，见[原生协议连通性](evidence/deepseek-native-connectivity.json)。真实文本比较期间摘要组件与冻结输入中的摘要源码摘要一致；后续 HTTP 音频修正没有混入该文本比较。

当前配置的真实 TTS 在本机探测中连接失败，约 10.5 秒内未收到响应或音频，见[合成服务连通性](../runs/run-4152be01-3020-4424-8cb7-1a58ca8cb755/evidence/configured-tts.json)。这只说明本次执行环境的连接结果。按用户要求，本轮不启动或连接本地 Qwen 模型。真实首声 3 秒目标、模型对照改善比例、合成质量及物理播放听感均尚未验证。

DeepSeek 参数合同参照[官方思考模式说明](https://api-docs.deepseek.com/guides/thinking_mode)，具体生效仍以实际路由请求与返回观察为准。
