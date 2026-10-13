# DSH 智能体运行管理平台设计方案

> 状态：当前已实现基于系统全局 DSH-Cordis 的最小只读资产平台；后续研究工作台和业务运行能力仍是设计方向。本文集中维护平台接入合同，当前验证状态见[项目验收矩阵](ai-agent-harness项目验收矩阵.md)的 `PA-12`。平台仍属于 Research Mode，不构成生产验收。

## 目标与适用阶段

长期目标是让研究者和后续业务使用者知道 DSH Agent 选用了什么 Harness、实际装载了什么、产生了什么结果，以及一次修改是否值得保留。近期先连接已有资产、Run、候选修改、评测和人工判断；持续业务服务出现后，再承担运行版本切换责任。

| 使用情形 | 进入条件与目标 |
| --- | --- |
| 当前 Research Mode | 用现有 CLI、Experiment、Run 和 Decision 验证 Harness 变化；必要的本地工具仍遵守当前合同。 |
| 已启动的最小工具阶段 | 当前研究者通过全局 DSH 打开仓库资产首页，确认 Agent、Experiment、Run 的归属和来源；后续操作按实际需求连接。 |
| 按需启动的运行平台阶段 | 独立用户、长期业务 Agent 或统一业务调用出现后，分别为实际启用的身份、会话入口和版本切换建立合同与验证。 |

当前最小工具阶段提供只读资产入口。它不以多用户、统一业务流量入口、生产发布或完整 Research Release 为前提；当前 [PA-11](ai-agent-harness项目验收矩阵.md#pa-11-research-release-打包解析与复现装载) 仍未实现。

## 当前最小平台接入合同

平台直接运行系统全局 `dsh`，使用 DSH 原生 Web Profile 和 Cordis 插件组合；本仓库不安装或复制 DSH Runtime。业务评测容器继续使用其独立的 `source.lock.json`，平台全局 DSH 的兼容性由 [`platform/plugin/package.json`](../platform/plugin/package.json) 的 `peerDependencies` 声明；启动器读取这份声明检查现场版本，不维护另一份平台版本锁。

```text
platform/
  profile/                  # 平台 Profile 与插件组合的可编辑来源
  dsh-platform              # 准备、预览和前台启动入口
  plugin/                   # TypeScript Host、客户端和构建入口
agents/                     # 已有业务 Agent 研究资料
evolution/experiments/      # 已有 Experiment、candidate 和 Run
```

`platform/` 集中维护平台启动约定、Profile 和独立的 DSH 插件包。业务 Harness 仍在各 Experiment 的 `candidate/` 维护。平台查询直接读取 `agents/` 与 `evolution/experiments/`；不另建 `platform/data/`、可编辑索引或研究数据副本。

平台 HOME 默认是 `$XDG_STATE_HOME/ai-agent-harness/platform/dsh-home`，未设置 `XDG_STATE_HOME` 时使用 `~/.local/state/ai-agent-harness/platform/dsh-home`。它与用户通常使用的 DSH HOME、业务评测容器 HOME 分开。

平台装载组合以仓库 `platform/profile/` 为唯一可编辑来源，`prepare` 将其物化到平台 HOME 的 `profiles/harness-platform/`。其中仓库 `cordis.patch.yml` 渲染为 `harness-platform.patch.yml`，`start` 通过 DSH 原生 `--patch` 装载；这些产物只是运行副本，不在那里修改平台组合。同目录的原生 `cordis.patch.yml` 仅在缺失时初始化为 `[]`，由 DSH 维护欢迎流程、模型设置等实例偏好；再次 `prepare` 和重启都保留这些偏好。Session、设置、缓存、附件与认证状态留在独立 HOME，不回流为平台源码或研究资产。

| 命令 | 行为 |
| --- | --- |
| `./platform/dsh-platform prepare` | 检查全局 DSH，安装平台插件构建依赖，构建 Host 与客户端产物，生成平台 HOME 内的 Profile；首次使用及插件源码修改后执行。 |
| `./platform/dsh-platform start --dry-run` | 只读预览全局 DSH 来源与版本、平台 HOME、Profile、插件路径和监听参数；不生成配置、不启动服务。 |
| `./platform/dsh-platform start` | 检查版本兼容性、构建产物、Profile 与端口，前台启动全局 DSH；默认监听 `127.0.0.1:3090`。 |
| `./platform/dsh-platform start --port 3091` | 显式选择端口并按同一合同启动。 |

启动器从自身路径定位仓库，可从任意工作目录调用。全局 DSH 缺失、插件产物缺失、版本不兼容或端口冲突时明确失败；不能把失败写成已启动。使用 `Ctrl+C` 停止，重新 `start` 复用同一平台 HOME。平台插件或 Profile 修改后重新 `prepare`，再停止和启动进程验证生效。认证交接使用 DSH 原生方式，认证链接、Token 和 Cookie 不进入普通日志或项目证据。

Host 通过受 DSH 原生认证保护的 `/harness-platform` 查询通道提供只读 `inventory` 操作。首页使用 DSH 原生 `main` 与 `sidebar.panellist` 槽位，显示 Agent、Experiment、Run 的清单、数量、所属关系及仓库来源，提供刷新按钮；数据为空和读取失败分别显示。客户端由 `esbuild` 生成符合 DSH ModuleLoader 契约的产物，并复用 DSH 共享 React。查询过程不执行业务 Agent、不写入研究资产，也不需要 LLM API Key。

平台工具的完成标准是：从准备、只读预览到真实启动，经原生认证打开页面并完成 RPC 查询，清单与仓库一致，刷新有效，停止和重启后来源一致。构建、HTTP `200` 和插件声明只能证明各自局部状态；实际证据集中写入 `PA-12`。这个最小工具不证明后述修改、评测、管理智能体或业务运行流程已经实现。

## 后续研究工作台与价值验证

后续研究工作台仍服务当前研究者。选择一个已有 Agent 和一项有原始证据的问题，将以下操作接成一条路径：

1. 明确选择 Agent、Experiment 和 Run，显示精确来源、Git 提交及 dirty 状态、实际装载记录。
2. 按场景查看完整 Case：当前 `evaluation.md` 定义、该 Run 冻结的输入和预期、实际输出、原始证据及已有归因分别标明来源。证据缺失时显示缺失，不用摘要补全。
3. 同时查看支持归因的失败、可能反驳它的成功观察与未覆盖 Case；执行是否完成、评判是否通过分别显示。
4. 在明确的 Experiment `candidate/` 中修改与问题相关的资产，复用现有评测入口运行所选 Case，生成新的 Run 并比较来源、观察、回归和限制；不覆盖历史 Run，不静默改变比较口径。
5. 由人将 `adopt`、`continue`、`reject` 或 `inconclusive` 及依据写入原有 `decision.md`。管理智能体可以帮助解释证据和准备修改，不能把推断写成事实、替人改评判标准或把研究判断当成业务发布许可。

计划中的 Agent 中心工作台将连接这条维护路径；当前只读首页仅提供资产清单和来源。需要真实业务任务入口时，再扩展任务视图。确定性选择、查看、执行与记录不依赖自然语言入口。界面读取现有 `evaluation.md`、Experiment、Run 和 Decision，不建立第二套可编辑 Case 库或建议库。

用一项真实研究任务验证：选择未串错来源，候选改动进入正确工作树，新运行确实装载该内容，失败和缺失如实呈现，并比原操作减少实际步骤或来源错误。首条路径证明价值后，再按复用需求用第二个 Agent 或另一种 Variant 检验；若只是给现有 CLI 增加维护成本，就停止扩展工具。

## DSH 组合、修改与技术接入

DSH 的 [Cordis 插件和 Profile 组合机制](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)是首选扩展点。对当前 Agent 显示 Profile、Preset、bundle、插件、适配器与相关覆盖的来源和作用范围；需要替换时先改明确的 Candidate，再核对配置声明、实际装载和用户可见行为。保存了插件选择不代表插件已经装载成功；Profile 的变化可能影响共用它的其他会话，应在适当的候选环境中验证。

| 变化 | 处理方式 |
| --- | --- |
| 任务内选择既有工具、知识源或执行策略 | 属于一次运行，保留必要记录，不为每次选择创建 Experiment。 |
| 修改 Prompt、Preset、Skill、插件配置、适配器或必要实现 | 写入业务 Agent 的 Candidate，按既有 Experiment、Evaluation、Decision 比较；评审或管理智能体自身的来源变化也须记录。 |
| 切换后续运行所用版本 | 工具阶段明确选来源并新建测试实例，核对旧行为是否恢复；长期业务版本切换按后述运行合同处理。 |

最小工具优先复用现有 Python/Shell CLI、来源解析、评测执行和 Run 记录。后续连接操作界面时，使用少量 DSH Client 视图与服务方法接入固定工具入口，核对其工作目录、参数、结构化输出、退出码、超时与取消结果；进程启动或页面返回不能代替操作成功。

新增自研实现遵循[工程语言取向](../AGENTS.md#工程语言取向)：研究与工具阶段的新功能、DSH 插件和适配器使用 TypeScript，界面使用 TSX。现有 Python 随实际变更的调用链逐步迁移；首个迁移切片须核对原 CLI、资产与 Run 语义，以及 TypeScript 源码生成的 JavaScript/ESM 能否通过现有只读装载路径进入 DSH，并用受影响的 Case 和新 Session 验证后替换旧实现。语言迁移不妨碍复用现有 CLI，也不要求改写 Harness 文档或第三方源码。

平台 Host 使用系统全局 DSH，由仓库 Profile 与 Cordis 插件定义装载组合。后续管理界面与管理智能体将调用同一组确定性服务，继续通过这一组合扩展；不复制 Agent loop，只有扩展接口经原型证明不足时，才考虑可回退的最小上游修改。一元 [Remote API](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/api-gateway.zh.md)用于管理操作，不能据此假定跨容器流式业务会话已经可用。

## 事实来源与按需能力

| 信息 | 事实来源与工具责任 |
| --- | --- |
| Harness 与候选修改 | Git 管理的业务资产和 Experiment `candidate/`；工具定位、修改与显示差异，不另存可编辑副本。 |
| 当前业务 Case | 每个 Agent 唯一的 `evaluation.md`；界面按场景读取。 |
| 历史输入、观察与评判 | 不可改写的 Run 快照、原始证据和场景分析；不能用当前 Case 定义覆盖历史口径。 |
| 假设与研究决定 | 原有 Experiment 和 `decision.md`；Research Release 仅在实际需要独立复用且实现后创建，不代表生产批准。 |
| 实际运行 | DSH、容器和运行存储的观测；标明观测时间，期望配置不能冒充实际装载。 |
| 未来业务版本与部署决定 | 有真实发布需求后才建立不可变运行版本及部署状态；决定记录与 Research Decision 分开。Session 原始记录留在运行存储。 |

能力目录只展示当前任务实际使用的 Skill、MCP、DSH 插件和适配器的来源、版本、依赖与作用对象；任务内选择既有能力仍属于本次运行，改变 Agent 配置才写入 Candidate，不直接热改运行实例。不预建通用商店、自动安装通道或依赖数据库，也不自动执行不可信插件。

业务知识保留原文来源和位置；当前运行事实查询确定性接口并标明时间；研究材料精确引用原始 Run；生成报告关联输入与证据，不自动升级为已核验知识。文档解析、检索、文件生成和外部业务工具在真实场景需要时接入现有服务或可选插件。业务工具的受理、完成、失败、超时和结果不明须保留各自语义；有外部副作用且结果不明时先核查，不盲目重试。

## 按需启动的运行平台

当前 [EXP-014 DSH Web MCP 管理插件](../evolution/experiments/EXP-security-operations-expert-014-r8b1bd54e8be7/hypothesis.md)已在单个 DSH 实例内提供服务器编辑、按工具分组的 MCP 链接和新会话装载。新增 OpenAPI 服务器时，插件根据 Web profile 中的规范地址动态生成 MCP tools/resources；现成 MCP 服务则保存 URL 和请求 Header。Web profile patch 是实例在线工作态，Experiment Candidate 的种子是新卷恢复的定稿配置。未来运行平台若需要统一管理多个实例，应读取 Candidate 与实例实际 profile，标明实际加载版本、差异及验证时间，通过现有 DSH 插件操作，不复制一套可编辑 MCP 清单。组链接由配置生成；统一 Token 在插件页面生成并保存在实例 Web profile，Candidate 种子不包含 Token 和凭据值。只有实际跨实例管理需求明确后，才决定统一页面、权限和运行状态存储的边界。

只有长期提供业务 Agent 服务、管理多个业务 Agent 或服务独立用户时，才按实际需要考虑单机 Docker、Agent 独立容器、统一业务入口和平台状态库等形态。每个实例使用自己的 Profile、只读 Harness 装载、运行配置和持久化卷；这隔离 Agent 实例，不自动隔离共享实例的用户。平台只记录必要的期望状态和决定，实际健康与装载来自 DSH 和容器观测；只有持久查询与操作状态确有需要时才评估 SQLite 等状态库，不把 `$DSH_HOME`、Session 或缓存打包成 Harness。

确需发布时，`HarnessVersion` 是不可变装载清单，固定 Git 来源、资产摘要、DSH 镜像、Profile/能力版本和非秘密运行配置。`Deployment` 只记录某 Agent 的期望版本、回退目标与决定；`Instance` 的实际状态仍由容器和 DSH 观察，不以期望状态代替。

若平台需要管理容器，独立执行器是接触 Docker Socket 的窄入口；管理智能体不能直接操作 Docker，也不接收凭据值到模型上下文。凭据遵循本仓库 [AGENTS.md](../AGENTS.md) 的现行边界，不进入普通日志、研究证据或生成的发布包。

统一业务入口只在多个长期业务 Agent 需要对外提供会话时建设。届时验证外部身份、Agent 选择、版本路由、流转发、取消、重连和会话粘性；不能把 DSH Web 的浏览器令牌当成多用户身份或跨容器服务凭据。受支持的会话入口不足时，再评估业务容器内的最小入口插件。

## 多用户数据边界与选型门槛

当前仓库是个人 Research Mode，没有按用户区分的身份、授权或数据隔离实现。[EXP-007 的自动化任务试验](../evolution/experiments/EXP-security-operations-expert-007/decision.md)只验证了任务创建、查看和删除。现有 [DSH Schedule](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/schedule/schedule/README.md)在一个 Host 内维护共享任务目录，任务绑定原 Session，`catalog` 可列出该 Host 的任务；它没有提供平台用户归属边界。在当前 JSON 后端和 `DSH_HOME=/var/lib/dsh` 的实例配置下，任务位于实例卷的 `storages/schedule.json`，Session 位于 `sessions/`。分文件、分卷或按 Agent 分容器只解决存放范围，不等于同一实例内不同用户之间的访问授权。

[EXP-007 门户 iframe 联调](security-operations-expert门户联调记录.md)是单操作者技术试点：门户菜单已指向独立 DSH Web，但门户 SSO、Session 与 Schedule 的用户隔离均未接通。它不改变未来统一入口与多用户授权的设计门槛。

若选择多用户共享 Host，Session、定时任务及执行历史应使用同一个经服务端确认的用户身份和对象归属；任务创建时绑定发起者与原 Session，后续访问不能只信调用方传入的 Session ID，也不能靠浏览器令牌或前端过滤。会话消息、附件与导出、任务列表与详情、创建/修改/删除、历史、模型工具和后台触发各有访问入口，须分别检查归属与执行上下文；Host 级 `catalog` 在完成隔离前不得直接对多用户开放。若无法可靠覆盖这些入口，再评估按用户分隔 Host 和运行卷，统一入口仍须负责授权路由；不能凭插件支持登录就推定 Session 和 Schedule 已隔离。

开放多人访问前，用两个用户在同一 Agent 下分别创建 Session 和任务，从界面与 Remote 入口交叉尝试读取、修改、删除及查看历史，检查模型工具和任务到期后的投递目标，并验证重启后的归属。失败就不能采用共享 Host；单人工具不因此预建角色体系或租户系统。

## 业务发布、回退与启用前验证

研究工具中的回退，是选择旧来源、启动新测试实例并核对旧行为；不改变长期业务流量。未来确需替换业务运行版本时，先固定可重建的版本和评估依据；关键行为评估失败或证据不足时不发布。由有权限的操作者显式确认，记录身份、版本摘要、依据与时间。Research Decision 不替代发布决定，管理智能体只能准备说明，不能自行确认发布。

本方案无需设计“灰度发布”：不设置流量权重或分批扩大流量的发布路径。发布时直接把**所有新 Session** 切到新版本，已有 Session 继续绑定原版本。观察实际健康与业务结果；效果不佳时将**后续新 Session** 切回旧版本，记录原因和结果。回退不能撤销已产生的回答或外部副作用，也不承诺无损迁移正在运行的 Session。旧实例保留到相关 Session 结束，且活跃定时任务停止或经验证完成迁移；不能恢复的会话要明示失败。

每启用一项运行能力，就验证其对应行为：多 Agent 实例与装载相互独立；业务入口经过真实会话、流与身份测试；发布和回退后的新 Session 确实进入期望版本，旧 Session 与任务按记录处理；重启后期望状态与实际状态可对账，原始证据和操作记录可追溯。容器健康或 HTTP 成功只证明局部状态，不代表这些路径完成。若研究工具尚未证明重复操作值得连接，就继续使用现有 Research Mode。
