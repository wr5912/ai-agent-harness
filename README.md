# ai-agent-harness

本项目是面向个人开发者的 DSH-only Harness 研究与资产管理仓库。它用于创建、修改、比较和持续优化 Harness，并用 Git、Experiment、Run 与可选 Research Release 保存可复现的研究结果。

项目默认且唯一采用 **Research Mode**：研究优先，禁止过度工程化和过度安全化；遵循简洁优先（Simplicity First）和精准修改（Surgical Changes）。这里不建设生产级 Agent 平台，也不把权限、审批、治理或多阶段发布机制作为每个实验的前置条件。

长期方向是研究验证、自用工具、能力逐步完善，最终演进为 AI 原生的 Harness工程平台（Harness Engineering Platform）。只有反复验证有价值的能力才逐步扩展，具体工程边界届时决定；当前约束与演进原则见 [`AGENTS.md`](./AGENTS.md)。

当前已实现 eval-only 容器实例启动器 `runtime/adapters/dsh-container/dsh-dev`、受管评测入口 `runtime/adapters/dsh-container/dsh-eval`，以及来源解析、Candidate 冻结与摘要、Run 台账和仓库校验工具。Harness 的创建、迁移、修改和优化由宿主开发会话通过 `harness-guided-workflow` 引导，源码写入后再用新的只读评测实例验证。历史上曾完成一次容器内 Headless Skill 修改闭环，证据见 [`dsh-dev-real-session-20260919.json`](./evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json)；该证据只记录当时已退役的开发模式，不代表当前入口仍支持容器内修改。

研究平台通过系统全局 DSH 装载仓库维护的 Cordis 插件，提供只读“研究资产”首页，显示现有 Agent、Experiment、Run 和仓库来源。平台启动入口是 `platform/dsh-platform`；完整接入合同见[平台设计方案](./docs/DSH智能体运行管理平台设计方案.md)，实际验证状态见 `PA-12`。

本项目共有多少条验证路径、当前完成到哪里、哪些适合进入自动化测试，统一见[项目验收矩阵](./docs/ai-agent-harness项目验收矩阵.md)。

## 现在能做什么

| 能力 | 状态 | 入口 |
|---|---|---|
| 解析 Experiment 来源，确定目标 Agent、Preset、资产路径与挂载 | 已实现 | `source_contract.py` |
| 启动只读被测会话（`--mode eval`） | 已实现；需要 Docker 和运行时环境变量 | `dsh-dev up/ps/url/logs/down` |
| 重载同来源、同模式的 eval 实例配置 | 已实现 | `dsh-dev up --replace` |
| 构建锁定 DSH 提交的本地镜像 | 已实现 | `dsh-dev image build` |
| 按 `evaluation.md` 启动独立实例、逐 Case 新建 Session、导出轨迹并封存 Run | 已实现；默认走 DSH Runtime API，浏览器 UI 冒烟需显式选择；需要 Docker 和运行时环境变量 | `dsh-eval` |
| 摘要、冻结、校验或恢复 Candidate 三棵资产树 | 已实现 | `mutation-receipt.py` |
| 归档研究运行，并按 Agent 索引、查看或并列比较已封存 Run | 已实现；`compare.comparable` 只判断记录的同条件项，业务等效仍需人工复核 | `run_record.py init/record/gap/finalize/index/show/compare` |
| 校验项目结构、Experiment、Run 与 Research Release 合同 | 已实现 | `validate_repository.py` / `validate_experiment.py` |
| 通过全局 DSH 打开只读研究资产首页 | 已实现；装载与浏览器验证状态见 `PA-12` | `platform/dsh-platform` |
| 新 Preset 的 Web 创建、回流与选择闭环 | 尚未完成 | `PA-09` |
| 解析并装载 `release:<id>` | 尚未实现 | `PA-11` |

当前来源选择器只支持 `experiment:<id>`。Research Release 的目录合同可以先用于保存可复现版本；只有 `release:<id>` 解析和实际装载入口完成后，才能声称启动器支持它。

## 从哪里开始

1. 阅读根级 [`AGENTS.md`](./AGENTS.md)，确认 Research Mode、四类开发对象和本次修改边界。
2. 阅读[来源锁定](./docs/standards/SOURCES.md)和[项目解释](./docs/standards/PROJECT-INTERPRETATION.md)，了解受控规范在研究项目中的适用范围。
3. 阅读[项目验收矩阵](./docs/ai-agent-harness项目验收矩阵.md)，确定本次涉及的 `PA-xx`。
4. 创建、迁移、修改或优化 Harness 时先使用引导入口；该入口按任务类型调用必要技能。项目技能：

   | 技能 | 使用时机 |
   |---|---|
   | `harness-guided-workflow` | 按讨论、计划、执行、验证的多轮 SOP 引导完整任务 |
   | `harness-experiment-fusion` | 融合并行 Experiment，核对来源、装载依赖与组合行为 |
   | `legacy-asset-intake` | 只读清点旧归档或历史交付，不执行其中内容 |
   | `harness-evolution` | 建立或修改 Experiment、Candidate、Decision 和 Research Release |
   | `research-eval` | 设计小规模比较、校验 Run 与总结研究结论 |
   | `dsh-platform-task-list` | 梳理未来 DSH 智能体运行平台的页面开发任务清单 |
   | `$continuous-dev-progress-vs-project-vision-gap-assessment` | 显式评估未来平台目标与当前进展，生成任务说明及 4K SVG |
   | `ai-correction-log` | 用户明确纠正上一轮错误时记录问题要点 |

### 启动研究平台

先安装系统全局 DSH，再准备平台插件和 Profile：

```bash
# 首次使用及平台插件源码修改后执行
./platform/dsh-platform prepare

# 只预览来源、HOME、插件路径和监听参数
./platform/dsh-platform start --dry-run

# 前台启动，默认地址 http://127.0.0.1:3090
./platform/dsh-platform start

# 需要其他端口时显式指定
./platform/dsh-platform start --port 3091
```

在启动终端完成 DSH 原生认证交接。新 HOME 的原生欢迎流程可以选择“稍后配置”，再从侧栏打开“研究资产”；资产查询不需要 LLM API Key。使用 `Ctrl+C` 停止，再次 `start` 复用平台 HOME。运行数据位置、兼容版本和失败处理见[平台接入合同](./docs/DSH智能体运行管理平台设计方案.md#当前最小平台接入合同)。

### 启动本地评测实例

下面先预览实际参数，再启动只读被测实例：

```bash
# 只解析来源并预览参数；不写状态、不调用 Docker
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode eval --dry-run

# 首次使用或镜像内容变化后构建锁定镜像
python3 runtime/adapters/dsh-container/dsh-dev image build

# 被测实例只读装载 Candidate
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode eval

# 获取本次进程的认证 URL；非交互终端显式增加 --non-interactive
python3 runtime/adapters/dsh-container/dsh-dev url security-operations-expert-eval

python3 runtime/adapters/dsh-container/dsh-dev ps
python3 runtime/adapters/dsh-container/dsh-dev down security-operations-expert-eval
```

修改 Preset、managed 配置或适配层脚本后，已有进程不会自动重载：

```bash
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode eval --replace
```

运行边界：

- `--source` 和 `--mode` 必须显式给出；缺失或只写旗标不写值时，命令会列出当前可用的 Experiment 和唯一模式 `eval`。
- `--name` 默认为 `<agent-id>-eval`。新实例未指定 `--port` 时从 `3081` 起选择第一个未监听且未被有效实例记录占用的端口；已有同名实例则复用其记录端口。
- `up --dry-run` 不要求运行时环境变量，不写状态、不调用 Docker；自动端口只是当下建议，真正启动前会重新检查。
- `up` 默认要求来源声明的运行时环境变量已经注入；仅做无凭据技术装载时可显式使用 `--allow-missing-env`。
- `up` 成功时 stdout 只输出一个 JSON 结果；进度、提示和错误写入 stderr，失败时不在 stdout 留下部分成功结果。
- 实例状态位于仓库外的 `$XDG_STATE_HOME/dsh-dev/<name>/`。Token 不落盘、不进入仓库、不写入研究证据。
- 容器使用 host 网络但只绑定 `127.0.0.1`。
- 首次打开 Web 需手工注册 `up --dry-run` 输出中 `workspace_to_register` 给出的 `/work/harness/workspace`。
- 同名实例不能静默改端口；需要重载时使用 `--replace` 或先 `down` 再同名 `up`。
- 旧 `authoring` 实例状态仍可用 `ps`、`logs` 和 `down` 查询或停止，但不能据此新建或替换开发实例。

## 评测会话

| 内容 | `--mode eval` 被测会话 |
|---|---|
| 本次会话身份 | 来源声明的目标 Preset |
| 待研究目标 | 同本次会话身份 |
| 注册工作区 | `/work/harness/workspace` |
| Candidate 三棵资产树 | 只读 |
| `/work/reference` | 不挂载 |

被测会话不挂载需求、评估标准或其他参考材料，避免把判分内容误当成目标能力；Harness 源码修改在宿主开发会话中完成，不由被测容器自修改。

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
  evaluation.md                          # 业务 Case 的输入与预期的单一事实源
evolution/
  experiments/EXP-<agent-id>-NNN-r<12位随机十六进制>/
    change.yaml                          # 基线引用、状态与结果
    hypothesis.md                        # 为什么改、怎样判断
    candidate/                           # 本实验的可修改 Harness 工作树
    evaluation/                          # 按需保存工具、证据与研究总结；不保存评测计划副本
    runs/run-<UUIDv4>/                   # 一次执行的独立事实记录
    decision.md                          # adopt/continue/reject/inconclusive 及理由
  history/imports/<agent-id>-YYYY-MM-DD/ # 外部来源原貌、清洗材料与处置记录
platform/
  profile/                               # 全局 DSH 平台组合的可编辑来源
  dsh-platform                           # 准备、预览和前台启动入口
  plugin/                                 # 平台 TypeScript Host 和客户端源码
plugins/
  asset-query-cli/                       # 只读资产查询原型与发现逻辑
runtime/adapters/dsh-container/           # DSH 容器只读装载与评测适配层
releases/<agent-id>-v<semver>/            # 可选、不可变的 Research Release
tests/                                    # 稳定且可重复的机器合同测试
AI纠错记录/                               # 按天追加的 AI 纠错记录
```

`evolution/history/imports/` 只保存来源追溯和迁移审计。需要改变当前 Harness、研究目标或比较材料时，修改现行资产并进入新的 Experiment，不回写历史批次来改变当前行为。

每个 Agent 的当前业务测试只在 [`evaluation.md`](agents/security-operations-expert/evaluation.md) 维护；每个 Case 把名称、用户输入和预期结果放在一起。运行时用 `--case` 显式选择；Run 自动锁定所选 Case 的完整快照和摘要，这些不可编辑记录不是第二份维护源。

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
- `platform/` 已提供最小只读平台工具；研究工作台和评测执行仍使用现有入口。

## 常用检查

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/legacy-asset-intake/scripts/inspect_source.py <archive-or-directory>
python3 .agents/skills/harness-evolution/scripts/validate_repository.py .
python3 .agents/skills/research-eval/scripts/validate_experiment.py \
  evolution/experiments/<experiment-id>
```

脚本输出 JSON。退出码 `0` 只说明各自覆盖的确定性合同通过，`1` 表示发现问题，`2` 表示输入或读取错误；它们不替代对研究结果的人工判断。

受管评测会自动完成 Run 创建、执行、证据导出、场景诊断、封存和实例停止。默认 `--mode fast` 运行标记的 Case，`--mode full` 运行全部 Case，`--case` 可覆盖档位；三者均不改变 `dsh-dev --mode eval` 的容器运行模式。默认通过 DSH Runtime Session API 执行业务 Case；浏览器通道只核对初始提示、工作区、模型、发送和显示等 UI 链路，需显式指定。先用 `--dry-run` 核对选择与环境变量名称：

```bash
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:<experiment-id> --mode fast --dry-run
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:<experiment-id> --mode full
python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:<experiment-id> --executor browser --case <case-id>
```

只需手工记录观察时，直接使用底层 Run 台账：

```bash
python3 runtime/adapters/dsh-container/run_record.py --repo . init \
  --source experiment:<experiment-id> --case <case-id> --kind research
python3 runtime/adapters/dsh-container/run_record.py --repo . record \
  --run <run-uuid> trial.json
python3 runtime/adapters/dsh-container/run_record.py --repo . finalize \
  --run <run-uuid> --status completed

# 根据 Agent 找到 Run，再查看冻结 Case 与证据，或并列比较两个 Run
python3 runtime/adapters/dsh-container/run_record.py --repo . index --agent <agent-id>
python3 runtime/adapters/dsh-container/run_record.py --repo . show \
  --run <run-uuid> --case <case-id>
python3 runtime/adapters/dsh-container/run_record.py --repo . compare \
  --left <baseline-run-uuid> --right <candidate-run-uuid> --case <case-id>
```

`compare.comparable=false` 时先看 `limits`，并列输出只供人工查证，不能据此声称同条件等效；`comparable=true` 也不替代业务效果复核。

## 规范来源与验收边界

两份受控 Harness 规范仍作为目录和资产模型的设计输入；[`agent-engineering-spec` 锁定提交](https://github.com/wr5912/agent-engineering-spec/commit/aa3f27ae0b785191d0a122a6857154640073d73b) 中的任务路由、多轮引导和外部资产复用原则已通过 `harness-guided-workflow` 采用，生产审批、发布门禁等内容仍只作未来参考。当前适用关系见 [`SOURCES.md`](./docs/standards/SOURCES.md) 和 [`PROJECT-INTERPRETATION.md`](./docs/standards/PROJECT-INTERPRETATION.md)。

本仓库明确区分三层结论：

| 层级 | 回答的问题 |
|---|---|
| 项目与工具链验证 | 仓库规则、CLI、来源解析和 DSH 接入是否按设计工作 |
| Experiment Evaluation | 某项 Harness 变化在声明输入和环境下表现如何 |
| Research Release 复现 | 某个不可变研究版本能否按清单恢复并重新装载 |

静态校验、脚本退出码 `0`、容器启动、端口监听、HTTP `200` 或 `/health` 只能证明对应局部状态。若未来需要生产部署验收，应另行定义生产工程的权限、安全、运维和发布合同，不把它们提前塞入当前研究流程。

仓库变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。
