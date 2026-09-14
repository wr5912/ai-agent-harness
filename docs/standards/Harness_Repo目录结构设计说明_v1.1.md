# Harness Repo 目录结构设计说明（v1.1）

## 1. 文档定位

本仓库用于管理基于 Agent Runtime（例如
DSH）创建、修改、评估和持续优化形成的 **Agent / Harness 工程资产**。

本仓库：

-   不包含 DSH Runtime 源码；
-   不复制 Runtime 内部目录结构；
-   不绑定单一 Runtime 版本。

核心目标：

1.  Harness 资产与 Runtime 解耦；
2.  同一 Harness 可适配多个 Runtime 版本；
3.  支撑 Baseline → Experiment → Candidate → Evaluation → Release
    的持续优化闭环；
4.  支撑评估驱动的 Harness Engineering。

------------------------------------------------------------------------

# 2. 第一性原理设计

Agent 工程不是：

    配置文件
        ↓
    部署

而是：

    业务任务
        ↓
    验收标准
        ↓
    Harness设计
        ↓
    运行反馈
        ↓
    失败案例
        ↓
    优化实验
        ↓
    新版本Harness

因此 Harness Repo 必须同时管理：

-   当前状态；
-   历史状态；
-   演进过程；
-   评估证据。

否则只是一个 Agent 配置仓库，而不是 Harness 工程仓库。

------------------------------------------------------------------------

# 3. 推荐目录结构

``` text
harness-repo/

├── README.md
├── VERSION.md
├── CHANGELOG.md
│
├── agents/
│   └── <agent-name>/
│       ├── manifest.yaml
│       ├── current/
│       │   └── harness.yaml
│       │
│       └── components/
│           ├── preset/
│           │   └── agent.cordis.yml
│           ├── skills/
│           ├── tools/
│           ├── policies/
│           ├── workflows/
│           └── memory/
│
├── tasks/
│   └── <task-domain>/
│       ├── task-definition.yaml
│       └── acceptance.yaml
│
├── eval/
│   ├── datasets/
│   │   ├── smoke/
│   │   ├── regression/
│   │   ├── capability/
│   │   └── safety/
│   ├── graders/
│   └── reports/
│
├── evolution/
│   ├── baselines/
│   │   └── <agent-version>/
│   │       ├── harness.yaml
│   │       ├── runtime.yaml
│   │       └── evaluation.json
│   │
│   ├── experiments/
│   │   └── EXP-001/
│   │       ├── hypothesis.md
│   │       ├── change.yaml
│   │       ├── candidate/
│   │       ├── evaluation/
│   │       └── decision.md
│   │
│   └── history/
│
├── plugins/
│   └── <custom-plugin>/
│
├── mcp/
│   ├── servers.yaml
│   └── schemas/
│
├── runtime/
│   ├── compatibility.yaml
│   └── adapters/
│
└── releases/
    └── <agent-version>/
        ├── manifest.yaml
        └── evaluation-report.md
```

------------------------------------------------------------------------

# 4. 目录设计说明

## agents/

存放当前 Agent/Harness 定义。

不是：

    dsh-agent

而是：

    agent

原因：

Agent 是业务能力资产，不应该绑定 Runtime。

关系：

    Harness
     |
     +-- DSH Preset
     |
     +-- AgentScope Config
     |
     +-- Other Runtime Adapter

------------------------------------------------------------------------

## tasks/

这是新增核心目录。

原因：

Harness 不是凭空产生的。

必须从：

    任务目标
    +
    验收标准

开始设计。

示例：

    安全告警分析任务

    输入：
    告警日志

    目标：
    输出攻击判断

    验收：
    准确率、安全性、解释完整性

------------------------------------------------------------------------

## agents/components/

存放 Harness 实现组件：

-   DSH Preset；
-   Skill；
-   Tool；
-   Policy；
-   Workflow；
-   Memory。

其中：

    agent.cordis.yml

只是 DSH Runtime 的一种表达，不等于完整 Harness。

------------------------------------------------------------------------

## eval/

Eval 不是测试附属品。

它是 Harness 的核心资产。

包括：

### smoke

验证基本可运行。

### regression

防止已有能力退化。

### capability

验证新增能力。

### safety

验证安全边界。

------------------------------------------------------------------------

## evolution/

这是 Harness Engineering 的核心目录。

负责管理：

    Baseline
        ↓
    Experiment
        ↓
    Candidate
        ↓
    Evaluation
        ↓
    Decision

------------------------------------------------------------------------

## Baseline

表示已经验证过的 Harness 状态。

包含：

-   Harness Snapshot；
-   Runtime版本；
-   Eval结果。

------------------------------------------------------------------------

## Experiment

表示一次优化假设。

例如：

    问题：
    长任务上下文丢失

    假设：
    增加Memory能力提升连续任务效果

------------------------------------------------------------------------

## Candidate

表示候选 Harness。

禁止直接修改生产版本。

------------------------------------------------------------------------

## Evaluation

决定是否接受 Candidate。

必须记录：

-   baseline结果；
-   candidate结果；
-   regression；
-   safety；
-   cost。

------------------------------------------------------------------------

## releases/

表示可部署版本。

不是 Git Tag。

它是：

    经过验证的Harness Artifact

------------------------------------------------------------------------

# 5. 与 DSH Runtime 的关系

    Harness Repo

          |
          v

    Runtime Adapter

          |
          v

    DSH Runtime

          |
          v

    Deployment

DSH 是执行环境。

Harness Repo 是工程资产。

------------------------------------------------------------------------

# 6. 核心原则

1.  不围绕 Runtime 组织资产。
2.  Preset 是实现，不是资产本身。
3.  Eval 数据属于核心资产。
4.  每一次优化必须形成 Experiment。
5.  Candidate 必须经过 Evaluation 才能 Release。
6.  Runtime 可替换，Harness 可迁移。
