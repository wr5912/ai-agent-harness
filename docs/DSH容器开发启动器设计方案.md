# DSH 容器开发启动器设计方案

> 状态：`dsh-dev` 已实现 `image build`、`plan`、`up`、`ps`、`url`、`logs`、`down` 和 `up --replace`。完整操作说明见[《DSH 开发与评测启动器设计方案》](./DSH开发与评测启动器设计方案.md)。

本文只说明为什么采用当前容器结构。研究管理入口见[《DSH Harness 研究管理 CLI 设计方案》](./DSH-Harness研究管理CLI设计方案.md)；它是本地 CLI 方向，不是平台提案。

## 1. 目标

启动器解决三个容易混淆的问题：

- 本次到底选择了哪个 Experiment、Agent 和 Preset；
- 开发会话和被测会话分别能读写什么；
- 源码修改后是否由新容器、新 Session 实际装载。

它不评价 Harness 效果，也不建设生产部署入口、权限平台或审批流程。

## 2. 当前结构

```text
开发者终端 ── dsh-dev ── Docker Compose
                           ├── home-init：初始化独立 DSH_HOME
                           └── dsh：锁定镜像中的官方 DSH
                                ├── 127.0.0.1:<port> Web
                                ├── 按模式挂载 Candidate
                                └── 每实例独立 HOME 数据卷
```

`dsh-dev` 在仓库外的用户状态目录生成实例配置。Harness 通过 bind mount 装载；Session、设置、附件和缓存留在独立 DSH_HOME，不写进 Candidate。

## 3. 两种模式

| 内容 | `--mode dev` | `--mode eval` |
|---|---|---|
| 会话身份 | 出厂 `cordis` 创造模式 | 来源声明的目标 Preset |
| Candidate workspace | 读写 | 只读 |
| Preset / managed | 只读 | 只读 |
| spec / eval reference | 只读提供给开发者 | 不挂载 |
| DSH_HOME | 独立数据卷 | 独立数据卷 |

开发模式可以修改当前 Experiment 的行为资产；被测模式观察同一 Candidate。源码变化不会让旧进程或旧 Session 自动更新，必须重启并创建新 Session 后再判断是否生效。

当前只支持 `experiment:<id>`。未来 `release:<id>` 若实现，也只表示装载具体 Research Release，不增加生产部署含义。

## 4. 网络选择

本地 Web 使用 `network_mode: host`，DSH 明确绑定 `127.0.0.1:<port>`。这样浏览器可以直接访问 DSH 自己打印的认证 URL，也意味着容器能访问宿主回环服务。

因此当前规则只有几项：

- 仅用于本地受信任研究；
- 不把监听地址扩展为 `0.0.0.0`；
- 不挂 Docker Socket；
- 开发模式等同 shell 权限，启动时需要 `--accept-cordis-trust`；
- 不适合接受这一网络边界时，不启动该实例。

这些是当前本地工具的直接边界，不扩展成通用安全平台。

## 5. 认证 URL

`dsh-dev url <name>` 从该实例当前进程日志中提取 DSH 生成的 URL，核对回环地址、端口和认证交接后输出。它不拼造 Token，也不回退到旧进程链接。

认证 URL 只在操作者明确调用时显示；非交互消费必须显式使用 `--non-interactive`。URL、Token 和 Cookie 不写入实例状态、仓库或研究证据。DSH 自身日志可能含认证 URL，因此原始容器日志仍按敏感运行状态处理。

## 6. 结论边界

- `plan` 成功只说明来源可以解析。
- Compose 展开成功只说明配置可以生成。
- 容器运行和 HTTP `200` 只说明对应进程或页面状态。
- 实际装载需要在新容器、新 Session 核对目标 Preset、Skill 和行为。
- Harness 改动是否有价值由对应 Experiment 的 Run、观察和 Decision 回答。

当前完整路径和缺口见项目验收矩阵的 `PA-04` 至 `PA-09`。Web 完整交互、新 Preset Web 选择和 `release:<id>` 仍未完成，不能由静态测试或旧证据代替。
