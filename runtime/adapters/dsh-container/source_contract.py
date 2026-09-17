#!/usr/bin/env python3
"""将 DSH-only 来源（实验候选、研究快照）解析为单一、无秘密的运行数据合同，并按角色生成挂载计划。"""

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
UUID_V4 = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
SNAPSHOT = re.compile(r"^snap-" + UUID_V4 + r"$")
RELEASE_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")
ROLES = ("authoring", "subject", "scoring")


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


def _agent_asset_roots(repo: Path, agent_id: str) -> dict:
    """Agent 级规格与评测输入根；不存在时返回 None，不伪造空目录。"""
    agent_dir = repo / "agents" / agent_id
    result = {"agent_dir": str(agent_dir) if agent_dir.is_dir() and not agent_dir.is_symlink() else None}
    for key, folder in (("spec_root", "spec"), ("eval_root", "eval")):
        target = agent_dir / folder
        result[key] = str(target) if target.is_dir() and not target.is_symlink() else None
    return result


def _experiment_contract(
    source_id: str,
    item: dict,
    *,
    repo: Path,
    lock: dict,
    require_assets: bool,
) -> dict:
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
                or any(not isinstance(value, str) or not value for value in values):
            raise ValueError(f"invalid {key}")
        if len(values) != len(set(values)):
            raise ValueError(f"duplicate {key}")
    for name in item["required_env_names"]:
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            raise ValueError("invalid required environment name")
    contract = {
        "schema_version": "1.0",
        "source_kind": "experiment",
        "source_id": "experiment:" + source_id,
        "experiment_id": source_id,
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
    contract.update(_agent_asset_roots(repo, item["agent_id"]))
    return contract


def _resolve_experiment(source_id: str, *, repo: Path, sources: Path, lock_path: Path, require_assets: bool) -> dict:
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
    lock = _read_source_lock(lock_path)
    return _experiment_contract(source_id, item, repo=repo, lock=lock, require_assets=require_assets)


def _read_source_lock(lock_path: Path) -> dict:
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
    return lock


def _resolve_snapshot(snapshot_id: str, *, repo: Path, sources: Path, lock_path: Path, require_assets: bool) -> dict:
    if not SNAPSHOT.fullmatch(snapshot_id):
        raise ValueError(f"invalid snapshot identity: {snapshot_id}")
    matches = []
    experiments_root = repo / "evolution" / "experiments"
    if experiments_root.is_dir() and not experiments_root.is_symlink():
        for experiment in experiments_root.iterdir():
            candidate = experiment / "snapshots" / "research" / snapshot_id
            if candidate.is_dir() and not candidate.is_symlink():
                matches.append(candidate)
    if len(matches) != 1:
        raise ValueError(f"unknown or ambiguous research snapshot: {snapshot_id}")
    snap_dir = matches[0]
    experiment_dir = snap_dir.parents[2]
    manifest = strict_json(snap_dir / "snapshot.json")
    if manifest.get("schema_version") != "1.0" or manifest.get("snapshot_id") != snapshot_id \
            or manifest.get("experiment_id") != experiment_dir.name \
            or not NAME.fullmatch(str(manifest.get("agent_id", ""))):
        raise ValueError("snapshot manifest identity mismatch")
    for folder in ("harness", "spec", "eval"):
        target = snap_dir / folder
        if target.is_symlink() or not target.is_dir():
            raise ValueError(f"snapshot missing content: {folder}")
    if not real_file_below(snap_dir, Path("dependencies.lock.json")):
        raise ValueError("snapshot missing dependencies.lock.json")
    harness = snap_dir / "harness"
    candidate_root = harness / "dsh"
    patch_rel = manifest.get("profile_patch")
    preset_rel = manifest.get("preset")
    if not isinstance(patch_rel, str) or not preset_rel:
        raise ValueError("snapshot manifest must declare profile patch and preset")
    safe_relative(patch_rel)
    safe_relative(preset_rel)
    if require_assets:
        for directory in (candidate_root, candidate_root / "workspace", candidate_root / "presets", candidate_root / "managed"):
            if directory.is_symlink() or not directory.is_dir():
                raise ValueError(f"snapshot harness missing directory: {directory.name}")
        if not real_file_below(candidate_root, safe_relative(patch_rel)) \
                or not real_file_below(candidate_root, safe_relative(preset_rel)):
            raise ValueError("snapshot harness missing declared patch or preset")
    markers = manifest.get("config_markers")
    env_names = manifest.get("required_env_names")
    if not isinstance(markers, list) or not markers or not isinstance(env_names, list) \
            or any(not isinstance(value, str) or not value for value in markers + env_names):
        raise ValueError("snapshot manifest must record config markers and environment names")
    lock = _read_source_lock(lock_path)
    return {
        "schema_version": "1.0",
        "source_kind": "snapshot",
        "source_id": "snapshot:" + snapshot_id,
        "snapshot_id": snapshot_id,
        "experiment_id": manifest["experiment_id"],
        "agent_id": manifest["agent_id"],
        "snapshot_root": str(snap_dir),
        "experiment_root": str(experiment_dir),
        "candidate_root": str(candidate_root),
        "workspace": str(candidate_root / "workspace"),
        "presets": str(candidate_root / "presets"),
        "managed": str(candidate_root / "managed"),
        "profile": "web",
        "patch": "/opt/dsh-managed/" + patch_rel.rsplit("/", 1)[-1],
        "preset": "/opt/dsh-presets/" + preset_rel.rsplit("/", 1)[-1],
        "guard": None,
        "config_markers": markers,
        "required_env_names": env_names,
        "spec_root": str(snap_dir / "spec"),
        "eval_root": str(snap_dir / "eval"),
        "image": lock,
        "frozen": True,
    }


def _resolve_release(release_name: str, *, repo: Path) -> dict:
    if not RELEASE_NAME.fullmatch(release_name):
        raise ValueError(f"invalid release identity: {release_name}")
    release_dir = repo / "releases" / release_name
    if not release_dir.is_dir() or release_dir.is_symlink() \
            or not real_file_below(release_dir, Path("manifest.yaml")) \
            or not real_file_below(release_dir, Path("artifact-manifest.json")):
        raise ValueError(f"unknown release source: {release_name}")
    raise ValueError("release sources resolve only after the first immutable Release is published and its container mapping is wired")


def resolve(source_id: str = DEFAULT_SOURCE, *, repo: Path = REPO, sources: Path = SOURCES,
            lock_path: Path = LOCK, require_assets: bool = True) -> dict:
    if source_id.startswith("experiment:"):
        return _resolve_experiment(source_id[len("experiment:"):], repo=repo, sources=sources, lock_path=lock_path, require_assets=require_assets)
    if source_id.startswith("snapshot:"):
        return _resolve_snapshot(source_id[len("snapshot:"):], repo=repo, sources=sources, lock_path=lock_path, require_assets=require_assets)
    if source_id.startswith("release:"):
        return _resolve_release(source_id[len("release:"):], repo=repo)
    if ":" in source_id:
        raise ValueError(f"unknown source selector: {source_id}")
    return _resolve_experiment(source_id, repo=repo, sources=sources, lock_path=lock_path, require_assets=require_assets)


def mount_plan(contract: dict, role: str, *, task_dir: str = None, output_dir: str = None,
               eval_reference: str = None) -> dict:
    """按运行角色生成挂载视图；被测侧与评分侧的判分材料必须隔离。"""
    if role not in ROLES:
        raise ValueError("role must be authoring、subject 或 scoring")
    if eval_reference and role != "scoring":
        raise ValueError("eval-reference 只允许挂载给评分/分析角色")
    workspace_mode = "rw" if role == "authoring" else "ro"
    mounts = [
        {"host": contract["workspace"], "container": "/work/harness/workspace", "mode": workspace_mode, "purpose": "harness-workspace"},
        {"host": contract["presets"], "container": "/opt/dsh-presets", "mode": "ro", "purpose": "presets"},
        {"host": contract["managed"], "container": "/opt/dsh-managed", "mode": "ro", "purpose": "managed"},
    ]
    spec_root = contract.get("spec_root")
    if spec_root:
        mounts.append({"host": spec_root, "container": "/work/spec", "mode": "ro", "purpose": "spec"})
    eval_root = contract.get("eval_root")
    if eval_root:
        mounts.append({"host": eval_root, "container": "/work/eval-input", "mode": "ro", "purpose": "eval-input"})
    if eval_reference:
        mounts.append({"host": eval_reference, "container": "/work/eval-reference", "mode": "ro", "purpose": "eval-reference"})
    if task_dir:
        mounts.append({"host": task_dir, "container": "/work/task", "mode": "rw", "purpose": "task-workspace"})
    if output_dir:
        mounts.append({"host": output_dir, "container": "/work/output", "mode": "rw", "purpose": "run-output"})
    return {
        "schema_version": "1.0",
        "role": role,
        "source_id": contract["source_id"],
        "mounts": mounts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--field", help="print one top-level scalar field")
    parser.add_argument("--env-names", action="store_true", help="print selected Runtime environment names, one per line")
    parser.add_argument("--allow-missing-assets", action="store_true", help="resolve identity for frozen recovery")
    parser.add_argument("--mount-plan", choices=ROLES, help="print the role mount plan instead of the contract")
    parser.add_argument("--task-dir", help="task workspace host path for the mount plan")
    parser.add_argument("--output-dir", help="run output host path for the mount plan")
    parser.add_argument("--eval-reference", help="scoring-side reference material host path")
    args = parser.parse_args()
    try:
        contract = resolve(args.source, require_assets=not args.allow_missing_assets)
        selected = sum(flag is not None and flag is not False for flag in (args.field, args.env_names, args.mount_plan))
        if selected > 1:
            raise ValueError("choose only one of --field、--env-names、--mount-plan")
        if args.mount_plan:
            plan = mount_plan(
                contract,
                args.mount_plan,
                task_dir=args.task_dir,
                output_dir=args.output_dir,
                eval_reference=args.eval_reference,
            )
            print(json.dumps(plan, ensure_ascii=False, separators=(",", ":")))
        elif args.env_names:
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
