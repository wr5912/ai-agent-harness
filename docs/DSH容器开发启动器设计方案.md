# DSH 容器开发启动器设计方案

> 状态：`dsh-dev` 已实现 `image build`、`plan`、`up`、`ps`、`url`、`logs`、`down`，并提供**开发模式 `--mode dev`（出厂 Cordis 创造模式）**与**评测模式 `--mode eval`（被测智能体 preset）**：按来源选择器（`experiment:`/`snapshot:`）启动 host 网络实例（只绑定宿主回环）、渲染实例 Compose、挂载 harness 三树与 `/work/spec`、`/work/eval-input` 只读数据资产、按本次进程日志交付认证 URL 并做 Token→Cookie→根页探针（非交互输出须显式 `--non-interactive`）；`open`、`resume`、`fresh` 和 `release:<id>` 选择器仍是待实施合同。本轮实例级装载证据：[dsh-dev-live-load-20260918.json](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-live-load-20260918.json)。
>
> 范围：同一台 Linux Docker Engine 主机上的本地开发和候选技术核验。本文不设计生产部署入口，不改变 DSH Runtime 源码，也不替代 Agent 交付评估或 Release 验收。
>
> 依据：[规范来源锁定](./standards/SOURCES.md)、[项目规范解释](./standards/PROJECT-INTERPRETATION.md)、[当前 DSH 容器适配层](../runtime/adapters/dsh-container/README.md)。研发管理 CLI 是[另一项提案](./DSH智能体研发管理平台边界设计方案.md)，两者不共用命令、权限或运行态数据。

## 1. 要解决的问题与当前事实

开发者需要明确选择本仓库中的 Harness 来源和运行模式，快速启动容器内 DSH Web，并取得**宿主机浏览器可访问、包含本次进程 Token 的完整 URL**。启动器属于宿主侧开发工具；容器内运行的仍是锁定镜像中的官方 DSH，Harness 仍通过卷装载，`DSH_HOME` 仍是独立运行态数据根。

适配层提供 Authoring/Verification 两套受控 Compose（`dsh` 服务不发布宿主机端口、官方 Web 绑定容器内回环），`dsh-dev` 则按实例在仓库外渲染一份启用了 host 网络、只绑定宿主回环的实例 Compose。现有[技术预检](../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-web-technical-preflight-20260915T054223Z.json)验证过隔离环境内 Token 入口 `303`、取得 Cookie 后根页面 `200`，但没有验证本文拟议的 host 网络、真实模型/MCP 或完整业务任务。当前仍没有已晋升的业务 Agent Release。

锁定的 DSH 镜像身份见 [`source.lock.json`](../runtime/adapters/dsh-container/source.lock.json)。官方文档说明 `dsh web` 默认监听回环，支持 `--port`，并在启动后打印带进程 Token 的认证链接；Token 经根页面换取浏览器 Cookie。[DSH Web 应用说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md)、[DSH HTTP Server](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/web-server)。官方在线文档可能随版本变化，实施时仍须在本仓库锁定镜像上实测参数与链接格式。

## 2. 组件、数据与网络边界

```text
开发者终端 ── dsh-dev（宿主侧，拟议） ── Docker Compose
                                         ├── home-init：network_mode: none
                                         └── dsh：network_mode: host
                                              ├── Web 监听宿主回环 127.0.0.1:<port>
                                              ├── Harness 资产按模式挂载
                                              └── 独立 DSH_HOME 数据卷
宿主机浏览器 ── 带 Token 的本次启动 URL ──> DSH Web
```

仅启动器管理的**本地开发实例**把 `dsh` 服务设为 `network_mode: host`，显式使用 `--host 127.0.0.1 --port <port> --no-open`；`home-init` 继续无网络。host 模式不能再配置 Compose `ports:`，容器监听的回环端口就是宿主机端口，无需转写 DSH 打印的 URL。[Docker host 网络](https://docs.docker.com/engine/network/drivers/host/)、[Compose 网络模式](https://docs.docker.com/compose/how-tos/networking/)。启动器不得把监听地址扩展为 `0.0.0.0`，也不得将该网络模式默认为生产装载方式。

host 网络消除了此处的回环可达性问题，**也消除了容器与宿主机之间的网络命名空间隔离**：容器内代码可访问宿主机回环服务，Candidate 自修改或不可信输入可能扩大影响；其他 Plugin 新增的监听口也可能出现在宿主机。文件只读挂载、`cap_drop` 和 Web Token 不能抵消这项网络权限。实施前应清点目标主机上不可暴露给该 Candidate 的服务和实际出站路径；无法接受此风险时，不启动 host 网络实例，而不是宣称其已被 Token 消除。`home-init`、受控 Profile/Guard/MCP 挂载、容器用户、只读根文件系统与不挂 Docker Socket 的现有控制保持不变。

| 来源与模式 | 默认 Agent preset | 工作区 | Preset/managed | 只读数据资产 | `DSH_HOME` | 结论边界 |
|---|---|---|---|---|---|---|
| `experiment:<id>` + `dev`（内部 authoring） | 出厂 `cordis`（创造模式，第二层 `--patch` 开发层） | 该实验独立工作区 RW，至少保证同一工作区单写者 | RO | `/work/spec`、`/work/eval-input` RO | 该实例专用数据卷 | 只供隔离探索；创造模式会话等同 shell 权限且无 Guard 约束，必须显式 `--accept-cordis-trust`；源码变化显示为 dirty，不使实例身份自动失效。 |
| `experiment:<id>` + `eval`（内部 verification） | 被测智能体 `security-operations-expert` | 可变宿主候选 RO | RO | 同上 RO | 该实例专用数据卷 | 只供局部技术核验；非冻结来源不得作为正式评估结论。 |
| `snapshot:<immutable-ref>` + `eval` | 同上 | 已物化研究快照 RO | RO | 快照内 `spec`/`eval` RO | 全新的数据卷与 Session | 只供候选技术核验或研究比较；快照包含实际可恢复字节，不跟随原 Candidate 目录变化。 |
| `release:<id>` + `eval`（后续扩展） | 具体 Release 声明的 preset | 全部 RO | RO | Release 内声明只读 | 新数据卷 | 只供本地装载检查，不表示生产部署；当前尚无此类 Release。 |

不得把 `current/`、仓库根目录、**评估结果与证据**（`runs/`、`evaluation/evidence/`）、交付结论、历史归档或开发者个人 DSH_HOME 当作启动来源；允许只读挂载的只有 Agent 级事实源输入（`agents/<agent-id>/spec`、`agents/<agent-id>/eval`，研究快照来源为其快照内副本），它们分别投影到 `/work/spec` 与 `/work/eval-input`，不进入工作区树摘要，也不因此获得任何执行权限。当前适配层的 `experiment:<id>` Verification 仍只读绑定可变宿主候选，仅能提供局部技术检查；用于研究比较和正式评估的 Verification 必须先从真实内容物化冻结副本，防止宿主或另一实例在运行中改变来源。Authoring 与 Verification 不复用 Session；正式评估还须按[项目规范解释](./standards/PROJECT-INTERPRETATION.md#7-dsh-双平面与挂载契约)补齐完整候选基线、复核 Candidate diff，并用新容器、新 Session 重新加载。启动器不自动形成正式 Baseline、不运行 R3、不生成 Release。

## 3. `dsh-dev` 命令合同

可执行入口为仓库内 `runtime/adapters/dsh-container/dsh-dev`，文中的 `dsh-dev` 表示开发者把该目录加入 `PATH` 后的命令名；直接调用时使用 `./runtime/adapters/dsh-container/dsh-dev`。只依赖 Python 3 标准库、Docker CLI 和 Compose，不在容器内安装管理工具。下表命令中 `image build`、`plan`、`up`、`ps`、`url`、`logs`、`down` 已实现；`open`、`resume`、`fresh` 尚未实现。

```bash
dsh-dev image build
dsh-dev plan --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3084
dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3084 --accept-cordis-trust
dsh-dev up --source snapshot:<immutable-ref> --mode eval --name secops-eval --port 3085
dsh-dev ps
dsh-dev url secops
dsh-dev open secops
dsh-dev logs secops
dsh-dev down secops
dsh-dev resume secops
dsh-dev fresh --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-new --port 3086
```

| 命令 | 行为与输出 | 必须避免 |
|---|---|---|
| `image build` | 调用现有锁定来源构建脚本，报告镜像 ID/版本。 | 隐式拉取其他 DSH 版本或把本地标签当不可变身份。 |
| `plan` | 只读解析来源、镜像、模式、挂载、环境变量**名称**、端口及风险，检查来源/端口/实例名；输出脱敏计划。 | 创建容器、数据卷、基线或打印变量值/Token。 |
| `up` | 再次检查计划条件，使用隔离 Compose 项目和数据卷启动。实例创建身份由来源选择器、模式、镜像、Profile/插件组合、端口、上下文数据资产与 HOME 绑定组成；开发模式工作区后续内容变化显示 dirty，不直接判身份冲突。`--mode dev` 缺 `--accept-cordis-trust` 即失败关闭，`--mode eval` 拒绝该旗标；来源缺少 `spec`/`eval` 根时失败关闭。配置/插件变化提示需重新构建或启动新进程；评测模式绑定快照摘要时不得作为正式评估结论。 | 端口被占仍自动改端口、覆写已有 HOME、把启动成功写成交付通过，或在未显式确认下启动等同 shell 权限的创造模式实例。 |
| `ps` | 显示启动器管理的实例、来源、模式与用途、默认 preset、上下文挂载、镜像、实际端口、运行状态和不带 Token 的回环基址。 | 显示 Token、Cookie、环境变量值或未经核验的“业务就绪”。 |
| `url <name>` | 从**正在运行的该实例、本次 DSH 进程**取得原样完整认证 URL，核对地址、端口与认证入口后向交互终端输出；显式 `--non-interactive` 可向脚本输出同一 URL，并提示调用者自行保护标准输出。 | 只打印裸 `http://127.0.0.1:<port>/`、拼造 Token、返回历史进程链接或把 URL 写入状态文件。 |
| `open <name>` | 使用与 `url` 同一个经核对的认证 URL 打开宿主机默认浏览器；浏览器打开失败只报告无凭据错误，DSH 保持运行。 | 在普通输出中再打印 URL，或把“请求打开浏览器”当作页面已可用。 |
| `logs <name>` | 默认输出有界、尽力脱敏的错误类型、插件名、错误码和必要栈；显式本地详细诊断可读取原始运行日志，但不得自动归档入资产仓库。 | 误称任意自由文本都已完全脱敏，或把原始日志复制入库。 |
| `down <name>` | 停止该实例，默认保留 HOME 与资产；不等于重置会话。 | 删除其他实例、数据卷、Candidate 资产或外部服务。 |
| `resume <name>` / `fresh ...` | 前者显式复用已保留 HOME，后者创建全新实例、HOME 与 Session；Verification 默认 fresh。清理旧 HOME 另设确认目标的操作，不由 `down` 隐式执行。 | 把恢复旧会话和新运行混为一谈，或在比较运行中复用旧状态。 |

`<name>` 使用小写 kebab-case，映射到唯一 Compose 项目；不同实例有独立容器和 HOME 卷。`--port` 默认 `3080`，必须是合法 TCP 端口且同机唯一。为保证 URL 可预测，端口冲突时失败，不自动换端口；第二个实例应显式指定其他端口。`plan` 与 `up` 都检查端口，但 `plan` 结果不保留端口，`up` 仍须处理两次检查之间的占用竞争。开发模式（`--mode dev`/authoring）允许行为工作区改变但标记 dirty，受控 Profile/插件组合或镜像改变则必须新装载；评测模式（`--mode eval`/verification）只接受同一冻结摘要。两种模式都必须显式提供 `spec`/`eval` 上下文根，缺失即失败关闭。固定 DSH 版本的 `--port` 语义、两个实例不同端口及 Cookie 隔离均需实测。

## 4. 实例生成与认证 URL 的正确性

启动器在宿主侧解析 `experiment:<id>`、`snapshot:<snap-UUID>` 或后续的 `release:<id>` 到**精确、已核验的来源**，拒绝路径穿越、符号链接越界、不存在的快照/Release、错误模式及仓库外来源。现有适配层已有 `sources.json` 和共享来源解析器；当前仅登记 `EXP-security-operations-expert-001`，`verify-load.sh --source` 可展开镜像、Patch 和三棵卷用于局部技术核验。`snapshot:<...>` 选择器已实现：`dsh-dev up`/`plan` 接受研究快照来源，`verify-load.sh --frozen <研究快照目录>` 会先核对该快照的只追加回执再以快照内容装载；`release:<id>` 选择器、完整研究快照的元数据/插件构建身份绑定仍待实现，不为它们创建空制品。Compose 的凭据环境名称与 HOME 卷仍对应默认样例；启动器须为其他 Agent 实例化环境与隔离 HOME，并验证实际装载和恢复，不能只替换资产卷便假称完整支持。

对每个实例生成位于仓库外用户状态目录的非秘密配置；调用 Docker Compose 前运行 `config --quiet`，保留现有适配层的挂载/权限控制，只改变所选资产来源、实例身份、Web 端口和 `dsh` 服务的 host 网络。Compose 项目名和卷名按 `<name>` 隔离，不能复用现有固定 Compose 的默认 HOME。受信调用环境按变量名提供模型/MCP 端点和凭据；环境值不进入生成配置、计划输出或仓库。不得通过 DSH_HOME 或 Candidate `.env` 偷偷补齐配置。

`url` 不根据端口生成 `/?token=...`，而是从该实例当前容器的启动时间之后读取 DSH 自己打印的 `dsh web:` 行，严格提取唯一的本机认证 URL，核对 `127.0.0.1`、实例端口、Token 参数及进程仍在运行。输出前以进程内临时 Cookie 访问该 URL，确认 Token 入口重定向、认证后根页面可达；任何一步失败均不输出 URL，也不回退到旧日志或裸根地址。探针不能把 Token/Cookie 放入子进程命令参数、诊断、证据或文件。实施验收还须核对主 JS 资源可达。DSH 重启后 Token 会随进程变化，旧 URL 不得由启动器返回。

`dsh-dev url <name>` 本身就是用户主动要求展示认证 URL 的动作，不再增加 `--show-token` 参数。默认只在本地交互终端输出；脚本或 IDE 确需消费时，必须显式指定 `--non-interactive`，输出仍仅含本次进程 URL，并在诊断中提示调用方标准输出含敏感值。不能把 URL 写入状态文件、普通日志或仓库；调用方负责自己的管道和终端记录。

根级 [`AGENTS.md`](../AGENTS.md) 只允许操作者明确请求时展示本地当前进程认证 URL，不允许写入资产或一般证据。DSH 自身按官方行为打印认证 URL，Docker 日志可能持久保存该行；这些日志属于敏感 Runtime 数据，应限制访问和有界保留，不能声称“没有落盘”。启动器不建立第二份 Token 存储；详细诊断仅本地显式开启，未经分类的 DSH 原始日志不纳入 Git、机器评估证据或公开报告。

## 5. 失败、安全门禁与验收

| 场景 | 预期处理 |
|---|---|
| 端口被其他进程占用，或 DSH 实际监听地址/端口与计划不同 | `up` 失败并标注非秘密端口与原因；不杀占用进程、不自动改端口。 |
| 镜像身份、Profile、受控挂载或 HOME 初始化不匹配 | 失败关闭，保留可审日志；不改受控文件、不清空旧卷。 |
| Authoring 工作区在启动后改变 | `ps` 显示 dirty；行为文件继续按探索语义使用，受控配置/插件变化提示重新构建和启动，不覆写旧 Run。 |
| Verification 来源改变 | 只从物化冻结副本启动；原 Candidate 改变不影响该实例，冻结副本摘要不符则拒绝运行。 |
| DSH 未打印当前 URL、Token 交换失败、Web 未完成启动 | `url`/`open` 返回非零且不暴露历史链接；`ps` 标注未就绪。 |
| 配置展开或 Web 等待超时、进程取消 | 使用明确总截止时间，清理子进程并区分超时、退出失败和配置非法；保留无秘密的定位信息。 |
| 宿主 UID/GID 与容器用户不匹配 | 启动前检查目标目录权限；支持经核验的用户映射或给出具体修复信息，不以 root 掩盖问题。 |
| 浏览器未打开、模型或 MCP 不可用 | 分别报告对应失败；不能把 Web `200`、端口监听或容器运行说成 Agent 可用。 |
| `down` 时仍有待审 Candidate 改动或未完成 Session | 提示可能的运行影响，停止容器但保留资产和 HOME；不自动提交、删除或晋升。 |

本方案是**高风险的本地开发接入设计**，因为 host 网络扩大了 Agent/Candidate 对宿主机服务的可达范围。可执行强制点至少包括：DSH 只绑定回环、固定端口并拒绝冲突；Docker 精确挂载、非 root 用户及不挂 Docker Socket；Runtime/领域服务端继续负责工具、MCP、租户/对象、审批、幂等和失败安全。Token 只解决浏览器身份，不授予 Harness 发布许可，也不能代替这些控制。本文不是具体 Agent 的 `CTRL → AC → Case` 事实源；若 host 网络或 URL 展示方式进入某 Agent 的正式冻结运行组合，须在该 Agent 唯一交付需求源中关联适用 `AC`、安全 Case、实际强制点与审计证据，否则安全硬门禁状态是**未验证**，不得用于 R3/Release 结论。

实施时按下列顺序验收，不以静态检查代替真实运行：

1. 用锁定镜像核验 `--host 127.0.0.1 --port <port> --no-open`；比较启动器生成的 Compose 与现有 Authoring/Verification 控制，核 `home-init` 仍无网络、`dsh` 仅在本地开发实例用 host 网络且没有 `ports:`，且两种模式都精确只读挂载 `/work/spec` 与 `/work/eval-input`。
2. 在同机浏览器链路验证默认与自定义端口：`url` 输出的原始完整 URL 可取得 Token 入口 `303`、Cookie 根页 `200`、`__DSH_BOOT__` 与主 JS `200`；错误或旧 Token 不可被当作当前入口。验证重启、双实例、端口冲突及 `url` 非交互调用。
3. 验证 `ps`、`plan`、默认 `logs`、错误输出和生成配置不意外泄露 Token/凭据；显式详细诊断与 `url --non-interactive` 的敏感输出边界单独测试。确认 Docker 日志保留配置。核开发模式单写者和 dirty 状态、评测模式冻结来源 RO、HOME 分离、无 Docker Socket 和仓库根挂载；检查两种模式的 preset 生效证据（开发=`cordis`/`includeShippedRoot: true`，评测=`security-operations-expert`/不出厂根）、超时、取消、非默认 UID/GID 与双实例恢复。
4. 对模型/MCP/权限和至少一条真实任务链另行验收，记录用户可见结果、工具/审批行为、最终业务状态和审计；若缺少这些证据，只报告“本地 Web 接入通过”，不报告 Agent 交付或 Release 通过。

当前实现覆盖第 1、2、3 条中的来源解析（`experiment:`/`snapshot:`）、单实例 `image build/plan/up/ps/url/logs/down`、两种模式（`dev`/`eval`）与 preset 选择、只读上下文数据资产挂载、host 网络渲染、认证 URL 探针、脱敏日志与 Token 不落盘，并有 `dsh-dev-live-load-20260918.json` 记录实例级装载证据；开发模式的 shell/`tool-cordis` 能力只在显式 `--accept-cordis-trust` 下启动，属已披露风险而非强制控制。主 JS 资源 `200`、双实例并发、`open`、`resume`、`fresh`、`release:<id>` 选择器与完整业务链仍未验收。已实现的子集必须明确标注，不得把本文示例命令加入可执行快速开始流程。
