# DSH 开发与评测启动器设计方案

本文说明 `dsh-dev` 的目标、当前能力、完整使用过程，以及每类资产在各模式下的位置与读写范围。全文只用「修改—重新装载—运行—保存」四个动作描述研究工作，不使用需要另行解释的别名。

| 项目 | 内容 |
|---|---|
| 状态 | `image build`、`plan`、`up`、`ps`、`url`、`logs`、`down` 已实现；`open`、`resume`、`fresh` 与 `release:<id>` 选择器未实现 |
| 适用范围 | 同一台 Linux Docker Engine 主机上的本地开发、调试与候选技术核验 |
| 不在范围 | 生产部署入口、DSH Runtime 源码修改、Agent 交付评估结论、Release 验收 |
| 依据 | [来源锁定](./standards/SOURCES.md)、[项目规范解释](./standards/PROJECT-INTERPRETATION.md)、[适配层 README](../runtime/adapters/dsh-container/README.md)、锁定 DSH 提交 `c291e7961a515f6d7af9304e7fd1d257929aef26`（CLI `0.1.5-rc.2`） |

## 1. 背景与目标

研究一套基于 DSH 的 Harness，需要反复做四件事：改提示词、技能、Preset 或插件配置；让改后的内容真正被 DSH 装载；运行目标智能体看行为；把值得保留的版本和观察结果存下来。手工拼 `docker compose` 命令时，这四步容易出错的地方是路径、目标和版本对不上：改了 A 目录、装的是 B 目录；以为换了 preset、其实会话还在用驻留的旧配置；命令失败了却以为已经停干净。

`dsh-dev` 的目标是把这些容易出错的地方固定下来：来源解析唯一确定目标 Agent、preset 与资产路径；两种模式给出不同的可见范围；命令如实报告成功、失败或状态未知。它不判断研究结论，也不替代交付评估。

## 2. 当前能力与本次范围

已实现：

| 命令 | 作用 |
|---|---|
| `image build` | 按 `source.lock.json` 的固定提交构建本地 DSH 镜像 |
| `plan` | 只解析来源并打印计划：模式、目标 preset、要注册的工作区、判分材料是否挂载、挂载清单、缺失环境变量、冷启动步骤；不启动容器 |
| `up` | 渲染实例 Compose 并启动；确认 `dsh` 服务真的在运行后才报告成功，输出实例状态目录与工作区注册步骤 |
| `ps` | 列出启动器管理的实例；查询失败时标为 `unknown`，不当作"没有运行" |
| `url` | 从本次进程日志提取认证 URL 并做 Token→Cookie→根页探针；非交互终端需显式 `--non-interactive` |
| `logs` | 输出有界、尽力脱敏的容器日志 |
| `down` | 停止实例并保留 HOME；命令失败、仍有容器运行或状态无法确认时都不报告停止成功 |

本次范围之外：不新增容器编排、不引入审批或评分平台、不实现 Runtime 存储内部格式的写入。

## 3. 核心对象与职责

按根级 [`AGENTS.md`](../AGENTS.md) 的四类对象，启动器相关资产分工如下：

| 对象 | 在本方案中的具体内容 | 谁维护 |
|---|---|---|
| 开发智能体的运行配置 | `authoring.compose.yaml`、`verification.compose.yaml`、`verification-home-controls/`、`Dockerfile`、`source.lock.json`、本目录的 Python/Node 工具 | 开发者；改动属于开发环境变更 |
| 被开发或优化的 Harness 资产 | 所选 Experiment 的 `candidate/dsh/{workspace,presets,managed}` | 开发者在任务范围内编辑，经 Git 管理 |
| 需求与评测资料 | `agents/<agent-id>/spec/`（需求、任务、验收标准）与 `agents/<agent-id>/eval/`（方法、预置、待复核输入） | 开发者维护；单次评测期间保持不变 |
| 运行状态与运行记录 | 实例 `DSH_HOME` 数据卷、`evolution/experiments/<id>/runs/`、`evaluation/evidence/` | 临时状态按运行保留；结果与证据按研究需要保存 |

开发会话里读到的业务角色指令（例如目标是安全运营专家）是第二类资产的正文，读它是为了修改它，不代表开发工具要切换成业务智能体。这一点不能只靠文字提醒：开发会话注册的工作区是 `/work`，会话身份来自受控只读的 `/work/AGENTS.md`（见 5.2 节），目标自己的 `AGENTS.md` 仍留在 `/work/harness/workspace` 供阅读和编辑，但不会被注入为会话身份。

## 4. 完整使用过程

### 4.1 选择来源并确认目标

```bash
python3 runtime/adapters/dsh-container/dsh-dev plan \
  --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3081
```

`plan` 会打印本次的 `mode`、`agent_id`、`session_preset`、`target_preset`、`workspace_to_register`、`dev_instructions`、`grading_material_mounted`、挂载清单和缺失的环境变量名。先核对这些值与本次任务一致，再启动；报告目标用 `target_preset`，描述本次会话用 `session_preset`。

来源只接受 `experiment:<id>`。`source_contract.py` 校验 `sources.json` 中登记的 `candidate_root`、patch、preset、Guard 与开发叠加层确实存在且不是符号链接或硬链接，并从 preset 相对路径推出 `preset_id`——适配层不内联任何业务 Agent 名。

### 4.2 编辑资产

直接在 `candidate/dsh/` 下编辑：`workspace/` 放技能与业务 `AGENTS.md`，`presets/<preset-id>/` 放 preset 声明，`managed/` 放 profile patch、Guard、角色矩阵与 MCP 绑定。

`--mode dev` 只把 `workspace/` 挂成可写。Preset 与 managed 在容器内只读，这是受控配置的红线；要改它们，改宿主源码后按 4.3 重新装载。

### 4.3 重新装载并运行

```bash
# 构建镜像（首次或镜像内容变化后；适配层脚本走只读挂载，改脚本不需要重建镜像）
python3 runtime/adapters/dsh-container/dsh-dev image build

# 开发会话：出厂 cordis 创造模式，等同 shell 权限，需要显式确认
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 --mode dev --name secops-dev --port 3081 \
  --accept-cordis-trust

# 被测目标会话：运行所选来源声明的目标 preset
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 --mode eval --name secops-eval --port 3082

# 取认证 URL 并打开界面
python3 runtime/adapters/dsh-container/dsh-dev url secops-dev
```

**源码改了不等于已经生效。** 容器里的进程不会因为 bind 挂载内容变化而自动重启，普通 `docker compose up -d` 也不会仅因挂载内容变化重建容器；Preset 又存在按 ID 的驻留装载。因此改完 preset、managed 或岗位脚本后必须真正重启实例：

```bash
# 一条命令：先停同名实例自身的容器（保留 HOME 数据卷）再按新配置启动
dsh-dev up --source <id> --mode dev --name secops-dev --port 3081 --accept-cordis-trust --replace

# 等价做法：先 down，再同名同端口 up
dsh-dev down secops-dev && dsh-dev up ...
```

重启后在界面上**新建会话**（不要复用旧会话），并确认预先定义的可观察变化真的出现。适配层脚本走只读挂载，只需重启实例，不必重建镜像。

DSH Web 首次打开需要在界面注册工作区：点击"选择工作区" → 目录对话框"编辑路径" → 粘贴本次模式对应的路径 → "打开"。开发会话注册 `/work`，被测会话注册 `/work/harness/workspace`；以 `plan.workspace_to_register` 为准。锁定提交没有受支持的工作区预注册入口，因此启动器只交付路径与步骤，不改写 Runtime 存储格式。该注册写入本实例 HOME 卷并跨重启保留；换实例名等于换 HOME 卷，需要重新选择一次。

### 4.4 运行评测

开发者自行保证：本次运行期间不修改本次使用的 Harness、测试数据、评估方法和验收标准；不让多个实例同时改写同一份资产；基线与候选使用相同口径，口径变化后重新执行受影响的对比。

评测模式运行的是被测目标，容器里没有判分材料（见第 5.3 节）。任务输入通过对话给出，环境状态由 MCP 服务端或受控预置提供。

### 4.5 保存或放弃修改

值得保留的改动用普通 Git 提交保存到研究分支或正常历史。运行记录写入 `evolution/experiments/<id>/runs/<run-uuid>/`：

```bash
python3 runtime/adapters/dsh-container/run_record.py --repo . init \
  --agent security-operations-expert --experiment EXP-security-operations-expert-001 \
  --source experiment:EXP-security-operations-expert-001 --kind research
```

`inputs.lock.json` 会记录三棵 Harness 树与 spec/eval 的树摘要，以及 `git_version`（提交、是否含未提交修改、变更路径数）。**未提交修改无法仅凭 `HEAD` 还原**，所以该字段必须如实保留，不能把带未提交修改的运行写成某个提交的完整内容。

开发过程中产生的新 preset、技能或插件即使暂存在容器 HOME 的 `/var/lib/dsh/.agent-presets/`，仍属于待保存的开发产物，不是缓存：在结束实例前把它复制回 `candidate/dsh/presets/`，宿主复核后再重建容器核验。不清理时一并删除。

### 4.6 停止

```bash
python3 runtime/adapters/dsh-container/dsh-dev down secops-dev
```

`down` 先检查 `docker compose down` 的退出码，再查实际容器状态和 HOME 卷是否仍在：命令失败即报错；命令返回 0 但仍有容器运行、或状态查询失败时，输出 `stopped: false` 或 `stopped: "unknown"` 并以非零退出码结束，不会输出 `stopped: true`。

同样，`up` 不再只看 `docker compose up -d` 的退出码：命令返回 0 之后还要确认 `dsh` 服务真的进入运行状态（`home-init` 是一次性服务，正常结束不算失败）。未进入运行状态时报告失败，无法查询状态时报告 `dsh_running: "unknown"` 并以非零退出码结束。

输出示例：

```json
{"name":"secops-dev","project":"dsh-dev-secops-dev",
 "home_volume":"dsh-dev-secops-dev_dsh-dev-secops-dev-home",
 "home_preserved":true,"containers":[],"stopped":true,"containers_removed":true}
```

HOME 卷名按 Compose 自身的卷标签解析，不按 `<project>-home` 猜测——Compose 会给卷名加上项目前缀。`stopped` 与 `home_preserved` 是两个独立事实：保留 HOME 不等于停止成功，停止成功也不代表卷还在。

`ps`、`logs`、`down` 都按实例状态文件重建读取该实例 Compose 所需的环境变量：受控模板用 `${VAR:?}` 声明必填变量（不内联任何仓库内默认路径），所以这些命令不能依赖调用者当前环境，否则停止和查询会随环境漂移而失败。状态文件版本不匹配时直接失败并提示对该实例重新执行 `up`，不猜测缺失字段。

## 5. 目录与配置关系

### 5.1 两种模式

用户可见模式 `dev`/`eval` 映射到内部阶段名 `authoring`/`verification`（沿用仓库既有治理词汇与门禁）：

| | `--mode dev`（authoring） | `--mode eval`（verification） |
|---|---|---|
| `session_preset`（本次会话实际运行） | 出厂 `cordis` 创造模式 | 所选来源声明的目标 preset |
| `target_preset`（待优化/待评估目标） | 所选来源声明的业务 preset | 同 `session_preset` |
| 注册工作区（`plan.workspace_to_register`） | `/work` | `/work/harness/workspace` |
| `/work/harness/workspace` | 读写 | 只读 |
| `/opt/dsh-presets` | 只读 | 只读 |
| `/opt/dsh-managed` | 只读 | 只读 |
| `/work/spec` | 只读挂载 | 不挂载 |
| `/work/eval-reference` | 只读挂载 | 不挂载 |
| `/work/eval-input` | 不适用 | 仅在显式声明时只读挂载 |
| `/var/lib/dsh` | 每实例独立数据卷 | 每实例独立数据卷 |
| 受控 HOME 子文件 | 空用户 Patch、web profile manifest、零字节全局指令、注释 `.env`、模块 deny-layer 只读覆盖 | 同左 |

两种模式共用受控 HOME 边界，只有 `dev` 在主服务命令上多一层 `--patch` 开发叠加层。

### 5.2 开发会话身份与被测输入

两种模式注册的工作区不同，这决定了会话读到哪一份指令：

| | `--mode dev` | `--mode eval` |
|---|---|---|
| 注册工作区（`plan.workspace_to_register`） | `/work` | `/work/harness/workspace` |
| 会话指令来源 | `/work/AGENTS.md`（受控只读） | `/work/harness/workspace/AGENTS.md`（目标业务指令） |
| 目标业务 `AGENTS.md` | 作为编辑对象可读可写 | 作为会话身份注入 |

开发指令文件由 `verification-home-controls/locked-dev.AGENTS.md` 提供，精确只读挂载。它的内容是**通用的**：说明开发者身份、目标位置（`/work/harness/workspace`、`/opt/dsh-presets`、`/opt/dsh-managed`）、上下文路径、修改与保存纪律，并区分本次会话身份（`session_preset`）与待优化目标（`target_preset`），两者都以启动器输出为准。它不内联任何业务 Agent 名——仓库校验器会核对这一点，同时要求文件非空、有界、不含 URL 或 `!!js`。

被测容器不挂载该文件：它运行的是目标智能体，读到开发者指令会让目标身份错位。

会话级指令链的最终效果依赖 DSH 的运行时会话行为（注册工作区决定会话根）。挂载、路径与摘要可以在容器层核验；"新会话确实读到 `/work/AGENTS.md`" 属于需要真实会话的验证项，见 7.2 节。

### 5.3 判分材料不进入被测容器

`/work/spec` 含验收阈值，`/work/eval-reference` 含评估方法、测试预置和预期答案——它们都是判分材料。只读挂载只限制写入、不限制读取，所以判分材料不能靠"挂成只读"来隔离：把它们挂进被测容器，再依赖被测实现自己的文件访问限制去挡，等于让被测对象保护的边界去保护测试本身。

因此：

- 判分材料只挂给开发会话（供其阅读与核对，维护在宿主侧完成）和评分角色；
- 被测角色默认不挂任何评测材料，`verify-load.mjs` 与 `test_home_submounts.mjs` 对此做负向断言——不只是"没挂"，而是这些路径在容器里不存在；
- 确需给被测侧数据的，必须显式声明一个已确认不含预期答案的输入根（`mount_plan --eval-input`），不能把整个 `eval` 目录当作"被测输入"。

### 5.4 开发叠加层

`candidate/dsh/managed/security-operations-expert.development.patch.yml` 按行整体替换 `agent-presets` 的 `config`（不是深合并）：

```yaml
- id: agent-presets
  config:
    default: cordis
    includeShippedRoot: true
    includeUserRoot: true
    roots:
      - path: /opt/dsh-presets
        trust: system
```

开发层同时打开出厂根与**可写用户根**（HOME 下的 `.agent-presets`），因此创造者在容器内可以新建一份候选 preset 并试跑：受控的 `/opt/dsh-presets` 与 `/opt/dsh-managed` 仍然只读，运行中的受控配置没有被改写，用户根只是额外的候选来源。新建 preset 必须用与现有 preset 不同的 ID——DSH 按根顺序扫描，较早的系统根会遮蔽用户根里的同名 preset。容器内产物只算探索；完整步骤见受控开发指令 `/work/AGENTS.md`。

并入候选时以下四处必须一起改，只改一处会被拒绝：

| 位置 | 内容 |
|---|---|
| 候选 `presets/<new-id>/` | 新 preset 目录本身 |
| 候选 `harness.yaml` 的 `preset_id` | 必须等于新 ID，且等于该 Agent 的 `agent_id` |
| `sources.json` 的 `agent_id` 与 `preset` | `preset` 必须是 `<agent_id>/agent.cordis.yml`，来源解析与仓库校验器都会核对 |
| 基础 patch 的 `agent-presets.default` | DSH 实际生效的默认 preset，必须等于同一个 ID |

按当前模型，一个新 preset **ID** 等于一个新的 Agent 身份；同一个 Agent 只改 preset **内容**时不需要新 ID。多 Variant（一个 Agent 对应多个 preset ID）需要改资产模型，不属于当前实现。

评测模式两种根都保持关闭：`includeShippedRoot: false`、`includeUserRoot: false`，创造模式与用户 preset 在该容器内都不可选。`--mode dev` 缺 `--accept-cordis-trust` 即失败关闭，`--mode eval` 拒绝该旗标。

### 5.5 构建期的镜像源

构建锁定 DSH 镜像时统一使用国内阿里云源，不依赖调用方记得加参数：

| 用途 | 默认源 | 覆盖方式 |
|---|---|---|
| Debian APT（安装 `ca-certificates`、`build-essential`、`musl-tools`） | `http://mirrors.aliyun.com/debian`（security 同站 `debian-security`） | `build-image.sh --apt-mirror http://deb.debian.org/debian`，仅在国内源不可达时使用 |
| npm/pnpm 依赖与 corepack 下载包管理器 | `https://registry.npmmirror.com` | `DSH_NPM_REGISTRY` 构建参数，由 `build-image.sh` 注入 |

换源不改变锁定内容：APT 仍由 `debian-archive-keyring` 校验 Release/InRelease 签名与 `Valid-Until`；依赖仍按 `pnpm-lock.yaml` 的完整性摘要校验，`corepack` 与 `pnpm` 共用同一个 registry。实际使用的 APT 源与 npm registry 写入该次构建证据。

### 5.6 镜像与脚本的关系

**适配层脚本不烘焙进镜像。** `verify-load.mjs`、`tree-digest.mjs`、`prepare-verification-home.mjs` 由 Compose 以只读 bind 把整个适配层目录挂到 `/opt/dsh-adapter`（`home-init` 与 `dsh` 两个服务都挂）。因此：

- 改脚本只需重启实例（`down` + 同名 `up`，或 `up --replace`），不必重建镜像；
- 容器实际读到的脚本字节与宿主上被审查的文件一致由同一份挂载保证，`verify-load.sh` 仍在容器内用 `sha256sum` 核对这三个文件的摘要并记录到证据里；
- 镜像只在 DSH 源码提交、基础镜像、系统依赖或目录结构变化时才需要重建。

真正的镜像内容变化仍须重建：改动 `Dockerfile`、`source.lock.json` 或 apt/npm 依赖后执行 `image build`，`verify-load.sh` 会核对该标签的 CLI 版本与平台。

### 5.7 实例状态

实例配置生成在仓库外：`$XDG_STATE_HOME/dsh-dev/<name>/{compose.yaml,instance.json}`（缺省 `~/.local/state/dsh-dev/`）。`instance.json`（schema `1.3`）记录来源、模式、`agent_id`、`target_preset`、`session_preset`、端口、镜像标签、profile patch、挂载与上下文挂载、环境变量名。它不含 Token，也不进入仓库。

`ps`、`logs`、`down` 从实例状态文件重建读取该实例 Compose 所需的环境变量，并且**不要求状态文件是最新 schema**：一条旧实例必须仍然能被停止和查询，否则新版会卡在"旧状态拒绝操作、同名 `up` 又被端口挡住"的循环里。记录里缺失的字段不猜：旧模板用 `${VAR:-默认}`，缺值可解析；新模板用 `${VAR:?}`，缺值由 Compose 报出变量名。

三种升级情形：

| 情形 | 做法 |
|---|---|
| 旧状态实例已停止 | 直接同名同端口 `up`：重渲染 Compose 并按当前 schema 重写状态，即完成迁移 |
| 旧状态实例仍在运行 | `up --replace`（先停自身容器、保留 HOME，再启动），或先 `down` 再同名 `up` |
| `ps` 显示 `needs_migration: true` | 说明该实例状态文件早于当前 schema；按上面两行之一迁移，查询与停止在此期间照常可用 |

`--replace` 只停同名实例自身的容器，不带 `-v`，HOME 数据卷保留；同名但来源或模式不同的实例仍然拒绝（身份冲突）。同名实例不得改端口：记录端口与 `--port` 不一致时直接失败。

## 6. 异常与已有实例处理

| 现象 | 处理 |
|---|---|
| 端口被占用 | `up` 直接失败，不自动改端口；显式换 `--port` |
| 缺运行时环境变量 | 默认失败并列出变量名。只有技术装载核验才用 `--allow-missing-env` 显式降级，并在输出中标注 |
| 同名的实例已存在且来源或模式不同 | 直接失败；改用新的实例名，或先 `down` 旧实例 |
| 界面提示选择工作区、输入栏无响应 | 这是 DSH 的冷启动流程：按模式注册 `/work`（dev）或 `/work/harness/workspace`（eval）。注册一次即写入该 HOME 卷并跨重启保留；换实例名需要重新选择 |
| 改完 preset 但行为没变 | 挂载内容变化不会自动重启进程。用 `up --replace` 或 `down` + 同名 `up` 重启实例，再新建会话；必要时用 `verify-load.sh` 核对实际组合配置 |
| 端口被本实例自身占用 | `up` 提示先 `down` 或加 `--replace`；同名实例不得改端口，也不会自动换端口 |
| 旧状态实例需要迁移 | `ps` 标出 `needs_migration: true`；已停止的直接同名 `up`，仍在运行的用 `up --replace` |
| `url` 报"未取得唯一认证 URL" | 只从**本次进程**日志提取，不返回历史链接也不拼造 Token；确认容器在本次启动后没有重启 |
| `down` 报状态未确认 | 说明 `docker compose down` 失败或 `docker ps` 查询失败；人工核对容器与卷后再决定是否继续 |
| 既有实例 | 适配层脚本或 Compose 变化后需重建容器并重跑 `verify-load.sh`；HOME 数据卷不随重建丢失，工作区注册保留 |

## 7. 实施与验证

### 7.1 文件级改动

| 子系统 | 文件 |
|---|---|
| 受控 Compose 模板 | `runtime/adapters/dsh-container/{authoring,verification}.compose.yaml` |
| 启动器 | `runtime/adapters/dsh-container/dsh-dev` |
| 来源解析 | `runtime/adapters/dsh-container/source_contract.py`、`sources.json` |
| 核验 | `verify-load.sh`、`verify-load.mjs`、`preflight-access.py`、`tree-digest.mjs` |
| 仓库校验器 | `.agents/skills/harness-evolution/scripts/validate_repository.py` |
| 测试 | `runtime/adapters/dsh-container/test_*.py`、`test_*.mjs`、`tests/test_validators.py` |

### 7.2 真实行为验收

| 场景 | 操作 | 应观察到 |
|---|---|---|
| 开发角色 | 按说明启动 `--mode dev`，注册 `/work` 并核对实际加载的指令 | 会话读到 `/work/AGENTS.md` 的开发者身份，知道当前目标与可编辑位置；目标业务指令只作为编辑对象出现 |
| 被测身份 | 启动 `--mode eval`，核对容器内不存在 `/work/AGENTS.md` | 目标只加载自己的业务指令，不会读到开发者身份 |
| 目标编辑与保存 | 改一个 preset 配置和相关技能 | 修改进入候选资产目录；容器 HOME 中的新产物不被当缓存丢弃 |
| 目标选择 | 用明确的 preset ID 启动 `--mode eval`，核对 `plan.target_preset` 与基础 patch 的 `agent-presets.default` | 两者相等且等于该 Agent 的 `preset_id`；仓库校验器在这三者不一致时失败 |
| 落状态迁移 | 对一份旧 schema 状态目录执行 `ps` 与 `down` | `ps` 标出 `needs_migration: true`，`down` 能停掉容器并保留 HOME，不因旧状态被拒 |
| 同名重载 | `up --replace`，或 `down` 后同名同端口 `up` | 旧进程确实停止，新配置被读取；输出含 `replaced.previous_state_schema` |
| 重载生效 | 按文档重新装载并验证预先定义的可观察变化 | 不把驻留旧配置的结果误认成新配置 |
| 新建 preset | 在 `--mode dev` 内复制一份 composition 为新 ID，用新 ID 开新会话 | 组合配置中出现 `includeUserRoot: true`；新 ID 不被系统根遮蔽；产物可复制回候选 |
| 判分材料隔离 | 在 `--mode eval` 容器内检查 `/work/spec`、`/work/eval-reference`、`/work/eval-input` | 三条路径都不存在，也不在 `/proc/self/mountinfo` 中 |
| 运行记录 | 记录实际提交、未提交状态、镜像、模型与测试范围 | 记录与实际使用一致，不虚构完整冻结 |
| 停止失败 | 模拟 `docker compose down` 返回非零退出码 | 命令失败，不输出 `stopped: true` |
| 启动未生效 | 模拟 `up -d` 返回 0 但 `dsh` 容器已退出 | 报告 `dsh_running: false` 并以非零退出码结束，不报启动成功 |

至少完成一次有真实模型条件的"修改—装载—运行"验证，才能确认开发过程可用。暂时缺模型或服务时如实保留"仅技术检查通过"。

## 附录 A 提交历史

Sep 18, 2026 的四项提交构成双模式的实施基线（时间为提交作者本地时区，UTC 均落在 2026-09-18）：

| 提交 | 主题 | 关键内容 | 证据 |
|---|---|---|---|
| `d84b287` | 补齐安全运营 Harness 候选与 DSH 开发启动器装载核验 | 候选 Harness（故障域/公开号/角色矩阵修正）、`dsh-dev`、回环 MCP 桩、`verify-load` 扩展 | `evaluation/evidence/dsh-dev-live-load-20260918.json` |
| `425c390` | MCP 桩 `tools/call` 改为失败关闭 | 桩默认返回 `isError: true`，只有显式 `--stub-success` 才回显桩标记 | `evaluation/tools/test_derive_mcp_stub_tools.py` |
| `21f3d96` | 开发启动器双模式 | dev overlay、`--accept-cordis-trust`、上下文挂载、校验器挂载/命令/叠加层门禁 | `evaluation/evidence/dsh-dev-two-modes-20260918.json` |
| `a835335` | 冷启动工作区注册步骤 | `plan`/`up` 输出 `workspace_to_register` 与 `web_cold_start` | 同上 |

## 附录 B 关键机制依据

| 结论 | 依据 |
|---|---|
| 写沙箱只约束写，边界为会话工作区且 canonical 化 | `packages/fs/fs-sandbox/src/index.ts` |
| 指令链 = `cwd → projectRoot`，无标记时 projectRoot = cwd | `packages/context/agent-instructions/src/files.ts` |
| 工作区树摘要为全树精确比对 | `runtime/adapters/dsh-container/tree-digest.mjs`、`verify-load.mjs` |
| user preset 根与可写性 | `packages/preset/agent-presets/src/{discovery,index,authoring}.ts` |
| 冷启动工作区注册 | `packages/workspace/workspace/src/index.ts`、`packages/client/ui-conversation/.../ConversationRoot.tsx` |
| picker 在容器内解析为 browse | `packages/host/directory-picker-auto/src/resolve.ts` |

## 附录 C 已否决的备选

| 备选 | 否决理由 |
|---|---|
| shadow 工作区 `AGENTS.md`（dev 覆盖被测版本） | 被测 `AGENTS.md` 会变成只读不可编辑，而它正是要优化的资产；同时破坏工作区树摘要断言 |
| 把上下文资产挪进 harness 工作区 | 同上摘要约束，且不解决 preset 装载问题 |
| 工作区内放指向候选 harness 的符号链接 | `workspace-write` 会 realpath 后判定包含关系，写被拒 |
| dev 直接挂候选 `presets`/`managed` 为读写 | 违反受控 Preset/Guard/MCP 绑定只读的红线 |
| 预写 `storages/workspace.json` 或自研 typert RPC 客户端 | 写 Runtime 存储内部格式或复刻私有协议，脆弱且越界；冷启动用提示 + 一次性注册解决 |
| 把整个 `eval` 目录当作"被测输入"挂给被测容器 | 该目录同时包含金标准与预期行为；只读挂载不限制读取，隔离会退化为依赖被测实现的 Guard |

## 附录 D 未决问题

- 被测侧的受控输入仍未物化：`--eval-input` 已提供显式声明入口，但仓库中还没有一个已确认不含预期答案的目录。出现真实需要时再建，不预建空目录。
- 多来源扩展时，`sources.json` 已按来源声明 preset 与路径，适配层不再内联业务名；新增来源只需追加目录数据。
- `open`、`resume`、`fresh` 子命令与 `release:<id>` 选择器仍是待实施合同。
