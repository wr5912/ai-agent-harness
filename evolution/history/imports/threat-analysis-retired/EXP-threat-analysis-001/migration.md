# 迁移来源

完整研判提示词已迁入本仓库，保存为 [prompts/threat-analysis-system.txt](candidate/dsh/managed/threat-analysis/prompts/threat-analysis-system.txt)；运行代码直接读取该文件。首次迁移保留原内容，后续同步记录见[迁移评估](evaluation.md#提示词同步与证据引用复核)。部署资产与环境要求统一见[运行方式](hypothesis.md#运行方式)。

来源为用户指定源项目 `.local/threat-analysis-five-domain-replay/` 的本机工作树，以最终验证报告为背景；不是整个源项目快照。入口递归依赖闭包为 15 个 Python 模块及固定研判提示词。整目录清点触及 1 GiB 上限，改为只读选取闭包后重新清点，通过结构检查；不复制历史运行包。

源代码仅将流程入口的 `parse_args` 改为接受可选 argv，以复用原参数默认值。新增 DSH 适配层负责进程、冻结产物和错误状态，研判算法不变。目录配置仅保留运行所需工具名称、资源标识、HTTP 方法与参数模式；不复制 Endpoint、凭据或配置元数据。

参考现有 `security-operations-expert` 的容器评测和 `test01` 的最小 Preset 结构，新建独立 Agent。公共适配仅补充 Python 与时区、确保 CLI 包装器可执行、按来源加载工具目录、向检查脚本传入真实轨迹，并使评测驱动以宿主 UID/GID 写证据。首次实跑发现外层模型添加解释，Preset 改用 DSH 已有的 complete persona 能力；内置研判提示词不变。

| 迁入文件（本项目路径） | 迁移前内容 SHA-256 |
|---|---|
| `deepseek_blind_eval.py` | `b079f61c713c3000d4ce412b4be605b11995098bc0f5702fa192802ee93a4ce2` |
| `domain_projection.py` | `ad909953d4f1e227b704acfdfb1cc1a5b13c83084336ebbe1f070ee207fa4df1` |
| `domain_projection_v6.py` | `d0796b0b4472b0f022dd07e0b1cdeab6d84f7b9b87f26a5040f1e79e02e8095f` |
| `evidence_graph.py` | `608fcff32065d6ecf3faa8688bb23605ebecfeaafc4448caa87503618becdd89` |
| `fast_classification.py` | `02fb220e67468d312723b7608d9ac41ff812cd9e2a3fca43fb1e2b72580aed8f` |
| `forced_output_contract.py` | `219fe9224126fcbaf2c0e5477b032bb0949bb914ba8e5229e3082a87360e11e6` |
| `fusion_contract.py` | `9c4211a06658fbdfb9999713f6d24df16367e7ee4bce29ac5e67f6191c3606c1` |
| `fusion_contract_v6.py` | `adeb783f39b0fbae93b6586e93076493b9a9aaadf4c2e615511330fea290912f` |
| `fusion_pipeline.py` | `1d50c0f212df15cb043a086058466baa2f9bb023ae3e346a3893ff865e4cc3ff` |
| `incident_scope.py` | `d60ac1f070b56c626173dba9e6defe8dd9eaf23ac9607750b24d22a2dca971ad` |
| `judgement_target.py` | `8e49319bb6c93e8c927e50718aab89c5b1aee4cf54a795fbb98ad0fa05c14584` |
| `mcp_gateway.py` | `e4eaf4dbe70a4c9ca972bca32fe439c2af6af3afc24356c80e69b0150e76759e` |
| `model_input_compaction_v6.py` | `041c83d9b42e3773444a52081e54a14ee5baab702c0edfdf2605a72cc5c81cfe` |
| `prompts/threat-analysis-system.txt` | `05861baab7e0618a909278f081c3888619ab5f9bd15389e8784ff5812a9671d3` |
| `universal_replay.py` | `5760592ccf4e2fb844c861b71d31a0665e7a693934d776ed1ec1a7ca68d60ae1` |
| `universal_replay_v6.py` | `fd4b5e543223fcfaf6901190c531c6a1ba3dc66430ace0e446feafa196dc6053` |

回归测试迁入依赖闭包对应的 15 个测试模块及两个合成实体冲突夹具；仅调整模块定位，移除只检查未迁入历史提示词版本的七个测试，保留内置研判提示词与通用契约测试。新增适配测试验证模型输入隔离和失败结果边界。
