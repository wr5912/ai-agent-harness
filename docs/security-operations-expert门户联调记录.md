# security-operations-expert 门户联调记录

> 2026-09-28 的 Research Mode 联调事实；不是生产接入方案或多用户验收。目标是在门户 `https://172.16.138.232:18060/iframe/1` 的「AI助手」入口展示 EXP-007 的 DSH Web，并保留后续继续设计 SSO 与用户隔离所需的取舍背景。

## 当前 13181 直连状态

2026-09-28，`security-operations-expert-portal-pilot` 已停止但未删除；同一 EXP-007 来源改由 `security-operations-expert-lan` 在 `0.0.0.0:13181` 运行，启用 `--lan-access --unsafe-no-auth --skip-testing-notice`，未启用 HTTP 密码登录。受信局域网内可直接打开 `http://172.16.138.228:13181/`，无需 Token。实测无凭据根页返回 `200`，浏览器新会话和刷新后都没有“内测声明”弹窗，工作台与「自动化任务」入口可见；已有工作区中新会话收到真实模型回复。这是直连 Web 冒烟，不是按 Case 封存的 Evaluation Run。关闭认证和 Host/Origin 校验后，任何可达该端口的人都能访问同一实例的会话、任务和运行数据，**不得提供给不受信用户或公网**。

下面的门户代理、隧道和 Token 认证记录属于此前 `security-operations-expert-portal-pilot` 的历史试点。切换到新实例后尚未重新验证门户 `:18120` 代理及 iframe 链路，不能据此声称门户入口当前可用。

## 历史门户试点与实测

门户菜单 `AI助手`（菜单 ID `95224`，组件 `InnerLink`）的目标地址已改为 `https://172.16.138.232:18120/`；门户仍以 `/iframe/1` 展示该菜单。`/iframe/1` 来自菜单顺序，不是稳定的后端路由标识；旧 `/web-ai/ai/console` 服务路径未删除。菜单目标不含 Token，门户菜单配置中的测试值 `123456` 也不能代替 DSH 的启动认证令牌。

```text
浏览器门户 :18060 /iframe/1
  └─ iframe → HTTPS :18120（门户主机上的独立 Nginx）
               └─ 127.0.0.1:13182（反向 SSH 隧道）
                    └─ 172.16.138.228:13181（DSH 实例）
受信局域网浏览器 ────────────→ http://172.16.138.228:13181/（直连，不经过门户或隧道）
```

DSH 实例名为 `security-operations-expert-portal-pilot`，来源是 `experiment:EXP-security-operations-expert-007`，Web Profile 装载只读 Candidate 和独立 DSH_HOME 卷，模型界面显示 `DeepSeek-V41-Flash`、推理强度 `Off`。2026-09-28 以 `dsh-dev up --lan-access --replace` 保留原 HOME 卷重建后，实例监听 `0.0.0.0:13181`，仍使用普通 `web` Profile 的 Token 认证，没有启用 HTTP 密码登录。保留的 `--trusted-host 172.16.138.232:18120` 仅使 DSH 接受代理保留的外部 `Host`。直连 `http://172.16.138.228:13181/` 未认证返回 `401`；从局域网 IP 的 Token 入口建立 Cookie 后，根页返回 `200` 且包含 DSH Web 启动标记；从独立 Docker bridge 网络命名空间访问该 IP 也返回未认证 `401`。尚未从另一台局域网主机验证防火墙和网络路径。纯 HTTP 的 Token 与 Cookie 在网络上传输，只限受信局域网联调。

代理配置以 [`portal-pilot.nginx.conf`](../runtime/adapters/dsh-container/portal-pilot.nginx.conf) 为源码，门户主机部署副本位于 `/opt/dsh-portal-pilot/nginx.conf`，运行容器名为 `dsh-portal-pilot-proxy`。代理仅向 DSH 转发本入口对应的 DSH 会话 Cookie，去掉浏览器传来的 `Authorization`，不记录访问日志；它不提供门户用户身份校验。浏览器 Cookie 按主机名而非端口发送，故 DSH Cookie 仍可能随同主机的门户请求到达 `:18060`；当前代理只阻止反方向的门户 Cookie 进入 DSH，不能把两套 Web 认证视为相互隔离。重建后检查 `https://172.16.138.232:18120/` 返回 `502`，该隧道/代理链路尚未恢复；不能把先前的门户浏览器实测视作重建后的结果。

本次通过门户后台更新菜单后读取菜单配置复核；未经 DSH 认证访问代理根路径得到 HTTP `401`，使用该实例启动令牌后跳转到无令牌根路径，静态资源可加载。隔离浏览器先完成 DSH 的一次性认证，再登录门户并打开 `/iframe/1`，确认嵌入的是 EXP-007 工作台；首次在 DSH Web 注册 `/work/harness/workspace` 后，输入“请用一句话说明你的工作职责。”并收到真实模型回复。还从同一 iframe 打开了独立的「自动化任务」列表和管理入口。本次门户冒烟未创建定时任务；[EXP-007 Decision](../evolution/experiments/EXP-security-operations-expert-007/decision.md)另记录了隔离实例中的创建、查看、删除试验。以上证明当时浏览器链路可用，不等于按 Case 封存的 Evaluation Run、定时触发验证、门户 SSO 或生产验收。

## 历史认证试点与运行边界

当前没有加载 `dsh-auth-gate`，也没有把门户 SSO ticket 转换为 DSH 身份。门户登录与 DSH Web 认证是两道独立边界：仅登录门户的浏览器在 iframe 中仍会遇到 DSH `401`；受信操作者需在同一浏览器中使用该实例的启动令牌完成一次认证。令牌只通过 `dsh-dev url security-operations-expert-portal-pilot` 在受信终端获取，随后在受信浏览器打开 `https://172.16.138.232:18120/?token=<本次令牌>`，确认跳转到无令牌根路径；真实令牌不写入菜单 URL、文档或研究证据。DSH 启动日志本身含令牌，应限制日志访问，不导出原始日志。带令牌的 URL 不得分发给普通门户用户。曾提供的 [门户 SSO-ticket 集成说明](http://172.16.138.233/luolin/ai-port/-/blob/main/docs/architecture/sso-ticket.md)当前跳转登录页，未能独立核对协议细节；不能据此宣称 SSO 已接通。

此试点只有一个 DSH Host 和一个共享的 HOME 卷；Session、附件、自动化任务及执行历史都不按门户用户隔离。DSH 的浏览器 Cookie 是该 Host 的 owner 认证，不是门户用户身份或对象授权。因此此入口只适用于受控单操作者联调，**不得作为面向多用户开放的正式 AI 助手**。未来平台共享 Host 与按用户分 Host 的选择、Session 与 Schedule 统一归属及逐入口授权门槛，见[平台设计方案的多用户数据边界](DSH智能体运行管理平台设计方案.md#多用户数据边界与选型门槛)。不能仅靠 iframe、前端过滤或再加一个登录页面解决该问题。

门户现有和试点代理均使用同一张 `172.16.138.232` 的自签名 TLS 证书；本次自动化浏览器允许了该证书错误，因此尚未证明未信任证书的普通浏览器可直接使用。使用者需先经受信渠道校验证书并在其环境中建立信任；不能以关闭 TLS 校验作为正式接入方式。SSH 主机 ED25519 指纹发生过变化，本次连接按用户提供的 `SHA256:YCO74qtFhM/YGqVgXCYtpE8BtpEsZufhsjToyig+Jzw` 严格匹配；项目无法单凭 SSH 握手证明该值已由主机控制台等独立渠道核验。后续若再次变化仍须重新核验，不能沿用本记录自动接受新密钥。

代理容器配置为 `unless-stopped`，但 DSH 实例当前没有 Docker 自动重启策略，反向 SSH 隧道也未配置开机自启或自动重连，且本次 `known_hosts` 在临时目录中。主机重启或隧道断开后须人工恢复、重新核验主机密钥，再检查代理的未认证 `401`、令牌认证与门户 iframe；代理容器仍在运行不代表后端可达。当前没有隧道守护、健康自动恢复或生产监控承诺。

重新确认 SSH 主机密钥并使用受信任的 `known_hosts` 后，可在 `172.16.138.228` 上以前台命令重建本次隧道：`ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:13182:127.0.0.1:13181 root@172.16.138.232`。这只是人工恢复步骤，不是持久服务；重启 DSH 时应继续使用同一实例与 HOME，不要把 Token 复制到命令参数、菜单或代理配置中。

## 后续完善与回退

下一阶段如需给多个门户用户使用，应先取得并核对 SSO-ticket 协议，设计门户身份到 DSH Session、附件、任务及执行历史的服务端归属与授权，再做双用户交叉访问和重启验证。验证未完成前保留单操作者试点边界，不将门户 Token 或 DSH 启动令牌写入静态菜单配置。若只需撤回本次界面替换，在门户「系统管理 → 接入系统管理」把菜单 ID `95224` 的目标地址恢复为原 `/web-ai/ai/console` SSO 模板；先核对原配置的模板参数，不要填入固定 Token。随后可分别停用试点代理、隧道和 DSH 实例；旧服务本次没有被删除。
