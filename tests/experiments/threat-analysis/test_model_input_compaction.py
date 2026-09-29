from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from model_input_compaction import compact_five_source_output  # noqa: E402


class ModelInputCompactionTest(unittest.TestCase):
    def test_builds_minimal_entity_index_and_process_reference_edr_projection(self) -> None:
        payload = {
            "event_snapshot": {
                "entities": [
                    {
                        "entity_ref": "E1",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "1001",
                        "aliases": [
                            {"type": "ip", "value": "192.0.2.10"},
                            {"type": "hostname", "value": "host-a"},
                        ],
                    },
                    {
                        "entity_ref": "E2",
                        "entity_type": "ip",
                        "role": "related",
                        "value": "192.0.2.20",
                    },
                ]
            },
            "enriched_context": {
                "graph": {
                    "related_hosts": [
                        {
                            "relation": "observed_network_endpoint_pair",
                            "relation_source": "event",
                            "source_ip": "192.0.2.10",
                            "destination_ip": "192.0.2.20",
                            "destination_ports": [445],
                            "entity_refs": ["E1", "E2"],
                            "observation_count": 3,
                        },
                        {
                            "relation": "observed_topology_neighbor",
                            "relation_source": "topology",
                            "entity_ref": "E1",
                            "asset_id": "2002",
                            "hostname": "host-b",
                            "ip": "192.0.2.30",
                            "direction": "outbound",
                            "edge_type": "flow",
                            "hit_count": 9,
                            "last_seen": "2026-09-10T01:00:00Z",
                        },
                    ],
                    "related_users": [
                        {
                            "entity_ref": "E1",
                            "name": "alice",
                            "privilege": "admin",
                            "role": "admin_of",
                            "sid": "S-1-5-21-1",
                            "lastSeen": 1,
                        }
                    ],
                    "path_hints": [
                        {
                            "relation": "parent_child_process",
                            "entity_ref": "E1",
                            "parent_process_uid": "P1",
                            "child_process_uid": "P2",
                        }
                    ],
                },
                "edr_detail": {
                    "entities": [
                        {
                            "entity_ref": "E1",
                            "activity_segments": [
                                {
                                    "segment_id": "E1-SEG-001",
                                    "scope": "anchor_entity",
                                    "time_range": [
                                        "2026-09-10T01:00:00Z",
                                        "2026-09-10T01:01:00Z",
                                    ],
                                    "process_activities": [
                                        {
                                            "image": "C:/Windows/cmd.exe",
                                            "cmdline": "cmd /c whoami",
                                            "user": "alice",
                                            "parent": {
                                                "image": "C:/Windows/explorer.exe",
                                                "process_uid": "P1",
                                                "pid": 100,
                                            },
                                            "process_uids": ["P2"],
                                            "pid": 200,
                                            "event_type": "Launch",
                                            "sources": ["Sysmon"],
                                            "alert_ids": ["event:r1"],
                                            "rule_ids": ["R1"],
                                            "sample_record_ids": ["r1"],
                                            "count": 3,
                                            "first_seen": "2026-09-10T01:00:00Z",
                                            "last_seen": "2026-09-10T01:01:00Z",
                                            "alert_id_count": 3,
                                            "rule_id_count": 1,
                                        }
                                    ],
                                    "network_details": [
                                        {
                                            "source_ip": "192.0.2.10",
                                            "destination_ip": "192.0.2.20",
                                            "destination_port": 445,
                                            "protocol": "tcp",
                                            "process_uid": "P2",
                                            "process_image": "C:/Windows/cmd.exe",
                                            "sources": ["Sysmon"],
                                            "alert_ids": ["A1"],
                                            "rule_ids": ["R1"],
                                            "first_seen": "2026-09-10T01:00:00Z",
                                            "last_seen": "2026-09-10T01:01:00Z",
                                        }
                                    ],
                                    "file_operations": [
                                        {
                                            "path": "C:/Temp/result.txt",
                                            "operation": "create",
                                            "process_uid": "P2",
                                            "process_image": "C:/Windows/cmd.exe",
                                            "sources": ["Sysmon"],
                                            "alert_ids": ["A1"],
                                            "rule_ids": ["R1"],
                                            "sample_record_ids": ["r1"],
                                            "count": 1,
                                            "first_seen": "2026-09-10T01:00:30Z",
                                            "last_seen": "2026-09-10T01:00:30Z",
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                },
            },
        }

        compacted = compact_five_source_output(payload)
        graph = compacted["enriched_context"]["graph"]
        snapshot = compacted["event_snapshot"]
        segment = compacted["enriched_context"]["edr_detail"]["entities"][0][
            "activity_segments"
        ][0]
        parent, process = segment["processes"]

        self.assertEqual(
            [
                {
                    "entity_ref": "E1",
                    "entity_display": "host-a（192.0.2.10，资产ID 1001）",
                    "entity_type": "asset",
                    "role": "anchor",
                    "asset_id": "1001",
                    "ip": "192.0.2.10",
                    "hostname": "host-a",
                },
                {
                    "entity_ref": "E2",
                    "entity_display": "192.0.2.20",
                    "entity_type": "ip",
                    "role": "related",
                    "ip": "192.0.2.20",
                },
            ],
            snapshot["entities"],
        )
        self.assertEqual(
            "host-a（192.0.2.10，资产ID 1001）",
            compacted["enriched_context"]["edr_detail"]["entities"][0][
                "entity_display"
            ],
        )

        self.assertEqual(
            [
                {
                    "entity_ref": "E1",
                    "asset_id": "2002",
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
                    "entity_ref": "E1",
                    "name": "alice",
                    "privilege": "admin",
                    "role": "admin_of",
                }
            ],
            graph["related_users"],
        )
        self.assertEqual("E1", graph["path_hints"][0]["src_ref"])
        self.assertEqual("host-a", graph["path_hints"][0]["src_host"])
        self.assertEqual("E2", graph["path_hints"][0]["dst_ref"])
        self.assertEqual(["tcp"], graph["path_hints"][0]["protocols"])
        self.assertEqual(
            ["2026-09-10T01:00:00Z", "2026-09-10T01:01:00Z"],
            graph["path_hints"][0]["time_range"],
        )
        self.assertEqual({"ref": "P001", "image": "C:/Windows/explorer.exe"}, parent)
        self.assertEqual("P002", process["ref"])
        self.assertEqual("P001", process["parent_ref"])
        self.assertEqual("Launch", process["action"])
        self.assertEqual(3, process["count"])
        self.assertEqual(
            ["2026-09-10T01:00:00Z", "2026-09-10T01:01:00Z"],
            process["time_range"],
        )
        self.assertEqual("alice", segment["default_user"])
        self.assertEqual(["Sysmon"], segment["source_types"])
        self.assertNotIn("rule_ids", segment)
        self.assertNotIn("user", process)
        self.assertNotIn("parent", process)
        self.assertNotIn("process_activities", segment)
        self.assertNotIn("alert_ids", process)
        self.assertNotIn("pid", process)
        self.assertEqual("P002", segment["file_operations"][0]["process_ref"])
        self.assertNotIn("process_uid", segment["file_operations"][0])
        self.assertNotIn("process_image", segment["file_operations"][0])
        self.assertEqual("P002", segment["network_details"][0]["process_ref"])
        self.assertNotIn("source_ip", segment["network_details"][0])

    def test_does_not_fabricate_process_reference_for_ambiguous_image(self) -> None:
        payload = {
            "event_snapshot": {
                "entities": [
                    {
                        "entity_ref": "E1",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "1001",
                        "aliases": [{"type": "ip", "value": "192.0.2.10"}],
                    }
                ]
            },
            "enriched_context": {
                "graph": {"related_hosts": [], "related_users": [], "path_hints": []},
                "edr_detail": {
                    "entities": [
                        {
                            "entity_ref": "E1",
                            "activity_segments": [
                                {
                                    "segment_id": "S1",
                                    "process_activities": [
                                        {"image": "powershell.exe", "cmdline": "powershell one"},
                                        {"image": "powershell.exe", "cmdline": "powershell two"},
                                    ],
                                    "network_details": [
                                        {
                                            "process_image": "powershell.exe",
                                            "destination_ip": "198.51.100.10",
                                            "destination_port": 443,
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                },
            },
        }

        compacted = compact_five_source_output(payload)
        network = compacted["enriched_context"]["edr_detail"]["entities"][0][
            "activity_segments"
        ][0]["network_details"][0]

        self.assertNotIn("process_ref", network)
        self.assertEqual("powershell.exe", network["process_image"])

    def test_compaction_is_idempotent(self) -> None:
        payload = {
            "event_snapshot": {"entities": []},
            "enriched_context": {
                "graph": {
                    "related_hosts": [],
                    "related_users": [],
                    "path_hints": [
                        {
                            "src_ip": "192.0.2.10",
                            "dst_ip": "192.0.2.20",
                            "count": 1,
                            "basis": "event",
                        }
                    ],
                },
                "edr_detail": {"entities": []},
            },
        }

        once = compact_five_source_output(payload)
        twice = compact_five_source_output(once)

        self.assertEqual(once, twice)

    def test_drops_network_path_between_aliases_of_same_canonical_asset(self) -> None:
        payload = {
            "event_snapshot": {
                "entities": [
                    {
                        "entity_ref": "E1",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "3617508",
                        "aliases": [
                            {"type": "ip", "value": "172.16.2.112"},
                            {"type": "hostname", "value": "DESKTOP-SG287IU"},
                        ],
                    }
                ]
            },
            "enriched_context": {
                "graph": {
                    "related_hosts": [],
                    "related_users": [],
                    "path_hints": [
                        {
                            "src_ref": "E1",
                            "src_asset_id": "3617508",
                            "src_ip": "172.16.2.112",
                            "dst_ref": "E1",
                            "dst_ip": "172.16.2.112",
                            "basis": "event",
                        }
                    ],
                },
                "edr_detail": {"entities": []},
            },
        }

        compacted = compact_five_source_output(payload)

        self.assertEqual([], compacted["enriched_context"]["graph"]["path_hints"])

    def test_entity_display_never_falls_back_to_internal_reference(self) -> None:
        payload = {
            "event_snapshot": {
                "entities": [
                    {
                        "entity_ref": "E7",
                        "entity_type": "user",
                        "role": "related",
                        "value": "ACME\\alice",
                    },
                    {
                        "entity_ref": "E8",
                        "entity_type": "asset",
                        "role": "anchor",
                        "asset_id": "2002",
                    },
                    {
                        "entity_ref": "E9",
                        "entity_type": "unknown",
                        "role": "related",
                    },
                ]
            },
            "enriched_context": {
                "graph": {"related_hosts": [], "related_users": [], "path_hints": []},
                "edr_detail": {"entities": []},
            },
        }

        compacted = compact_five_source_output(payload)
        displays = [
            row.get("entity_display")
            for row in compacted["event_snapshot"]["entities"]
        ]

        self.assertEqual("ACME\\alice", displays[0])
        self.assertEqual("资产ID 2002", displays[1])
        self.assertIsNone(displays[2])
        self.assertNotIn("E7", displays)
        self.assertNotIn("E8", displays)
        self.assertNotIn("E9", displays)


if __name__ == "__main__":
    unittest.main()
