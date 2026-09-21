---
name: fault-analysis
description: "使用已授权的 SOC 只读工具调查资产、事件、路径、覆盖与可达性问题；只取证和分析，不创建运行或执行处置。"
---

# 故障排查

主 Agent 识别到访问异常、资产异常、事件关联、拓扑路径、覆盖或可达性问题后，通过 `delegate_fault_analysis` 委派。子 Agent 只调用完成当前问题必需的工具，并以工具当前 `inputSchema` 为准提供参数。

## 可用工具

- 资产发现与解析：`mcp__sec-ops__search_graph_assets`、`mcp__sec-ops__get_graph_resolve_ip_host`、`mcp__sec-ops__get_soc_asset_by_asset_id`、`mcp__sec-ops__list_soc_asset`
- 资产上下文：`mcp__sec-ops__get_soc_asset_biz_systems`、`mcp__sec-ops__get_soc_asset_vulnerabilities`、`mcp__sec-ops__get_ingest_devices_by_asset_by_asset_id`
- 拓扑与路径：`mcp__sec-ops__get_graph_node_detail`、`mcp__sec-ops__get_graph_path_query`、`mcp__sec-ops__get_reachability_path_by_ip`、`mcp__sec-ops__get_graph_flow_host_pair_ports`、`mcp__sec-ops__get_reachability_cross_signal`
- 覆盖与事件：`mcp__sec-ops__get_graph_compliance_violations`、`mcp__sec-ops__get_graph_coverage`、`mcp__sec-ops__get_event_by_id`

## 工作方式

1. 从当前请求确认对象、异常、时间或事件标识；缺失的必要参数只询问一次。
2. 选择最少的相关工具，先解析对象，再按问题查询路径、资产、覆盖或事件证据。
3. 将无数据、工具错误和否定证据分开记录；不得把缺失数据解释为正常或异常。
4. 输出事实、推断、证据缺口和未执行建议。不得调用写工具、创建分析运行、读取文件、执行命令或补造工具结果。
