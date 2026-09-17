# ai-agent-harness 项目协作说明

## 语言

- 默认使用中文编写对话、计划、文档、代码注释和提交说明。
- 代码标识符、命令、日志、错误信息、文件名及第三方 API 名称保留原文。

## 项目使命与边界

- 本仓库是面向个人开发者的 DSH-only Harness 研究与资产管理仓库。核心研究是 Harness 改进、资产及演化管理、多 Variant 派生与比较；本仓库管理仅供容器内 DSH Agent Runtime 装载的 Agent/Harness 工程资产及相关证据。
- 可研究 DSH 核心机制和官方/社区插件；实现优先复用 DSH 现有能力与插件，再开发自定义插件。只有扩展接口确实不足时才考虑有记录、可回退的最小框架修改；DSH Runtime 源码不混入本仓库资产。
- 不在本仓库开发 DSH Runtime，不复制 Runtime 内部目录，不把会话、缓存、凭据或其他运行态数据作为 Harness Release。
- `agents/` 是待交付的业务 Agent 资产；`.agents/skills/` 是维护本仓库的 Codex 项目技能。两者不得混用。
- `.codex/` 和根级 `AGENTS.md` 只约束仓库研发协作，不是 DSH Runtime 策略、权限或生产资产。

## 开始工作前

1. 阅读 `docs/standards/SOURCES.md`，确认规范来源、版本、提交与摘要仍然匹配。
2. 阅读 `docs/standards/PROJECT-INTERPRETATION.md`，使用其中对 Baseline、Experiment、Eval Set、Release 和 DSH 装载的统一语义。
3. 按任务读取对应项目技能：旧资产使用 `legacy-asset-intake`；演进使用 `harness-evolution`；评估使用 `baseline-eval`；安全边界使用 `security-control-boundary`；交付审查使用 `delivery-review`；DSH 验收使用 `dsh-release-verify`。
4. 先检查 Git 工作树和现有资产。其他人的改动不得擅自覆盖、回退或混入当前工作。

## 规范权威与冲突处理

- 研发、评估、安全、交付和发布门禁以 `agent-engineering-spec` 锁定提交为准。
- 仓库拓扑以《Harness Repo 目录结构设计说明（v1.1）》为准；资产模型和生命周期以《Harness Asset Repository 规范（v1.0）》为准。
- `docs/standards/PROJECT-INTERPRETATION.md` 只解决上述来源应用到本项目时的空白或歧义。它不得降低任一上游硬门禁。
- 若来源之间出现无法按适用范围消解的实质冲突，停止相关晋升或发布，记录冲突并请求维护者裁决；不得静默选择较宽松规则。

## 资产演进不变量

- 从可核验的需求来源、`REQ-xxx` 和非目标开始。直接开发时确认全部项目特有 `AC-xxx`；关键不确定性的探索先固定判定标准、安全红线和已知 `AC-xxx`，进入正式开发/交付前补齐全部 `AC-xxx`。每个交付需求至少关联一个定义最低可接受任务结果的硬门禁。
- 项目特有验收标准的唯一事实源是具体 Agent 的交付记录模板一。`tasks/**/acceptance.yaml` 只能引用或生成投影，不得成为第二套可编辑阈值。
- 每项语义性 Harness 变更都建立 Experiment。路径字段使用 `direct` 或 `exploration`：只有会改变实施路线的关键不确定性才使用后者；探索样本不能形成正式交付结论。
- 研究实验可以停止、不采用或得出证据不足的结论，保留假设、变化、观察、失败原因和来源，不强制生成 Release。比较或派生用的研究快照必须保存可还原内容和来源/摘要；它不是正式候选基线，也不继承源的评估结论。选择正式交付时再执行完整冻结、自测、复核和发布门禁。
- 任一候选基线冻结项变化都生成新的 `bl-<UUIDv4>`；同一基线重跑只生成新的 `run-<UUIDv4>`，历史结果不得覆盖。
- 每个 Agent 只维护一个 Eval Set 事实源。`core`、`boundary`、`safety`、`regression` 是 `cases.jsonl` 的标签；smoke/capability 等只允许成为选择器或视图，不得复制 Case。
- 正式评估一般门槛为不少于 50 个有效 Eval Case 和 50 条逐条质量复核的实质不同 User Input。只有满足锁定规范全部条件的确定性或影响范围明确交付才可采用有限范围；无法证明时回退一般门槛。
- R2 只形成范围结论，不得表述为正式评估运行通过；R3 才能对完整冻结范围形成独立正式运行结论。
- 只有交付评估通过的同一候选基线可以生成 Release。Release 必须自包含、不可变、可校验，且包含兼容范围、评估报告和变更记录；Git Tag 不能替代 Release。
- `agents/<agent-id>/current/` 只在 Release 制品完成晋升后更新为同一内容摘要的校验镜像；这不表示已经完成 DSH 上线。生产 DSH 必须挂载具体 Release，不挂载可变 `current/`。

## 安全红线

- 归档、外部交付或旧 Harness 默认不可信。先做只读清点，不直接提取到仓库、不加载、不执行脚本、Hook、Plugin、Skill、Workflow 或配置。
- 不复制、提交或记录密钥、Token、Cookie、私有 URL、凭据文件内容及其他秘密；默认不回显。仅在操作者明确请求本地 DSH Web 当前进程认证 URL 时，可向其本地终端或其显式指定的输出通道展示完整 URL；不得写入仓库、状态文件、普通日志或评估证据。配置只引用运行时注入的环境变量或受控凭据标识。
- 不允许生产环境自修改 Harness。运行反馈和失败案例必须回到新的 Experiment、Candidate、Evaluation 和 Release。
- 隔离的 Authoring 容器可让 DSH 自组合、自修改当前 Experiment Candidate 的工作区行为资产；当前 Session 可实时观察新行为，但只算探索。受控 Profile、Guard 和 MCP 绑定保持只读，评估证据与旧历史不挂载，凭据只由受信 Runtime 注入而不作为 Candidate 资产。任何写入只形成待审 Candidate diff；进入核验态或正式评估前，须完成宿主侧校验和复核，再用新容器、新 Session 重建加载。不能自动冻结基线、改交付结论或生成 Release。
- 候选源码中的 Preset、Profile/Patch、插件和非秘密依赖声明可在实验范围内由研究者修改；当前运行容器中的受控配置仍只读。源码修改需经宿主侧复核、构建及新容器/新 Session 装载才能验证生效；插件已安装不等于已激活。
- 高风险动作必须由 Runtime 或服务端强制执行权限、审批、参数、租户、对象、数量、幂等和失败安全；提示词中的禁止语句不等于控制已经落实。
- 不创建空 Agent、空配置、空报告、空 Eval、空证据目录或占位平台。只有出现真实内容时才创建相应目录。
- 未经用户明确要求，不提交、不推送、不打 Tag、不删除或覆盖外部资产。

## 文件与命名

- Agent ID、技能名和普通目录使用小写 kebab-case。
- Experiment 使用 `EXP-<agent-id>-NNN`；稳定资产和 Release 使用 `<agent-id>-v<semver>`。
- 交付内容默认位于 `agents/<agent-id>/delivery/`：六项内容可合并为唯一 `交付记录.md`，或拆分为规范指定的六份文件；禁止同时维护内容重复的两种形态。
- 机器证据使用唯一 `delivery/eval/cases.jsonl` 和 `delivery/eval/results.csv`。大型或敏感证据外置时记录受控 URI、对象版本、SHA-256 和访问方式，不创建空替代文件。
- 受控规范原文禁止直接修改。上游升级时添加新版本副本、更新 `SOURCES.md` 并记录迁移影响；不得原地覆写后仍沿用旧版本和摘要。

## 变更与验证

- 先区分仓库治理变更、Agent 资产变更和 Runtime 运行变更；只有后两者影响冻结组合时才触发候选基线更新。
- 优先使用已有格式和简单脚本。除非真实瓶颈已反复出现且收益明确，不引入额外平台或复杂基础设施。
- 机器校验成功只表示已实现的确定性检查通过，不等于内容真实性、业务能力、交付评估或发布获准。
- DSH 验收前必须记录镜像版本或摘要、Profile、宿主机与容器挂载路径、挂载模式、启动方式、实际加载的 Release 摘要和停止方法。
- Candidate 容器的构建、Profile 展开或挂载测试只证明局部技术集成，不得写成 Release 验收或 R3 业务通过。Authoring 与 Verification 使用不同挂载模式；运行态 `$DSH_HOME` 是独立数据根，绝不随 Harness 资产归档。
- 运行验收必须通过实际对外协议和完整任务链，核对用户可见结果、工具行为、最终业务状态及必要审计记录；健康检查不能替代。
- 完成修改后检查文档链接、格式、配置解析、来源摘要、敏感信息和 Git diff，并清楚报告已验证项、未验证项与适用边界。
