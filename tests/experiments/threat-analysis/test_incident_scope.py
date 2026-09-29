from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from incident_scope import (  # noqa: E402
    aggregate_repeated_behaviors,
    attach_entity_refs,
    build_forward_slices,
    build_process_neighborhood,
    canonicalize_entities,
    deduplicate_records,
    derive_effective_time_range,
    expand_related_entities,
    extract_incident_entities,
    select_records,
)


class IncidentEntityScopeTest(unittest.TestCase):
    def test_extracts_all_explicit_incident_entities_without_using_alert_order(self) -> None:
        incident = {
            "affectedAssetId": 1001,
            "sourceIp": "192.0.2.10",
            "account": "EXAMPLE\\alice",
            "entitiesJson": (
                '[{"type":"ASSET","assetId":1002,"tier":"AUTH"},'
                '{"type":"IP","ip":"192.0.2.20","tier":"OBSERVED"}]'
            ),
        }

        entities = extract_incident_entities(incident)

        self.assertEqual(
            {
                ("asset", "1001"),
                ("asset", "1002"),
                ("ip", "192.0.2.10"),
                ("ip", "192.0.2.20"),
                ("user", "EXAMPLE\\alice"),
            },
            {(row["entity_type"], row["value"]) for row in entities},
        )

    def test_effective_time_uses_contributing_alert_business_times(self) -> None:
        incident = {
            "firstSeenTime": "2026-09-10T01:00:00Z",
            "lastSeenTime": "2026-09-10T05:00:00Z",
        }
        records = [
            {"event_time": "2026-09-10T03:00:00Z"},
            {"event_time": "2026-09-10T02:00:00Z"},
            {"event_time": None},
        ]

        self.assertEqual(
            ["2026-09-10T02:00:00Z", "2026-09-10T03:00:00Z"],
            derive_effective_time_range(incident, records),
        )

    def test_effective_time_falls_back_to_incident_range(self) -> None:
        incident = {
            "firstSeenTime": "2026-09-10 01:00:00",
            "lastSeenTime": "2026-09-10 05:00:00",
        }

        self.assertEqual(
            ["2026-09-10T01:00:00Z", "2026-09-10T05:00:00Z"],
            derive_effective_time_range(incident, []),
        )

    def test_asset_id_is_primary_and_unique_ip_is_timed_alias(self) -> None:
        candidates = [
            {"entity_type": "asset", "value": "1001", "provenance": "incident.entitiesJson"},
            {"entity_type": "ip", "value": "192.0.2.10", "provenance": "incident.sourceIp"},
        ]
        assets = [
            {
                "assetId": 1001,
                "ip": "192.0.2.10",
                "hostname": "host-a",
            }
        ]

        entities, index, audit = canonicalize_entities(
            candidates,
            assets,
            ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
        )

        self.assertEqual(1, len(entities))
        self.assertEqual("E1", entities[0]["entity_ref"])
        self.assertEqual("1001", entities[0]["asset_id"])
        self.assertEqual("E1", index["ip:192.0.2.10"])
        self.assertEqual("E1", index["hostname:host-a"])
        self.assertEqual([], audit["conflicts"])

    def test_conflicting_ip_mapping_is_not_merged(self) -> None:
        candidates = [
            {"entity_type": "asset", "value": "1001", "provenance": "incident.entitiesJson"},
            {"entity_type": "asset", "value": "1002", "provenance": "incident.entitiesJson"},
            {"entity_type": "ip", "value": "192.0.2.10", "provenance": "incident.entitiesJson"},
        ]
        assets = [
            {"assetId": 1001, "ip": "192.0.2.10"},
            {"assetId": 1002, "ip": "192.0.2.10"},
        ]

        entities, index, audit = canonicalize_entities(
            candidates,
            assets,
            ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
        )

        self.assertEqual(3, len(entities))
        self.assertNotIn("ip:192.0.2.10", index)
        self.assertEqual("ip:192.0.2.10", audit["conflicts"][0]["key"])

    def test_single_anchor_endpoint_becomes_entity_local_owner(self) -> None:
        records = [
            {
                "source_ip": "198.51.100.20",
                "destination_ip": "192.0.2.10",
            }
        ]
        index = {
            "ip:192.0.2.10": "E1",
            "ip:198.51.100.20": "E2",
        }

        attached = attach_entity_refs(records, index, owner_refs={"E1"})

        self.assertEqual("E1", attached[0]["entity_ref"])
        self.assertEqual(["E1", "E2"], attached[0]["entity_refs"])

    def test_alert_only_entity_expands_once_only_by_explicit_anchor_relation(self) -> None:
        entities = [
            {
                "entity_ref": "E1",
                "entity_type": "ip",
                "role": "anchor",
                "value": "192.0.2.10",
                "aliases": [],
            }
        ]
        index = {"ip:192.0.2.10": "E1"}
        records = [
            {"source_ip": "192.0.2.10", "destination_ip": "192.0.2.20"},
            {"source_ip": "192.0.2.20", "destination_ip": "192.0.2.30"},
        ]

        expanded, expanded_index, audit = expand_related_entities(
            entities,
            index,
            records,
            ["2026-09-10T01:00:00Z", "2026-09-10T02:00:00Z"],
        )
        attached = attach_entity_refs(records, expanded_index)

        self.assertEqual(2, len(expanded))
        self.assertEqual("related", expanded[1]["role"])
        self.assertEqual("192.0.2.20", expanded[1]["value"])
        self.assertNotIn("ip:192.0.2.30", expanded_index)
        self.assertEqual(["E1", "E2"], attached[0]["entity_refs"])
        self.assertEqual(["E2"], attached[1]["entity_refs"])
        self.assertEqual(1, audit["related_entity_count"])


class DeterministicFusionTest(unittest.TestCase):
    def test_dedup_prefers_raw_identity_and_merges_alert_and_rule_ids(self) -> None:
        rows = [
            {
                "source": "EDR",
                "affected_asset_id": "1001",
                "raw_event_uid": "raw-1",
                "alert_id": "A-1",
                "rule_id": "R-1",
                "event_time": "2026-09-10T01:00:00Z",
            },
            {
                "source": "EDR",
                "affected_asset_id": "1001",
                "raw_event_uid": "raw-1",
                "alert_id": "A-2",
                "rule_id": "R-2",
                "event_time": "2026-09-10T01:00:00Z",
            },
        ]

        deduped, audit = deduplicate_records(rows)

        self.assertEqual(1, len(deduped))
        self.assertEqual(["A-1", "A-2"], deduped[0]["alert_ids"])
        self.assertEqual(["R-1", "R-2"], deduped[0]["rule_ids"])
        self.assertEqual(1, audit["duplicate_count"])

    def test_process_guid_neighborhood_expands_two_hops_but_not_three(self) -> None:
        rows = [
            {"record_key": "r0", "entity_ref": "E1", "process": {"uid": "P0"}},
            {
                "record_key": "r1",
                "entity_ref": "E1",
                "process": {"uid": "P1", "parent": {"uid": "P0"}},
            },
            {
                "record_key": "r2",
                "entity_ref": "E1",
                "process": {"uid": "P2", "parent": {"uid": "P1"}},
            },
            {
                "record_key": "r3",
                "entity_ref": "E1",
                "process": {"uid": "P3", "parent": {"uid": "P2"}},
            },
        ]

        linked = build_process_neighborhood(rows, seed_record_keys={"r0"}, max_hops=2)

        self.assertEqual({"r0", "r1", "r2"}, linked)

    def test_pid_fallback_requires_same_entity_and_parent_lifecycle(self) -> None:
        rows = [
            {
                "record_key": "parent",
                "entity_ref": "E1",
                "event_time": "2026-09-10T01:00:00Z",
                "process": {"pid": 10, "end_time": "2026-09-10T01:10:00Z"},
            },
            {
                "record_key": "valid-child",
                "entity_ref": "E1",
                "event_time": "2026-09-10T01:05:00Z",
                "process": {"pid": 11, "parent": {"pid": 10}},
            },
            {
                "record_key": "other-host-child",
                "entity_ref": "E2",
                "event_time": "2026-09-10T01:05:00Z",
                "process": {"pid": 12, "parent": {"pid": 10}},
            },
            {
                "record_key": "late-child",
                "entity_ref": "E1",
                "event_time": "2026-09-10T01:20:00Z",
                "process": {"pid": 13, "parent": {"pid": 10}},
            },
        ]

        linked = build_process_neighborhood(
            rows, seed_record_keys={"parent"}, max_hops=1
        )

        self.assertEqual({"parent", "valid-child"}, linked)

    def test_selection_uses_relation_strength_then_cuts_tail(self) -> None:
        rows = [
            {
                "record_key": "late-cross",
                "event_time": "2026-09-10T01:04:00Z",
                "entity_refs": ["E1", "E2"],
            },
            {
                "record_key": "early-single",
                "event_time": "2026-09-10T01:00:00Z",
                "entity_refs": ["E1"],
            },
            {
                "record_key": "middle-process",
                "event_time": "2026-09-10T01:02:00Z",
                "entity_refs": ["E1"],
            },
            {
                "record_key": "unlinked",
                "event_time": "2026-09-10T01:01:00Z",
                "entity_refs": [],
            },
        ]

        selected, audit = select_records(
            rows,
            anchor_refs={"E1", "E2"},
            process_linked_keys={"middle-process"},
            budget=2,
        )

        self.assertEqual(
            {"middle-process", "late-cross"},
            {row["record_key"] for row in selected},
        )
        self.assertEqual("2026-09-10T01:04:00Z", audit["cutoff_time"])
        self.assertEqual(2, audit["dropped_count"])

    def test_repeated_behaviors_are_aggregated_after_exact_dedup(self) -> None:
        rows = [
            {
                "record_key": "r1",
                "entity_ref": "E1",
                "event_time": "2026-09-10T01:00:00Z",
                "alert_type": "process_start",
                "process": {"path": "C:\\Windows\\System32\\whoami.exe", "cmdline": "whoami"},
                "destination_ip": "192.0.2.20",
            },
            {
                "record_key": "r2",
                "entity_ref": "E1",
                "event_time": "2026-09-10T01:01:00Z",
                "alert_type": "process_start",
                "process": {"path": "C:\\Windows\\System32\\whoami.exe", "cmdline": "whoami"},
                "destination_ip": "192.0.2.30",
            },
        ]

        aggregated = aggregate_repeated_behaviors(rows)

        self.assertEqual(1, len(aggregated))
        self.assertEqual(2, aggregated[0]["count"])
        self.assertEqual(
            ["192.0.2.20", "192.0.2.30"], aggregated[0]["distinct_targets"]
        )

    def test_forward_slices_cover_range_without_tail_first_sampling(self) -> None:
        slices = build_forward_slices(
            "2026-09-10T00:00:00Z",
            "2026-09-10T04:00:00Z",
            max_slices=4,
        )

        self.assertEqual("2026-09-10T00:00:00Z", slices[0][0])
        self.assertEqual("2026-09-10T04:00:00Z", slices[-1][1])
        self.assertEqual(slices, sorted(slices))


if __name__ == "__main__":
    unittest.main()
