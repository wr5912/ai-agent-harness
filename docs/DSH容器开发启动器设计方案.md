# DSH 容器开发启动器设计方案

> 状态：Proposal，尚未实施。本文中的 `dsh-dev`、host 网络实例、命令输出及验收流程均为待实现的设计合同，不是当前仓库已有的可执行功能。
>
> 范围：同一台 Linux Docker Engine 主机上的本地开发和候选技术核验。本文不设计生产部署入口，不改变 DSH Runtime 源码，也不替代 Agent 交付评估或 Release 验收。
>
> 依据：[规范来源锁定](./standards/SOURCES.md)、[项目规范解释](./standards/PROJECT-INTERPRETATION.md)、[当前 DSH 容器适配层](../runtime/adapters/dsh-container/README.md)。研发管理 CLI 是[另一项提案](./DSH智能体研发管理平台边界设计方案.md)，两者不共用命令、权限或运行态数据。

## 1. 要解决的问题与当前事实

开发者需要明确选择本仓库中的 Harness 来源和运行模式，快速启动容器内 DSH Web，并取得**宿主机浏览器可访问、包含本次进程 Token 的完整 URL**。启动器属于宿主侧开发工具；容器内运行的仍是锁定镜像中的官方 DSH，Harness 仍通过卷装载，`DSH_HOME` 仍是独立运行态数据根。

当前适配层只装载 `EXP-security-operations-expert-001` 的 Candidate，提供 Authoring/Verification 两套 Compose；`dsh` 服务未发布宿主机端口，官方 Web 绑定容器内回环。因此即使容器日志出现 `127.0.0.1:3080`，该地址目前也不能直接供宿主机浏览器使用。现有[技术预检](../evolution/experiments/EXP-security-operations-expert-001/evaluation/dsh-web-technical-preflight-20260915T054223Z.json)验证过隔离环境内 Token 入口 `303`、取得 Cookie 后根页面 `200`，但没有验证本文拟议的 host 网络、真实模型/MCP 或完整业务任务。当前没有可用的 `dsh-dev`，也没有已晋升的业务 Agent Release。

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

| 来源与模式 | 工作区 | Preset/managed | `DSH_HOME` | 结论边界 |
|---|---|---|---|---|
| `experiment:<id>` + `authoring` | 当前 Candidate 工作区 RW | RO | 该实例专用数据卷 | 只供隔离探索；自修改形成待审 diff。 |
| `experiment:<id>` + `verification` | Candidate 工作区 RO | RO | 与 Authoring 不共用的新数据卷 | 只供候选技术核验；宿主源若变化须停止并重核摘要。 |
| `release:<id>` + `verification`（后续扩展） | 已存在、可校验的具体 Release 全部 RO | RO | 新数据卷 | 只供本地装载检查，不表示生产部署；当前尚无此类 Release。 |

不得把 `current/`、仓库根目录、交付评估数据、历史归档或开发者个人 DSH_HOME 当作启动来源。Authoring 与 Verification 不复用 Session；进入正式评估前还须按[项目规范解释](./standards/PROJECT-INTERPRETATION.md#7-dsh-双平面与挂载契约)冻结组合、复核 Candidate diff，并用新容器、新 Session 重新加载。启动器不冻结 Baseline、不运行 R3、不生成 Release。

## 3. `dsh-dev` 命令合同

拟议可执行入口为仓库内 `runtime/adapters/dsh-container/dsh-dev`，文中的 `dsh-dev` 表示开发者把该目录加入 `PATH` 后的命令名；直接调用时使用 `./runtime/adapters/dsh-container/dsh-dev`。建议只依赖 Python 3 标准库、Docker CLI 和 Compose，不在容器内安装管理工具。所有命令均为未来接口，**现在运行会找不到该入口**。

```bash
dsh-dev image build
dsh-dev plan --source experiment:EXP-security-operations-expert-001 --mode authoring --name secops --port 3080
dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode authoring --name secops --port 3080
dsh-dev ps
dsh-dev url secops
dsh-dev open secops
dsh-dev logs secops
dsh-dev down secops
```

| 命令 | 行为与输出 | 必须避免 |
|---|---|---|
| `image build` | 调用现有锁定来源构建脚本，报告镜像 ID/版本。 | 隐式拉取其他 DSH 版本或把本地标签当不可变身份。 |
| `plan` | 只读解析来源、镜像、模式、挂载、环境变量**名称**、端口及风险，检查来源/端口/实例名；输出脱敏计划。 | 创建容器、数据卷、基线或打印变量值/Token。 |
| `up` | 再次检查计划条件，使用隔离 Compose 项目和数据卷启动；确认当前进程已公布 Web URL 后，只输出实例名、模式、端口和下一步 `dsh-dev url <name>`。相同名称且来源树摘要、镜像 ID、模式与端口均一致时返回现有实例；否则拒绝覆盖。 | 端口被占仍自动改端口、覆写已有 HOME、把启动成功写成交付通过。 |
| `ps` | 显示启动器管理的实例、来源、模式、镜像、实际端口、运行状态和不带 Token 的回环基址。 | 显示 Token、Cookie、环境变量值或未经核验的“业务就绪”。 |
| `url <name>` | 从**正在运行的该实例、本次 DSH 进程**取得原样完整认证 URL，核对地址、端口与认证入口后，向本地交互终端输出且仅输出这一条 URL。 | 只打印裸 `http://127.0.0.1:<port>/`、拼造 Token、返回历史进程链接或把 URL 写入状态文件。 |
| `open <name>` | 使用与 `url` 同一个经核对的认证 URL 打开宿主机默认浏览器；浏览器打开失败只报告无凭据错误，DSH 保持运行。 | 在普通输出中再打印 URL，或把“请求打开浏览器”当作页面已可用。 |
| `logs <name>` | 仅显示有界的安全诊断摘要：固定事件码、时间与状态；未知格式或包含自由文本的原始行整行隐藏，不提供原始日志导出模式。 | 只遮蔽启动行便声称任意 Plugin 日志都已安全脱敏，或把 Docker 原始日志复制入库。 |
| `down <name>` | 停止并移除该实例的容器；默认保留其 `DSH_HOME` 卷供人工检查和恢复。 | 删除其他实例、数据卷、Candidate 资产或外部服务。 |

`<name>` 使用小写 kebab-case，映射到唯一 Compose 项目；不同实例有独立容器和 HOME 卷。`--port` 默认 `3080`，必须是合法 TCP 端口且同机唯一。为保证 URL 可预测，端口冲突时失败，不自动换端口；第二个实例应显式指定其他端口。`plan` 与 `up` 都检查端口，但 `plan` 结果不保留端口，`up` 仍须处理两次检查之间的占用竞争。固定 DSH 版本的 `--port` 语义、两个实例不同端口及 Cookie 隔离均需实测。

## 4. 实例生成与认证 URL 的正确性

启动器在宿主侧解析 `experiment:<id>` 或后续的 `release:<id>` 到仓库内的**精确现有目录**，拒绝路径穿越、符号链接越界、不存在的 Release、错误模式及仓库外来源。首版只支持现有 `EXP-security-operations-expert-001` Candidate：现有 Compose 的 Patch 名称、工作目录和 MCP 环境变量均针对这一 Agent 写死；其他来源在具备经审查的装载映射前必须失败，不能只替换三棵资产卷便假称支持。Release 选择器待真实 Release 和相应只读装载映射存在后启用，不为它创建空制品。

对每个实例生成位于仓库外用户状态目录的非秘密配置；调用 Docker Compose 前运行 `config --quiet`，保留现有适配层的挂载/权限控制，只改变所选资产来源、实例身份、Web 端口和 `dsh` 服务的 host 网络。Compose 项目名和卷名按 `<name>` 隔离，不能复用现有固定 Compose 的默认 HOME。受信调用环境按变量名提供模型/MCP 端点和凭据；环境值不进入生成配置、计划输出或仓库。不得通过 DSH_HOME 或 Candidate `.env` 偷偷补齐配置。

`url` 不根据端口生成 `/?token=...`，而是从该实例当前容器的启动时间之后读取 DSH 自己打印的 `dsh web:` 行，严格提取唯一的本机认证 URL，核对 `127.0.0.1`、实例端口、Token 参数及进程仍在运行。输出前以进程内临时 Cookie 访问该 URL，确认 Token 入口重定向、认证后根页面可达；任何一步失败均不输出 URL，也不回退到旧日志或裸根地址。探针不能把 Token/Cookie 放入子进程命令参数、诊断、证据或文件。实施验收还须核对主 JS 资源可达。DSH 重启后 Token 会随进程变化，旧 URL 不得由启动器返回。

`dsh-dev url <name>` 本身就是用户主动要求展示秘密的动作，不再增加 `--show-token` 参数；为限制意外收集，设计默认仅允许在本地交互终端运行，重定向或管道调用失败且不输出 URL。命令的标准输出只含 URL，标准错误只含无凭据诊断。若以后需要非交互获取，必须另行审查用途与泄露路径，不能悄悄放宽。

**与现行规则的关系：**根级 [`AGENTS.md`](../AGENTS.md) 目前禁止回显、复制或记录 Token。本文是未来设计，**不立即修改这条规则**。实际实现 `url` 时，必须同步给该规则增加仅限本地开发、操作者主动运行此命令的窄例外，并说明其终端回显风险。DSH 自身按官方行为打印认证 URL，Docker 日志可能持久保存该行；这些日志属于敏感 Runtime 数据，须限制访问和有界保留，不能声称“没有落盘”。启动器不建立第二份 Token 存储；`logs` 仅输出安全诊断摘要，未经分类的 DSH 原始日志不纳入 Git、机器评估证据或公开报告。

## 5. 失败、安全门禁与验收

| 场景 | 预期处理 |
|---|---|
| 端口被其他进程占用，或 DSH 实际监听地址/端口与计划不同 | `up` 失败并标注非秘密端口与原因；不杀占用进程、不自动改端口。 |
| 镜像身份、Profile、受控挂载或 HOME 初始化不匹配 | 失败关闭，保留可审日志；不改受控文件、不清空旧卷。 |
| Candidate 源在计划后或运行中改变 | `up` 重核；Verification 检测到内容摘要漂移即停止该次技术结论，正式评估改用新冻结组合。 |
| DSH 未打印当前 URL、Token 交换失败、Web 未完成启动 | `url`/`open` 返回非零且不暴露历史链接；`ps` 标注未就绪。 |
| 浏览器未打开、模型或 MCP 不可用 | 分别报告对应失败；不能把 Web `200`、端口监听或容器运行说成 Agent 可用。 |
| `down` 时仍有待审 Candidate 改动或未完成 Session | 提示可能的运行影响，停止容器但保留资产和 HOME；不自动提交、删除或晋升。 |

本方案是**高风险的本地开发接入设计**，因为 host 网络扩大了 Agent/Candidate 对宿主机服务的可达范围。可执行强制点至少包括：DSH 只绑定回环、固定端口并拒绝冲突；Docker 精确挂载、非 root 用户及不挂 Docker Socket；Runtime/领域服务端继续负责工具、MCP、租户/对象、审批、幂等和失败安全。Token 只解决浏览器身份，不授予 Harness 发布许可，也不能代替这些控制。本文不是具体 Agent 的 `CTRL → AC → Case` 事实源；若 host 网络或 URL 展示方式进入某 Agent 的正式冻结运行组合，须在该 Agent 唯一交付需求源中关联适用 `AC`、安全 Case、实际强制点与审计证据，否则安全硬门禁状态是**未验证**，不得用于 R3/Release 结论。

实施时按下列顺序验收，不以静态检查代替真实运行：

1. 用锁定镜像核验 `--host 127.0.0.1 --port <port> --no-open`；比较启动器生成的 Compose 与现有 Authoring/Verification 控制，核 `home-init` 仍无网络、`dsh` 仅在本地开发实例用 host 网络且没有 `ports:`。
2. 在同机浏览器链路验证默认与自定义端口：`url` 输出的原始完整 URL 可取得 Token 入口 `303`、Cookie 根页 `200`、`__DSH_BOOT__` 与主 JS `200`；错误或旧 Token 不可被当作当前入口。验证重启、双实例、端口冲突及 `url` 非交互调用。
3. 验证 `ps`、`plan`、`logs`、错误输出和生成配置均不泄露 Token/凭据；确认 Docker 日志的敏感性与保留配置。核 Authoring 仅工作区 RW、Verification 资产 RO、HOME 分离、无 Docker Socket 和仓库根挂载。
4. 对模型/MCP/权限和至少一条真实任务链另行验收，记录用户可见结果、工具/审批行为、最终业务状态和审计；若缺少这些证据，只报告“本地 Web 接入通过”，不报告 Agent 交付或 Release 通过。

本次仅形成文档。后续真正实现启动器时，先交付最小 `plan/up/ps/down` 与 host 网络装载，再交付 `url/open` 的当前进程 Token 处理、脱敏日志和对应测试；同一实现变更中同步修订 `AGENTS.md` 的窄例外。不得在实现前把本文示例命令加入可执行快速开始流程。
