#!/usr/bin/env python3
"""仅对本 Experiment Candidate 工作区生成摘要与变更回执，不执行 Harness。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


REPO = Path(__file__).resolve().parents[3]
EXPERIMENT = REPO / "evolution/experiments/EXP-security-operations-expert-001"
DSH_ROOT = EXPERIMENT / "candidate/dsh"
WORKSPACE = DSH_ROOT / "workspace"
ALLOWED_ROOTS = {WORKSPACE, DSH_ROOT / "presets", DSH_ROOT / "managed"}
RECEIPTS = EXPERIMENT / "evaluation/mutation-receipts"
DEFAULT_LIMITS = {
    "max_file_bytes": 64 * 1024 * 1024,
    "max_total_bytes": 1024 * 1024 * 1024,
    "max_depth": 256,
    "max_nodes": 100_000,
}


def narrowed_limits(override: dict) -> dict:
    for name in override:
        if name not in DEFAULT_LIMITS:
            raise ValueError(f"unknown asset scan limit: {name}")
    limits = {**DEFAULT_LIMITS, **override}
    for name, value in limits.items():
        if type(value) is not int or value < 1 or value > DEFAULT_LIMITS[name]:
            raise ValueError(f"asset scan limit cannot be widened: {name}")
    return limits


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def snapshot(root: Path, override: dict = None) -> dict:
    root = root.absolute()
    limits = narrowed_limits(override or {})
    if root not in ALLOWED_ROOTS:
        raise ValueError("only the three exact Candidate DSH mount sources are allowed")
    if root.is_symlink() or not root.is_dir():
        raise ValueError("asset root must be a real directory")

    records = []
    pending = [(root, 0)]
    nodes = 1
    total_bytes = 0
    while pending:
        folder, depth = pending.pop()
        for entry in folder.iterdir():
            nodes += 1
            if nodes > limits["max_nodes"]:
                raise ValueError("asset scan exceeds node limit")
            child_depth = depth + 1
            if child_depth > limits["max_depth"]:
                raise ValueError(f"asset scan exceeds depth limit: {entry.relative_to(root)}")
            prior = entry.lstat()
            if stat.S_ISDIR(prior.st_mode):
                pending.append((entry, child_depth))
                continue
            if not stat.S_ISREG(prior.st_mode):
                raise ValueError(f"unsupported asset type: {entry.relative_to(root)}")
            if prior.st_size > limits["max_file_bytes"]:
                raise ValueError(f"asset file exceeds 64 MiB limit: {entry.relative_to(root)}")
            if total_bytes + prior.st_size > limits["max_total_bytes"]:
                raise ValueError("asset scan exceeds 1 GiB total byte limit")

            file_hash = hashlib.sha256()
            if not hasattr(os, "O_NOFOLLOW"):
                raise ValueError("O_NOFOLLOW is required for asset scan")
            descriptor = os.open(str(entry), os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as source:
                opened = os.fstat(source.fileno())
                if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (
                    prior.st_dev,
                    prior.st_ino,
                ):
                    raise ValueError(f"asset changed type during scan: {entry.relative_to(root)}")
                if opened.st_size > limits["max_file_bytes"]:
                    raise ValueError(f"asset file exceeds 64 MiB limit: {entry.relative_to(root)}")
                file_bytes = 0
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    file_bytes += len(chunk)
                    if file_bytes > limits["max_file_bytes"]:
                        raise ValueError(f"asset file grew beyond limit: {entry.relative_to(root)}")
                    file_hash.update(chunk)
                after = os.fstat(source.fileno())
                if file_bytes != opened.st_size or (
                    after.st_size,
                    after.st_mtime_ns,
                    after.st_ctime_ns,
                    stat.S_IMODE(after.st_mode),
                ) != (
                    opened.st_size,
                    opened.st_mtime_ns,
                    opened.st_ctime_ns,
                    stat.S_IMODE(opened.st_mode),
                ):
                    raise ValueError(f"asset changed during scan: {entry.relative_to(root)}")
            total_bytes += file_bytes
            if total_bytes > limits["max_total_bytes"]:
                raise ValueError("asset scan exceeds 1 GiB total byte limit")
            records.append(
                {
                    "mode": f"{stat.S_IMODE(opened.st_mode) & 0o7777:04o}",
                    "path": entry.relative_to(root).as_posix(),
                    "sha256": file_hash.hexdigest(),
                    "size": file_bytes,
                }
            )

    records.sort(key=lambda record: record["path"].encode("utf-8"))
    serialized = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {
        "tree_sha256": "sha256:" + hashlib.sha256(serialized).hexdigest(),
        "file_count": len(records),
        "total_bytes": total_bytes,
        "files": records,
    }


def write_json_once(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write("\n")


def before() -> None:
    receipt_id = "mr-" + str(uuid.uuid4())
    path = RECEIPTS / receipt_id / "before.json"
    write_json_once(
        path,
        {
            "schema_version": "1.0",
            "receipt_id": receipt_id,
            "experiment_id": "EXP-security-operations-expert-001",
            "mode": "authoring",
            "created_at": utc_now(),
            "workspace_mount_source": str(WORKSPACE),
            "mount_snapshots": {
                "workspace": snapshot(WORKSPACE),
                "presets": snapshot(DSH_ROOT / "presets"),
                "managed": snapshot(DSH_ROOT / "managed"),
            },
        },
    )
    print(path)


def after(before_path: Path) -> None:
    before_path = before_path.absolute()
    if before_path.name != "before.json" or before_path.parent.parent != RECEIPTS:
        raise ValueError("before receipt must be under this Experiment evaluation/mutation-receipts")
    with before_path.open(encoding="utf-8") as source:
        prior = json.load(source)
    if prior.get("experiment_id") != "EXP-security-operations-expert-001":
        raise ValueError("before receipt Experiment identity mismatch")
    if prior.get("workspace_mount_source") != str(WORKSPACE):
        raise ValueError("before receipt workspace identity mismatch")
    if prior.get("receipt_id") != before_path.parent.name:
        raise ValueError("before receipt ID mismatch")

    current_mounts = {
        "workspace": snapshot(WORKSPACE),
        "presets": snapshot(DSH_ROOT / "presets"),
        "managed": snapshot(DSH_ROOT / "managed"),
    }
    old_files = {item["path"]: item for item in prior["mount_snapshots"]["workspace"]["files"]}
    new_files = {item["path"]: item for item in current_mounts["workspace"]["files"]}
    paths = sorted(set(old_files) | set(new_files), key=lambda value: value.encode("utf-8"))
    changes = []
    for path in paths:
        old = old_files.get(path)
        new = new_files.get(path)
        if old == new:
            continue
        changes.append(
            {
                "path": path,
                "change": "added" if old is None else "removed" if new is None else "modified",
                "before_sha256": old["sha256"] if old else None,
                "after_sha256": new["sha256"] if new else None,
            }
        )

    controlled_mount_violations = [
        name
        for name in ("presets", "managed")
        if prior["mount_snapshots"][name]["tree_sha256"] != current_mounts[name]["tree_sha256"]
    ]
    output = before_path.parent / "after.json"
    write_json_once(
        output,
        {
            "schema_version": "1.0",
            "receipt_id": prior["receipt_id"],
            "experiment_id": prior["experiment_id"],
            "mode": "authoring",
            "created_at": utc_now(),
            "before_tree_sha256": {
                name: prior["mount_snapshots"][name]["tree_sha256"]
                for name in ("workspace", "presets", "managed")
            },
            "after_mount_snapshots": current_mounts,
            "workspace_changes": changes,
            "controlled_mount_integrity": "fail" if controlled_mount_violations else "pass",
            "controlled_mount_violations": controlled_mount_violations,
            "semantic_review_required": bool(changes or controlled_mount_violations),
            "candidate_freeze_must_be_rechecked": bool(changes or controlled_mount_violations),
            "notice": "This receipt records file changes only; it does not approve Eval, Baseline, Release, or deployment.",
        },
    )
    print(output)
    if controlled_mount_violations:
        raise ValueError("controlled Preset/Guard mount changed during authoring: " + ", ".join(controlled_mount_violations))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    digest_parser = commands.add_parser("digest", help="print one exact DSH Candidate mount tree digest")
    digest_parser.add_argument("root", type=Path)
    commands.add_parser("before", help="create an authoring pre-change receipt")
    after_parser = commands.add_parser("after", help="compare with the pre-change receipt")
    after_parser.add_argument("before_receipt", type=Path)
    args = parser.parse_args()

    try:
        if args.command == "digest":
            print(snapshot(args.root)["tree_sha256"])
        elif args.command == "before":
            before()
        else:
            after(args.before_receipt)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"mutation receipt failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
