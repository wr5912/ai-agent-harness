from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1] / "dsh/managed/threat-analysis"
sys.path.insert(0, str(ROOT))

from mcp_gateway import McpCatalog  # noqa: E402
from model_inference import extract_json_output  # noqa: E402
from result_storage import SocJudgementClient, SocWriteError  # noqa: E402
import dsh_runner  # noqa: E402


class ThreatAnalysisAutomationTest(unittest.TestCase):
    def test_catalog_contains_current_pending_tool(self) -> None:
        catalog = McpCatalog.from_directory(ROOT / "catalog")
        tool = catalog.tools[
            "ai_soc_correlate__get_correlate_incident_judge_pending"
        ]
        self.assertEqual(
            catalog.resources["ai_soc_correlate"]["id"], tool["resource_id"]
        )

    def test_pending_uses_first_page_and_bounded_page_size(self) -> None:
        client = SocJudgementClient.__new__(SocJudgementClient)
        expected = {"rows": [{"incidentId": "INC-20261010-000001"}], "total": 1}
        with patch.object(client, "invoke", return_value=expected) as invoke:
            self.assertEqual(expected, client.pending(100))
        invoke.assert_called_once_with(
            "pending", {"pageNum": 1, "pageSize": 100, "previewPriority": False}
        )
        for invalid in (True, 0, 101):
            with self.assertRaises(ValueError):
                client.pending(invalid)

    def test_claim_conflict_preserves_409_for_batch_skip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = SocJudgementClient(
                {"url": "http://soc.invalid", "catalogDir": str(ROOT / "catalog")},
                directory,
            )
            response = {
                "status": "error",
                "status_code": 409,
                "result": {"code": "409", "msg": "claim conflict"},
            }
            with patch("result_storage._default_transport", return_value=response):
                with self.assertRaises(SocWriteError) as raised:
                    client.claim("INC-20261010-000001")
        self.assertEqual("409", raised.exception.code)

    def test_soc_write_retries_once_with_same_judgement_and_body(self) -> None:
        client = SocJudgementClient.__new__(SocJudgementClient)
        body = {"runId": "run-test"}
        with patch.object(
            client, "invoke", side_effect=[TimeoutError(), {"replayed": True}]
        ) as invoke:
            state = client.write("result", "judgement-test", body)

        self.assertEqual("saved", state["status"])
        self.assertEqual(2, state["attempts"])
        self.assertTrue(state["replayed"])
        self.assertEqual(
            [
                unittest.mock.call(
                    "result", {"judgementId": "judgement-test", "body": body}
                ),
                unittest.mock.call(
                    "result", {"judgementId": "judgement-test", "body": body}
                ),
            ],
            invoke.call_args_list,
        )

    def test_model_output_accepts_only_raw_json_or_complete_json_fence(self) -> None:
        def response(content: str) -> dict:
            return {"choices": [{"message": {"content": content}}]}

        expected = {"verdict": "可疑"}
        raw = json.dumps(expected, ensure_ascii=False)
        self.assertEqual(expected, extract_json_output(response(raw)))
        self.assertEqual(
            expected, extract_json_output(response(f"```json\n{raw}\n```"))
        )
        for invalid in (f"说明\n```json\n{raw}\n```", f"```JSON\n{raw}\n```"):
            with self.assertRaises(json.JSONDecodeError):
                extract_json_output(response(invalid))

    @unittest.skipUnless(hasattr(dsh_runner.signal, "SIGALRM"), "requires SIGALRM")
    def test_analysis_deadline_still_writes_soc_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            client = MagicMock()
            client.claim.return_value = {"judgementId": "judgement-test"}
            client.write.return_value = {"status": "saved"}
            with (
                patch.object(dsh_runner, "ANALYSIS_TIMEOUT_SECONDS", 1),
                patch.object(dsh_runner, "SocJudgementClient", return_value=client),
                patch.object(dsh_runner.evidence_collection, "parse_args", return_value=object()),
                patch.object(dsh_runner.evidence_collection, "run", side_effect=lambda _args: time.sleep(2)),
            ):
                result = dsh_runner.analyze(
                    "INC-20261010-000001",
                    directory,
                    {"connections": {"soc": {
                        "url": "http://soc.invalid", "catalogDir": str(ROOT / "catalog")
                    }}},
                )

        self.assertEqual("evidence_failed", result["status"])
        self.assertEqual("TimeoutError", result["error_type"])
        self.assertEqual("saved", result["delivery"]["storage"]["summary"]["status"])
        self.assertEqual("fail", client.write.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
