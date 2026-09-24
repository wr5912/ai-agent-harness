# DSH 容器薄适配层

本目录固定官方 DeepSeek Harness（DSH）源码构建身份和卷装载方式；不开发、不复制 DSH Runtime 源码到本仓库，也不把宿主机 Codex 项目协作配置交给 DSH。`sources.json` 声明可选择的 Experiment Candidate 及其锁定身份；新增来源须提供自己的 Candidate 资产，不能只改卷路径。

## 源码与镜像身份

`source.lock.json` 锁定官方仓库提交 `c291e7961a515f6d7af9304e7fd1d257929aef26`、Git tree、`pnpm-lock.yaml` 摘要、`pnpm@11.7.0`、Node 基础镜像 OCI index digest 和 `linux/amd64`。`build-image.sh` 新建临时源码工作树，在宿主侧核对提交、tree 和锁摘要后用 BuildKit named context 构建。官方构建脚本支持显式 `DSH_CLIENT_COMMIT_HASH`；构建器不依赖 named context 是否携带 `.git`，只安装本地 C 编译及 musl 工具，最终镜像不保留这些构建工具或 `.git`。本仓库没有 DSH 源码副本。

```bash
bash runtime/adapters/dsh-container/build-image.sh
# 多来源时显式选择：build-image.sh --source EXP-<agent-id>-NNN
```

APT 索引使用 `Error-Mode=any`、单次重试、30 秒 HTTP 连接超时和 IPv4；失败必须中止，而非沿用不完整索引。默认使用 `http://mirrors.aliyun.com/debian` 及同站 security；国内源不可达时可显式加 `--apt-mirror http://deb.debian.org/debian` 回退到官方源。构建前先用同一锁定 Node 底座执行 Debian archive keyring 签名的 APT 更新预检，main、updates、security 任一签名或索引失败即停；Dockerfile 中再次校验，构建证据记录两条实际镜像 URI。回退源改变了构建期软件包的分发路径、可用性和更新时间边界，虽未降低 Debian 签名校验，也不能把它说成与默认源的网络来源完全相同。

本机 Docker 构建网络异常时还可显式加 `--build-network host`，但这会让构建步骤直接使用宿主网络命名空间；默认仍为 Docker 隔离网络。镜像源与网络选项都不改变锁定 DSH 源码和 Node 基础镜像身份，实际值写入构建证据。

成功构建后脚本根据 `source.lock.json` 和镜像构建输入计算 `image_build_fingerprint`，并把它写入 OCI label；同时打印实际本地 Image ID，并向本 Experiment 的 `evaluation/evidence/dsh-image-build-<UTC>-<PID>.json` 写入只追加的本地构建证据。也可以指定 `--evidence-output FILE`。`source.lock.json` 仅锁构建输入，不填写未取得的 Registry digest；本地标签可重指向，运行前会同时核对标签、Image ID、构建指纹和平台，不能把标签当作不可变身份。

## 候选资产装载

| 容器路径 | 宿主机来源（所选 Experiment） | 评测实例 |
|---|---|---|
| `/work/harness/workspace` | `candidate/dsh/workspace` | 只读 |
| `/opt/dsh-presets` | `candidate/dsh/presets` | 只读 |
| `/opt/dsh-managed` | `candidate/dsh/managed` | 只读 |
| `/work/reference` | `agents/<agent-id>` | 不挂载 |
| `/work/eval-input` | 显式声明的被测输入根 | 仅在显式声明时只读 |
| `/var/lib/dsh` | 实例独立 DSH_HOME 数据卷 | 运行状态可写 |

评测实例不挂载 `evaluation.md` 或其他判分材料；`verify-load.mjs` 与 `test_home_submounts.mjs` 对此做负向断言。Harness 修改由宿主开发会话完成，容器只负责装载和评测。

`locked-user.patch.yml`、真正 **0 字节**的 `locked-global.AGENTS.md` 和只含注释的 `locked-bootstrap.env` 分别只读覆盖用户 Patch、全局 Agent instructions 与 Boot 环境文件。模型/MCP Endpoint 和凭据只能由调用环境或 Runtime 受控凭据提供，不能由 Candidate 工作区改变。

Web Profile manifest 与本地 module 路径由受控文件和空的 deny-layer 锁定，避免从可写 HOME 装载私有 Plugin。官方 Web 所需的共享 fallback 位于独立数据卷；`home-init` 离线调用锁定 DSH 的官方 healer，并核对包名、symlink 与 `realpath` 均指向镜像内 `/opt/dsh/`。旧 HOME 中被 deny-layer 隐藏的本地模块不会自动删除。

启动 `web` Profile 并叠加来源声明的 Managed Patch。锁定官方 Loader 在本 Node 镜像的无 internal-loader 路径会从 `/opt/dsh/vendor/loader` 相对查找 bare package，因此仅主 `dsh` 服务使用精确向量 `node --expose-internals /opt/dsh/apps/cli/lib/bin.js`；`home-init` 与装载探针保持普通 `node`。隔离、无 Candidate Managed Patch 的官方 base+web 技术预检可运行至少 15 秒；这不表示 Candidate 业务启动、MCP 或模型连接通过。

`--expose-internals` 让同一主进程中已加载的 JavaScript Plugin 可访问 Node `internal/*`，不是安全控制。改变 DSH 官方提交、Node 镜像/版本、Bundle 或候选 JS Plugin 时，必须重新审查该旗标与模块解析；若官方 Loader 修复，应移除旗标并重做容器验收。

`verification.compose.yaml` 无宿主机端口发布、Docker socket、仓库根目录、历史归档或评估目录挂载；根文件系统只读，容器用户为 UID/GID 1000，去除能力并设置 `no-new-privileges`。`DSH_HOME` 存放 Session、settings、附件及受控 Runtime 凭据，与 Harness 工作区分开。

```bash
docker compose -f runtime/adapters/dsh-container/verification.compose.yaml config --quiet
```

直接运行 Compose 只用于模板级检查；启动业务实例应使用 `dsh-dev --source`，由它从 `sources.json` 解析镜像、Patch、三棵卷和 `required_env_names`，为每个来源生成独立 HOME 与环境变量透传清单。Compose 的变量覆盖不是独立的来源授权接口，不能仅靠替换路径后宣称完成另一 Agent 的装载验收。

实际 Agent 需要模型与 MCP 端点时，由调用环境提供相应配置。环境变量按名称传入，本适配器不读取或展开凭据值到 Compose。平台和实例凭据可以使用 Agent 的实例专用仓库文件；LLM API Key 只能来自被 Git 忽略的 `*.llm-api-key` 文件或其他受控运行时来源，不得进入 Git 历史或远端。不得把 `docker compose config` 的完整展开结果、启动 Token URL 或原始日志作为公开研究证据。当前 Candidate 声明为必需的 MCP 缺失时会启动失败，应如实记录依赖缺口。

`DSH_PERMISSION_MODE=read-only` 是官方 base Profile 的新 Session 进程后备预设；Web 中持久化的 General Settings 仍可能影响后续 Session，因此不能只凭该变量推断实际状态。三棵 Candidate 资产同时使用 Docker `read_only` bind mount。比较变更前后行为时，应在宿主核对 Git diff 和资产摘要，再用新的评测容器与 Session 重建加载。

官方 Web 默认只绑定容器内 `127.0.0.1`，基础 Compose 不发布宿主端口。需要浏览器访问时使用 `dsh-dev` 生成的本地 host-network 实例；容器启动或配置展开仍不能替代 `PA-08` 的实际 Web 交互。

## 构建镜像

```bash
bash runtime/adapters/dsh-container/build-image.sh --build-network host
```

构建期统一使用国内阿里云源：APT 走 `http://mirrors.aliyun.com/debian`（security 同站），npm/pnpm 与 corepack 走 `https://registry.npmmirror.com`。两者都不需要调用方额外加参数；只有国内 APT 源不可达时，才用 `--apt-mirror http://deb.debian.org/debian` 显式回退到官方源。

换源不放松校验：APT 仍由 `debian-archive-keyring` 校验 Release/InRelease 签名与 `Valid-Until`，依赖仍按 `pnpm-lock.yaml` 的完整性摘要校验。实际使用的源写入该次构建证据。

## 评测实例与本地装载核验

`dsh-dev` 是宿主侧实例启动器（只依赖 Python 3 标准库、Docker CLI 和 Compose），把受控 Compose 渲染成仓库外实例。新实例只支持 `--mode eval`（内部模式 `verification`）：`session_preset` 与 `target_preset` 都来自所选来源，注册工作区固定为 `/work/harness/workspace`，三棵 Candidate 资产全部只读，且不挂载判分材料。

目标 Preset 由 `sources.json` 的 `preset` 路径推出，适配层不内联业务 Agent 名。Harness 创建或修改由宿主开发会话通过项目技能完成，再启动新的评测实例观察结果。

```bash
python3 runtime/adapters/dsh-container/dsh-dev init test01
python3 runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode eval --dry-run
python3 runtime/adapters/dsh-container/dsh-dev up --source experiment:EXP-security-operations-expert-001 --mode eval
python3 runtime/adapters/dsh-container/dsh-dev ps
python3 runtime/adapters/dsh-container/dsh-dev url security-operations-expert-eval --non-interactive   # 交互终端可省略该旗标
python3 runtime/adapters/dsh-container/dsh-dev logs security-operations-expert-eval --tail 200
python3 runtime/adapters/dsh-container/dsh-dev down security-operations-expert-eval
```

`init <agent-id>` 创建最小 Agent、`EXP-<agent-id>-001` Candidate，并把该 Experiment 登记到 `sources.json`；已有 Agent、Experiment 或来源登记时拒绝覆盖。它只创建研究资产，不启动实例、不执行 Evaluation，也不创建 Research Release。

`--source` 和 `--mode` 始终由用户显式选择；缺失或无值时命令会列出当前可用值并以用法错误退出。`--name` 默认为 `<agent-id>-eval`。新实例未指定 `--port` 时从 `3081` 起选第一个未监听且未被有效实例记录占用的端口；已有同名实例复用记录端口。`--dry-run` 只给出建议，不写状态、不调用 Docker，也不要求运行时环境变量。

`up` 会先核对镜像标签对应的构建指纹、平台和 Image ID，再执行停旧实例、写状态和启动；Compose 使用 `tag@image-id` 不可变引用。新建或替换后的主 `dsh` 容器名与实例名完全一致，Compose 项目名固定为 `dsh-dev-<实例名>`；`up --dry-run`、`up` 和 `ps` 都直接输出实例名、实际主容器名和项目名，旧实例由 `ps` 输出其现有主容器名并标记 `needs_migration`。它仍不只看 `docker compose up -d` 的退出码：命令返回 0 之后还要确认 `dsh` 服务真的在运行（`home-init` 是一次性服务，正常结束不算失败），否则报告失败或 `dsh_running: "unknown"` 并以非零退出码结束。成功时 stdout 只输出一个 JSON 结果，其中包含 `image_id`、`image_ref` 和 `image_build_fingerprint`；进度、提示和错误输出到 stderr，失败时 stdout 保持为空。`up --replace` 的成功 JSON 在 `replaced.stop` 中包含完整停止结果。

`ps`、`logs`、`down` 从实例状态文件重建 Compose 所需环境；`ps` 默认只列出运行中的实例，`ps --all` 才包含其他状态并标出 `needs_migration`。历史 `authoring` 实例仍可查询日志和停止，但新建或替换时只接受 `eval`。挂载内容变化不会自动重启进程，使用 `up --replace` 或先 `down` 再同名 `up` 重载。`down` 同时核对 Compose 退出码、实际容器状态和 HOME 卷。

两份启动器设计方案保留为历史设计记录；当前行为以本页、CLI `--help` 和测试为准。

## 受管评测

`dsh-eval` 从 Agent 的 `evaluation.md` 读取业务 Case 的名称、用户输入和预期，并复用 `dsh-dev` 与 `run_record.py` 完成一次可封存评测。默认执行器通过 DSH Runtime Session API 运行业务 Case；显式选择 `browser` 时，才使用镜像中已有的 Playwright 依赖做 UI 冒烟：

```bash
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:EXP-security-operations-expert-006 --mode fast --dry-run
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:EXP-security-operations-expert-006 --mode fast
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:EXP-security-operations-expert-006 --mode full --dry-run
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:EXP-security-operations-expert-006 --executor browser --case U-INS-001
```

默认 `--mode fast` 执行标记了 `**评估档位：** \`fast\`` 的业务 Case；`--mode full` 执行全部 Case。没有 fast 标记时默认档位明确报错。`--case` 可重复并支持大小写敏感的 shell 风格通配符，一旦出现就覆盖 `--mode`；结果按 `evaluation.md` 顺序去重，为避免 shell 提前展开应给通配符加引号。`--dry-run` 输出请求档位、实际选择方式和 Case 列表。这里的 `--mode` 是评测范围，和 `dsh-dev --mode eval` 的容器运行模式不同。非 `--dry-run` 执行会先校验仓库和 Experiment，再创建独立评测实例。每个 Case 使用新的目标 Session，多轮输入在该 Session 内依次发送；API 和浏览器执行器都导出回答及同一 Session 的工具事件。独立的无工具评审 Session 对照单个 Case 的输入、预期、回答和工具证据给出语义结论。

`full` 完成逐 Case 评审后，适配层再启动使用 `scenario-analysis` Preset 的独立 DSH 实例，只把当前 Run 以只读方式挂载到 `/work/evaluation-run`；被测 Candidate 的 workspace、Preset、managed patch、MCP、Skill 和 delegate 均不进入归因实例。每个已选场景使用一个 Session，通过 `read`、`grep` 和 `glob` 核对 Run 证据与锁定的 Harness，并显式选择目标 Run 实际使用的同一模型路由；当前只支持内置 `deepseek-official` 路由，缺失、混用或不支持的路由失败关闭。为避开 `read` 的行数、单行和字节上限，适配层在 Run 内生成带原文件路径、字节数和 SHA-256 的 JSON/JSONL 语义无损场景包，并对重复的大型工具结果按内容摘要引用；原文件仍是事实源，报告也只引用原文件。执行器要求每次工具调用都有成功结果，并验证所有必读分片的每一行均被读取，漏读、读取失败或路由漂移都会使复核失败。缺口可以同时引用支持 Case 与反例 Case 的原始证据；空 `tools.jsonl` 是“未调用工具”的有效证据，其他材料证据必须非空。`evaluation-judge` 与 `scenario-analysis` 都是评测适配层 Harness，不属于被测 Candidate；`.agents/skills/research-eval` 只指导仓库研发流程，不会被 DSH 归因实例装载。技术装载、合同和工具链检查由运行前的项目与 Experiment 校验承担，不是业务 Case。认证 URL 只经进程标准输入交给执行器，不写入 Run 或普通输出；无论成功、失败或中断都尝试停止实例。

退出码 `0` 表示锁定 Case 均得到 `passed`；`1` 表示运行已完整封存但至少一个语义结论为 `failed` 或 `inconclusive`；`2` 表示参数、环境或执行基础设施失败。基础设施失败导致未执行的 Case 记为 `execution_status=error`；中断后未开始的 Case 记为 `execution_status=skipped`，两者的 `verdict` 均为 `inconclusive`。每次封存保留 `summary.json`、逐项事实 `results.jsonl`、完整场景目录与选择方式，以及只读的 `analysis.json` 和 `report.md`。报告按场景展示去重 Case 的覆盖、失败、无法判定和未执行数；归因只给出可证伪假设，不改变 Case 原判定。`full` 证据复核不完整时 `review_status` 为 `failed`，Run 失败封存；`fast`、显式 Case 和手工封存路径只生成确定性场景覆盖，不启动归因 Session。非 `--dry-run` 的 stdout 只输出一个不含凭据的 JSON，字段为 `run_id`、`experiment_id`、`executor`、`verdict`、`cases`、`review_status`、`reviewed_cases`、`summary`、`report` 和 `instance_stopped`。

**手工打开 Web 或使用浏览器执行器时，首次需要在界面注册工作区。** DSH Web 的输入栏在没有已打开会话时是惰性的，必须先选定一个**已注册工作区**才能开会话；工作区注册表（`$DSH_HOME/storages/workspace.json`）只从已存会话头 bootstrap，新实例的 HOME 卷里因此为空——容器的 `working_dir` 只是进程工作目录，不等于 DSH 工作区。API 执行器使用 Runtime 的 `workspace/create` 完成同一注册；启动器不改写 Runtime 存储内部格式。浏览器操作如下：

1. 在 Web 界面点击“选择工作区”；
2. 在“选择工作区目录”对话框点“编辑路径”，粘贴 `/work/harness/workspace`（或从“主目录”逐级进入）；
3. 点“打开”，会话即在该工作区创建，随后可直接对话。

该注册写入本实例 DSH_HOME 数据卷并跨重启保留；换用新的实例名等于新的 HOME 卷，需要重新选择一次。`up --dry-run` 输出与真正 `up` 的 stderr 提示都会带上该路径与步骤，以 `workspace_to_register` 为准。

实例配置与 `instance.json` 写在 `${XDG_STATE_HOME:-~/.local/state}/dsh-dev/<name>/`，记录来源、模式、挂载路径、环境变量**名称**、镜像身份等非秘密元数据，不含 Token。渲染保留只读根文件系统、UID/GID 1000、能力裁剪和无端口发布，只把主 `dsh` 服务切到 host 网络并把 Web 绑定宿主回环。`url` 只读取**本次**进程启动后的日志并做 Token→Cookie→根页探针；标准输出不是交互终端时，必须显式加 `--non-interactive`，否则失败关闭，不把 Token 写进状态文件、普通日志或证据。

候选 Profile 以 fail-closed 方式声明三个 `streamable-http` MCP 客户端；缺少真实端点与凭据时容器会在启动阶段退出，使"装载是否成立"无法核验。为此适配层提供两个只用于受控技术装载核验的本地工具：

```bash
python3 evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/derive_mcp_stub_tools.py --check
python3 evolution/experiments/EXP-security-operations-expert-001/evaluation/tools/derive_mcp_stub_tools.py --out "$STATE/tools.json"
node runtime/adapters/dsh-container/stub-mcp-streamable-http.mjs --port 3099 --tools "$STATE/tools.json" --log "$STATE/stub.log"
```

派生脚本只从候选 `mcp-servers.yaml`、`mcp-tool-name-map.json`、`role-tool-matrix.yaml` 取工具原始名，无法解析到"服务名 + 原始名"的引用即非零退出；桩服务只实现 `initialize`、`notifications/initialized`、`tools/list` 的最小协议面，只监听回环、不校验凭据、无业务语义，并只记录"是否带鉴权头"而不记录凭据值；`tools/call` **默认返回 `isError: true` 并拒绝编造业务数据**（只有显式 `--stub-success` 才回显桩标记，供协议自测），因此用它补齐不可用的 MCP 分组时，相关工具调用会明确失败而不会产生假通过结果。它证明的是**受控 Profile 的 MCP 客户端配置、鉴权头注入与工具注册链路可装载**，不证明真实 MCP 服务集成、租户/对象授权、状态机、业务能力、评估结论或 Release 验收。真实业务核验必须在受信 Runtime 提供模型与 MCP 端点后进行。

本轮候选的实例级装载证据见 [`dsh-dev-live-load-20260918.json`](../../../evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-live-load-20260918.json)：容器保持运行、三个 MCP 客户端完成握手、三棵只读资产树与受控 HOME 摘要通过容器内探针、Web Token 入口探针通过；同时记录未验证项（无模型凭据，未建立 Agent Session）。

在上述装载核验开始前，脚本会核对镜像构建指纹、平台和 Image ID，并把 Compose 固定到 `tag@image-id`；无 OCI 指纹 label 或指纹过期的本地镜像会直接拒绝。

## 局部加载核验与变更回执

镜像已经构建、候选资产未并发变化时，可以执行：

```bash
bash runtime/adapters/dsh-container/verify-load.sh verification
# 其他已登记来源：verify-load.sh verification --source EXP-<agent-id>-NNN
```

适配层脚本不烘焙进镜像：`prepare-verification-home.mjs`、`verify-load.mjs`、`tree-digest.mjs` 由 Compose 只读挂载到 `/opt/dsh-adapter`。脚本先比对宿主与容器脚本 SHA-256，再比对三棵 Candidate 资产树，并断言 `/work/reference` 与未声明的 `/work/eval-input` 不存在；同时核对挂载模式、HOME 卷、受控 Patch、零字节全局指令、注释 `.env`、module deny-layer、共享 fallback 与 DSH 配置标识。它只证明挂载身份、模块解析和配置组合，不证明 Plugin 激活、MCP 连接、模型行为或 Research Release 复现。

取得一棵精确资产树摘要时，使用 `mutation-receipt.py digest <路径>`。

局部装载比较前可物化三棵 Candidate 挂载树的实际字节（含未提交文件），并在只读容器装载前复核摘要：

```bash
python3 runtime/adapters/dsh-container/mutation-receipt.py freeze
# 将上一步打印的路径作为 SNAPSHOT_DIR
bash runtime/adapters/dsh-container/verify-load.sh verification --frozen SNAPSHOT_DIR
```

副本位于所选 Experiment 的 `snapshots/frozen-sources/fr-<UUIDv4>/`；`snapshot.json` 记录三树文件、目录权限摘要和来源，`frozen-digest` 会核对副本字节与权限。`restore SNAPSHOT_DIR` 仅在 Candidate 根目录不存在时恢复三棵挂载树，绝不覆盖现有工作树。这只是一次局部装载探针使用的可还原挂载源，不是项目 Baseline 或 Research Release；长期研究版本仍由 Git 保存。

整套源码研究快照（`snapshots/research/`）的创建与复核已退役：它与 Git 重复保存同一份内容，并要求跨环境重现宿主机完整 POSIX 权限。历史内容按 `evolution/experiments/<id>/snapshots/README.md` 的映射从 Git 提交恢复。

未来若实现 `release:<id>`，启动器应直接装载具体、不可变的 Research Release，并核对清单摘要与实际 DSH 身份。当前没有 Research Release，也没有对应解析入口，不能把 Candidate 装载写成 Release 复现完成。
