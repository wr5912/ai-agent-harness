# 任务型交付的界面与合同证据

本目录保存真实浏览器结果、精选原图及确定性回归摘要。业务 Candidate、原始 Run、目标实例探针与报告在独立数据仓库对应 Experiment 中保存，不在本目录维护第二份。

- [首页](home/README.md)：最新文字、单行自适应输入、三种任务、可选运行关联和实际示例交付。9 个模式/窗口组合通过；[首次失败](home-live-v3-first-probe.json)及同名截图保留。
- [原生回执](receipt-live-readonly.json)：真实旧 Session 的只读回执与三宽度检查。[历史回执消费者回归](native-summary-observed-replay.json)使用原生真实调用及结果，53 组均有具体摘要，不表示新模型运行。
- [确认布局](confirmation-summary-geometry.json)：使用真实提案与实际组件进行的隔离几何检查，不冒充一次真实确认。
- [新建后的实际下载](new-agent-ui-downloads.json)：原生 UI 下载与目标实例报告逐字节核对。[移动端任务卡](new-agent-builder-retry-task-390-v3.json)对应真实第二次构建任务。
- [实例启动](agent-start-live.json)：实际智能体详情只发出一次实例运行请求，无预览请求，得到运行容器与对话入口。
- [过期任务](expired-task-live.json)：实际点击恢复后持久记录额度耗尽，任务身份、调用数、修复轮次、截止时间及既有操作不变。
- [特性整理确认与拒绝](features-reject-live.json)：实际页面按钮触发 AI 提案，1440/390px 展示原生确认，用户操作“暂不执行”后目标资产摘要不变。[最终观察](features-reject-final.json)计入拒绝后的说明回复，共 9 次管理模型调用。初始确认摘要只显示版本而缺智能体名称的事实保留在原图中。
- [确认对象回归](features-confirmation-target-after.json)：同一次真实提案经实际组件隔离渲染，验证明确显示智能体对象和版本；没有追加 AI 请求或写入资产。
- [实际回退回读](task-rollback-live-independent.json)：实际任务卡只执行一次回退，恢复编辑和装配、删除新增文件，保留已耗预算；修改路径与未修改路径分别核对权限，完整内容和目录与固定父版一致。原始 Task、Run 和回退材料随数据仓 005 保存。

首页体验通过一次 UI 整体确认；新建智能体使用真实平台任务请求、RPC 确认及真实浏览器下载。两者都运行真实模型和基础 Mock 服务，均不表示真实设备健康验收。完整结论与限制见[任务交付与验收](../../../../../docs/platform-design/17_任务型智能体交付与验收.md)。
