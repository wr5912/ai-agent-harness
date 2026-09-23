# DSH 开发会话小闭环复现说明

本说明只用于复现 `dsh-dev-real-session-20260919.json` 的技术核验，不是正式 Eval 或 Release 验收。凭据、Token 与 MCP URL 只经当前终端环境注入，不写入命令记录、实例状态或证据文件。Headless/ACP host plane 不组成 Agent preset，本说明能核对开发指令、目标声明、技能改动与 MCP 链路，不能替代 Web 的 preset 复制、选择和回流验收。

## 前置条件

- 本地镜像与 `source.lock.json` 一致。
- 模拟 OpenAPI 服务与发布该 OpenAPI 的 Streamable HTTP MCP 服务已启动。
- 当前终端注入以下变量：
  - `DEEPSEEK_API_KEY`
  - `SEC_OPS_MCP_URL` / `SEC_OPS_MCP_TOKEN`
  - `INSPECTION_MCP_URL` / `INSPECTION_MCP_TOKEN`
  - `THREAT_ANALYSIS_MCP_URL` / `THREAT_ANALYSIS_MCP_TOKEN`
- 使用模型：`deepseek-flash`（provider `deepseek-official`）。

## 1. 创建开发实例

```bash
export XDG_STATE_HOME=/tmp/dsh-real-session
python3 runtime/adapters/dsh-container/dsh-dev up \
  --source experiment:EXP-security-operations-expert-001 \
  --mode dev --name real-dev --port <unused-port> \
  --accept-cordis-trust
```

核对 `up` 输出：

```text
agent_id       = security-operations-expert
session_preset = cordis
target_preset  = security-operations-expert
dsh_running    = true
```

## 2. 用 Headless profile 驱动真实会话

复用启动器生成的实例 Compose；不要覆盖服务 entrypoint，因为它包含 DSH 模块解析需要的 `node --expose-internals`。

```bash
STATE="$XDG_STATE_HOME/dsh-dev/real-dev"
# 把 instance.json 中记录的 DSH_IMAGE_TAG、DSH_ADAPTER_HOST、DSH_MANAGED_PATCH、
# 三棵资产根、开发叠加层、spec/eval 与 dev_target_file 注入当前 compose 子进程。

docker compose -f "$STATE/compose.yaml" run --rm --no-deps -w /work dsh \
  --profile headless \
  --patch /opt/dsh-managed/security-operations-expert.patch.yml \
  --patch /opt/dsh-managed/security-operations-expert.development.patch.yml \
  '<prompt>'
```

身份提示：

```text
用三句话说明：你的角色身份；session_preset；target_preset 与目标 Agent。
```

预期：开发者身份、`session_preset=cordis`、目标 preset 与 Agent 均为 `security-operations-expert`。

## 3. 修改—保存—观察

1. 开发会话在 `/work/harness/workspace/.agents/skills/` 新建一个临时、不同名的技能。
2. 宿主检查该文件已出现在 Candidate 工作树，且 `git status` 可见。
3. 以 cwd `/work/harness/workspace`、仅加载基础 patch 创建新的被测会话，询问技能是否存在及其 description。
4. 删除临时技能，再创建新的被测会话；预期回答“不存在”。
5. 确认探针目录已删除，Candidate 工作树没有残留探针改动。

正反向观察一致只能降低模型按提问重复回答的疑虑；它不证明业务能力或安全控制通过。

## 4. MCP 链路

被测会话可请求列出模拟资产，观察 `DSH → MCP client → OpenAPI MCP server → mock service` 的工具调用。若 OpenAPI 响应没有总数字段，会话应说明“本次返回条数”不等于全量总数。

模拟 MCP 未启用真实鉴权、审批与租户控制；这条链路只证明工具连通和结果处理，不证明生产控制已落实。

## 5. 清理

```bash
python3 runtime/adapters/dsh-container/dsh-dev down real-dev
# 按需要移除本次临时 HOME/fallback 卷与 /tmp 状态目录。
```
