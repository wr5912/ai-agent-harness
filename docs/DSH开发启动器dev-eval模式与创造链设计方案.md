# DSH 开发启动器 dev/eval 双模式与「创造链」设计方案

> **状态**：Sep 18, 2026 的四个提交（`d84b287`、`425c390`、`21f3d96`、`a835335`）已交付**两模式基线与冷启动提示**；本文第 5 节的目标设计 **D1–D5 尚未实施**，实施后必须回填本状态行与证据。
>
> **范围**：同一台 Linux Docker Engine 主机上的本地开发与候选技术核验。本文不设计生产部署入口，不改变 DSH Runtime 源码，不替代 Agent 交付评估或 Release 验收。
>
> **依据**：[规范来源锁定](./standards/SOURCES.md)、[项目规范解释](./standards/PROJECT-INTERPRETATION.md)、[DSH 容器开发启动器设计方案](./DSH容器开发启动器设计方案.md)、[适配层 README](../runtime/adapters/dsh-container/README.md)、锁定的 DSH 提交 `c291e7961a515f6d7af9304e7fd1d257929aef26`（CLI `0.1.5-rc.2`）。

## 1. 背景：Sep 18, 2026 提交历史

这四项提交构成当前双模式的实施基线（时间为提交作者的本地时区，UTC 均落在 2026-09-18）：

| 提交 | 主题 | 关键内容 | 证据 |
|---|---|---|---|
| `d84b287` | 补齐安全运营 Harness 候选与 DSH 开发启动器装载核验 | 候选 Harness（故障域/公开号/角色矩阵修正）、`dsh-dev` 启动器、回环 MCP 桩、`verify-load` 扩展、仓库校验器补门禁 | `evaluation/evidence/dsh-dev-live-load-20260918.json` |
| `425c390` | MCP 桩 `tools/call` 改为失败关闭 | 桩默认返回 `isError: true` 且拒绝编造业务数据，只有显式 `--stub-success` 才回显桩标记 | `evaluation/tools/test_derive_mcp_stub_tools.py`（9 项） |
| `21f3d96` | 开发启动器双模式：`--mode dev`（Cordis 创造模式）与 `--mode eval`（被测智能体 preset） | dev overlay、`--accept-cordis-trust`、`/work/spec` + `/work/eval-input` 只读挂载、校验器挂载/命令/叠加层门禁、`verify-load` 上下文摘要 | `evaluation/evidence/dsh-dev-two-modes-20260918.json`、`dsh-image-build-20260918T074426Z-3153635.json` |
| `a835335` | 启动器交付 DSH Web 冷启动的工作区注册步骤 | `plan`/`up` 输出 `workspace_to_register` 与 `web_cold_start` 步骤 | 同上两份证据 |

仓库层面的既有约束（本文不重复论证，仅作为设计前提）：`agents/<agent-id>/spec` 与 `agents/<agent-id>/eval` 是需求与评估事实源；受控 Profile/Guard/MCP 绑定在编写态仍只读；归档、外部交付与旧 Harness 默认不可信；容器技术核验不得写成 Release 或 R3 结论。

## 2. 两种模式的现状（已实施）

### 2.1 模式与命令

用户可见模式 `dev`/`eval` 映射到内部 harness 阶段名 `authoring`/`verification`（保持仓库治理词汇与既有门禁不变）：

```bash
# 开发模式：DSH 默认 preset = 出厂 cordis（创造模式），需显式确认信任
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode dev --name secops-dev --port 3084 --accept-cordis-trust

# 评测模式：DSH 默认 preset = 被测智能体（security-operations-expert）
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode eval --name secops-eval --port 3085
```

### 2.2 挂载与权限矩阵（现状）

| 容器路径 | 宿主机来源 | dev | eval |
|---|---|---|---|
| `/work/harness/workspace` | 候选 `dsh/workspace`（技能、AGENTS.md） | 读写 | 只读 |
| `/opt/dsh-presets` | 候选 `dsh/presets`（preset 声明） | 只读 | 只读 |
| `/opt/dsh-managed` | 候选 `dsh/managed`（patch、Guard、角色矩阵、MCP 绑定） | 只读 | 只读 |
| `/work/spec` | `agents/<agent-id>/spec`（需求、任务、验收标准） | 只读 | 只读 |
| `/work/eval-input` | `agents/<agent-id>/eval`（夹具、评估方法、待复核输入） | 只读 | 只读 |
| `/var/lib/dsh` | 每实例独立 DSH_HOME 数据卷 | 读写 | 读写 |
| `/var/lib/dsh/AGENTS.md` | 受控 0 字节全局指令 | 只读 | 只读 |

两种模式共用受控 HOME 边界（空用户 Patch、固定 web profile manifest、零字节全局指令、注释 ` .env`）与模块 deny-layer；只有 `dev` 在主 `dsh` 服务命令上多一层 `--patch` 开发叠加层。

### 2.3 开发模式叠加层与信任确认

`candidate/dsh/managed/security-operations-expert.development.patch.yml` 只调整 `agent-presets` 一行：

```yaml
- id: agent-presets
  config:
    default: cordis
    includeShippedRoot: true
    includeUserRoot: false
    roots:
      - path: /opt/dsh-presets
        trust: system
```

要点：**叠加层按行整体替换 `config`（不是深合并）**，因此必须重述基础 patch 的全部键；`includeUserRoot: false` 保证可写 HOME 不成为 preset 根（第 4.1 节说明该取值正是创造链的断点）。`--mode dev` 缺 `--accept-cordis-trust` 即失败关闭；`--mode eval` 拒绝该旗标。创造模式会话具备 shell 与对实时 runtime 执行模型 JS 的 `tool-cordis`，且不加载 `security-operations-guard`——这是已披露并由操作者显式确认的风险，不是已隔离状态。

### 2.4 核验与门禁

- `verify-load.sh`/`verify-load.mjs`：核验三棵资产树 + 两棵上下文树的文件、模式与 SHA-256；authoring 额外断言开发叠加层确实生效（`includeShippedRoot: true` 且 `default: cordis`），verification 断言组合配置中不出现出厂根开放。
- 仓库校验器：挂载数精确 16、上下文来源与只读性、开发模式命令必须叠加受控开发层而评测模式不得叠加、`DSH_DEVELOPMENT_OVERLAY` 行白名单与配置完整性、来源目录新增 `development_patch_overlay` 字段。
- 测试：`tests/` 147 项、适配层 py 49 项、宿主 mjs 9 项、Guard 8 项、桩工具 9 项。

## 3. 实测发现：DSH Web 冷启动需要注册工作区（已缓解）

**现象**：打开实例 URL 后界面提示"选择一个工作区开始"，输入栏惰性。

**根因链**（已逐项核实）：

1. `ui-conversation` 在 `sessionId === undefined`（尚未打开任何会话）时把输入栏置为惰性，占位文案即 `placeholder.workspace`；必须先 `selectWorkspace(workspaceId)` 才会用该工作区创建并打开会话。
2. 会话必须绑定**已注册工作区**；注册表是 DSH_HOME 下的持久化域（容器内 `/var/lib/dsh/storages/workspace.json`，实测 `initialized: true`、`workspaceIds: []`、`workspaces: {}`）。
3. `WorkspaceRegistry` 只在**首次启动**时从"已存会话头"做一次 bootstrap，随后写入 `initialized` 标记不再重建 ⇒ 新实例（HOME 卷为空、无会话）必然停在空注册表。
4. 容器的 `working_dir: /work/harness/workspace` 只是进程工作目录，不等于 DSH 工作区。

**结论 A（已交付）**：这是 DSH 的既定冷启动流程，不是容器或 Profile 故障。锁定提交没有受支持的工作区预注册入口（`dsh web` 无工作区参数；工作区命令只走浏览器 typert RPC），因此启动器**只交付路径与步骤**（`plan.workspace_to_register`、`plan.web_cold_start`、`up` 的 stderr 提示），不改写 Runtime 存储内部格式、不在适配层实现私有 RPC。每实例注册一次即写入该 HOME 卷并跨重启保留；换新实例名等于新 HOME 卷，需再选一次。容器内 picker 由 `directory-picker-auto` 解析为可用的 browse 交互（无 chooser 二进制、无 `DISPLAY`），并支持"编辑路径"直接输入绝对路径。

## 4. 对抗性审视：现状设计的三处硬伤

### 4.1 创造链断裂（最严重）

`--dev` 的设计意图是"用创造模式修改目标智能体的 preset"，但现状**做不到**：

1. 出厂技能 `editing-cordis-compositions` 规定：不得改出厂 preset；用 `${DSH_HOME}/.agent-presets/` 下的 user 根存放自建 preset；用 `ctx.agentPresets.copy(from, id)` 复制后编辑；用 `standingKeyFor(id)` 做装载校验；最后请用户用新 preset 开一个会话验证。
2. `copy()` 的目标是**第一个 `trust: 'user'` 根**；`writableRoot()` 在没有任何 user 根时直接抛错：`this deployment configures no user-writable preset root`。
3. 现状叠加层设 `includeUserRoot: false`，候选根 `/opt/dsh-presets`、`/opt/dsh-managed` 又必须只读（受控 Preset/Guard/MCP 绑定红线）。
4. ⇒ 容器里**没有任何可写 preset 根**：`copy()` 不可用；即使手写目录也不会被名册发现（该根未启用），`standingKeyFor` 无法校验、会话无法装载。

净效果：dev 模式实际只能修改 `/work/harness/workspace`（技能与 AGENTS.md），**preset 层面既改不动也测不了**；而修改 preset 正是该模式的首要目的。

补充事实：user 根位于会话工作区之外，默认 `workspace-write` 下首次写入会被拒绝——DSH 官方技能已把"带 `sandbox_permissions` 升级重试一次并由用户批准"写入流程；容器组合配置中 `approval`(`dsh-user-approval`)、`permission`(`dsh-permission-presets`) 与 `sandbox*` 行齐全，该升级路径可用。

### 4.2 身份冲突与缺少优化目标声明

dev 会话的指令来源只有两处：`$DSH_HOME/AGENTS.md`（现状 0 字节，两模式相同）与**会话工作区自己**的 `AGENTS.md`。现状 dev 与 eval 注册同一路径 `/work/harness/workspace`，于是创造者拿到的是**被测智能体**的指令（"你是网络安全运营专家……"），而它的 persona 却是创造模式（"你能读取并修改你所运行的 harness……"）。二者语义冲突，且**没有任何地方声明优化目标是哪个 preset、允许改什么、产出如何回到仓库**。

### 4.3 上下文位置：两条不可逾越的约束

曾评估把 `/work/spec`、`/work/eval-input` 挪进工作区，结论是**不可行且无必要**：

- **写沙箱的边界是会话工作区，且是 canonical 化判定**：`fs-sandbox` 的 `read-only` 拒绝一切变更，`workspace-write` 会把目标 realpath 后要求落在可写根内。因此在工作区内放**符号链接**指向候选 harness 会被拒绝写；只有**嵌套 bind 挂载**（canonical 路径仍在工作区内）才可写。
- **工作区树摘要是"精确镜像"断言**：`verify-load.mjs` 用全树 `fileSnapshot` 比对容器内工作区与宿主候选工作区。任何额外路径或内容差异（嵌套挂载、替换 `AGENTS.md`）都会让摘要不等。现有 `/work/harness/workspace/.env` 之所以允许，是因为宿主候选里的 `.env` 与受控文件**字节相同**。
- 又因为指令链只沿 `cwd → projectRoot` 且容器内没有 `.git` 标记（`findProjectRoot` 回退为 cwd 本身），**把开发用 `AGENTS.md` 覆盖到 `/work/harness/workspace/AGENTS.md` 会让被测智能体自己的指令文件变成只读且不可编辑**——而它正是要优化的资产之一。

### 4.4 已否决的备选

| 备选 | 否决理由 |
|---|---|
| shadow 工作区 `AGENTS.md`（dev 覆盖 eval/被测版本） | 被测 `AGENTS.md` 变为只读不可编辑；破坏工作区树摘要断言 |
| 把上下文挪进 harness 工作区 | 同上摘要约束；且不解决 preset 创作链问题 |
| 工作区内放指向候选 harness 的符号链接 | `workspace-write` canonical 化判定 ⇒ 写被拒 |
| 开发指令走 HOME 全局受控文件 | 可行但会话仍会注入被测 `AGENTS.md`，身份冲突只能靠优先级说明缓解；且需改 `home-init`/`verify-load` 的零字节语义并带来既有实例迁移摩擦 |
| dev 直接挂候选 `presets`/`managed` 为读写 | 违反"受控 Preset/Guard/MCP 绑定保持只读"红线 |
| 预写 `storages/workspace.json` / 自研 typert RPC 客户端 | 写 Runtime 存储内部格式或复刻私有协议，脆弱且越界；冷启动问题用提示 + 一次性注册解决 |

## 5. 目标设计（本次讨论结论，待实施）

### D1 dev 会话工作区 = `/work`，开发指令挂 `/work/AGENTS.md`

- dev 模式新增一个**受控只读**文件挂载：`/work/AGENTS.md` ← `verification-home-controls/locked-dev.AGENTS.md`；eval 模式不挂载该文件。
- dev 的 `workspace_to_register` 由 `/work/harness/workspace` 改为 **`/work`**（eval 不变）。由此：
  - 指令链 = `/work` ⇒ 会话指令**只有**开发指令文件（外加恒定的 0 字节 HOME 全局指令）；
  - 被测智能体自己的 `AGENTS.md` 仍在 `/work/harness/workspace/AGENTS.md`，**可读、可写、且不会被注入**，身份冲突消失；
  - `/work/spec`、`/work/eval-input` 位于注册工作区之内，写权限可自然生效；
  - 容器内 `/work` 位于只读根文件系统，落在其上的额外写入在文件系统层即失败，只有显式挂载的子树可写。
- **不需要改镜像**：已实测 `--read-only` 根文件系统上 Docker 仍能为不存在的目标建立 file/dir bind（挂载点建在容器临时层），因此不需要 Dockerfile 预建，也不会像 `.env` 那样在候选树留下同字节哨兵。
- 开发指令文件的内容固定覆盖：创造模式身份与目标（preset `security-operations-expert`，只读安装于 `/opt/dsh-presets/security-operations-expert/`，受控配置 `/opt/dsh-managed/` 只读）；可写范围；preset 创作闭环（copy → 编辑 → `standingKeyFor` → 请操作者开会话）；上下文资产用途与 `pending/` 的待复核性质；产出与晋升（容器内仅探索，宿主复核后进候选）；以及"本文件即 `/work/AGENTS.md`，若未见说明工作区注册错误"的自校验提示。该文件只描述事实与流程，**不授予任何权限**。

### D2 dev 打开可写 preset 根（仅 dev）

- 开发叠加层改为 `includeUserRoot: true`（同时完整重述 `default: cordis`、`includeShippedRoot: true`、`roots: [/opt/dsh-presets]`）。
- 候选 `presets`/`managed` 保持只读；创造者的产出落在 `/var/lib/dsh/.agent-presets/<new-id>/`，属于**实例本地探索**；宿主侧复核后才复制进 `candidate/dsh/presets/`，并重建容器核验。
- 校验器门禁相应翻转：dev 叠加层**必须** `true`；基础 patch（评测侧）继续强制 `includeUserRoot: false`，保证评测容器里既无出厂根也无 user 根。

### D3 dev 下数据资产可写（eval 恒只读）

- dev：`/work/spec`、`/work/eval-input` 改为读写，使创造者可以修正需求、任务、测试数据、评估方法与验收标准，从而为准确保留的 preset 创作提供完整背景；
- eval：保持只读（评测期间的事实源必须稳定）；
- 两种模式下上下文树仍是**同一棵宿主事实源**，读写模式变化不影响内容摘要；dev 内的改动属于仓库工作区变更，必须经宿主复核，且不得被表述为正式评估结论或 Release 内容。

### D4 启动器交付模式相关的引导信息

- `plan`/`up`/`instance.json` 增加：`workspace_to_register`（dev → `/work`；eval → `/work/harness/workspace`）与 `optimization_target`（目标 preset、可写与只读边界、上下文路径、preset 创作与晋升闭环、信任提示）；`web_cold_start` 文案按模式生成。

### D5 门禁、测试与证据同步

- 校验器：上下文挂载的读写模式按模式判定；挂载数按模式（dev 17 / eval 16）与目标集合；新增开发指令文件的内容门禁（非空、≤64 KiB、无 `!!js`/URL/密钥，且必须出现目标 preset id、`/work/harness/workspace`、`/opt/dsh-presets`、`/opt/dsh-managed`、`/work/spec`、`/work/eval-input`、`/var/lib/dsh/.agent-presets`）；评测模板不得出现 `/work/AGENTS.md`；新文件加入适配层必需清单。
- `verify-load`：dev 断言 `/work/AGENTS.md` 存在且为精确只读 bind、摘要匹配，上下文为读写；eval 断言该路径未挂载、上下文为只读。
- 预检：上下文路径的读写权限检查按模式执行。
- 测试：模式化 `plan` 字段、上下文模式写反、指令文件空白/含 `!!js`/缺目标 id、叠加层 `includeUserRoot: false` 等失败用例。
- 证据：新增双模式实机证据（组合配置、挂载与摘要、user 根可写探针、`verify-load` 退出码），并**如实标注**需操作者人工确认的部分（真实 `copy()`/`standingKeyFor` 调用与"用新 preset 开会话"）。

## 6. 变更清单（文件级）

| 子系统 | 变更 |
|---|---|
| 候选 Harness | `candidate/dsh/managed/security-operations-expert.development.patch.yml`（`includeUserRoot: true`）；`candidate/dsh/workspace/AGENTS.md`（中性资产身份说明） |
| 适配层受控文件 | 新增 `runtime/adapters/dsh-container/verification-home-controls/locked-dev.AGENTS.md` |
| Compose | `authoring.compose.yaml`：新增 `/work/AGENTS.md` 只读挂载、上下文改读写；`verification.compose.yaml` 不变 |
| 启动器 | `runtime/adapters/dsh-container/dsh-dev`：模式化 `workspace_to_register`、`optimization_target`、`web_cold_start` |
| 核验 | `preflight-access.py`、`verify-load.sh`、`verify-load.mjs`（模式化断言与证据字段） |
| 校验器 | `.agents/skills/harness-evolution/scripts/validate_repository.py`（挂载模式/数量、叠加层翻转、指令文件门禁、必需清单、pin 同步） |
| 测试 | `test_dsh_dev.py`、`tests/test_validators.py`、`test_home_submounts.mjs`、`test_source_contract.py` |
| 文档 | 本文件、`runtime/adapters/dsh-container/README.md`、`docs/DSH容器开发启动器设计方案.md`、`tests/README.md`、`CHANGELOG.md` |
| 证据 | `evaluation/evidence/dsh-dev-creator-chain-<UTC>.json` |

## 7. 关键机制依据（DSH 源码与实测）

| 结论 | 依据 |
|---|---|
| 写沙箱只约束写，边界为会话工作区且 canonical 化 | `packages/fs/fs-sandbox/src/index.ts`：`read-only` 拒绝一切变更；`workspace-write` 重新 realpath 并校验包含关系 |
| 指令链 = `cwd → projectRoot`，无标记时 projectRoot = cwd | `packages/context/agent-instructions/src/files.ts`：`findProjectRoot` 回退 `resolve(cwd)`；`ancestorChain(root, cwd)` 从 cwd 到根；候选文件为 `AGENTS.md`/`CLAUDE.md` 与 `.local.md` 变体；另恒定读 `<dshHome>/AGENTS.md` |
| 工作区树摘要为全树精确比对 | `runtime/adapters/dsh-container/tree-digest.mjs` `fileSnapshot` 与 `verify-load.mjs` 的宿主/容器摘要相等断言 |
| user preset 根与可写性 | `packages/preset/agent-presets/src/discovery.ts`（`USER_PRESET_DIR = '.agent-presets'`）、`src/index.ts`（根顺序：出厂 → 配置 → user）、`src/authoring.ts`（`writableRoot()` 无 user 根即抛错；`copyComposition()` 落在该根） |
| 出厂 preset 与创作流程 | `packages/preset/agent-presets/presets/cordis/`（persona、`tool-cordis`、创作技能）；`skills/editing-cordis-compositions/SKILL.md`（copy → 编辑 → `standingKeyFor` → 用户开会话；沙箱升级预期） |
| 冷启动工作区注册 | `packages/workspace/workspace/src/index.ts`（`WorkspaceRegistry` 一次性 bootstrap）、`src/spec.ts`（domain v2 记录与全局状态）、`packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`（无会话 ⇒ 惰性输入栏与工作区占位） |
| picker 在容器内解析为 browse | `packages/host/directory-picker-auto/src/resolve.ts`（非回环绑定/SSH/非 Linux/无 chooser 二进制 ⇒ browse；无 `DISPLAY`/`WAYLAND_DISPLAY` 时即使有 chooser 也用 browse） |
| 只读根文件系统上可建立挂载点 | 实测：`docker run --rm --read-only -v /etc/hostname:/work/AGENTS.probe <image>` 成功（挂载点建于容器临时层） |

## 8. 风险、失败模式与边界

- **dev 信任增量**：可写 HOME 成为 preset 根，模型可编写并挂载组合；与创造模式已具备的 shell/`tool-cordis` 属同一信任级别。约束：仅 dev、仅实例本地、门禁 + 文档 + 宿主复核；评测模式完全不涉及。
- **dev 数据资产可写**：模型可改写自己的验收标准与判分方法。这是本设计明确接受的取舍；对策是"dev 内改动仅算探索、入库须宿主复核"写入指令文件、README 与证据，且 eval 侧恒只读。
- **沙箱升级被拒**：操作者拒绝 `sandbox_permissions` 时，创造者可改用创造模式自带的 shell 写 HOME，或降级为在 `/work/harness/workspace/.dsh-authoring/` 产出草案供宿主应用。
- **注册路径写错**：dev 若注册 `/work/harness/workspace`（而非 `/work`），开发指令不会被加载、且会重新引入身份冲突。缓解：启动器输出、指令文件自校验提示、README 明确两模式注册路径不同。
- **既有实例**：本设计不改 HOME 全局指令（仍 0 字节），`home-init` 与既有 dev 实例无需迁移；但 `includeUserRoot` 翻转使 dev 组合配置变化，需重建容器并重跑核验。
- **不做**：不改 Dockerfile/不重建镜像；不把候选 `presets`/`managed` 挂读写；不预写 DSH 存储、不自研私有 RPC；不改评测模式的任何隔离。

## 9. 验收标准

1. dev：`--dump-config` 显示 `includeUserRoot: true`、`roots` 完整、`default: cordis`；`/work/AGENTS.md` 为受控只读挂载且摘要一致；`/work/spec`、`/work/eval-input` 为读写；`/var/lib/dsh/.agent-presets` 对 UID 1000 可写（探针通过）；`plan`/`up` 输出 `/work` 与 `optimization_target`。
2. eval：挂载数 16、上下文只读、无 `/work/AGENTS.md`、`includeUserRoot: false`、创造模式不在名册；`plan`/`up` 输出 `/work/harness/workspace`。
3. 两模式 `verify-load.sh` 退出码 0；仓库校验器 0 error；`tests/`、适配层 py/mjs 全绿；适配层 pin 已同步。
4. 证据文件落盘并如实标注未自动验证项（`copy()`/`standingKeyFor` 与"用新 preset 开会话"需浏览器人工确认）；文档与 `CHANGELOG.md` 更新；提交推送完成（先 `git fetch`，远端领先则停止，不 force）。

## 10. 未决问题

- dev 产出（新 preset、被改写的需求/评估资产）的**导出与晋升**目前用文档化配方（`docker cp dsh-dev-<name>-dsh-1:/var/lib/dsh/.agent-presets/<id> <host-dir>`）承接；是否需要 `dsh-dev export` 子命令待定。
- 多来源扩展时，开发指令文件中的 preset id 需要改为按来源声明（`sources.json` 字段 + 每来源文件）；当前为适配层级单一文件，校验器以交叉校验显式报错而非静默失配。
- 自动评测执行器与 subject/scoring 判分材料隔离仍属 `source_contract.mount_plan` 的既有契约，本文不改变其语义。