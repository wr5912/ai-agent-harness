from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(ROOT))

from model_inference import (  # noqa: E402
    _default_transport,
    build_chat_request,
    extract_json_output,
    run_inference,
)


class ModelInferenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.five_source = {
            "unified_event_id": "INC-TEST-1",
            "event_snapshot": {
                "event_type": "HOST_COMPROMISE_REASONING",
                "time_range": ["2026-09-20T00:00:00Z", "2026-09-20T00:05:00Z"],
                "judgement_target": {
                    "claim_family": "entity_state",
                    "claim_type": "host_compromise",
                    "primary_entity": {"asset_id": "1"},
                    "peer_entities": [],
                    "anchor_rule": {"id": "900010"},
                    "target_source": "reasoning_chain",
                },
            },
            "enriched_context": {
                "graph": {},
                "edr_detail": {},
                "asset": {},
                "threat_intel": {},
                "history": {},
            },
            "data_completeness": 0.5,
        }

    def test_request_has_only_fixed_system_prompt_and_one_five_source_input(self) -> None:
        request = build_chat_request(
            system_prompt="FIXED SYSTEM PROMPT",
            five_source=self.five_source,
            model="deepseek-flash",
            temperature=0.1,
        )

        self.assertEqual("deepseek-flash", request["model"])
        self.assertEqual(0.1, request["temperature"])
        self.assertIs(False, request["stream"])
        self.assertEqual({"type": "json_object"}, request["response_format"])
        self.assertEqual(2, len(request["messages"]))
        self.assertEqual(
            {"role": "system", "content": "FIXED SYSTEM PROMPT"},
            request["messages"][0],
        )
        self.assertEqual("user", request["messages"][1]["role"])
        self.assertIn('"unified_event_id":"INC-TEST-1"', request["messages"][1]["content"])
        self.assertNotIn("通用方案验证结果", json.dumps(request, ensure_ascii=False))

    def test_extract_json_output_does_not_repair_markdown_or_invalid_json(self) -> None:
        valid = {
            "choices": [
                {"message": {"content": '{"verdict":"证据不足"}'}}
            ]
        }
        self.assertEqual(
            {"verdict": "证据不足"},
            extract_json_output(valid),
        )

        markdown = {
            "choices": [
                {"message": {"content": '```json\n{"verdict":"证据不足"}\n```'}}
            ]
        }
        with self.assertRaises(json.JSONDecodeError):
            extract_json_output(markdown)

    def test_default_transport_omits_authorization_header_in_no_auth_mode(self) -> None:
        captured_requests = []

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                return False

            def read(self) -> bytes:
                return b'{"choices":[]}'

        def fake_urlopen(request, timeout):
            captured_requests.append((request, timeout))
            return Response()

        with patch(
            "model_inference.urllib.request.urlopen",
            side_effect=fake_urlopen,
        ):
            _default_transport(
                "http://model.invalid/v1/chat/completions",
                {"model": "local-model"},
                None,
                30,
            )

        self.assertEqual(1, len(captured_requests))
        request, timeout = captured_requests[0]
        self.assertEqual(30, timeout)
        self.assertNotIn("Authorization", request.headers)

    def test_run_case_supports_explicit_no_auth_mode(self) -> None:
        forced_output = {
            "unified_event_id": "INC-TEST-1",
            "verdict": "误报",
            "primary_claim": {"type": "host_compromise", "result": "证据不足"},
            "secondary_findings": None,
            "confidence_score": 0.8,
            "attack_stage": None,
            "technique": None,
            "technique_name": None,
            "verified_facts": [],
            "key_claims": [],
            "counter_evidence": [],
            "uncertainty_notes": "没有可用于验证核心主张的事实。",
            "attack_chain_speculation": {
                "current_stage": None,
                "observed_path": [],
                "possible_next_steps": [],
                "supporting_evidence": [],
            },
            "rule_optimization_suggestions": [],
            "recommended_actions": [],
            "reasoning_summary": "未观察到最小攻击链或高度相似攻击行为。",
        }
        api_response = {
            "choices": [
                {"message": {"content": json.dumps(forced_output, ensure_ascii=False)}}
            ]
        }
        calls = []

        def transport(endpoint, payload, api_key, timeout):
            calls.append((endpoint, payload, api_key, timeout))
            return api_response

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            result = run_inference(
                five_source=self.five_source,
                system_prompt="FIXED SYSTEM PROMPT",
                base_url="http://model.invalid/v1",
                model="local-model",
                api_key=None,
                output_dir=output_dir,
                temperature=0.1,
                transport=transport,
            )

            self.assertEqual("INC-TEST-1", result["unified_event_id"])
            self.assertIsNone(calls[0][2])
            metadata = json.loads(
                (output_dir / "request-metadata.json").read_text(encoding="utf-8")
            )
            self.assertEqual("none", metadata["auth_mode"])
            self.assertEqual(0.1, metadata["temperature"])
            self.assertTrue((output_dir / "model-analysis-output.json").is_file())
            self.assertTrue((output_dir / "forced-analysis-output.json").is_file())

    def test_run_case_writes_reproducible_metadata_without_secret(self) -> None:
        forced_output = {
            "unified_event_id": "INC-TEST-1",
            "verdict": "误报",
            "primary_claim": {"type": "host_compromise", "result": "证据不足"},
            "secondary_findings": None,
            "confidence_score": 0.8,
            "attack_stage": None,
            "technique": None,
            "technique_name": None,
            "verified_facts": [],
            "key_claims": [],
            "counter_evidence": [],
            "uncertainty_notes": "没有可用于验证核心主张的事实。",
            "attack_chain_speculation": {
                "current_stage": None,
                "observed_path": [],
                "possible_next_steps": [],
                "supporting_evidence": [],
            },
            "rule_optimization_suggestions": [],
            "recommended_actions": [],
            "reasoning_summary": "未观察到最小攻击链或高度相似攻击行为。",
        }
        api_response = {
            "id": "response-1",
            "model": "deepseek-flash",
            "choices": [
                {"message": {"content": json.dumps(forced_output, ensure_ascii=False)}}
            ],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }
        secret = "unit-test-secret"
        calls: list[tuple[str, dict, str, int]] = []

        def transport(endpoint: str, payload: dict, api_key: str, timeout: int) -> dict:
            calls.append((endpoint, payload, api_key, timeout))
            return api_response

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            result = run_inference(
                five_source=self.five_source,
                system_prompt="FIXED SYSTEM PROMPT",
                base_url="https://example.invalid",
                model="deepseek-flash",
                api_key=secret,
                output_dir=output_dir,
                transport=transport,
            )

            self.assertEqual("INC-TEST-1", result["unified_event_id"])
            self.assertEqual(1, len(calls))
            self.assertEqual(
                "https://example.invalid/chat/completions", calls[0][0]
            )
            self.assertEqual(secret, calls[0][2])

            metadata = json.loads(
                (output_dir / "request-metadata.json").read_text(encoding="utf-8")
            )
            validation = json.loads(
                (output_dir / "validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual(64, len(metadata["input_sha256"]))
            self.assertEqual(64, len(metadata["system_prompt_sha256"]))
            self.assertEqual("deepseek-flash", metadata["model"])
            self.assertEqual("deepseek-flash", metadata["response_model"])
            self.assertIn("responded_at", metadata)
            self.assertEqual("passed", validation["status"])
            self.assertTrue((output_dir / "model-analysis-output.json").is_file())
            self.assertTrue((output_dir / "forced-analysis-output.json").is_file())

            serialized_artifacts = "".join(
                path.read_text(encoding="utf-8")
                for path in output_dir.iterdir()
                if path.is_file()
            )
            self.assertNotIn(secret, serialized_artifacts)

    def test_run_case_persists_non_blocking_evidence_value_warnings(self) -> None:
        self.five_source["enriched_context"]["asset"] = {"tags": ["server"]}
        forced_output = {
            "unified_event_id": "INC-TEST-1",
            "verdict": "误报",
            "primary_claim": {"type": "host_compromise", "result": "证据不足"},
            "secondary_findings": None,
            "confidence_score": 0.8,
            "attack_stage": None,
            "technique": None,
            "technique_name": None,
            "verified_facts": [],
            "key_claims": [
                {
                    "claim": "资产标签包含 server",
                    "result": "支持",
                    "evidence": [
                        {
                            "source": "asset",
                            "field": "tags",
                            "value": "server",
                        }
                    ],
                    "weight": 0.2,
                }
            ],
            "counter_evidence": [],
            "uncertainty_notes": (
                "五源数据完整度为 0.5，缺少端点与网络结果；"
                "补齐后可能改变当前误报结论。"
            ),
            "attack_chain_speculation": {
                "current_stage": None,
                "observed_path": [],
                "possible_next_steps": [],
                "supporting_evidence": [],
            },
            "rule_optimization_suggestions": [],
            "recommended_actions": [],
            "reasoning_summary": "资产标签不足以验证主机沦陷。",
        }
        api_response = {
            "choices": [
                {"message": {"content": json.dumps(forced_output, ensure_ascii=False)}}
            ]
        }

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            run_inference(
                five_source=self.five_source,
                system_prompt="FIXED SYSTEM PROMPT",
                base_url="http://model.invalid/v1",
                model="local-model",
                api_key=None,
                output_dir=output_dir,
                temperature=0.1,
                transport=lambda *_: api_response,
            )

            validation = json.loads(
                (output_dir / "validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual("passed_with_warnings", validation["status"])
            self.assertEqual(1, len(validation["warnings"]))
            self.assertIn("enriched_context.asset.tags", validation["warnings"][0])

    def test_invalid_output_is_frozen_once_and_not_repaired(self) -> None:
        api_response = {
            "choices": [
                {"message": {"content": '{"verdict":"真实告警"}'}},
            ]
        }
        call_count = 0

        def transport(endpoint: str, payload: dict, api_key: str, timeout: int) -> dict:
            nonlocal call_count
            call_count += 1
            return api_response

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            with self.assertRaisesRegex(ValueError, "missing required fields"):
                run_inference(
                    five_source=self.five_source,
                    system_prompt="FIXED SYSTEM PROMPT",
                    base_url="https://example.invalid",
                    model="deepseek-flash",
                    api_key="unit-test-secret",
                    output_dir=output_dir,
                    transport=transport,
                )

            self.assertEqual(1, call_count)
            self.assertEqual(
                api_response,
                json.loads(
                    (output_dir / "raw-response.json").read_text(encoding="utf-8")
                ),
            )
            validation = json.loads(
                (output_dir / "validation.json").read_text(encoding="utf-8")
            )
            self.assertEqual("failed", validation["status"])
            self.assertTrue((output_dir / "model-analysis-output.json").is_file())
            self.assertFalse((output_dir / "forced-analysis-output.json").exists())

    def test_request_failure_redacts_secret_and_frozen_directory_is_not_reused(self) -> None:
        secret = "never-persist-this-secret"

        def failing_transport(
            endpoint: str, payload: dict, api_key: str, timeout: int
        ) -> dict:
            raise RuntimeError(f"upstream rejected credential {api_key}")

        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            with self.assertRaises(RuntimeError) as raised:
                run_inference(
                    five_source=self.five_source,
                    system_prompt="FIXED SYSTEM PROMPT",
                    base_url="https://example.invalid",
                    model="deepseek-flash",
                    api_key=secret,
                    output_dir=output_dir,
                    transport=failing_transport,
                )

            self.assertNotIn(secret, str(raised.exception))
            self.assertIn("[REDACTED]", str(raised.exception))

            serialized_artifacts = "".join(
                path.read_text(encoding="utf-8")
                for path in output_dir.iterdir()
                if path.is_file()
            )
            self.assertNotIn(secret, serialized_artifacts)
            self.assertIn("[REDACTED]", serialized_artifacts)

            with self.assertRaises(FileExistsError):
                run_inference(
                    five_source=self.five_source,
                    system_prompt="FIXED SYSTEM PROMPT",
                    base_url="https://example.invalid",
                    model="deepseek-flash",
                    api_key=secret,
                    output_dir=output_dir,
                    transport=failing_transport,
                )


if __name__ == "__main__":
    unittest.main()
