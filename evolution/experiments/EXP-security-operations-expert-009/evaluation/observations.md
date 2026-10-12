# Evaluation 观察

2026-09-29，试点对象为 `security-operations-expert` 的 `U-QA-012`；`U-QA-013` 用于检查证据不足时的根因臆测与中文回答。两题均来自唯一的当前 [`evaluation.md`](../../../../agents/security-operations-expert/evaluation.md)。各次比较使用 `deepseek-flash`、同一标准镜像（Image ID `sha256:7a3b6821bed818e492bf5f1c0c7930e2a4d8c52e3ccdeb2619fd42e3223b090c`）和相同冻结 Case；每次新建评测容器与 Session，Run 的 `git_version.dirty=false`。`run_record.py compare` 对下面两组新版基线与修订 Candidate 均返回 `comparable=true`，实际模型路由也一致。

| 阶段 | Run | 机器结果 | 原始回答人工复核 |
| --- | --- | --- | --- |
| 当前口径初次基线 | [008 / run-a6ae](../../EXP-security-operations-expert-008/runs/run-a6ae0c53-bd61-445e-8b0b-509ac2aa3c05/report.md) | QA12 失败，QA13 通过 | QA12 未给出完整比对方法；QA13 用英文回答，机器漏判。此 Run 早于确定性中文检查。 |
| 首版候选 | [009 / run-8486](../runs/run-8486d2c1-a5a7-4b28-82d7-bf4ef491e697/report.md) | 两题通过 | QA12 开头把无来源的回复称为“当前最新结论”，虽后文补充限制，仍有误导；随后收紧 Candidate 指令。 |
| 新版基线 | [008 / run-9083](../../EXP-security-operations-expert-008/runs/run-9083fb10-11a6-43bc-a569-8b6d2ae8dfdc/report.md) | 两题通过 | QA12 否认无依据的“最新”，但没有完整比较适用范围等四个维度；QA13 中文且未臆测。 |
| 修订候选 1 | [009 / run-16c0](../runs/run-16c0ae09-6ef8-494a-9b94-e3d12c6dccfd/report.md) | 两题通过 | QA12 从开头否认“最新”，明确列出发布日期或版本、范围、权威性、相关度和未执行核验；QA13 中文且未臆测。 |
| 修订候选 2 | [009 / run-51f8](../runs/run-51f836f1-f599-41e7-8702-3d44a56385c9/report.md) | 两题通过 | QA12 重复上述关键行为；QA13 中文且未臆测。回答有一处“与与”笔误，不影响本题判断。 |
| 来源回退 | [008 / run-f630](../../EXP-security-operations-expert-008/runs/run-f630f91f-09f1-4c12-bdb3-42f5b815cfdd/report.md) | 两题通过 | 工作区摘要恢复为 008 的 `sha256:16035458…`，不同于 009 的 `sha256:21c6d0b6…`；QA12 没有完整说明适用范围和权威性，QA13 无回归。 |

新版基线的两次 QA12 机器评审均判通过，但按 `evaluation.md` 的明确预期人工复核，均未完整给出发布日期或版本、适用范围、权威性、相关度四项；修订 Candidate 两次均给出。此处效果是**所选问法下的方法说明更完整**，不是实际检索、结论时效核实或整个 Agent 能力提升。模型输出有波动，样本仅有两次修订候选运行。QA13 的英文漏判已在共享评审入口增加“明确要求用中文但最后回答完全无汉字时判失败”的确定性检查；混合语言仍需人工审阅。

工具切片的重复摩擦来自两次真实查证：定位 008 的 QA12 基线与 007 历史 `U-INS-001` 时，手工至少需要在来源登记、当前 Case、`run.yaml`、`inputs.lock.json`、`results.jsonl`、`response.json` 和镜像证据之间跳转；`run_record.py index` 加 `show --case` 各需两条命令，并同时给出当前/冻结口径、原始回答、实际路由和证据路径。本机两次查询的 index 为 79.2/77.8 ms、show 为 104.8/82.7 ms。减少的是查找步骤；未测量人工阅读耗时，不能声称节省了具体分钟数。`compare` 直接标出是否可比和两侧原始回答，省去逐文件拼接。查询不另建可编辑研究库。

[`dsh-dev` 生命周期证据](evidence/dsh-dev-lifecycle-20260929.json)记录同一 009 来源的预览、启动、运行列表、认证 URL 探针、日志、只读挂载、宿主与容器 Prompt 摘要一致、替换及停止；缺少必填环境变量的替换请求在启动前被拒绝。所有实测 Run 的被测 Session 与评审 Session 身份可在各自 `checks.json` 和 `judge.json` 核对。评分参考目录没有挂入被测实例。回退通过重新选择 008 来源完成；不改写已封存 Run。

限制：本轮是 DSH Runtime API 路径，未执行这两题的浏览器交互；未提供真实相互冲突的外部资料，因而只验证无证据时的说明方式。评审与被测使用同一路由，机器判定仅作辅助；历史 Run 的评审代码版本不同，不能只比较机器通过数来归因。没有创建新 Preset 或 Research Release，故没有据此宣称 `PA-09/11` 完成。
