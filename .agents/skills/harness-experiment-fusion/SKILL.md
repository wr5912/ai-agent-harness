---
name: harness-experiment-fusion
description: 在 Research Mode 中融合两个或多个并行 DSH Harness Experiment，建立独立 Candidate，并验证各来源能力在同一实例中生效；不用于单一 Experiment 的普通修改。
---

# 并行 Experiment 融合

沿用 `$harness-guided-workflow` 的任务入口、`$harness-evolution` 的单一 Baseline 和 `$research-eval` 的观察与 Decision。融合仍是一项新的 Experiment，不覆盖来源，也不增加第二套资产模型。

1. 固定每个来源的 Experiment ID 与可恢复的 Git 提交或 Research Release；选一份主来源作新 Candidate 的基础。在 `hypothesis.md` 记录其他来源、要保留的能力和版本引用。
2. 比较共同修改的文件和装载链：源码与生成制品、Preset、插件注册及 Node 依赖、MCP 工具范围、Runtime 锁和镜像指纹、启动 patch、Web profile、卷挂载、实例设置。对冲突逐项写清保留、替换或舍弃的取舍；来源不固定或重复注册未解决时，不宣称融合完成。
3. 建立独立、自包含的 Candidate；从源码重建受影响制品。运行 `validate_repository.py`、`validate_experiment.py`、`test_source_contract.py`、`test_dsh_dev.py` 及受影响插件的测试；复用 `dsh-dev` 启动前依赖检查和 `verify-load` 的 `config_markers`，把两边选定能力的关键注册项列入来源合同。无需为融合另造可编辑清单或通用生成器。
4. 在新实例、新 Session 中验证两边各一项有区分力的能力及一项组合场景。Web 能力从用户实际访问地址检查；涉及模型设置、MCP 管理或语音时分别核对对应页面、真实工具和识别/播报。保存成功、HTTP 200、静态标记或插件加载都不替代实际行为证据。
5. 将实际观察、失败和未测范围写入该 Experiment 的 Evaluation；按证据作 Decision。真实 MCP 服务、模型或语音不可用时，明确限定结论，不推断业务效果。

只在现有命令无法重复检查某个确定性依赖时，才补最小辅助脚本；语义冲突始终通过实际行为验证。
