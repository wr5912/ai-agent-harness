import pathlib
import sys
import unittest
from types import SimpleNamespace


MODULE_DIR = pathlib.Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(MODULE_DIR))

from evidence_collection import (  # noqa: E402
    fetch_bounded_event_hits,
    build_intel_indicators,
    build_slice_searches,
    calculate_completeness,
    prepare_five_source_artifacts,
)


from fusion_contract import CallOutcome

class EvidenceCollectionTest(unittest.TestCase):
    def test_prepares_separate_audit_and_model_artifacts_without_mutating_audit(self) -> None:
        payload = {
            "unified_event_id": "INC-1",
            "event_snapshot": {
                "event_type": "HOST_COMPROMISE_REASONING",
                "time_range": ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
                "judgement_target": {
                    "claim_family": "incident_claim",
                    "claim_type": "host_compromise",
                    "target_source": "incident_type",
                },
                "entities": [
                    {
                        "entity_ref": "E1",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "1001",
                        "aliases": [{"type": "ip", "value": "192.0.2.10"}],
                        "provenance": ["incident.entitiesJson[0]"],
                    }
                ],
            },
            "enriched_context": {
                "graph": {
                    "related_hosts": [],
                    "related_users": [],
                    "connection_history": [],
                    "firewall_sessions": [],
                    "ids_probe_alerts": [],
                    "trust_info": None,
                    "path_hints": [],
                    "asset_group": [],
                    "cross_device_corroboration": [],
                    "topology_summary": [],
                    "login_sequence": [],
                },
                "edr_detail": {
                    "entities": [
                        {
                            "entity_ref": "E1",
                            "activity_segments": [
                                {
                                    "segment_id": "S1",
                                    "process_activities": [
                                        {
                                            "image": "cmd.exe",
                                            "cmdline": "cmd /c whoami",
                                            "alert_ids": ["A1"],
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                },
                "asset": {"entities": [{"entity_ref": "E1"}]},
                "threat_intel": {"indicators": []},
                "history": {"records": []},
            },
            "data_completeness": 0.5,
            "enrichment_latency_ms": 10,
        }

        audit, model = prepare_five_source_artifacts(payload)

        self.assertIn("aliases", audit["event_snapshot"]["entities"][0])
        self.assertIn(
            "process_activities",
            audit["enriched_context"]["edr_detail"]["entities"][0]["activity_segments"][0],
        )
        self.assertNotIn("aliases", model["event_snapshot"]["entities"][0])
        self.assertIn(
            "processes",
            model["enriched_context"]["edr_detail"]["entities"][0]["activity_segments"][0],
        )

    def test_model_projection_excludes_headless_rule_and_alert_provenance(self) -> None:
        payload = {
            "unified_event_id": "INC-RULE-PROJECTION",
            "event_snapshot": {
                "event_type": "HOST_COMPROMISE_REASONING",
                "time_range": ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
                "judgement_target": {
                    "claim_family": "incident_claim",
                    "claim_type": "host_compromise",
                    "target_source": "incident_type",
                    "anchor_rule": {
                        "id": "900010",
                        "name": "主机沦陷规则",
                        "description": "已提供完整规则说明",
                    },
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
                "graph": {
                    "related_hosts": [],
                    "related_users": [],
                    "connection_history": [],
                    "firewall_sessions": [
                        {"source_ip": "192.0.2.10", "rule_id": "69", "action": "pass"}
                    ],
                    "ids_probe_alerts": [
                        {
                            "event_type": "MALWARE_EXECUTION",
                            "alert_ids": ["A1"],
                            "alert_id_count": 1,
                            "rule_ids": ["R1"],
                            "rule_id_count": 1,
                        }
                    ],
                    "trust_info": None,
                    "path_hints": [],
                    "asset_group": [],
                    "cross_device_corroboration": [],
                    "topology_summary": [],
                    "login_sequence": [],
                },
                "edr_detail": {
                    "entities": [
                        {
                            "entity_ref": "E1",
                            "activity_segments": [
                                {
                                    "segment_id": "S1",
                                    "scope": "anchor_entity",
                                    "rule_ids": ["R1"],
                                    "process_activities": [
                                        {
                                            "image": "cmd.exe",
                                            "cmdline": "cmd /c whoami",
                                            "rule_ids": ["R1"],
                                            "alert_ids": ["A1"],
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                },
                "asset": {"entities": [{"entity_ref": "E1"}]},
                "threat_intel": {"indicators": []},
                "history": {"records": []},
            },
            "data_completeness": 0.5,
            "enrichment_latency_ms": 10,
        }

        audit, model = prepare_five_source_artifacts(payload)

        self.assertEqual(
            ["R1"],
            audit["enriched_context"]["edr_detail"]["entities"][0]
            ["activity_segments"][0]["rule_ids"],
        )
        self.assertIn("anchor_rule", model["event_snapshot"]["judgement_target"])

        def walk(value: object, path: str = ""):
            if isinstance(value, dict):
                for key, item in value.items():
                    current = f"{path}.{key}" if path else key
                    yield current, key, item
                    yield from walk(item, current)
            elif isinstance(value, list):
                for index, item in enumerate(value):
                    yield from walk(item, f"{path}[{index}]")

        model_provenance = [
            (path, key)
            for path, key, _ in walk(model)
            if path.startswith("enriched_context.")
            and key in {
                "rule_id",
                "rule_ids",
                "rule_id_count",
                "alert_ids",
                "alert_id_count",
                "sample_record_ids",
            }
        ]
        self.assertEqual([], model_provenance)

    def test_slice_searches_cover_every_anchor_in_the_same_forward_slice(self) -> None:
        targets = [
            {
                "entity_ref": "E1",
                "field": "ocsf.device.asset.uid.keyword",
                "value": "1001",
            },
            {
                "entity_ref": "E2",
                "field": "ocsf.device.ip.keyword",
                "value": "192.0.2.20",
            },
        ]

        searches = build_slice_searches(
            slice_start="2026-09-10T01:00:00Z",
            slice_end="2026-09-10T02:00:00Z",
            targets=targets,
            per_target_budget=20,
        )

        self.assertEqual(["E1", "E2"], [row["entity_ref"] for row in searches])
        self.assertTrue(all(row["order"] == "asc" for row in searches))
        self.assertTrue(all(row["budget"] == 20 for row in searches))
        self.assertEqual(
            "2026-09-10T01:00:00Z",
            searches[0]["arguments"]["body"]["timeRange"]["from"],
        )

    def test_intelligence_scope_uses_indexed_entities_and_retained_relations_only(self) -> None:
        entities = [
            {"entity_ref": "E1", "role": "anchor", "entity_type": "ip", "value": "192.0.2.10"},
            {"entity_ref": "E2", "role": "related", "entity_type": "ip", "value": "192.0.2.20"},
            {"entity_ref": "E3", "role": "anchor", "entity_type": "user", "value": "alice"},
        ]
        records = [
            {
                "source_ip": "192.0.2.10",
                "destination_ip": "198.51.100.30",
                "entity_refs": ["E1"],
            },
            {
                "source_ip": "203.0.113.40",
                "destination_ip": "203.0.113.41",
                "entity_refs": [],
            },
        ]

        indicators = build_intel_indicators(entities, records, max_indicators=10)

        self.assertEqual(
            ["192.0.2.10", "192.0.2.20", "198.51.100.30"],
            [row["value"] for row in indicators],
        )
        relation_indicator = next(row for row in indicators if row["value"] == "198.51.100.30")
        self.assertEqual(["E1"], relation_indicator["entity_refs"])

    def test_completeness_is_deterministic_and_keeps_history_unavailable(self) -> None:
        score, audit = calculate_completeness(
            resolved_alerts=9,
            referenced_alerts=10,
            anchor_query_successes=3,
            anchor_query_attempts=4,
            asset_query_successes=8,
            asset_query_attempts=10,
            graph_query_successes=6,
            graph_query_attempts=8,
            intel_query_successes=3,
            intel_query_attempts=3,
        )

        self.assertEqual(0.71, score)
        self.assertEqual(0.0, audit["domain_scores"]["history"]["score"])
        self.assertEqual(0.9, audit["domain_scores"]["edr_detail"]["alert_resolution"])


class EventPaginationTest(unittest.TestCase):
    def test_endpoint_event_search_reduces_page_and_paginates_after_truncation(self) -> None:
        searches = [{"budget": 100, "name": "asset_uid", "order": "asc",
                     "tool": "ai_soc_event__search_event", "arguments": {"body": {"size": 10}}}]

        class Runner:
            def __init__(self) -> None:
                self.calls = []
                self.results = [
                    SimpleNamespace(outcome=CallOutcome.TRUNCATED, data={"_preview": "ignored"}),
                    SimpleNamespace(
                        outcome=CallOutcome.SUCCESS_WITH_DATA,
                        data={
                            "total": 7,
                            "hits": [{"_id": f"evt-{index}"} for index in range(5)],
                        },
                    ),
                    SimpleNamespace(
                        outcome=CallOutcome.SUCCESS_WITH_DATA,
                        data={
                            "total": 7,
                            "hits": [{"_id": "evt-5"}, {"_id": "evt-6"}],
                        },
                    ),
                ]

            def call(self, **kwargs):
                self.calls.append(kwargs)
                return self.results.pop(0)

        runner = Runner()
        hits, summary = fetch_bounded_event_hits(runner, searches[0])

        self.assertEqual(7, len(hits))
        self.assertEqual([10, 5, 2], [call["arguments"]["body"]["size"] for call in runner.calls])
        self.assertEqual([0, 0, 5], [call["arguments"]["body"]["from"] for call in runner.calls])
        self.assertEqual("success_with_data", summary["status"])
        self.assertEqual(7, summary["matched_total"])
        self.assertEqual(1, summary["truncated_attempts"])
        self.assertEqual(2, summary["page_count"])

if __name__ == "__main__":
    unittest.main()
