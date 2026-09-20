# 迁移来源研究评估

- Agent ID：`security-operations-expert`
- Experiment：`EXP-security-operations-expert-001`
- 用途：记录旧 Harness 与初版交付材料能为后续研究提供什么；不是当前交付或生产结论。

## 已观察的来源事实

- 四个旧能力域的 200 条输入已迁移为待复核材料，Case ID 保留且无重复。
- 巡检、故障排查和策略配置的历史材料包含已记录失败；响应处置缺少真实 Trial。
- 旧 Prompt、权限配置、Hook、脚本和部署文件没有被直接执行或激活。

## 对研究的意义

旧需求、输入、行为说明和失败案例可以作为新 Experiment 的素材，但不能证明 DSH 行为等价。后续应从一个明确假设和少量有区分力的输入开始，按实际问题决定是否扩大覆盖。无需先补齐生产交付门禁。

## 已知限制

- 200 条输入仍需要按具体研究问题筛选和复核；旧 `synthetic_reviewed` 声明不能替代当前判断。
- 旧结果没有现行 Run 记录，不能据此声称 Candidate 已经验证。
- 真实模型、真实 MCP 和最终业务状态只在对应 Experiment 实际运行后才能判断。

## 历史正文索引

来源的 50 个文件均逐项列入摘要清单，但并非全部复制进仓库：非执行正文保存在历史目录，200 条 Case 转成待复核输入；环境、部署与测试脚本只保留摘要和处置原因。

- 响应处置 / `01_智能体需求定义.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/01_智能体需求定义.md`
- 响应处置 / `02_用户场景与输入覆盖矩阵.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/02_用户场景与输入覆盖矩阵.md`
- 响应处置 / `03_任务与评估数据集说明.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/03_任务与评估数据集说明.md`
- 响应处置 / `04_安全与控制边界清单.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/04_安全与控制边界清单.md`
- 响应处置 / `05_候选版本基线.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/05_候选版本基线.md`
- 响应处置 / `06_自测与交付评估报告.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/06_自测与交付评估报告.md`
- 响应处置 / `tests/README.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/response-disposition/tests/README.md`
- 巡检 / `01_智能体需求定义.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/01_智能体需求定义.md`
- 巡检 / `02_用户场景与输入覆盖矩阵.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/02_用户场景与输入覆盖矩阵.md`
- 巡检 / `03_任务与评估数据集说明.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/03_任务与评估数据集说明.md`
- 巡检 / `04_安全与控制边界清单.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/04_安全与控制边界清单.md`
- 巡检 / `05_候选版本基线.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/05_候选版本基线.md`
- 巡检 / `06_自测与交付评估报告.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/06_自测与交付评估报告.md`
- 巡检 / `README.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/inspection/README.md`
- 故障排查 / `01_智能体需求定义.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/01_智能体需求定义.md`
- 故障排查 / `02_用户场景与输入覆盖矩阵.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/02_用户场景与输入覆盖矩阵.md`
- 故障排查 / `03_任务与评估数据集说明.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/03_任务与评估数据集说明.md`
- 故障排查 / `04_安全与控制边界清单.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/04_安全与控制边界清单.md`
- 故障排查 / `05_候选版本基线.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/05_候选版本基线.md`
- 故障排查 / `06_自测与交付评估报告.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/06_自测与交付评估报告.md`
- 故障排查 / `tests/README.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/fault-analysis/tests/README.md`
- 策略配置 / `01_智能体需求定义.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/01_智能体需求定义.md`
- 策略配置 / `02_用户场景与输入覆盖矩阵.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/02_用户场景与输入覆盖矩阵.md`
- 策略配置 / `03_任务与评估数据集说明.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/03_任务与评估数据集说明.md`
- 策略配置 / `04_安全与控制边界清单.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/04_安全与控制边界清单.md`
- 策略配置 / `05_候选版本基线.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/05_候选版本基线.md`
- 策略配置 / `06_自测与交付评估报告.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/06_自测与交付评估报告.md`
- 策略配置 / `tests/README.md`：`evolution/history/imports/security-operations-expert-2026-09-15/delivery-docs/policy-configuration/tests/README.md`
