#!/usr/bin/env python3
"""迁移摄取器的脱敏与旧清单 CAS 回归；不读取或执行旧来源。"""

from __future__ import annotations

import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("import_sources.py")
SPEC = importlib.util.spec_from_file_location("import_sources", SOURCE)
assert SPEC is not None and SPEC.loader is not None
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class ImportSourceRegression(unittest.TestCase):
    def test_public_json_schema_uri_is_preserved_and_other_urls_redacted(self) -> None:
        schema = {
            "$schema": IMPORTER.PUBLIC_JSON_SCHEMA_URI,
            "description": "ssh://git@10.1.2.3:2222/internal/private.git",
        }
        rewritten, rules = IMPORTER.sanitize_json_schema(schema)
        self.assertEqual(rewritten["$schema"], IMPORTER.PUBLIC_JSON_SCHEMA_URI)
        self.assertEqual(rewritten["description"], "<REDACTED_PRIVATE_URI>")
        self.assertIn("private-uri", rules)

    def test_non_allowlisted_schema_uri_is_rejected(self) -> None:
        for value in (
            "https://json-schema.org/draft/2020-12/schema#",
            "ssh://git@10.1.2.3/private",
            "<REDACTED_URL>",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                IMPORTER.sanitize_json_schema({"$schema": value})

    def test_full_private_ip_not_three_part_version(self) -> None:
        rewritten, rules = IMPORTER.sanitize_text("npm 10.9.4；示例 10.20.1.999")
        self.assertEqual(rewritten, "npm 10.9.4；示例 <REDACTED_PRIVATE_IP>")
        self.assertIn("private-ip", rules)

    def test_refresh_requires_both_locked_old_manifest_hashes(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            repo = Path(name)
            inventory = repo / "inventory.json"
            manifest = repo / "manifest.json"
            original = b'{"version":"old"}\n'
            inventory.write_bytes(original)
            manifest.write_bytes(original)
            digest = hashlib.sha256(original).hexdigest()
            self.assertEqual(
                IMPORTER.lock_existing_manifests(repo, inventory, manifest, digest, True),
                {"inventory.json": digest, "manifest.json": digest},
            )
            with self.assertRaises(ValueError):
                IMPORTER.lock_existing_manifests(repo, inventory, manifest, None, True)
            inventory.write_bytes(b'{"version":"user-edit"}\n')
            with self.assertRaises(ValueError):
                IMPORTER.lock_existing_manifests(repo, inventory, manifest, digest, True)

    def test_refresh_rejects_user_created_new_target_not_in_old_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            repo = Path(name)
            old_target = repo / "registered.txt"
            user_created = repo / "new-output.txt"
            absent_new_target = repo / "not-yet-created.txt"
            old_target.write_bytes(b"previous importer output")
            user_created.write_bytes(b"user data must survive")
            prior_hashes = {"registered.txt": hashlib.sha256(old_target.read_bytes()).hexdigest()}

            IMPORTER.verify_generated_targets(repo, [old_target, absent_new_target], prior_hashes)
            with self.assertRaisesRegex(ValueError, "不在旧清单"):
                IMPORTER.verify_generated_targets(repo, [old_target, user_created], prior_hashes)
            self.assertEqual(user_created.read_bytes(), b"user data must survive")

            old_target.write_bytes(b"user edited registered output")
            with self.assertRaisesRegex(ValueError, "已修改"):
                IMPORTER.verify_generated_targets(repo, [old_target], prior_hashes)

    def test_delivery_record_limits_new_session_to_verification(self) -> None:
        record = (SOURCE.parent.parent / "candidate" / "delivery" / "交付记录.md").read_text(encoding="utf-8")
        self.assertIn("隔离 Authoring 当前 Session 可实时看到探索行为", record)
        self.assertIn("进入 Candidate Verification 或正式评估前必须使用复核后的快照、新容器和新 Session", record)
        self.assertIn("不授予 Candidate Verification 或正式评估的激活", record)
        self.assertNotIn("变更后必须重建新 Session", record)
        self.assertNotIn("不授予激活或晋升权", record)


if __name__ == "__main__":
    unittest.main()
