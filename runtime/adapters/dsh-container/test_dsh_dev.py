"""dsh-dev 启动器的纯函数与状态文件契约测试；不启动容器。"""

import contextlib
import http.server
import importlib.util
import io
import json
from importlib.machinery import SourceFileLoader
import os
import socket
import subprocess
import sys
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


class HarnessInitTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name)
        (self.repo / "agents").mkdir()
        (self.repo / "evolution/experiments").mkdir(parents=True)
        adapter = self.repo / "runtime/adapters/dsh-container"
        adapter.mkdir(parents=True)
        self.sources = adapter / "sources.json"
        self.sources.write_text('{"schema_version":"1.0","sources":{}}\n', encoding="utf-8")
        self.lock = adapter / "source.lock.json"
        self.lock.write_bytes((ADAPTER / "source.lock.json").read_bytes())

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, agent_id="test01"):
        return dev.create_harness(
            agent_id, repo=self.repo, sources=self.sources, lock_path=self.lock
        )

    def test_creates_minimal_resolvable_first_experiment(self):
        result = self.create()
        self.assertEqual(result, {
            "agent_id": "test01",
            "experiment_id": "EXP-test01-001",
            "source_id": "experiment:EXP-test01-001",
        })
        contract = dev.resolve(
            result["source_id"], repo=self.repo, sources=self.sources, lock_path=self.lock
        )
        self.assertEqual(contract["agent_id"], "test01")
        self.assertEqual(contract["preset_id"], "test01")
        expected = {
            "agents/test01/manifest.yaml",
            "agents/test01/definition.md",
            "agents/test01/evaluation.md",
            "evolution/experiments/EXP-test01-001/change.yaml",
            "evolution/experiments/EXP-test01-001/hypothesis.md",
            "evolution/experiments/EXP-test01-001/candidate/harness.yaml",
            "evolution/experiments/EXP-test01-001/candidate/runtime.lock.json",
            "evolution/experiments/EXP-test01-001/candidate/dsh/workspace/.env",
            "evolution/experiments/EXP-test01-001/candidate/dsh/workspace/AGENTS.md",
            "evolution/experiments/EXP-test01-001/candidate/dsh/managed/test01.patch.yml",
            "evolution/experiments/EXP-test01-001/candidate/dsh/managed/test01.development.patch.yml",
            "evolution/experiments/EXP-test01-001/candidate/dsh/presets/test01/agent.cordis.yml",
            "evolution/experiments/EXP-test01-001/candidate/dsh/presets/test01/preset.yml",
        }
        actual = {
            path.relative_to(self.repo).as_posix()
            for root in (self.repo / "agents/test01", self.repo / "evolution/experiments/EXP-test01-001")
            for path in root.rglob("*") if path.is_file()
        }
        self.assertEqual(actual, expected)
        self.assertEqual(
            (self.repo / "evolution/experiments/EXP-test01-001/candidate/dsh/workspace/.env").read_bytes(),
            (ADAPTER / "verification-home-controls/locked-bootstrap.env").read_bytes(),
        )
        generated = "\n".join(
            path.read_text(encoding="utf-8") for path in self.repo.rglob("*")
            if path.is_file() and path != self.lock
        )
        self.assertNotRegex(generated, r"sk-[A-Za-z0-9]{16,}")
        self.assertIn("DEEPSEEK_API_KEY", generated)

    def test_invalid_id_and_collisions_do_not_overwrite(self):
        original = self.sources.read_bytes()
        with self.assertRaisesRegex(ValueError, "kebab-case"):
            self.create("Test01")
        self.assertEqual(self.sources.read_bytes(), original)
        self.assertFalse((self.repo / "agents/Test01").exists())

        agent = self.repo / "agents/test01"
        agent.mkdir()
        marker = agent / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "拒绝覆盖"):
            self.create()
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")
        self.assertEqual(self.sources.read_bytes(), original)
        self.assertFalse((self.repo / "evolution/experiments/EXP-test01-001").exists())

    def test_resolution_failure_rolls_back_files_and_catalog(self):
        original = self.sources.read_bytes()
        with mock.patch.object(dev, "resolve", side_effect=ValueError("invalid source")):
            with self.assertRaisesRegex(ValueError, "invalid source"):
                self.create()
        self.assertEqual(self.sources.read_bytes(), original)
        self.assertFalse((self.repo / "agents/test01").exists())
        self.assertFalse((self.repo / "evolution/experiments/EXP-test01-001").exists())


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

    def test_source_runtime_environment_names_are_rendered_once(self):
        business_names = (
            "DEEPSEEK_API_KEY", "SEC_OPS_MCP_URL", "SEC_OPS_MCP_TOKEN",
            "INSPECTION_MCP_URL", "INSPECTION_MCP_TOKEN",
            "THREAT_ANALYSIS_MCP_URL", "THREAT_ANALYSIS_MCP_TOKEN",
        )
        for name in ("authoring.compose.yaml", "verification.compose.yaml"):
            template = (ADAPTER / name).read_text(encoding="utf-8")
            for business_name in business_names:
                self.assertNotIn(business_name, template)
            rendered = dev.render_compose(
                template,
                mode="authoring" if name.startswith("authoring") else "verification",
                project="dsh-dev-models",
                port=3082,
                runtime_env_names=["DEEPSEEK_API_KEY", "LOCAL_LLM_BASE_URL", "LOCAL_LLM_BASE_URL"],
            )
            self.assertEqual(rendered.count("      - DEEPSEEK_API_KEY\n"), 1)
            self.assertEqual(rendered.count("      - LOCAL_LLM_BASE_URL\n"), 1)

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
            "reference_root": "/tmp/reference",
            "preset_id": "security-operations-expert",
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
        self.assertIn("      - --patch\n      - ${DSH_MANAGED_PATCH_OVERLAY:?", rendered)
        self.assertIn("        target: /work/reference\n", rendered)

    def test_dev_instruction_file_is_generic_and_bounded(self):
        """开发指令文件不得内联任何业务 Agent 身份，也不得含凭据或可执行内容。"""
        text = (ADAPTER / "verification-home-controls/locked-dev.AGENTS.md").read_text(encoding="utf-8")
        self.assertTrue(text.strip())
        self.assertLess(len(text.encode("utf-8")), 64 * 1024)
        self.assertNotIn("security-operations-expert", text)
        self.assertNotIn("!!js", text)
        self.assertNotIn("http://", text)
        self.assertNotIn("https://", text)
        for required in ("/work/harness/workspace", "/opt/dsh-presets", "/opt/dsh-managed",
                         "/work/reference", "target_preset", ".agent-presets"):
            self.assertIn(required, text)

    def test_verification_template_exposes_no_grading_material(self):
        """被测目标会话不得挂载验收阈值、评估方法、测试预置或预期答案。"""
        template = (ADAPTER / "verification.compose.yaml").read_text(encoding="utf-8")
        rendered = dev.render_compose(template, mode="verification", project="dsh-dev-probe", port=3081)
        self.assertNotIn("DSH_MANAGED_PATCH_OVERLAY", rendered)
        self.assertNotIn("/work/reference\n", rendered)
        self.assertNotIn("/work/eval-input\n", rendered)
        self.assertNotIn("DSH_REFERENCE_HOST", rendered)

    def test_templates_declare_no_business_agent_identity(self):
        """通用启动器模板不得内联某个业务 Agent 的路径、preset 或 patch 名。"""
        for name in ("authoring.compose.yaml", "verification.compose.yaml"):
            text = (ADAPTER / name).read_text(encoding="utf-8")
            self.assertNotIn("security-operations-expert", text)
            self.assertNotIn("EXP-security-operations-expert-001", text)

    def test_adapter_scripts_are_mounted_not_baked_into_the_image(self):
        """回归：脚本改动只需重启实例，不必重建镜像。"""
        dockerfile = (ADAPTER / "Dockerfile").read_text(encoding="utf-8")
        for name in ("verify-load.mjs", "tree-digest.mjs", "prepare-verification-home.mjs"):
            self.assertNotIn(f"/opt/dsh-adapter/{name}", dockerfile)
        self.assertIn("RUN mkdir -p /opt/dsh-adapter", dockerfile)
        for mode in ("authoring", "verification"):
            rendered = dev.render_compose(
                (ADAPTER / f"{mode}.compose.yaml").read_text(encoding="utf-8"),
                mode=mode, project=f"dsh-dev-{mode}", port=3081)
            self.assertEqual(rendered.count("        target: /opt/dsh-adapter\n"), 2,
                             f"{mode}: home-init 与 dsh 都必须挂载适配层脚本目录")
            self.assertNotIn("COPY --chown=node:node verify-load.mjs", rendered)

    def test_dev_target_declaration_is_generated_with_resolved_values(self):
        """回归：受控指令保持通用，实际目标值由启动器生成并挂到 /work/AGENTS.local.md。"""
        contract = self.contract()
        document = dev.dev_target_document(contract, "secops-dev", "cordis")
        self.assertIn("security-operations-expert", document)
        self.assertIn("cordis", document)
        self.assertIn("/work/harness/workspace", document)
        self.assertIn("/opt/dsh-presets", document)
        self.assertIn("/opt/dsh-managed", document)
        self.assertIn("experiment:EXP-security-operations-expert-001", document)
        # 生成的声明只读挂载，且模板里由必填变量给出。
        rendered = dev.render_compose(
            (ADAPTER / "authoring.compose.yaml").read_text(encoding="utf-8"),
            mode="authoring", project="dsh-dev-author", port=3082)
        self.assertIn("        target: /work/AGENTS.local.md\n", rendered)
        self.assertIn("DSH_DEV_TARGET_HOST", rendered)

    def test_authoring_preflight_generates_target_with_session_preset(self):
        args = types.SimpleNamespace(mode="authoring", name="secops-dev", port=3084)
        observed = {}

        def inspect_target(_command, *, env):
            observed["document"] = Path(env["DSH_DEV_TARGET_HOST"]).read_text(encoding="utf-8")

        with mock.patch.object(dev, "run", side_effect=inspect_target):
            dev.preflight_new_instance(args, self.contract())
        self.assertIn("session_preset）：cordis", observed["document"])

    def test_development_instance_records_and_mounts_target_declaration(self):
        with tempfile.TemporaryDirectory() as temp:
            dev.STATE_ROOT = Path(temp)
            target = dev.write_instance("secops-dev", mode="authoring", contract=self.contract(),
                                        port=3084, accepted_cordis_trust=True)
            manifest = json.loads((target / "instance.json").read_text(encoding="utf-8"))
            declared = Path(manifest["dev_target_file"])
            self.assertTrue(declared.is_file(), "开发实例必须生成目标声明文件")
            self.assertIn("security-operations-expert", declared.read_text(encoding="utf-8"))
            environment = dev.compose_env(self.contract(), "authoring", 3084, "secops-dev")
            self.assertEqual(environment["DSH_DEV_TARGET_HOST"], str(declared))

    def test_verification_instance_has_no_target_declaration(self):
        with tempfile.TemporaryDirectory() as temp:
            dev.STATE_ROOT = Path(temp)
            target = dev.write_instance("secops-eval", mode="verification", contract=self.contract(),
                                        port=3085)
            manifest = json.loads((target / "instance.json").read_text(encoding="utf-8"))
            self.assertIsNone(manifest["dev_target_file"])
            environment = dev.compose_env(self.contract(), "verification", 3085, "secops-eval")
            self.assertNotIn("DSH_DEV_TARGET_HOST", environment)

    def test_target_preset_comes_from_selected_source(self):
        """目标是来源声明的业务 preset，与本次会话实际运行的 preset 分开。"""
        self.assertEqual(dev.target_preset(self.contract()), "security-operations-expert")
        self.assertEqual(dev.target_preset(self.contract(preset_id="second-harness")), "second-harness")
        with self.assertRaises(SystemExit):
            dev.target_preset(self.contract(preset_id=None))

    def test_session_and_target_preset_are_distinct_in_development_mode(self):
        """回归：开发会话身份是 cordis，待优化目标仍是来源声明的业务 preset。"""
        contract = self.contract()
        self.assertEqual(dev.session_preset(contract, "authoring"), "cordis")
        self.assertEqual(dev.target_preset(contract), "security-operations-expert")
        self.assertNotEqual(dev.session_preset(contract, "authoring"), dev.target_preset(contract))
        # 评测模式两者一致：会话运行的就是目标本身。
        self.assertEqual(dev.session_preset(contract, "verification"),
                         dev.target_preset(contract))

    def test_context_assets_are_authoring_only_and_require_declared_roots(self):
        assets = dev.context_assets(self.contract(), "authoring")
        self.assertEqual([asset["container"] for asset in assets], ["/work/reference"])
        self.assertTrue(all(asset["mode"] == "ro" for asset in assets))
        self.assertEqual(dev.context_assets(self.contract(), "verification"), [])
        self.assertEqual(dev.context_assets(self.contract(reference_root=None), "verification"), [])
        with self.assertRaises(SystemExit):
            dev.context_assets(self.contract(reference_root=None), "authoring")

    def test_compose_env_injects_adapter_root_for_both_modes(self):
        """回归：适配层脚本走只读挂载，两种模式都必须注入其宿主目录。"""
        for mode in ("authoring", "verification"):
            contract = self.contract() if mode == "authoring" else self.contract(patch_overlay=None)
            environment = dev.compose_env(contract, mode, 3082, f"probe-{mode}")
            self.assertEqual(environment["DSH_ADAPTER_HOST"], str(ADAPTER))

    def test_compose_env_injects_context_and_overlay_per_mode(self):
        authoring_env = dev.compose_env(self.contract(), "authoring", 3082, "secops-dev")
        self.assertEqual(authoring_env["DSH_REFERENCE_HOST"], "/tmp/reference")
        self.assertEqual(authoring_env["DSH_MANAGED_PATCH_OVERLAY"],
                         "/opt/dsh-managed/security-operations-expert.development.patch.yml")
        verification_env = dev.compose_env(self.contract(), "verification", 3081, "secops-eval")
        self.assertNotIn("DSH_MANAGED_PATCH_OVERLAY", verification_env)
        self.assertNotIn("DSH_REFERENCE_HOST", verification_env)

    def test_authoring_without_overlay_fails_closed(self):
        with self.assertRaises(SystemExit):
            dev.compose_env(self.contract(patch_overlay=None), "authoring", 3082, "secops-dev")

    def test_dev_up_requires_explicit_cordis_trust(self):
        args = types.SimpleNamespace(source="experiment:EXP-security-operations-expert-001",
                                     mode="authoring", name="secops-dev", port=3084,
                                     allow_missing_env=True, accept_cordis_trust=False)
        with mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "compose_env") as compose_env:
            with self.assertRaises(SystemExit):
                dev.command_up(args)
        compose_env.assert_not_called()

    def test_dry_run_delivers_workspace_path_and_cold_start_hint(self):
        """DSH Web 冷启动需要先在界面注册工作区；计划必须交付确切路径与步骤。"""
        args = types.SimpleNamespace(source="experiment:EXP-security-operations-expert-001",
                                     mode="verification", name="secops-eval", port=3085, dry_run=True)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout), \
                mock.patch.object(dev, "context_assets", return_value=[]):
            dev.command_up(args)
        plan = json.loads(stdout.getvalue())
        self.assertEqual(plan["workspace_to_register"], "/work/harness/workspace")
        self.assertIn("/work/harness/workspace", plan["web_cold_start"])
        self.assertIn("编辑路径", plan["web_cold_start"])
        self.assertIsNone(plan["dev_instructions"])
        # 计划可以出现环境变量**名称**（含 TOKEN 字样），但不得出现任何值。
        self.assertNotIn("token=", json.dumps(plan).lower())

    def test_dev_session_registers_work_and_loads_dev_instructions(self):
        """回归：开发会话必须注册 /work 并读到受控开发指令，而不是被测业务身份。"""
        self.assertEqual(dev.workspace_to_register("authoring"), "/work")
        self.assertEqual(dev.workspace_to_register("verification"), "/work/harness/workspace")
        args = types.SimpleNamespace(source="experiment:EXP-security-operations-expert-001",
                                     mode="authoring", name="secops-dev", port=3086, dry_run=True)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            dev.command_up(args)
        plan = json.loads(stdout.getvalue())
        self.assertEqual(plan["workspace_to_register"], "/work")
        self.assertIn("/work", plan["web_cold_start"])
        self.assertEqual(plan["dev_instructions"], "/work/AGENTS.md")
        # 开发会话身份是 cordis，待优化目标仍是业务 preset；两个字段不能混用。
        self.assertEqual(plan["session_preset"], "cordis")
        self.assertEqual(plan["target_preset"], "security-operations-expert")
        self.assertEqual(plan["agent_id"], "security-operations-expert")
        rendered = dev.render_compose(
            (ADAPTER / "authoring.compose.yaml").read_text(encoding="utf-8"),
            mode="authoring", project="dsh-dev-author", port=3086)
        self.assertIn("        target: /work/AGENTS.md\n", rendered)
        self.assertIn("locked-dev.AGENTS.md", rendered)

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
                "source_id": "experiment:EXP-second-harness-002",
                "source_kind": "experiment",
                "agent_id": "second-harness",
                "workspace": "/tmp/ws",
                "presets": "/tmp/presets",
                "managed": "/tmp/managed",
                "reference_root": "/tmp/reference",
                "preset_id": "second-harness",
                "patch": "/opt/dsh-managed/second.patch.yml",
                "patch_overlay": None,
                "required_env_names": ["DEEPSEEK_API_KEY"],
                "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
            }
            target = dev.write_instance("second-verify", mode="verification", contract=contract, port=3081)
            manifest = json.loads((target / "instance.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["mount_modes"], {"workspace": "ro", "presets": "ro", "managed": "ro"})
            self.assertEqual(manifest["purpose"], "eval")
            self.assertEqual(manifest["target_preset"], "second-harness")
            self.assertEqual(manifest["session_preset"], "second-harness")
            self.assertEqual(manifest["agent_id"], "second-harness")
            # 被测目标会话不挂载任何判分材料。
            self.assertEqual(manifest["context_mounts"], [])
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
                "reference_root": "/tmp/reference",
                "preset_id": "security-operations-expert",
                "patch": "/opt/dsh-managed/security-operations-expert.patch.yml",
                "patch_overlay": "/opt/dsh-managed/security-operations-expert.development.patch.yml",
                "required_env_names": [],
                "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
            }
            target = dev.write_instance("secops-dev", mode="authoring", contract=contract, port=3084,
                                        accepted_cordis_trust=True)
            manifest = json.loads((target / "instance.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["purpose"], "dev")
            self.assertEqual(manifest["target_preset"], "security-operations-expert")
            self.assertEqual(manifest["session_preset"], "cordis")
            self.assertTrue(manifest["cordis_trust_accepted"])
            self.assertEqual(manifest["mount_modes"]["workspace"], "rw")
            # 开发会话只挂载一份完整定义文档来修改和核对。
            self.assertEqual([item["container"] for item in manifest["context_mounts"]],
                             ["/work/reference"])
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
                "reference_root": "/tmp/reference",
                "preset_id": "security-operations-expert",
                "patch": "/opt/dsh-managed/x.patch.yml",
                "patch_overlay": "/opt/dsh-managed/x.development.patch.yml",
                "required_env_names": [],
                "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
            }
            dev.write_instance("soe-verify", mode="verification", contract=contract, port=3081)
            other = dict(contract, source_id="experiment:EXP-second-harness-002")
            with self.assertRaises(SystemExit):
                dev.write_instance("soe-verify", mode="verification", contract=other, port=3081)


class DownCommandTest(unittest.TestCase):
    """`down` 必须报告真实状态：命令失败、仍有容器运行或无法确认都不能输出 stopped: true。"""

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        dev.STATE_ROOT = Path(self._temp.name)
        dev.write_instance("soe-verify", mode="verification", contract={
            "source_id": "experiment:EXP-security-operations-expert-001",
            "source_kind": "experiment",
            "agent_id": "security-operations-expert",
            "workspace": "/tmp/ws", "presets": "/tmp/presets", "managed": "/tmp/managed",
            "reference_root": "/tmp/reference",
            "preset_id": "security-operations-expert",
            "patch": "/opt/dsh-managed/security-operations-expert.patch.yml",
            "patch_overlay": None, "required_env_names": [],
            "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
        }, port=3081)

    def tearDown(self):
        self._temp.cleanup()

    def call(self, completed, containers, volume=None):
        volume = volume or subprocess.CompletedProcess([], 0, stdout="", stderr="")
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(dev, "run", side_effect=[
            completed,  # docker compose down
            containers,  # docker ps -a
            volume,  # docker volume ls
        ]), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            try:
                dev.command_down(types.SimpleNamespace(name="soe-verify"))
            except SystemExit as stop:
                return stop.code, stdout.getvalue(), stderr.getvalue()
        return 0, stdout.getvalue(), stderr.getvalue()

    def test_compose_down_failure_is_not_reported_as_stopped(self):
        """回归：命令退出码非零时不得输出 stopped: true。"""
        failure = subprocess.CompletedProcess([], 1, stdout="", stderr="permission denied")
        code, printed, errors = self.call(failure, subprocess.CompletedProcess([], 0, stdout="", stderr=""))
        self.assertNotEqual(code, 0)
        self.assertNotIn("stopped", printed)
        self.assertIn("停止 soe-verify 失败", errors)

    def test_surviving_container_is_reported_as_failure(self):
        ok = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        listings = subprocess.CompletedProcess(
            [], 0,
            stdout="abc123\trunning\tUp 2 minutes\tdsh-dev-soe-verify-dsh-1\tdsh\n", stderr="")
        code, printed, errors = self.call(ok, listings)
        self.assertNotEqual(code, 0)
        self.assertEqual(printed, "")
        self.assertIn('"stopped": false', errors)

    def test_unqueryable_state_is_reported_as_unknown(self):
        ok = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        unqueryable = subprocess.CompletedProcess([], 1, stdout="", stderr="daemon down")
        code, printed, errors = self.call(ok, unqueryable)
        self.assertNotEqual(code, 0)
        self.assertEqual(printed, "")
        self.assertIn('"stopped": "unknown"', errors)

    def test_confirmed_stop_reports_true_and_home_preservation(self):
        """回归：HOME 卷名由 Compose 标签解析，不能按 <project>-home 猜测。"""
        ok = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        empty = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        preserved = subprocess.CompletedProcess(
            [], 0, stdout="dsh-dev-soe-verify_dsh-dev-soe-verify-home\n", stderr="")
        code, printed, _ = self.call(ok, empty, preserved)
        self.assertEqual(code, 0)
        self.assertIn('"stopped": true', printed)
        self.assertIn('"home_preserved": true', printed)
        self.assertIn("dsh-dev-soe-verify_dsh-dev-soe-verify-home", printed)

    def test_absent_home_volume_is_reported_as_false(self):
        ok = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        empty = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        gone = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        code, printed, _ = self.call(ok, empty, gone)
        self.assertEqual(code, 0)
        self.assertIn('"home_preserved": false', printed)

    def test_instance_lifecycle_commands_inject_recorded_source_values(self):
        """回归：模板以 ${VAR:?} 声明必填变量，读取实例 Compose 也必须按实例状态注入。"""
        _, manifest = dev.load_instance("soe-verify")
        environment = dev.instance_compose_env(manifest)
        self.assertEqual(environment["DSH_IMAGE_TAG"], "ai-agent-harness/dsh:c291e7961")
        self.assertEqual(environment["DSH_ADAPTER_HOST"], str(ADAPTER))
        self.assertEqual(environment["DSH_MANAGED_PATCH"],
                         "/opt/dsh-managed/security-operations-expert.patch.yml")
        self.assertEqual(environment["DSH_WORKSPACE_HOST"], "/tmp/ws")
        self.assertNotIn("DSH_MANAGED_PATCH_OVERLAY", environment)


class UpCommandStateTest(unittest.TestCase):
    """`up` 必须核对服务真的在运行，而不是只看 `docker compose up -d` 的退出码。"""

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        dev.STATE_ROOT = Path(self._temp.name)

    def tearDown(self):
        self._temp.cleanup()

    def args(self, **overrides):
        base = dict(source="experiment:EXP-security-operations-expert-001",
                    mode="verification", name="up-probe", port=3212,
                    allow_missing_env=False, accept_cordis_trust=False, replace=False)
        base.update(overrides)
        return types.SimpleNamespace(**base)

    def test_up_reports_failure_when_dsh_service_is_not_running(self):
        exited = subprocess.CompletedProcess(
            [], 0,
            stdout="abc123\texited\tExited (1) 2 seconds ago\tdsh-dev-up-probe-dsh-1\tdsh\n", stderr="")
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "check_environment"), \
                mock.patch.object(dev, "compose_env", return_value={}), \
                mock.patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")), \
                mock.patch.object(dev, "wait_for_service", return_value=[{
                    "id": "abc123", "state": "exited", "status": "Exited (1)",
                    "name": "dsh-dev-up-probe-dsh-1", "service": "dsh"}]), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args())
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn('"dsh_running": false', stderr.getvalue())
        self.assertIn("没有进入运行状态", stderr.getvalue())

    def test_up_reports_running_service(self):
        running = subprocess.CompletedProcess(
            [], 0,
            stdout="abc123\trunning\tUp 3 seconds\tdsh-dev-up-probe-dsh-1\tdsh\n"
                   "def456\texited\tExited (0) 3 seconds ago\tdsh-dev-up-probe-home-init-1\thome-init\n",
            stderr="")
        stdout = io.StringIO()
        with mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "check_environment"), \
                mock.patch.object(dev, "compose_env", return_value={}), \
                mock.patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")), \
                mock.patch.object(dev, "wait_for_service", return_value=[
                    {"id": "abc123", "state": "running", "status": "Up 3 seconds",
                     "name": "dsh-dev-up-probe-dsh-1", "service": "dsh"},
                    {"id": "def456", "state": "exited", "status": "Exited (0)",
                     "name": "dsh-dev-up-probe-home-init-1", "service": "home-init"}]), \
                contextlib.redirect_stdout(stdout):
            dev.command_up(self.args())
        report = json.loads(stdout.getvalue())
        self.assertIs(report["dsh_running"], True)
        self.assertEqual([item["service"] for item in report["containers"]], ["dsh", "home-init"])

    def test_up_reports_unknown_when_state_cannot_be_queried(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "check_environment"), \
                mock.patch.object(dev, "compose_env", return_value={}), \
                mock.patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")), \
                mock.patch.object(dev, "wait_for_service", return_value=None), \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args())
        self.assertEqual(stdout.getvalue(), "")
        self.assertIn('"dsh_running": "unknown"', stderr.getvalue())


class LegacyInstanceStateTest(unittest.TestCase):
    """旧版状态文件必须仍能停止、查询与迁移，不能把新版升级变成死循环。"""

    LEGACY_1_0 = {
        "schema_version": "1.0",
        "name": "legacy",
        "project": "dsh-dev-legacy",
        "source_id": "experiment:EXP-security-operations-expert-001",
        "source_kind": "experiment",
        "mode": "authoring",
        "purpose": "dev",
        "preset_default": "cordis",
        "port": 3301,
        "image_tag": "ai-agent-harness/dsh:c291e7961",
        "agent_id": "security-operations-expert",
        "mounts": {"workspace": "/tmp/ws", "presets": "/tmp/presets", "managed": "/tmp/managed"},
        "context_mounts": [{"key": "reference", "host": "/tmp/reference", "container": "/work/reference", "mode": "ro"}],
        "mount_modes": {"workspace": "rw", "presets": "ro", "managed": "ro"},
        "patch_overlay": "/opt/dsh-managed/x.development.patch.yml",
        "cordis_trust_accepted": True,
        "required_env_names": [],
    }

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        dev.STATE_ROOT = Path(self._temp.name)
        target = dev.STATE_ROOT / "legacy"
        target.mkdir(parents=True)
        (target / "compose.yaml").write_text("services: {}\n", encoding="utf-8")
        (target / "instance.json").write_text(
            json.dumps(self.LEGACY_1_0, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def tearDown(self):
        self._temp.cleanup()

    def test_legacy_state_builds_compose_env_without_guessing(self):
        """回归：旧状态缺少 adapter_root/managed_patch 时不报错，缺的字段交给 Compose 报。"""
        environment = dev.instance_compose_env(self.LEGACY_1_0)
        self.assertEqual(environment["DSH_IMAGE_TAG"], "ai-agent-harness/dsh:c291e7961")
        self.assertEqual(environment["DSH_ADAPTER_HOST"], str(ADAPTER))
        self.assertEqual(environment["DSH_WORKSPACE_HOST"], "/tmp/ws")
        self.assertEqual(environment["DSH_REFERENCE_HOST"], "/tmp/reference")
        # 记录里没有 managed_patch，就不猜一个路径出来。
        self.assertNotIn("DSH_MANAGED_PATCH", environment)

    def test_legacy_instance_can_be_stopped(self):
        """回归：旧状态实例必须能被 down 停掉，否则用户会卡在"拒绝旧状态 + 端口被占"。"""
        stopped = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        empty = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        volume = subprocess.CompletedProcess([], 0, stdout="dsh-dev-legacy-home\n", stderr="")
        stdout = io.StringIO()
        with mock.patch.object(dev, "run", side_effect=[stopped, empty, volume]), \
                contextlib.redirect_stdout(stdout):
            dev.command_down(types.SimpleNamespace(name="legacy"))
        report = json.loads(stdout.getvalue())
        self.assertTrue(report["stopped"])
        self.assertTrue(report["home_preserved"])

    def test_ps_marks_legacy_state_for_migration_and_keeps_listing(self):
        stopped = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        listed = subprocess.CompletedProcess([], 0, stdout="not running", stderr="")
        stdout = io.StringIO()
        with mock.patch.object(dev, "run", side_effect=[stopped, listed]), \
                contextlib.redirect_stdout(stdout):
            dev.command_ps(types.SimpleNamespace())
        instances = json.loads(stdout.getvalue())["instances"]
        self.assertEqual(len(instances), 1)
        self.assertEqual(instances[0]["state_schema"], "1.0")
        self.assertTrue(instances[0]["needs_migration"])

    def test_ps_reports_broken_record_without_aborting_the_list(self):
        (dev.STATE_ROOT / "broken").mkdir()
        (dev.STATE_ROOT / "broken" / "instance.json").write_text("{not json", encoding="utf-8")
        stopped = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        listed = subprocess.CompletedProcess([], 0, stdout="not running", stderr="")
        stdout = io.StringIO()
        with mock.patch.object(dev, "run", side_effect=[stopped, listed]), \
                contextlib.redirect_stdout(stdout):
            dev.command_ps(types.SimpleNamespace())
        instances = {item["name"]: item for item in json.loads(stdout.getvalue())["instances"]}
        self.assertIn("error", instances["broken"])
        self.assertIn("legacy", instances)


class UpPortOwnershipTest(unittest.TestCase):
    """端口归属决定出路：本实例自身占用可重载，其他占用者只能换端口。"""

    def setUp(self):
        self._temp = tempfile.TemporaryDirectory()
        dev.STATE_ROOT = Path(self._temp.name)

    def tearDown(self):
        self._temp.cleanup()

    @staticmethod
    def contract():
        return {
            "source_id": "experiment:EXP-security-operations-expert-001",
            "source_kind": "experiment",
            "agent_id": "security-operations-expert",
            "preset_id": "security-operations-expert",
            "workspace": "/tmp/ws", "presets": "/tmp/presets", "managed": "/tmp/managed",
            "reference_root": "/tmp/reference",
            "patch": "/opt/dsh-managed/security-operations-expert.patch.yml",
            "patch_overlay": None, "required_env_names": [],
            "image": {"local_image_tag": "ai-agent-harness/dsh:c291e7961"},
        }

    def args(self, **overrides):
        base = dict(source="experiment:EXP-security-operations-expert-001", mode="verification",
                    name="probe", port=3302, allow_missing_env=True, accept_cordis_trust=False,
                    replace=False)
        base.update(overrides)
        return types.SimpleNamespace(**base)

    def write_existing(self, name="probe", **overrides):
        dev.STATE_ROOT.mkdir(parents=True, exist_ok=True)
        target = dev.STATE_ROOT / name
        target.mkdir(exist_ok=True)
        manifest = dict(self.contract(), schema_version="1.2", name=name,
                        project=dev.project_name(name), mode="verification", purpose="eval",
                        target_preset="security-operations-expert", port=3302,
                        image_tag="ai-agent-harness/dsh:c291e7961",
                        adapter_root=str(ADAPTER),
                        managed_patch="/opt/dsh-managed/security-operations-expert.patch.yml",
                        mounts={"workspace": "/tmp/ws", "presets": "/tmp/presets", "managed": "/tmp/managed"},
                        context_mounts=[], patch_overlay=None)
        manifest.update(overrides)
        (target / "instance.json").write_text(json.dumps(manifest), encoding="utf-8")

    def test_dry_run_generates_name_and_port_without_starting(self):
        args = self.args(name=None, port=None, dry_run=True)
        stdout = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "preflight_new_instance") as preflight, \
                mock.patch.object(dev, "write_instance") as writer, \
                mock.patch.object(dev, "run") as runner, \
                contextlib.redirect_stdout(stdout):
            dev.command_up(args)
        plan = json.loads(stdout.getvalue())
        self.assertEqual(plan["name"], "security-operations-expert-eval")
        self.assertEqual(plan["port"], 3081)
        preflight.assert_not_called()
        writer.assert_not_called()
        runner.assert_not_called()

    def test_auto_port_skips_instance_records_and_listeners(self):
        self.write_existing(port=3081)
        with mock.patch.object(dev, "port_in_use", side_effect=lambda port: port == 3082):
            self.assertEqual(dev.first_available_port("new-probe"), 3083)

    def test_existing_default_name_reuses_recorded_port(self):
        name = "security-operations-expert-eval"
        self.write_existing(name=name, port=3090)
        args = self.args(name=None, port=None)
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "port_in_use") as probe:
            _, current = dev.prepare_up(args)
        self.assertIsNotNone(current)
        self.assertEqual(args.name, name)
        self.assertEqual(args.port, 3090)
        probe.assert_not_called()

    def test_auto_port_race_fails_without_silent_reselection(self):
        args = self.args(name="new-probe", port=None)
        stdout = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "port_in_use", side_effect=[False, True]), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "running_instance_service", return_value=None), \
                mock.patch.object(dev, "write_instance") as writer, \
                contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                dev.command_up(args)
        self.assertEqual(args.port, 3081)
        self.assertEqual(stdout.getvalue(), "")
        writer.assert_not_called()

    def test_own_instance_holding_the_port_gets_an_actionable_error(self):
        self.write_existing()
        stderr = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "port_in_use", return_value=True), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "running_instance_service", return_value="dsh"), \
                mock.patch.object(dev, "write_instance") as writer, \
                contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args())
        message = stderr.getvalue()
        self.assertIn("--replace", message)
        self.assertIn("down", message)
        writer.assert_not_called()

    def test_other_holder_keeps_the_plain_port_error(self):
        stderr = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "port_in_use", return_value=True), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "running_instance_service", return_value=None), \
                contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args())
        self.assertIn("已被占用", stderr.getvalue())

    def test_replace_rejects_mode_conflict_before_stopping(self):
        self.write_existing(mode="verification")
        stopper = mock.Mock()
        stderr = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "stop_instance", stopper), \
                mock.patch.object(dev, "preflight_new_instance") as preflight, \
                contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args(replace=True, mode="authoring", accept_cordis_trust=True))
        self.assertIn("来源/模式不同", stderr.getvalue())
        stopper.assert_not_called()
        preflight.assert_not_called()

    def test_replace_rejects_source_conflict_before_stopping(self):
        self.write_existing()
        other = dict(self.contract(), source_id="experiment:EXP-other-agent-001")
        stopper = mock.Mock()
        stderr = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=other), \
                mock.patch.object(dev, "stop_instance", stopper), \
                mock.patch.object(dev, "preflight_new_instance") as preflight, \
                contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args(replace=True, source="experiment:EXP-other-agent-001"))
        self.assertIn("来源/模式不同", stderr.getvalue())
        stopper.assert_not_called()
        preflight.assert_not_called()

    def test_replace_preflights_new_config_before_stopping(self):
        self.write_existing()
        order = []
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "preflight_new_instance", side_effect=lambda *_: order.append("preflight")), \
                mock.patch.object(dev, "migrate_existing_instance",
                                  side_effect=lambda *_: order.append("stop") or {"previous_state_schema": "1.2"}), \
                mock.patch.object(dev, "port_in_use", side_effect=SystemExit):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args(replace=True))
        self.assertEqual(order, ["preflight", "stop"])

    def test_replace_stops_own_instance_before_starting(self):
        self.write_existing()
        order = []
        stdout = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "migrate_existing_instance",
                                  side_effect=lambda *_: order.append("stop") or {
                                      "previous_state_schema": "1.2", "stop": {"stopped": True}}), \
                mock.patch.object(dev, "port_in_use", return_value=False), \
                mock.patch.object(dev, "preflight_new_instance"), \
                mock.patch.object(dev, "write_instance",
                                  side_effect=lambda *a, **k: order.append("write") or dev.STATE_ROOT / "probe"), \
                mock.patch.object(dev, "compose_env", return_value={}), \
                mock.patch.object(dev, "run", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")), \
                mock.patch.object(dev, "wait_for_service", return_value=[{
                    "id": "abc", "state": "running", "status": "Up", "name": "x-dsh-1", "service": "dsh"}]), \
                contextlib.redirect_stdout(stdout):
            dev.command_up(self.args(replace=True))
        self.assertEqual(order, ["stop", "write"])
        report = json.loads(stdout.getvalue())
        self.assertEqual(report["replaced"], {
            "previous_state_schema": "1.2", "stop": {"stopped": True}})
        self.assertEqual(report["session_preset"], "security-operations-expert")
        self.assertEqual(report["target_preset"], "security-operations-expert")

    def test_replace_refuses_to_change_the_recorded_port(self):
        self.write_existing(port=3399)
        stderr = io.StringIO()
        with mock.patch.object(dev, "resolve", return_value=self.contract()), \
                mock.patch.object(dev, "stop_instance") as stopper, \
                contextlib.redirect_stderr(stderr):
            with self.assertRaises(SystemExit):
                dev.command_up(self.args(replace=True, port=3302))
        self.assertIn("不得改端口", stderr.getvalue())
        stopper.assert_not_called()

    def test_replace_result_nests_stop_report(self):
        self.write_existing()
        stopped = {"name": "probe", "stopped": True, "home_preserved": True}
        with mock.patch.object(dev, "stop_instance", return_value=stopped):
            result = dev.migrate_existing_instance(self.args(replace=True), self.contract())
        self.assertEqual(result, {"previous_state_schema": "1.2", "stop": stopped})


class CliSurfaceTest(unittest.TestCase):
    def test_root_help_lists_init_and_not_plan(self):
        completed = subprocess.run(
            [sys.executable, str(ADAPTER / "dsh-dev"), "--help"],
            capture_output=True, text=True, check=False, timeout=60)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("init", completed.stdout)
        self.assertNotIn("  plan", completed.stdout)

    def test_source_help_lists_only_supported_selectors(self):
        completed = subprocess.run(
            [sys.executable, str(ADAPTER / "dsh-dev"), "up", "--help"],
            capture_output=True, text=True, check=False, timeout=60)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("experiment:<id>", completed.stdout)
        self.assertNotIn("snapshot:", completed.stdout)
        self.assertNotIn("authoring", completed.stdout)
        self.assertNotIn("verification", completed.stdout)

    def test_plan_command_is_removed(self):
        completed = subprocess.run(
            [sys.executable, str(ADAPTER / "dsh-dev"), "plan", "--help"],
            capture_output=True, text=True, check=False, timeout=60)
        self.assertEqual(completed.returncode, 2)
        self.assertIn("invalid choice", completed.stderr)

    def test_missing_source_and_mode_list_registered_values(self):
        completed = subprocess.run(
            [sys.executable, str(ADAPTER / "dsh-dev"), "up", "--source", "--mode"],
            capture_output=True, text=True, check=False, timeout=60)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(completed.stdout, "")
        self.assertIn("experiment:EXP-security-operations-expert-001", completed.stderr)
        self.assertIn("dev、eval", completed.stderr)

    def test_up_help_documents_replace(self):
        completed = subprocess.run(
            [sys.executable, str(ADAPTER / "dsh-dev"), "up", "--help"],
            capture_output=True, text=True, check=False, timeout=60)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("--replace", completed.stdout)
        self.assertIn("--dry-run", completed.stdout)


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
