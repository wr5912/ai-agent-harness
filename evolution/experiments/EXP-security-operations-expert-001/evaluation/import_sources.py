#!/usr/bin/env python3
"""安全迁移 security-operations-expert 的旧归档和初版交付材料。

本脚本只读取普通文件，不导入或执行来源中的 Hook、脚本、Plugin、测试或 MCP。
输出限定在当前 Experiment 的历史清单、清洗文档和 pending Eval Case。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any, Optional


EXPERIMENT_ID = "EXP-security-operations-expert-001"
AGENT_ID = "security-operations-expert"
ARCHIVE_SHA256 = "1cde69e0ec0355619186f8390ba658cc0b6a45705a033a962c4398154189af76"
DELIVERY_TREE_SHA256 = "e49e72a8b7f6a97e7dd13e39af01138e9670311339e00573ab0a017df15963d2"
PUBLIC_JSON_SCHEMA_URI = "https://json-schema.org/draft/2020-12/schema"
DOMAIN_MAP = {
    "响应处置_delivery": ("response-disposition", "响应处置", "RSP", 0),
    "巡检_delivery": ("inspection", "巡检", "INS", 10),
    "故障排查_delivery": ("fault-analysis", "故障排查", "FLT", 18),
    "策略配置_delivery": ("policy-configuration", "策略配置", "POL", 28),
}
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 1024 * 1024 * 1024


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_relative(value: str) -> PurePosixPath:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"不安全的来源路径：{value!r}")
    return path


def read_regular(path: Path, root: Path) -> bytes:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        metadata = current.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError(f"来源路径包含符号链接：{relative}")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise ValueError(f"来源不是单链接普通文件：{relative}")
    if metadata.st_size > MAX_FILE_BYTES:
        raise ValueError(f"来源文件超过上限：{relative}")
    descriptor = os.open(str(path), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        actual = os.fstat(descriptor)
        identity = (actual.st_dev, actual.st_ino, actual.st_size, actual.st_nlink)
        expected = (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_nlink)
        if not stat.S_ISREG(actual.st_mode) or identity != expected:
            raise ValueError(f"交付来源读取期间发生变化：{relative}")
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = -1
            data = handle.read(MAX_FILE_BYTES + 1)
            final = os.fstat(handle.fileno())
        if len(data) != metadata.st_size or final.st_mtime_ns != metadata.st_mtime_ns:
            raise ValueError(f"交付来源读取期间发生变化：{relative}")
        return data
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def preflight_delivery(root: Path) -> list[tuple[str, bytes]]:
    """使用接收检查器同一目录树摘要算法，且在任何输出前锁定所有字节。"""

    metadata = root.lstat()
    if not stat.S_ISDIR(metadata.st_mode):
        raise ValueError("交付来源根不是普通目录")
    digest = hashlib.sha256()
    files: list[tuple[str, bytes]] = []
    directory_count = 0
    total_bytes = 0
    def onerror(error: OSError) -> None:
        raise ValueError(f"交付来源目录遍历失败：{type(error).__name__}")

    for current, dirnames, filenames in os.walk(str(root), topdown=True, followlinks=False, onerror=onerror):
        dirnames.sort()
        filenames.sort()
        current_path = Path(current)
        for dirname in dirnames:
            child = current_path / dirname
            if not stat.S_ISDIR(child.lstat().st_mode):
                raise ValueError(f"交付来源含非普通目录：{child.relative_to(root)}")
            safe_relative(child.relative_to(root).as_posix())
            directory_count += 1
        for filename in filenames:
            path = current_path / filename
            relative = path.relative_to(root).as_posix()
            safe_relative(relative)
            data = read_regular(path, root)
            total_bytes += len(data)
            if total_bytes > MAX_TOTAL_BYTES:
                raise ValueError("交付来源超过 1 GiB 总量上限")
            digest.update(relative.encode("utf-8", "surrogateescape") + b"\0" + data + b"\0")
            files.append((relative, data))
    if len(files) != 50 or directory_count != 12:
        raise ValueError(f"交付来源数量不符：文件 {len(files)} / 50，目录 {directory_count} / 12")
    actual = digest.hexdigest()
    if actual != DELIVERY_TREE_SHA256:
        raise ValueError(f"交付来源目录树摘要与锁定值不一致：{actual}")
    return files


def preflight_archive(path: Path) -> list[tuple[str, bytes]]:
    if sha256_file(path) != ARCHIVE_SHA256:
        raise ValueError("旧 Harness 归档摘要与锁定值不一致")
    files: list[tuple[str, bytes]] = []
    seen: set[str] = set()
    directories = 0
    total_bytes = 0
    with tarfile.open(path, "r:gz") as archive:
        for member in archive.getmembers():
            normalized = member.name.rstrip("/")
            safe_relative(normalized)
            if normalized in seen:
                raise ValueError(f"归档存在重复成员：{normalized}")
            seen.add(normalized)
            if member.isdir():
                directories += 1
                continue
            if not member.isfile() or member.issym() or member.islnk() or member.size > MAX_FILE_BYTES:
                raise ValueError(f"归档含不支持成员：{member.name}")
            extracted = archive.extractfile(member)
            if extracted is None:
                raise ValueError(f"无法读取归档成员：{member.name}")
            data = extracted.read(MAX_FILE_BYTES + 1)
            if len(data) != member.size:
                raise ValueError(f"归档成员大小不一致：{member.name}")
            total_bytes += len(data)
            if total_bytes > MAX_TOTAL_BYTES:
                raise ValueError("旧 Harness 归档超过 1 GiB 总量上限")
            files.append((member.name, data))
    if len(files) != 86 or directories != 43:
        raise ValueError(f"旧 Harness 数量不符：文件 {len(files)} / 86，目录 {directories} / 43")
    return files


def sanitize_text(text: str) -> tuple[str, list[str]]:
    rules: list[str] = []
    # 对 999 等来源测试占位也保守脱敏；必须有完整四段，避免把 npm 10.9.4 当 IP。
    octet = r"[0-9]{1,3}"
    private_ip = (
        rf"(?<![A-Za-z0-9.])(?:10(?:\.{octet}){{3}}|"
        rf"172\.(?:1[6-9]|2[0-9]|3[01])(?:\.{octet}){{2}}|"
        rf"192\.168(?:\.{octet}){{2}})(?![A-Za-z0-9.])"
    )
    replacements = (
        (r"(?i)(?:ssh|git\+ssh|sftp)://[^\s,，。；;)\]>\"'`]+", "<REDACTED_PRIVATE_URI>", "private-uri"),
        (r"(?i)git@[^\s:/]+:[^\s,，。；;)\]>\"'`]+", "<REDACTED_PRIVATE_URI>", "private-uri"),
        (r"https?://[^\s,，。；;)\]>\"'`]+", "<REDACTED_URL>", "url"),
        (private_ip, "<REDACTED_PRIVATE_IP>", "private-ip"),
        (r"(?im)^(\s*(?:authorization|token|password|secret|api[_-]?key)\s*[:=]\s*)(?!\$\{)[^\r\n]+$", r"\1<REDACTED>", "secret-like-assignment"),
        (r"(?i)Bearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{8,}", "Bearer <REDACTED>", "bearer"),
    )
    sanitized = text
    for pattern, replacement, rule in replacements:
        sanitized, count = re.subn(pattern, replacement, sanitized)
        if count:
            rules.append(rule)
    return sanitized, sorted(set(rules))


def sanitize_json(value: Any) -> tuple[Any, list[str]]:
    """递归清洗 Case 的文本字段，不修改 ID、布尔值或数值结构。"""

    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        sanitized_items = [sanitize_json(item) for item in value]
        return [item for item, _ in sanitized_items], sorted({rule for _, rules in sanitized_items for rule in rules})
    if isinstance(value, dict):
        sanitized_items = {key: sanitize_json(item) for key, item in value.items()}
        return (
            {key: item for key, (item, _) in sanitized_items.items()},
            sorted({rule for _, rules in sanitized_items.values() for rule in rules}),
        )
    return value, []


def sanitize_json_schema(value: Any) -> tuple[Any, list[str]]:
    """只豁免精确白名单的 JSON Schema 元模式，其他 URL 仍按不可信来源清洗。"""

    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        rules: set[str] = set()
        for key, item in value.items():
            if key == "$schema":
                if item != PUBLIC_JSON_SCHEMA_URI:
                    raise ValueError("来源 JSON Schema 的 $schema 不在公共 URI 精确白名单中")
                sanitized[key] = PUBLIC_JSON_SCHEMA_URI
                continue
            rewritten, item_rules = sanitize_json_schema(item)
            sanitized[key] = rewritten
            rules.update(item_rules)
        return sanitized, sorted(rules)
    if isinstance(value, list):
        sanitized_items = [sanitize_json_schema(item) for item in value]
        return [item for item, _ in sanitized_items], sorted({rule for _, rules in sanitized_items for rule in rules})
    return sanitize_json(value)


def map_requirement(value: str) -> str:
    match = re.fullmatch(r"REQ-(RSP|INS|FLT|POL)-(\d{3})", value)
    if not match:
        return value
    prefix, number = match.groups()
    offsets = {"RSP": 0, "INS": 10, "FLT": 18, "POL": 28}
    return f"REQ-{offsets[prefix] + int(number):03d}"


def rewrite_runtime_text(text: str) -> tuple[str, list[str]]:
    """去除旧宿主专属引用，同时保留可审查的业务方法。"""

    rewritten, rules = sanitize_text(text)
    substitutions = (
        (
            "mcp__sec-ops__ai_soc_ingest__get_admin_ingest_devices_by_asset_by_asset_id",
            "mcp__sec-ops__ai_soc_ingest__get_admin_ingest_devic_ad206f9cdb7c",
        ),
        (
            "mcp__inspection__inspection_service__get_inspection_run_check_result",
            "mcp__inspection__inspection_service__get_inspection_6e6414cd5e91",
        ),
        (
            "mcp__inspection__inspection_service__get_inspection_report_download",
            "mcp__inspection__inspection_service__get_inspection_0cd3022ebf84",
        ),
        ("CLAUDE.md", "AGENTS.md"),
        (".claude/settings.json", "Runtime Profile"),
        (".mcp.json", "Runtime MCP 声明"),
        (".claude/", "旧 Runtime 配置/"),
        ("permissionMode: dontAsk", "Runtime 强制零工具并禁止绕过审批"),
        ("$ARGUMENTS", "当前 DSH Skill 调用参数与当前请求"),
        ("Claude Code", "旧 Runtime"),
        ("Claude", "旧 Runtime"),
    )
    for old, new in substitutions:
        if old in rewritten:
            rewritten = rewritten.replace(old, new)
            rules.append(f"runtime-rewrite:{old}")
    return rewritten, sorted(set(rules))


def rewrite_skill(data: bytes, expected_name: str) -> str:
    text = data.decode("utf-8")
    body = text
    description = f"{expected_name} 的 DSH 容器迁移技能。"
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            frontmatter, body = parts[1], parts[2]
            name_match = re.search(r"(?m)^name:\s*['\"]?([^'\"\n]+)['\"]?\s*$", frontmatter)
            description_match = re.search(r"(?m)^description:\s*['\"]?([^'\"\n]+)['\"]?\s*$", frontmatter)
            if name_match and name_match.group(1).strip() != expected_name:
                raise ValueError(f"Skill 名称不一致：{name_match.group(1)!r} != {expected_name!r}")
            if description_match:
                description = description_match.group(1).strip()
    body, _rules = rewrite_runtime_text(body.lstrip())
    banner = (
        "> 本 Skill 仅由容器内 DSH 装载。来源为旧 Runtime 资产的业务语义迁移；"
        "工具名必须由受控 Profile 与 role-tool matrix 实际绑定，Prompt 不授予权限。\n\n"
    )
    return (
        "---\n"
        f"name: {expected_name}\n"
        f"description: {json.dumps(description, ensure_ascii=False)}\n"
        "---\n\n"
        + banner
        + body
    )


def archive_disposition(path: str) -> tuple[str, str, str | None]:
    if re.fullmatch(r"workspace/\.claude/skills/[^/]+/SKILL\.md", path):
        skill = path.split("/")[3]
        return "migrated", "重写为 DSH 直接发现 Skill；原 frontmatter 不激活", f"candidate/dsh/workspace/.agents/skills/{skill}/SKILL.md"
    if "/skills/" in path and "/references/" in path and path.endswith(".md"):
        parts = path.split("/")
        skill = parts[3]
        reference = "/".join(parts[5:])
        return "migrated", "作为 DSH Skill 的只读业务参考迁移", f"candidate/dsh/workspace/.agents/skills/{skill}/references/{reference}"
    if path.startswith("workspace/schemas/") and path.endswith(".json"):
        return "migrated", "迁移为 DSH 受控输出契约", "candidate/dsh/managed/schemas/" + path.rsplit("/", 1)[1]
    if path == "workspace/CLAUDE.md":
        return "manual-transform", "业务指令语义经人工审查后合并到 DSH workspace AGENTS.md；本脚本不自动生成该目标", "candidate/dsh/workspace/AGENTS.md"
    if path == "workspace/agent.yaml":
        return "manual-transform", "身份、能力与路由语义经人工审查后合并到 DSH harness.yaml；本脚本不自动生成该目标", "candidate/harness.yaml"
    if path.startswith("workspace/.claude/agents/"):
        return "manual-transform", "四个旧角色经人工审查后合并成一份 DSH role-tool-matrix.yaml；本脚本不自动生成该目标", "candidate/dsh/managed/role-tool-matrix.yaml"
    if path.startswith("workspace/hooks/") or path.startswith("workspace/.claude/legacy/hooks/"):
        return "hash-only", "旧 Python Hook 禁止执行；控制不变量在 DSH native guard 中重建", None
    if path in {"workspace/.claude/settings.json", "workspace/.mcp.json"}:
        return "hash-only", "包含旧权限、活动 Hook 或 Runtime 绑定，不得原样激活", None
    if path.startswith("workspace/tests/") or path.startswith("workspace/scripts/"):
        return "hash-only", "旧 Runtime 测试或脚本仅作为行为 Oracle，不在迁移中执行", None
    if path.startswith("workspace/docs/") and path.endswith(".md"):
        name = path.rsplit("/", 1)[1]
        return "sanitized", "保留清洗后的历史风险证据", f"history/archive-docs/{name}"
    return "hash-only", "与目标 DSH 可装载资产无直接关系或属于旧 Runtime 外壳", None


def delivery_disposition(relative: str) -> tuple[str, str, str | None]:
    domain = relative.split("/", 1)[0]
    slug = DOMAIN_MAP[domain][0]
    rest = relative.split("/", 1)[1]
    if re.fullmatch(r"0[1-6]_.+\.md", rest):
        return "sanitized", "清洗物化六件套历史正文；不作为当前正式结论", f"history/delivery-docs/{slug}/{rest}"
    if rest in {"README.md", "tests/README.md"}:
        return "sanitized", "清洗物化非执行历史说明；不激活其中提到的部署或测试命令", f"history/delivery-docs/{slug}/{rest}"
    if rest == "eval/cases.jsonl":
        return "migrated", "规范化为 pending Case；业务复核和 AC 绑定尚未完成", "candidate/delivery/eval/cases.pending.jsonl"
    if rest == "eval/results.csv":
        return "hash-only", "旧结果仅有表头且无 Trial；禁止创建空正式结果", None
    return "hash-only", "旧部署、环境或可执行测试材料仅留大小和 SHA-256；不复制、不执行、不作为 DSH Candidate", None


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def lock_existing_manifests(
    repo: Path, inventory: Path, source_manifest: Path, expected: Optional[str], refresh: bool
) -> dict[str, str]:
    """以调用者显式确认的旧摘要对两份清单执行 CAS，禁止静默覆盖。"""

    paths = [inventory, source_manifest]
    present = [path for path in paths if path.exists() or path.is_symlink()]
    if present and len(present) != len(paths):
        raise ValueError("旧迁移清单不完整，拒绝刷新不一致的状态")
    if not present or not refresh:
        return {}
    if not expected or not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("刷新已有迁移必须提供 --expect-existing-manifests-sha256 的小写 64 位摘要")
    locked: dict[str, str] = {}
    for path in paths:
        if path.is_symlink() or not path.is_file() or sha256_file(path) != expected:
            raise ValueError(f"旧迁移清单摘要与显式锁定值不一致，拒绝覆盖：{path.relative_to(repo)}")
        locked[path.relative_to(repo).as_posix()] = expected
    return locked


def verify_generated_targets(repo: Path, paths: list[Path], prior_hashes: dict[str, str]) -> None:
    """刷新只允许覆盖旧清单已经登记且当前摘要仍一致的自动生成文件。"""

    for path in paths:
        cursor = path
        while cursor != repo:
            if cursor.is_symlink():
                raise ValueError(f"生成目标路径含符号链接：{path.relative_to(repo)}")
            cursor = cursor.parent
        if path.exists() and not path.is_file():
            raise ValueError(f"生成目标不是普通文件：{path.relative_to(repo)}")
        if not path.exists():
            continue
        rel = path.relative_to(repo).as_posix()
        if rel not in prior_hashes:
            raise ValueError(f"已存在的生成目标不在旧清单中，拒绝覆盖：{rel}")
        if sha256_file(path) != prior_hashes[rel]:
            raise ValueError(f"生成目标自上次迁移后已修改，拒绝覆盖：{rel}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("delivery_root", type=Path)
    parser.add_argument("repo_root", type=Path)
    parser.add_argument(
        "--refresh-generated",
        action="store_true",
        help="显式重新生成本脚本拥有的文件；默认一次性摄取，已有目标时拒绝覆盖",
    )
    parser.add_argument(
        "--expect-existing-manifests-sha256",
        help="刷新已有迁移时必须显式给出两份旧清单的同一 SHA-256；任一文件漂移即拒绝覆盖",
    )
    args = parser.parse_args()

    repo = args.repo_root.resolve()
    experiment = repo / "evolution" / "experiments" / EXPERIMENT_ID
    history = repo / "evolution" / "history" / "imports" / "security-operations-expert-2026-09-15"
    manifest_entries: list[dict[str, Any]] = []
    planned_writes: dict[Path, bytes] = {}

    def plan(path: Path, data: bytes) -> None:
        if path in planned_writes:
            raise ValueError(f"多个来源映射到同一自动生成目标：{path.relative_to(repo)}")
        planned_writes[path] = data

    # 全部只读预检在任何仓库写入之前完成。清单锁定的来源只要漂移即中止。
    delivery_files = preflight_delivery(args.delivery_root)
    archive_files = preflight_archive(args.archive)

    for source_path, data in archive_files:
        disposition, reason, target = archive_disposition(source_path)
        entry: dict[str, Any] = {
            "source": "claude-code-archive",
            "path": source_path,
            "size": len(data),
            "sha256": sha256_bytes(data),
            "disposition": disposition,
            "reason": reason,
        }
        if target:
            entry["target"] = target
        if disposition == "manual-transform":
            target_path = experiment / target
            if not target_path.is_file() or target_path.is_symlink():
                raise ValueError(f"手工迁移的合并目标不存在或不安全：{target}")
            entry["target_relation"] = "semantic-merge-not-auto-generated"
            entry["target_sha256"] = sha256_file(target_path)
        if disposition == "sanitized":
            text = data.decode("utf-8")
            sanitized, rules = sanitize_text(text)
            target_path = history / target[len("history/") :]
            plan(target_path, sanitized.encode("utf-8"))
            entry["sanitized_sha256"] = sha256_bytes(sanitized.encode("utf-8"))
            entry["sanitization_rules"] = rules
        elif disposition == "migrated" and re.fullmatch(
            r"workspace/\.claude/skills/[^/]+/SKILL\.md", source_path
        ):
            skill_name = source_path.split("/")[3]
            rewritten = rewrite_skill(data, skill_name)
            target_path = experiment / target
            plan(target_path, rewritten.encode("utf-8"))
            entry["migrated_sha256"] = sha256_bytes(rewritten.encode("utf-8"))
            entry["transformation"] = "dsh-skill-frontmatter-and-runtime-rewrite-v1"
        elif disposition == "migrated" and "/skills/" in source_path and "/references/" in source_path:
            rewritten, rules = rewrite_runtime_text(data.decode("utf-8"))
            target_path = experiment / target
            plan(target_path, rewritten.encode("utf-8"))
            entry["migrated_sha256"] = sha256_bytes(rewritten.encode("utf-8"))
            entry["transformation"] = "dsh-reference-runtime-rewrite-v1"
            entry["sanitization_rules"] = rules
        elif disposition == "migrated" and source_path.startswith("workspace/schemas/"):
            schema, rules = sanitize_json_schema(json.loads(data))
            rendered = json_bytes(schema)
            target_path = experiment / target
            plan(target_path, rendered)
            entry["migrated_sha256"] = sha256_bytes(rendered)
            entry["transformation"] = "canonical-json-and-sanitize-v2"
            entry["sanitization_rules"] = rules
        manifest_entries.append(entry)

    pending_cases: list[dict[str, Any]] = []
    delivery_doc_targets: list[tuple[str, str, Path]] = []
    for relative, data in delivery_files:
        disposition, reason, target = delivery_disposition(relative)
        entry = {
            "source": "agent-delivery-data",
            "path": relative,
            "size": len(data),
            "sha256": sha256_bytes(data),
            "disposition": disposition,
            "reason": reason,
        }
        if target:
            entry["target"] = target
        if disposition == "sanitized":
            sanitized, rules = sanitize_text(data.decode("utf-8"))
            target_path = history / target[len("history/") :]
            plan(target_path, sanitized.encode("utf-8"))
            entry["sanitized_sha256"] = sha256_bytes(sanitized.encode("utf-8"))
            entry["sanitization_rules"] = rules
            domain, rest = relative.split("/", 1)
            delivery_doc_targets.append((DOMAIN_MAP[domain][1], rest, target_path))
        elif disposition == "migrated" and relative.endswith("eval/cases.jsonl"):
            domain = relative.split("/", 1)[0]
            slug, label, _prefix, _offset = DOMAIN_MAP[domain]
            for line_number, line in enumerate(data.decode("utf-8").splitlines(), start=1):
                if not line.strip():
                    continue
                original = json.loads(line)
                case, sanitization_rules = sanitize_json(original)
                original_source_type = case.pop("source_type", None)
                case["requirement_ids"] = [map_requirement(value) for value in case.get("requirement_ids", [])]
                case["required_trials"] = 1
                case["review_status"] = "pending"
                case["acceptance_mapping_status"] = "pending"
                case["migration"] = {
                    "source_domain": slug,
                    "source_line": line_number,
                    "original_requirement_ids": original.get("requirement_ids", []),
                    "original_source_type": original_source_type,
                    "quality_review": case.get("context", {}).get("quality_review"),
                    "sanitization_rules": sanitization_rules,
                }
                pending_cases.append(case)
        manifest_entries.append(entry)

    if len(pending_cases) != 200:
        raise ValueError(f"pending Case 数量应为 200，实际为 {len(pending_cases)}")
    case_ids = [case["id"] for case in pending_cases]
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("pending Case ID 存在重复")

    cases_path = experiment / "candidate" / "delivery" / "eval" / "cases.pending.jsonl"
    plan(
        cases_path,
        "".join(json.dumps(case, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for case in pending_cases).encode("utf-8"),
    )

    manifest = {
        "schema_version": "1.0",
        "generated_for": EXPERIMENT_ID,
        "source_authorization": "用户提供的内部迁移来源；未发现独立许可证文件",
        "sources": [
            {
                "id": "claude-code-archive",
                "kind": "tar.gz",
                "path": "/home/admin/Downloads/security-operations-expert.tar.gz",
                "sha256": ARCHIVE_SHA256,
                "file_count": 86,
                "directory_count": 43,
                "intake_status": "review_required",
            },
            {
                "id": "agent-delivery-data",
                "kind": "directory",
                "path": "/home/admin/Downloads/agent_delivery_data",
                "tree_sha256": DELIVERY_TREE_SHA256,
                "file_count": 50,
                "directory_count": 12,
                "intake_status": "review_required",
            },
        ],
        "entries": sorted(manifest_entries, key=lambda item: (item["source"], item["path"])),
    }
    id_map = {
        "schema_version": "1.0",
        "experiment_id": EXPERIMENT_ID,
        "requirement_ranges": {
            "REQ-RSP-001..010": "REQ-001..010",
            "REQ-INS-001..008": "REQ-011..018",
            "REQ-FLT-001..010": "REQ-019..028",
            "REQ-POL-001..010": "REQ-029..038",
        },
        "case_id_policy": "保留原 case-rsp/ins/flt/pol-*；四域合并后仍唯一",
        "acceptance_id_policy": "pending；不得机械发明业务 AC 或阈值",
        "pending_case_count": len(pending_cases),
    }
    plan(experiment / "candidate" / "migration-id-map.json", json_bytes(id_map))

    history_readme = """# security-operations-expert 迁移历史\n\n本目录保存 2026-09-15 接收的旧 Harness 和初版交付材料的可审计迁移记录。原始归档与目录仍保留在仓库外，未复制原压缩包。\n\n`source-manifest.json` 对 86 个归档文件和 50 个交付文件逐一记录摘要、大小、处置原因和目标。`delivery-docs/` 与 `archive-docs/` 仅是清洗后的历史证据，不会被 DSH Profile 挂载，也不是当前正式交付事实源。旧 Hook、测试、部署脚本、环境文件和 Runtime 配置仅保留摘要，未执行、未激活。\n"""
    history_readme += "\n旧 `CLAUDE.md`、`agent.yaml` 和四个角色配置标记为 `manual-transform`，清单绑定其人工合并目标的摘要；脚本没有自动生成这些目标。\n"
    history_readme += "\n摄取脚本默认只允许一次写入。若需要显式刷新，先确认本目录 `source-manifest.json` 与 Experiment 的 `evaluation/source-inventory.json` 摘要相同，再传入 `--refresh-generated --expect-existing-manifests-sha256 <确认过的摘要>`；任一旧清单或生成目标漂移均拒绝覆盖。\n"
    plan(history / "README.md", history_readme.encode("utf-8"))

    delivery_record = """# security-operations-expert 迁移候选交付记录\n\n- Agent ID：`security-operations-expert`\n- Experiment：`EXP-security-operations-expert-001`\n- 风险等级：高\n- 最低复核等级：R3\n- 当前唯一结论：退回整改\n- 结论依据：已有历史实质失败，且 200 条输入尚未完成业务逐条复核、AC 绑定和正式 DSH Trial。\n\n## 一、智能体需求定义（迁移草稿）\n\n四个能力域的旧需求已完成稳定编号映射：响应处置 `REQ-001..010`、巡检 `REQ-011..018`、故障排查 `REQ-019..028`、策略配置 `REQ-029..038`。原始需求正文保存在迁移历史中。业务负责人尚未确认项目特有 `AC-xxx`、硬门禁阈值和需求到 AC 的关联，因此本文件不伪造正式 AC。\n\nDSH 迁移新增的技术硬门禁包括：仅在容器中装载、开发 Candidate 与受控 Runtime 平面隔离、正式快照只读、凭据仅由 Runtime 注入、角色工具权限衰减，以及变更后必须重建新 Session。它们将在业务 AC 明确后建立 `CTRL → AC → Case` 映射。\n\n## 二、用户场景与输入覆盖矩阵（待业务复核）\n\n200 条不同输入已迁移至 `eval/cases.pending.jsonl`，Case ID 全部保留且无重复。它们覆盖响应处置、巡检、故障排查和策略配置，但旧矩阵存在一格多需求、缩写 Case ID 和非规范输入变体矩阵等问题；正式矩阵须在 AC 绑定时从经复核 Case 元数据重新生成。\n\n## 三、任务与评估数据集说明\n\n当前文件是迁移候选，不是正式 Eval Set。所有 Case 的 `review_status` 和 `acceptance_mapping_status` 均为 `pending`；旧 `synthetic_reviewed` 声明仅作为 `migration.original_source_type` 保存，因为原材料同时标注 `technical_only_pending_domain_signoff`。本轮不生成 `cases.jsonl` 或 `results.csv`。\n\n## 四、安全与控制边界\n\n旧 Prompt、权限配置和 Hook 不能充当 DSH 强制控制。候选以 DSH native guard、角色 `toolFilter`、只读 managed 挂载、Runtime 审批、MCP 服务端权限及独立审计重建控制。生产 Release 不允许自修改；开发态自修改只产生待审 Candidate diff，不授予激活或晋升权。\n\n## 五、候选基线状态\n\n当前尚未冻结 `bl-<UUIDv4>`。DSH Commit、镜像、Profile、Preset、插件、MCP roster/schema、模型、控制、Eval Set、评估器和环境尚未形成完整冻结组合。不得把本 Experiment、旧 Commit 或空结果表称为候选基线。\n\n## 六、自测与交付评估报告\n\n### 已确认的实质失败\n\n- 巡检历史 Workspace 测试存在 7 项失败。\n- 故障排查历史 Manifest 契约存在 1 项失败，Live 检查有 3 项跳过。\n- 策略配置历史跨域路由存在 2 项失败，Console 测试未执行。\n- 响应处置没有正式 Trial，材料不能证明完整交付。\n\n### 材料缺口\n\n- 200 条 Case 缠绕 `synthetic_reviewed` 与待业务签字的矛盾状态。\n- 全部 Case 缺少 `acceptance_id`，旧结果文件没有 Trial，且不符合当前 17 列契约。\n- 威胁研判、知识检索和通用安全调查虽随 Harness 迁入，但没有独立交付评估；启用前必须补齐范围或在 Release 中禁用。\n- 真实模型、真实 MCP、最终业务状态与审计链尚未执行 R3。\n\n### 唯一结论\n\n退回整改。机器结构检查或 Mock MCP 集成验证均不得改写此结论。\n\n### 历史正文索引\n\n"""
    delivery_record = delivery_record.replace(
        "以及变更后必须重建新 Session。",
        "以及进入 Candidate Verification 或正式评估前必须使用复核后的快照、新容器和新 Session。",
    ).replace(
        "生产 Release 不允许自修改；开发态自修改只产生待审 Candidate diff，不授予激活或晋升权。",
        "生产 Release 不允许自修改；隔离 Authoring 当前 Session 可实时看到探索行为，但模型写入只形成待审 Candidate diff，不授予 Candidate Verification 或正式评估的激活、Baseline 冻结或 Release 晋升权。",
    ).replace(
        "- 响应处置没有正式 Trial，材料不能证明完整交付。\n", ""
    ).replace(
        "### 材料缺口\n\n",
        "### 材料缺口\n\n- 响应处置没有正式 Trial，材料不能证明完整交付；这不是已确认的实质失败。\n",
    ).replace(
        "### 历史正文索引\n\n",
        "### 历史正文索引\n\n来源的 50 个文件均逐项列入摘要清单，但并非全部复制进仓库：六件套与非执行 README 仅清洗保存在历史目录，200 个 Case 仅转成待复核候选；旧 `.env.example`、部署/测试脚本和无 Trial 的旧空结果表仅保留 SHA-256、大小及拒绝物化原因，未执行或激活。\n\n",
    )
    for label, name, target_path in sorted(delivery_doc_targets):
        rel = target_path.relative_to(repo).as_posix()
        delivery_record += f"- {label} / {name}：`{rel}`\n"
    record_path = experiment / "candidate" / "delivery" / "交付记录.md"
    plan(record_path, delivery_record.encode("utf-8"))

    audit = f"""# 交付迁移审计\n\n## 已观察事实\n\n- 旧 Harness：86 个文件、43 个目录，归档摘要 `{ARCHIVE_SHA256}`，接收状态 `review_required`。\n- 初版交付：50 个文件、12 个目录，目录树摘要 `{DELIVERY_TREE_SHA256}`，接收状态 `review_required`。\n- 四域合计 200 个 Case，Case ID 唯一；全部为 blocking。正式 `acceptance_id` 和 Trial 均缺失。\n- 来源中的脚本、Hook、MCP 与部署文件均未执行。逐文件处置见 `source-inventory.json`。\n\n## 迁移判断\n\n历史内容可作为需求、行为和安全控制的迁移输入，但不能证明 DSH 行为等价。当前材料存在实质失败，故唯一交付结论为“退回整改”，最低独立复核等级为 R3。\n\n## 后续硬门禁\n\n业务负责人逐条复核输入并确认 AC 后，才能物化正式 `cases.jsonl`。真实 Trial 必须使用冻结的 DSH 容器组合和 17 列结果契约；完整 R3 通过前不得创建稳定 Baseline、Release 或 `current/`。\n"""
    plan(experiment / "evaluation" / "delivery-migration-audit.md", audit.encode("utf-8"))

    agent_manifest = """schema_version: "1.0"\nagent_id: security-operations-expert\nlifecycle_status: experiment\nruntime_family: dsh\nload_mode: container-only\nactive_experiment: EXP-security-operations-expert-001\ndelivery_status: returned-for-remediation\nminimum_review_level: R3\n"""
    agent_path = repo / "agents" / AGENT_ID / "manifest.yaml"
    plan(agent_path, agent_manifest.encode("utf-8"))

    # 生成清单记录所有自动生成目标摘要；手工合并目标仅被读取与绑定，不会被写入。
    manifest["generated_outputs"] = [
        {"path": path.relative_to(repo).as_posix(), "sha256": sha256_bytes(data)}
        for path, data in sorted(planned_writes.items(), key=lambda item: item[0].as_posix())
    ]
    plan(history / "source-manifest.json", json_bytes(manifest))
    plan(experiment / "evaluation" / "source-inventory.json", json_bytes(manifest))

    skill_root = experiment / "candidate" / "dsh" / "workspace" / ".agents" / "skills"
    generated_skills = [
        path for path in planned_writes if path.parent.parent == skill_root and path.name == "SKILL.md"
    ]
    if len(generated_skills) != 25:
        raise ValueError(f"DSH 可发现 Skill 数量不符：{len(generated_skills)} / 25")
    for path, data in planned_writes.items():
        if not path.as_posix().startswith(skill_root.as_posix() + "/"):
            continue
        rendered = data.decode("utf-8")
        if sanitize_text(rendered)[0] != rendered or re.search(
            r"(?i)\b(?:ssh|sftp|https?|git\+ssh)://|\bgit@[^\s:]+:", rendered
        ):
            raise ValueError(f"可装载 DSH Skill 或参考材料仍含私有 URL/IP：{path.relative_to(repo)}")
    schema_root = experiment / "candidate" / "dsh" / "managed" / "schemas"
    for path, data in planned_writes.items():
        if path.parent != schema_root or path.suffix != ".json":
            continue
        schema = json.loads(data)
        if not isinstance(schema, dict) or schema.get("$schema") != PUBLIC_JSON_SCHEMA_URI:
            raise ValueError(f"DSH 输出 Schema 元模式 URI 未按白名单保留：{path.relative_to(repo)}")
        if sanitize_json_schema(schema)[0] != schema:
            raise ValueError(f"DSH 输出 Schema 仍含非白名单 URL/IP：{path.relative_to(repo)}")

    previous_inventory = experiment / "evaluation" / "source-inventory.json"
    previous_source_manifest = history / "source-manifest.json"
    prior_hashes = lock_existing_manifests(
        repo,
        previous_inventory,
        previous_source_manifest,
        args.expect_existing_manifests_sha256,
        args.refresh_generated,
    )
    if previous_inventory.is_file() and not previous_inventory.is_symlink():
        previous = json.loads(previous_inventory.read_text(encoding="utf-8"))
        prior_hashes.update({item["path"]: item["sha256"] for item in previous.get("generated_outputs", [])})
        for item in previous.get("entries", []):
            target = item.get("target")
            digest = item.get("migrated_sha256") or item.get("sanitized_sha256")
            if target and digest and item.get("disposition") in {"migrated", "sanitized"}:
                if target.startswith("history/"):
                    resolved = history / target[len("history/") :]
                else:
                    resolved = experiment / target
                prior_hashes.setdefault(resolved.relative_to(repo).as_posix(), digest)

    existing = [path for path in planned_writes if path.exists() or path.is_symlink()]
    if existing and not args.refresh_generated:
        examples = ", ".join(path.relative_to(repo).as_posix() for path in sorted(existing)[:3])
        raise ValueError(f"一次性摄取目标已存在，拒绝默认覆盖：{examples}；若确需重生请显式使用 --refresh-generated")
    if existing and args.refresh_generated and not prior_hashes.get(previous_inventory.relative_to(repo).as_posix()):
        raise ValueError("已有生成目标却缺少可核验的旧清单摘要，拒绝刷新不完整的迁移")
    verify_generated_targets(repo, list(planned_writes), prior_hashes)

    for path, data in sorted(planned_writes.items(), key=lambda item: item[0].as_posix()):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, UnicodeError, tarfile.TarError, json.JSONDecodeError) as error:
        print(f"迁移拒绝：{error}", file=sys.stderr)
        raise SystemExit(2)
