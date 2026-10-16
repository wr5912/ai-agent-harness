---
name: task-builder
description: 根据用户任务复用能力、装配 DSH 智能体，通过固定业务测试、最多三轮修复和真实实例产物完成交付。
---

# 构建并交付任务型智能体

保持平台管理身份。用户要的是可使用的业务结果。先用 `platform_agents context/list/detail` 和 `tasks/capabilities` 查询已有任务、固定来源、Skill、Plugin、工具及评测，不重复询问已知信息。只对会改变业务目标、必要输入、验收方式或外部权限的缺口集中提问。现有配置名称只能说明已配置；实际装载、调用和当前业务验证必须分别取证。

## 提出并确认任务

使用 `platform_task preview`，再用相同计划 `start` 显示原生确认卡。确认卡返回实际结果后连续执行，不重复要求用户确认范围内动作。计划包括：

- `goal`、`agent_id`、`kind`（inspection、business、training）、`deliverables`、目标 `instance_name`。
- 巡检任务必须提供 `inspection:{expected_device_ids:["设备ID"]}`；服务端固定该集合，交付时不可缩小范围。可用 `artifact_paths:["artifacts/inspection-report.md"]` 固定业务产物路径，不使用评测报告代替。
- 已有待研究 Candidate 用 `source:"experiment:<ID>"`；新建任务用 `new_agent:{name,description,role,evaluation_cases:[{id,title,inputs,expected_behavior,fast}]}`，不同时提供 source。业务 Case 至少验证真实任务和重要失败边界，不用身份测试代替业务质量。
- 改进已启用智能体时，在允许动作加入 `agents/create`，source 作为固定父版；服务端使用已核对的 `derivation.parent_ref` 派生并以真实回执绑定新目标，保留原启用版本。已有独立探索 Candidate 可以直接作为目标。
- `evaluation_case_ids` 固定测试及必要回归。创建回执后服务端一次绑定目标并冻结口径；后续修复不得修改 Case 或把失败回答改成标准答案。
- `allowed_actions:[{domain:"agents",action:"new"},{domain:"agents",action:"tasks/assembly-apply"},{domain:"agents",action:"edit/apply"},{domain:"agents",action:"eval/start"},{domain:"agents",action:"eval/cancel"},{domain:"instances",action:"run"}]`，只列本任务必要动作。
- `budget:{max_repair_rounds:3,max_model_calls:60,timeout_minutes:30}`；真实训练任务最长 60 分钟。初测不计修复轮；Goal 的续轮数与业务修复轮数不同。助手模型调用包括本会话的规划调用，由服务端逐次计数；外部评测消耗和是否硬封顶依据真实回执说明，费用、Token 或调用未知时不能宣称总成本已受硬限制。

## 装配、验证和限额修复

1. 新建用 `platform_agents new`；服务端从已确认计划取角色和业务 Case，绑定真实回执的目标。读取目标详情，后续不得操作其他 Candidate。已有智能体的语义改动先从固定来源创建独立 Experiment；不要覆盖已启用的原版本。
2. 从 `tasks/capabilities` 返回的真实资产选择复用；`tasks/assembly-preview` 预检，再 `tasks/assembly-apply`。复制引用与目标 Preset/Plugin 绑定要一并准备。只增加角色描述、复制文件但未绑定，不算能力就绪。工具接入使用现有 MCP 管理，凭据由原生配置维护，助手不读取密钥。
3. `eval/preview` 后 `eval/start {source,cases,mode:"fast",executor:"api",review:"none"}`，cases 与计划相同；用 `eval/status` 查询实际进度。初测保留完整 Run。不能把 HTTP 成功、模型声明完成或同模型自评分作为业务通过。
4. 有失败时读取 Run 输入、轨迹和实际结果，找共同原因。调用 `platform_task begin-repair` 持久预留一轮后再编辑 Candidate，随后复测失败项及约定回归。失败轮也计数；最多三轮，达到额度后保留失败证据并停止，不自增预算。不修改原 Run、不抹去失败；有回归时恢复本任务已验证修订，保留用户并行改动。
5. 任务卡可暂停、恢复、取消；重启后先查状态再显式恢复，额度不重置。外部动作回执未知时查询实际 job/实例状态，不重发写入；无法确认则如实停止并给出具体待核对对象。

有回归且起始 Candidate 有固定 Git 引用时，调用 `platform_task rollback`。服务端只恢复本任务实际修改过且当前摘要仍吻合的文件，读取完整固定来源并核对内容摘要；发现并行修改就拒绝覆盖。首次创建且没有固定可恢复父版的失败 Candidate 保持未交付，不影响既有已启用版本。

## 交付

使用约定来源创建或启动目标实例。通过实际新 Session 验证业务，读取实际报告或其他产物。调用 `platform_task deliver {run_id,artifacts:["当前Run内真实路径"]}`；服务端核验本任务 Run、冻结 Case、当前 Candidate、真实实例和可读取产物，返回 completed 后才能宣布已交付。

默认只告诉用户结果、实例入口、产物入口及影响使用的限制；失败告诉用户缺少什么、已保存什么、需要何种介入。Mock 明确标注模拟边界，真实训练缺算力或真实外部系统未验时单列待验收，不能用模拟结果代替。
