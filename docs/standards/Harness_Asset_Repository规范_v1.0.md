# Harness Asset Repository 规范 v1.0

## 1. 规范定位

Harness Asset Repository 是智能体工程资产管理规范。

目标：

-   管理 Agent/Harness 生命周期；
-   支撑持续优化；
-   支撑 Runtime 解耦；
-   支撑评估驱动演进。

它不是：

-   Runtime 源码仓库；
-   单个 Agent Demo；
-   配置文件集合。

------------------------------------------------------------------------

# 2. 核心理念

## 2.1 任务与验收优先

智能体开发起点：

    任务定义
        ↓
    验收标准
        ↓
    Harness设计
        ↓
    Runtime实现

而不是：

    选择框架
        ↓
    开发Agent

------------------------------------------------------------------------

# 3. 资产模型

Harness Asset 包含：

  类型              说明
  ----------------- ---------------
  Task              业务任务定义
  Acceptance        验收标准
  Harness           Agent能力组合
  Eval Dataset      评估数据
  Experiment        优化过程
  Release           可部署版本
  Runtime Adapter   执行适配

------------------------------------------------------------------------

# 4. Harness 生命周期规范

完整生命周期：

    Baseline
        ↓
    Experiment
        ↓
    Candidate Harness
        ↓
    Evaluation
        ↓
    Release

------------------------------------------------------------------------

# 5. Baseline规范

Baseline 是已经验证通过的 Harness 快照。

必须记录：

-   Harness版本；
-   Runtime版本；
-   依赖版本；
-   Eval结果。

示例：

``` yaml
agent:
  version: 1.0

runtime:
  dsh: 0.1.x

evaluation:
  regression: pass
  safety: pass
```

------------------------------------------------------------------------

# 6. Experiment规范

所有 Harness 修改必须进入 Experiment。

目录：

    EXP-xxx/

    ├── hypothesis.md
    ├── change.yaml
    ├── candidate/
    ├── evaluation/
    └── decision.md

必须回答：

1.  为什么修改？
2.  修改什么？
3.  如何验证？
4.  是否合入？

------------------------------------------------------------------------

# 7. Candidate Harness规范

禁止：

    直接修改生产Harness

推荐：

    Baseline

    ↓

    Candidate

    ↓

    Evaluation

    ↓

    Release

Candidate 是实验产物。

------------------------------------------------------------------------

# 8. Evaluation规范

Evaluation 必须包含：

## Smoke

验证可运行。

## Regression

验证历史能力。

## Capability

验证新增能力。

## Safety

验证边界。

------------------------------------------------------------------------

# 9. Release规范

Release 表示正式版本。

包含：

-   Harness版本；
-   Runtime兼容范围；
-   Eval报告；
-   变更记录。

示例：

    ai-soc-agent-v1.2

------------------------------------------------------------------------

# 10. Runtime兼容规范

Harness 不绑定单一 Runtime。

维护：

    runtime/compatibility.yaml

记录：

-   支持版本；
-   已验证版本；
-   已知限制。

------------------------------------------------------------------------

# 11. Harness优化闭环规范

标准流程：

    生产反馈

    ↓

    失败案例

    ↓

    Eval Dataset

    ↓

    Experiment

    ↓

    Candidate

    ↓

    Benchmark

    ↓

    Regression

    ↓

    Release

------------------------------------------------------------------------

# 12. DSH适配原则

基于 DSH 时：

-   Preset 属于 Harness Component；
-   Plugin 属于扩展能力；
-   Dynamic Modification 属于 Experiment阶段；
-   固化后的能力进入版本管理。

不要：

    生产环境直接自修改

而应：

    发现问题
     ↓
    生成候选修改
     ↓
    隔离验证
     ↓
    通过门禁
     ↓
    发布新版本

------------------------------------------------------------------------

# 13. 设计原则总结

1.  软件代码不是唯一资产。
2.  Harness不是一次设计完成。
3.  Eval决定优化方向。
4.  Experiment沉淀工程经验。
5.  Runtime只是执行载体。
6.  任务与验收数据是长期核心资产。
