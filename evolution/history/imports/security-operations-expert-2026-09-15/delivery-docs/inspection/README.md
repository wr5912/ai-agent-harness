# 巡检专项交付命令

> 作者：王辉
> 日期：2026-09-03
> 状态：现行工具说明
> 适用范围：巡检相关模块的 Git 差异判定、专项测试、制品打包、232 部署和闭环验收。

入口命令：

```bash
./ai/inspection-service/delivery/inspection_delivery.sh --help
```

常用流程：

```bash
./ai/inspection-service/delivery/inspection_delivery.sh sync-main
./ai/inspection-service/delivery/inspection_delivery.sh plan
./ai/inspection-service/delivery/inspection_delivery.sh all --ack-external
```

非敏感目标配置见 [`.env.example`](.env.example)，复制为被 Git 忽略的 `.env.local` 后使用。命令不会
自动注册或刷新 MCP 管理平台中的故障巡检工具组，也不会部署故障排查服务或 MCP 管理平台源码。

完整模块映射、门禁、备份和回滚说明见
[故障巡检部署测试验收流程规范](../docs/04-交付与运维/巡检部署测试验收规范.md)，历次真实结果见
[故障巡检测试用例与验收](../docs/02-测试用例与验收/README.md)。
