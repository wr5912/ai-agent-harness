# test01 评估定义

## 测试数据

### 测试预置

#### HARNESS-F01 新会话装载

**公共基线**

使用 `EXP-test01-001` 的 Candidate、新建 DSH 实例和空白 Web Session；显式选择 `test01` Preset，不复用历史消息或缓存。

```mermaid
flowchart TD
    START[装载 Candidate] --> PRESET[选择 test01 Preset]
    PRESET --> SESSION[新建空白 Session]
    SESSION --> ASK[发送身份问题]
    ASK --> CHECK{回复是否保持 test01 身份?}
    CHECK -- 是 --> PASS[满足身份预置]
    CHECK -- 否或运行错误 --> FAIL[记录失败或未知]
```

**金标准**

按 `AC-001` 判定用户可见回复；仅有容器启动、HTTP 可达或 Preset 可选不能判为通过。

**适用边界**

本预置只验证全新 Session 中的 `test01` 身份回复，不外推到工具能力、复杂任务质量或生产可用性。

### 测试用例

##### T-HARNESS-IDENTITY

选择理由：用最小身份问题观察新 Preset 是否在真实 DSH Session 中生效。

**用户输入**

```text
你是谁？请用一句中文回答。
```

**执行器：**`web-chat`

**工具边界：**`none`

**副作用预算：**`web-session-only`

##### T-AUTHORING-PLUGIN-PERSISTENCE

**用户输入**

```text
在独立 dev 实例中安装锁定的 dsh-codex-connect@0.1.0-alpha.4.39，检查 Profile 组合，随后由宿主重启同名实例并再次检查。
```

**执行器：**`runtime-tool-contract`

**工具边界：**`dsh plugin、dsh --dump-config、宿主 dsh-dev up --replace；不执行 OAuth 或模型请求`

**副作用预算：**`仅限独立实例 HOME 与容器生命周期`

选择理由：直接验证创造模式能否使用 DSH 原生插件命令写入实例 HOME，并在重启后保持唯一的 `llm-openai-codex` provider。

## 评估方法

### m-fresh-web-session

启动所选 Experiment 的 dev 实例，在 DSH Web 中注册 `/work/harness/workspace`，新建 Session，显式选择 `test01` Preset 后发送测试输入并记录可见回复。

### m-pinned-plugin-restart

启动独立 dev 实例，执行 `dsh plugin --profile web add dsh-codex-connect@0.1.0-alpha.4.39`；核对 manifest、lockfile、`dsh web --help`、`dsh --profile web --dump-config` 与 `dsh plugin doctor`。再由宿主保留 HOME 重启同名实例，重复配置与插件检查。不得写入 OAuth 凭据，也不发起 Codex 模型请求。

## 测试验收

### AC-001

回复包含 `test01`，使用一句简洁中文；不冒充 Cordis 或其他业务角色，且没有模型或工具错误。

### AC-002

Profile manifest 与 lockfile 记录锁定版本和完整性摘要；重启前后组合配置中各有且仅有一个 `llm-openai-codex` provider；`test01` 的受控 Preset 根和默认目标保持不变。结论只覆盖插件安装、装载与持久化，不要求 ChatGPT OAuth 或真实 Codex 回复。

## Experiment 评估选择

### EXP-test01-001

- 测试用例：`T-HARNESS-IDENTITY`
- 评估方法：`m-fresh-web-session`
- 测试验收：`AC-001`

### EXP-test01-002

- 测试用例：`T-AUTHORING-PLUGIN-PERSISTENCE`
- 评估方法：`m-pinned-plugin-restart`
- 测试验收：`AC-002`
