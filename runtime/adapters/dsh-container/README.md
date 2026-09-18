# DSH 容器薄适配层

本目录固定官方 DeepSeek Harness（DSH）源码构建身份和卷装载方式；不开发、不复制 DSH Runtime 源码到本仓库，也不把宿主机 Codex 项目协作配置交给 DSH。`sources.json` 声明可选择的 Experiment Candidate；当前只有 `EXP-security-operations-expert-001`，它不是 Baseline、Release 或生产上线配置。新增来源须提供自己的 Candidate 资产及锁定身份，不能只改卷路径。

## 源码与镜像身份

`source.lock.json` 锁定官方仓库提交 `c291e7961a515f6d7af9304e7fd1d257929aef26`、Git tree、`pnpm-lock.yaml` 摘要、`pnpm@11.7.0`、Node 基础镜像 OCI index digest 和 `linux/amd64`。`build-image.sh` 新建临时源码工作树，在宿主侧核对提交、tree 和锁摘要后用 BuildKit named context 构建。官方构建脚本支持显式 `DSH_CLIENT_COMMIT_HASH`；构建器不依赖 named context 是否携带 `.git`，只安装本地 C 编译及 musl 工具，最终镜像不保留这些构建工具或 `.git`。本仓库没有 DSH 源码副本。

```bash
bash runtime/adapters/dsh-container/build-image.sh
# 多来源时显式选择：build-image.sh --source EXP-<agent-id>-NNN
```

APT 索引使用 `Error-Mode=any`、单次重试、30 秒 HTTP 连接超时和 IPv4；失败必须中止，而非沿用不完整索引。默认使用基础镜像内官方 `http://deb.debian.org/debian` 及 `debian-security`。当该站点在本机网络过慢时，可显式加 `--apt-mirror http://mirrors.tuna.tsinghua.edu.cn/debian`；脚本**只允许这一精确 HTTP 地址**，同时切换 security 到精确 `http://mirrors.tuna.tsinghua.edu.cn/debian-security`。构建前先用同一锁定 Node 底座执行 Debian archive keyring 签名的 APT 更新预检，main、updates、security 任一签名或索引失败即停；Dockerfile 中再次校验，构建证据记录两条实际镜像 URI。非默认镜像改变了构建期软件包的分发路径、可用性和更新时间边界，虽未降低 Debian 签名校验，也不能把它说成与官方源的网络来源完全相同。

本机 Docker 构建网络异常时还可显式加 `--build-network host`，但这会让构建步骤直接使用宿主网络命名空间、扩大构建期网络接触面；默认仍为 Docker 隔离网络。镜像源与网络选项都不改变锁定 DSH 源码和 Node 基础镜像身份，实际值写入构建证据。不得把这些选项用于绕过凭据、来源校验或生产 Runtime 网络策略。

成功构建后脚本打印实际本地 Image ID 和 CLI 版本，并向本 Experiment 的 `evaluation/evidence/dsh-image-build-<UTC>-<PID>.json` 写入只追加的本地构建证据。也可以指定 `--evidence-output FILE`。`source.lock.json` 仅锁构建输入，不填写未取得的 Registry digest；本地标签可重指向，不能代替 Image ID 或发布时验证的不可变 Registry digest。

## 候选资产装载

| 容器路径 | 宿主机来源（所选 Experiment） | 编写态 | 核验态 |
|---|---|---|---|
| `/work/harness/workspace` | `candidate/dsh/workspace` | 读写 | 只读 |
| `/opt/dsh-presets` | `candidate/dsh/presets` | 只读 | 只读 |
| `/opt/dsh-managed` | `candidate/dsh/managed` | 只读 | 只读 |
| `/var/lib/dsh` | 分别命名的 DSH_HOME 数据卷 | 读写 | 读写 |

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

直接运行 Compose 使用当前安全运营 Candidate 的默认来源；选择其他来源或快照做局部装载核验时，使用 `verify-load.sh --source`，它会从 `sources.json` 解析镜像、Patch 和三棵卷。Compose 中的凭据环境名称和 HOME 卷目前仍按默认样例配置；第二来源的完整业务启动需要实例化对应环境、独立 HOME 和实际依赖后另行验证。Compose 的变量覆盖不是独立的来源授权接口，不能仅靠替换路径后宣称完成另一 Agent 的装载验收。

只有在受信 Runtime/服务端提供模型与 MCP 端点、认证、租户/对象授权和审批控制后才启动实际 Agent。环境变量按名称从调用环境传入，不在 Compose 或仓库写入凭据；不得把 `docker compose config` 的完整展开结果、启动 Token URL 或原始日志作为可公开证据。若任一 MCP 缺失，候选 Profile 配置要求启动失败，不应绕过或改为宽松回退。

`DSH_PERMISSION_MODE=workspace-write|read-only` 是官方 base Profile 的新 Session *进程后备预设*；Web 中持久化的 General Settings 可影响后续 Session，不能只凭该变量声称权限已经强制生效。受控 `.env` 只阻断两处 Boot 文件层；调用环境、HOME 中持久化的 settings/credentials 与模型/MCP 实际连接状态仍是独立 Runtime 事实，正式核验要取其受控来源、版本和有效值状态，不能只凭 Candidate 文件摘要认定运行组合已冻结。真正的文件只读边界是核验态三棵资产的 Docker `read_only` bind mount；工具权限、MCP 高风险控制和租户审批还须由 Runtime 与服务端核验。编写态容器内 DSH 可以自组合、自修改工作区内的 Candidate 行为资产，但不能写受控 Preset、Guard、MCP 绑定或 Release。

编写态 `skill-filesystem.watch: true` 与 Agent instructions 的重投影可能让**当前 Session** 实时看到刚写入的工作区新行为；这只算 Experiment 探索。只有宿主侧审查 Candidate diff、核对回执及受控边界，并以核验态的新容器、新 Session 重建加载后，才可称为“已按新候选组合激活”；不能把编写态的实时变化写成 Verification、正式评估或 Release 证据。

官方 Web 当前默认只绑定容器内 `127.0.0.1`，本适配层未发布宿主端口，因此不会提供可从宿主浏览器使用的 URL。需要真实对外协议验收时，应在目标环境另行明确入口、认证、网络暴露与回滚方案；不能以本 Compose 的容器启动或配置展开代替完整业务链。

## 开发启动器与本地装载核验

`dsh-dev` 是宿主侧开发启动器（只依赖 Python 3 标准库、Docker CLI 和 Compose），把本目录的受控 Compose 渲染成仓库外实例：

```bash
python3 runtime/adapters/dsh-container/dsh-dev plan --source experiment:EXP-security-operations-expert-001 --mode verification --name soe-verify --port 3081
python3 runtime/adapters/dsh-container/dsh-dev up --source snapshot:<snap-id> --mode verification --name soe-verify --port 3081
python3 runtime/adapters/dsh-container/dsh-dev ps
python3 runtime/adapters/dsh-container/dsh-dev url soe-verify --non-interactive   # 交互终端可省略该旗标
python3 runtime/adapters/dsh-container/dsh-dev logs soe-verify --tail 200
python3 runtime/adapters/dsh-container/dsh-dev down soe-verify
```

实例配置与 `instance.json` 写在 `${XDG_STATE_HOME:-~/.local/state}/dsh-dev/<name>/`，只记录环境变量**名称**，不含 Token。渲染保留只读根文件系统、UID/GID 1000、能力裁剪和无端口发布，只把主 `dsh` 服务切到 host 网络并把 Web 绑定宿主回环。`url` 只读取**本次**进程启动后的日志并做 Token→Cookie→根页探针；标准输出不是交互终端时，必须显式加 `--non-interactive`，否则失败关闭，不把 Token 写进状态文件、普通日志或证据。

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

脚本先在无卷、只读、无网络容器中比对本地镜像内 `prepare-verification-home.mjs`、`verify-load.mjs`、`tree-digest.mjs` 与宿主适配层的 SHA-256，旧标签必须重建，避免旧脚本先触碰 HOME 卷。随后比对宿主机与容器内三棵精确资产树的文件、权限、大小和 SHA-256 摘要，检查 `/proc/self/mountinfo` 的读写模式与独立 HOME 卷。两种模式都核六处受控只读子文件（两个空用户 Patch、Web manifest、零字节全局指令、两处注释 `.env`）、四处模块目录挂载及共享 fallback 的 277 个镜像安装 symlink（数量以实际锁定安装闭包为准），并核关键模块从 Web Profile 的首个解析位置的 `realpath` 在 `/opt/dsh/`。然后调用 DSH 的 `--dump-config` 核对全局 Profile/Patch 组合标识。单个 Agent 的 Guard 声明单独在 Preset/Managed 文件中核对，因为全局配置展开不会包含 Preset 子树。脚本不输出可能含私有 URL、Token 的原始配置或日志。该结果仅是“挂载身份、模块解析及配置组合证据”；**不证明 Plugin 实际激活**、MCP 连接成功、Preset/Skill 被真实 Session 调用、用户任务、最终业务状态或 Release 验收。

在编写态自修改前后留下只追加回执：

```bash
python3 runtime/adapters/dsh-container/mutation-receipt.py before
python3 runtime/adapters/dsh-container/mutation-receipt.py after <上一步打印的 before.json 绝对路径>
```

回执写入本 Experiment 的 `evaluation/evidence/mutation-receipts/mr-<UUIDv4>/`，比较三棵资产树的文件、目录权限与前后摘要，记录工作区变化及是否需重新审查冻结组合。如果受控 Preset 或 Managed/Guard 树在编写期间变化，脚本保留失败回执并以非零状态明确拒绝；它不是评估、候选基线、发布或生产变更批准。若要单独取得三棵装载树的文件摘要，可使用 `mutation-receipt.py digest <精确资产源路径>`。

局部装载比较前可物化三棵 Candidate 挂载树的实际字节（含未提交文件），并在只读容器装载前复核摘要：

```bash
python3 runtime/adapters/dsh-container/mutation-receipt.py freeze
# 将上一步打印的路径作为 SNAPSHOT_DIR
bash runtime/adapters/dsh-container/verify-load.sh verification --frozen SNAPSHOT_DIR
```

副本位于所选 Experiment 的 `snapshots/frozen-sources/fr-<UUIDv4>/`；`snapshot.json` 记录三树文件、目录权限摘要和来源，`frozen-digest` 会核对副本字节与权限。冻结拒绝空资产目录、被 Git 忽略的文件和非受控 `.env`；仍需人工检查资产是否含敏感内容。`restore SNAPSHOT_DIR` 仅在 Candidate 根目录不存在时恢复三棵挂载树，绝不覆盖现有工作树。这只是可还原的**挂载源**，并未单独归档候选元数据、插件构建制品或运行有效配置；完整研究快照须另绑定这些身份与依赖。它也不是经评估的 `bl-<UUIDv4>`、Release 或防宿主侧修改的存储锁；比较运行前后还须复核摘要并确保单写者。

发布后必须用具体不可变 Release 替换这三棵 Candidate 源，所有 Harness 资产只读，并按 `dsh-release-verify` 核对通过评估的 `baseline_id`、`run_id`、Release 摘要、实际 DSH 加载及完整业务链。当前没有通过的 Release，不能把核验态 Candidate 说成生产发布。
