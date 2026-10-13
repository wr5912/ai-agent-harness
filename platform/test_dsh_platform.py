"""启动器隔离测试；替换 DSH/pnpm 外部进程，保留真实 CLI、文件和端口路径。"""

import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest


PLATFORM = Path(__file__).resolve().parent
VERSION = "0.2.1-alpha.2"


class PlatformLauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.repo = self.root / "repository with spaces"
        shutil.copytree(PLATFORM, self.repo / "platform", ignore=shutil.ignore_patterns("plugin"))
        self.plugin = self.repo / "platform" / "plugin"
        self.plugin.mkdir(parents=True)
        (self.plugin / "package.json").write_text(json.dumps({
            "name": "@ai-agent-harness/harness-platform", "peerDependencies": {
                "@deepseek-ai/dsh-client-connection": VERSION,
                "@deepseek-ai/cordis": "~4.0.5-alpha.1",
            },
        }))
        (self.plugin / "pnpm-lock.yaml").write_text("lockfileVersion: '9.0'\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.trace = self.root / "dsh-trace.jsonl"
        self.pnpm_trace = self.root / "pnpm-trace.jsonl"
        self.write_executable("dsh", r'''
import json, os, pathlib, signal, sys, time
if sys.argv[1:] == ["--version"]:
    print(os.environ.get("FAKE_DSH_VERSION", "0.2.1-alpha.2"))
else:
    if sys.argv.index("--patch") > sys.argv.index("--host"):
        print("error: unknown option '--patch'", file=sys.stderr)
        sys.exit(2)
    with open(os.environ["FAKE_DSH_TRACE"], "a") as handle:
        handle.write(json.dumps({"args": sys.argv[1:], "home": os.environ["DSH_HOME"],
                                 "repository": os.environ["HARNESS_ASSET_ROOT"]}) + "\n")
    if os.environ.get("FAKE_DSH_WELCOME"):
        patch = pathlib.Path(os.environ["DSH_HOME"]) / "profiles/harness-platform/cordis.patch.yml"
        if "ui-settings-general" not in patch.read_text():
            patch.write_text("- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 1\n")
    if os.environ.get("FAKE_DSH_STAY"):
        signal.signal(signal.SIGINT, lambda signum, frame: sys.exit(130))
        pathlib.Path(os.environ["FAKE_DSH_READY"]).touch()
        while True:
            time.sleep(0.05)
''')
        self.write_executable("pnpm", r'''
import json, os, pathlib, sys
with open(os.environ["FAKE_PNPM_TRACE"], "a") as handle:
    handle.write(json.dumps({"args": sys.argv[1:], "cwd": os.getcwd()}) + "\n")
if os.environ.get("FAKE_PNPM_FAIL"):
    sys.exit(1)
if sys.argv[1:] == ["run", "build"]:
    pathlib.Path("lib").mkdir(exist_ok=True)
    pathlib.Path("lib/index.js").write_text("export function apply() {}\n")
    pathlib.Path("lib/client.js").write_text("export function apply() {}\n")
''')
        self.env = {**os.environ, "PATH": str(self.bin), "HOME": str(self.root / "user"),
                    "XDG_STATE_HOME": str(self.root / "state"),
                    "DSH_HOME": str(self.root / "unrelated-dsh-home"),
                    "FAKE_DSH_TRACE": str(self.trace), "FAKE_PNPM_TRACE": str(self.pnpm_trace)}
        self.home = self.root / "state" / "ai-agent-harness" / "platform" / "dsh-home"
        self.profile = self.home / "profiles" / "harness-platform"
        self.cwd = self.root / "unrelated-cwd"
        self.cwd.mkdir()
        self.launcher = self.repo / "platform" / "dsh-platform"

    def tearDown(self):
        self.temp.cleanup()

    def write_executable(self, name, code):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + code)
        path.chmod(0o755)

    def run_cli(self, *args, env=None):
        return subprocess.run([sys.executable, str(self.launcher), *args], cwd=self.cwd,
                              env=env or self.env, capture_output=True, text=True, timeout=10)

    def prepare(self):
        result = self.run_cli("prepare")
        self.assertEqual(result.returncode, 0, result.stderr)

    def free_port(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            return listener.getsockname()[1]

    def snapshot(self):
        return {str(path.relative_to(self.root)): (path.stat().st_mtime_ns, path.read_bytes())
                for path in self.root.rglob("*") if path.is_file()}

    def test_prepare_from_any_cwd_renders_absolute_plugin_and_preserves_home(self):
        session = self.home / "sessions" / "keep-session"
        session.parent.mkdir(parents=True)
        session.write_text("retained")
        self.prepare()
        calls = [json.loads(line) for line in self.pnpm_trace.read_text().splitlines()]
        self.assertEqual([call["args"] for call in calls],
                         [["install", "--frozen-lockfile"], ["run", "build"]])
        self.assertTrue(all(call["cwd"] == str(self.plugin) for call in calls))
        manifest = json.loads((self.profile / "package.json").read_text())
        self.assertEqual(manifest["dsh"]["profile"]["bundles"],
                         ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"])
        self.assertEqual(manifest["dsh"]["profile"]["patchReload"], "startup")
        patch = (self.profile / "harness-platform.patch.yml").read_text()
        self.assertIn(json.dumps(str(self.plugin / "lib" / "index.js")), patch)
        self.assertNotIn("{{HARNESS_PLATFORM_PLUGIN}}", patch)
        self.assertEqual((self.profile / "cordis.patch.yml").read_text(), "[]\n")
        self.prepare()
        self.assertEqual(session.read_text(), "retained")
        self.assertFalse(Path(self.env["DSH_HOME"]).exists())

    def test_dry_run_is_read_only_and_reports_runtime_contract(self):
        self.prepare()
        before = self.snapshot()
        port = self.free_port()
        result = self.run_cli("start", "--dry-run", "--port", str(port))
        self.assertEqual(result.returncode, 0, result.stderr)
        preview = json.loads(result.stdout)
        self.assertEqual(preview["repository"], str(self.repo))
        self.assertEqual(preview["home"], str(self.home))
        self.assertEqual(preview["profile"], str(self.profile))
        self.assertEqual(preview["plugin"], str(self.plugin / "lib" / "index.js"))
        self.assertEqual(preview["patch"], str(self.profile / "harness-platform.patch.yml"))
        self.assertEqual(preview["host"], "127.0.0.1")
        self.assertEqual(preview["port"], port)
        self.assertNotIn("--from-default-profile", preview["command"])
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.trace.exists())

    def test_dry_run_does_not_create_unprepared_home(self):
        result = self.run_cli("start", "--dry-run")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("缺少插件构建产物", result.stderr)
        self.assertFalse(self.home.exists())

    def test_missing_dsh_and_incompatible_version_fail_before_preparation(self):
        (self.bin / "dsh").unlink()
        result = self.run_cli("prepare")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("没有全局 dsh", result.stderr)
        self.assertFalse(self.home.exists())
        self.write_executable("dsh", 'print("0.3.0")\n')
        result = self.run_cli("prepare")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("不兼容", result.stderr)
        self.assertFalse(self.home.exists())
        self.assertFalse(self.pnpm_trace.exists())

    def test_missing_client_or_stale_profile_fails_without_start(self):
        self.prepare()
        (self.plugin / "lib" / "client.js").unlink()
        result = self.run_cli("start", "--dry-run")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("client.js", result.stderr)
        self.prepare()
        (self.profile / "harness-platform.patch.yml").write_text("[]\n")
        result = self.run_cli("start", "--dry-run")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("与仓库模板不一致", result.stderr)
        self.assertFalse(self.trace.exists())

    def test_build_failure_keeps_existing_profile(self):
        self.prepare()
        before = (self.profile / "harness-platform.patch.yml").read_bytes()
        (self.repo / "platform" / "profile" / "cordis.patch.yml").write_text("[]\n")
        result = self.run_cli("prepare", env={**self.env, "FAKE_PNPM_FAIL": "1"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.profile / "harness-platform.patch.yml").read_bytes(), before)

    def test_port_conflict_fails_and_does_not_select_another_port(self):
        self.prepare()
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            result = self.run_cli("start", "--port", str(port))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(f"127.0.0.1:{port}", result.stderr)
        self.assertFalse(self.trace.exists())

    def test_foreground_interrupt_and_restart_reuse_home(self):
        self.prepare()
        session = self.home / "sessions" / "keep-session"
        session.parent.mkdir(parents=True)
        session.write_text("retained")
        for attempt in range(2):
            ready = self.root / f"ready-{attempt}"
            env = {**self.env, "FAKE_DSH_STAY": "1", "FAKE_DSH_READY": str(ready),
                   "FAKE_DSH_WELCOME": "1"}
            process = subprocess.Popen(
                [sys.executable, str(self.launcher), "start", "--port", str(self.free_port())],
                cwd=self.cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(ready.exists(), "替身 DSH 未启动")
                native_patch = (self.profile / "cordis.patch.yml").read_bytes()
                self.assertIn(b"welcomeNoticeVersion", native_patch)
                process.send_signal(signal.SIGINT)
                process.communicate(timeout=5)
                self.assertEqual(process.returncode, 130)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
            self.assertEqual(session.read_text(), "retained")
            preview = self.run_cli("start", "--dry-run", "--port", str(self.free_port()))
            self.assertEqual(preview.returncode, 0, preview.stderr)
            self.prepare()
            self.assertEqual((self.profile / "cordis.patch.yml").read_bytes(), native_patch)
        calls = [json.loads(line) for line in self.trace.read_text().splitlines()]
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual(call["home"], str(self.home))
            self.assertEqual(call["repository"], str(self.repo))
            self.assertEqual(call["args"][:6], ["--profile", "harness-platform", "--patch",
                             str(self.profile / "harness-platform.patch.yml"), "--host", "127.0.0.1"])
            self.assertEqual(call["args"][-1], "--no-open")

    def test_stopped_server_time_wait_does_not_block_restart(self):
        self.prepare()
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", 0))
            listener.listen()
            port = listener.getsockname()[1]
            with socket.create_connection(("127.0.0.1", port)) as client:
                connection, _ = listener.accept()
                connection.close()
                self.assertEqual(client.recv(1), b"")
        result = self.run_cli("start", "--dry-run", "--port", str(port))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_default_state_location_and_invalid_ports(self):
        env = self.env.copy()
        del env["XDG_STATE_HOME"]
        result = self.run_cli("prepare", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        default_home = Path(env["HOME"]) / ".local" / "state" / "ai-agent-harness" / "platform" / "dsh-home"
        self.assertTrue((default_home / "profiles" / "harness-platform" / "package.json").is_file())
        for port in ("0", "65536", "invalid"):
            result = self.run_cli("start", "--port", port)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("1 至 65535", result.stderr)


if __name__ == "__main__":
    unittest.main()
