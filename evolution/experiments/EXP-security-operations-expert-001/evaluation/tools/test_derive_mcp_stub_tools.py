"""MCP 桩工具清单派生与桩服务协议的契约测试。

覆盖两点：
1. `derive_mcp_stub_tools.py` 必须只从候选受控事实源派生工具，且对无法解析到
   `服务名 + 原始名` 的引用 fail-closed；
2. `stub-mcp-streamable-http.mjs` 必须能完成 DSH 依赖的 `initialize` 与
   `tools/list` 握手，并对通知返回 202、对 GET 返回 405。

这些测试只证明技术装载辅助工具本身可用，不证明 DSH 装载、业务能力或 Release 验收。
"""

from __future__ import annotations

import json
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
ADAPTER = TOOLS_DIR.parents[4] / "runtime" / "adapters" / "dsh-container"
sys.path.insert(0, str(TOOLS_DIR))

import derive_mcp_stub_tools as derive  # noqa: E402


class DeriveInventoryTest(unittest.TestCase):
    candidate = TOOLS_DIR.parents[1] / "candidate" / "dsh"

    def test_tool_counts_match_referenced_servers(self):
        document, errors = derive.derive(self.candidate)
        self.assertEqual(errors, [])
        self.assertEqual(sorted(document["servers"]), ["inspection", "sec-ops", "threat-analysis"])
        self.assertEqual(len(document["servers"]["inspection"]["tools"]), 10)
        self.assertEqual(len(document["servers"]["sec-ops"]["tools"]), 24)
        self.assertEqual(len(document["servers"]["threat-analysis"]["tools"]), 13)

    def test_every_tool_is_a_raw_name_that_maps_back_to_a_reference(self):
        document, _ = derive.derive(self.candidate)
        for server, entry in document["servers"].items():
            for tool in entry["tools"]:
                public = derive.public_tool_name(server, tool["name"])
                self.assertLessEqual(len(public), 64)
                if len(f"mcp__{server}__{tool['name']}") > 64:
                    self.assertEqual(len(public), 64)

    def test_unresolvable_overlong_reference_fails_closed(self):
        with tempfile.TemporaryDirectory() as raw:
            candidate = Path(raw) / "dsh"
            shutil.copytree(self.candidate, candidate)
            matrix = candidate / "managed" / "role-tool-matrix.yaml"
            text = matrix.read_text(encoding="utf-8").replace(
                "mcp__sec-ops__ai_workbench_policy__get_policy_confi_e0cfa6659b3a",
                "mcp__sec-ops__ai_workbench_policy__get_policy_configuration_status",
            )
            matrix.write_text(text, encoding="utf-8")
            _, errors = derive.derive(candidate)
            self.assertTrue(errors)
            self.assertIn("无法解析", errors[0])

    def test_cli_check_mode_reports_counts(self):
        completed = subprocess.run(
            [sys.executable, str(TOOLS_DIR / "derive_mcp_stub_tools.py"), "--check"],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["tool_counts"]["sec-ops"], 24)


@unittest.skipIf(shutil.which("node") is None, "需要 Node 才能启动桩服务")
class StubServerProtocolTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.tools_path = Path(cls.temporary.name) / "tools.json"
        cls.log_path = Path(cls.temporary.name) / "stub.log"
        document, errors = derive.derive(DeriveInventoryTest.candidate)
        assert not errors, errors
        cls.tools_path.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        cls.port = _free_port()
        cls.process = subprocess.Popen(
            [
                "node", str(ADAPTER / "stub-mcp-streamable-http.mjs"),
                "--port", str(cls.port),
                "--tools", str(cls.tools_path),
                "--log", str(cls.log_path),
            ],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
        line = cls.process.stdout.readline()
        cls.endpoints = json.loads(line)["endpoints"]

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:  # pragma: no cover - 兜底
            cls.process.kill()
        cls.temporary.cleanup()

    def post(self, path: str, payload: dict):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"content-type": "application/json", "authorization": "Bearer unit-test"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_initialize_and_tools_list(self):
        status, initialized = self.post("/mcp/sec-ops", {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}},
        })
        self.assertEqual(status, 200)
        self.assertEqual(initialized["result"]["protocolVersion"], "2025-06-18")
        status, listed = self.post("/mcp/sec-ops", {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        self.assertEqual(status, 200)
        names = [tool["name"] for tool in listed["result"]["tools"]]
        self.assertIn("ai_workbench_policy__get_policy_configuration_status", names)
        self.assertEqual(len(names), 24)

    def test_notification_returns_202_and_get_returns_405(self):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/mcp/inspection",
            data=json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}).encode("utf-8"),
            headers={"content-type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 202)
            self.assertEqual(response.read(), b"")
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(f"http://127.0.0.1:{self.port}/mcp/inspection", timeout=10)
        self.assertEqual(raised.exception.code, 405)

    def test_unknown_path_returns_404(self):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/mcp/unknown",
            data=b"{}", headers={"content-type": "application/json"}, method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as raised:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(raised.exception.code, 404)

    def test_log_records_authorization_presence_without_token(self):
        self.post("/mcp/threat-analysis", {"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
        text = self.log_path.read_text(encoding="utf-8")
        self.assertIn('"authorization_present":true', text)
        self.assertNotIn("unit-test", text)


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


if __name__ == "__main__":
    unittest.main()
