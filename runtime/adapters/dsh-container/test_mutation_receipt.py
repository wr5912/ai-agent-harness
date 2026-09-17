"""只使用临时目录测试三树回执，不在真实 Experiment 写入证据。"""

import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("mutation-receipt.py")
SPEC = importlib.util.spec_from_file_location("dsh_mutation_receipt", MODULE_PATH)
receipt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receipt)


class MutationReceiptTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-receipt-test-")
        self.root = Path(self.temporary.name)
        self.original = (receipt.REPO, receipt.DSH_ROOT, receipt.WORKSPACE, receipt.ALLOWED_ROOTS, receipt.RECEIPTS, receipt.FROZEN)
        receipt.DSH_ROOT = self.root / "candidate/dsh"
        receipt.WORKSPACE = receipt.DSH_ROOT / "workspace"
        receipt.ALLOWED_ROOTS = {
            receipt.WORKSPACE,
            receipt.DSH_ROOT / "presets",
            receipt.DSH_ROOT / "managed",
        }
        receipt.RECEIPTS = self.root / "evaluation/mutation-receipts"
        receipt.FROZEN = self.root / "snapshots/frozen-sources"
        for folder in receipt.ALLOWED_ROOTS:
            folder.mkdir(parents=True)
        (receipt.WORKSPACE / "AGENTS.md").write_text("candidate", encoding="utf-8")
        (receipt.DSH_ROOT / "presets/preset.yml").write_text("preset", encoding="utf-8")
        (receipt.DSH_ROOT / "managed/guard.mjs").write_text("guard", encoding="utf-8")

    def tearDown(self):
        receipt.REPO, receipt.DSH_ROOT, receipt.WORKSPACE, receipt.ALLOWED_ROOTS, receipt.RECEIPTS, receipt.FROZEN = self.original
        self.temporary.cleanup()

    def create_before(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            receipt.before()
        return Path(output.getvalue().strip())

    def test_workspace_change_is_recorded_and_controlled_trees_remain_equal(self):
        before_path = self.create_before()
        (receipt.WORKSPACE / "AGENTS.md").write_text("candidate revised", encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            receipt.after(before_path)
        after = json.loads((before_path.parent / "after.json").read_text(encoding="utf-8"))
        self.assertEqual(after["controlled_mount_integrity"], "pass")
        self.assertEqual(after["controlled_mount_violations"], [])
        self.assertEqual(after["workspace_changes"][0]["change"], "modified")
        self.assertTrue(after["candidate_freeze_must_be_rechecked"])

    def test_managed_change_is_a_fail_closed_receipt(self):
        before_path = self.create_before()
        (receipt.DSH_ROOT / "managed/guard.mjs").write_text("guard changed", encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "controlled Preset/Guard mount changed"):
                receipt.after(before_path)
        after = json.loads((before_path.parent / "after.json").read_text(encoding="utf-8"))
        self.assertEqual(after["controlled_mount_integrity"], "fail")
        self.assertEqual(after["controlled_mount_violations"], ["managed"])
        self.assertTrue(after["candidate_freeze_must_be_rechecked"])

    def test_directory_mode_changes_require_review_and_controlled_changes_fail(self):
        before_path = self.create_before()
        os.chmod(receipt.WORKSPACE, 0o750)
        os.chmod(receipt.DSH_ROOT / "managed", 0o750)
        with contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "controlled Preset/Guard mount changed"):
                receipt.after(before_path)
        after = json.loads((before_path.parent / "after.json").read_text(encoding="utf-8"))
        self.assertEqual(after["controlled_mount_violations"], ["managed"])
        self.assertEqual(after["workspace_directory_changes"][0]["path"], ".")
        self.assertTrue(after["semantic_review_required"])

    def test_sparse_file_over_64_mib_is_rejected_before_reading(self):
        asset = receipt.WORKSPACE / "oversized.bin"
        with asset.open("wb") as output:
            output.truncate(receipt.DEFAULT_LIMITS["max_file_bytes"] + 1)
        with self.assertRaisesRegex(ValueError, "64 MiB limit"):
            receipt.snapshot(receipt.WORKSPACE)

    def test_total_bytes_depth_and_nodes_have_fail_closed_limits(self):
        (receipt.DSH_ROOT / "managed/extra.txt").write_text("12345", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "total byte limit"):
            receipt.snapshot(receipt.DSH_ROOT / "managed", {"max_total_bytes": 8})
        with self.assertRaisesRegex(ValueError, "node limit"):
            receipt.snapshot(receipt.DSH_ROOT / "managed", {"max_nodes": 2})
        (receipt.WORKSPACE / "one/two/three").mkdir(parents=True)
        with self.assertRaisesRegex(ValueError, "depth limit"):
            receipt.snapshot(receipt.WORKSPACE, {"max_depth": 2})
        with self.assertRaisesRegex(ValueError, "cannot be widened"):
            receipt.snapshot(
                receipt.WORKSPACE,
                {"max_file_bytes": receipt.DEFAULT_LIMITS["max_file_bytes"] + 1},
            )

    def test_special_mode_bits_are_retained(self):
        asset = receipt.WORKSPACE / "AGENTS.md"
        os.chmod(str(asset), 0o1755)
        current = receipt.snapshot(receipt.WORKSPACE)
        self.assertEqual(current["files"][0]["mode"], "1755")

    def test_hardlinked_asset_is_rejected_before_freeze(self):
        os.link(receipt.WORKSPACE / "AGENTS.md", receipt.WORKSPACE / "shared.md")
        with self.assertRaisesRegex(ValueError, "hardlinked asset"):
            receipt.freeze()

    def test_empty_directory_is_not_silently_lost_in_frozen_copy(self):
        (receipt.WORKSPACE / "unused").mkdir()
        with self.assertRaisesRegex(ValueError, "empty asset directory"):
            receipt.freeze()
        self.assertFalse(receipt.FROZEN.exists())

    def test_directory_modes_are_part_of_frozen_identity(self):
        nested = receipt.WORKSPACE / "nested"
        nested.mkdir()
        (nested / "task.txt").write_text("task", encoding="utf-8")
        os.chmod(nested, 0o750)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            receipt.freeze()
        frozen = Path(output.getvalue().strip())
        self.assertEqual((frozen / "workspace/nested").stat().st_mode & 0o777, 0o750)
        os.chmod(frozen / "workspace/nested", 0o755)
        with self.assertRaisesRegex(ValueError, "drifted"):
            receipt.verify_frozen(frozen)

    def test_failed_freeze_cleans_read_only_new_directories(self):
        nested = receipt.WORKSPACE / "nested"
        nested.mkdir()
        (nested / "task.txt").write_text("task", encoding="utf-8")
        os.chmod(nested, 0o555)
        with patch.object(receipt, "frozen_snapshots", side_effect=ValueError("forced mismatch")):
            with self.assertRaisesRegex(ValueError, "forced mismatch"):
                receipt.freeze()
        self.assertEqual(list(receipt.FROZEN.iterdir()), [])

    def test_default_256_level_directory_bound_rejects_level_257(self):
        folder = receipt.WORKSPACE
        for _ in range(receipt.DEFAULT_LIMITS["max_depth"] + 1):
            folder = folder / "d"
            folder.mkdir()
        with self.assertRaisesRegex(ValueError, "depth limit"):
            receipt.snapshot(receipt.WORKSPACE)

    def test_freeze_keeps_actual_bytes_and_restores_deleted_candidate(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            receipt.freeze()
        frozen = Path(output.getvalue().strip())
        expected = receipt.verify_frozen(frozen)
        (receipt.WORKSPACE / "AGENTS.md").write_text("later authoring", encoding="utf-8")
        self.assertEqual((frozen / "workspace/AGENTS.md").read_text(encoding="utf-8"), "candidate")
        shutil.rmtree(receipt.DSH_ROOT)
        with contextlib.redirect_stdout(io.StringIO()):
            receipt.restore(frozen)
        self.assertEqual((receipt.WORKSPACE / "AGENTS.md").read_text(encoding="utf-8"), "candidate")
        self.assertEqual(receipt.verify_frozen(frozen), expected)

    def test_tampered_frozen_bytes_cannot_restore(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            receipt.freeze()
        frozen = Path(output.getvalue().strip())
        (frozen / "workspace/AGENTS.md").write_text("tampered", encoding="utf-8")
        shutil.rmtree(receipt.DSH_ROOT)
        with self.assertRaisesRegex(ValueError, "drifted"):
            receipt.restore(frozen)
        self.assertFalse(receipt.DSH_ROOT.exists())

    def test_freeze_rejects_private_env_and_git_ignored_file(self):
        (receipt.WORKSPACE / ".env").write_text("SECRET=value\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "controlled comment-only sentinel"):
            receipt.freeze()
        (receipt.WORKSPACE / ".env").unlink()

        receipt.REPO = self.root
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        (self.root / ".gitignore").write_text("*.private\n", encoding="utf-8")
        (receipt.WORKSPACE / "local.private").write_text("not for snapshot\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Git-ignored files"):
            receipt.freeze()
        self.assertFalse(receipt.FROZEN.exists())


if __name__ == "__main__":
    unittest.main()
