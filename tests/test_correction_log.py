"""AI 纠错记录的字段约束、去重、安全拒绝与写入失败行为。"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / ".agents" / "skills" / "ai-correction-log" / "scripts" / "record_correction.py"
LOG_DIR = "AI纠错记录"


def valid_record(**overrides: object) -> dict:
    record = {
        "时间": "2026-09-17 10:30",
        "原提问要点": "新增输入时同步更新对应场景预置文档",
        "AI错误要点": "补充预置落到独立文件，未并入 flt.md；ins.md 未登记映射",
        "我的纠正要点": "补充输入必须同时更新对应场景预置文件并登记映射",
        "AI反思": "把生成物归属当成绕开理由，未先修生成逻辑",
        "根因": "未先解决脚本覆盖风险就选择绕行，并把无需新分支误当成无需登记",
        "改进方法": "新增内容先判定目标文件是否由脚本生成，若是先改生成逻辑再写内容",
        "标签": ["遗漏约束", "资产结构"],
    }
    record.update(overrides)
    return record


def run_record(repo: Path, record: dict | str, *extra: str, script: Path = SCRIPT, use_stdin: bool = False):
    payload = record if isinstance(record, str) else json.dumps(record, ensure_ascii=False)
    base = [sys.executable, str(script), "--repo", str(repo), *extra]
    if use_stdin:
        return subprocess.run(
            [*base, "--file", "-"], input=payload, text=True, capture_output=True, cwd=ROOT, check=False, timeout=60
        )
    return subprocess.run(
        [*base, "--json", payload], text=True, capture_output=True, cwd=ROOT, check=False, timeout=60
    )


def day_lines(repo: Path, day: str = "2026-09-17") -> list[dict]:
    path = repo / LOG_DIR / f"{day}.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class CorrectionLogTests(unittest.TestCase):
    def test_append_creates_day_file_with_fixed_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            completed = run_record(repo, valid_record())
            self.assertEqual(completed.returncode, 0, completed.stderr)
            summary = json.loads(completed.stdout)
            self.assertEqual(summary["status"], "appended")
            path = repo / LOG_DIR / "2026-09-17.jsonl"
            self.assertTrue(path.is_file())
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)
            row = json.loads(lines[0])
            self.assertEqual(
                list(row),
                ["时间", "原提问要点", "AI错误要点", "我的纠正要点", "AI反思", "根因", "改进方法", "标签"],
            )
            self.assertEqual(row["标签"], ["遗漏约束", "资产结构"])

    def test_stdin_input_and_time_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            completed = run_record(repo, valid_record(), "--time", "2026-09-18 09:05", use_stdin=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue((repo / LOG_DIR / "2026-09-18.jsonl").is_file())

    def test_time_is_auto_filled_when_omitted(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            record = valid_record()
            del record["时间"]
            completed = run_record(repo, record)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            day = datetime.now().strftime("%Y-%m-%d")
            path = repo / LOG_DIR / f"{day}.jsonl"
            self.assertTrue(path.is_file(), completed.stderr)
            row = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
            self.assertRegex(row["时间"], r"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$")

    def test_same_correction_is_written_once_per_day(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            self.assertEqual(run_record(repo, valid_record()).returncode, 0)
            second = run_record(repo, valid_record(时间="2026-09-17 11:00"))
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(json.loads(second.stdout)["status"], "skipped-duplicate")
            self.assertEqual(len(day_lines(repo)), 1)

    def test_distinct_corrections_append_to_same_day_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            self.assertEqual(run_record(repo, valid_record()).returncode, 0)
            other = valid_record(**{"AI错误要点": "另一处错误点", "我的纠正要点": "另一条修正要求"})
            self.assertEqual(run_record(repo, other).returncode, 0)
            self.assertEqual(len(day_lines(repo)), 2)

    def test_missing_required_field_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            record = valid_record()
            del record["根因"]
            completed = run_record(repo, record)
            self.assertEqual(completed.returncode, 2)
            self.assertIn("缺少必填字段", completed.stderr)
            self.assertFalse((repo / LOG_DIR).exists())

    def test_extra_field_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            completed = run_record(repo, valid_record(备注="多余"))
            self.assertEqual(completed.returncode, 2)
            self.assertIn("字段不膨胀", completed.stderr)

    def test_overlong_value_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            completed = run_record(repo, valid_record(**{"AI错误要点": "错" * 201}))
            self.assertEqual(completed.returncode, 2)
            self.assertIn("超过 200 字上限", completed.stderr)

    def test_placeholder_and_multiline_values_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            self.assertEqual(run_record(repo, valid_record(根因="N/A")).returncode, 2)
            completed = run_record(repo, valid_record(**{"AI反思": "第一行\n第二行"}))
            self.assertEqual(completed.returncode, 2)
            self.assertIn("压成一行", completed.stderr)

    def test_invalid_time_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            completed = run_record(repo, valid_record(时间="2026/09/17 10:30"))
            self.assertEqual(completed.returncode, 2)
            self.assertIn("YYYY-MM-DD HH:MM", completed.stderr)

    def test_labels_are_optional_and_capped(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            record = valid_record()
            del record["标签"]
            self.assertEqual(run_record(repo, record).returncode, 0)
            self.assertNotIn("标签", day_lines(repo)[0])
            too_many = valid_record(标签=[f"t{index}" for index in range(6)])
            completed = run_record(repo, too_many)
            self.assertEqual(completed.returncode, 2)
            self.assertIn("标签最多 5 个", completed.stderr)

    def test_likely_secret_is_rejected_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            cases = (
                valid_record(**{"AI错误要点": "把 api_key: abcdef1234567890 写进了回复"}),
                valid_record(**{"我的纠正要点": "Authorization: Bearer abcdefghijklmnop1234"}),
                valid_record(**{"改进方法": "不要回显 https://user:passw0rd@example.com/path"}),
            )
            for index, record in enumerate(cases):
                with self.subTest(index=index):
                    completed = run_record(repo, record)
                    self.assertEqual(completed.returncode, 3, completed.stdout)
                    self.assertIn("疑似敏感信息", completed.stderr)
                    self.assertNotIn("abcdef1234567890", completed.stderr)
            self.assertFalse((repo / LOG_DIR).exists())

    def test_corrupt_day_file_is_reported_not_silently_appended(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            path = repo / LOG_DIR / "2026-09-17.jsonl"
            path.parent.mkdir(parents=True)
            path.write_text("{not json}\n", encoding="utf-8")
            completed = run_record(repo, valid_record())
            self.assertEqual(completed.returncode, 4)
            self.assertIn("不是合法 JSON", completed.stderr)
            self.assertEqual(path.read_text(encoding="utf-8"), "{not json}\n")

    def test_write_failure_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp)
            (repo / LOG_DIR / "2026-09-17.jsonl").mkdir(parents=True)
            completed = run_record(repo, valid_record())
            self.assertEqual(completed.returncode, 4)
            self.assertIn("记录路径被目录或链接占用", completed.stderr)

    def test_repo_root_is_inferred_from_script_location(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            installed = Path(temp) / "repo" / ".agents" / "skills" / "ai-correction-log" / "scripts"
            installed.mkdir(parents=True)
            script = installed / "record_correction.py"
            shutil.copy2(SCRIPT, script)
            completed = subprocess.run(
                [sys.executable, str(script), "--json", json.dumps(valid_record(), ensure_ascii=False)],
                text=True,
                capture_output=True,
                cwd=temp,
                check=False,
                timeout=60,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue((Path(temp) / "repo" / LOG_DIR / "2026-09-17.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
