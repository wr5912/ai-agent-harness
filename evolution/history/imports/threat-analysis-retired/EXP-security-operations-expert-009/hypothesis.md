> 历史实验：迁移目标已按用户要求纠正为 EXP-007。下文保留本次实施与验证时的方案；当前入口见 [EXP-007](../EXP-security-operations-expert-007/threat-analysis-migration.md)。本 Candidate 冻结，不继续双份开发。

# 威胁研判子智能体迁移

以 EXP-007 Candidate 为主智能体基线，引入 EXP-threat-analysis-001 的当前固定取证、名单分类、五源融合、提示词、校验与报告代码。源代码尚未提交，迁移来源摘要单独记录；源实验保留为历史比较入口，不继续双份开发。EXP-008 已被本机策略预览实验使用，本次使用 EXP-009。

## 实施与比较

1. workspace 新增 threat-analysis Skill；managed 注册专用 spawn 子智能体及执行工具，Guard 只允许该子智能体调用研判工具。
2. 完整研判通过 DSH 已注册模型适配器，继承当前会话的模型选择，只传固定提示词与冻结输入。快速分类不调用内层模型。子智能体与父会话均直接交付程序生成的摘要。
3. MCP 连接集中到主智能体 Patch。保留 SOC 网关和 persistence 两种已验证传输，二者均由固定代码使用，不向主模型开放任意底层调用。此次不更改外部 MCP 服务或创建工具组。
4. agents/security-operations-expert/evaluation.md 是当前业务评估事实源；选择真实快速、完整研判及既有能力查询，核对双存储、下载和父子会话。补充离线权限、交付隔离和模型输入测试。

## 预期与停止条件

主会话委派深度为 1；原巡检、故障和策略路由仍可用。快速及完整研判生成正式助手摘要，报告链接来自 persistence，SOC 接收结构化回写。校验问题保留于 JSON，不显示在摘要或报告。历史数据源依然未接入。若需要修改 DSH Runtime、丢失原始结果或固定输入边界被破坏，停止采纳并记录问题。

涉及 PA-06、PA-07、PA-08。静态检查与实际业务比较分别记录，不创建 Research Release。

## 本地使用

该 Candidate 的运行入口仍是 `security-operations-expert` Preset。在主智能体会话中输入“请研判威胁事件 INC-20260917-000001”，由专用子智能体处理。

```bash
runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-009 \
  --mode eval --name security-operations-threat
runtime/adapters/dsh-container/dsh-dev url security-operations-threat
```

运行凭据由宿主环境注入，变量清单见 `candidate/harness.yaml`。模型统一使用 DSH 注册的 Provider：当前会话选中的 Provider/模型由父、子会话及冻结输入推理共同使用；完整研判内部只提交固定提示词与冻结输入，不混入外层对话。配置源码位于 `candidate/dsh/managed/security-operations-expert.patch.yml`，没有另一个可编辑的内层模型配置。

MCP 连接也在该 Patch：既有巡检及策略/故障 MCP 使用 DSH 原生客户端；威胁研判的 `connections.soc` 指向 SOC MCP 网关，catalog 是工具/资源映射；`connections.report` 指向报告存储 MCP。SOC 回写复用前者，报告下载复用后者。固定代码的传输方式保持现状，不声称已切换成 DSH 原生 MCP 客户端。

只改 Candidate 资产时使用相同命令加 `--replace` 重建实例进程，并新建 Session；无需重建镜像。首次运行需要含 Python 3 的项目 DSH 镜像。旧 `threat-analysis` 实例不会自动切换，浏览器需打开新实例并选择安全运营主智能体。
