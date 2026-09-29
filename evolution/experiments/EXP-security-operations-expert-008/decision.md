# Decision

Decision: continue

008 Candidate 已将巡检 Harness 改为三个新工具、主 Agent 直接调用及异步 `runId` 查询。DSH MCP 客户端对该巡检服务使用 `legacy` 协商后，真实 Session 已完成常规巡检、目录查询、指定资产巡检和同一 `runId` 续查；运行中没有下载地址，报告就绪后才交付服务返回的地址，`PARTIAL` 的证据缺口没有被当作正常。

008 来源现要求完整的应急运行配置；重建后的 3102 实例和新 Session 均可使用六个应急工具。新 fast Run [`run-cceff482-5137-4f7b-9d36-d57d35ccecd1`](runs/run-cceff482-5137-4f7b-9d36-d57d35ccecd1/report.md) 中，应急草案 Case 通过，未提交执行；总体为 4 通过、2 失败、1 无法判定。巡检运行中回答、策略预览和故障分析评审仍有缺口。

修改后的 fast Run [`run-a739c37c-d72b-425f-9a65-ff064616c580`](runs/run-a739c37c-d72b-425f-9a65-ff064616c580/report.md) 为 5 通过、1 失败，巡检 Case 通过，策略配置 Case 仍因缺少对应 MCP 工具域而失败。补测 Run [`run-bcdc9957-c531-4554-a4e7-79bd3f8c6404`](runs/run-bcdc9957-c531-4554-a4e7-79bd3f8c6404/report.md) 的 4 个相关 Case 机器判定全部通过；其中故障分析只交付了报告正文和巡检报告链接，未生成独立的故障报告文件。两次 Run 都只有同一路由机器自评，没有人工复核。

当前 Runtime 改动只存在于独立工作树及本地编译插件覆盖层，锁定镜像本身仍为旧版；新建实例若只按仓库锁装载仍会遇到协议探测失败。先把该 Runtime 改动纳入受控版本并重建镜像，再复验无覆盖层的装载和业务行为。此轮 Decision 保持 `continue`，不生成 Research Release，也不把局部巡检通过或 Web HTTP 200 写成整个 Agent 业务通过。
