from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from fusion_contract import CallOutcome  # noqa: E402
from mcp_gateway import (  # noqa: E402
    McpCatalog,
    McpGateway,
    classify_response,
    extract_result_data,
)


class ResponseClassificationTest(unittest.TestCase):
    def test_list_data_with_rows_is_success_with_data(self) -> None:
        response = {
            "status": "success",
            "status_code": 200,
            "result": {"code": 200, "data": [{"id": 1}]},
        }
        self.assertEqual(CallOutcome.SUCCESS_WITH_DATA, classify_response(response))
        self.assertEqual([{"id": 1}], extract_result_data(response))

    def test_empty_items_is_success_empty(self) -> None:
        response = {
            "status": "success",
            "status_code": 200,
            "result": {"code": 200, "data": {"items": [], "total": 0}},
        }
        self.assertEqual(CallOutcome.SUCCESS_EMPTY, classify_response(response))

    def test_event_search_with_zero_total_is_success_empty(self) -> None:
        response = {
            "status": "success",
            "status_code": 200,
            "result": {
                "code": 200,
                "data": {"total": 0, "hits": [], "took": 8},
            },
        }
        self.assertEqual(CallOutcome.SUCCESS_EMPTY, classify_response(response))

    def test_event_count_with_positive_total_is_success_with_data(self) -> None:
        response = {
            "status": "success",
            "status_code": 200,
            "result": {"code": 200, "data": {"total": 3, "took": 8}},
        }
        self.assertEqual(CallOutcome.SUCCESS_WITH_DATA, classify_response(response))

    def test_gateway_error_is_failed(self) -> None:
        response = {"status": "error", "status_code": 500, "result": None}
        self.assertEqual(CallOutcome.FAILED, classify_response(response))

    def test_truncated_transport_envelope_is_not_usable_evidence(self) -> None:
        response = {
            "status": "success",
            "status_code": 200,
            "result": {
                "_truncated": True,
                "_original_bytes": 1_397_678,
                "_preview": '{"data":{"total":557,"hits":[{"_id":"must-not-parse"}]}}',
            },
        }

        self.assertEqual(CallOutcome.TRUNCATED, classify_response(response))


class McpGatewayTest(unittest.TestCase):
    def setUp(self) -> None:
        self.resources = {
            "items": [{"id": "resource-1", "slug": "ai_soc_correlate"}]
        }
        self.tools = {
            "ai_soc_correlate__get_correlate_incident_by_incident_id": {
                "name": "ai_soc_correlate__get_correlate_incident_by_incident_id",
                "resource_id": "resource-1",
                "http_method": "GET",
                "schema_json": {"parameters": {"required": ["incidentId"]}},
            },
            "ai_soc_correlate__delete_incident": {
                "name": "ai_soc_correlate__delete_incident",
                "resource_id": "resource-1",
                "http_method": "DELETE",
                "schema_json": {"parameters": {"required": ["incidentId"]}},
            },
        }

    def test_invoke_validates_required_args_and_writes_raw_response(self) -> None:
        catalog = McpCatalog.from_documents(self.resources, [self.tools])
        seen = {}

        def transport(endpoint, payload, timeout):
            seen.update(endpoint=endpoint, payload=payload, timeout=timeout)
            return {
                "status": "success",
                "status_code": 200,
                "result": {"code": 200, "data": {"incidentId": "INC-1"}},
            }

        with tempfile.TemporaryDirectory() as directory:
            gateway = McpGateway(
                base_url="http://mcp.invalid",
                catalog=catalog,
                raw_directory=Path(directory),
                transport=transport,
            )
            result = gateway.invoke(
                call_id="C001",
                resource="ai_soc_correlate",
                tool_name="ai_soc_correlate__get_correlate_incident_by_incident_id",
                arguments={"incidentId": "INC-1"},
            )
            self.assertEqual(CallOutcome.SUCCESS_WITH_DATA, result.outcome)
            self.assertEqual(1, result.result_count)
            self.assertEqual({"arguments": {"incidentId": "INC-1"}}, seen["payload"])
            saved = json.loads((Path(directory) / "C001.json").read_text())
            self.assertEqual("success", saved["status"])

    def test_missing_required_argument_is_rejected_before_transport(self) -> None:
        catalog = McpCatalog.from_documents(self.resources, [self.tools])
        with tempfile.TemporaryDirectory() as directory:
            gateway = McpGateway(
                base_url="http://mcp.invalid",
                catalog=catalog,
                raw_directory=Path(directory),
                transport=lambda *_: self.fail("transport must not run"),
            )
            with self.assertRaises(ValueError):
                gateway.invoke(
                    call_id="C001",
                    resource="ai_soc_correlate",
                    tool_name="ai_soc_correlate__get_correlate_incident_by_incident_id",
                    arguments={},
                )

    def test_mutating_tool_is_rejected(self) -> None:
        catalog = McpCatalog.from_documents(self.resources, [self.tools])
        with tempfile.TemporaryDirectory() as directory:
            gateway = McpGateway(
                base_url="http://mcp.invalid",
                catalog=catalog,
                raw_directory=Path(directory),
                transport=lambda *_: self.fail("transport must not run"),
            )
            with self.assertRaises(PermissionError):
                gateway.invoke(
                    call_id="C001",
                    resource="ai_soc_correlate",
                    tool_name="ai_soc_correlate__delete_incident",
                    arguments={"incidentId": "INC-1"},
                )


if __name__ == "__main__":
    unittest.main()
