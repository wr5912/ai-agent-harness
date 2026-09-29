from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

GRAPH_FIELDS_FOR_TEST = {
    "related_hosts",
    "related_users",
    "connection_history",
    "firewall_sessions",
    "ids_probe_alerts",
    "trust_info",
    "path_hints",
    "asset_group",
    "cross_device_corroboration",
    "topology_summary",
    "login_sequence",
}

from fusion_contract import (  # noqa: E402
    CallOutcome,
    canonical_tool_name,
    make_ledger_entry,
    validate_five_source_output,
    validate_model_input,
)



class FusionContractTest(unittest.TestCase):
    def test_accepts_entity_index_local_domains_and_global_relations(self) -> None:
        payload = {
            "unified_event_id": "INC-1",
            "event_snapshot": {
                "event_type": "LATERAL_MOVEMENT_REASONING",
                "time_range": ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
                "judgement_target": {
                    "claim_family": "incident_claim",
                    "claim_type": "lateral_movement",
                    "target_source": "incident_type",
                },
                "entities": [
                    {"entity_ref": "E1", "entity_type": "asset", "role": "anchor", "asset_id": "1001"},
                    {"entity_ref": "E2", "entity_type": "ip", "role": "anchor", "value": "192.0.2.20"},
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
                "edr_detail": {"entities": [{"entity_ref": "E1", "activity_segments": []}]},
                "asset": {"entities": [{"entity_ref": "E1", "asset_criticality": None}]},
                "threat_intel": {"indicators": []},
                "history": {"records": []},
            },
            "data_completeness": 0.5,
            "enrichment_latency_ms": 10,
        }

        validate_five_source_output(payload)

    def test_rejects_old_single_primary_entity_shape(self) -> None:
        payload = {
            "unified_event_id": "INC-1",
            "event_snapshot": {
                "event_type": "HOST_COMPROMISE_REASONING",
                "time_range": ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
                "judgement_target": {
                    "claim_type": "host_compromise",
                    "primary_entity": {"asset_id": "1001"},
                },
                "entities": [],
            },
            "enriched_context": {},
            "data_completeness": 0.5,
            "enrichment_latency_ms": 10,
        }

        with self.assertRaisesRegex(ValueError, "primary_entity"):
            validate_five_source_output(payload)

    def test_model_contract_accepts_process_refs_and_rejects_dangling_refs(self) -> None:
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
                        "ip": "192.0.2.10",
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
                                    "processes": [
                                        {"ref": "P001", "image": "explorer.exe"},
                                        {
                                            "ref": "P002",
                                            "image": "cmd.exe",
                                            "parent_ref": "P001",
                                        },
                                    ],
                                    "network_details": [
                                        {
                                            "process_ref": "P002",
                                            "destination_ip": "192.0.2.20",
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

        validate_model_input(payload)
        payload["enriched_context"]["edr_detail"]["entities"][0]["activity_segments"][0][
            "network_details"
        ][0]["process_ref"] = "P999"

        with self.assertRaisesRegex(ValueError, "unknown process_ref"):
            validate_model_input(payload)

    def test_model_contract_rejects_audit_only_entity_and_edr_fields(self) -> None:
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
                    }
                ],
            },
            "enriched_context": {
                "graph": {field: [] for field in GRAPH_FIELDS_FOR_TEST},
                "edr_detail": {"entities": [{"entity_ref": "E1", "activity_segments": []}]},
                "asset": {"entities": [{"entity_ref": "E1"}]},
                "threat_intel": {"indicators": []},
                "history": {"records": []},
            },
            "data_completeness": 0.5,
        }
        payload["enriched_context"]["graph"]["trust_info"] = None

        with self.assertRaisesRegex(ValueError, "audit-only"):
            validate_model_input(payload)


class LedgerContractTest(unittest.TestCase):
    def test_tool_name_is_concise_but_exact_tool_is_retained(self) -> None:
        exact = "ai_soc_correlate__get_correlate_incident_by_incident_id"
        entry = make_ledger_entry(
            call_id="C001",
            resource="ai_soc_correlate",
            exact_tool_name=exact,
            purpose="查询安全事件详情",
            key_arguments={"incidentId": "INC-1"},
            argument_sources={"incidentId": "用户指定事件 ID"},
            outcome=CallOutcome.SUCCESS_WITH_DATA,
            result_count=1,
            latency_ms=12,
            output_domain="event_snapshot",
            raw_response_file="raw/C001.json",
        )
        self.assertEqual(
            "get_correlate_incident_by_incident_id", entry["tool"]
        )
        self.assertEqual(exact, entry["audit"]["exact_tool"])
        self.assertNotIn("password", json.dumps(entry).lower())

    def test_canonical_tool_name_preserves_unprefixed_name(self) -> None:
        self.assertEqual("count_event", canonical_tool_name("count_event"))

if __name__ == "__main__":
    unittest.main()
