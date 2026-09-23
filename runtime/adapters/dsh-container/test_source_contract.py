"""来源合同只依赖 sources.json 描述：新增第二个 Harness 不改适配工具中的业务名。"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import source_contract


class SourceContractTest(unittest.TestCase):
    def test_env_name_cli_outputs_names_only(self):
        completed = subprocess.run(
            [sys.executable, str(source_contract.ADAPTER / "source_contract.py"), "--env-names"],
            capture_output=True, text=True, check=True,
        )
        self.assertEqual(
            completed.stdout.splitlines(), source_contract.resolve()["required_env_names"]
        )
        self.assertNotIn("=", completed.stdout)

    def test_current_source_resolves_without_private_values(self):
        result = source_contract.resolve()
        self.assertEqual(result["source_id"], "experiment:EXP-security-operations-expert-001")
        self.assertEqual(result["source_kind"], "experiment")
        self.assertEqual(result["patch"], "/opt/dsh-managed/security-operations-expert.patch.yml")
        self.assertNotIn("patch_overlay", result)
        self.assertTrue(result["reference_root"].endswith("agents/security-operations-expert"))
        self.assertEqual(result["schema_version"], "2.1")
        self.assertNotIn("TOKEN=", json.dumps(result))

    def test_image_fingerprint_is_derived_and_changes_with_build_input(self):
        result = source_contract.resolve()
        fingerprint = result["image"]["build_fingerprint"]
        self.assertRegex(fingerprint, r"^sha256:[0-9a-f]{64}$")
        with tempfile.TemporaryDirectory(prefix="dsh-image-inputs-") as location:
            adapter = Path(location)
            for name in source_contract.IMAGE_BUILD_FILES:
                (adapter / name).write_bytes((source_contract.ADAPTER / name).read_bytes())
            lock_path = adapter / "source.lock.json"
            lock_path.write_bytes(source_contract.LOCK.read_bytes())
            first = source_contract.image_build_fingerprint(
                source_contract._read_source_lock(lock_path), lock_path=lock_path, adapter=adapter
            )
            (adapter / "Dockerfile").write_text("changed\n", encoding="utf-8")
            second = source_contract.image_build_fingerprint(
                source_contract._read_source_lock(lock_path), lock_path=lock_path, adapter=adapter
            )
        self.assertNotEqual(first, second)

    def test_image_input_digest_cli_is_json_without_private_values(self):
        completed = subprocess.run(
            [sys.executable, str(source_contract.ADAPTER / "source_contract.py"), "--image-input-digests"],
            capture_output=True, text=True, check=True,
        )
        values = json.loads(completed.stdout)
        self.assertIn("Dockerfile", values)
        self.assertTrue(all(value.startswith("sha256:") for value in values.values()))

    def test_reference_root_requires_both_agent_sources(self):
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            repo = Path(location)
            agent = repo / "agents/example-agent"
            agent.mkdir(parents=True)
            (agent / "definition.md").write_text("需求", encoding="utf-8")
            self.assertIsNone(
                source_contract._agent_asset_roots(repo, "example-agent")["reference_root"]
            )
            (agent / "evaluation.md").write_text("评测", encoding="utf-8")
            self.assertEqual(
                source_contract._agent_asset_roots(repo, "example-agent")["reference_root"],
                str(agent),
            )

    def test_preset_identity_is_derived_from_the_source_declaration(self):
        result = source_contract.resolve()
        self.assertEqual(result["preset_id"], "security-operations-expert")
        self.assertEqual(result["preset"], "/opt/dsh-presets/security-operations-expert/agent.cordis.yml")

    def test_retired_snapshot_selector_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "unknown source selector"):
            source_contract.resolve("snapshot:snap-00000000-0000-4000-8000-000000000000")

    def test_preset_must_declare_an_agent_subdirectory(self):
        with self.assertRaisesRegex(ValueError, "preset-id"):
            source_contract.preset_id("agent.cordis.yml")

    def test_second_source_needs_catalog_data_only(self):
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            repo = Path(location)
            source_id = "EXP-second-harness-002"
            root = repo / "evolution/experiments" / source_id / "candidate/dsh"
            for name in ("workspace", "presets/second-harness", "managed"):
                (root / name).mkdir(parents=True)
            (root / "presets/second-harness/agent.cordis.yml").write_text("guard", encoding="utf-8")
            (root / "managed/second.patch.yml").write_text("[]", encoding="utf-8")
            catalog = {"schema_version": "1.1", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "second-harness/agent.cordis.yml", "guard": None,
                "config_markers": ["second-harness"], "required_env_names": [],
            }}}
            catalog_path = repo / "sources.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            result = source_contract.resolve(source_id, repo=repo, sources=catalog_path)
            self.assertEqual(result["agent_id"], "second-harness")
            self.assertEqual(result["required_env_names"], [])
            self.assertIsNone(result["guard"])

    def test_preset_id_may_differ_from_agent_id(self):
        """运行时 preset ID 与业务 Agent ID 是显式映射，不要求字符串相等。"""
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            repo = Path(location)
            source_id = "EXP-second-harness-002"
            root = repo / "evolution/experiments" / source_id / "candidate/dsh"
            for name in ("workspace", "presets/second-harness-variant", "managed"):
                (root / name).mkdir(parents=True)
            (root / "presets/second-harness-variant/agent.cordis.yml").write_text("guard", encoding="utf-8")
            (root / "managed/second.patch.yml").write_text("[]", encoding="utf-8")
            catalog = {"schema_version": "1.1", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "second-harness-variant/agent.cordis.yml", "guard": None,
                "config_markers": ["second-harness"], "required_env_names": [],
            }}}
            catalog_path = repo / "sources.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            result = source_contract.resolve(source_id, repo=repo, sources=catalog_path)
            self.assertEqual(result["agent_id"], "second-harness")
            self.assertEqual(result["preset_id"], "second-harness-variant")

    def test_wrong_experiment_directory_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            catalog_path = Path(location) / "sources.json"
            catalog = json.loads(source_contract.SOURCES.read_text(encoding="utf-8"))
            catalog["sources"][source_contract.DEFAULT_SOURCE]["candidate_root"] = "evolution/experiments/other/candidate/dsh"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "does not belong"):
                source_contract.resolve(sources=catalog_path)

    def test_nested_source_file_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            repo = Path(location)
            source_id = "EXP-second-harness-002"
            root = repo / "evolution/experiments" / source_id / "candidate/dsh"
            for name in ("workspace", "presets", "managed"):
                (root / name).mkdir(parents=True)
            external = repo / "external"
            external.mkdir()
            (external / "agent.cordis.yml").write_text("preset", encoding="utf-8")
            (root / "presets/linked").symlink_to(external, target_is_directory=True)
            (root / "managed/second.patch.yml").write_text("[]", encoding="utf-8")
            catalog = {"schema_version": "1.1", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "linked/agent.cordis.yml", "guard": None,
                "config_markers": ["second-harness"], "required_env_names": [],
            }}}
            catalog_path = repo / "sources.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsafe source file"):
                source_contract.resolve(source_id, repo=repo, sources=catalog_path)

    def test_hardlinked_selected_asset_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            repo = Path(location)
            source_id = "EXP-second-harness-002"
            root = repo / "evolution/experiments" / source_id / "candidate/dsh"
            for name in ("workspace", "presets", "managed"):
                (root / name).mkdir(parents=True)
            (root / "presets/agent.cordis.yml").write_text("preset", encoding="utf-8")
            patch = root / "managed/second.patch.yml"
            patch.write_text("[]", encoding="utf-8")
            os.link(patch, root / "managed/shared.patch.yml")
            catalog = {"schema_version": "1.1", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "agent.cordis.yml", "guard": None,
                "config_markers": ["second-harness"], "required_env_names": [],
            }}}
            catalog_path = repo / "sources.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source file"):
                source_contract.resolve(source_id, repo=repo, sources=catalog_path)


if __name__ == "__main__":
    unittest.main()
