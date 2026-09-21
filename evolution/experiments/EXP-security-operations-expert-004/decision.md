# 研究决定：adopt

采用专用巡检子 Agent 路线。封存 Run 的 5 项试验全部完成：主 Agent 精确暴露 12 个编排工具且不直连 inspection MCP；巡检、故障分析和响应规划子 Agent 分别暴露 4、15、0 个工具。

在同一个全新 Web Session 中，Playwright 发送“执行一次常规巡检”后获得巡检报告；关联子 Session 按 `start_with_plan → collect_evidence → finalize` 顺序完成一次 `group_code=routine`、`scope=all` 的即时巡检，后两步复用首步返回的同一 `run_id`，状态依次为 `collecting`、`ready_to_finalize`、`completed`。静态合同、实时 MCP `tools/list` 和 Guard 回归同时通过。

结论限于本 Run 锁定的 DSH Harness、模型和 MCP 环境，不构成 Research Release 或生产部署验收。
