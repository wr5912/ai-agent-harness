#!/usr/bin/env python3
"""把一条 AI 纠错记录追加到项目根目录 AI纠错记录/YYYY-MM-DD.jsonl。

字段固定为 7 必填 + 1 可选；同一轮纠错只写一次；检测到疑似凭据时拒绝写入。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

LOG_DIR_NAME = "AI纠错记录"
REQUIRED_FIELDS = ("时间", "原提问要点", "AI错误要点", "我的纠正要点", "AI反思", "根因", "改进方法")
OPTIONAL_FIELDS = ("标签",)
ALL_FIELDS = REQUIRED_FIELDS + OPTIONAL_FIELDS
SHORT_FIELDS = ("原提问要点", "AI错误要点", "我的纠正要点")
LONG_FIELDS = ("AI反思", "根因", "改进方法")
MAX_SHORT = 200
MAX_LONG = 300
MAX_LABELS = 5
MAX_LABEL_LEN = 20
TIME_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$")
PLACEHOLDERS = {"n/a", "na", "none", "null", "todo", "tbd", "待定", "待补", "待填写", "无", "空"}
SECRET_RULES = (
    ("证书或私钥块", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("带凭据的 URL", re.compile(r"(?i)https?://[^\s/@]+:[^\s/@]+@")),
    ("常见密钥前缀", re.compile(r"(?i)\b(?:sk|pk|ghp|gho|ghs|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}")),
    ("Bearer 令牌", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._-]{16,}")),
    ("键值形式的凭据", re.compile(r"(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key)\s*[:=：]\s*\S{6,}")),
)
EXIT_INPUT = 2
EXIT_SECRET = 3
EXIT_WRITE = 4


def fail(message: str, code: int) -> None:
    print(f"record_correction failed: {message}", file=sys.stderr)
    raise SystemExit(code)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def load_record(args: argparse.Namespace) -> dict:
    if args.json is not None and args.file is not None:
        fail("--json 与 --file 只能选一个", EXIT_INPUT)
    if args.json is not None:
        raw = args.json
    elif args.file == "-":
        raw = sys.stdin.read()
    elif args.file:
        try:
            raw = Path(args.file).read_text(encoding="utf-8")
        except (OSError, UnicodeError) as error:
            fail(f"读取输入失败：{error}", EXIT_INPUT)
    else:
        fail("必须提供 --json 或 --file -（标准输入）", EXIT_INPUT)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        fail(f"输入不是合法 JSON：{error.msg}", EXIT_INPUT)
    if not isinstance(value, dict):
        fail("输入必须是 JSON 对象", EXIT_INPUT)
    return value


def validate(value: dict, time_override: str | None) -> dict:
    unknown = sorted(set(value) - set(ALL_FIELDS))
    if unknown:
        fail("字段不膨胀，只允许 7 必填 + 1 可选；多余字段：" + "、".join(unknown), EXIT_INPUT)
    missing = [field for field in REQUIRED_FIELDS if field != "时间" and field not in value]
    if missing:
        fail("缺少必填字段：" + "、".join(missing), EXIT_INPUT)

    # 时间始终写入记录，可省略由脚本自动取当前时间。
    time_value = time_override or value.get("时间") or datetime.now().strftime("%Y-%m-%d %H:%M")
    if not isinstance(time_value, str) or not TIME_RE.fullmatch(time_value):
        fail("时间必须为 YYYY-MM-DD HH:MM", EXIT_INPUT)

    record: dict = {"时间": time_value}
    for field in SHORT_FIELDS + LONG_FIELDS:
        item = value.get(field)
        if not isinstance(item, str):
            fail(f"{field} 必须是字符串", EXIT_INPUT)
        text = item.strip()
        limit = MAX_SHORT if field in SHORT_FIELDS else MAX_LONG
        if not text or text.lower() in PLACEHOLDERS:
            fail(f"{field} 不能为空或占位值", EXIT_INPUT)
        if "\n" in text or "\r" in text:
            fail(f"{field} 必须压成一行摘要", EXIT_INPUT)
        if len(text) > limit:
            fail(f"{field} 超过 {limit} 字上限，请压缩为要点而非原文", EXIT_INPUT)
        for label, pattern in SECRET_RULES:
            if pattern.search(text):
                fail(f"{field} 命中疑似敏感信息（{label}）；请改写要点，不要记录原文", EXIT_SECRET)
        record[field] = text

    labels = value.get("标签")
    if labels is not None:
        if not isinstance(labels, list) or any(not isinstance(item, str) for item in labels):
            fail("标签必须是字符串数组", EXIT_INPUT)
        cleaned: list[str] = []
        for item in labels:
            text = item.strip()
            if not text or len(text) > MAX_LABEL_LEN or "\n" in text:
                fail(f"标签必须是非空、单行且不超过 {MAX_LABEL_LEN} 字的字符串", EXIT_INPUT)
            if text not in cleaned:
                cleaned.append(text)
        if len(cleaned) > MAX_LABELS:
            fail(f"标签最多 {MAX_LABELS} 个", EXIT_INPUT)
        if cleaned:
            record["标签"] = cleaned
    return record


def existing_identities(path: Path) -> list[tuple[str, str, str]]:
    identities: list[tuple[str, str, str]] = []
    if not path.exists():
        return identities
    if path.is_dir() or path.is_symlink():
        fail(f"记录路径被目录或链接占用：{path}", EXIT_WRITE)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        fail(f"读取当天记录失败：{error}", EXIT_WRITE)
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            fail(f"当天记录第 {number} 行不是合法 JSON；请先修复文件再写入", EXIT_WRITE)
        if not isinstance(row, dict):
            fail(f"当天记录第 {number} 行不是 JSON 对象；请先修复文件再写入", EXIT_WRITE)
        identities.append(tuple(str(row.get(field, "")).strip() for field in SHORT_FIELDS))
    return identities


def append(record: dict, path: Path) -> None:
    line = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
            handle.write(line)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        fail(f"写入失败：{error}", EXIT_WRITE)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=None, help="项目根目录，默认按脚本位置推断")
    parser.add_argument("--json", help="记录的 JSON 文本")
    parser.add_argument("--file", help="记录的 JSON 文件；- 表示标准输入")
    parser.add_argument("--time", help="覆盖记录时间（YYYY-MM-DD HH:MM），用于测试或补录")
    args = parser.parse_args()

    repo = (args.repo or repo_root()).resolve()
    if not repo.is_dir():
        fail(f"项目根目录不存在：{repo}", EXIT_INPUT)

    record = validate(load_record(args), args.time)
    day = record["时间"].split(" ")[0]
    path = repo / LOG_DIR_NAME / f"{day}.jsonl"

    identity = tuple(record[field] for field in SHORT_FIELDS)
    if identity in existing_identities(path):
        print(json.dumps({"status": "skipped-duplicate", "path": str(path), "时间": record["时间"]}, ensure_ascii=False))
        return

    append(record, path)
    print(json.dumps({"status": "appended", "path": str(path), "时间": record["时间"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
