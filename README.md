# ai-agent-harness

ai-agent-harness 是正在持续建设的、基于 DSH 的 Harness 工程平台，提供智能体资产、评测、实例和工具管理能力，并将经过验证的技术研究成果持续融入平台。

项目面向个人开发者，以平台建设和实际使用需求为主线。平台通过系统全局 DSH 装载 Cordis 插件，复用已有 CLI、Harness 资产和运行记录；业务智能体由独立的 DSH 容器实例执行。项目定位、开发边界和协作原则以 [`AGENTS.md`](./AGENTS.md) 为准。

## 当前能力

| 页面 | 可以完成的操作 |
|---|---|
| 首页 | 查看真实资产数量、最近 Run 和实例观察，进入各管理页面 |
| 管理对话 | 在当前项目工作区使用原生 DSH 会话，保留会话、草稿与模型设置入口 |
| 智能体与评估 | 创建 Experiment 版本、查看来源与继承；通过基本信息、资产、评测三个标签查看详情；在资产树中选择文件、弹窗编辑，保存前执行 dry 校验并检查原文件摘要；执行评测并查询已有 Run、报告和轨迹 |
| 实例管理 | 创建、启停、重启、删除及批量操作 DSH 容器实例，查看逐项回执；获取 Web 访问入口和 iframe 嵌入说明 |
| MCP 管理 | 管理 OpenAPI/MCP 服务、工具与资源分组及调试；维护轻量 LangGraph 两步只读组合的草稿和发布版，查看流程、执行 dry 或实际测试，将已发布组合服务加入分组 |

平台直接使用既有工具链：`dsh-dev` 管理实例，`dsh-eval` 执行评测，`run_record.py` 索引、查看和比较封存 Run，来源解析和校验器检查资产合同。编辑写回原有 Candidate、评估与 Decision，编排配置写回唯一工具目录。

完整能力状态、验证证据和缺口统一见[项目验收矩阵](./docs/ai-agent-harness项目验收矩阵.md)。当前 Preset 的 Web 创建、回流与选择闭环尚未完成（PA-09）；`release:<id>` 来源解析和实际装载尚未实现（PA-11）。MCP 组合的业务可用性还取决于上游接口和授权，dry 或工具发现成功不能替代真实业务验证。

## 快速启动

准备系统全局 DSH、Node.js、pnpm 和 Python。DSH 版本须匹配平台插件的兼容声明；工具链已使用 Node.js 24 和 Python 3.10 验证，环境若默认使用旧版，应先调整 PATH 选择兼容解释器。

```bash
# 首次使用及平台插件源码修改后执行
./platform/dsh-platform prepare

# 只预览来源、HOME、插件路径和监听参数
./platform/dsh-platform start --dry-run

# 前台启动，默认监听本机局域网 IPv4 的 3090 端口
./platform/dsh-platform start

# 指定地址或端口；仅本机使用可设置 --host 127.0.0.1
./platform/dsh-platform start --host 192.168.1.10 --port 3091
```

打开终端显示的 `/hap/` URL，使用 [`platform/credentials/admin.json`](./platform/credentials/admin.json) 中配置的账号登录。账号在该文件维护，修改后重启生效，旧登录会话失效。查询与编辑不需要 LLM API Key；使用管理对话前，在“设置 → 模型”配置所选模型。

平台使用仓库外独立 HOME 保存 Session、设置及凭据，再次 `prepare` 和重启会保留用户设置。使用 `Ctrl+C` 停止，再次 `start` 复用同一 HOME；“退出登录”撤销当前会话。版本兼容、认证和装载的完整合同见[当前平台接入合同](./docs/platform-design/02_系统架构与部署设计.md#当前最小平台接入合同)。

业务实例还需要 Docker、标准 DSH Runtime 镜像及所选来源声明的运行环境。将示例中的 `<experiment-id>` 替换为已有 Experiment ID，先预览来源，再按需启动或评测：

```bash
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:<experiment-id> --mode eval --dry-run

python3 runtime/adapters/dsh-container/dsh-eval \
  --source experiment:<experiment-id> --mode fast --dry-run
```

当前启动器的来源选择器支持 `experiment:<id>`；`--mode eval` 表示实例只读装载被测 Harness，`dsh-eval --mode fast/full` 表示评测范围，两者不同。业务实例从 `/assistant/` 访问。实例生命周期、镜像构建、工作区注册、环境变量和访问规则的唯一使用说明见[容器适配器 README](./runtime/adapters/dsh-container/README.md)。业务实例的访问设置与平台密码登录分别维护。

## 开发与研究方式

项目的工作方式和修改边界由[根级规则](./AGENTS.md#项目定位与工作方式)维护。平台开发围绕实际需求交付可用能力；遇到技术或效果不确定的问题时，做必要研究或 POC，再将验证有效的结果纳入实现。技术研究的依据按需保存在既有任务或设计记录中，不另建阶段台账。

```text
实际问题 → 必要研究或 POC → 最小实现 → 实际验证 → 能力沉淀
```

已有可靠实现路径的功能直接开发和验证。新建、迁移或改变业务 Harness 语义时，继续采用 Research Mode 的研究方法：

```text
Baseline 引用 → Experiment（含 Candidate）→ Evaluation → Decision
                                                        └→ 可选 Research Release
```

Baseline 用固定 Git 提交、Research Release 或 `none:first-experiment` 引用；Candidate 保存待比较资产；Run 固定实际来源、输入和证据；Decision 说明结果、回归、限制与下一步。评估规模按问题决定，允许 `adopt`、`continue`、`reject`、`inconclusive`。Research Release 是可复现的研究版本，不表示平台发布或生产验收。

平台实现按项目路径验证，不为普通页面、工具或启动器修改建立业务 Experiment。新增自研功能使用 TypeScript，界面使用 TSX；现有 Python 按受影响的功能切片维护，不做全仓语言重写。开发前按[分支与开发工作流](./AGENTS.md#分支与开发工作流)确定对象和修改范围，查阅[AI 纠错经验总结](./docs/AI纠错经验总结.md)与[项目术语表](./docs/项目术语表.md)。

| 工作 | 技能入口 |
|---|---|
| 平台功能、通用工具与 Runtime 适配 | [`dsh-platform-development`](./.agents/skills/dsh-platform-development/SKILL.md) |
| 平台页面任务梳理 | [`dsh-platform-task-list`](./.agents/skills/dsh-platform-task-list/SKILL.md) |
| Harness 创建、迁移、修改与优化 | [`harness-guided-workflow`](./.agents/skills/harness-guided-workflow/SKILL.md) |
| 并行能力融合 | [`harness-experiment-fusion`](./.agents/skills/harness-experiment-fusion/SKILL.md) |
| 旧资产只读清点 | [`legacy-asset-intake`](./.agents/skills/legacy-asset-intake/SKILL.md) |
| Harness 实验与评估 | [`harness-evolution`](./.agents/skills/harness-evolution/SKILL.md)、[`research-eval`](./.agents/skills/research-eval/SKILL.md) |
| 显式盘点目标与实际进展 | [`continuous-dev-progress-vs-project-vision-gap-assessment`](./.agents/skills/continuous-dev-progress-vs-project-vision-gap-assessment/SKILL.md) |
| 用户明确纠错的追加记录 | [`ai-correction-log`](./.agents/skills/ai-correction-log/SKILL.md) |

## 主要目录

```text
AGENTS.md                                # 项目定位、协作规则与修改边界
.agents/skills/                          # 维护本仓库的开发技能
.codex/                                  # Codex 开发配置，不是业务 Harness
platform/                                # 平台启动入口、Profile、插件和运行时技能
agents/<agent-id>/                       # 智能体入口与唯一 evaluation.md
  manifest.yaml
  evaluation.md
evolution/experiments/<experiment-id>/   # 业务 Harness 的研究资产和记录
  change.yaml                            # 来源、基线引用与状态
  hypothesis.md                          # 研究问题与比较方法
  candidate/                             # 可编辑 Harness 工作树
  evaluation/                            # 按需保存观察与证据
  runs/run-<UUIDv4>/                     # 不可改写的实际运行记录
  decision.md                            # 研究结论与下一步
evolution/history/imports/               # 历史导入来源与处置记录
runtime/adapters/dsh-container/           # DSH 容器装载、评测与来源解析
plugins/asset-query-cli/                 # 资产查询原型与复用的发现逻辑
releases/<agent-id>-v<semver>/            # 可选 Research Release
docs/                                    # 设计、规范适用解释和验收证据入口
tests/                                   # 可重复的合同测试
AI纠错记录/                               # 按天追加的开发纠错记录
```

每个 Agent 的业务 Case 只在其 `evaluation.md` 维护；Run 中的冻结输入是历史事实，不是第二份可编辑 Case。Git 和 Research Release 保存可恢复版本，不维护 `evolution/baselines/` 或 `agents/<agent-id>/current/`。Session、缓存、附件和整个 Runtime HOME 不作为 Harness 资产回流。

## 验证与文档入口

```bash
python3 -m pip install -r .agents/skills/harness-evolution/scripts/requirements.txt
python3 .agents/skills/harness-evolution/scripts/validate_repository.py .
python3 .agents/skills/research-eval/scripts/validate_experiment.py \
  evolution/experiments/<experiment-id>
```

校验器输出 JSON：退出码 `0` 表示所覆盖的确定性合同通过，`1` 表示发现问题，`2` 表示输入或读取错误。项目与工具链验证、Experiment Evaluation、Research Release 复现各自需要对应证据，不能互相替代，也不等于生产部署验收。评测执行器、封存 Run 和比较输出的具体语义见[容器适配器说明](./runtime/adapters/dsh-container/README.md)。

| 文档 | 用途 |
|---|---|
| [项目验收矩阵](./docs/ai-agent-harness项目验收矩阵.md) | 当前实现、验证证据与缺口的唯一维护位置 |
| [平台设计入口](./docs/platform-design/README.md) | 当前平台合同、能力路线与待实现设计 |
| [来源锁定](./docs/standards/SOURCES.md)、[项目解释](./docs/standards/PROJECT-INTERPRETATION.md) | 受控规范的版本、来源及适用范围 |
| [项目审查原则](./docs/项目审查原则.md) | 项目与 Harness 的审查范围和方法 |
| [VERSION.md](./VERSION.md) | 仓库治理版本，区别于 Harness Release 与 Git Tag |

受控规范作为设计输入，按当前任务采用，不自动引入生产审批、固定 Case 数或发布门禁。历史实验、封存 Run、原始导入和既有摘要保留其原有身份与事实；历史容器内修改记录见 [dsh-dev-real-session-20260919.json](./evolution/experiments/EXP-security-operations-expert-001/evaluation/evidence/dsh-dev-real-session-20260919.json)，不代表当前实例支持容器内修改。
