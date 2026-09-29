from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from fusion_pipeline import (  # noqa: E402
    extract_alert_ids,
    normalize_alert,
    normalize_event_hit,
    parse_datetime_utc,
)


def detailed_alert(
    *,
    alert_id: str,
    raw_id: int,
    rule_id: str,
    created_at: str,
    source_ip: str = "172.16.1.155",
    destination_ip: str = "172.16.1.100",
    destination_port: int = 7001,
) -> dict:
    return {
        "alert_id": alert_id,
        "source": "WAF",
        "severity": "HIGH",
        "alert_type": "CMD_INJECTION",
        "rule_id": rule_id,
        "source_ip": source_ip,
        "destination_ip": destination_ip,
        "affected_asset_id": "3617351",
        "created_at": created_at,
        "ocsf": {
            "unmapped": {"safeline": {"action": 0, "disposition": "Allowed"}},
            "evidences": [
                {
                    "dst_endpoint": {
                        "ip": destination_ip,
                        "port": destination_port,
                    },
                    "data": {"url_path": "/command/vul1?payload=whoami"},
                }
            ],
        },
        "triggering_event": {
            "raw": {
                "id": raw_id,
                "event_id": alert_id,
                "timestamp": created_at,
                "rule_id": rule_id,
            }
        },
    }


class IncidentAlertExtractionTest(unittest.TestCase):
    def test_extracts_unique_alert_ids_from_json_text(self) -> None:
        incident = {
            "contributingAlertsJson": '[{"alertId":"a2"},{"alertId":"a1"},{"alertId":"a2"}]'
        }
        self.assertEqual(["a2", "a1"], extract_alert_ids(incident))


class AlertNormalizationTest(unittest.TestCase):
    def test_parses_nanosecond_business_time_as_utc_microseconds(self) -> None:
        parsed = parse_datetime_utc("2026-08-19T03:07:01.551179600Z")

        self.assertIsNotNone(parsed)
        self.assertEqual(
            "2026-08-19T03:07:01.551179+00:00",
            parsed.isoformat(),
        )

    def test_parses_timezone_offset_without_colon(self) -> None:
        parsed = parse_datetime_utc("2026-09-18T05:15:05.274+0800")

        self.assertIsNotNone(parsed)
        self.assertEqual(
            "2026-09-17T21:15:05.274000+00:00",
            parsed.isoformat(),
        )

    def test_normalizes_stable_original_record_and_network_fields(self) -> None:
        normalized = normalize_alert(
            detailed_alert(
                alert_id="a1",
                raw_id=166851,
                rule_id="m_cmd_injection",
                created_at="2026-09-10T08:33:15Z",
            )
        )
        self.assertEqual("WAF:3617351:166851", normalized["raw_event_key"])
        self.assertEqual(7001, normalized["destination_port"])
        self.assertEqual("Allowed", normalized["disposition"])
        self.assertEqual(
            "/command/vul1?payload=whoami", normalized["request_path"]
        )

    def test_preserves_only_explicit_stable_relation_and_native_result_fields(self) -> None:
        alert = detailed_alert(
            alert_id="a1",
            raw_id=166851,
            rule_id="rule-a",
            created_at="2026-09-10T08:33:15Z",
        )
        alert["ocsf"]["connection_info"] = {"uid": "flow-001"}
        alert["ocsf"]["evidences"][0]["data"].update(
            {"authentication_session_id": "logon-001", "result": "success"}
        )

        normalized = normalize_alert(alert)

        self.assertEqual("166851", normalized["source_record_id"])
        self.assertEqual("flow-001", normalized["network_session_id"])
        self.assertEqual("logon-001", normalized["authentication_session_id"])
        self.assertEqual("success", normalized["native_result"])

    def test_absent_relation_fields_remain_none(self) -> None:
        normalized = normalize_alert(
            detailed_alert(
                alert_id="a1",
                raw_id=166851,
                rule_id="rule-a",
                created_at="2026-09-10T08:33:15Z",
            )
        )
        self.assertIsNone(normalized["network_session_id"])
        self.assertIsNone(normalized["authentication_session_id"])
        self.assertIsNone(normalized["native_result"])

    def test_extracts_endpoint_process_and_business_time_from_embedded_raw_data(self) -> None:
        alert = {
            "alert_id": "alrt-endpoint-1",
            "source": "detect",
            "rule_id": "builtin-host-001",
            "created_at": "2026-08-19T08:04:00Z",
            "affected_asset_id": "3617353",
            "triggering_event_id": "raw-event-17",
            "ocsf": {
                "device": {
                    "hostname": "PC",
                    "ip": "172.16.2.103",
                    "asset": {"uid": "3617353"},
                },
                "raw_data": json.dumps(
                    {
                        "metadata": {"original_time": "2026-08-19T05:07:49Z"},
                        "data": {
                            "win": {
                                "eventdata": {
                                    "processGuid": "{PROCESS-GUID}",
                                    "processId": "1740",
                                    "image": "C:\\Windows\\System32\\cmd.exe",
                                    "commandLine": "cmd.exe /c whoami",
                                    "parentProcessGuid": "{PARENT-GUID}",
                                    "parentProcessId": "920",
                                    "parentImage": "C:\\Program Files\\agent.exe",
                                    "parentCommandLine": "agent.exe --service",
                                    "user": "LAB\\analyst",
                                }
                            }
                        },
                    }
                ),
                "evidences": [
                    {
                        "actor": {
                            "process": {
                                "uid": "{PROCESS-GUID}",
                                "pid": 1740,
                                "name": "cmd.exe",
                                "cmd_line": "cmd.exe /c whoami",
                                "parent_process": {
                                    "uid": "{PARENT-GUID}",
                                    "pid": 920,
                                    "name": "agent.exe",
                                    "cmd_line": "agent.exe --service",
                                },
                                "user": {"name": "LAB\\analyst"},
                            }
                        }
                    }
                ],
            },
        }

        normalized = normalize_alert(alert)

        self.assertEqual("2026-08-19T05:07:49Z", normalized["event_time"])
        self.assertEqual("detect:3617353:raw-event-17", normalized["raw_event_key"])
        self.assertEqual("cmd.exe /c whoami", normalized["process"]["cmdline"])
        self.assertEqual("agent.exe", normalized["process"]["parent"]["name"])
        self.assertEqual("LAB\\analyst", normalized["user"]["name"])
        self.assertEqual("PC", normalized["asset"]["hostname"])

    def test_namespaces_numeric_raw_ids_by_asset(self) -> None:
        first = normalize_alert(
            detailed_alert(
                alert_id="a1",
                raw_id=17,
                rule_id="rule-a",
                created_at="2026-09-10T08:33:15Z",
            )
        )
        second_alert = detailed_alert(
            alert_id="a2",
            raw_id=17,
            rule_id="rule-a",
            created_at="2026-09-10T08:33:15Z",
        )
        second_alert["affected_asset_id"] = "3617999"
        second_alert["ocsf"]["device"] = {"asset": {"uid": "3617999"}}
        second = normalize_alert(second_alert)

        self.assertNotEqual(first["raw_event_key"], second["raw_event_key"])

    def test_event_store_hit_uses_same_normalization_contract(self) -> None:
        normalized = normalize_event_hit(
            {
                "_id": "event-1",
                "_index": "endpoint-2026.08.19",
                "_source": {
                    "ocsf": {
                        "metadata": {"original_time": "2026-08-19T05:08:00Z"},
                        "device": {
                            "hostname": "PC",
                            "ip": "172.16.2.103",
                            "asset": {"uid": "3617353"},
                        },
                        "evidences": [
                            {
                                "actor": {
                                    "process": {
                                        "uid": "process-2",
                                        "name": "net.exe",
                                        "cmd_line": "net user",
                                    }
                                }
                            }
                        ],
                    }
                },
            }
        )

        self.assertEqual("endpoint-2026.08.19", normalized["source"])
        self.assertEqual(
            "endpoint-2026.08.19:3617353:event-1", normalized["raw_event_key"]
        )
        self.assertEqual("net user", normalized["process"]["cmdline"])


if __name__ == "__main__":
    unittest.main()
