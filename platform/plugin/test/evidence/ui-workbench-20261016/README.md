# 平台 UI 验收 · 2026-10-16

正式入口：<http://10.0.160.32:3090/hep/>。本轮统一页面宽度、层次、控件、移动布局和轻量动效；首页默认入口为“与助手对话”，编排侧栏只列一次对象并展示草稿／发布状态，移除威胁分析样例创建按钮。

## 效果截图

| 页面 | 桌面 | 手机 |
| --- | --- | --- |
| 首页 | [查看](home-desktop.png) | [查看](home-mobile.png) |
| 智能体管理 | [查看](agents-desktop.png) | [查看](agents-mobile.png) |
| 评测中心 | [查看](evaluation-desktop.png) | [查看](evaluation-mobile.png) |
| Run 详情 | [查看](evaluation-detail-desktop.png) | [查看](evaluation-detail-mobile.png) |
| 实例管理 | [查看](instances-desktop.png) | [查看](instances-mobile.png) |
| MCP 接入 | [查看](mcp-desktop.png) | [查看](mcp-mobile.png) |
| 工具组合编排 | [查看](mcp-composition-desktop.png) | [查看](mcp-composition-mobile.png) |
| 助手真实只读查询 | [查看](assistant-desktop.png) | [查看](assistant-mobile.png) |
| 登录 | [查看](login-desktop.png) | [查看](login-mobile.png) |
| 深色首页 | [查看](dark-home-desktop.png) | [查看](dark-home-mobile.png) |

[动效录屏](ui-motion.webm)展示输入增高、主按钮悬停、页签、浮窗及设置切换；[浮窗](assistant-floating.png)、[启动确认](business/instance-create-confirmation.png)、[网站嵌入](business/instance-embed.png)、[真实 MCP 返回](business/mcp-post-fix-result.png)另存截图。[原 MCP 页面](before-mcp-desktop.png)与[原首页局部](../home-text-entry-20261016/evaluate-desktop.png)供展示对照。

## 实际验证

- 正式全局 DSH：六页 × 360、390、900、1440、1920px，共 30 项；首页、编排与 Markdown 表格另 15 项通过。无页面异常或页面横向溢出。记录见 [formal-ui.json](formal-ui.json)；最终按钮移除另经 [formal-mcp.json](formal-mcp.json)复验。
- 原生模型、内置插件和 Agent 预设设置正常加载。输入框从约 39px 随三行内容增至 85px；减少动态效果时过渡为 0ms；触屏模式的首页切换按钮为 44px。见 [effects.json](effects.json)及 [theme.json](theme.json)。深色文字与实心填充分开，面板链接对比度从 3.29 提升到 6.75，详见 [contrast.json](contrast.json)；未据此宣称全站所有配色均通过对比度审计。
- [通用对话](general-chat.json)：首页原文进入独立管理 Session，不预设构建 Skill；实际模型通过只读工具返回当前六个智能体。业务查询及深色截图来自隔离工作区，正式用户主题未修改。
- [业务验收](business/acceptance.json)：从隔离平台创建标准 DSH 实例、访问页面与 iframe；真实模型执行固定巡检 Case，读取三页、五台基础模拟资产，生成 Markdown 和 CSV。最终 Run `run-b48e0885-3e17-4310-82db-48e1177a9a99` 为 1/1 通过，来源摘要匹配，[报告已从 GUI 下载](business/final-run-report.md)。MCP 配置保存回读、资源读取及对象参数工具查询通过。临时实例已停止，登记保留。下载报告保留原文，内部链接相对原 Run 目录，在本截图归档中不展开完整 Run。
- 平台插件完整 350 项测试通过；最新按钮移除后的 5 项编排交互测试及构建通过。评测解释器链另有 19 项 Python、2 项 Node 回归，覆盖 PATH 中 Python 不可用及自定义实例入口。

原生 DSH 导航可能自动创建空 Session；“只读浏览”指未改业务资产、Run 或实例，不表示运行状态完全不写入。隔离验收使用真实平台、模型和容器，外部资产数据来自基础 Mock，不代表真实设备健康检测或安全业务验收。

## 保留的观察与部署来源

手机报告表格原先被压成细长列，[原图](observations/report-narrow-before.png)保留；现使用原生容器局部横滚，长文本列为 320px。[首次评测校验失败](business/eval-first-runtime-failure.json)和 [MCP 查询失败](business/mcp-query-observed.json)保留；解释器选择与 OpenAPI 对象参数的共同实现已修复，同一业务输入复测通过。实时报告页更新较慢、停止确认后弹窗消失的观察及最终结果回读见业务验收记录。

UI 基线为 `cc329e3`，全站正式截图基于 `06f7f78`，MCP 最后移除入口后的截图基于 `e2a69ac`，最终深色截图及[正式装载回读](deployment.json)基于 `92f7db9`。正式运行使用原数据根和平台 HOME，原三个业务实例保持运行。另一并发任务正在编辑数据仓库的扩展源码，标准启动检查遇到未配套的 `model-attempts.ts`；本轮没有覆盖其修改，继续装载重启前已准备的扩展 `779e11612bced9e3c225c55f3f44f4174499ce4db172d85abb2425f8c31fddbd`。该并发扩展修改完成前，直接重新执行 `prepare/start` 仍需先核对来源配套关系。本轮恢复启动脚本和日志保存在本机 `/tmp/hep-ui-workbench-20261016/`。
