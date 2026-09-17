#!/usr/bin/env python3
"""将 DSH-only 实验来源解析为单一、无秘密的运行数据合同。"""

from __future__ import annotations

import argparse
import json
import re
import stat
import sys
from pathlib import Path


ADAPTER = Path(__file__).resolve().parent
REPO = ADAPTER.parents[2]
SOURCES = ADAPTER / "sources.json"
LOCK = ADAPTER / "source.lock.json"
DEFAULT_SOURCE = "EXP-security-operations-expert-001"
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EXPERIMENT = re.compile(r"^EXP-([a-z0-9]+(?:-[a-z0-9]+)*)-[0-9]{3}$")


def strict_json(path: Path, max_bytes: int = 1024 * 1024) -> dict:
    if path.stat().st_size > max_bytes:
        raise ValueError(f"oversized contract: {path.name}")

    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate key in {path.name}: {key}")
            result[key] = value
        return result

    with path.open(encoding="utf-8") as stream:
        value = json.load(stream, object_pairs_hook=unique_pairs)
    if not isinstance(value, dict):
        raise ValueError(f"contract must be an object: {path.name}")
    return value


def safe_relative(value: str) -> Path:
    if not isinstance(value, str) or "\\" in value:
        raise ValueError("source path must be a POSIX relative string")
    path = Path(value)
    if not value or path.is_absolute() or path.as_posix() != value \
            or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError(f"unsafe relative path: {value}")
    return path


def real_file_below(root: Path, relative: Path) -> bool:
    """拒绝路径任一层的链接，不只检查最终文件名。"""
    current = root
    for part in relative.parts:
        current = current / part
        try:
            info = current.lstat()
        except OSError:
            return False
        if stat.S_ISLNK(info.st_mode):
            return False
    return stat.S_ISREG(info.st_mode) and info.st_nlink == 1


def resolve(source_id: str = DEFAULT_SOURCE, *, repo: Path = REPO, sources: Path = SOURCES,
            lock_path: Path = LOCK, require_assets: bool = True) -> dict:
    catalog = strict_json(sources)
    if catalog.get("schema_version") != "1.0" or not isinstance(catalog.get("sources"), dict):
        raise ValueError("unsupported source catalog")
    item = catalog["sources"].get(source_id)
    match = EXPERIMENT.fullmatch(source_id)
    if not match or not isinstance(item, dict) or item.get("agent_id") != match.group(1):
        raise ValueError(f"unknown or inconsistent DSH source: {source_id}")
    if set(item) != {"agent_id", "candidate_root", "profile", "patch", "preset", "guard",
                     "config_markers", "required_env_names"}:
        raise ValueError("source fields differ from schema 1.0")
    expected = Path("evolution/experiments") / source_id / "candidate/dsh"
    if safe_relative(item["candidate_root"]) != expected:
        raise ValueError("candidate root does not belong to selected experiment")
    for key in ("patch", "preset"):
        safe_relative(item[key])
    if item["guard"] is not None:
        safe_relative(item["guard"])
    root = repo / expected
    if require_assets:
        for parent in (repo / Path(*expected.parts[:depth]) for depth in range(1, len(expected.parts) + 1)):
            if parent.is_symlink() or not parent.is_dir():
                raise ValueError(f"missing or symlinked source ancestor: {parent}")
        for directory in (root, root / "workspace", root / "presets", root / "managed"):
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError(f"missing or symlinked source directory: {directory}")
        for key, folder in (("patch", "managed"), ("preset", "presets"), ("guard", "managed")):
            if key == "guard" and item[key] is None:
                continue
            relative = safe_relative(item[key])
            if not real_file_below(root, Path(folder) / relative):
                raise ValueError(f"missing or unsafe source file: {key}")
    if item["profile"] != "web":
        raise ValueError("only the verified DSH web profile is supported")
    for key in ("config_markers", "required_env_names"):
        values = item[key]
        if not isinstance(values, list) or (key == "config_markers" and not values) \
                or any(not isinstance(v, str) or not v for v in values):
            raise ValueError(f"invalid {key}")
        if len(values) != len(set(values)):
            raise ValueError(f"duplicate {key}")
    for name in item["required_env_names"]:
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            raise ValueError("invalid required environment name")
    lock = strict_json(lock_path)
    for key in ("repository", "commit", "tree", "pnpm_lock_sha256", "package_manager",
                "node_base", "platform", "local_image_tag", "cli_version"):
        if not isinstance(lock.get(key), str) or not lock[key]:
            raise ValueError(f"missing DSH lock field: {key}")
    if not re.fullmatch(r"[0-9a-f]{40}", lock["commit"]) or not re.fullmatch(r"[0-9a-f]{40}", lock["tree"]):
        raise ValueError("invalid DSH source commit or tree")
    if not re.fullmatch(r"[0-9a-f]{64}", lock["pnpm_lock_sha256"]):
        raise ValueError("invalid DSH dependency lock digest")
    if lock["repository"] != "https://github.com/deepseek-ai/deepseek-harness.git" \
            or lock.get("cli_package") != "@deepseek-ai/dsh" \
            or not re.fullmatch(r"pnpm@[0-9]+(?:\.[0-9]+){2}", lock["package_manager"]) \
            or not re.fullmatch(r"node:[^@]+@sha256:[0-9a-f]{64}", lock["node_base"]) \
            or lock["platform"] != "linux/amd64" \
            or lock["local_image_tag"] != "ai-agent-harness/dsh:" + lock["commit"][:9] \
            or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", lock["cli_version"]):
        raise ValueError("invalid DSH build source or image identity")
    return {
        "schema_version": "1.0",
        "source_id": source_id,
        "agent_id": item["agent_id"],
        "candidate_root": str(root),
        "experiment_root": str(root.parents[1]),
        "workspace": str(root / "workspace"),
        "presets": str(root / "presets"),
        "managed": str(root / "managed"),
        "profile": item["profile"],
        "patch": "/opt/dsh-managed/" + item["patch"],
        "preset": "/opt/dsh-presets/" + item["preset"],
        "guard": "/opt/dsh-managed/" + item["guard"] if item["guard"] else None,
        "config_markers": item["config_markers"],
        "required_env_names": item["required_env_names"],
        "image": lock,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--field", help="print one top-level scalar field")
    parser.add_argument("--env-names", action="store_true", help="print selected Runtime environment names, one per line")
    parser.add_argument("--allow-missing-assets", action="store_true", help="resolve identity for frozen recovery")
    args = parser.parse_args()
    try:
        contract = resolve(args.source, require_assets=not args.allow_missing_assets)
        if args.field and args.env_names:
            raise ValueError("choose either --field or --env-names")
        if args.env_names:
            if contract["required_env_names"]:
                print("\n".join(contract["required_env_names"]))
        elif args.field:
            value = contract
            for key in args.field.split("."):
                value = value.get(key) if isinstance(value, dict) else None
            if not isinstance(value, str):
                raise ValueError("field must name a top-level string")
            print(value)
        else:
            print(json.dumps(contract, ensure_ascii=False, separators=(",", ":")))
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        print(f"DSH source resolution failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
