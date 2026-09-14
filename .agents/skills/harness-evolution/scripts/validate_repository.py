#!/usr/bin/env python3
"""校验 ai-agent-harness 的来源锁定、技能结构和资产演进不变量。"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

try:
    import yaml
except ImportError:  # pragma: no cover - 缺少依赖时由资产结构检查 fail-closed
    yaml = None


SCHEMA_VERSION = "1.0"
FROZEN_SPEC_COMMIT = "1afe0eec1bb786e5313bb0a06717871fd14ebe28"
STANDARD_COPIES = {
    "Harness_Repo目录结构设计说明_v1.1.md": "47e91605ebff45baf269c7f85218ce69c58ada0a6cd78c8f7d8e5524bea44705",
    "Harness_Asset_Repository规范_v1.0.md": "9a83b79a4b48cac99f8f56e69f9b63e2d9c78bb3db5f75be6f7e4501685fd502",
}
REQUIRED_ROOT_FILES = (
    "README.md",
    "AGENTS.md",
    "VERSION.md",
    "CHANGELOG.md",
    ".gitignore",
    ".codex/config.toml",
    "docs/standards/SOURCES.md",
    "docs/standards/PROJECT-INTERPRETATION.md",
)
REQUIRED_SKILLS = (
    "legacy-asset-intake",
    "harness-evolution",
    "baseline-eval",
    "security-control-boundary",
    "delivery-review",
    "dsh-release-verify",
)
REQUIRED_SKILL_RESOURCES = {
    "legacy-asset-intake": ("scripts/inspect_source.py",),
    "harness-evolution": (
        "scripts/validate_repository.py",
        "scripts/requirements.txt",
        "references/repository-invariants.md",
    ),
    "baseline-eval": ("scripts/validate_delivery.py", "references/delivery-contract.md"),
}
OPTIONAL_ASSET_DIRS = (
    "agents",
    "tasks",
    "eval",
    "evolution",
    "plugins",
    "mcp",
    "runtime",
    "releases",
)
PLACEHOLDER_NAMES = {".gitkeep", ".keep", ".DS_Store", ".gitignore"}
KEBAB_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
EXPERIMENT_RE = re.compile(r"^EXP-([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9]{3,})$")
SEMVER_NUMBER = r"(?:0|[1-9][0-9]*)"
SEMVER_PRERELEASE_IDENTIFIER = r"(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)"
SEMVER_PATTERN = (
    SEMVER_NUMBER
    + r"\."
    + SEMVER_NUMBER
    + r"\."
    + SEMVER_NUMBER
    + r"(?:-"
    + SEMVER_PRERELEASE_IDENTIFIER
    + r"(?:\."
    + SEMVER_PRERELEASE_IDENTIFIER
    + r")*)?"
    + r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
)
VERSIONED_ASSET_RE = re.compile(
    r"^([a-z0-9]+(?:-[a-z0-9]+)*)-v" + SEMVER_PATTERN + r"$"
)
UUID_V4_PATTERN = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
BASELINE_ID_RE = re.compile(r"^bl-" + UUID_V4_PATTERN + r"$")
RUN_ID_RE = re.compile(r"^run-" + UUID_V4_PATTERN + r"$")
MAX_ASSET_DEPTH = 256
MAX_ASSET_NODES = 100_000
MAX_ASSET_FILE_BYTES = 64 * 1024 * 1024
MAX_ASSET_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_TEXT_BYTES = 4 * 1024 * 1024
MAX_YAML_NODES = 50_000
MAX_YAML_ALIASES = 1_000


def issue(code: str, message: str, path: Optional[str] = None) -> Dict[str, str]:
    value = {"code": code, "message": message}
    if path:
        value["path"] = path
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def has_real_path_components(root: Path, path: Path) -> bool:
    """逐级 lstat，防止最终文件正常但任一父目录是符号链接。"""

    try:
        relative_path = path.relative_to(root)
    except ValueError:
        return False
    current = root
    for index, part in enumerate(relative_path.parts):
        current = current / part
        try:
            metadata = current.lstat()
        except OSError:
            return False
        if stat.S_ISLNK(metadata.st_mode):
            return False
        if index < len(relative_path.parts) - 1 and not stat.S_ISDIR(metadata.st_mode):
            return False
    return True


def is_nonempty_regular_file(path: Path, root: Optional[Path] = None) -> bool:
    """拒绝符号链接、父级路径逃逸、硬链接、特殊文件和零字节占位。"""

    if root is not None and not has_real_path_components(root, path):
        return False
    try:
        metadata = path.lstat()
    except OSError:
        return False
    return (
        stat.S_ISREG(metadata.st_mode)
        and metadata.st_nlink == 1
        and 0 < metadata.st_size <= MAX_ASSET_FILE_BYTES
    )


def read_text_limited(root: Path, path: Path, max_bytes: int = MAX_TEXT_BYTES) -> str:
    """只读取仓库内真实、单链接且大小受限的 UTF-8 普通文件。"""

    if not has_real_path_components(root, path):
        raise ValueError("路径含符号链接、特殊父级或越出仓库")
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise ValueError("不是单链接普通文件")
    if metadata.st_size <= 0:
        raise ValueError("文件为空")
    if metadata.st_size > max_bytes:
        raise ValueError("文本文件超过 %d 字节上限" % max_bytes)
    return path.read_bytes().decode("utf-8")


def substantive_text(root: Path, path: Path) -> Optional[str]:
    try:
        text = read_text_limited(root, path)
    except (OSError, UnicodeError, ValueError):
        return None
    return text if text.strip() else None


def path_present(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def relative(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def child_directories(
    root: Path,
    directory: Path,
    errors: List[Dict[str, str]],
    code: str,
) -> Iterable[Path]:
    if not directory.is_dir() or directory.is_symlink():
        return []
    children: List[Path] = []
    with os.scandir(str(directory)) as entries:
        for index, entry in enumerate(entries, start=1):
            if index > MAX_ASSET_NODES:
                errors.append(issue("CONTAINER_CHILD_LIMIT", "结构容器的直接子项超过检查上限", relative(directory, root)))
                break
            path = Path(entry.path)
            if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
                errors.append(issue(code, "该容器的直接子项必须是真实目录", relative(path, root)))
            else:
                children.append(path)
    return sorted(children)


def require_files(
    root: Path,
    base: Path,
    names: Sequence[str],
    errors: List[Dict[str, str]],
    code: str,
) -> None:
    for name in names:
        target = base / name
        if not is_nonempty_regular_file(target, root) or substantive_text(root, target) is None:
            errors.append(issue(code, "缺少必需的非空普通文件", relative(target, root)))


def parse_frontmatter(root: Path, skill_file: Path) -> Tuple[Optional[str], Optional[str]]:
    try:
        text = read_text_limited(root, skill_file)
    except (OSError, UnicodeError, ValueError):
        return None, None
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, flags=re.DOTALL)
    if not match:
        return None, None
    name_match = re.search(r"^name:\s*['\"]?([^'\"\n]+)['\"]?\s*$", match.group(1), flags=re.MULTILINE)
    description_match = re.search(
        r"^description:\s*['\"]?([^\n]+?)['\"]?\s*$", match.group(1), flags=re.MULTILINE
    )
    return (
        name_match.group(1).strip() if name_match else None,
        description_match.group(1).strip() if description_match else None,
    )


def validate_skill(root: Path, name: str, errors: List[Dict[str, str]]) -> None:
    skill_dir = root / ".agents" / "skills" / name
    skill_file = skill_dir / "SKILL.md"
    metadata_file = skill_dir / "agents" / "openai.yaml"
    if not is_nonempty_regular_file(skill_file, root) or substantive_text(root, skill_file) is None:
        errors.append(issue("SKILL_MISSING", "缺少非空普通文件形式的项目技能入口", relative(skill_file, root)))
        return
    if not is_nonempty_regular_file(metadata_file, root) or substantive_text(root, metadata_file) is None:
        errors.append(issue("SKILL_METADATA_MISSING", "缺少非空普通文件形式的技能 UI/调用策略", relative(metadata_file, root)))
        return
    declared_name, description = parse_frontmatter(root, skill_file)
    if declared_name != name:
        errors.append(issue("SKILL_NAME_MISMATCH", "SKILL.md name 与目录名不一致", relative(skill_file, root)))
    if not description or "TODO" in description:
        errors.append(issue("SKILL_DESCRIPTION", "技能 description 缺失或仍为占位内容", relative(skill_file, root)))
    try:
        metadata = read_text_limited(root, metadata_file)
    except (OSError, UnicodeError, ValueError):
        errors.append(issue("SKILL_METADATA_INVALID", "技能 UI/调用策略必须是大小受限的 UTF-8 文本", relative(metadata_file, root)))
        return
    prompt_match = re.search(r'^\s*default_prompt:\s*"([^"]*)"\s*$', metadata, flags=re.MULTILINE)
    if not prompt_match or "$" + name not in prompt_match.group(1):
        errors.append(issue("SKILL_DEFAULT_PROMPT", "default_prompt 必须显式包含技能调用名", relative(metadata_file, root)))
    if not re.search(r"^\s*allow_implicit_invocation:\s*true\s*$", metadata, flags=re.MULTILINE):
        errors.append(issue("SKILL_INVOCATION_POLICY", "项目技能必须允许隐式调用", relative(metadata_file, root)))
    for resource_name in REQUIRED_SKILL_RESOURCES.get(name, ()):
        resource = skill_dir / resource_name
        if not is_nonempty_regular_file(resource, root) or substantive_text(root, resource) is None:
            errors.append(
                issue(
                    "SKILL_RESOURCE_INVALID",
                    "技能必需资源必须是非空普通文件",
                    relative(resource, root),
                )
            )
    for line_number, line in enumerate(metadata.splitlines(), start=1):
        if re.match(r"^\s*(?:display_name|short_description|default_prompt):", line) and not re.match(
            r'^\s*[a-z_]+:\s*".*"\s*$', line
        ):
            errors.append(
                issue(
                    "SKILL_METADATA_QUOTING",
                    "openai.yaml 的字符串值必须使用双引号",
                    "%s:%d" % (relative(metadata_file, root), line_number),
                )
            )


def parse_flat_scalar_text(text: str, allow_document_markers: bool = False) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
    """解析唯一一份受限的顶层标量 YAML。"""

    values: Dict[str, str] = {}
    lines = text.splitlines()
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if line in {"---", "..."}:
            is_boundary = (line == "---" and line_number == 1) or (line == "..." and line_number == len(lines))
            if allow_document_markers and is_boundary:
                continue
            return None, "第 %d 行包含不允许的 YAML 文档边界" % line_number
        if raw_line[0].isspace() or "\t" in raw_line:
            return None, "第 %d 行不是顶层标量" % line_number
        match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)", line)
        if not match:
            return None, "第 %d 行不是合法的 key: value" % line_number
        key, raw_value = match.groups()
        if key in values:
            return None, "第 %d 行重复声明 %s" % (line_number, key)
        value = raw_value.strip()
        if not value:
            return None, "第 %d 行的 %s 为空" % (line_number, key)
        if value.startswith('"'):
            try:
                decoded = json.loads(value)
            except (ValueError, json.JSONDecodeError):
                return None, "第 %d 行的双引号值无效" % line_number
            if not isinstance(decoded, str):
                return None, "第 %d 行必须是字符串标量" % line_number
            value = decoded
        elif value.startswith("'"):
            if not re.fullmatch(r"'(?:[^']|'')*'", value):
                return None, "第 %d 行的单引号值无效" % line_number
            value = value[1:-1].replace("''", "'")
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
            if not value or value[0] in "[{&*!|>@`" or value.endswith(":"):
                return None, "第 %d 行必须是简单非空标量" % line_number
        if not value.strip() or any(ord(character) < 32 for character in value):
            return None, "第 %d 行包含空值或控制字符" % line_number
        values[key] = value
    if not values:
        return None, "文件不含顶层标量"
    return values, None


def parse_flat_manifest(root: Path, path: Path) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
    """解析发布控制面采用的受限顶层标量 YAML；复杂配置不使用该格式。"""

    try:
        text = read_text_limited(root, path)
    except (OSError, UnicodeError, ValueError) as exc:
        return None, str(exc)
    return parse_flat_scalar_text(text, allow_document_markers=True)


def is_placeholder_scalar(value: str) -> bool:
    normalized = value.strip().lower()
    return bool(
        not normalized
        or re.match(r"^(?:n/?a|none|null|todo|tbd|unknown)(?:\b|\s|[:：(-])", normalized)
        or re.match(r"^(?:待定|待补|待填写|占位|未知)(?:$|[：:（(\s])", value.strip())
    )


def yaml_value_is_material(value: object, seen: Optional[Set[int]] = None) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return not is_placeholder_scalar(value)
    if isinstance(value, (bool, int, float)):
        return not isinstance(value, float) or math.isfinite(value)
    if seen is None:
        seen = set()
    identity = id(value)
    if identity in seen:
        return False
    seen.add(identity)
    if isinstance(value, dict):
        return any(
            not is_placeholder_scalar(str(key)) and yaml_value_is_material(item, seen)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(yaml_value_is_material(item, seen) for item in value)
    return False


def load_bounded_yaml(text: str) -> object:
    if yaml is None:
        raise ValueError("缺少 PyYAML；无法安全验证 Harness YAML")

    class BoundedUniqueSafeLoader(yaml.SafeLoader):  # type: ignore[union-attr]
        def __init__(self, stream: str) -> None:
            super().__init__(stream)
            self.node_count = 0
            self.alias_count = 0

        def compose_node(self, parent: object, index: object) -> object:
            self.node_count += 1
            if self.node_count > MAX_YAML_NODES:
                raise ValueError("YAML 节点超过检查上限")
            if self.check_event(yaml.events.AliasEvent):
                self.alias_count += 1
                if self.alias_count > MAX_YAML_ALIASES:
                    raise ValueError("YAML alias 超过检查上限")
            return super().compose_node(parent, index)

        def construct_mapping(self, node: object, deep: bool = False) -> Dict[object, object]:
            self.flatten_mapping(node)
            mapping: Dict[object, object] = {}
            for key_node, value_node in node.value:
                key = self.construct_object(key_node, deep=deep)
                try:
                    duplicate = key in mapping
                except TypeError as exc:
                    raise ValueError("YAML mapping key 必须可哈希") from exc
                if duplicate:
                    raise ValueError("YAML mapping key 重复：%s" % key)
                mapping[key] = self.construct_object(value_node, deep=deep)
            return mapping

    return yaml.load(text, Loader=BoundedUniqueSafeLoader)


def structured_yaml_text(root: Path, path: Path) -> Optional[str]:
    """安全解析复杂 YAML，并拒绝空文档、重复键和纯占位结构。"""

    text = substantive_text(root, path)
    if text is None or "\x00" in text or "\t" in text:
        return None
    try:
        value = load_bounded_yaml(text)
    except Exception:  # PyYAML 的 Parser/Constructor 异常类型跨版本不同
        return None
    if not isinstance(value, (dict, list)) or not yaml_value_is_material(value):
        return None
    return text


def markdown_visible_lines(text: str) -> List[str]:
    """Remove bounded HTML comment spans without rendering or executing Markdown."""

    values: List[str] = []
    in_comment = False
    for source_line in text.splitlines():
        visible_parts: List[str] = []
        offset = 0
        while offset < len(source_line):
            if in_comment:
                end = source_line.find("-->", offset)
                if end < 0:
                    offset = len(source_line)
                else:
                    in_comment = False
                    offset = end + 3
                continue
            start = source_line.find("<!--", offset)
            if start < 0:
                visible_parts.append(source_line[offset:])
                offset = len(source_line)
                continue
            visible_parts.append(source_line[offset:start])
            offset = start + 4
            in_comment = True
        values.append("".join(visible_parts))
    return values


def markdown_container_content(line: str) -> str:
    value = line.strip()
    match = re.match(
        r"^(?:(?:>\s*)|(?:(?:[-*+]|[0-9]{1,9}[.)])\s+)|(?:\[[ xX]\]\s*))+",
        value,
    )
    return value[match.end() :].strip() if match else value


def markdown_semantic_line(line: str) -> str:
    value = markdown_container_content(line)
    for _ in range(8):
        previous = value
        value = value.rstrip("。.!！?？,，;；:").strip()
        link = re.fullmatch(r"\[([^\]\n]+)\]\([^\n)]*\)", value)
        reference_link = re.fullmatch(r"\[([^\]\n]+)\]\[[^\]\n]*\]", value)
        html_wrapper = re.fullmatch(
            r"<(strong|em|code|del)>\s*(.*?)\s*</\1>",
            value,
            flags=re.IGNORECASE,
        )
        if link:
            value = link.group(1).strip()
        elif reference_link:
            value = reference_link.group(1).strip()
        elif html_wrapper:
            value = html_wrapper.group(2).strip()
        else:
            for opening, closing in (("**", "**"), ("__", "__"), ("~~", "~~"), ("`", "`"), ("*", "*"), ("_", "_")):
                if value.startswith(opening) and value.endswith(closing) and len(value) > len(opening) + len(closing):
                    value = value[len(opening) : -len(closing)].strip()
                    break
        if value == previous:
            break
    return value


def markdown_opening_fence(line: str) -> Optional[Tuple[str, int]]:
    match = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
    if not match:
        return None
    marker = match.group(1)
    info = match.group(2)
    if marker.startswith("`") and "`" in info:
        return None
    return marker[0], len(marker)


def markdown_is_closing_fence(line: str, fence: Tuple[str, int]) -> bool:
    marker, minimum_length = fence
    return bool(re.fullmatch(r" {0,3}%s{%d,}[ \t]*" % (re.escape(marker), minimum_length), line))


def markdown_has_body(text: str) -> bool:
    fence: Optional[Tuple[str, int]] = None
    for line in markdown_visible_lines(text):
        content = markdown_container_content(line)
        if fence is not None:
            if markdown_is_closing_fence(content, fence):
                fence = None
                continue
            stripped_code = content.strip()
            if not stripped_code:
                continue
            code_text = re.sub(r"^[#;/\s*-]+", "", stripped_code)
            if not is_placeholder_scalar(markdown_semantic_line(code_text)):
                return True
            continue
        opening_fence = markdown_opening_fence(content)
        if opening_fence is not None:
            fence = opening_fence
            continue
        stripped = content
        if (
            not stripped
            or stripped.startswith(("#", "<!--"))
            or re.fullmatch(r"[>*_`~\-=\s]+", stripped)
        ):
            continue
        semantic_text = markdown_semantic_line(stripped)
        if is_placeholder_scalar(semantic_text):
            continue
        return True
    return False


def markdown_has_material_list_item(text: str) -> bool:
    fence: Optional[Tuple[str, int]] = None
    for line in markdown_visible_lines(text):
        content = markdown_container_content(line)
        if fence is not None:
            if markdown_is_closing_fence(content, fence):
                fence = None
            continue
        opening_fence = markdown_opening_fence(content)
        if opening_fence is not None:
            fence = opening_fence
            continue
        if line.startswith("\t") or len(line) - len(line.lstrip(" ")) > 3:
            continue
        if not re.match(r"^ {0,3}(?:[-*+]|[0-9]{1,9}[.)])\s+\S", line):
            continue
        if not is_placeholder_scalar(markdown_semantic_line(line)):
            return True
    return False


def substantive_markdown(root: Path, path: Path) -> Optional[str]:
    text = substantive_text(root, path)
    return text if text is not None and markdown_has_body(text) else None


TEXT_SUFFIXES = {
    ".csv",
    ".json",
    ".jsonl",
    ".md",
    ".py",
    ".sh",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}


def is_material_asset_file(root: Path, path: Path) -> bool:
    if path.name in PLACEHOLDER_NAMES or not is_nonempty_regular_file(path, root):
        return False
    suffix = path.suffix.lower()
    if suffix == ".md":
        return substantive_markdown(root, path) is not None
    if suffix in {".yaml", ".yml"}:
        return structured_yaml_text(root, path) is not None
    if suffix == ".json":
        try:
            value = load_json_object(root, path)
        except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
            return False
        return yaml_value_is_material(value)
    if suffix in TEXT_SUFFIXES:
        text = substantive_text(root, path)
        if text is None:
            return False
        semantic_text = re.sub(r"^[#;/\s*-]+", "", text.strip())
        return not is_placeholder_scalar(semantic_text)
    return True


def files_below(directory: Path, asset_files: Sequence[Path]) -> List[Path]:
    values: List[Path] = []
    for path in asset_files:
        try:
            path.relative_to(directory)
        except ValueError:
            continue
        values.append(path)
    return values


def index_child_asset_files(container: Path, asset_files: Sequence[Path]) -> Dict[str, List[Path]]:
    """一次扫描把文件分组到结构容器的直接子目录，避免每个版本重复遍历全树。"""

    values: Dict[str, List[Path]] = {}
    for path in asset_files:
        try:
            relative_path = path.relative_to(container)
        except ValueError:
            continue
        if len(relative_path.parts) < 2:
            continue
        values.setdefault(relative_path.parts[0], []).append(path)
    return values


def unique_json_object(pairs: Sequence[Tuple[str, object]]) -> Dict[str, object]:
    value: Dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key: %s" % key)
        value[key] = item
    return value


def strict_json_equal(left: object, right: object) -> bool:
    """JSON schema equality must not inherit Python's bool/int or int/float coercion."""

    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        if set(left) != set(right):
            return False
        return all(strict_json_equal(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(
            strict_json_equal(left_item, right_item)
            for left_item, right_item in zip(left, right)
        )
    return left == right


def reject_json_constant(value: str) -> object:
    raise ValueError("non-finite JSON constant: %s" % value)


def load_json_object(root: Path, path: Path) -> Dict[str, object]:
    text = read_text_limited(root, path)
    value = json.loads(
        text,
        object_pairs_hook=unique_json_object,
        parse_constant=reject_json_constant,
    )
    if not isinstance(value, dict):
        raise ValueError("JSON 顶层必须是对象")
    if json_has_nonfinite_number(value):
        raise ValueError("JSON 包含非有限数值")
    return value


def json_has_nonfinite_number(value: object) -> bool:
    if isinstance(value, dict):
        return any(json_has_nonfinite_number(item) for item in value.values())
    if isinstance(value, list):
        return any(json_has_nonfinite_number(item) for item in value)
    return isinstance(value, float) and not math.isfinite(value)


def artifact_records(
    root: Path,
    base: Path,
    asset_files: Sequence[Path],
    excluded_names: Set[str],
) -> List[Dict[str, object]]:
    records: List[Dict[str, object]] = []
    for path in files_below(base, asset_files):
        item = path.relative_to(base).as_posix()
        if item in excluded_names or not is_nonempty_regular_file(path, root):
            continue
        metadata = path.lstat()
        records.append(
            {
                "path": item,
                "sha256": sha256(path),
                "size": metadata.st_size,
                "mode": format(stat.S_IMODE(metadata.st_mode), "04o"),
            }
        )
    return sorted(records, key=lambda record: str(record["path"]))


def artifact_tree_digest(records: Sequence[Mapping[str, object]]) -> str:
    canonical = json.dumps(list(records), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def validate_artifact_manifest(
    root: Path,
    base: Path,
    records: Sequence[Mapping[str, object]],
    errors: List[Dict[str, str]],
    code: str,
) -> Optional[str]:
    path = base / "artifact-manifest.json"
    try:
        value = load_json_object(root, path)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        errors.append(issue(code, "artifact-manifest.json 必须是无重复键、无非有限数值的有效 JSON 对象", relative(path, root)))
        return None
    expected_digest = artifact_tree_digest(records)
    expected = {"schema_version": "1.0", "tree_sha256": expected_digest, "files": list(records)}
    if not strict_json_equal(value, expected):
        errors.append(issue(code, "artifact-manifest.json 必须逐文件精确描述完整可装载资产树", relative(path, root)))
        return None
    return expected_digest


def report_metadata(root: Path, path: Path) -> Optional[Dict[str, str]]:
    text = substantive_markdown(root, path)
    if text is None:
        return None
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, flags=re.DOTALL)
    if not match or not markdown_has_body(text[match.end() :]):
        return None
    values, parse_error = parse_flat_scalar_text(match.group(1))
    return values if parse_error is None else None


def release_report_body_has_fixed_conclusion(root: Path, path: Path) -> bool:
    """Parse a closed machine-conclusion block; free-form evidence stays manual."""

    text = substantive_markdown(root, path)
    if text is None:
        return False
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, flags=re.DOTALL)
    if not match:
        return False
    body = text[match.end() :]
    conclusion = re.match(
        r"\A\s*# 评估报告\s*\n+"
        r"\s*## 机器结论\s*\n+"
        r"\s*-\s*正式评估运行结论\s*[:：]\s*通过\s*[。.]?\s*\n"
        r"\s*-\s*交付评估结论\s*[:：]\s*通过\s*[。.]?\s*\n+"
        r"\s*## 人工证据\s*\n+",
        body,
    )
    if not conclusion:
        return False
    evidence = body[conclusion.end() :]
    reserved_fields = re.compile(
        r"(?m)^\s*[-*+]?\s*(?:正式评估运行结论|交付评估结论)\s*[:：]"
    )
    return markdown_has_body(evidence) and reserved_fields.search(evidence) is None


def find_release_harnesses(root: Path, release: Path, agent_id: Optional[str]) -> List[Path]:
    candidates = [release / "harness.yaml", release / "harness" / "harness.yaml"]
    if agent_id:
        candidates.append(release / "agents" / agent_id / "current" / "harness.yaml")
    return [path for path in candidates if is_nonempty_regular_file(path, root)]


def normalized_release_name(agent_id: str, value: str) -> Optional[str]:
    if value.startswith(agent_id + "-v"):
        candidate = value
    elif value.startswith("v"):
        candidate = "%s-%s" % (agent_id, value)
    else:
        candidate = "%s-v%s" % (agent_id, value)
    match = VERSIONED_ASSET_RE.fullmatch(candidate)
    if not match or match.group(1) != agent_id:
        return None
    return candidate


def index_release_names(root: Path) -> Dict[str, List[str]]:
    releases = root / "releases"
    if not releases.is_dir() or releases.is_symlink():
        return {}
    values: Dict[str, List[str]] = {}
    with os.scandir(str(releases)) as entries:
        for index, entry in enumerate(entries, start=1):
            if index > MAX_ASSET_NODES:
                break
            if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
                continue
            match = VERSIONED_ASSET_RE.fullmatch(entry.name)
            if match:
                values.setdefault(match.group(1), []).append(entry.name)
    return {agent_id: sorted(names) for agent_id, names in values.items()}


def resolve_acceptance_reference(root: Path, value: str) -> Tuple[Optional[Path], Optional[str], Optional[str]]:
    path_text, separator, anchor = value.partition("#")
    candidate = Path(path_text)
    if not separator or not re.fullmatch(r"AC-[0-9]{3,}", anchor):
        return None, None, "source_ref 必须以 #AC-xxx 精确定位验收项"
    if candidate.is_absolute() or not candidate.parts or any(part in {"", ".", ".."} for part in candidate.parts):
        return None, None, "source_ref 必须是无跳转的仓库相对路径"
    target = root.joinpath(*candidate.parts)
    normalized = candidate.as_posix()
    if not re.fullmatch(
        r"agents/[a-z0-9]+(?:-[a-z0-9]+)*/delivery/(?:交付记录\.md|01_智能体需求定义\.md)",
        normalized,
    ):
        return None, None, "source_ref 必须指向 Agent 交付记录中的需求定义事实源"
    if not is_nonempty_regular_file(target, root):
        return None, None, "source_ref 指向的事实源不存在或不安全"
    try:
        text = read_text_limited(root, target)
    except (OSError, UnicodeError, ValueError):
        return None, None, "source_ref 指向的事实源不可安全读取"
    if not re.search(r"(?<![A-Za-z0-9-])%s(?![A-Za-z0-9-])" % re.escape(anchor), text):
        return None, None, "source_ref 指向的事实源不包含所引用的 AC"
    return target, anchor, None


def validate_agents(
    root: Path,
    errors: List[Dict[str, str]],
    warnings: List[Dict[str, str]],
    release_index: Mapping[str, Sequence[str]],
    asset_files: Sequence[Path],
) -> None:
    agents_dir = root / "agents"
    agent_file_index = index_child_asset_files(agents_dir, asset_files)
    release_file_index = index_child_asset_files(root / "releases", asset_files)
    for agent_dir in child_directories(root, agents_dir, errors, "AGENT_CHILD_TYPE"):
        agent_id = agent_dir.name
        if not KEBAB_RE.fullmatch(agent_id):
            errors.append(issue("AGENT_NAME", "Agent 目录必须使用小写 kebab-case", relative(agent_dir, root)))
        require_files(root, agent_dir, ("manifest.yaml",), errors, "AGENT_STRUCTURE")
        manifest = agent_dir / "manifest.yaml"
        manifest_values, manifest_error = parse_flat_manifest(root, manifest)
        if manifest_error:
            errors.append(issue("AGENT_MANIFEST_INVALID", "Agent manifest.yaml 必须使用唯一、非空的顶层标量：%s" % manifest_error, relative(manifest, root)))
        manifest_agent_id = manifest_values.get("agent_id") if manifest_values else None
        if manifest_agent_id != agent_id:
            errors.append(issue("AGENT_ID_MISMATCH", "Agent manifest.yaml 的 agent_id 必须与目录名一致", relative(manifest, root)))
        current_dir = agent_dir / "current"
        owned_releases = release_index.get(agent_id, ())
        if not path_present(current_dir):
            if owned_releases:
                errors.append(issue("CURRENT_MISSING", "已有 Release 的 Agent 必须提供 current 校验镜像", relative(agent_dir, root)))
            continue
        if not current_dir.is_dir() or current_dir.is_symlink():
            errors.append(issue("CURRENT_DIRECTORY_INVALID", "current 必须是真实目录", relative(current_dir, root)))
            continue
        current = current_dir / "harness.yaml"
        if not is_nonempty_regular_file(current, root) or structured_yaml_text(root, current) is None:
            errors.append(issue("CURRENT_HARNESS_INVALID", "current Harness 必须是非空普通文件", relative(current, root)))
            continue
        version_keys = ("current_release", "release_id", "current_version", "release_version", "version")
        version_matches = [manifest_values[key] for key in version_keys if manifest_values and key in manifest_values]
        version = version_matches[0] if len(version_matches) == 1 else None
        if not version:
            errors.append(issue("CURRENT_VERSION_UNBOUND", "存在 current Harness，但 manifest 未声明发布版本", relative(manifest, root)))
            continue
        release_name = normalized_release_name(agent_id, version)
        if release_name is None:
            errors.append(
                issue(
                    "CURRENT_VERSION_INVALID",
                    "current 发布绑定必须是本 Agent 的 <agent-id>-v<semver>、v<semver> 或 <semver>",
                    relative(manifest, root),
                )
            )
            continue
        release_dir = root / "releases" / release_name
        if not release_dir.is_dir() or release_dir.is_symlink():
            errors.append(issue("CURRENT_WITHOUT_RELEASE", "current Harness 未绑定到已存在的 Release", relative(current, root)))
            continue
        release_harnesses = find_release_harnesses(root, release_dir, agent_id)
        if not release_harnesses:
            errors.append(issue("RELEASE_HARNESS_MISSING", "Release 缺少可核对的 Harness 制品", relative(release_dir, root)))
        elif len(release_harnesses) > 1:
            errors.append(issue("RELEASE_HARNESS_AMBIGUOUS", "Release 存在多个 Harness 主文件候选", relative(release_dir, root)))
        elif sha256(current) != sha256(release_harnesses[0]):
            errors.append(issue("CURRENT_RELEASE_DIVERGED", "current Harness 与绑定 Release 内容不一致", relative(current, root)))
        current_files = [
            path
            for path in agent_file_index.get(agent_id, ())
            if path.relative_to(agent_dir).parts[0] == "current"
        ]
        current_records = artifact_records(root, current_dir, current_files, set())
        release_records = artifact_records(
            root,
            release_dir,
            release_file_index.get(release_name, ()),
            {"manifest.yaml", "artifact-manifest.json", "evaluation-report.md", "CHANGELOG.md"},
        )
        if current_records != release_records:
            errors.append(issue("CURRENT_RELEASE_TREE_DIVERGED", "current 校验镜像必须与绑定 Release 的完整可装载资产树一致", relative(current_dir, root)))
        if not (agent_dir / "components").exists():
            warnings.append(issue("AGENT_COMPONENTS_ABSENT", "Agent 尚无 components；仅在确实不存在组件时可省略", relative(agent_dir, root)))


def validate_tasks(root: Path, errors: List[Dict[str, str]], warnings: List[Dict[str, str]]) -> None:
    tasks_dir = root / "tasks"
    for task_dir in child_directories(root, tasks_dir, errors, "TASK_CHILD_TYPE"):
        if not KEBAB_RE.fullmatch(task_dir.name):
            errors.append(issue("TASK_NAME", "Task 目录必须使用小写 kebab-case", relative(task_dir, root)))
        require_files(root, task_dir, ("task-definition.yaml",), errors, "TASK_STRUCTURE")
        task_definition = task_dir / "task-definition.yaml"
        task_values, task_error = parse_flat_manifest(root, task_definition)
        if task_error:
            errors.append(issue("TASK_DEFINITION_INVALID", "task-definition.yaml 必须使用唯一、非空的顶层标量：%s" % task_error, relative(task_definition, root)))
        elif task_values is not None:
            if task_values.get("task_id") != task_dir.name:
                errors.append(issue("TASK_ID_MISMATCH", "task_id 必须与 Task 目录名一致", relative(task_definition, root)))
            required_values = ("goal", "input_contract", "requirement_source")
            missing_values = [
                key
                for key in required_values
                if not task_values.get(key)
                or is_placeholder_scalar(task_values[key])
            ]
            if missing_values:
                errors.append(issue("TASK_DEFINITION_INCOMPLETE", "task-definition.yaml 缺少非占位字段：%s" % ", ".join(missing_values), relative(task_definition, root)))
        acceptance = task_dir / "acceptance.yaml"
        if path_present(acceptance) and not is_nonempty_regular_file(acceptance, root):
            errors.append(issue("ACCEPTANCE_SOURCE_INVALID", "acceptance.yaml 必须是非空普通文件", relative(acceptance, root)))
        elif is_nonempty_regular_file(acceptance, root):
            acceptance_values, acceptance_error = parse_flat_manifest(root, acceptance)
            if acceptance_error:
                errors.append(issue("ACCEPTANCE_SOURCE_INVALID", "acceptance.yaml 必须使用唯一、非空的顶层标量：%s" % acceptance_error, relative(acceptance, root)))
                continue
            reference_keys = ("source_ref", "acceptance_source")
            references = [acceptance_values[key] for key in reference_keys if acceptance_values and key in acceptance_values]
            if len(references) != 1:
                errors.append(issue("ACCEPTANCE_SOURCE_UNCLEAR", "acceptance.yaml 必须唯一声明 source_ref 或 acceptance_source", relative(acceptance, root)))
                continue
            if acceptance_values is not None and set(acceptance_values) not in ({"source_ref"}, {"acceptance_source"}):
                errors.append(issue("ACCEPTANCE_EDITABLE_FIELDS", "acceptance.yaml 当前只允许保存唯一事实源引用，不得复制阈值或可编辑验收字段", relative(acceptance, root)))
            _, _, reference_error = resolve_acceptance_reference(root, references[0])
            if reference_error:
                errors.append(issue("ACCEPTANCE_SOURCE_UNCLEAR", reference_error, relative(acceptance, root)))


def validate_experiments(root: Path, errors: List[Dict[str, str]], asset_files: Sequence[Path]) -> None:
    experiments = root / "evolution" / "experiments"
    experiment_file_index = index_child_asset_files(experiments, asset_files)
    for experiment in child_directories(root, experiments, errors, "EXPERIMENT_CHILD_TYPE"):
        experiment_match = EXPERIMENT_RE.fullmatch(experiment.name)
        if not experiment_match:
            errors.append(issue("EXPERIMENT_NAME", "Experiment 必须命名为 EXP-<agent-id>-NNN", relative(experiment, root)))
        require_files(root, experiment, ("hypothesis.md", "change.yaml", "decision.md"), errors, "EXPERIMENT_STRUCTURE")
        hypothesis = experiment / "hypothesis.md"
        decision = experiment / "decision.md"
        if is_nonempty_regular_file(hypothesis, root) and substantive_markdown(root, hypothesis) is None:
            errors.append(issue("EXPERIMENT_HYPOTHESIS_INVALID", "hypothesis.md 必须包含标题以外的实质假设", relative(hypothesis, root)))
        if is_nonempty_regular_file(decision, root) and substantive_markdown(root, decision) is None:
            errors.append(issue("EXPERIMENT_DECISION_INVALID", "decision.md 必须包含标题以外的实质决定", relative(decision, root)))
        change = experiment / "change.yaml"
        change_values, change_error = parse_flat_manifest(root, change)
        if change_error:
            errors.append(issue("EXPERIMENT_CHANGE_INVALID", "change.yaml 必须使用唯一、非空的顶层标量：%s" % change_error, relative(change, root)))
        elif experiment_match and change_values is not None:
            expected_agent = experiment_match.group(1)
            if change_values.get("experiment_id") != experiment.name:
                errors.append(issue("EXPERIMENT_ID_MISMATCH", "change.yaml 的 experiment_id 必须与目录名一致", relative(change, root)))
            if change_values.get("agent_id") != expected_agent:
                errors.append(issue("EXPERIMENT_AGENT_MISMATCH", "Experiment 必须绑定名称中对应的既有 Agent", relative(change, root)))
            if change_values.get("development_path") not in {"direct", "exploration"}:
                errors.append(issue("EXPERIMENT_PATH_INVALID", "development_path 只能是 direct 或 exploration", relative(change, root)))
            owner = root / "agents" / expected_agent
            if not owner.is_dir() or owner.is_symlink():
                errors.append(issue("EXPERIMENT_AGENT_MISSING", "Experiment 名称中的 Agent 必须已存在", relative(experiment, root)))
        for required_dir in ("candidate", "evaluation"):
            target = experiment / required_dir
            experiment_files = experiment_file_index.get(experiment.name, ())
            material_files = [
                path
                for path in experiment_files
                if path.relative_to(experiment).parts[0] == required_dir
                and is_material_asset_file(root, path)
            ]
            if not target.is_dir() or target.is_symlink() or not material_files:
                errors.append(issue("EXPERIMENT_STRUCTURE", "Experiment 的 %s 必须包含真实资产" % required_dir, relative(target, root)))


def validate_versioned_assets(
    root: Path,
    errors: List[Dict[str, str]],
    asset_files: Sequence[Path],
) -> None:
    baselines = root / "evolution" / "baselines"
    baseline_file_index = index_child_asset_files(baselines, asset_files)
    baseline_names: Set[str] = set()
    baseline_details: Dict[str, Dict[str, object]] = {}
    for baseline in child_directories(root, baselines, errors, "BASELINE_CHILD_TYPE"):
        baseline_match = VERSIONED_ASSET_RE.fullmatch(baseline.name)
        if not baseline_match:
            errors.append(issue("BASELINE_NAME", "稳定 Baseline 必须命名为 <agent-id>-v<semver>", relative(baseline, root)))
        else:
            baseline_names.add(baseline.name)
            agent_dir = root / "agents" / baseline_match.group(1)
            if not agent_dir.is_dir() or agent_dir.is_symlink():
                errors.append(issue("BASELINE_AGENT_MISSING", "稳定 Baseline 缺少同名归属 Agent", relative(baseline, root)))
        require_files(
            root,
            baseline,
            ("harness.yaml", "runtime.yaml", "evaluation.json", "artifact-manifest.json"),
            errors,
            "BASELINE_STRUCTURE",
        )
        harness = baseline / "harness.yaml"
        runtime = baseline / "runtime.yaml"
        if is_nonempty_regular_file(harness, root) and structured_yaml_text(root, harness) is None:
            errors.append(issue("BASELINE_HARNESS_INVALID", "稳定 Baseline harness.yaml 必须包含可解析的实质结构", relative(harness, root)))
        runtime_values, runtime_error = parse_flat_manifest(root, runtime)
        if runtime_error or not runtime_values or not runtime_values.get("runtime_compatibility"):
            errors.append(issue("BASELINE_RUNTIME_INVALID", "runtime.yaml 必须以顶层标量声明 runtime_compatibility", relative(runtime, root)))
            runtime_compatibility = None
        else:
            runtime_compatibility = runtime_values["runtime_compatibility"]
            if is_placeholder_scalar(runtime_compatibility):
                errors.append(issue("BASELINE_RUNTIME_INVALID", "runtime_compatibility 不得使用占位值", relative(runtime, root)))

        records = artifact_records(
            root,
            baseline,
            baseline_file_index.get(baseline.name, ()),
            {"evaluation.json", "artifact-manifest.json"},
        )
        artifact_digest = validate_artifact_manifest(
            root,
            baseline,
            records,
            errors,
            "BASELINE_ARTIFACT_MANIFEST_INVALID",
        )
        evaluation = baseline / "evaluation.json"
        evaluation_value: Optional[Dict[str, object]] = None
        if is_nonempty_regular_file(evaluation, root):
            try:
                evaluation_value = load_json_object(root, evaluation)
            except (UnicodeError, ValueError, json.JSONDecodeError):
                errors.append(issue("BASELINE_EVALUATION_INVALID", "稳定 Baseline evaluation.json 必须是无重复键、无非有限数值的有效 JSON 对象", relative(evaluation, root)))
            else:
                expected_evaluation_keys = {
                    "schema_version",
                    "status",
                    "release_id",
                    "agent_id",
                    "version",
                    "baseline_id",
                    "adopted_run_id",
                    "formal_run_status",
                    "delivery_review_status",
                    "runtime_compatibility",
                    "artifact_digest",
                    "blocking_failures",
                    "safety_violations",
                }
                if set(evaluation_value) != expected_evaluation_keys:
                    errors.append(
                        issue(
                            "BASELINE_EVALUATION_SCHEMA",
                            "稳定 Baseline evaluation.json 只能使用 schema 1.0 定义的封闭字段集合",
                            relative(evaluation, root),
                        )
                    )
                if evaluation_value.get("status") != "pass" or evaluation_value.get("formal_run_status") != "pass" or evaluation_value.get("delivery_review_status") != "pass":
                    errors.append(issue("BASELINE_EVALUATION_NOT_PASSED", "稳定 Baseline 必须记录评估运行与交付复核均为 pass", relative(evaluation, root)))
                blocking_failures = evaluation_value.get("blocking_failures")
                safety_violations = evaluation_value.get("safety_violations")
                clean_counts = (
                    isinstance(blocking_failures, int)
                    and not isinstance(blocking_failures, bool)
                    and blocking_failures == 0
                    and isinstance(safety_violations, int)
                    and not isinstance(safety_violations, bool)
                    and safety_violations == 0
                )
                if not clean_counts:
                    errors.append(issue("BASELINE_EVALUATION_CONTRADICTED", "status=pass 不得同时包含阻断失败、安全违规或失败结论", relative(evaluation, root)))
                baseline_id = evaluation_value.get("baseline_id")
                adopted_run_id = evaluation_value.get("adopted_run_id")
                if not isinstance(baseline_id, str) or not BASELINE_ID_RE.fullmatch(baseline_id):
                    errors.append(issue("BASELINE_ID_INVALID", "evaluation.json 必须绑定 bl-<UUIDv4>", relative(evaluation, root)))
                if not isinstance(adopted_run_id, str) or not RUN_ID_RE.fullmatch(adopted_run_id):
                    errors.append(issue("BASELINE_RUN_ID_INVALID", "evaluation.json 必须绑定采用的 run-<UUIDv4>", relative(evaluation, root)))
                if artifact_digest is None or evaluation_value.get("artifact_digest") != artifact_digest:
                    errors.append(issue("BASELINE_DIGEST_MISMATCH", "evaluation.json 的 artifact_digest 必须匹配完整资产清单", relative(evaluation, root)))
                if evaluation_value.get("runtime_compatibility") != runtime_compatibility:
                    errors.append(issue("BASELINE_RUNTIME_MISMATCH", "evaluation.json 与 runtime.yaml 的兼容范围必须一致", relative(evaluation, root)))
                if baseline_match:
                    agent_id = baseline_match.group(1)
                    version = baseline.name[len(agent_id) + 2 :]
                    expected_identity = {
                        "schema_version": "1.0",
                        "release_id": baseline.name,
                        "agent_id": agent_id,
                        "version": version,
                    }
                    if any(evaluation_value.get(key) != value for key, value in expected_identity.items()):
                        errors.append(issue("BASELINE_IDENTITY_MISMATCH", "evaluation.json 的 Agent、Release 和版本必须与目录一致", relative(evaluation, root)))
        if baseline_match:
            baseline_details[baseline.name] = {
                "records": records,
                "artifact_digest": artifact_digest,
                "evaluation": evaluation_value,
                "runtime_compatibility": runtime_compatibility,
            }

    releases = root / "releases"
    release_file_index = index_child_asset_files(releases, asset_files)
    release_names: Set[str] = set()
    for release in child_directories(root, releases, errors, "RELEASE_CHILD_TYPE"):
        release_match = VERSIONED_ASSET_RE.fullmatch(release.name)
        if not release_match:
            errors.append(issue("RELEASE_NAME", "Release 必须命名为 <agent-id>-v<semver>", relative(release, root)))
        else:
            release_names.add(release.name)
        require_files(
            root,
            release,
            (
                "manifest.yaml",
                "harness.yaml",
                "runtime.yaml",
                "artifact-manifest.json",
                "evaluation-report.md",
                "CHANGELOG.md",
            ),
            errors,
            "RELEASE_STRUCTURE",
        )
        agent_id = release_match.group(1) if release_match else None
        release_harnesses = find_release_harnesses(root, release, agent_id)
        if not release_harnesses:
            errors.append(issue("RELEASE_HARNESS_MISSING", "Release 必须包含可明确定位的非空 Harness 主文件", relative(release, root)))
        elif len(release_harnesses) > 1:
            errors.append(issue("RELEASE_HARNESS_AMBIGUOUS", "Release 只能有一个 Harness 主文件候选", relative(release, root)))
        elif structured_yaml_text(root, release_harnesses[0]) is None:
            errors.append(issue("RELEASE_HARNESS_INVALID", "Release Harness 必须包含可解析的实质结构", relative(release_harnesses[0], root)))

        runtime = release / "runtime.yaml"
        runtime_values, runtime_error = parse_flat_manifest(root, runtime)
        if runtime_error or not runtime_values or not runtime_values.get("runtime_compatibility"):
            errors.append(issue("RELEASE_RUNTIME_INVALID", "runtime.yaml 必须以顶层标量声明 runtime_compatibility", relative(runtime, root)))
            release_runtime_compatibility = None
        else:
            release_runtime_compatibility = runtime_values["runtime_compatibility"]
            if is_placeholder_scalar(release_runtime_compatibility):
                errors.append(issue("RELEASE_RUNTIME_INVALID", "runtime_compatibility 不得使用占位值", relative(runtime, root)))

        release_records = artifact_records(
            root,
            release,
            release_file_index.get(release.name, ()),
            {"manifest.yaml", "artifact-manifest.json", "evaluation-report.md", "CHANGELOG.md"},
        )
        release_digest = validate_artifact_manifest(
            root,
            release,
            release_records,
            errors,
            "RELEASE_ARTIFACT_MANIFEST_INVALID",
        )

        manifest_path = release / "manifest.yaml"
        manifest_values, manifest_error = parse_flat_manifest(root, manifest_path)
        if manifest_error:
            errors.append(issue("RELEASE_MANIFEST_INVALID", "Release manifest.yaml 必须使用唯一、非空的顶层标量：%s" % manifest_error, relative(manifest_path, root)))
            manifest_values = None
        if agent_id:
            agent_dir = root / "agents" / agent_id
            if not agent_dir.is_dir() or agent_dir.is_symlink():
                errors.append(issue("RELEASE_AGENT_MISSING", "Release 缺少同名归属 Agent", relative(release, root)))
            if not manifest_values or manifest_values.get("agent_id") != agent_id:
                errors.append(issue("RELEASE_AGENT_ID_MISMATCH", "Release manifest.yaml 的 agent_id 与目录名不一致", relative(release / "manifest.yaml", root)))
            version = release.name[len(agent_id) + 2 :]
            expected_manifest = {
                "schema_version": "1.0",
                "release_id": release.name,
                "agent_id": agent_id,
                "version": version,
                "runtime_compatibility": release_runtime_compatibility,
                "artifact_digest": release_digest,
                "evaluation_status": "pass",
                "delivery_review_status": "pass",
            }
            required_manifest_keys = set(expected_manifest) | {"baseline_id", "adopted_run_id"}
            if (
                not manifest_values
                or set(manifest_values) != required_manifest_keys
                or any(manifest_values.get(key) != value for key, value in expected_manifest.items())
            ):
                errors.append(issue("RELEASE_MANIFEST_MISMATCH", "Release manifest 必须绑定目录身份、兼容范围、完整资产摘要及通过结论", relative(manifest_path, root)))
            baseline_id = manifest_values.get("baseline_id") if manifest_values else None
            adopted_run_id = manifest_values.get("adopted_run_id") if manifest_values else None
            if not baseline_id or not BASELINE_ID_RE.fullmatch(baseline_id):
                errors.append(issue("RELEASE_BASELINE_ID_INVALID", "Release manifest 必须绑定 bl-<UUIDv4>", relative(manifest_path, root)))
            if not adopted_run_id or not RUN_ID_RE.fullmatch(adopted_run_id):
                errors.append(issue("RELEASE_RUN_ID_INVALID", "Release manifest 必须绑定采用的 run-<UUIDv4>", relative(manifest_path, root)))

            report_path = release / "evaluation-report.md"
            report_values = report_metadata(root, report_path)
            expected_report = {
                "release_id": release.name,
                "baseline_id": baseline_id,
                "adopted_run_id": adopted_run_id,
                "formal_run_status": "pass",
                "delivery_review_status": "pass",
            }
            if (
                not report_values
                or set(report_values) != set(expected_report)
                or any(report_values.get(key) != value for key, value in expected_report.items())
            ):
                errors.append(issue("RELEASE_REPORT_MISMATCH", "评估报告 frontmatter 必须绑定同一 Release、Baseline、Run 和通过结论", relative(report_path, root)))
            elif not release_report_body_has_fixed_conclusion(root, report_path):
                errors.append(
                    issue(
                        "RELEASE_REPORT_CONTRADICTED",
                        "评估报告正文必须使用固定机器结论段，并把其余内容隔离为人工证据",
                        relative(report_path, root),
                    )
                )
            changelog_path = release / "CHANGELOG.md"
            changelog = substantive_markdown(root, changelog_path)
            if not changelog or release.name not in changelog or not markdown_has_material_list_item(changelog):
                errors.append(issue("RELEASE_CHANGELOG_INVALID", "CHANGELOG.md 必须包含当前 Release 标识和至少一项实质变更", relative(changelog_path, root)))
        baseline_dir = baselines / release.name
        if not baseline_dir.is_dir() or baseline_dir.is_symlink():
            errors.append(issue("RELEASE_BASELINE", "Release 缺少同名已验证稳定 Baseline", relative(release, root)))
            continue
        baseline_detail = baseline_details.get(release.name)
        if baseline_detail is None or baseline_detail.get("records") != release_records:
            errors.append(issue("BASELINE_RELEASE_DIVERGED", "同名稳定 Baseline 与 Release 的完整可装载资产树不一致", relative(release, root)))
        elif baseline_detail.get("artifact_digest") != release_digest:
            errors.append(issue("BASELINE_RELEASE_DIVERGED", "同名稳定 Baseline 与 Release 的完整资产摘要不一致", relative(release, root)))
        if manifest_values and baseline_detail:
            baseline_evaluation = baseline_detail.get("evaluation")
            if not isinstance(baseline_evaluation, dict) or any(
                manifest_values.get(key) != baseline_evaluation.get(key)
                for key in (
                    "release_id",
                    "agent_id",
                    "version",
                    "baseline_id",
                    "adopted_run_id",
                    "runtime_compatibility",
                    "artifact_digest",
                )
            ):
                errors.append(issue("BASELINE_RELEASE_IDENTITY_DIVERGED", "Release manifest 必须与稳定 Baseline evaluation.json 绑定同一通过组合", relative(release, root)))
    for baseline_name in sorted(baseline_names - release_names):
        errors.append(
            issue(
                "ORPHAN_STABLE_BASELINE",
                "稳定 Baseline 必须与同名 Release 一起晋升",
                relative(baselines / baseline_name, root),
            )
        )


def validate_empty_assets(root: Path, errors: List[Dict[str, str]]) -> List[Path]:
    asset_files: List[Path] = []
    visited = 0
    total_bytes = 0
    global_limit_exceeded = False
    for name in OPTIONAL_ASSET_DIRS:
        if global_limit_exceeded:
            break
        directory = root / name
        if not path_present(directory):
            continue
        if directory.is_symlink():
            errors.append(issue("ASSET_SYMLINK", "资产根目录不得是符号链接", relative(directory, root)))
            continue
        try:
            root_metadata = directory.lstat()
        except OSError:
            errors.append(issue("ASSET_ROOT_TYPE", "无法读取资产根目录类型", relative(directory, root)))
            continue
        if not stat.S_ISDIR(root_metadata.st_mode):
            errors.append(issue("ASSET_ROOT_TYPE", "存在的资产根必须是真实目录", relative(directory, root)))
            continue

        directories = [directory]
        parents: Dict[Path, Path] = {}
        has_material: Dict[Path, bool] = {directory: False}
        stack: List[Tuple[Path, int]] = [(directory, 0)]
        exceeded = False
        while stack and not exceeded:
            current, depth = stack.pop()
            with os.scandir(str(current)) as entries:
                for entry in entries:
                    visited += 1
                    path = Path(entry.path)
                    if visited > MAX_ASSET_NODES:
                        errors.append(issue("ASSET_NODE_LIMIT", "资产节点超过有界检查上限", relative(path, root)))
                        exceeded = True
                        global_limit_exceeded = True
                        break
                    metadata = entry.stat(follow_symlinks=False)
                    if stat.S_ISLNK(metadata.st_mode):
                        errors.append(issue("ASSET_SYMLINK", "资产目录不得依赖符号链接", relative(path, root)))
                    elif stat.S_ISDIR(metadata.st_mode):
                        if depth + 1 > MAX_ASSET_DEPTH:
                            errors.append(issue("ASSET_DEPTH_LIMIT", "资产目录深度超过有界检查上限", relative(path, root)))
                            continue
                        directories.append(path)
                        parents[path] = current
                        has_material[path] = False
                        stack.append((path, depth + 1))
                    elif stat.S_ISREG(metadata.st_mode):
                        asset_files.append(path)
                        if path.name in PLACEHOLDER_NAMES:
                            errors.append(issue("PLACEHOLDER_ASSET_FILE", "资产目录不得包含占位文件", relative(path, root)))
                        if metadata.st_nlink > 1:
                            errors.append(issue("ASSET_HARDLINK", "资产文件不得使用硬链接", relative(path, root)))
                        if metadata.st_size == 0:
                            errors.append(issue("EMPTY_ASSET_FILE", "资产目录不得包含零字节占位文件", relative(path, root)))
                        if metadata.st_size > MAX_ASSET_FILE_BYTES:
                            errors.append(issue("ASSET_FILE_LIMIT", "单个资产文件超过大小上限", relative(path, root)))
                        total_bytes += metadata.st_size
                        if total_bytes > MAX_ASSET_TOTAL_BYTES:
                            errors.append(issue("ASSET_TOTAL_LIMIT", "资产文件总大小超过检查上限", relative(path, root)))
                            exceeded = True
                            global_limit_exceeded = True
                            break
                        if path.suffix.lower() in TEXT_SUFFIXES and metadata.st_size > MAX_TEXT_BYTES:
                            errors.append(issue("TEXT_FILE_LIMIT", "文本资产超过大小上限", relative(path, root)))
                        elif is_material_asset_file(root, path):
                            has_material[current] = True
                    else:
                        errors.append(issue("ASSET_SPECIAL_FILE", "资产目录只能包含普通文件和真实目录", relative(path, root)))
        if exceeded:
            continue
        for candidate in sorted(directories, key=lambda value: len(value.parts), reverse=True):
            if has_material[candidate] and candidate in parents:
                has_material[parents[candidate]] = True
            if not has_material[candidate]:
                errors.append(issue("EMPTY_ASSET_DIRECTORY", "不得创建纯空占位资产目录", relative(candidate, root)))
    return sorted(asset_files)


def validate_eval_fact_sources(root: Path, errors: List[Dict[str, str]], asset_files: Sequence[Path]) -> None:
    eval_root = root / "eval"
    if not eval_root.is_dir() or eval_root.is_symlink():
        return
    for path in files_below(eval_root, asset_files):
        if is_nonempty_regular_file(path, root) and path.name in {"cases.jsonl", "results.csv"}:
            errors.append(
                issue(
                    "DUPLICATE_EVAL_FACT_SOURCE",
                    "顶层 eval/ 只能保存视图、共享评分器或派生索引，不得复制 Case/Trial 事实源",
                    relative(path, root),
                )
            )


def validate_runtime_roots(root: Path, errors: List[Dict[str, str]]) -> None:
    runtime = root / "runtime"
    if runtime.is_dir() and not runtime.is_symlink() and not is_nonempty_regular_file(runtime / "compatibility.yaml", root):
        errors.append(issue("RUNTIME_COMPATIBILITY", "runtime/ 存在时必须提供 compatibility.yaml", relative(runtime, root)))
    mcp = root / "mcp"
    if mcp.is_dir() and not mcp.is_symlink() and not is_nonempty_regular_file(mcp / "servers.yaml", root):
        errors.append(issue("MCP_SERVERS", "mcp/ 存在时必须提供 servers.yaml", relative(mcp, root)))


def validate_governance_trees(root: Path, errors: List[Dict[str, str]]) -> None:
    """检查全部治理树，而不只检查必需 leaf，拒绝隐藏的外部可变依赖。"""

    visited = 0
    total_bytes = 0
    for name in (".agents", ".codex", "docs"):
        directory = root / name
        if not path_present(directory):
            continue
        try:
            metadata = directory.lstat()
        except OSError:
            errors.append(issue("GOVERNANCE_PATH_INVALID", "无法读取治理目录", relative(directory, root)))
            continue
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            errors.append(issue("GOVERNANCE_PATH_INVALID", "治理根必须是真实目录", relative(directory, root)))
            continue
        stack: List[Tuple[Path, int]] = [(directory, 0)]
        exceeded = False
        while stack and not exceeded:
            current, depth = stack.pop()
            with os.scandir(str(current)) as entries:
                for entry in entries:
                    visited += 1
                    path = Path(entry.path)
                    if visited > MAX_ASSET_NODES:
                        errors.append(issue("GOVERNANCE_NODE_LIMIT", "治理树节点超过检查上限", relative(path, root)))
                        exceeded = True
                        break
                    item = entry.stat(follow_symlinks=False)
                    if stat.S_ISLNK(item.st_mode):
                        errors.append(issue("GOVERNANCE_SYMLINK", "治理树不得包含符号链接", relative(path, root)))
                    elif stat.S_ISDIR(item.st_mode):
                        if depth + 1 > MAX_ASSET_DEPTH:
                            errors.append(issue("GOVERNANCE_DEPTH_LIMIT", "治理树深度超过检查上限", relative(path, root)))
                        else:
                            stack.append((path, depth + 1))
                    elif stat.S_ISREG(item.st_mode):
                        if item.st_nlink > 1:
                            errors.append(issue("GOVERNANCE_HARDLINK", "治理文件不得使用硬链接", relative(path, root)))
                        if item.st_size == 0:
                            errors.append(issue("EMPTY_GOVERNANCE_FILE", "治理树不得包含零字节文件", relative(path, root)))
                        if item.st_size > MAX_ASSET_FILE_BYTES:
                            errors.append(issue("GOVERNANCE_FILE_LIMIT", "单个治理文件超过大小上限", relative(path, root)))
                        if path.suffix.lower() in TEXT_SUFFIXES and item.st_size > MAX_TEXT_BYTES:
                            errors.append(issue("GOVERNANCE_TEXT_LIMIT", "治理文本超过大小上限", relative(path, root)))
                        total_bytes += item.st_size
                        if total_bytes > MAX_ASSET_TOTAL_BYTES:
                            errors.append(issue("GOVERNANCE_TOTAL_LIMIT", "治理树文件总大小超过检查上限", relative(path, root)))
                            exceeded = True
                            break
                    else:
                        errors.append(issue("GOVERNANCE_SPECIAL_FILE", "治理树只能包含普通文件和真实目录", relative(path, root)))
        if exceeded:
            break


def run(root: Path) -> Tuple[Dict[str, object], int]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("仓库根目录不存在或不是目录")
    errors: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []

    validate_governance_trees(root, errors)

    for name in REQUIRED_ROOT_FILES:
        target = root / name
        if not path_present(target):
            errors.append(issue("ROOT_FILE_MISSING", "缺少项目治理文件", name))
        elif not is_nonempty_regular_file(target, root) or substantive_text(root, target) is None:
            errors.append(issue("ROOT_FILE_INVALID", "项目治理文件必须是非空普通文件", name))

    standards_dir = root / "docs" / "standards"
    sources_file = standards_dir / "SOURCES.md"
    try:
        sources_text = read_text_limited(root, sources_file)
    except (OSError, UnicodeError, ValueError):
        sources_text = ""
    for filename, expected in STANDARD_COPIES.items():
        path = standards_dir / filename
        if not path_present(path):
            errors.append(issue("STANDARD_COPY_MISSING", "缺少受控规范副本", relative(path, root)))
            continue
        if not is_nonempty_regular_file(path, root):
            errors.append(issue("STANDARD_COPY_INVALID", "受控规范副本必须是非空普通文件", relative(path, root)))
            continue
        actual = sha256(path)
        if actual != expected:
            errors.append(issue("STANDARD_HASH_MISMATCH", "受控规范副本 SHA-256 与锁定值不一致", relative(path, root)))
        if expected not in sources_text:
            errors.append(issue("STANDARD_HASH_UNRECORDED", "SOURCES.md 未记录受控副本的固定 SHA-256", relative(sources_file, root)))
    if sources_text and FROZEN_SPEC_COMMIT not in sources_text:
        errors.append(issue("SPEC_COMMIT_UNRECORDED", "SOURCES.md 未记录锁定的 agent-engineering-spec 提交", relative(sources_file, root)))

    for skill_name in REQUIRED_SKILLS:
        validate_skill(root, skill_name, errors)
    asset_files = validate_empty_assets(root, errors)
    resource_limit_exceeded = any(
        item["code"] in {"ASSET_NODE_LIMIT", "ASSET_TOTAL_LIMIT"}
        for item in errors
    )
    if not resource_limit_exceeded:
        release_index = index_release_names(root)
        validate_eval_fact_sources(root, errors, asset_files)
        validate_agents(root, errors, warnings, release_index, asset_files)
        validate_tasks(root, errors, warnings)
        validate_experiments(root, errors, asset_files)
        validate_versioned_assets(root, errors, asset_files)
    validate_runtime_roots(root, errors)

    result: Dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "status": "fail" if errors else "pass",
        "errors": errors,
        "warnings": warnings,
        "manual_checks": [
            "确认 Experiment 的假设、影响范围、变更分类和决策具有真实业务依据。",
            "确认稳定 Baseline 和 Release 确由对应候选基线完成正式评估与交付复核后晋升。",
            "确认 evaluation-report.md 的人工证据语义与固定机器结论一致。",
            "确认 Release 在制品库或 Git 中不可变，且生产 DSH 挂载的是具体 Release。",
            "机器校验通过不构成交付评估通过或发布授权。",
        ],
        "summary": {
            "repository": str(root),
            "required_skill_count": len(REQUIRED_SKILLS),
            "present_asset_roots": [name for name in OPTIONAL_ASSET_DIRS if (root / name).exists()],
        },
    }
    return result, 1 if errors else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo_root", nargs="?", type=Path, default=Path.cwd(), help="仓库根目录，默认当前目录")
    args = parser.parse_args(argv)
    try:
        result, code = run(args.repo_root)
    except (MemoryError, OSError, RecursionError, UnicodeError, ValueError) as exc:
        result = {
            "schema_version": SCHEMA_VERSION,
            "status": "error",
            "errors": [issue("INPUT_ERROR", "%s: %s" % (type(exc).__name__, str(exc)))],
            "warnings": [],
            "manual_checks": [],
            "summary": {},
        }
        code = 2
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
