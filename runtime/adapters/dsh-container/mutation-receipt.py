#!/usr/bin/env python3
"""对所选 DSH Candidate 生成回执和真实字节冻结副本，不执行 Harness。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from source_contract import DEFAULT_SOURCE, resolve, strict_json


REPO = Path(__file__).resolve().parents[3]
EXPERIMENT = REPO / "evolution/experiments/EXP-security-operations-expert-001"
DSH_ROOT = EXPERIMENT / "candidate/dsh"
WORKSPACE = DSH_ROOT / "workspace"
ALLOWED_ROOTS = {WORKSPACE, DSH_ROOT / "presets", DSH_ROOT / "managed"}
# 只读上下文数据资产根（需求/任务/验收标准、测试数据/评估方法）。它们只参与
# `digest` 的只读身份核对，不进入编写态变更回执，也不参与三树冻结。
CONTEXT_ROOTS: set[Path] = set()
RECEIPTS = EXPERIMENT / "evaluation/evidence/mutation-receipts"
FROZEN = EXPERIMENT / "snapshots/frozen-sources"
SOURCE_ID = DEFAULT_SOURCE
AGENT_ID = "security-operations-expert"
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


def snapshot(root: Path, override: dict = None, *, allowed_roots: set[Path] = None) -> dict:
    root = root.absolute()
    limits = narrowed_limits(override or {})
    if root not in (ALLOWED_ROOTS if allowed_roots is None else allowed_roots):
        raise ValueError("only the three exact selected DSH mount sources are allowed")
    if root.is_symlink() or not root.is_dir():
        raise ValueError("asset root must be a real directory")

    records = []
    directory_records = []
    pending = [(root, 0)]
    nodes = 1
    total_bytes = 0
    while pending:
        folder, depth = pending.pop()
        folder_mode = folder.lstat().st_mode
        if not stat.S_ISDIR(folder_mode):
            raise ValueError(f"asset directory changed type: {folder.relative_to(root)}")
        directory_records.append({
            "path": folder.relative_to(root).as_posix(),
            "mode": f"{stat.S_IMODE(folder_mode) & 0o7777:04o}",
        })
        has_entry = False
        for entry in folder.iterdir():
            has_entry = True
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
            if prior.st_nlink != 1:
                raise ValueError(f"hardlinked asset is not an isolated source: {entry.relative_to(root)}")
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
                if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1 or (opened.st_dev, opened.st_ino) != (
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
        if not has_entry:
            raise ValueError(f"empty asset directory cannot be frozen: {folder.relative_to(root)}")

    records.sort(key=lambda record: record["path"].encode("utf-8"))
    directory_records.sort(key=lambda record: record["path"].encode("utf-8"))
    serialized = json.dumps(records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    serialized_directories = json.dumps(directory_records, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return {
        "tree_sha256": "sha256:" + hashlib.sha256(serialized).hexdigest(),
        "directory_sha256": "sha256:" + hashlib.sha256(serialized_directories).hexdigest(),
        "file_count": len(records),
        "total_bytes": total_bytes,
        "files": records,
        "directories": directory_records,
    }


def write_json_once(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write("\n")


def select_source(source_id: str, require_assets: bool = True) -> dict:
    global EXPERIMENT, DSH_ROOT, WORKSPACE, ALLOWED_ROOTS, CONTEXT_ROOTS, RECEIPTS, FROZEN, SOURCE_ID, AGENT_ID
    contract = resolve(source_id, require_assets=require_assets)
    SOURCE_ID = contract["source_id"]
    AGENT_ID = contract["agent_id"]
    DSH_ROOT = Path(contract["candidate_root"])
    WORKSPACE = Path(contract["workspace"])
    ALLOWED_ROOTS = {WORKSPACE, Path(contract["presets"]), Path(contract["managed"])}
    CONTEXT_ROOTS = {Path(value) for value in (contract.get("spec_root"), contract.get("eval_root")) if value}
    EXPERIMENT = DSH_ROOT.parents[1]
    RECEIPTS = EXPERIMENT / "evaluation/evidence/mutation-receipts"
    FROZEN = EXPERIMENT / "snapshots/frozen-sources"
    return contract


def before() -> None:
    receipt_id = "mr-" + str(uuid.uuid4())
    path = RECEIPTS / receipt_id / "before.json"
    write_json_once(
        path,
        {
            "schema_version": "1.0",
            "receipt_id": receipt_id,
            "experiment_id": SOURCE_ID,
            "agent_id": AGENT_ID,
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
        raise ValueError("before receipt must be under this Experiment evaluation/evidence/mutation-receipts")
    with before_path.open(encoding="utf-8") as source:
        prior = json.load(source)
    if prior.get("experiment_id") != SOURCE_ID or prior.get("agent_id") != AGENT_ID:
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
                "before_mode": old["mode"] if old else None,
                "after_mode": new["mode"] if new else None,
            }
        )

    old_dirs = {item["path"]: item["mode"] for item in prior["mount_snapshots"]["workspace"]["directories"]}
    new_dirs = {item["path"]: item["mode"] for item in current_mounts["workspace"]["directories"]}
    directory_changes = [
        {"path": path, "before_mode": old_dirs.get(path), "after_mode": new_dirs.get(path)}
        for path in sorted(set(old_dirs) | set(new_dirs), key=lambda value: value.encode("utf-8"))
        if old_dirs.get(path) != new_dirs.get(path)
    ]

    controlled_mount_violations = [
        name
        for name in ("presets", "managed")
        if prior["mount_snapshots"][name] != current_mounts[name]
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
            "workspace_directory_changes": directory_changes,
            "controlled_mount_integrity": "fail" if controlled_mount_violations else "pass",
            "controlled_mount_violations": controlled_mount_violations,
            "semantic_review_required": bool(changes or directory_changes or controlled_mount_violations),
            "candidate_freeze_must_be_rechecked": bool(changes or directory_changes or controlled_mount_violations),
            "notice": "This receipt records file changes only; it does not approve Eval, Baseline, Release, or deployment.",
        },
    )
    print(output)
    if controlled_mount_violations:
        raise ValueError("controlled Preset/Guard mount changed during authoring: " + ", ".join(controlled_mount_violations))


def single_file_records(path: Path, relative_name: str) -> dict:
    """为一个普通文件生成与 snapshot() 兼容的最小记录集。"""
    if path.is_symlink() or not path.is_file() or path.stat().st_nlink != 1:
        raise ValueError(f"unsafe metadata file: {relative_name}")
    content = path.read_bytes()
    if len(content) > DEFAULT_LIMITS["max_file_bytes"]:
        raise ValueError(f"metadata file exceeds limit: {relative_name}")
    return {
        "tree_sha256": "sha256:" + hashlib.sha256(
            json.dumps(
                [{"mode": f"{stat.S_IMODE(path.stat().st_mode) & 0o7777:04o}", "path": relative_name,
                  "sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}],
                ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
        "directory_sha256": "sha256:" + hashlib.sha256(
            json.dumps([{"mode": "0755", "path": "."}], ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest(),
        "file_count": 1,
        "total_bytes": len(content),
        "files": [{"mode": f"{stat.S_IMODE(path.stat().st_mode) & 0o7777:04o}", "path": relative_name,
                   "sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}],
        "directories": [{"mode": "0755", "path": "."}],
    }


def copy_tree(source: Path, destination: Path, expected: dict, *, create_root: bool = True) -> None:
    if create_root:
        destination.mkdir(parents=True, exist_ok=False)
    for record in expected["files"]:
        relative = Path(record["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("invalid frozen file path")
        source_file = source / relative
        target_file = destination / relative
        target_file.parent.mkdir(parents=True, exist_ok=True)
        if source_file.is_symlink() or not source_file.is_file():
            raise ValueError(f"source changed during materialization: {relative}")
        descriptor = os.open(source_file, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as input_file, target_file.open("xb") as output_file:
            stat_before = os.fstat(input_file.fileno())
            if not stat.S_ISREG(stat_before.st_mode) or stat_before.st_nlink != 1 or stat_before.st_size != record["size"]:
                raise ValueError(f"source changed during materialization: {relative}")
            digest = hashlib.sha256()
            size = 0
            while True:
                block = input_file.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > DEFAULT_LIMITS["max_file_bytes"]:
                    raise ValueError(f"source grew during materialization: {relative}")
                digest.update(block)
                output_file.write(block)
            stat_after = os.fstat(input_file.fileno())
            if size != record["size"] or digest.hexdigest() != record["sha256"] \
                    or (stat_before.st_mtime_ns, stat_before.st_ctime_ns, stat_before.st_size) != \
                    (stat_after.st_mtime_ns, stat_after.st_ctime_ns, stat_after.st_size):
                raise ValueError(f"source changed during materialization: {relative}")
        os.chmod(target_file, int(record["mode"], 8))
    for directory in sorted(expected["directories"], key=lambda item: len(Path(item["path"]).parts), reverse=True):
        relative = Path(directory["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("invalid frozen directory path")
        target = destination if relative == Path(".") else destination / relative
        if not target.is_dir() or target.is_symlink():
            raise ValueError(f"frozen directory missing: {relative}")
        os.chmod(target, int(directory["mode"], 8))


def frozen_snapshots(root: Path) -> dict:
    allowed = {root / name for name in ("workspace", "presets", "managed")}
    return {name: snapshot(root / name, allowed_roots=allowed)
            for name in ("workspace", "presets", "managed")}


def check_freeze_inputs(mounts: dict) -> None:
    """冻结只接受可审查的资产；不将被 Git 排除的本机私有文件带入副本。"""
    candidate_env = WORKSPACE / ".env"
    if candidate_env.exists() or candidate_env.is_symlink():
        controlled_env = Path(__file__).resolve().parent / "verification-home-controls/locked-bootstrap.env"
        if candidate_env.is_symlink() or not candidate_env.is_file() \
                or candidate_env.read_bytes() != controlled_env.read_bytes():
            raise ValueError("Candidate workspace .env is not the controlled comment-only sentinel")
    try:
        DSH_ROOT.relative_to(REPO)
    except ValueError:
        return  # 临时目录测试没有仓库忽略规则。
    paths = [str((DSH_ROOT / name / record["path"]).relative_to(REPO))
             for name, mount in mounts.items() for record in mount["files"]]
    try:
        completed = subprocess.run(
            ["git", "-C", str(REPO), "check-ignore", "--no-index", "-z", "--stdin"],
            input=("\0".join(paths) + "\0").encode(), capture_output=True, check=False,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("cannot verify Candidate files against Git ignore rules") from error
    if completed.returncode not in (0, 1):
        raise ValueError("cannot verify Candidate files against Git ignore rules")
    if completed.stdout:
        raise ValueError("Candidate includes Git-ignored files; review before freezing")


def candidate_reference() -> str:
    try:
        return DSH_ROOT.relative_to(REPO).as_posix()
    except ValueError:
        return str(DSH_ROOT)  # 仓库外的临时目录测试。


def remove_new_tree(root: Path) -> None:
    """只清理本次新建的临时树；源目录的只读 mode 不得掩盖原失败。"""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("cleanup target is not the newly created directory")
    for folder, _, _ in os.walk(root, followlinks=False):
        os.chmod(folder, stat.S_IMODE(Path(folder).lstat().st_mode) | 0o700)
    shutil.rmtree(root)


def freeze() -> None:
    """复制未提交字节；验证源为副本而非仍可写的 Candidate。"""
    before_mounts = {name: snapshot(DSH_ROOT / name)
                     for name in ("workspace", "presets", "managed")}
    check_freeze_inputs(before_mounts)
    freeze_id = "fr-" + str(uuid.uuid4())
    FROZEN.mkdir(parents=True, exist_ok=True)
    temp_root = FROZEN / (".tmp-" + freeze_id)
    final_root = FROZEN / freeze_id
    temp_root.mkdir(exist_ok=False)
    try:
        for name, recorded in before_mounts.items():
            copy_tree(DSH_ROOT / name, temp_root / name, recorded)
        if frozen_snapshots(temp_root) != before_mounts:
            raise ValueError("materialized bytes differ from Candidate scan")
        after_mounts = {name: snapshot(DSH_ROOT / name)
                        for name in ("workspace", "presets", "managed")}
        if after_mounts != before_mounts:
            raise ValueError("Candidate changed during materialization; stop Authoring and retry")
        write_json_once(temp_root / "snapshot.json", {
            "schema_version": "1.0",
            "freeze_id": freeze_id,
            "source_id": SOURCE_ID,
            "agent_id": AGENT_ID,
            "created_at": utc_now(),
            "source_candidate_root": candidate_reference(),
            "mount_snapshots": before_mounts,
            "scope": "materialized Candidate source only; not an evaluated baseline or Release",
        })
        temp_root.rename(final_root)
    except BaseException:
        remove_new_tree(temp_root)
        raise
    print(final_root)


def verify_frozen(root: Path) -> dict:
    root = root.absolute()
    if root.parent != FROZEN or not root.name.startswith("fr-") or root.is_symlink() \
            or not root.is_dir() or (root / "snapshot.json").is_symlink():
        raise ValueError("frozen source must be a direct directory under selected Experiment")
    manifest = strict_json(root / "snapshot.json", 64 * 1024 * 1024)
    if manifest.get("schema_version") != "1.0" or manifest.get("freeze_id") != root.name \
            or manifest.get("source_id") != SOURCE_ID or manifest.get("agent_id") != AGENT_ID \
            or manifest.get("source_candidate_root") != candidate_reference():
        raise ValueError("frozen source identity mismatch")
    if frozen_snapshots(root) != manifest.get("mount_snapshots"):
        raise ValueError("frozen source bytes or file modes drifted")
    return manifest


def restore(frozen_source: Path) -> None:
    manifest = verify_frozen(frozen_source)
    if DSH_ROOT.exists() or DSH_ROOT.is_symlink():
        raise ValueError("restore refuses to overwrite an existing Candidate root")
    DSH_ROOT.parent.mkdir(parents=True, exist_ok=True)
    DSH_ROOT.mkdir(exist_ok=False)
    try:
        for name, recorded in manifest["mount_snapshots"].items():
            copy_tree(frozen_source / name, DSH_ROOT / name, recorded)
        if {name: snapshot(DSH_ROOT / name) for name in ("workspace", "presets", "managed")} != \
                manifest["mount_snapshots"]:
            raise ValueError("restored bytes differ from frozen source")
    except BaseException:
        remove_new_tree(DSH_ROOT)
        raise
    print(DSH_ROOT)


def _git_clean_paths(roots: list, records_list: list) -> None:
    """拒绝把 Git 忽略的本机私有文件带入研究快照；仓库外临时目录测试跳过。"""
    try:
        paths = []
        for root, records in zip(roots, records_list):
            paths.extend(str((root / record["path"]).relative_to(REPO)) for record in records["files"])
    except ValueError:
        return
    try:
        completed = subprocess.run(
            ["git", "-C", str(REPO), "check-ignore", "--no-index", "-z", "--stdin"],
            input=("\0".join(paths) + "\0").encode(), capture_output=True, check=False,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("cannot verify snapshot inputs against Git ignore rules") from error
    if completed.returncode not in (0, 1):
        raise ValueError("cannot verify snapshot inputs against Git ignore rules")
    if completed.stdout:
        raise ValueError("snapshot inputs include Git-ignored files; review before freezing")


def _declared_dependencies(contract: dict, candidate: Path) -> dict:
    """记录声明依赖与受控文件的身份；实际构建身份仍以 runtime.lock.json 与适配层锁为准。"""
    runtime_lock = candidate / "runtime.lock.json"
    runtime = json.loads(runtime_lock.read_bytes()) if runtime_lock.is_file() else {}
    managed = candidate / "dsh" / "managed"
    presets = candidate / "dsh" / "presets" / contract["agent_id"]
    declared = {}
    for key, path in (
        ("profile_patch", managed / (contract["agent_id"] + ".patch.yml")),
        ("guard", managed / "security-operations-guard.mjs"),
        ("mcp_servers", managed / "mcp-servers.yaml"),
        ("role_matrix", managed / "role-tool-matrix.yaml"),
        ("control_boundary", managed / "control-boundary.yaml"),
        ("tool_name_map", managed / "mcp-tool-name-map.json"),
        ("preset", presets / "agent.cordis.yml"),
        ("preset_metadata", presets / "preset.yml"),
    ):
        if path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1:
            declared[key] = {
                "path": path.relative_to(candidate).as_posix(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
    return {
        "schema_version": "1.0",
        "runtime_identity": {
            key: runtime.get(key)
            for key in ("source_commit", "source_tree", "cli_version", "pnpm_lock_sha256", "node_base_oci_index_digest", "platform")
        },
        "adapter_image": {
            key: contract["image"].get(key)
            for key in ("commit", "tree", "local_image_tag", "pnpm_lock_sha256", "node_base")
        },
        "declared_assets": declared,
    }


def research_snapshot() -> None:
    """物化完整研究快照：候选元数据 + Harness 树 + spec + eval + 依赖身份。"""
    contract = resolve(SOURCE_ID, require_assets=True)
    candidate = Path(contract["candidate_root"]).parent
    spec_root = contract.get("spec_root")
    eval_root = contract.get("eval_root")
    if not spec_root or not eval_root:
        raise ValueError("agent spec/eval content is not materialized; create agents/<id>/spec and agents/<id>/eval before freezing")
    spec_root = Path(spec_root)
    eval_root = Path(eval_root)
    experiment = Path(contract["experiment_root"])
    snapshots_root = experiment / "snapshots" / "research"
    snap_id = "snap-" + str(uuid.uuid4())
    snapshots_root.mkdir(parents=True, exist_ok=True)
    temp_root = snapshots_root / (".tmp-" + snap_id)
    final_root = snapshots_root / snap_id
    temp_root.mkdir(exist_ok=False)
    try:
        dsh_records = snapshot(Path(contract["candidate_root"]), allowed_roots={Path(contract["candidate_root"])})
        metadata_files = [name for name in ("harness.yaml", "runtime.lock.json", "migration-id-map.json")
                          if (candidate / name).is_file()]
        spec_records = snapshot(spec_root, allowed_roots={spec_root})
        eval_records = snapshot(eval_root, allowed_roots={eval_root})
        _git_clean_paths(
            [Path(contract["candidate_root"]), spec_root, eval_root],
            [dsh_records, spec_records, eval_records],
        )
        harness_dir = temp_root / "harness"
        harness_dir.mkdir(exist_ok=False)
        for name in metadata_files:
            copy_tree(candidate, harness_dir, single_file_records(candidate / name, name), create_root=False)
        copy_tree(Path(contract["candidate_root"]), harness_dir / "dsh", dsh_records)
        copy_tree(spec_root, temp_root / "spec", spec_records)
        copy_tree(eval_root, temp_root / "eval", eval_records)
        harness_records = snapshot(harness_dir, allowed_roots={harness_dir})
        if snapshot(temp_root / "spec", allowed_roots={temp_root / "spec"}) != spec_records \
                or snapshot(temp_root / "eval", allowed_roots={temp_root / "eval"}) != eval_records:
            raise ValueError("materialized spec/eval bytes differ from source scan")
        dependencies = _declared_dependencies(contract, candidate)
        write_json_once(temp_root / "dependencies.lock.json", dependencies)
        manifest = {
            "schema_version": "1.0",
            "snapshot_id": snap_id,
            "agent_id": contract["agent_id"],
            "experiment_id": contract["experiment_id"],
            "created_at": utc_now(),
            "source_candidate_root": candidate_reference(),
            "profile_patch": "managed/%s.patch.yml" % contract["agent_id"],
            "preset": "presets/%s/agent.cordis.yml" % contract["agent_id"],
            "config_markers": contract["config_markers"],
            "required_env_names": contract["required_env_names"],
            "scope": "complete frozen research combination: candidate metadata, Harness tree, spec, eval inputs and declared dependency identities; not an evaluated baseline",
            "trees": {
                "harness": harness_records,
                "spec": spec_records,
                "eval": eval_records,
            },
            "dependencies_sha256": hashlib.sha256((temp_root / "dependencies.lock.json").read_bytes()).hexdigest(),
        }
        write_json_once(temp_root / "snapshot.json", manifest)
        temp_root.rename(final_root)
    except BaseException:
        remove_new_tree(temp_root)
        raise
    print(final_root)


def verify_research_snapshot(snap_dir: Path) -> dict:
    """按清单重新比对完整研究快照的内容与身份。"""
    snap_dir = snap_dir.absolute()
    if snap_dir.is_symlink() or not snap_dir.is_dir() or snap_dir.parent.name != "research" \
            or snap_dir.parent.parent.name != "snapshots" or not snap_dir.name.startswith("snap-"):
        raise ValueError("research snapshot must be a direct directory under an Experiment snapshots/research")
    manifest = strict_json(snap_dir / "snapshot.json", 64 * 1024 * 1024)
    if manifest.get("schema_version") != "1.0" or manifest.get("snapshot_id") != snap_dir.name \
            or manifest.get("experiment_id") != snap_dir.parent.parent.parent.name:
        raise ValueError("research snapshot identity mismatch")
    trees = manifest.get("trees")
    if not isinstance(trees, dict):
        raise ValueError("snapshot manifest must record harness/spec/eval trees")
    for folder in ("harness", "spec", "eval"):
        recorded = trees.get(folder)
        if not isinstance(recorded, dict):
            raise ValueError(f"snapshot manifest missing {folder} tree")
        root = snap_dir / folder
        if snapshot(root, allowed_roots={root}) != recorded:
            raise ValueError(f"{folder} tree drifted from snapshot manifest")
    dependencies = snap_dir / "dependencies.lock.json"
    if not dependencies.is_file() or hashlib.sha256(dependencies.read_bytes()).hexdigest() != manifest.get("dependencies_sha256"):
        raise ValueError("dependencies.lock.json drifted from snapshot manifest")
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="selected DSH Experiment identity")
    commands = parser.add_subparsers(dest="command", required=True)
    digest_parser = commands.add_parser("digest", help="print one exact DSH Candidate mount tree digest")
    digest_parser.add_argument("root", type=Path)
    commands.add_parser("before", help="create an authoring pre-change receipt")
    after_parser = commands.add_parser("after", help="compare with the pre-change receipt")
    after_parser.add_argument("before_receipt", type=Path)
    commands.add_parser("freeze", help="materialize and verify all three Candidate trees")
    commands.add_parser("research-snapshot", help="materialize a complete frozen research combination (harness + spec + eval)")
    snapshot_verify_parser = commands.add_parser("research-snapshot-verify", help="re-verify a research snapshot against its manifest")
    snapshot_verify_parser.add_argument("snap_dir", type=Path)
    restore_parser = commands.add_parser("restore", help="restore a frozen source to an absent Candidate root")
    restore_parser.add_argument("frozen_source", type=Path)
    frozen_digest_parser = commands.add_parser("frozen-digest", help="verify frozen bytes and print one mount digest")
    frozen_digest_parser.add_argument("frozen_source", type=Path)
    frozen_digest_parser.add_argument("mount", choices=("workspace", "presets", "managed"))
    args = parser.parse_args()

    try:
        select_source(args.source, require_assets=args.command not in ("restore", "frozen-digest"))
        if args.command == "digest":
            if args.root.absolute() in CONTEXT_ROOTS:
                print(snapshot(args.root, allowed_roots={args.root.absolute()})["tree_sha256"])
            else:
                print(snapshot(args.root)["tree_sha256"])
        elif args.command == "before":
            before()
        elif args.command == "after":
            after(args.before_receipt)
        elif args.command == "freeze":
            freeze()
        elif args.command == "research-snapshot":
            research_snapshot()
        elif args.command == "research-snapshot-verify":
            verify_research_snapshot(args.snap_dir)
            print(args.snap_dir)
        elif args.command == "frozen-digest":
            print(verify_frozen(args.frozen_source)["mount_snapshots"][args.mount]["tree_sha256"])
        else:
            restore(args.frozen_source)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"mutation receipt failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
