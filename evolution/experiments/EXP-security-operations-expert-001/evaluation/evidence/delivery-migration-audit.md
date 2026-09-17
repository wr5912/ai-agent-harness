# 交付迁移审计

## 已观察事实

- 旧 Harness：86 个文件、43 个目录，归档摘要 `1cde69e0ec0355619186f8390ba658cc0b6a45705a033a962c4398154189af76`，接收状态 `review_required`。
- 初版交付：50 个文件、12 个目录，目录树摘要 `e49e72a8b7f6a97e7dd13e39af01138e9670311339e00573ab0a017df15963d2`，接收状态 `review_required`。
- 四域合计 200 个 Case，Case ID 唯一；全部为 blocking。正式 `acceptance_id` 和 Trial 均缺失。
- 来源中的脚本、Hook、MCP 与部署文件均未执行。逐文件处置见 `source-inventory.json`。

## 迁移判断

历史内容可作为需求、行为和安全控制的迁移输入，但不能证明 DSH 行为等价。当前材料存在实质失败，故唯一交付结论为“退回整改”，最低独立复核等级为 R3。

## 后续硬门禁

业务负责人逐条复核输入并确认 AC 后，才能物化正式 `cases.jsonl`。真实 Trial 必须使用冻结的 DSH 容器组合和 17 列结果契约；完整 R3 通过前不得创建稳定 Baseline、Release 或 `current/`。
