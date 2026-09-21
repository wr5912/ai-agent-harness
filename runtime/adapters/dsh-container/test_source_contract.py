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
        self.assertEqual(result["patch_overlay"],
                         "/opt/dsh-managed/security-operations-expert.development.patch.yml")
        self.assertTrue(result["reference_root"].endswith("agents/security-operations-expert"))
        self.assertEqual(result["schema_version"], "2.0")
        self.assertNotIn("TOKEN=", json.dumps(result))

    def test_development_overlay_must_exist_inside_managed(self):
        with tempfile.TemporaryDirectory(prefix="dsh-source-contract-") as location:
            catalog_path = Path(location) / "sources.json"
            catalog = json.loads(source_contract.SOURCES.read_text(encoding="utf-8"))
            item = catalog["sources"]["EXP-security-operations-expert-001"]
            item["development_patch_overlay"] = "missing.development.patch.yml"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaises(ValueError):
                source_contract.resolve("experiment:EXP-security-operations-expert-001",
                                         sources=catalog_path)

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
            (root / "managed/second.development.patch.yml").write_text("[]", encoding="utf-8")
            catalog = {"schema_version": "1.0", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "second-harness/agent.cordis.yml", "guard": None,
                "development_patch_overlay": "second.development.patch.yml",
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
            (root / "managed/second.development.patch.yml").write_text("[]", encoding="utf-8")
            catalog = {"schema_version": "1.0", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "second-harness-variant/agent.cordis.yml", "guard": None,
                "development_patch_overlay": "second.development.patch.yml",
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
            (root / "managed/second.development.patch.yml").write_text("[]", encoding="utf-8")
            catalog = {"schema_version": "1.0", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "linked/agent.cordis.yml", "guard": None,
                "development_patch_overlay": "second.development.patch.yml",
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
            catalog = {"schema_version": "1.0", "sources": {source_id: {
                "agent_id": "second-harness",
                "candidate_root": f"evolution/experiments/{source_id}/candidate/dsh",
                "profile": "web", "patch": "second.patch.yml",
                "preset": "agent.cordis.yml", "guard": None,
                "development_patch_overlay": "second.development.patch.yml",
                "config_markers": ["second-harness"], "required_env_names": [],
            }}}
            catalog_path = repo / "sources.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source file"):
                source_contract.resolve(source_id, repo=repo, sources=catalog_path)


if __name__ == "__main__":
    unittest.main()
