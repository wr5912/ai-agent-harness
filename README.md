# ai-agent-harness

本项目是面向个人开发者的 DSH-only Harness 研究与资产管理仓库。它用于创建、修改、比较和持续优化 Harness，并用 Git、Experiment、Run 与可选 Research Release 保存可复现的研究结果。

项目默认且唯一采用 **Research Mode**：研究优先，禁止过度工程化和过度安全化；遵循简洁优先（Simplicity First）和精准修改（Surgical Changes）。这里不建设生产级 Agent 平台，也不把权限、审批、治理或多阶段发布机制作为每个实验的前置条件。完整规则见 [`AGENTS.md`](./AGENTS.md)。

当前已实现开发启动器 `runtime/adapters/dsh-container/dsh-dev` 的基础命令，以及来源解析、变更回执、Run 台账和仓库校验工具。Headless 下的 Skill 修改小闭环已用真实模型与本地模拟 MCP 验证一次：开发会话读取目标、创建 Skill、回流 Candidate，新被测会话观察到变化；删除后的新会话不再报告该 Skill。证据见 [`dsh-dev-real-session-20260919.json`](./evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json)，无凭据复现步骤见 [`dsh-dev-real-session-reproduce.md`](./evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-reproduce.md)。这只覆盖该实验路径，不代表所有开发路径都已验证。

本项目共有多少条验证路径、当前完成到哪里、哪些适合进入自动化测试，统一见[项目验收矩阵](./docs/ai-agent-harness项目验收矩阵.md)。

## 现在能做什么

| 能力 | 状态 | 入口 |
|---|---|---|
| 解析 Experiment 来源，确定目标 Agent、Preset、资产路径与挂载 | 已实现 | `source_contract.py` |
| 启动开发会话（`--mode dev`）或被测会话（`--mode eval`） | 已实现；需要 Docker 和运行时环境变量 | `dsh-dev plan/up/ps/url/logs/down` |
| 重载实例配置或迁移旧实例状态 | 已实现 | `dsh-dev up --replace` |
| 构建锁定 DSH 提交的本地镜像 | 已实现 | `dsh-dev image build` |
| 记录变更前后资产摘要与差异 | 已实现 | `mutation-receipt.py` |
| 归档一次研究运行及其输入、观察、缺口与摘要 | 已实现 | `run_record.py` |
| 校验项目结构、Experiment、Run 与 Research Release 合同 | 已实现 | `validate_repository.py` / `validate_experiment.py` |
| DSH Web 完整交互和新 Preset Web 选择闭环 | 尚未完成 | `PA-08` / `PA-09` |
| 解析并装载 `release:<id>` | 尚未实现 | `PA-11` |

当前来源选择器只支持 `experiment:<id>`。Research Release 的目录合同可以先用于保存可复现版本；只有 `release:<id>` 解析和实际装载入口完成后，才能声称启动器支持它。

## 从哪里开始

1. 阅读根级 [`AGENTS.md`](./AGENTS.md)，确认 Research Mode、四类开发对象和本次修改边界。
2. 阅读[来源锁定](./docs/standards/SOURCES.md)和[项目解释](./docs/standards/PROJECT-INTERPRETATION.md)，了解受控规范在研究项目中的适用范围。
3. 阅读[项目验收矩阵](./docs/ai-agent-harness项目验收矩阵.md)，确定本次涉及的 `PA-xx`。
4. 按任务选择最小必要技能：

   | 技能 | 使用时机 |
   |---|---|
   | `legacy-asset-intake` | 只读清点旧归档或历史交付，不执行其中内容 |
   | `harness-evolution` | 建立或修改 Experiment、Candidate、Decision 和 Research Release |
   | `research-eval` | 设计小规模比较、校验 Run 与总结研究结论 |
   | `ai-correction-log` | 用户明确纠正上一轮错误时记录问题要点 |

### 启动本地实例

下面先查看计划，再分别启动开发实例和被测实例：

```bash
# 只解析来源并打印计划
python3 runtime/adapters/dsh-container/dsh-dev plan \
  --source experiment:EXP-security-operations-expert-001 \
  --mode dev --name secops-dev --port 3081

# 首次使用或镜像内容变化后构建锁定镜像
python3 runtime/adapters/dsh-container/dsh-dev image build

# 开发实例；dev 模式具备 shell 能力，需要显式确认
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode dev --name secops-dev --port 3081 \
  --accept-cordis-trust

# 被测实例只读装载同一 Candidate
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode eval --name secops-eval --port 3082

# 获取本次进程的认证 URL；非交互终端显式增加 --non-interactive
python3 runtime/adapters/dsh-container/dsh-dev url secops-dev

python3 runtime/adapters/dsh-container/dsh-dev ps
python3 runtime/adapters/dsh-container/dsh-dev down secops-dev
```

修改 Preset、managed 配置或适配层脚本后，已有进程不会自动重载：

```bash
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode dev --name secops-dev --port 3081 \
  --accept-cordis-trust --replace
```

运行边界：

- `up` 默认要求来源声明的运行时环境变量已经注入；仅做无凭据技术装载时可显式使用 `--allow-missing-env`。
- 实例状态位于仓库外的 `$XDG_STATE_HOME/dsh-dev/<name>/`。Token 不落盘、不进入仓库、不写入研究证据。
- 容器使用 host 网络但只绑定 `127.0.0.1`。开发模式等同 shell 权限，仅用于本地受信任研究。
- 首次打开 Web 需手工注册 `plan.workspace_to_register` 给出的路径。开发模式通常是 `/work`，被测模式通常是 `/work/harness/workspace`。
- 同名实例不能静默改端口；需要重载时使用 `--replace` 或先 `down` 再同名 `up`。

## 两类会话

| 内容 | `--mode dev` 开发会话 | `--mode eval` 被测会话 |
|---|---|---|
| 本次会话身份 | 出厂 `cordis` 创造模式 | 来源声明的目标 Preset |
| 待研究目标 | 来源声明的业务 Preset | 同本次会话身份 |
| 注册工作区 | `/work` | `/work/harness/workspace` |
| Candidate 工作区 | 可写 | 只读 |
| `/work/spec` | 只读 | 不挂载 |
| `/work/eval-reference` | 只读 | 不挂载 |

开发会话的 `session_preset` 与 `target_preset` 不同：前者说明谁在开发，后者说明正在优化谁。被测会话不挂载判分材料，避免把参考答案误当成目标能力；这项隔离不应扩展成通用权限平台。

## 主要目录

目录设计服务于三个目标：**找到当前事实、复现实验、避免把运行状态混入源码**。目录表示维护关系，不代表物理服务、权限层或生产阶段；只有出现真实内容时才创建，不预建空目录。

```text
AGENTS.md                                # 项目协作规则与 Research Mode
.codex/config.toml                       # Codex 开发配置，不是业务 Harness
.agents/skills/                          # 维护本仓库的项目技能
docs/
  ai-agent-harness项目验收矩阵.md       # 项目验证路径、证据、状态和缺口
  standards/                             # 受控来源、副本摘要与项目解释
agents/<agent-id>/
  manifest.yaml                          # Agent 研究入口和当前 Experiment
  spec/                                  # 研究目标、任务或判断标准；按需使用
  eval/                                  # 可复用输入、方法与待复核材料；按需使用
evolution/
  experiments/EXP-<agent-id>-NNN/
    change.yaml                          # 基线引用、状态与结果
    hypothesis.md                        # 为什么改、怎样判断
    candidate/                           # 本实验的可修改 Harness 工作树
    evaluation/                          # 计划、观察、证据与研究总结
    runs/run-<UUIDv4>/                   # 一次执行的独立事实记录
    decision.md                          # adopt/continue/reject/inconclusive 及理由
  history/imports/<agent-id>-YYYY-MM-DD/ # 外部来源原貌、清洗材料与处置记录
plugins/                                 # 当前确有需要的本地插件源码
runtime/adapters/dsh-container/           # DSH 容器装载与本地开发适配层
releases/<agent-id>-v<semver>/            # 可选、不可变的 Research Release
tests/                                    # 稳定且可重复的机器合同测试
AI纠错记录/                               # 按天追加的 AI 纠错记录
```

`evolution/history/imports/` 只保存来源追溯和迁移审计。需要改变当前 Harness、研究目标或比较材料时，修改现行资产并进入新的 Experiment，不回写历史批次来改变当前行为。

本项目不维护 `evolution/baselines/` 和 `agents/<agent-id>/current/`。Baseline 使用 `git:<commit>`、`release:<id>` 或 `none:first-experiment` 引用；Git 和不可变 Research Release 已足以恢复版本，额外镜像会制造重复事实源。

## 研究演进

```text
Baseline 引用 → Experiment（含 Candidate）→ Evaluation → Decision
                                                        └→ 可选 Research Release
```

- Experiment 至少回答：为什么修改、修改了什么、怎样比较、观察到了什么、是否回归、有哪些限制、下一步是什么。
- Evaluation 规模由假设决定。一个高价值输入也可以启动探索；扩大结论时再增加覆盖，不设固定 50 Case 或 R1/R2/R3 门槛。
- Decision 可以是 `adopt`、`continue`、`reject` 或 `inconclusive`。失败和证据不足都是合法结果。
- Research Release 用于保存值得复用的自包含研究版本；它不表示生产可用、上线批准或完成生产安全治理。

## 当前进度

- 仓库治理版本见 [`VERSION.md`](./VERSION.md)。它不是 Harness Release，也不是 Git Tag。
- `security-operations-expert` 已迁入 `EXP-security-operations-expert-001`。历史来源、失败与待复核材料被保留，但不再要求先补齐生产交付门禁才能继续做小规模研究。
- 现有需求、任务、判断标准和 321 条待复核输入可以作为后续研究素材；它们不是所有新 Experiment 必须复制的模板。
- 当前没有 Research Release，`release:<id>` 解析和装载尚未实现。
- `plugins/asset-query-cli/` 是只读本地管理 CLI 原型，不是管理平台。

## 常用检查

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/legacy-asset-intake/scripts/inspect_source.py <archive-or-directory>
python3 .agents/skills/harness-evolution/scripts/validate_repository.py .
python3 .agents/skills/research-eval/scripts/validate_experiment.py \
  evolution/experiments/EXP-<agent-id>-NNN
```

脚本输出 JSON。退出码 `0` 只说明各自覆盖的确定性合同通过，`1` 表示发现问题，`2` 表示输入或读取错误；它们不替代对研究结果的人工判断。

一次 Run 的最小闭环：

```bash
python3 runtime/adapters/dsh-container/run_record.py --repo . init \
  --agent <agent-id> --experiment EXP-<agent-id>-NNN \
  --source experiment:EXP-<agent-id>-NNN --kind research
python3 runtime/adapters/dsh-container/run_record.py --repo . record \
  --run <run-uuid> trial.json
python3 runtime/adapters/dsh-container/run_record.py --repo . finalize \
  --run <run-uuid> --status completed
```

## 规范来源与验收边界

两份受控 Harness 规范仍作为目录和资产模型的设计输入；[`agent-engineering-spec` 锁定提交](https://github.com/wr5912/agent-engineering-spec/commit/1afe0eec1bb786e5313bb0a06717871fd14ebe28) 只作为未来生产化参考。当前适用关系见 [`SOURCES.md`](./docs/standards/SOURCES.md) 和 [`PROJECT-INTERPRETATION.md`](./docs/standards/PROJECT-INTERPRETATION.md)。

本仓库明确区分三层结论：

| 层级 | 回答的问题 |
|---|---|
| 项目与工具链验证 | 仓库规则、CLI、来源解析和 DSH 接入是否按设计工作 |
| Experiment Evaluation | 某项 Harness 变化在声明输入和环境下表现如何 |
| Research Release 复现 | 某个不可变研究版本能否按清单恢复并重新装载 |

静态校验、脚本退出码 `0`、容器启动、端口监听、HTTP `200` 或 `/health` 只能证明对应局部状态。若未来需要生产部署验收，应另行定义生产工程的权限、安全、运维和发布合同，不把它们提前塞入当前研究流程。

仓库变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
