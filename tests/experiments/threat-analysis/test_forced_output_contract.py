from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from forced_output_contract import validate_forced_output  # noqa: E402


class ForcedOutputContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.five_source = {
            "unified_event_id": "INC-1",
            "event_snapshot": {
                "event_type": "HOST_COMPROMISE",
                "time_range": ["2026-09-10T08:00:00Z", "2026-09-10T08:01:00Z"],
                "entities": [
                    {
                        "entity_ref": "E1",
                        "entity_display": "server-a（10.0.0.2，资产ID 1001）",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "1001",
                        "ip": "10.0.0.2",
                    }
                ],
                "judgement_target": {
                    "claim_family": "entity_state",
                    "claim_type": "host_compromise",
                    "primary_entity": {"asset_id": "1001", "ip": "10.0.0.2"},
                    "peer_entities": [],
                    "anchor_rule": {"id": "900010", "name": "主机沦陷"},
                    "target_source": "reasoning_chain",
                },
            },
            "enriched_context": {
                "graph": {"related_hosts": [{"src_ip": "10.0.0.1"}]},
                "edr_detail": {
                    "assets": [
                        {
                            "asset_id": "1001",
                            "activity_segments": [
                                {
                                    "scope": "anchor",
                                    "relation_basis": ["incident_trigger"],
                                    "process_activities": [
                                        {"image": "cmd.exe", "cmdline": "whoami"}
                                    ],
                                },
                                {
                                    "scope": "same_entity_context",
                                    "relation_basis": ["same_primary_entity"],
                                    "process_activities": [
                                        {"image": "inventory.exe"}
                                    ],
                                },
                            ],
                        },
                        {
                            "asset_id": "2002",
                            "activity_segments": [
                                {
                                    "scope": "linked",
                                    "relation_basis": ["same_network_session"],
                                    "process_activities": [
                                        {"image": "powershell.exe"}
                                    ],
                                }
                            ],
                        },
                    ]
                },
                "asset": {"tags": ["server"]},
                "threat_intel": {},
                "history": {},
            },
        }
        self.output = {
            "unified_event_id": "INC-1",
            "verdict": "可疑",
            "primary_claim": {
                "type": "host_compromise",
                "result": "证据不足",
            },
            "secondary_findings": None,
            "confidence_score": 0.81,
            "attack_stage": "初始访问",
            "technique": "T1190",
            "technique_name": "利用面向公众的应用程序",
            "verified_facts": [
                {
                    "id": "F01",
                    "fact": "观察到源地址发起远程连接。",
                    "source": "graph",
                }
            ],
            "key_claims": [
                {
                    "claim": "10.0.0.1 与 server-a（10.0.0.2，资产ID 1001）存在网络关系",
                    "result": "支持",
                    "evidence": [
                        {
                            "source": "graph",
                            "field": "related_hosts[0].src_ip",
                            "value": "10.0.0.1",
                        }
                    ],
                    "weight": 0.2,
                }
            ],
            "counter_evidence": [],
            "uncertainty_notes": "缺少执行结果。",
            "attack_chain_speculation": {
                "current_stage": "初始访问",
                "observed_path": [
                    {"description": "源地址发起访问。", "fact_refs": ["F01"]}
                ],
                "possible_next_steps": [],
                "supporting_evidence": ["F01"],
            },
            "rule_optimization_suggestions": [],
            "recommended_actions": [],
            "reasoning_summary": "已观察到零散访问行为，但尚未形成最小攻击链，因此判为可疑。",
        }

    def set_true_alert_next_steps(self) -> None:
        self.output["attack_chain_speculation"]["possible_next_steps"] = [
            {
                "technique": "T1059",
                "technique_name": "命令和脚本解释器",
                "description": "攻击者可能继续在 server-a（10.0.0.2，资产ID 1001）执行命令。",
            }
        ]

    def test_valid_output_passes(self) -> None:
        validate_forced_output(self.output, self.five_source)

    def test_rejects_categorical_confidence(self) -> None:
        self.output["confidence"] = "高"
        with self.assertRaisesRegex(ValueError, "confidence"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_legacy_evidence_refs_format(self) -> None:
        self.output["verified_facts"][0]["evidence_refs"] = [
            "enriched_context.graph.related_hosts[0].src_ip"
        ]
        with self.assertRaisesRegex(ValueError, "exactly id, fact, and source"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_unknown_verified_fact_source(self) -> None:
        self.output["verified_facts"][0]["source"] = "data_completeness"
        with self.assertRaisesRegex(ValueError, "five-domain source"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_incident_claim_as_verified_fact(self) -> None:
        self.output["verified_facts"][0]["fact"] = (
            "事件研判目标为 host_compromise。"
        )

        with self.assertRaisesRegex(ValueError, "incident or rule declaration"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_anchor_rule_as_verified_fact(self) -> None:
        self.output["verified_facts"][0]["fact"] = (
            "锚定规则为主机沦陷。"
        )

        with self.assertRaisesRegex(ValueError, "incident or rule declaration"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_more_than_eight_verified_facts(self) -> None:
        self.output["verified_facts"] = [
            {"id": f"F{index:02d}", "fact": f"事实 {index}", "source": "graph"}
            for index in range(1, 10)
        ]
        with self.assertRaisesRegex(ValueError, "at most 8"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_more_than_two_rule_suggestions(self) -> None:
        self.output["rule_optimization_suggestions"] = [{}, {}, {}]
        with self.assertRaisesRegex(ValueError, "at most 2"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_more_than_two_recommended_actions(self) -> None:
        self.output["recommended_actions"] = [{}, {}, {}]
        with self.assertRaisesRegex(ValueError, "at most 2"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_unknown_fact_reference(self) -> None:
        self.output["attack_chain_speculation"]["observed_path"][0][
            "fact_refs"
        ] = ["F99"]
        with self.assertRaisesRegex(ValueError, "unknown fact"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_forbidden_external_source(self) -> None:
        self.output["reasoning_summary"] = "从172.16.138.232:18060核对后确认。"
        with self.assertRaisesRegex(ValueError, "forbidden source"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_empty_claim_evidence_value(self) -> None:
        self.output["key_claims"][0]["evidence"] = [
            {
                "source": "history",
                "field": "similar_cases",
                "value": [],
            }
        ]
        self.five_source["enriched_context"]["history"]["similar_cases"] = []

        with self.assertRaisesRegex(ValueError, "must resolve to a non-empty value"):
            validate_forced_output(self.output, self.five_source)

    def test_warns_when_claim_evidence_value_differs_from_input(self) -> None:
        self.output["key_claims"][0]["evidence"] = [
            {
                "source": "graph",
                "field": "related_hosts[0].src_ip",
                "value": "10.0.0.99",
            }
        ]

        warnings = validate_forced_output(self.output, self.five_source)

        self.assertEqual(1, len(warnings))
        self.assertIn("does not match input", warnings[0])

    def test_rejects_primary_claim_type_that_differs_from_frozen_target(self) -> None:
        self.output["primary_claim"]["type"] = "lateral_movement"

        with self.assertRaisesRegex(ValueError, "frozen judgement target"):
            validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_can_make_overall_verdict_real(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["secondary_findings"] = {
            "type": "恶意远程执行",
            "description": "server-a（10.0.0.2，资产ID 1001）最可能发生恶意远程执行。",
        }
        self.set_true_alert_next_steps()

        validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_rejects_false_positive_verdict(self) -> None:
        self.output["verdict"] = "误报"
        self.output["secondary_findings"] = {
            "type": "恶意远程执行",
            "description": "server-a（10.0.0.2，资产ID 1001）出现零散远程执行迹象。",
        }

        with self.assertRaisesRegex(ValueError, "secondary_findings"):
            validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_rejects_suspicious_verdict(self) -> None:
        self.output["verdict"] = "可疑"
        self.output["primary_claim"]["result"] = "证据不足"
        self.output["secondary_findings"] = {
            "type": "恶意远程执行",
            "description": "server-a（10.0.0.2，资产ID 1001）出现远程执行攻击模式。",
        }

        with self.assertRaisesRegex(ValueError, "真实告警"):
            validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_rejects_legacy_list_shape(self) -> None:
        self.output["secondary_findings"] = [
            {
                "type": "恶意远程执行",
                "description": "稳定关联片段中存在远程执行行为。",
            }
        ]

        with self.assertRaisesRegex(ValueError, "object or null"):
            validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_requires_attack_semantics(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["secondary_findings"] = {
            "type": "可疑行为",
            "description": "观察到可疑行为。",
        }

        with self.assertRaisesRegex(ValueError, "attack semantic"):
            validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_accepts_host_compromise_semantic(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["secondary_findings"] = {
            "type": "主机沦陷",
            "description": "server-a（10.0.0.2，资产ID 1001）最可能已沦陷。",
        }
        self.set_true_alert_next_steps()

        validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_accepts_c2_semantic(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["secondary_findings"] = {
            "type": "C2通信",
            "description": "server-a（10.0.0.2，资产ID 1001）已建立 C2 通信。",
        }
        self.set_true_alert_next_steps()

        validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_accepts_remote_access_tool_implant_semantic(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["secondary_findings"] = {
            "type": "远程访问工具植入",
            "description": "server-a（10.0.0.2，资产ID 1001）出现远程访问工具植入攻击模式。",
        }
        self.set_true_alert_next_steps()

        validate_forced_output(self.output, self.five_source)

    def test_secondary_finding_rejects_legacy_evidence_refs(self) -> None:
        self.output["secondary_findings"] = {
            "type": "恶意代码注入",
            "description": "WAF 记录代码注入行为。",
            "evidence_refs": ["F01"],
        }

        with self.assertRaisesRegex(ValueError, "exactly type and description"):
            validate_forced_output(self.output, self.five_source)

    def test_primary_claim_verdict_mapping_is_enforced(self) -> None:
        self.output["primary_claim"]["result"] = "支持"
        self.output["verdict"] = "可疑"

        with self.assertRaisesRegex(ValueError, "supported primary claim"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_legacy_insufficient_verdict(self) -> None:
        self.output["verdict"] = "证据不足"

        with self.assertRaisesRegex(ValueError, "unsupported verdict"):
            validate_forced_output(self.output, self.five_source)

    def test_real_alert_requires_primary_anchor_or_linked_behavior(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["primary_claim"]["result"] = "支持"
        self.output["key_claims"][0] = {
            "claim": "主机失陷",
            "result": "支持",
            "evidence": [
                {
                    "source": "asset",
                    "field": "tags[0]",
                    "value": "server",
                }
            ],
            "weight": 0.8,
        }

        with self.assertRaisesRegex(ValueError, "primary anchor or linked behavior"):
            validate_forced_output(self.output, self.five_source)

    def test_real_alert_rejects_same_entity_context_as_only_support(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["primary_claim"]["result"] = "支持"
        self.output["key_claims"][0] = {
            "claim": "主机失陷",
            "result": "支持",
            "evidence": [
                {
                    "source": "edr_detail",
                    "field": "assets[0].activity_segments[1].process_activities[0].image",
                    "value": "inventory.exe",
                }
            ],
            "weight": 0.8,
        }

        with self.assertRaisesRegex(ValueError, "primary anchor or linked behavior"):
            validate_forced_output(self.output, self.five_source)

    def test_real_alert_rejects_non_primary_entity_as_only_support(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["primary_claim"]["result"] = "支持"
        self.output["key_claims"][0] = {
            "claim": "主机失陷",
            "result": "支持",
            "evidence": [
                {
                    "source": "edr_detail",
                    "field": "assets[1].activity_segments[0].process_activities[0].image",
                    "value": "powershell.exe",
                }
            ],
            "weight": 0.8,
        }

        with self.assertRaisesRegex(ValueError, "primary anchor or linked behavior"):
            validate_forced_output(self.output, self.five_source)

    def test_real_alert_accepts_primary_anchor_behavior(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["primary_claim"]["result"] = "支持"
        self.set_true_alert_next_steps()
        self.output["key_claims"][0] = {
            "claim": "主机失陷",
            "result": "支持",
            "evidence": [
                {
                    "source": "edr_detail",
                    "field": "assets[0].activity_segments[0].process_activities[0].cmdline",
                    "value": "whoami",
                }
            ],
            "weight": 0.8,
        }

        validate_forced_output(self.output, self.five_source)

    def test_real_alert_accepts_current_anchor_entity_process_path(self) -> None:
        five_source = {
            "unified_event_id": "INC-V6",
            "event_snapshot": {
                "judgement_target": {
                    "claim_family": "entity_state",
                    "claim_type": "host_compromise",
                },
                "entities": [
                    {
                        "entity_ref": "E1",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "1001",
                    }
                ],
            },
            "enriched_context": {
                "graph": {"path_hints": []},
                "edr_detail": {
                    "entities": [
                        {
                            "entity_ref": "E1",
                            "activity_segments": [
                                {
                                    "scope": "anchor_entity",
                                    "processes": [
                                        {"image": "cmd.exe", "cmdline": "whoami"}
                                    ],
                                }
                            ],
                        }
                    ]
                },
                "asset": {},
                "threat_intel": {},
                "history": {},
            },
        }
        output = copy.deepcopy(self.output)
        output["unified_event_id"] = "INC-V6"
        output["verdict"] = "真实告警"
        output["primary_claim"] = {"type": "host_compromise", "result": "支持"}
        output["attack_chain_speculation"]["possible_next_steps"] = [
            {
                "technique": "T1059",
                "technique_name": "命令和脚本解释器",
                "description": "攻击者可能继续在资产ID 1001 上执行命令。",
            }
        ]
        output["key_claims"][0] = {
            "claim": "主机失陷",
            "result": "支持",
            "evidence": [
                {
                    "source": "edr_detail",
                    "field": "entities[0].activity_segments[0].processes[0].cmdline",
                    "value": "whoami",
                }
            ],
            "weight": 0.8,
        }

        validate_forced_output(output, five_source)

    def test_entity_relation_real_alert_requires_stable_relation_evidence(self) -> None:
        self.five_source["event_snapshot"]["judgement_target"].update(
            {
                "claim_family": "entity_relation",
                "claim_type": "lateral_movement",
                "peer_entities": [{"asset_id": "2002", "ip": "10.0.0.3"}],
            }
        )
        self.output["verdict"] = "真实告警"
        self.output["primary_claim"] = {
            "type": "lateral_movement",
            "result": "支持",
        }
        self.output["key_claims"][0] = {
            "claim": "发生横向移动",
            "result": "支持",
            "evidence": [
                {
                    "source": "edr_detail",
                    "field": "assets[0].activity_segments[0].process_activities[0].cmdline",
                    "value": "whoami",
                }
            ],
            "weight": 0.8,
        }

        with self.assertRaisesRegex(ValueError, "stable relation evidence"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_removed_llm_inferences_field(self) -> None:
        self.output["llm_inferences"] = []

        with self.assertRaisesRegex(ValueError, "unexpected fields"):
            validate_forced_output(self.output, self.five_source)

    def test_key_claims_only_accept_supported_claims(self) -> None:
        self.output["key_claims"][0]["result"] = "证据不足"

        with self.assertRaisesRegex(ValueError, "only contain supported claims"):
            validate_forced_output(self.output, self.five_source)

    def test_counter_evidence_requires_resolvable_nonempty_value(self) -> None:
        self.output["counter_evidence"] = [
            {
                "claim": "server-a（10.0.0.2，资产ID 1001）没有网络关系",
                "fact": "查询结果为空。",
                "source": "history",
                "field": "similar_cases",
                "value": [],
            }
        ]
        self.five_source["enriched_context"]["history"]["similar_cases"] = []

        with self.assertRaisesRegex(ValueError, "non-empty value"):
            validate_forced_output(self.output, self.five_source)

    def test_counter_evidence_accepts_actual_conflicting_fact(self) -> None:
        self.five_source["enriched_context"]["asset"]["maintenance_window"] = True
        self.output["counter_evidence"] = [
            {
                "claim": "server-a（10.0.0.2，资产ID 1001）的活动没有良性解释",
                "fact": "server-a（10.0.0.2，资产ID 1001）处于维护窗口。",
                "source": "asset",
                "field": "maintenance_window",
                "value": True,
            }
        ]

        validate_forced_output(self.output, self.five_source)

    def test_rejects_bare_internal_entity_reference_in_readable_fact(self) -> None:
        self.output["verified_facts"][0]["fact"] = "E1 执行了命令。"

        with self.assertRaisesRegex(ValueError, "bare internal entity reference"):
            validate_forced_output(self.output, self.five_source)

    def test_rejects_bare_internal_entity_reference_in_claim(self) -> None:
        self.output["key_claims"][0]["claim"] = "E1 与 10.0.0.1 存在连接。"

        with self.assertRaisesRegex(ValueError, "bare internal entity reference"):
            validate_forced_output(self.output, self.five_source)

    def test_real_alert_requires_one_to_three_possible_next_steps(self) -> None:
        self.output["verdict"] = "真实告警"
        self.output["primary_claim"]["result"] = "支持"
        self.output["key_claims"][0] = {
            "claim": "server-a（10.0.0.2，资产ID 1001）执行 whoami",
            "result": "支持",
            "evidence": [
                {
                    "source": "edr_detail",
                    "field": "assets[0].activity_segments[0].process_activities[0].cmdline",
                    "value": "whoami",
                }
            ],
            "weight": 0.8,
        }

        with self.assertRaisesRegex(ValueError, "requires 1 to 3"):
            validate_forced_output(self.output, self.five_source)

    def test_non_real_alert_rejects_possible_next_steps(self) -> None:
        self.output["attack_chain_speculation"]["possible_next_steps"] = [
            {
                "technique": "T1059",
                "technique_name": "命令和脚本解释器",
                "description": "攻击者可能继续执行命令。",
            }
        ]

        with self.assertRaisesRegex(ValueError, "must be empty"):
            validate_forced_output(self.output, self.five_source)

    def test_low_confidence_false_positive_requires_uncertainty_notes(self) -> None:
        self.output.update(
            {
                "verdict": "误报",
                "secondary_findings": None,
                "confidence_score": 0.45,
                "verified_facts": [],
                "key_claims": [],
                "counter_evidence": [],
                "uncertainty_notes": None,
            }
        )
        self.output["attack_chain_speculation"].update(
            {
                "current_stage": None,
                "observed_path": [],
                "possible_next_steps": [],
                "supporting_evidence": [],
            }
        )

        with self.assertRaisesRegex(
            ValueError, "low-confidence false positive requires uncertainty_notes"
        ):
            validate_forced_output(self.output, self.five_source)

    def test_incomplete_false_positive_accepts_explicit_uncertainty_notes(self) -> None:
        self.five_source["data_completeness"] = 0.7
        self.output.update(
            {
                "verdict": "误报",
                "secondary_findings": None,
                "confidence_score": 0.52,
                "verified_facts": [],
                "key_claims": [],
                "counter_evidence": [],
                "uncertainty_notes": (
                    "目标端点行为未接入，无法确认告警后是否产生执行结果；"
                    "补齐该数据后可能改变当前误报结论。"
                ),
            }
        )
        self.output["attack_chain_speculation"].update(
            {
                "current_stage": None,
                "observed_path": [],
                "possible_next_steps": [],
                "supporting_evidence": [],
            }
        )

        validate_forced_output(self.output, self.five_source)


class CompactPromptContractTest(unittest.TestCase):






    def test_builtin_prompt_enforces_secondary_boundary_and_calibrated_confidence(self) -> None:
        prompt_file = ROOT / "prompts" / "threat-analysis-system.txt"
        self.assertTrue(prompt_file.is_file())
        prompt = prompt_file.read_text(encoding="utf-8")
        self.assertIn("可疑或误报时必须为 null", prompt)
        self.assertIn("至少两个具有攻击语义的行为节点", prompt)
        self.assertIn("缺失数据本身不是可疑证据", prompt)
        self.assertIn("不得把同一资产的资产 ID、IP、主机名描述为两个实体之间的关系", prompt)
        self.assertIn("同一 verdict 仅在证据强度确实相当时才可使用相同分数", prompt)



if __name__ == "__main__":
    unittest.main()
