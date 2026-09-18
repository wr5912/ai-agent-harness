"""dsh-dev 启动器的纯函数与状态文件契约测试；不启动容器。"""

import contextlib
import http.server
import importlib.util
import io
import json
from importlib.machinery import SourceFileLoader
import os
import socket
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock


ADAPTER = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_loader(
    "dsh_dev", SourceFileLoader("dsh_dev", str(ADAPTER / "dsh-dev"))
)
assert SPEC is not None and SPEC.loader is not None
dev = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dev)

TOKEN = "dsh web: http://127.0.0.1:3081/?token=secret-token-value\n"


class RenderComposeTest(unittest.TestCase):
    def test_verification_template_gets_host_network_and_port(self):
        template = (ADAPTER / "verification.compose.yaml").read_text(encoding="utf-8")
        rendered = dev.render_compose(template, mode="verification", project="dsh-dev-probe", port=3081)
        self.assertIn("name: dsh-dev-probe", rendered)
        self.assertIn("    network_mode: host\n", rendered)
        self.assertIn("      - --host\n      - 127.0.0.1\n      - --port\n      - \"3081\"\n", rendered)
        self.assertIn("dsh-dev-probe-home", rendered)
        self.assertIn("dsh-dev-probe-fallback", rendered)
        self.assertNotIn("dsh-verification-home", rendered)
        self.assertNotIn("0.0.0.0", rendered)
        self.assertNotIn("source: ./", rendered)
        self.assertIn(f"source: {ADAPTER}/verification-home-controls", rendered)

    def test_authoring_template_gets_host_network_and_port(self):
        template = (ADAPTER / "authoring.compose.yaml").read_text(encoding="utf-8")
        rendered = dev.render_compose(template, mode="authoring", project="dsh-dev-author", port=3082)
        self.assertIn("name: dsh-dev-author", rendered)
        self.assertIn("    network_mode: host\n", rendered)
        self.assertIn("- \"3082\"", rendered)

    def test_missing_anchor_fails_closed(self):
        with self.assertRaises(SystemExit):
            dev.render_compose("services:\n  dsh:\n    working_dir: /tmp\n", mode="verification",
                               project="dsh-dev-probe", port=3081)


class ModeAndContextContractTest(unittest.TestCase):
    """两种模式：dev/eval 别名、只读上下文挂载与开发模式信任门禁。"""

    def contract(self, **overrides):
        contract = {
            "source_id": "experiment:EXP-security-operations-expert-001",
            "source_kind": "experiment",
            "agent_id": "security-operations-expert",
            "workspace": "/tmp/ws",
            "presets": "/tmp/presets",
            "managed": "/tmp/managed",
            "spec_root": "/tmp/spec",
            "eval_root": "/tmp/eval",
            "patch": "/opt/dsh-managed/security-operations-expert.patch.yml",
            "patch_overlay": "/opt/dsh-managed/security-operations-expert.development.patch.yml",
            "required_env_names": [],
            "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
        }
        contract.update(overrides)
        return contract

    def test_mode_aliases_normalize_to_harness_phases(self):
        self.assertEqual(dev.normalize_mode("dev"), "authoring")
        self.assertEqual(dev.normalize_mode("eval"), "verification")
        self.assertEqual(dev.normalize_mode("authoring"), "authoring")
        self.assertEqual(dev.normalize_mode("verification"), "verification")
        with self.assertRaises(SystemExit):
            dev.normalize_mode("development")

    def test_authoring_template_passes_development_overlay(self):
        template = (ADAPTER / "authoring.compose.yaml").read_text(encoding="utf-8")
        rendered = dev.render_compose(template, mode="authoring", project="dsh-dev-author", port=3082)
        self.assertIn("      - --patch\n      - ${DSH_MANAGED_PATCH_OVERLAY:-/opt/dsh-managed/security-operations-expert.development.patch.yml}\n", rendered)
        self.assertIn("        target: /work/spec\n", rendered)
        self.assertIn("        target: /work/eval-input\n", rendered)

    def test_verification_template_has_no_overlay_but_keeps_context(self):
        template = (ADAPTER / "verification.compose.yaml").read_text(encoding="utf-8")
        rendered = dev.render_compose(template, mode="verification", project="dsh-dev-probe", port=3081)
        self.assertNotIn("DSH_MANAGED_PATCH_OVERLAY", rendered)
        self.assertIn("        target: /work/spec\n", rendered)
        self.assertIn("        target: /work/eval-input\n", rendered)

    def test_context_assets_require_declared_roots(self):
        assets = dev.context_assets(self.contract())
        self.assertEqual([asset["container"] for asset in assets], ["/work/spec", "/work/eval-input"])
        self.assertTrue(all(asset["mode"] == "ro" for asset in assets))
        with self.assertRaises(SystemExit):
            dev.context_assets(self.contract(spec_root=None))
        with self.assertRaises(SystemExit):
            dev.context_assets(self.contract(eval_root=None))

    def test_compose_env_injects_context_and_overlay_per_mode(self):
        authoring_env = dev.compose_env(self.contract(), "authoring", 3082)
        self.assertEqual(authoring_env["DSH_SPEC_HOST"], "/tmp/spec")
        self.assertEqual(authoring_env["DSH_EVAL_HOST"], "/tmp/eval")
        self.assertEqual(authoring_env["DSH_MANAGED_PATCH_OVERLAY"],
                         "/opt/dsh-managed/security-operations-expert.development.patch.yml")
        verification_env = dev.compose_env(self.contract(), "verification", 3081)
        self.assertNotIn("DSH_MANAGED_PATCH_OVERLAY", verification_env)

    def test_authoring_without_overlay_fails_closed(self):
        with self.assertRaises(SystemExit):
            dev.compose_env(self.contract(patch_overlay=None), "authoring", 3082)

    def test_dev_up_requires_explicit_cordis_trust(self):
        args = types.SimpleNamespace(source="experiment:EXP-security-operations-expert-001",
                                     mode="authoring", name="secops-dev", port=3084,
                                     allow_missing_env=True, accept_cordis_trust=False)
        with mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "compose_env") as compose_env:
            with self.assertRaises(SystemExit):
                dev.command_up(args)
        compose_env.assert_not_called()

    def test_eval_up_rejects_cordis_trust_flag(self):
        args = types.SimpleNamespace(source="experiment:EXP-security-operations-expert-001",
                                     mode="verification", name="secops-eval", port=3085,
                                     allow_missing_env=True, accept_cordis_trust=True)
        with mock.patch.object(dev, "port_in_use", return_value=False):
            with self.assertRaises(SystemExit):
                dev.command_up(args)


class ExtractAuthUrlTest(unittest.TestCase):
    def test_extracts_matching_port(self):
        logs = "noise\n" + TOKEN + "dsh web: http://127.0.0.1:9999/?token=other\n"
        self.assertEqual(dev.extract_auth_url(logs, 3081), "http://127.0.0.1:3081/?token=secret-token-value")

    def test_ignores_lan_variant(self):
        logs = TOKEN + "dsh web: http://127.0.0.1:3081/?token=secret-token-value (LAN: http://10.0.0.5:3081/?token=secret-token-value)\n"
        self.assertEqual(dev.extract_auth_url(logs, 3081), "http://127.0.0.1:3081/?token=secret-token-value")

    def test_ambiguous_urls_return_none(self):
        logs = TOKEN + "dsh web: http://127.0.0.1:3081/?token=second-token\n"
        self.assertIsNone(dev.extract_auth_url(logs, 3081))

    def test_other_port_returns_none(self):
        self.assertIsNone(dev.extract_auth_url(TOKEN, 3099))

    def test_redaction_hides_token(self):
        redacted = dev.redact_secrets(TOKEN)
        self.assertNotIn("secret-token-value", redacted)
        self.assertIn("token=<redacted>", redacted)


class InstanceStateTest(unittest.TestCase):
    def test_instance_manifest_has_no_token_and_records_mount_modes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dev.STATE_ROOT = root
            contract = {
                "source_id": "snapshot:snap-00000000-0000-4000-8000-000000000000",
                "source_kind": "snapshot",
                "agent_id": "security-operations-expert",
                "workspace": "/tmp/ws",
                "presets": "/tmp/presets",
                "managed": "/tmp/managed",
                "spec_root": "/tmp/spec",
                "eval_root": "/tmp/eval",
                "patch": "/opt/dsh-managed/security-operations-expert.patch.yml",
                "patch_overlay": None,
                "required_env_names": ["DEEPSEEK_API_KEY"],
                "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
            }
            target = dev.write_instance("soe-verify", mode="verification", contract=contract, port=3081)
            manifest = json.loads((target / "instance.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["mount_modes"], {"workspace": "ro", "presets": "ro", "managed": "ro"})
            self.assertEqual(manifest["purpose"], "eval")
            self.assertEqual(manifest["preset_default"], "security-operations-expert")
            self.assertEqual([item["container"] for item in manifest["context_mounts"]], ["/work/spec", "/work/eval-input"])
            self.assertIsNone(manifest["patch_overlay"])
            self.assertFalse(manifest["cordis_trust_accepted"])
            self.assertNotIn("token", json.dumps(manifest).lower())
            compose = (target / "compose.yaml").read_text(encoding="utf-8")
            self.assertNotIn("token=", compose)
            self.assertIn("network_mode: host", compose)

    def test_development_instance_records_overlay_and_trust(self):
        with tempfile.TemporaryDirectory() as temp:
            dev.STATE_ROOT = Path(temp)
            contract = {
                "source_id": "experiment:EXP-security-operations-expert-001",
                "source_kind": "experiment",
                "agent_id": "security-operations-expert",
                "workspace": "/tmp/ws",
                "presets": "/tmp/presets",
                "managed": "/tmp/managed",
                "spec_root": "/tmp/spec",
                "eval_root": "/tmp/eval",
                "patch": "/opt/dsh-managed/security-operations-expert.patch.yml",
                "patch_overlay": "/opt/dsh-managed/security-operations-expert.development.patch.yml",
                "required_env_names": [],
                "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
            }
            target = dev.write_instance("secops-dev", mode="authoring", contract=contract, port=3084,
                                        accepted_cordis_trust=True)
            manifest = json.loads((target / "instance.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["purpose"], "dev")
            self.assertEqual(manifest["preset_default"], "cordis")
            self.assertTrue(manifest["cordis_trust_accepted"])
            self.assertEqual(manifest["mount_modes"]["workspace"], "rw")
            self.assertIn("DSH_MANAGED_PATCH_OVERLAY", (target / "compose.yaml").read_text(encoding="utf-8"))

    def test_instance_name_must_be_kebab(self):
        with self.assertRaises(SystemExit):
            dev.instance_dir("Bad_Name")

    def test_conflicting_identity_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            dev.STATE_ROOT = Path(temp)
            contract = {
                "source_id": "experiment:EXP-security-operations-expert-001",
                "source_kind": "experiment",
                "agent_id": "security-operations-expert",
                "workspace": "/tmp/ws",
                "presets": "/tmp/presets",
                "managed": "/tmp/managed",
                "spec_root": "/tmp/spec",
                "eval_root": "/tmp/eval",
                "patch": "/opt/dsh-managed/x.patch.yml",
                "patch_overlay": "/opt/dsh-managed/x.development.patch.yml",
                "required_env_names": [],
                "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
            }
            dev.write_instance("soe-verify", mode="verification", contract=contract, port=3081)
            other = dict(contract, source_id="snapshot:snap-00000000-0000-4000-8000-000000000000")
            with self.assertRaises(SystemExit):
                dev.write_instance("soe-verify", mode="verification", contract=other, port=3081)


class UrlCommandGuardTest(unittest.TestCase):
    """`url` 只在交互终端或显式 --non-interactive 下输出 Token URL。"""

    def call(self, args):
        stdout = io.StringIO()
        with mock.patch.object(dev, "load_instance", return_value=(Path("/tmp"), {"port": 3081})), \
                contextlib.redirect_stdout(stdout):
            dev.command_url(args)
        return stdout.getvalue()

    def test_non_tty_without_flag_fails_closed(self):
        with self.assertRaises(SystemExit):
            self.call(types.SimpleNamespace(name="soe-verify", non_interactive=False))

    def test_non_tty_with_flag_prints_only_current_url(self):
        logs = mock.Mock(stdout=TOKEN)
        with mock.patch.object(dev, "running_container", return_value=("cid", "2026-01-01T00:00:00Z")), \
                mock.patch.object(dev, "run", return_value=logs), \
                mock.patch.object(dev, "probe_url", return_value={"ok": True, "reason": "token(303)→cookie→root 200"}):
            printed = self.call(types.SimpleNamespace(name="soe-verify", non_interactive=True))
        self.assertIn("http://127.0.0.1:3081/?token=secret-token-value", printed)


class PortProbeTest(unittest.TestCase):
    def test_detects_open_and_closed_port(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            port = listener.getsockname()[1]
            self.assertTrue(dev.port_in_use(port))
        self.assertFalse(dev.port_in_use(port))


class _AuthStubHandler(http.server.BaseHTTPRequestHandler):
    """模拟 DSH Web 认证入口：token 命中即 303 并下发会话 Cookie。"""

    cookie_value = "session-cookie"
    root_status = 200
    with_token_status = 303
    set_cookie = True

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler 约定
        if "token=" in self.path:
            self.send_response(self.with_token_status)
            if self.set_cookie:
                self.send_header("Set-Cookie", f"dsh-auth-probe={self.cookie_value}; Path=/; HttpOnly")
            self.send_header("Location", "/")
            self.end_headers()
            return
        self.send_response(self.root_status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"<html>window.__DSH_BOOT__ = {}</html>")

    def log_message(self, *args):  # 静默测试输出
        return


class AuthUrlProbeTest(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _AuthStubHandler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_token_redirect_sets_cookie_then_root_boots(self):
        """回归：urllib 默认跟随重定向会把 303 变成 200，必须仍判为通过。"""
        probe = dev.probe_url(f"http://127.0.0.1:{self.port}/?token=abc", self.port)
        self.assertTrue(probe["ok"], probe["reason"])

    def test_missing_cookie_fails_closed(self):
        _AuthStubHandler.set_cookie = False
        try:
            probe = dev.probe_url(f"http://127.0.0.1:{self.port}/?token=abc", self.port)
        finally:
            _AuthStubHandler.set_cookie = True
        self.assertFalse(probe["ok"])
        self.assertIn("Cookie", probe["reason"])

    def test_root_without_boot_marker_fails(self):
        _AuthStubHandler.root_status = 401
        try:
            probe = dev.probe_url(f"http://127.0.0.1:{self.port}/?token=abc", self.port)
        finally:
            _AuthStubHandler.root_status = 200
        self.assertFalse(probe["ok"])
        self.assertIn("401", probe["reason"])


if __name__ == "__main__":
    unittest.main()
