"""只使用临时目录测试三树回执，不在真实 Experiment 写入证据。"""

import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("mutation-receipt.py")
SPEC = importlib.util.spec_from_file_location("dsh_mutation_receipt", MODULE_PATH)
receipt = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receipt)


class MutationReceiptTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-receipt-test-")
        self.root = Path(self.temporary.name)
        self.original = (receipt.DSH_ROOT, receipt.WORKSPACE, receipt.ALLOWED_ROOTS, receipt.RECEIPTS)
        receipt.DSH_ROOT = self.root / "candidate/dsh"
        receipt.WORKSPACE = receipt.DSH_ROOT / "workspace"
        receipt.ALLOWED_ROOTS = {
            receipt.WORKSPACE,
            receipt.DSH_ROOT / "presets",
            receipt.DSH_ROOT / "managed",
        }
        receipt.RECEIPTS = self.root / "evaluation/mutation-receipts"
        for folder in receipt.ALLOWED_ROOTS:
            folder.mkdir(parents=True)
        (receipt.WORKSPACE / "AGENTS.md").write_text("candidate", encoding="utf-8")
        (receipt.DSH_ROOT / "presets/preset.yml").write_text("preset", encoding="utf-8")
        (receipt.DSH_ROOT / "managed/guard.mjs").write_text("guard", encoding="utf-8")

    def tearDown(self):
        receipt.DSH_ROOT, receipt.WORKSPACE, receipt.ALLOWED_ROOTS, receipt.RECEIPTS = self.original
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

    def test_default_256_level_directory_bound_rejects_level_257(self):
        folder = receipt.WORKSPACE
        for _ in range(receipt.DEFAULT_LIMITS["max_depth"] + 1):
            folder = folder / "d"
            folder.mkdir()
        with self.assertRaisesRegex(ValueError, "depth limit"):
            receipt.snapshot(receipt.WORKSPACE)


if __name__ == "__main__":
    unittest.main()
