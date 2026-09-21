# DSH 容器薄适配层

本目录固定官方 DeepSeek Harness（DSH）源码构建身份和卷装载方式；不开发、不复制 DSH Runtime 源码到本仓库，也不把宿主机 Codex 项目协作配置交给 DSH。`sources.json` 声明可选择的 Experiment Candidate；当前只有 `EXP-security-operations-expert-001`。新增来源须提供自己的 Candidate 资产及锁定身份，不能只改卷路径。

## 源码与镜像身份

`source.lock.json` 锁定官方仓库提交 `c291e7961a515f6d7af9304e7fd1d257929aef26`、Git tree、`pnpm-lock.yaml` 摘要、`pnpm@11.7.0`、Node 基础镜像 OCI index digest 和 `linux/amd64`。`build-image.sh` 新建临时源码工作树，在宿主侧核对提交、tree 和锁摘要后用 BuildKit named context 构建。官方构建脚本支持显式 `DSH_CLIENT_COMMIT_HASH`；构建器不依赖 named context 是否携带 `.git`，只安装本地 C 编译及 musl 工具，最终镜像不保留这些构建工具或 `.git`。本仓库没有 DSH 源码副本。

```bash
bash runtime/adapters/dsh-container/build-image.sh
# 多来源时显式选择：build-image.sh --source EXP-<agent-id>-NNN
```

APT 索引使用 `Error-Mode=any`、单次重试、30 秒 HTTP 连接超时和 IPv4；失败必须中止，而非沿用不完整索引。默认使用基础镜像内官方 `http://deb.debian.org/debian` 及 `debian-security`。当该站点在本机网络过慢时，可显式加 `--apt-mirror http://mirrors.tuna.tsinghua.edu.cn/debian`；脚本**只允许这一精确 HTTP 地址**，同时切换 security 到精确 `http://mirrors.tuna.tsinghua.edu.cn/debian-security`。构建前先用同一锁定 Node 底座执行 Debian archive keyring 签名的 APT 更新预检，main、updates、security 任一签名或索引失败即停；Dockerfile 中再次校验，构建证据记录两条实际镜像 URI。非默认镜像改变了构建期软件包的分发路径、可用性和更新时间边界，虽未降低 Debian 签名校验，也不能把它说成与官方源的网络来源完全相同。

本机 Docker 构建网络异常时还可显式加 `--build-network host`，但这会让构建步骤直接使用宿主网络命名空间；默认仍为 Docker 隔离网络。镜像源与网络选项都不改变锁定 DSH 源码和 Node 基础镜像身份，实际值写入构建证据。

成功构建后脚本打印实际本地 Image ID 和 CLI 版本，并向本 Experiment 的 `evaluation/evidence/dsh-image-build-<UTC>-<PID>.json` 写入只追加的本地构建证据。也可以指定 `--evidence-output FILE`。`source.lock.json` 仅锁构建输入，不填写未取得的 Registry digest；本地标签可重指向，不能代替 Image ID 或发布时验证的不可变 Registry digest。

## 候选资产装载

| 容器路径 | 宿主机来源（所选 Experiment） | 编写态 | 核验态 |
|---|---|---|---|
| `/work/harness/workspace` | `candidate/dsh/workspace` | 读写 | 只读 |
| `/opt/dsh-presets` | `candidate/dsh/presets` | 只读 | 只读 |
| `/opt/dsh-managed` | `candidate/dsh/managed` | 只读 | 只读 |
| `/work/reference` | `agents/<agent-id>`（含 `definition.md` 与 `evaluation.md`） | 只读 | 不挂载 |
| `/work/eval-input` | 显式声明的被测输入根 | 不适用 | 仅在显式声明时只读 |
| `/var/lib/dsh` | 分别命名的 DSH_HOME 数据卷 | 读写 | 读写 |

`/work/reference/definition.md` 是需求与任务的唯一当前来源，`evaluation.md` 是测试数据、评估方法、验收标准和 Experiment 选择的唯一当前来源。只读挂载限制写入但不限制读取，所以该目录只挂给编写态；核验态完全不挂载，`verify-load.mjs` 与 `test_home_submounts.mjs` 对此做负向断言。任一文件缺失或不是安全的普通文件时，编写态启动失败，不创建空目录。

两种模式都使用同一组受控 HOME 边界：`locked-user.patch.yml`（顶层 `[]`）精确只读覆盖 HOME 与 Web Profile 的用户 Patch，`web-profile.package.json` 固定官方 `base`、`web-app` Bundle 和 `patchReload: startup`，阻断可写 HOME 的额外启动 Plugin。真正 **0 字节**的 `locked-global.AGENTS.md` 精确只读覆盖 HOME 全局 Agent instructions，不向 Session 注入任何额外语义。`locked-bootstrap.env` 只含一行注释，精确只读覆盖 HOME 与 Candidate workspace 两处 `.env`；模型/MCP Endpoint 和凭据只能由受信容器调用环境或 Runtime 受控凭据提供，不能由可写工作区在 Boot 前暗改。Candidate workspace 中的 `.env` 只是与受控文件字节相同的宿主挂载目标，不存任何变量或凭据。编写态仍可写其他 Candidate workspace 资产，`skill-filesystem.watch: true` 仍可实时看到 Skill 改动；这不授予改受控 Profile、MCP 或 Boot 环境的权限。

Node Loader 从 Web Profile 查找模块时会依次检查 `/var/lib/dsh/profiles/web/node_modules`、`/var/lib/dsh/profiles/node_modules`、`/var/lib/dsh/node_modules`。HOME 根与 Web 本地两处，以及 Web 私有 `.dsh-module-fallback/node_modules`，均由不含任何包的 `verification-home-controls/module-deny` 精确只读目录覆盖。官方 Web 启动仍需要共享安装 fallback；`home-init` 在**独立** trusted-fallback 数据卷中离线调用锁定 DSH 的官方 healer，按 `/opt/dsh/apps/cli/package.json` 的依赖与 peer 依赖闭包生成 symlink。它在调用前拒绝旧卷任何非精确条目，调用后核对完整包 roster、每个 symlink 的字面目标及 `realpath` 均在镜像内 `/opt/dsh/`。主 DSH 将这棵卷精确只读挂载到 `/var/lib/dsh/profiles/node_modules`，缺失或变更会失败关闭；不会通过上述 HOME Node fallback 路径从 RW 数据卷装载代码。

首次使用空数据卷时，`home-init` 创建精确子文件/模块目录挂载目标；最终镜像预建这些目录并赋权 UID 1000，避免 Docker 嵌套卷首次创建 root-owned 父目录。已有 HOME Patch、manifest、全局 `AGENTS.md` 或 `.env` 若不同、为链接或不合限额，即失败，不覆盖。旧 fallback 卷若有非镜像安装 symlink、额外包或不完整条目也失败，不先“修复”旧内容；应备份审查后改用新的隔离卷。旧 HOME 中已有模块文件在只读 deny-layer 下会被隐藏、**不会被自动删除**，仍需作为旧运行态数据独立审查和处置。`dsh` 服务必须等 home-init 成功；`verify-load.sh` 使用 `run --no-deps`，两种模式都会显式先执行各自的 home-init。RW HOME 仍允许 Session/settings/credentials 持久化，但不能覆盖这些受控只读子挂载。

启动 `web` Profile，叠加 `/opt/dsh-managed/security-operations-expert.patch.yml`。锁定官方 Loader 在本 Node 镜像的无 internal-loader 路径会从 `/opt/dsh/vendor/loader` 相对查找 bare package，真实受控 startup 因缺包失败；只把 fallback 卷的 scoped 子目录覆盖镜像安装树虽能起 Web，却会隐藏镜像原有的 `dsh-tool-session-query` 包并改变解析优先级，因此不采用。两种模式**仅主 `dsh` 服务**显式使用精确向量 `node --expose-internals /opt/dsh/apps/cli/lib/bin.js`，让锁定 Loader 按 Web Profile 基准路径解析；`home-init` 与装载探针保持普通 `node`，不通过被 Node 禁止的 `NODE_OPTIONS` 传该旗标，也不改镜像默认 ENTRYPOINT。隔离、无 Candidate Managed Patch 的官方 base+web 技术预检可运行至少 15 秒；这不表示 Candidate 业务启动、MCP 或模型连接通过。

`--expose-internals` 让**同一主进程中任何已加载 JavaScript Plugin**都可访问 Node `internal/*`，不是安全控制；只读资产卷与无端口发布不能撤销代码已获得的进程权限。上述无 Candidate JS 的 base+web 预检仅说明官方 Web 启动兼容性；实际 Candidate 的 Managed Guard 等 JS 若被加载也处在该进程内，Authoring 中可写行为资产更须保持隔离和宿主审查。改变 DSH 官方提交、Node 镜像/版本、Bundle 或新增/改变候选 JS Plugin 时，必须重新审查该旗标、模块真实解析和 Runtime/MCP 权限边界；若官方 Loader 修复可在不暴露 internals 下启动，应移除旗标并重做两模式容器验收，不能把此启动兼容选项继承为长期权限承诺。

两个 Compose 文件均无宿主机端口发布、无 Docker socket、无仓库根目录、历史归档或评估目录挂载；根文件系统只读，容器用户为 UID/GID 1000，去除能力并设置 `no-new-privileges`。`DSH_HOME` 存放 Session、settings、附件及受控 Runtime 凭据，与 Harness 工作区完全分开，且编写态与核验态使用不同数据卷。

```bash
docker compose -f runtime/adapters/dsh-container/authoring.compose.yaml config --quiet
docker compose -f runtime/adapters/dsh-container/verification.compose.yaml config --quiet
docker compose -f runtime/adapters/dsh-container/authoring.compose.yaml up -d
docker compose -f runtime/adapters/dsh-container/authoring.compose.yaml down
```

直接运行 Compose 只用于模板级检查；启动业务实例应使用 `dsh-dev --source`，由它从 `sources.json` 解析镜像、Patch、三棵卷和 `required_env_names`，为每个来源生成独立 HOME 与环境变量透传清单。Compose 的变量覆盖不是独立的来源授权接口，不能仅靠替换路径后宣称完成另一 Agent 的装载验收。

实际 Agent 需要模型与 MCP 端点时，由调用环境提供相应配置。环境变量按名称传入，不在 Compose 或仓库写入凭据；不得把 `docker compose config` 的完整展开结果、启动 Token URL 或原始日志作为公开研究证据。当前 Candidate 声明为必需的 MCP 缺失时会启动失败，应如实记录依赖缺口。

`DSH_PERMISSION_MODE=workspace-write|read-only` 是官方 base Profile 的新 Session *进程后备预设*；Web 中持久化的 General Settings 可影响后续 Session，不能只凭该变量推断实际状态。调用环境、HOME 中的 settings/credentials 与模型/MCP 连接状态是独立 Runtime 事实，应在需要比较时记录。核验态三棵资产使用 Docker `read_only` bind mount；编写态 DSH 可以修改工作区内的 Candidate 行为资产，但不能写受控 Preset、Guard 或 MCP 绑定。

编写态 `skill-filesystem.watch: true` 与 Agent instructions 的重投影可能让**当前 Session** 实时看到刚写入的工作区新行为；这只算即时观察。要比较变更前后行为，先核对 Candidate diff 和回执，再用核验态的新容器、新 Session 重建加载，避免把旧 Session 状态误当成源码效果。

官方 Web 当前默认只绑定容器内 `127.0.0.1`，两份基础 Compose 不发布宿主端口。需要浏览器访问时使用 `dsh-dev` 生成的本地 host-network 实例；容器启动或配置展开仍不能替代 `PA-08` 的实际 Web 交互。

## 构建镜像

```bash
bash runtime/adapters/dsh-container/build-image.sh --build-network host
```

构建期统一使用国内阿里云源：APT 走 `http://mirrors.aliyun.com/debian`（security 同站），npm/pnpm 与 corepack 走 `https://registry.npmmirror.com`。两者都不需要调用方额外加参数；只有国内 APT 源不可达时，才用 `--apt-mirror http://deb.debian.org/debian` 显式回退到官方源。

换源不放松校验：APT 仍由 `debian-archive-keyring` 校验 Release/InRelease 签名与 `Valid-Until`，依赖仍按 `pnpm-lock.yaml` 的完整性摘要校验。实际使用的源写入该次构建证据。

## 开发启动器与本地装载核验

`dsh-dev` 是宿主侧开发启动器（只依赖 Python 3 标准库、Docker CLI 和 Compose），把本目录的受控 Compose 渲染成仓库外实例。两种模式都挂载 Harness 三棵树，但判分材料只给开发会话。会话身份、优化目标和工作区关系如下：

| 模式 | CLI | `session_preset`（会话实际运行） | `target_preset`（待优化/待评估目标） | 注册工作区 |
|---|---|---|---|---|
| 开发模式 | `--mode dev`（内部 `authoring`） | 出厂 `cordis` 创造模式 | 由所选来源声明（`up --dry-run` 输出的 `target_preset`） | `/work` |
| 评测模式 | `--mode eval`（内部 `verification`） | 由所选来源声明 | 同 `session_preset` | `/work/harness/workspace` |

挂载模式以“候选资产装载”表为准：开发模式仅 Workspace 可写，Preset/Managed 与判分材料只读；评测模式的 Harness 三棵树全部只读，且不挂载判分材料。

开发会话的注册工作区是 `/work`，会话身份来自受控只读的 `/work/AGENTS.md`（`verification-home-controls/locked-dev.AGENTS.md`，内容通用、不含业务 Agent 名），本次解析出的实际目标值由来源合同生成并只读挂到 `/work/AGENTS.local.md`；`dsh-dev up` 与独立 `verify-load.sh authoring` 复用同一生成函数。目标自己的业务 `AGENTS.md` 仍在 `/work/harness/workspace` 供阅读和编辑，但不会被注入为会话身份。被测容器两个开发指令文件都不挂载。

目标 preset 由 `sources.json` 的 `preset` 路径推出，适配层不内联任何业务 Agent 名；新增来源只需追加目录数据。

```bash
python3 runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode dev --dry-run
python3 runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode dev --accept-cordis-trust
python3 runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode eval --dry-run
python3 runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode eval
python3 runtime/adapters/dsh-container/dsh-dev ps
python3 runtime/adapters/dsh-container/dsh-dev url security-operations-expert-dev --non-interactive   # 交互终端可省略该旗标
python3 runtime/adapters/dsh-container/dsh-dev logs security-operations-expert-dev --tail 200
python3 runtime/adapters/dsh-container/dsh-dev down security-operations-expert-dev
```

`--source` 和 `--mode` 始终由用户显式选择；缺失或无值时命令会列出当前可用值并以用法错误退出。`--name` 默认为 `<agent-id>-<dev|eval>`。新实例未指定 `--port` 时从 `3081` 起选第一个未监听且未被有效实例记录占用的端口；已有同名实例复用记录端口。`--dry-run` 只给出建议，不写状态、不调用 Docker，也不要求运行时环境变量或开发模式信任确认。

`--mode dev` 使用 `authoring.compose.yaml` 并在基础受控 patch 之后叠加 `security-operations-expert.development.patch.yml`（仅打开 DSH 出厂 preset 根并把默认 preset 设为 `cordis`；校验器对该文件实施行白名单）。因为创造模式会话具备 shell 与对实时 runtime 执行模型 JS 的 `tool-cordis` 能力（等同 shell 权限），且容器使用 host 网络、可直达宿主回环服务（含本机 DSH Web），`up --mode dev` 必须显式加 `--accept-cordis-trust`；`--mode eval` 拒绝该旗标。创造模式会话不加载 `security-operations-guard`，注入的 SOC MCP 工具与 delegate 因此**没有角色矩阵约束**——这是开发模式的已知边界，不是已隔离状态。`--mode eval` 不叠加开发层，`includeShippedRoot` 保持关闭，创造模式在该容器内不在 preset 名册中，判分材料也不进入该容器。

`up` 不只看 `docker compose up -d` 的退出码：命令返回 0 之后还要确认 `dsh` 服务真的在运行（`home-init` 是一次性服务，正常结束不算失败），否则报告失败或 `dsh_running: "unknown"` 并以非零退出码结束。成功时 stdout 只输出一个 JSON 结果；进度、提示和错误输出到 stderr，失败时 stdout 保持为空。`up --replace` 的成功 JSON 在 `replaced.stop` 中包含完整停止结果。

`ps`、`logs`、`down` 从实例状态文件重建读取该实例 Compose 所需的环境变量：受控模板用 `${VAR:?}` 声明必填变量、不内联仓库内默认路径，因此这些命令不依赖调用者的当前环境；状态文件不是最新 schema 时同样可用，`ps` 会标出 `needs_migration`。旧实例仍在运行时用 `up --replace`（保留 HOME 数据卷）或先 `down` 再同名 `up` 完成迁移。挂载内容变化不会自动重启进程，重载必须走这两条路径之一。`down` 先检查 `docker compose down` 的退出码，再核对实际容器状态与 HOME 卷：命令失败即报错，仍有容器运行或状态无法确认时输出 `stopped: false` / `stopped: "unknown"` 并以非零退出码结束；HOME 卷名按 Compose 卷标签解析，不按 `<project>-home` 猜测。

完整使用过程、挂载矩阵与异常处理见[DSH 开发与评测启动器设计方案](../../../docs/DSH开发与评测启动器设计方案.md)。

**首次打开 Web 需要在界面注册工作区。** DSH Web 的输入栏在没有已打开会话时是惰性的，必须先选定一个**已注册工作区**才能开会话；工作区注册表（`$DSH_HOME/storages/workspace.json`）只从已存会话头 bootstrap，新实例的 HOME 卷里因此为空——容器的 `working_dir` 只是进程工作目录，不等于 DSH 工作区。该锁定 DSH 提交没有受支持的工作区预注册入口，启动器只交付路径与步骤、不改写 Runtime 存储内部格式：

1. 在 Web 界面点击“选择工作区”；
2. 在“选择工作区目录”对话框点“编辑路径”，粘贴本次模式对应的路径：开发实例 `/work`，评测实例 `/work/harness/workspace`（或从“主目录”逐级进入）；
3. 点“打开”，会话即在该工作区创建，随后可直接对话。

该注册写入本实例 DSH_HOME 数据卷并跨重启保留；换用新的实例名等于新的 HOME 卷，需要重新选择一次。`up --dry-run` 输出与真正 `up` 的 stderr 提示都会带上本次模式对应的路径与步骤，以 `workspace_to_register` 为准。

实例配置与 `instance.json` 写在 `${XDG_STATE_HOME:-~/.local/state}/dsh-dev/<name>/`，只记录环境变量**名称**、`purpose`、`agent_id`、`target_preset`、`session_preset`、`context_mounts` 与信任确认标记，不含 Token。渲染保留只读根文件系统、UID/GID 1000、能力裁剪和无端口发布，只把主 `dsh` 服务切到 host 网络并把 Web 绑定宿主回环。`url` 只读取**本次**进程启动后的日志并做 Token→Cookie→根页探针；标准输出不是交互终端时，必须显式加 `--non-interactive`，否则失败关闭，不把 Token 写进状态文件、普通日志或证据。

候选 Profile 以 fail-closed 方式声明三个 `streamable-http` MCP 客户端；缺少真实端点与凭据时容器会在启动阶段退出，使"装载是否成立"无法核验。为此适配层提供两个只用于受控技术装载核验的本地工具：

```bash
python3 evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/derive_mcp_stub_tools.py --check
python3 evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/derive_mcp_stub_tools.py --out "$STATE/tools.json"
node runtime/adapters/dsh-container/stub-mcp-streamable-http.mjs --port 3099 --tools "$STATE/tools.json" --log "$STATE/stub.log"
```

派生脚本只从候选 `mcp-servers.yaml`、`mcp-tool-name-map.json`、`role-tool-matrix.yaml` 取工具原始名，无法解析到"服务名 + 原始名"的引用即非零退出；桩服务只实现 `initialize`、`notifications/initialized`、`tools/list` 的最小协议面，只监听回环、不校验凭据、无业务语义，并只记录"是否带鉴权头"而不记录凭据值；`tools/call` **默认返回 `isError: true` 并拒绝编造业务数据**（只有显式 `--stub-success` 才回显桩标记，供协议自测），因此用它补齐不可用的 MCP 分组时，相关工具调用会明确失败而不会产生假通过结果。它证明的是**受控 Profile 的 MCP 客户端配置、鉴权头注入与工具注册链路可装载**，不证明真实 MCP 服务集成、租户/对象授权、状态机、业务能力、评估结论或 Release 验收。真实业务核验必须在受信 Runtime 提供模型与 MCP 端点后进行。

本轮候选的实例级装载证据见 [`dsh-dev-live-load-20260918.json`](../../../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-live-load-20260918.json)：容器保持运行、三个 MCP 客户端完成握手、三棵只读资产树与受控 HOME 摘要通过容器内探针、Web Token 入口探针通过；同时记录未验证项（无模型凭据，未建立 Agent Session）。

## 局部加载核验与变更回执

镜像已经构建、候选资产未并发变化时，可以执行：

```bash
bash runtime/adapters/dsh-container/verify-load.sh verification
bash runtime/adapters/dsh-container/verify-load.sh authoring
# 其他已登记来源：verify-load.sh verification --source EXP-<agent-id>-NNN
```

适配层脚本不烘焙进镜像：`prepare-verification-home.mjs`、`verify-load.mjs`、`tree-digest.mjs` 由 Compose 把本目录只读挂载到 `/opt/dsh-adapter`，因此改脚本只要重启实例，不必重建镜像。脚本先在无卷、无网络容器中以同一只读挂载比对这三个文件的 SHA-256，确认容器读到的字节与宿主审查的文件一致后再触碰 HOME 卷。随后比对宿主机与容器内三棵精确资产树；编写态另比 `/work/reference` 这棵只读判分材料树的文件、权限、大小和 SHA-256 摘要，核验态则断言 `/work/reference` 与 `/work/eval-input` 两条判分材料路径在容器内既不存在也未挂载。同时检查 `/proc/self/mountinfo` 的读写模式与独立 HOME 卷。编写态还会核对开发叠加层确实把 `includeShippedRoot` 打开且默认 preset 为 `cordis`，核验态则断言组合配置中不出现该开放（创造模式在评测容器内不可选）。两种模式都核六处受控只读子文件（两个空用户 Patch、Web manifest、零字节全局指令、两处注释 `.env`）、四处模块目录挂载及共享 fallback 的 277 个镜像安装 symlink（数量以实际锁定安装闭包为准），并核关键模块从 Web Profile 的首个解析位置的 `realpath` 在 `/opt/dsh/`。然后调用 DSH 的 `--dump-config` 核对全局 Profile/Patch 组合标识。单个 Agent 的 Guard 声明单独在 Preset/Managed 文件中核对，因为全局配置展开不会包含 Preset 子树。脚本不输出可能含私有 URL、Token 的原始配置或日志。该结果仅是“挂载身份、模块解析及配置组合证据”；**不证明 Plugin 实际激活**、MCP 连接成功、Preset/Skill 被真实 Session 调用、上下文资产被智能体消费、用户任务、最终业务状态或 Release 验收。

在编写态自修改前后留下只追加回执：

```bash
python3 runtime/adapters/dsh-container/mutation-receipt.py before
python3 runtime/adapters/dsh-container/mutation-receipt.py after <上一步打印的 before.json 绝对路径>
```

回执写入本 Experiment 的 `evaluation/evidence/mutation-receipts/mr-<UUIDv4>/`，比较三棵资产树的文件、目录权限与前后摘要。受控 Preset 或 Managed/Guard 树在编写期间变化时，脚本保留失败回执并以非零状态报告；回执只说明文件变化，不说明假设成立。若要取得三棵装载树或所选来源的研究定义根摘要，可使用 `mutation-receipt.py digest <精确资产源路径>`。

局部装载比较前可物化三棵 Candidate 挂载树的实际字节（含未提交文件），并在只读容器装载前复核摘要：

```bash
python3 runtime/adapters/dsh-container/mutation-receipt.py freeze
# 将上一步打印的路径作为 SNAPSHOT_DIR
bash runtime/adapters/dsh-container/verify-load.sh verification --frozen SNAPSHOT_DIR
```

副本位于所选 Experiment 的 `snapshots/frozen-sources/fr-<UUIDv4>/`；`snapshot.json` 记录三树文件、目录权限摘要和来源，`frozen-digest` 会核对副本字节与权限。`restore SNAPSHOT_DIR` 仅在 Candidate 根目录不存在时恢复三棵挂载树，绝不覆盖现有工作树。这只是一次局部装载探针使用的可还原挂载源，不是项目 Baseline 或 Research Release；长期研究版本仍由 Git 保存。

整套源码研究快照（`snapshots/research/`）的创建与复核已退役：它与 Git 重复保存同一份内容，并要求跨环境重现宿主机完整 POSIX 权限。历史内容按 `evolution/experiments/<id>/snapshots/README.md` 的映射从 Git 提交恢复。

未来若实现 `release:<id>`，启动器应直接装载具体、不可变的 Research Release，并核对清单摘要与实际 DSH 身份。当前没有 Research Release，也没有对应解析入口，不能把 Candidate 装载写成 Release 复现完成。
