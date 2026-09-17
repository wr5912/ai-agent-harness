---
name: threat-analysis-rule-tuning
description: "独立规则诊断与有条件的规则建议。对 TRUE、FALSE、UNDETERMINED 均输出 rule_diagnosis；只有直接证据确认规则缺陷或检测缺口时，才基于目标层字段域生成并校验建议。只出建议，不修改规则库。"
---

> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。

## When-to-use

在事件证据收集结束后始终使用。`TRUE`、`FALSE`、`UNDETERMINED` **三种事件结论**都必须输出独立的 `rule_diagnosis`；即使立靶失败，也要判断是规则信息不足、非规则数据链路故障，还是已有证据足以确认规则问题。

规则诊断与事件结论是两条轴：诊断状态**不能由 H1-H4 机械推出**，也不能由 `verdict` 机械推出。一个真实攻击可能同时暴露检测缺口，一个误报也可能是数据管道异常而不是规则逻辑错误，证据不足则不能假设规则有病灶。

---

## Workflow

### 步骤 1 — 始终生成独立诊断

`rule_diagnosis.status` 只能取以下之一：

| 状态 | 直接证据门槛 | `recommended_action` | 是否允许建议 |
|---|---|---|---|
| `NO_RULE_DEFECT` | 规则条件、字段语义和实际触发事实一致，且现有检查没有发现规则层问题 | `NONE` | 否 |
| `CONFIRMED_RULE_DEFECT` | 规则条件、阈值、窗口、分组、字段或元数据与本次事实存在可定位的直接矛盾 | `TUNE_EXISTING_RULE` 或 `DISABLE_OR_MERGE_RULE` | 是 |
| `CONFIRMED_DETECTION_GAP` | 已证实的安全行为当时可观测、原始记录确有痕迹，但没有应有的规则覆盖 | `ADD_DETECTION_RULE` | 是 |
| `NON_RULE_PIPELINE_DEFECT` | 采集、解析、字段映射、富化、关联或调用链故障导致错误数据或不可用数据，病灶不在规则 DSL | `NON_RULE_PIPELINE_FIX` | 否 |
| `INSUFFICIENT_EVIDENCE` | 无法取得规则体、字段语义、触发明细或足以定位病灶的直接证据 | `NONE` | 否 |

每次诊断严格包含：`status`、`summary`、`target_layer`、`evidence_refs`、`recommended_action`。`target_layer` 取 `alert_rule`、`event_rule`、`detection_pipeline` 或 `null`；不能为了产出建议把 `INSUFFICIENT_EVIDENCE` 升格为“确认”。

以下组合都可能合理，必须按证据判断：

- `TRUE + NO_RULE_DEFECT`：规则正确发现了恶意尝试；
- `TRUE + CONFIRMED_DETECTION_GAP`：事件为真，但规则漏掉关键后续或更高质量的关联；
- `FALSE + CONFIRMED_RULE_DEFECT`：规则条件确实把良性事实错误归为威胁；
- `FALSE + NO_RULE_DEFECT`：规则只承诺发现需审查的异常，本次未证实恶意且没有规则实现错误；
- `UNDETERMINED + NON_RULE_PIPELINE_DEFECT`：数据管道故障阻断研判；
- `UNDETERMINED + INSUFFICIENT_EVIDENCE`：证据不足且病灶位置不可定位。

`UNDETERMINED` 时默认 `INSUFFICIENT_EVIDENCE`；只有与事件真假是否收敛相独立的直接证据已经证明规则病灶或管道病灶，才能使用对应状态。规则体不可读、目标层不明或关键证据不足时，不能用“没发现问题”冒充 `NO_RULE_DEFECT`。

`CONFIRMED_DETECTION_GAP` 还要求行为在当时确实可观测、原始记录有痕迹且缺少应有规则覆盖；**日志缺失或采集断流不属于检测缺口**，应进入 `NON_RULE_PIPELINE_DEFECT` 或 `INSUFFICIENT_EVIDENCE`。

### 步骤 2 — 只有两个确认状态进入建议门

**只有 `CONFIRMED_RULE_DEFECT` 或 `CONFIRMED_DETECTION_GAP`** 才能生成 `rule_suggestions[]`。其余状态的数组必须为空，尤其：

- `NON_RULE_PIPELINE_DEFECT` 只描述采集、解析、字段映射或关联链的修复方向，不生成规则 DSL；
- `INSUFFICIENT_EVIDENCE` 只列补证方法；
- `NO_RULE_DEFECT` 明确记录未发现规则问题，不为凑内容而建议修改。

建议必须来自本次规则逻辑和事件事实之间的直接证据，不得把 H2/H3 场景名称直接翻译成白名单，也不得根据 H1/H4 标签机械选变更类型。

若要根据 H2/H3 生成 `narrow` 或 `add_exception`，证据必须同时证明活动**已授权、未越权**，并排除相关账号、人员或自动化平台**被滥用**；固定 IP、账号名或时间窗本身不满足门槛。

### 步骤 3 — 定位目标层和病灶

| `target_layer` | 输入 | 常见可定位病灶 |
|---|---|---|
| `alert_rule` | 日志/事件原始记录 | 字段语义、元数据、条件、阈值、单记录检测 |
| `event_rule` | 已生成的告警 | 分组字段、关联窗口、计数、序列或跨告警关系 |

两层都存在病灶时分别诊断、分别建议，不混用字段域。`target_layer` 不明时不能生成建议。
校验工具层映射固定为 `alert_rule -> upstream`、`event_rule -> downstream`，不得使用别名或根据规则体内容自动猜测。

### 步骤 4 — 复用目标层字段域

优先复用层 2 已预取或缓存的 `get_field_domain(layer)` 结果。只在未取且缓存未命中时补取一次。

规则体建议只能使用该层 `fields[]`、允许的 `ops`、`enums`、`groupFields[]`、`ruleTypes[]` 和 `outputTypes[]`。字段域缺失时记录 `data_gaps`，不得凭印象写 DSL。

### 步骤 5 — 选择有证据支撑的变更类型

| `change_type` | 适用条件 |
|---|---|
| `narrow` | 已证实条件覆盖过宽，并存在直接可判定的区分字段 |
| `add` | 已证实存在未覆盖行为，且能描述目标层可执行条件 |
| `adjust_threshold` | 已证实当前阈值或窗口导致错误，且新值有本次或权威基线证据 |
| `add_exception` | 主逻辑正确，已证实某个具体良性场景可被稳定、精确识别 |
| `correct_metadata` | 检测逻辑有效，但 severity、ATT&CK、类型或其他规则元数据与事实不符 |
| `disable_or_merge` | 规则完全重复、互相冲突或其检测主张应停止/合并，且有直接规则对比证据 |

纯停用建议不需要伪造一个空条件树：`change_type=disable_or_merge` 且动作为纯 disable 时，允许 `rule_body=null`、`format_check=null`，并在 `risk_note` 说明跳过校验的原因及停用风险。若合并产生新规则体，则仍需字段域核对和格式校验。

### 步骤 6 — 挂证据并校验格式

每条建议都必须包含非空 `evidence_refs`，病灶中的每项事实可追溯到规则 ID、告警、日志、资产、漏洞或字段域返回。

先按 `target_layer` 固定映射分组，再对每个非空校验层分别批量调用：

```text
validate_rule_format(layer, rules[])
```

同层规则体一次批量；若上下游都有建议则分别调用，禁止混层或漏层。一轮建议的初始分层校验按非空层分别调用；若 `upstream` 和 `downstream` 均有建议，初始校验合计最多两次。后续失败修正重校不计入这两次初始调用，但必须仍归原层。调用时按固定映射传层，`layer` 必须等于实际同层 `validate_rule_format` 请求的层。只有 `ok=true`、`errors=[]` 且返回层一致的规则体建议才能进入报告。校验返回 `ERROR`、`ok=false` 或层级不一致时，不得输出该非空 `rule_body`，并将失败原因记录到 `data_gaps`；允许根据错误修正，且错误修正重校仍在原层，只有重新通过后才能输出。`correct_metadata` 若只改元数据且接口不校验该结构，应清楚标注校验范围，不能伪造 `ok=true`。

### 步骤 7 — 标注未回放验证与风险

所有建议 `verified=false`，并明确“基于本次事件证据推断，未经回放验证”。`expected_effect` 和 `risk_note` 只能做定性陈述，不编造历史命中数量或影响比例。

---

## Output

统一报告中的结构示例：

```jsonc
{
  "rule_diagnosis": {
    "status": "CONFIRMED_RULE_DEFECT",
    "summary": "字段语义与实际事件证据存在直接矛盾",
    "target_layer": "alert_rule",
    "evidence_refs": ["rule:rule-123", "log:log-456"],
    "recommended_action": "TUNE_EXISTING_RULE"
  },
  "rule_suggestions": [
    {
      "target_layer": "alert_rule",
      "change_type": "narrow | add | adjust_threshold | add_exception | correct_metadata | disable_or_merge",
      "target_rule_id": "rule-123 | null",
      "rule_body": {},
      "diagnosis": "可定位病灶及证据关系",
      "evidence_refs": ["rule:rule-123", "log:log-456"],
      "expected_effect": "定性预估",
      "risk_note": "可能遗漏的真实场景或运维代价",
      "verified": false,
      "format_check": {"ok": true, "layer": "upstream", "errors": []}
    }
  ]
}
```

无建议时保留 `rule_diagnosis`，`rule_suggestions=[]`。纯 disable 建议按步骤 5 将两个字段置空。

---

## Verification

本次执行只有在以下条件全部满足时有效：

| # | 检查项 | 验证方式 |
|---|---|---|
| 1 | 诊断始终存在 | 三态事件结论和立靶失败都含 `rule_diagnosis` |
| 2 | 状态由直接证据决定 | 未从 verdict 或 H1-H4 标签机械映射状态 |
| 3 | 动作枚举与状态一致 | `recommended_action` 与诊断状态、目标层和实际病灶一致 |
| 4 | 建议门槛正确 | 只有两个确认状态的 `rule_suggestions` 可非空 |
| 5 | 管道故障未生成 DSL | `NON_RULE_PIPELINE_DEFECT` 仅给非规则修复方向 |
| 6 | 目标层和字段域一致 | 每个非空规则体只使用目标层合法字段与值，并按 `alert_rule -> upstream`、`event_rule -> downstream` 校验 |
| 7 | 格式校验真实 | 按目标层分组，每个非空层同层一次批量校验；返回 `layer` 与实际请求一致；`ERROR`、`ok=false` 或层不一致的规则体未输出并记录数据缺口；纯 disable 两字段为 `null` |
| 8 | 建议证据可追溯 | 每条建议有非空 `evidence_refs`，且足以支持病灶和变更类型 |
| 9 | 未验证边界清楚 | `verified=false`，影响与风险为定性描述 |

---

## ATT&CK 覆盖

本 skill 不以 ATT&CK 标签决定规则诊断。`correct_metadata` 可以修正有直接事实依据的错误 ATT&CK 映射，但标签本身不能证明事件为攻击。
