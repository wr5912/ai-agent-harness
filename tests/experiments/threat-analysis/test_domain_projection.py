from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from domain_projection import (  # noqa: E402
    compact_login_sequences,
    build_anchor_search_targets,
    build_judgement_target,
    project_asset_domain,
    project_edr_domain,
    project_graph_domain,
    project_threat_intel_domain,
    select_endpoint_pairs,
)



class PlanningProjectionTest(unittest.TestCase):
    def test_judgement_target_uses_incident_claim_not_alert_or_chain_order(self) -> None:
        incident = {
            "incidentType": "LATERAL_MOVEMENT_REASONING",
            "reasoningRuleId": 900010,
        }
        target = build_judgement_target(
            incident,
            {"ruleId": 900010, "name": "主机沦陷", "description": "规则说明"},
        )

        self.assertEqual("incident_declared_threat", target["claim_family"])
        self.assertEqual("LATERAL_MOVEMENT_REASONING", target["claim_type"])
        self.assertEqual("incident.incidentType", target["target_source"])
        self.assertEqual("900010", target["anchor_rule"]["id"])

    def test_search_targets_include_asset_primary_and_time_bound_alias_fallbacks(self) -> None:
        entities = [
            {
                "entity_ref": "E1",
                "entity_type": "asset",
                "role": "anchor",
                "asset_id": "1001",
                "aliases": [
                    {"type": "ip", "value": "192.0.2.11"},
                    {"type": "hostname", "value": "host-a"},
                ],
            },
            {"entity_ref": "E2", "entity_type": "ip", "role": "anchor", "value": "192.0.2.10"},
            {"entity_ref": "E3", "entity_type": "ip", "role": "related", "value": "192.0.2.20"},
        ]

        targets = build_anchor_search_targets(entities)

        self.assertEqual(
            [
                {
                    "entity_ref": "E1",
                    "field": "ocsf.device.asset.uid.keyword",
                    "value": "1001",
                },
                {
                    "entity_ref": "E1",
                    "field": "ocsf.device.ip.keyword",
                    "value": "192.0.2.11",
                },
                {
                    "entity_ref": "E1",
                    "field": "ocsf.device.hostname.keyword",
                    "value": "host-a",
                },
                {
                    "entity_ref": "E2",
                    "field": "ocsf.device.ip.keyword",
                    "value": "192.0.2.10",
                },
            ],
            targets,
        )

    def test_endpoint_pairs_require_an_anchor_relation_and_are_deduplicated(self) -> None:
        records = [
            {
                "source_ip": "192.0.2.10",
                "destination_ip": "192.0.2.20",
                "destination_port": 445,
                "protocol": "tcp",
                "event_time": "2026-09-10T01:00:00Z",
                "source_entity_ref": "E1",
                "destination_entity_ref": "E3",
                "entity_refs": ["E1", "E3"],
            },
            {
                "source_ip": "192.0.2.10",
                "destination_ip": "192.0.2.20",
                "destination_port": 445,
                "protocol": "tcp",
                "event_time": "2026-09-10T01:01:00Z",
                "source_entity_ref": "E1",
                "destination_entity_ref": "E3",
                "entity_refs": ["E1", "E3"],
            },
            {
                "source_ip": "198.51.100.1",
                "destination_ip": "198.51.100.2",
                "entity_refs": [],
            },
        ]

        pairs = select_endpoint_pairs(records, anchor_refs={"E1"}, max_pairs=20)

        self.assertEqual(
            [
                {
                    "source_ip": "192.0.2.10",
                    "destination_ip": "192.0.2.20",
                    "destination_ports": [445],
                    "protocols": ["tcp"],
                    "entity_refs": ["E1", "E3"],
                    "observation_count": 2,
                    "time_range": [
                        "2026-09-10T01:00:00Z",
                        "2026-09-10T01:01:00Z",
                    ],
                }
            ],
            pairs,
        )


class FiveDomainProjectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.entities = [
            {
                "entity_ref": "E1",
                "entity_type": "asset",
                "role": "anchor",
                "asset_id": "1001",
                "aliases": [{"type": "ip", "value": "192.0.2.10"}],
            },
            {
                "entity_ref": "E2",
                "entity_type": "ip",
                "role": "related",
                "value": "192.0.2.20",
                "related_to": ["E1"],
                "aliases": [],
            },
        ]
        self.records = [
            {
                "record_key": "raw_event_uid:r1",
                "record_origin": "anchor_event_search",
                "entity_ref": "E1",
                "entity_refs": ["E1", "E2"],
                "source_entity_ref": "E1",
                "destination_entity_ref": "E2",
                "event_time": "2026-09-10T01:00:00Z",
                "source": "EDR",
                "alert_type": "Process Start",
                "source_ip": "192.0.2.10",
                "destination_ip": "192.0.2.20",
                "destination_port": 445,
                "protocol": "tcp",
                "process": {
                    "uid": "P2",
                    "path": "C:/Windows/System32/cmd.exe",
                    "cmdline": "cmd /c whoami",
                    "parent": {"uid": "P1", "path": "C:/Windows/explorer.exe"},
                },
                "user": {"name": "EXAMPLE\\alice"},
                "alert_ids": ["A1"],
                "rule_ids": ["R1"],
            },
            {
                "record_key": "raw_event_uid:r2",
                "entity_ref": "E1",
                "entity_refs": ["E1"],
                "event_time": "2026-09-10T01:01:00Z",
                "source": "EDR",
                "alert_type": "File Create",
                "file_operations": [
                    {"path": "C:/Temp/a.exe", "operation": "create", "hashes": ["abc"]}
                ],
                "alert_ids": [],
                "rule_ids": [],
            },
        ]

    def test_edr_is_entity_local_and_aggregated_without_raw_record_dump(self) -> None:
        domain = project_edr_domain(self.entities, self.records)

        self.assertEqual(["E1", "E2"], [row["entity_ref"] for row in domain["entities"]])
        first = domain["entities"][0]["activity_segments"][0]
        self.assertEqual(1, len(first["process_activities"]))
        self.assertEqual("cmd /c whoami", first["process_activities"][0]["cmdline"])
        self.assertEqual(1, len(first["file_operations"]))
        self.assertNotIn("raw_records", first)
        self.assertEqual([], domain["entities"][1]["activity_segments"])

    def test_repeated_process_activity_keeps_bounded_audit_identifiers_for_separate_audit_package(self) -> None:
        records = []
        for index in range(10):
            records.append(
                {
                    "record_key": f"raw_event_uid:r{index}",
                    "record_origin": "anchor_event_search",
                    "entity_ref": "E1",
                    "entity_refs": ["E1"],
                    "event_time": f"2026-09-10T01:00:{index:02d}Z",
                    "source": "EDR",
                    "alert_type": "Process Start",
                    "process": {
                        "uid": f"P{index}",
                        "pid": 100 + index,
                        "path": "C:/Windows/System32/whoami.exe",
                    },
                    "alert_ids": [f"A{index}"],
                    "rule_ids": [f"R{index}"],
                }
            )

        domain = project_edr_domain(self.entities, records)
        activity = domain["entities"][0]["activity_segments"][0]["process_activities"][0]

        self.assertEqual(10, activity["count"])
        self.assertEqual("Process Start", activity["action"])
        self.assertEqual("2026-09-10T01:00:00Z", activity["first_seen"])
        self.assertEqual("2026-09-10T01:00:09Z", activity["last_seen"])
        self.assertEqual(3, len(activity["process_uids"]))
        self.assertEqual(3, len(activity["alert_ids"]))
        self.assertEqual(5, len(activity["rule_ids"]))
        self.assertEqual(10, activity["alert_id_count"])
        self.assertEqual(10, activity["rule_id_count"])

    def test_contributing_alert_label_is_not_repeated_as_process_action(self) -> None:
        records = [
            {
                "record_key": "raw_event_uid:r1",
                "record_origin": "contributing_alert",
                "entity_ref": "E1",
                "entity_refs": ["E1"],
                "event_time": "2026-09-10T01:00:00Z",
                "source": "EDR",
                "alert_type": "MALWARE_EXECUTION",
                "process": {
                    "path": "C:/Temp/payload.exe",
                    "pid": 404,
                    "uid": "P404",
                    "parent": {"pid": 4, "uid": "P4"},
                },
                "alert_ids": ["A1"],
                "rule_ids": ["R1"],
            }
        ]

        domain = project_edr_domain(self.entities, records)
        activity = domain["entities"][0]["activity_segments"][0]["process_activities"][0]

        self.assertEqual("C:/Temp/payload.exe", activity["image"])
        self.assertEqual("2026-09-10T01:00:00Z", activity["first_seen"])
        self.assertNotIn("action", activity)
        self.assertEqual(404, activity["pid"])
        self.assertEqual(["P404"], activity["process_uids"])
        self.assertEqual("P4", activity["parent"]["process_uid"])

    def test_ids_probe_alerts_keep_counts_and_only_sample_identifiers(self) -> None:
        records = [
            {
                "record_key": f"source_record_id:{index}",
                "record_origin": "contributing_alert",
                "entity_refs": ["E1"],
                "event_time": f"2026-09-10T01:00:{index:02d}Z",
                "source": "WAF",
                "alert_type": "CMD_INJECTION",
                "source_ip": "192.0.2.10",
                "destination_ip": "192.0.2.20",
                "alert_ids": [f"A{index}"],
                "rule_ids": [f"R{index}"],
            }
            for index in range(10)
        ]

        graph = project_graph_domain(
            entities=self.entities,
            records=records,
            endpoint_pairs=[],
            topology_by_entity={},
            account_rows=[],
            login_sequences=[],
            firewall_sessions=[],
        )
        probe = graph["ids_probe_alerts"][0]

        self.assertEqual(10, probe["alert_id_count"])
        self.assertEqual(3, len(probe["alert_ids"]))
        self.assertEqual(10, probe["rule_id_count"])
        self.assertEqual(5, len(probe["rule_ids"]))

    def test_graph_separates_compact_topology_hosts_from_endpoint_path_hints(self) -> None:
        graph = project_graph_domain(
            entities=self.entities,
            records=self.records,
            endpoint_pairs=[
                {
                    "source_ip": "192.0.2.10",
                    "destination_ip": "192.0.2.20",
                    "destination_ports": [445],
                    "protocols": ["tcp"],
                    "entity_refs": ["E1", "E2"],
                    "observation_count": 1,
                    "time_range": [
                        "2026-09-10T01:00:00Z",
                        "2026-09-10T01:00:00Z",
                    ],
                }
            ],
            topology_by_entity={
                "E1": {
                    "relatedAssets": [
                        {
                            "assetId": 2002,
                            "ip": "192.0.2.30",
                            "hostname": "host-b",
                            "direction": "outbound",
                            "edgeType": "flow",
                            "hitCount": 9,
                            "lastSeen": "2026-09-10T00:59:00Z",
                        }
                    ]
                }
            },
            account_rows=[
                {
                    "entity_ref": "E1",
                    "accounts": [
                        {
                            "name": "alice",
                            "privilege": "admin",
                            "role": "admin_of",
                            "sid": "S-1-5-21-1",
                            "lastSeen": 1,
                        }
                    ],
                }
            ],
            login_sequences=[],
            firewall_sessions=[],
        )

        self.assertNotIn("topology_context", graph)
        self.assertEqual([], graph["connection_history"])
        self.assertEqual(
            [
                {
                    "entity_ref": "E1",
                    "asset_id": 2002,
                    "hostname": "host-b",
                    "ip": "192.0.2.30",
                    "direction": "outbound",
                }
            ],
            graph["related_hosts"],
        )
        self.assertEqual(
            [
                {
                    "src_ref": "E1",
                    "src_asset_id": "1001",
                    "src_ip": "192.0.2.10",
                    "dst_ref": "E2",
                    "dst_ip": "192.0.2.20",
                    "protocols": ["tcp"],
                    "dst_ports": [445],
                    "count": 1,
                    "time_range": [
                        "2026-09-10T01:00:00Z",
                        "2026-09-10T01:00:00Z",
                    ],
                    "basis": "event",
                }
            ],
            graph["path_hints"],
        )
        self.assertEqual(
            [
                {
                    "entity_ref": "E1",
                    "name": "alice",
                    "privilege": "admin",
                    "role": "admin_of",
                }
            ],
            graph["related_users"],
        )
        self.assertEqual("E1", graph["topology_summary"][0]["entity_ref"])

    def test_asset_and_intel_are_bound_to_entity_refs(self) -> None:
        asset = project_asset_domain(
            self.entities,
            {
                "E1": {
                    "detail": {"assetId": 1001, "hostname": "host-a", "ip": "192.0.2.10"},
                    "importance": {"importance": "HIGH"},
                    "business_system": [{"bizName": "核心系统"}],
                    "bindings": [{"deviceType": "EDR"}],
                }
            },
        )
        intel = project_threat_intel_domain(
            [{"indicator_type": "ip", "value": "192.0.2.20", "entity_refs": ["E2"]}],
            {"192.0.2.20": {"queried": True, "matches": []}},
        )

        self.assertEqual("E1", asset["entities"][0]["entity_ref"])
        self.assertEqual("HIGH", asset["entities"][0]["asset_criticality"])
        self.assertEqual(["E2"], intel["indicators"][0]["entity_refs"])
        self.assertFalse(intel["indicators"][0]["intel_hit"])


class LoginSequenceTest(unittest.TestCase):
    def test_login_sequences_are_aggregated_by_account_and_endpoint(self) -> None:
        projected, stats = compact_login_sequences(
            [
                {
                    "account": "SYSTEM",
                    "sequence": [
                        {
                            "account": "SYSTEM",
                            "srcIp": None,
                            "dstIp": "172.16.2.103",
                            "dstHost": "PC",
                            "dstPort": None,
                            "tsEpochMs": 1000,
                        },
                        {
                            "account": "SYSTEM",
                            "srcIp": None,
                            "dstIp": "172.16.2.103",
                            "dstHost": "PC",
                            "dstPort": None,
                            "tsEpochMs": 2000,
                        },
                        {
                            "account": "SYSTEM",
                            "srcIp": "172.16.2.104",
                            "dstIp": "172.16.2.102",
                            "dstHost": "WEB",
                            "dstPort": 445,
                            "tsEpochMs": 1500,
                        },
                    ],
                }
            ]
        )

        self.assertEqual(2, len(projected))
        pc = next(row for row in projected if row["destination_host"] == "PC")
        self.assertEqual(2, pc["occurrence_count"])
        self.assertEqual(1000, pc["first_seen_epoch_ms"])
        self.assertEqual(2000, pc["last_seen_epoch_ms"])
        self.assertEqual(3, stats["input_count"])
        self.assertEqual(2, stats["unique_count"])

if __name__ == "__main__":
    unittest.main()
