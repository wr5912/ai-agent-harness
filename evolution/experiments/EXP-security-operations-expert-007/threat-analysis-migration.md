# 威胁研判子智能体

威胁研判通过专用子智能体执行名单快速分类或五源融合研判。workspace 保存子智能体 Skill；managed 保存 Python 流程、DSH 插件及配置；业务评估用例见 `agents/security-operations-expert/evaluation.md`。主会话展示程序生成的摘要，SOC MCP 接收研判结果，报告存储 MCP 保存 HTML 并返回下载链接。

## 本地使用

该 Candidate 的运行入口是 `security-operations-expert` Preset。在主智能体会话中输入“请研判威胁事件 INC-20260917-000001”，由专用子智能体处理。

```bash
runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-007 \
  --mode eval --name security-operations-threat-007
runtime/adapters/dsh-container/dsh-dev url security-operations-threat-007
```

运行凭据由宿主环境注入，变量清单见 `candidate/harness.yaml`。模型统一使用 DSH 注册的 Provider：当前会话选中的 Provider/模型由父、子会话及冻结输入推理共同使用；完整研判内部只提交固定提示词与冻结输入，不混入外层对话。配置源码位于 `candidate/dsh/managed/security-operations-expert.patch.yml`。

MCP 连接也在该 Patch：既有巡检及策略/故障 MCP 使用 DSH 原生客户端；威胁研判的 `connections.soc` 指向 SOC MCP 网关，catalog 是工具/资源映射；`connections.report` 指向报告存储 MCP。SOC 回写复用前者，报告下载复用后者。威胁研判 Python 通过 HTTP 网关调用 SOC MCP，通过 Streamable HTTP 调用报告存储 MCP。

四个连接统一列在 `candidate/dsh/managed/mcp-servers.yaml` 的 `servers` 中；`consumer` 标明 DSH 客户端或研判 Python 调用方，`config_location` 仅说明 Patch 中的位置，不是运行时引用语法。SOC 地址由 `SOC_MCP_BASE_URL` 注入，报告存储地址由 `REPORT_MCP_URL` 注入；启动前在宿主运行环境设置，随实例创建传入容器。更改环境变量后，通过 `up --replace` 重新创建实例进程加载配置，无需重建镜像。

只改 Candidate 资产时使用相同命令加 `--replace` 重建实例进程，并新建 Session；无需重建镜像。首次运行需要含 Python 3 的项目 DSH 镜像。浏览器使用 007 实例并选择安全运营主智能体。

## 验证与限制

[EXP-007 快速研判 Run](runs/run-94887845-0608-4462-936e-c30baf6341fd/report.md) 耗时 33.3 秒，208 次 MCP 调用无失败；未调用内层模型，SOC 回写与报告存储成功，主会话正文与程序摘要一致，浏览器刷新和下载内容一致性检查通过。

完整研判参考[EXP-009 运行记录](../../history/imports/threat-analysis-retired/EXP-security-operations-expert-009/runs/run-fb5b955e-3e23-4b7d-aac0-2727769f3218/report.md)：耗时 233.8 秒，441 次 MCP 调用中 60 次失败，模型有 4 条证据值不一致警告；SOC 回写、报告存储和正文交付通过。

确定性检查通过：算法 126 项、投影与存储 22 项、子智能体集成 9 项、Guard 9 项、桩工具清单 10 项；仓库与 Experiment 校验通过。五个威胁研判用例的 dry-run 可解析。配置装载检查覆盖来源、挂载与模块解析，环境变量配置调整后尚未重新执行真实研判及网页交付。

模型证据引用问题保存在结果 JSON 中，可解析的研判内容仍可交付。历史研判数据源尚未接入；技术检查通过不代表研判结论必然正确。
