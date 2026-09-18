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
SNAPSHOT_ID_RE = re.compile(r"^snap-" + UUID_V4_PATTERN + r"$")
ISSUE_ID_RE = re.compile(r"^iss-" + UUID_V4_PATTERN + r"$")
FREEZE_ID_RE = re.compile(r"^fr-" + UUID_V4_PATTERN + r"$")
AC_ID_RE = re.compile(r"AC-[0-9]{3,}")
REQ_ID_RE = re.compile(r"REQ-[0-9]{3,}")
MAX_ASSET_DEPTH = 256
MAX_ASSET_NODES = 100_000
MAX_ASSET_FILE_BYTES = 64 * 1024 * 1024
MAX_ASSET_TOTAL_BYTES = 1024 * 1024 * 1024
MAX_TEXT_BYTES = 4 * 1024 * 1024
MAX_YAML_NODES = 50_000
MAX_YAML_ALIASES = 1_000
DSH_JS_TAG = "tag:yaml.org,2002:js"
SECURITY_MIGRATION_EXPERIMENT = "EXP-security-operations-expert-001"
DSH_CREDENTIAL_KEYS = (
    "SEC_OPS_MCP_URL", "SEC_OPS_MCP_TOKEN",
    "INSPECTION_MCP_URL", "INSPECTION_MCP_TOKEN",
    "THREAT_ANALYSIS_MCP_URL", "THREAT_ANALYSIS_MCP_TOKEN",
)
DSH_BOOTSTRAP_DENY_TEXT = "# DSH Bootstrap environment is supplied only by the invoking container environment.\n"
DSH_BOOTSTRAP_DENY_SHA256 = "e574f8d1faf66f9167c33055ae1e2f99c70b031811f64aaac5bae1be54a19489"
# 安全关键适配层脚本与构建定义按当前审查基线锁定。合法变更必须重新审查并同步摘要；
# 文件身份通过不等于 DSH Runtime 装载、业务能力或 Release 验收通过。
DSH_ADAPTER_PINNED_SHA256 = {
    "Dockerfile": "b8b2379a7c8acaa6992db4d9a9f3cb7f2e9374606cc7a44082d405e0d9ce7105",
    "build-image.sh": "4dd075177d7dcfb1c549dee751d44ce596c727ed9078a1a86f3d7d057f6a5d28",
    "prepare-verification-home.mjs": "96e5495d29da68d1a106f9cd5462180b898edaf70456de263e3150220be620b4",
    "verify-load.mjs": "9ab59808f46155a2da3920671574c69849701ae82dd082ee28adf00d880f305a",
    "verify-load.sh": "06153ff35c8fa1a0affef59426aee9595ba4d17c2fd464159dd5a81da21f38a6",
    "tree-digest.mjs": "ae9fd84d98a3392c6989e30fbea0094c1bf7df2b0d39af2469029e44ae410545",
    "mutation-receipt.py": "4c2d6b1f0c4145adb35138a2a463a2a233817d1c880ef75845874d0b5bf26993",
    "source_contract.py": "9cb8f0e61e6e1d42ac570324a6c799ecd22718fcfdf508495660a098859f5f24",
    "preflight-access.py": "1530599124b0d43d90b38b0992c9e6ce57518e248184a33733200cd6dd9274f6",
}


class DshJsExpression(str):
    """只读 YAML 解析保留 DSH !!js 标记，绝不计算表达式。"""


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


def is_empty_regular_file(path: Path, root: Path) -> bool:
    """仅供受控全局 AGENTS.md deny-layer 使用；零字节不得泛化为资产入口。"""

    if not has_real_path_components(root, path):
        return False
    try:
        metadata = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and metadata.st_size == 0


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


def load_bounded_yaml(text: str, allow_dsh_js_scalar: bool = False) -> object:
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

    if allow_dsh_js_scalar:
        def preserve_dsh_js(loader: object, node: object) -> DshJsExpression:
            if not isinstance(node, yaml.ScalarNode):
                raise ValueError("DSH !!js 只允许标量表达式")
            return DshJsExpression(loader.construct_scalar(node))

        BoundedUniqueSafeLoader.add_constructor(DSH_JS_TAG, preserve_dsh_js)

    return yaml.load(text, Loader=BoundedUniqueSafeLoader)


def structured_yaml_text(root: Path, path: Path) -> Optional[str]:
    """安全解析复杂 YAML，并拒绝空文档、重复键和纯占位结构。"""

    text = substantive_text(root, path)
    if text is None or "\x00" in text or "\t" in text:
        return None
    try:
        dsh_profile_patch = path.name.endswith(".patch.yml") and "/candidate/dsh/managed/" in path.as_posix()
        value = load_bounded_yaml(text, allow_dsh_js_scalar=dsh_profile_patch)
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
    ".mjs",
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
        r"agents/[a-z0-9]+(?:-[a-z0-9]+)*/(?:spec/acceptance\.yaml|delivery/(?:交付记录\.md|01_智能体需求定义\.md))",
        normalized,
    ):
        return None, None, "source_ref 必须指向 Agent 的 spec/acceptance.yaml 或交付记录需求定义事实源"
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
        active_experiment = manifest_values.get("active_experiment") if manifest_values else None
        if active_experiment is not None:
            match = EXPERIMENT_RE.fullmatch(active_experiment)
            target = root / "evolution" / "experiments" / active_experiment
            if not match or match.group(1) != agent_id or not target.is_dir() or target.is_symlink():
                errors.append(issue("AGENT_ACTIVE_EXPERIMENT_INVALID", "active_experiment 必须指向本 Agent 已存在的 Experiment", relative(manifest, root)))
        validate_agent_spec(root, agent_dir, agent_id, errors)
        validate_agent_eval(root, agent_dir, errors)
        validate_agent_issues(root, agent_dir, errors)
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


def _markdown_section(text: str, phrase: str) -> str:
    """返回包含 phrase 的标题到下一同级或更高级标题之间的正文。"""
    lines = text.splitlines()
    start = None
    end = len(lines)
    level = 0
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("#"):
            continue
        hashes = len(stripped) - len(stripped.lstrip("#"))
        if start is None:
            if phrase in stripped:
                start = index
                level = hashes
        elif hashes <= level:
            end = index
            break
    if start is None:
        return ""
    return "\n".join(lines[start:end])


def delivery_requirement_ac_ids(root: Path, agent_dir: Path) -> Set[str]:
    """交付记录需求定义章节中出现的 AC 编号集合。"""
    delivery = agent_dir / "delivery"
    ids: Set[str] = set()
    for name in ("交付记录.md", "01_智能体需求定义.md"):
        path = delivery / name
        if not is_nonempty_regular_file(path, root):
            continue
        try:
            text = read_text_limited(root, path)
        except (OSError, UnicodeError, ValueError):
            continue
        ids |= set(AC_ID_RE.findall(_markdown_section(text, "智能体需求定义")))
    return ids


def validate_agent_spec(root: Path, agent_dir: Path, agent_id: str, errors: List[Dict[str, str]]) -> None:
    spec = agent_dir / "spec"
    if not path_present(spec):
        return
    if not spec.is_dir() or spec.is_symlink():
        errors.append(issue("AGENT_SPEC_INVALID", "spec 必须是真实目录", relative(spec, root)))
        return
    requirements_path = spec / "requirements.md"
    requirement_ids: Set[str] = set()
    if not is_nonempty_regular_file(requirements_path, root) or substantive_markdown(root, requirements_path) is None:
        errors.append(issue("AGENT_SPEC_INCOMPLETE", "spec 必须包含有实质内容的需求定义 requirements.md", relative(requirements_path, root)))
    else:
        try:
            requirement_ids = set(REQ_ID_RE.findall(read_text_limited(root, requirements_path)))
        except (OSError, UnicodeError, ValueError):
            requirement_ids = set()
        if not requirement_ids:
            errors.append(issue("AGENT_SPEC_INCOMPLETE", "requirements.md 必须包含至少一个 REQ-xxx", relative(requirements_path, root)))
    tasks_path = spec / "tasks.yaml"
    tasks = dsh_yaml(root, tasks_path)
    if not isinstance(tasks, dict) or tasks.get("schema_version") != "1.0" or not isinstance(tasks.get("tasks"), list) or not tasks["tasks"]:
        errors.append(issue("AGENT_SPEC_INCOMPLETE", "tasks.yaml 必须声明 schema 1.0 和非空 tasks 列表", relative(tasks_path, root)))
    else:
        seen_task_ids: Set[str] = set()
        for item in tasks["tasks"]:
            task_id = item.get("task_id") if isinstance(item, dict) else None
            if not isinstance(task_id, str) or not KEBAB_RE.fullmatch(task_id) or task_id in seen_task_ids \
                    or not isinstance(item.get("goal"), str) or not item["goal"].strip() \
                    or not isinstance(item.get("input_contract"), str) or not item["input_contract"].strip():
                errors.append(issue("AGENT_SPEC_INCOMPLETE", "tasks.yaml 的每个任务必须有唯一 kebab-case task_id、非空 goal 与 input_contract", relative(tasks_path, root)))
            else:
                seen_task_ids.add(task_id)
    acceptance_path = spec / "acceptance.yaml"
    acceptance = dsh_yaml(root, acceptance_path)
    if not isinstance(acceptance, dict) or acceptance.get("schema_version") != "1.0" or not isinstance(acceptance.get("acceptance"), list) or not acceptance["acceptance"]:
        errors.append(issue("AGENT_SPEC_INCOMPLETE", "acceptance.yaml 必须声明 schema 1.0 和非空 acceptance 列表", relative(acceptance_path, root)))
        return
    acceptance_ids: Set[str] = set()
    for item in acceptance["acceptance"]:
        if not isinstance(item, dict):
            errors.append(issue("AGENT_SPEC_INCOMPLETE", "验收项必须是 mapping", relative(acceptance_path, root)))
            continue
        ac_id = item.get("id")
        if not isinstance(ac_id, str) or not re.fullmatch(r"AC-[0-9]{3,}", ac_id) or ac_id in acceptance_ids:
            errors.append(issue("AGENT_SPEC_INCOMPLETE", "acceptance.yaml 的每个验收项必须有唯一 AC-xxx 编号", relative(acceptance_path, root)))
        else:
            acceptance_ids.add(ac_id)
        requirement_ids_field = item.get("requirement_ids")
        if not isinstance(requirement_ids_field, list) or not requirement_ids_field or any(not isinstance(value, str) or not REQ_ID_RE.fullmatch(value) for value in requirement_ids_field):
            errors.append(issue("AGENT_SPEC_INCOMPLETE", "每个验收项必须关联非空 REQ-xxx 列表", relative(acceptance_path, root)))
        elif requirement_ids and any(value not in requirement_ids for value in requirement_ids_field):
            errors.append(issue("AGENT_SPEC_UNBOUND", "验收项引用了 requirements.md 中不存在的 REQ", relative(acceptance_path, root)))
        if item.get("gate") not in {"blocking", "scored"}:
            errors.append(issue("AGENT_SPEC_INCOMPLETE", "验收项的 gate 必须是 blocking 或 scored", relative(acceptance_path, root)))
        if not isinstance(item.get("criterion"), str) or not item["criterion"].strip():
            errors.append(issue("AGENT_SPEC_INCOMPLETE", "验收项必须包含非空判定标准", relative(acceptance_path, root)))
    delivery_present = is_nonempty_regular_file(agent_dir / "delivery" / "交付记录.md", root) \
        or is_nonempty_regular_file(agent_dir / "delivery" / "01_智能体需求定义.md", root)
    if delivery_present:
        delivery_ac_ids = delivery_requirement_ac_ids(root, agent_dir)
        missing_in_delivery = sorted(acceptance_ids - delivery_ac_ids)
        extra_in_delivery = sorted(delivery_ac_ids - acceptance_ids)
        if missing_in_delivery or extra_in_delivery:
            details: List[str] = []
            if missing_in_delivery:
                details.append("交付记录缺少 " + ", ".join(missing_in_delivery))
            if extra_in_delivery:
                details.append("交付记录多出 " + ", ".join(extra_in_delivery))
            errors.append(issue("SPEC_DELIVERY_DIVERGED", "spec 是验收唯一事实源，交付记录中的 AC 必须与其逐项一致：%s" % "；".join(details), relative(agent_dir / "delivery", root)))


def validate_agent_eval(root: Path, agent_dir: Path, errors: List[Dict[str, str]]) -> None:
    delivery_eval = agent_dir / "delivery" / "eval"
    for legacy in (delivery_eval / "cases.jsonl", delivery_eval / "results.csv", delivery_eval / "results.jsonl"):
        if path_present(legacy):
            errors.append(issue("LEGACY_DELIVERY_EVAL_FACT", "Case/Trial 事实源已迁至 eval/ 与 runs/；delivery/eval 不得再保存 facts 文件", relative(legacy, root)))
    eval_dir = agent_dir / "eval"
    if not path_present(eval_dir):
        return
    if not eval_dir.is_dir() or eval_dir.is_symlink():
        errors.append(issue("AGENT_EVAL_INVALID", "eval 必须是真实目录", relative(eval_dir, root)))
        return
    cases_path = eval_dir / "cases.jsonl"
    if path_present(cases_path) and not is_nonempty_regular_file(cases_path, root):
        errors.append(issue("AGENT_EVAL_INVALID", "cases.jsonl 必须是非空普通文件", relative(cases_path, root)))
    elif is_nonempty_regular_file(cases_path, root):
        seen_case_ids: Set[str] = set()
        try:
            with cases_path.open("r", encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, start=1):
                    if not line.strip():
                        continue
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError as exc:
                        errors.append(issue("AGENT_EVAL_INVALID", "cases.jsonl 第 %d 行无法解析：%s" % (line_number, exc.msg), relative(cases_path, root)))
                        continue
                    case_id = value.get("id") if isinstance(value, dict) else None
                    if not isinstance(case_id, str) or not case_id.strip():
                        errors.append(issue("AGENT_EVAL_INVALID", "cases.jsonl 第 %d 行缺少非空 id" % line_number, relative(cases_path, root)))
                    elif case_id in seen_case_ids:
                        errors.append(issue("AGENT_EVAL_INVALID", "Case id 重复：%s" % case_id, relative(cases_path, root)))
                    else:
                        seen_case_ids.add(case_id)
        except (OSError, UnicodeError, ValueError):
            errors.append(issue("AGENT_EVAL_INVALID", "cases.jsonl 不可安全读取", relative(cases_path, root)))
    pending_dir = eval_dir / "pending"
    if path_present(pending_dir):
        if not pending_dir.is_dir() or pending_dir.is_symlink():
            errors.append(issue("AGENT_EVAL_INVALID", "pending 必须是真实目录", relative(pending_dir, root)))
        else:
            for entry in sorted(pending_dir.iterdir()):
                if entry.is_symlink() or not entry.is_file() or not entry.name.endswith(".pending.jsonl") \
                        or not KEBAB_RE.fullmatch(entry.name[: -len(".pending.jsonl")]):
                    errors.append(issue("AGENT_EVAL_INVALID", "pending 只允许 <name>.pending.jsonl 普通文件，<name> 使用小写 kebab-case", relative(entry, root)))
    methods_path = eval_dir / "methods.yaml"
    if path_present(methods_path):
        methods = dsh_yaml(root, methods_path)
        if not isinstance(methods, dict) or methods.get("schema_version") != "1.0" or not isinstance(methods.get("methods"), list) or not methods["methods"]:
            errors.append(issue("AGENT_EVAL_METHODS_INVALID", "methods.yaml 必须声明 schema 1.0 和非空 methods 列表", relative(methods_path, root)))
        else:
            for item in methods["methods"]:
                if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip() \
                        or not isinstance(item.get("acceptance_ids"), list) or not item["acceptance_ids"] \
                        or any(not isinstance(value, str) or not re.fullmatch(r"AC-[0-9]{3,}", value) for value in item["acceptance_ids"]) \
                        or not isinstance(item.get("grader"), str) or not item["grader"].strip():
                    errors.append(issue("AGENT_EVAL_METHODS_INVALID", "每个评估方法必须有唯一 id、AC 绑定和 grader 引用", relative(methods_path, root)))
                if any(key in item for key in ("threshold", "阈值")):
                    errors.append(issue("AGENT_EVAL_METHODS_INVALID", "methods.yaml 不得复制验收阈值", relative(methods_path, root)))
    plans_dir = eval_dir / "plans"
    if path_present(plans_dir):
        if not plans_dir.is_dir() or plans_dir.is_symlink():
            errors.append(issue("AGENT_EVAL_INVALID", "plans 必须是真实目录", relative(plans_dir, root)))
        else:
            for plan_path in sorted(plans_dir.glob("*.yaml")):
                plan = dsh_yaml(root, plan_path)
                if not isinstance(plan, dict) or plan.get("schema_version") != "1.0" or not plan.get("selector"):
                    errors.append(issue("AGENT_EVAL_PLAN_INVALID", "评测计划必须声明 schema 1.0 和非空 selector", relative(plan_path, root)))


def validate_agent_issues(root: Path, agent_dir: Path, errors: List[Dict[str, str]]) -> None:
    issues_dir = agent_dir / "issues"
    if not path_present(issues_dir):
        return
    if not issues_dir.is_dir() or issues_dir.is_symlink():
        errors.append(issue("AGENT_ISSUES_INVALID", "issues 必须是真实目录", relative(issues_dir, root)))
        return
    for issue_path in sorted(issues_dir.glob("*.yaml")):
        issue_id = issue_path.stem
        if not ISSUE_ID_RE.fullmatch(issue_id):
            errors.append(issue("AGENT_ISSUE_NAME", "问题必须命名为 iss-<UUIDv4>", relative(issue_path, root)))
            continue
        document = dsh_yaml(root, issue_path)
        if not isinstance(document, dict):
            errors.append(issue("AGENT_ISSUE_INVALID", "问题文件必须是可解析的 YAML mapping", relative(issue_path, root)))
            continue
        if document.get("schema_version") != "1.0" or document.get("issue_id") != issue_id or document.get("agent_id") != agent_dir.name:
            errors.append(issue("AGENT_ISSUE_IDENTITY", "问题文件必须绑定目录名与 Agent", relative(issue_path, root)))
        if document.get("status") not in {"open", "confirmed", "resolved", "wontfix"}:
            errors.append(issue("AGENT_ISSUE_INVALID", "status 必须是 open/confirmed/resolved/wontfix", relative(issue_path, root)))
        if not isinstance(document.get("title"), str) or not document["title"].strip():
            errors.append(issue("AGENT_ISSUE_INVALID", "问题必须包含非空标题", relative(issue_path, root)))
        if document.get("classification") not in {"harness-capability", "eval-data", "scoring-method", "environment-dependency", "spec-ambiguity", "unconfirmed"}:
            errors.append(issue("AGENT_ISSUE_INVALID", "问题分类必须是约定的六类之一", relative(issue_path, root)))
        evidence_refs = document.get("evidence_refs")
        if not isinstance(evidence_refs, list) or not evidence_refs:
            errors.append(issue("AGENT_ISSUE_INVALID", "问题必须关联至少一条证据引用", relative(issue_path, root)))
        else:
            for ref in evidence_refs:
                if not isinstance(ref, str) or not ref or "\\" in ref:
                    errors.append(issue("AGENT_ISSUE_INVALID", "证据引用必须是无跳转的仓库相对路径", relative(issue_path, root)))
                    continue
                parts = Path(ref).parts
                target = root.joinpath(*parts)
                if Path(ref).is_absolute() or any(part in {"", ".", ".."} for part in parts) or not is_nonempty_regular_file(target, root):
                    errors.append(issue("AGENT_ISSUE_INVALID", "证据引用必须指向仓库内存在的普通文件", relative(issue_path, root)))
        if document.get("status") == "resolved" and (not isinstance(document.get("resolved_by"), str) or not document["resolved_by"].strip()):
            errors.append(issue("AGENT_ISSUE_INVALID", "resolved 问题必须记录 resolved_by", relative(issue_path, root)))


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
        experiment_files = experiment_file_index.get(experiment.name, ())
        candidate_target = experiment / "candidate"
        candidate_material = [
            path
            for path in experiment_files
            if path.relative_to(experiment).parts[0] == "candidate"
            and is_material_asset_file(root, path)
        ]
        if not candidate_target.is_dir() or candidate_target.is_symlink() or not candidate_material:
            errors.append(issue("EXPERIMENT_STRUCTURE", "Experiment 的 candidate 必须包含真实资产", relative(candidate_target, root)))
        evidence_groups = [
            (
                experiment / name,
                [
                    path
                    for path in experiment_files
                    if path.relative_to(experiment).parts[0] == name
                    and is_material_asset_file(root, path)
                ],
            )
            for name in ("evaluation", "runs", "snapshots")
        ]
        if not any(group[0].is_dir() and not group[0].is_symlink() and group[1] for group in evidence_groups):
            errors.append(issue("EXPERIMENT_STRUCTURE", "Experiment 的 evaluation、runs 或 snapshots 至少其一必须包含真实资产", relative(experiment, root)))
        validate_experiment_runs(root, experiment, errors)
        validate_experiment_snapshots(root, experiment, errors)
        candidate_harness = dsh_yaml(root, experiment / "candidate" / "harness.yaml")
        dsh_declared = (
            isinstance(candidate_harness, dict)
            and isinstance(candidate_harness.get("agent"), dict)
            and candidate_harness["agent"].get("runtime_family") == "dsh"
        )
        if path_present(experiment / "candidate" / "dsh") or dsh_declared:
            validate_dsh_candidate(root, experiment, errors, asset_files)


RUN_RESULT_FIELDS = (
    "run_id", "trial_id", "case_id", "baseline_id", "status", "score", "safety_violation",
    "duration_ms", "input_tokens", "output_tokens", "tool_call_count", "retry_count",
    "cost_amount", "cost_currency", "resolved_model", "failure_reason", "evidence_ref",
)
RUN_RESULT_STATUSES = ("pass", "fail", "error", "skipped", "blocked")


def _read_jsonl_lines(root: Path, path: Path, errors: List[Dict[str, str]], code: str) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as exc:
                    errors.append(issue(code, "第 %d 行无法解析：%s" % (line_number, exc.msg), relative(path, root)))
                    continue
                if not isinstance(value, dict):
                    errors.append(issue(code, "第 %d 行必须是 JSON 对象" % line_number, relative(path, root)))
                    continue
                rows.append(value)
    except (OSError, UnicodeError, ValueError):
        errors.append(issue(code, "文件不可安全读取", relative(path, root)))
    return rows


def validate_experiment_runs(root: Path, experiment: Path, errors: List[Dict[str, str]]) -> None:
    runs = experiment / "runs"
    if not runs.is_dir() or runs.is_symlink():
        return
    match = EXPERIMENT_RE.fullmatch(experiment.name)
    agent_id = match.group(1) if match else None
    for run_dir in child_directories(root, runs, errors, "RUN_CHILD_TYPE"):
        if not RUN_ID_RE.fullmatch(run_dir.name):
            errors.append(issue("RUN_NAME", "Run 必须命名为 run-<UUIDv4>", relative(run_dir, root)))
            continue
        manifest_path = run_dir / "run.yaml"
        if not is_nonempty_regular_file(manifest_path, root):
            errors.append(issue("RUN_MANIFEST_MISSING", "Run 缺少非空 run.yaml", relative(manifest_path, root)))
            continue
        values, manifest_error = parse_flat_manifest(root, manifest_path)
        if manifest_error:
            errors.append(issue("RUN_MANIFEST_INVALID", "run.yaml 必须是唯一顶层标量清单：%s" % manifest_error, relative(manifest_path, root)))
            continue
        if values.get("run_id") != run_dir.name:
            errors.append(issue("RUN_ID_MISMATCH", "run_id 必须与 Run 目录名一致", relative(manifest_path, root)))
        if values.get("experiment_id") != experiment.name or (agent_id is not None and values.get("agent_id") != agent_id):
            errors.append(issue("RUN_IDENTITY_MISMATCH", "Run 必须绑定当前 Experiment 与 Agent", relative(manifest_path, root)))
        if values.get("kind") not in {"formal", "research", "technical"}:
            errors.append(issue("RUN_KIND_INVALID", "kind 只能是 formal、research 或 technical", relative(manifest_path, root)))
        if values.get("status") not in {"planned", "running", "completed", "failed", "cancelled"}:
            errors.append(issue("RUN_STATUS_INVALID", "status 必须是 planned/running/completed/failed/cancelled", relative(manifest_path, root)))
        if values.get("kind") == "formal" and not values.get("baseline_id"):
            errors.append(issue("RUN_BASELINE_MISSING", "formal Run 必须绑定 baseline_id", relative(manifest_path, root)))
        if not values.get("snapshot_ref"):
            errors.append(issue("RUN_SNAPSHOT_MISSING", "Run 必须绑定来源快照引用", relative(manifest_path, root)))
        status = values.get("status")
        results_path = run_dir / "results.jsonl"
        if status == "planned":
            if path_present(results_path):
                errors.append(issue("RUN_PLANNED_RESULTS", "planned Run 不得已有 results.jsonl", relative(results_path, root)))
            continue
        if not is_nonempty_regular_file(results_path, root):
            errors.append(issue("RUN_RESULTS_MISSING", "非 planned Run 必须包含 results.jsonl", relative(results_path, root)))
            continue
        rows = _read_jsonl_lines(root, results_path, errors, "RUN_RESULTS_INVALID")
        baseline_ids: Set[str] = set()
        trial_ids: Set[str] = set()
        status_counts = {name: 0 for name in RUN_RESULT_STATUSES}
        for row in rows:
            missing = sorted(field for field in RUN_RESULT_FIELDS if field not in row)
            if missing:
                errors.append(issue("RUN_RESULTS_INVALID", "Trial 行缺少字段：%s" % ", ".join(missing), relative(results_path, root)))
            if row.get("run_id") != run_dir.name:
                errors.append(issue("RUN_RESULTS_INVALID", "Trial 行的 run_id 必须与 Run 一致", relative(results_path, root)))
            if not isinstance(row.get("trial_id"), str) or not row["trial_id"] or row.get("trial_id") in trial_ids:
                errors.append(issue("RUN_RESULTS_INVALID", "trial_id 必须唯一且非空", relative(results_path, root)))
            else:
                trial_ids.add(row["trial_id"])
            if isinstance(row.get("baseline_id"), str) and row["baseline_id"]:
                baseline_ids.add(row["baseline_id"])
            row_status = row.get("status")
            if row_status not in RUN_RESULT_STATUSES:
                errors.append(issue("RUN_RESULTS_INVALID", "status 必须是 pass/fail/error/skipped/blocked", relative(results_path, root)))
            else:
                status_counts[row_status] += 1
            if row_status == "error" and row.get("score") not in (None, ""):
                errors.append(issue("RUN_RESULTS_INVALID", "status=error 的 Trial 不得有 score", relative(results_path, root)))
            if row_status != "pass" and not (isinstance(row.get("failure_reason"), str) and row["failure_reason"].strip()):
                errors.append(issue("RUN_RESULTS_INVALID", "status!=pass 的 Trial 必须填写 failure_reason", relative(results_path, root)))
        if len(baseline_ids) > 1:
            errors.append(issue("RUN_RESULTS_INVALID", "同一 Run 只能绑定一个 baseline_id", relative(results_path, root)))
        if status in {"completed", "failed", "cancelled"}:
            declared_results = values.get("results_sha256")
            if not isinstance(declared_results, str) or not re.fullmatch(r"[0-9a-f]{64}", declared_results) \
                    or declared_results != sha256(results_path):
                errors.append(issue("RUN_FINALIZED_IMMUTABLE", "finalized Run 的 results_sha256 必须与 results.jsonl 当前内容一致", relative(manifest_path, root)))
            declared_gaps = values.get("gaps_sha256")
            if path_present(run_dir / "gaps.jsonl"):
                if not isinstance(declared_gaps, str) or not re.fullmatch(r"[0-9a-f]{64}", declared_gaps) \
                        or declared_gaps != sha256(run_dir / "gaps.jsonl"):
                    errors.append(issue("RUN_FINALIZED_IMMUTABLE", "finalized Run 的 gaps_sha256 必须与 gaps.jsonl 当前内容一致", relative(manifest_path, root)))
            elif declared_gaps:
                errors.append(issue("RUN_FINALIZED_IMMUTABLE", "声明了 gaps_sha256 但 gaps.jsonl 缺失", relative(manifest_path, root)))
            summary_path = run_dir / "summary.json"
            if not is_nonempty_regular_file(summary_path, root):
                errors.append(issue("RUN_SUMMARY_MISSING", "finalized Run 必须包含 summary.json", relative(summary_path, root)))
            else:
                try:
                    summary = load_json_object(root, summary_path)
                except (OSError, UnicodeError, ValueError, TypeError):
                    summary = {}
                if summary.get("schema_version") != "1.0" or summary.get("trial_count") != len(rows):
                    errors.append(issue("RUN_SUMMARY_INVALID", "summary.json 的 trial_count 必须与 results.jsonl 一致", relative(summary_path, root)))
                for name in RUN_RESULT_STATUSES:
                    if summary.get(name) != status_counts[name]:
                        errors.append(issue("RUN_SUMMARY_INVALID", "summary.json 的 %s 计数必须与 results.jsonl 一致" % name, relative(summary_path, root)))
            if values.get("kind") == "formal" and not is_nonempty_regular_file(run_dir / "report.md", root):
                errors.append(issue("RUN_REPORT_MISSING", "formal Run 必须包含 report.md", relative(run_dir / "report.md", root)))
        if not is_nonempty_regular_file(run_dir / "inputs.lock.json", root):
            errors.append(issue("RUN_INPUTS_MISSING", "非 planned Run 必须包含 inputs.lock.json", relative(run_dir / "inputs.lock.json", root)))
        gaps_path = run_dir / "gaps.jsonl"
        if path_present(gaps_path) and not is_nonempty_regular_file(gaps_path, root):
            errors.append(issue("RUN_GAPS_INVALID", "gaps.jsonl 必须是非空普通文件", relative(gaps_path, root)))


def validate_experiment_snapshots(root: Path, experiment: Path, errors: List[Dict[str, str]]) -> None:
    snapshots = experiment / "snapshots"
    if not snapshots.is_dir() or snapshots.is_symlink():
        return
    research = snapshots / "research"
    if research.is_dir() and not research.is_symlink():
        for snap_dir in child_directories(root, research, errors, "SNAPSHOT_CHILD_TYPE"):
            if not SNAPSHOT_ID_RE.fullmatch(snap_dir.name):
                errors.append(issue("SNAPSHOT_NAME", "研究快照必须命名为 snap-<UUIDv4>", relative(snap_dir, root)))
                continue
            manifest_path = snap_dir / "snapshot.json"
            try:
                manifest = load_json_object(root, manifest_path)
            except (OSError, UnicodeError, ValueError, TypeError):
                errors.append(issue("SNAPSHOT_MANIFEST_INVALID", "快照必须提供可解析的 snapshot.json", relative(manifest_path, root)))
                continue
            if manifest.get("schema_version") != "1.0" or manifest.get("snapshot_id") != snap_dir.name \
                    or manifest.get("experiment_id") != experiment.name:
                errors.append(issue("SNAPSHOT_IDENTITY_MISMATCH", "snapshot.json 必须绑定目录名与当前 Experiment", relative(manifest_path, root)))
            for folder in ("harness", "spec", "eval"):
                target = snap_dir / folder
                if not target.is_dir() or target.is_symlink():
                    errors.append(issue("SNAPSHOT_CONTENT_MISSING", "完整快照缺少 %s 内容副本" % folder, relative(target, root)))
            if not is_nonempty_regular_file(snap_dir / "dependencies.lock.json", root):
                errors.append(issue("SNAPSHOT_CONTENT_MISSING", "完整快照缺少 dependencies.lock.json", relative(snap_dir / "dependencies.lock.json", root)))
    frozen = snapshots / "frozen-sources"
    if frozen.is_dir() and not frozen.is_symlink():
        for frozen_dir in child_directories(root, frozen, errors, "SNAPSHOT_CHILD_TYPE"):
            if not FREEZE_ID_RE.fullmatch(frozen_dir.name):
                errors.append(issue("SNAPSHOT_NAME", "旧三树冻结对象必须命名为 fr-<UUIDv4>", relative(frozen_dir, root)))


def dsh_yaml(root: Path, path: Path, allow_js: bool = False) -> Optional[object]:
    """仅解析仓库文件；DSH !!js 被封存为标记字符串，绝不计算。"""

    try:
        text = read_text_limited(root, path)
        if "\x00" in text or "\t" in text:
            return None
        return load_bounded_yaml(text, allow_dsh_js_scalar=allow_js)
    except Exception:  # PyYAML 的构造异常类型跨版本不同
        return None


def dsh_js_expressions(value: object) -> List[DshJsExpression]:
    found: List[DshJsExpression] = []
    stack = [value]
    seen: Set[int] = set()
    while stack:
        item = stack.pop()
        if isinstance(item, DshJsExpression):
            found.append(item)
        elif isinstance(item, (dict, list)) and id(item) not in seen:
            seen.add(id(item))
            if len(seen) > MAX_YAML_NODES:
                raise ValueError("DSH Profile YAML 容器超过检查上限")
            stack.extend(item.keys() if isinstance(item, dict) else ())
            stack.extend(item.values() if isinstance(item, dict) else item)
    return found


def dsh_path_within(candidate: Path, value: object) -> Optional[Path]:
    if not isinstance(value, str) or not value or "\\" in value:
        return None
    parts = Path(value).parts
    if Path(value).is_absolute() or any(part in {"", ".", ".."} for part in parts):
        return None
    return candidate.joinpath(*parts)


def validate_dsh_candidate(
    root: Path,
    experiment: Path,
    errors: List[Dict[str, str]],
    asset_files: Sequence[Path],
) -> None:
    """验证通用 DSH 候选结构；迁移策略只应用于其明确归属的实验。"""

    validate_dsh_candidate_structure(root, experiment, errors, asset_files)
    if experiment.name == SECURITY_MIGRATION_EXPERIMENT:
        validate_security_migration_candidate(root, experiment, errors, asset_files)


def validate_dsh_candidate_structure(root: Path, experiment: Path, errors: List[Dict[str, str]], asset_files: Sequence[Path]) -> None:
    candidate = experiment / "candidate"
    dsh = candidate / "dsh"
    match = EXPERIMENT_RE.fullmatch(experiment.name)
    if match is None:
        return
    agent_id = match.group(1)
    harness_path = candidate / "harness.yaml"
    harness = dsh_yaml(root, harness_path)
    if not isinstance(harness, dict):
        errors.append(issue("DSH_CANDIDATE_HARNESS", "DSH 候选必须提供可解析的 harness.yaml mapping", relative(harness_path, root)))
        return
    agent = harness.get("agent")
    identity = harness.get("experiment")
    if not isinstance(agent, dict) or agent.get("id") != agent_id or agent.get("runtime_family") != "dsh" or agent.get("load_mode") != "container-only":
        errors.append(issue("DSH_CANDIDATE_IDENTITY", "Harness 必须绑定当前 Agent 与容器内 DSH", relative(harness_path, root)))
    if not isinstance(identity, dict) or identity.get("id") != experiment.name:
        errors.append(issue("DSH_CANDIDATE_IDENTITY", "Harness 必须绑定当前 Experiment", relative(harness_path, root)))
    runtime_contract = harness.get("runtime_contract")
    if runtime_contract is not None and (not isinstance(runtime_contract, dict) or any(
        runtime_contract.get(key) != value for key, value in {
            "authoring_workspace_mode": "rw",
            "authoring_preset_mode": "ro",
            "authoring_managed_mode": "ro",
            "verification_candidate_mode": "ro",
            "release_mode": "ro",
        }.items()
    )):
        errors.append(issue("DSH_RUNTIME_CONTRACT", "声明 Runtime 挂载模式时须保持 Authoring/Verification/Release 读写隔离", relative(harness_path, root)))
    loadable = harness.get("loadable_assets")
    if not isinstance(loadable, dict):
        errors.append(issue("DSH_LOADABLE_ASSETS", "loadable_assets 必须声明候选内的装载路径", relative(harness_path, root)))
        return
    for key, expected in (("workspace", "dsh/workspace"), ("preset_root", "dsh/presets")):
        value = loadable.get(key)
        target = dsh_path_within(candidate, value)
        if value != expected or target is None or not target.is_dir() or target.is_symlink():
            errors.append(issue("DSH_LOADABLE_ASSETS", "%s 必须指向候选内的 DSH 装载目录" % key, relative(harness_path, root)))
    managed_root = loadable.get("managed_root")
    if managed_root is not None:
        target = dsh_path_within(candidate, managed_root)
        if managed_root != "dsh/managed" or target is None or not target.is_dir() or target.is_symlink():
            errors.append(issue("DSH_LOADABLE_ASSETS", "managed_root 必须指向候选内的受控目录", relative(harness_path, root)))
    profile_patch = loadable.get("profile_patch")
    if profile_patch is not None:
        target = dsh_path_within(candidate, profile_patch)
        if managed_root != "dsh/managed" or not isinstance(profile_patch, str) or not profile_patch.startswith("dsh/managed/") or target is None or not is_nonempty_regular_file(target, root) or not isinstance(dsh_yaml(root, target, allow_js=True), list):
            errors.append(issue("DSH_PROFILE_INVALID", "profile_patch 必须指向候选受控目录中的可解析 patch 列表", relative(harness_path, root)))
    for key in ("pending_delivery", "pending_cases"):
        if key in loadable:
            target = dsh_path_within(candidate, loadable[key])
            if target is None or not is_nonempty_regular_file(target, root):
                errors.append(issue("DSH_LOADABLE_ASSETS", "%s 必须是候选内存在的普通文件" % key, relative(harness_path, root)))
    lock_ref = loadable.get("runtime_lock")
    lock_path = dsh_path_within(candidate, lock_ref)
    if lock_ref != "runtime.lock.json" or lock_path is None or not is_nonempty_regular_file(lock_path, root):
        errors.append(issue("DSH_SOURCE_LOCK", "runtime_lock 必须指向候选内的 runtime.lock.json", relative(harness_path, root)))
    else:
        try:
            lock = load_json_object(root, lock_path)
        except (OSError, UnicodeError, ValueError, TypeError):
            lock = {}
        source_commit = lock.get("source_commit")
        image_digest = lock.get("image_digest")
        if (lock.get("agent_id") != agent_id or lock.get("experiment_id") != experiment.name
            or lock.get("runtime_family") != "dsh" or lock.get("container_only") is not True
            or not ((isinstance(source_commit, str) and re.fullmatch(r"[0-9a-f]{40}", source_commit))
                    or (isinstance(image_digest, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", image_digest)))):
            errors.append(issue("DSH_SOURCE_LOCK", "Runtime lock 必须绑定身份、容器内 DSH 和不可变来源", relative(lock_path, root)))
    preset_id = loadable.get("preset_id")
    if not isinstance(preset_id, str) or not KEBAB_RE.fullmatch(preset_id):
        errors.append(issue("DSH_PRESET_INVALID", "preset_id 必须是有效的 Preset 身份", relative(harness_path, root)))
        return
    preset_dir = dsh / "presets" / preset_id
    metadata = dsh_yaml(root, preset_dir / "preset.yml")
    plugins = dsh_yaml(root, preset_dir / "agent.cordis.yml")
    if not isinstance(metadata, dict) or not all(isinstance(metadata.get(key), str) and metadata[key].strip() for key in ("name", "description")):
        errors.append(issue("DSH_PRESET_INVALID", "Preset 元数据缺少名称或说明", relative(preset_dir / "preset.yml", root)))
    if not isinstance(plugins, list) or not plugins:
        errors.append(issue("DSH_PRESET_INVALID", "Preset 必须是非空插件列表", relative(preset_dir / "agent.cordis.yml", root)))
    else:
        ids: Set[str] = set()
        for plugin in plugins:
            if (not isinstance(plugin, dict) or not isinstance(plugin.get("id"), str) or not plugin["id"].strip()
                or not isinstance(plugin.get("name"), str) or not plugin["name"].strip()
                or not isinstance(plugin.get("disabled"), bool) or plugin["id"] in ids):
                errors.append(issue("DSH_PRESET_INVALID", "Preset 插件须有唯一 ID、名称和显式 disabled 状态", relative(preset_dir / "agent.cordis.yml", root)))
            else:
                ids.add(plugin["id"])
    if not dsh.is_dir() or dsh.is_symlink():
        errors.append(issue("DSH_ENTRYPOINT_MISSING", "缺少 DSH 候选装载目录", relative(dsh, root)))
    for path in files_below(dsh, asset_files):
        rel = path.relative_to(dsh)
        if ".claude" in rel.parts or path.name == "CLAUDE.md":
            errors.append(issue("DSH_LEGACY_ACTIVE_ASSET", "旧宿主活动配置不得进入 DSH 装载树", relative(path, root)))
        if path.name == ".env":
            try:
                dotenv_text = read_text_limited(root, path)
            except (OSError, UnicodeError, ValueError):
                dotenv_text = None
            if dotenv_text != DSH_BOOTSTRAP_DENY_TEXT:
                errors.append(issue("DSH_WORKSPACE_DOTENV", "DSH 装载树中的 .env 只能是无变量的注释挂载目标", relative(path, root)))
        if path.suffix.lower() in TEXT_SUFFIXES:
            try:
                text = read_text_limited(root, path)
            except (OSError, UnicodeError, ValueError):
                continue
            if re.search(r"\b(?:dontAsk|allowUnsandboxedCommands|permissionMode)\b", text):
                errors.append(issue("DSH_LEGACY_PERMISSION", "DSH 装载树不得继承旧宿主权限开关", relative(path, root)))


def validate_security_migration_candidate(
    root: Path,
    experiment: Path,
    errors: List[Dict[str, str]],
    asset_files: Sequence[Path],
) -> None:
    """仅检查首个安全运营旧资产迁移的受控业务组合。"""

    candidate = experiment / "candidate"
    dsh = candidate / "dsh"
    agent_id = EXPERIMENT_RE.fullmatch(experiment.name).group(1) if EXPERIMENT_RE.fullmatch(experiment.name) else None
    if agent_id != "security-operations-expert":
        return

    harness_path = candidate / "harness.yaml"
    harness = dsh_yaml(root, harness_path)
    if not isinstance(harness, dict):
        errors.append(issue("DSH_CANDIDATE_HARNESS", "候选 Harness 必须是可解析的 YAML mapping", relative(harness_path, root)))
        return
    agent = harness.get("agent")
    experiment_identity = harness.get("experiment")
    loadable = harness.get("loadable_assets")
    contract = harness.get("runtime_contract")
    promotion = harness.get("promotion")
    if not isinstance(agent, dict) or agent.get("id") != agent_id or agent.get("runtime_family") != "dsh" or agent.get("load_mode") != "container-only":
        errors.append(issue("DSH_CANDIDATE_IDENTITY", "Harness 必须绑定当前 Agent 与 DSH 容器装载", relative(harness_path, root)))
    if not isinstance(experiment_identity, dict) or experiment_identity.get("id") != experiment.name:
        errors.append(issue("DSH_CANDIDATE_IDENTITY", "Harness 必须绑定当前 Experiment", relative(harness_path, root)))
    expected_paths = {
        "workspace": "dsh/workspace",
        "preset_root": "dsh/presets",
        "managed_root": "dsh/managed",
        "profile_patch": "dsh/managed/%s.patch.yml" % agent_id,
        "runtime_lock": "runtime.lock.json",
    }
    if not isinstance(loadable, dict) or loadable.get("preset_id") != agent_id:
        errors.append(issue("DSH_LOADABLE_ASSETS", "loadable_assets 必须绑定当前 Preset", relative(harness_path, root)))
        loadable = {}
    for key, expected in expected_paths.items():
        value = loadable.get(key)
        target = dsh_path_within(candidate, value)
        if value != expected or target is None or not path_present(target):
            errors.append(issue("DSH_LOADABLE_ASSETS", "%s 必须是候选内存在的精确装载路径" % key, relative(harness_path, root)))
    if not isinstance(contract, dict) or any(
        contract.get(key) != value for key, value in {
            "workspace_container_path": "/work/harness/workspace",
            "preset_container_path": "/opt/dsh-presets",
            "managed_container_path": "/opt/dsh-managed",
            "dsh_home_container_path": "/var/lib/dsh",
            "authoring_workspace_mode": "rw",
            "authoring_preset_mode": "ro",
            "authoring_managed_mode": "ro",
            "verification_candidate_mode": "ro",
            "release_mode": "ro",
            "expose_host_port": False,
        }.items()
    ):
        errors.append(issue("DSH_RUNTIME_CONTRACT", "容器路径和 Candidate RW/RO 边界必须与固定契约一致", relative(harness_path, root)))
    if not isinstance(promotion, dict) or any(promotion.get(key) is not False for key in ("baseline_created", "release_created", "current_created")) or promotion.get("delivery_status") == "pass":
        errors.append(issue("DSH_PREMATURE_PROMOTION", "待整改迁移候选不得声明 Baseline/Release/current 或通过结论", relative(harness_path, root)))
    try:
        candidate_lock = load_json_object(root, candidate / "runtime.lock.json")
    except (OSError, UnicodeError, ValueError, TypeError):
        candidate_lock = {}
    if candidate_lock.get("agent_id") != agent_id or candidate_lock.get("experiment_id") != experiment.name or candidate_lock.get("runtime_adapter") != "runtime/adapters/dsh-container" or candidate_lock.get("profile") != "web" or candidate_lock.get("profile_patch") != expected_paths["profile_patch"]:
        errors.append(issue("DSH_SOURCE_LOCK", "Candidate Runtime lock 必须绑定当前 Agent、Experiment、web Profile 与薄适配层", relative(candidate / "runtime.lock.json", root)))

    required_entries = (
        "dsh/workspace/AGENTS.md",
        "dsh/presets/%s/preset.yml" % agent_id,
        "dsh/presets/%s/agent.cordis.yml" % agent_id,
        "dsh/managed/%s.patch.yml" % agent_id,
        "dsh/managed/security-operations-guard.mjs",
        "dsh/managed/mcp-servers.yaml",
        "dsh/managed/role-tool-matrix.yaml",
        "dsh/managed/control-boundary.yaml",
        "runtime.lock.json",
    )
    for name in required_entries:
        target = candidate / name
        if not is_nonempty_regular_file(target, root):
            errors.append(issue("DSH_ENTRYPOINT_MISSING", "缺少 DSH 容器装载必需入口", relative(target, root)))
    workspace_dotenv = dsh / "workspace" / ".env"
    try:
        dotenv_text = read_text_limited(root, workspace_dotenv)
    except (OSError, UnicodeError, ValueError):
        dotenv_text = None
    if dotenv_text != DSH_BOOTSTRAP_DENY_TEXT or (dotenv_text is not None and hashlib.sha256(dotenv_text.encode("utf-8")).hexdigest() != DSH_BOOTSTRAP_DENY_SHA256):
        errors.append(issue("DSH_WORKSPACE_DOTENV", "Candidate workspace/.env 只能是精确注释挂载目标，不得承载变量或凭据", relative(workspace_dotenv, root)))
    if not (root / "runtime" / "adapters" / "dsh-container").is_dir():
        errors.append(issue("DSH_ADAPTER_ENTRYPOINT", "DSH Candidate 必须绑定可检查的容器薄适配层", "runtime/adapters/dsh-container"))
    skills = dsh / "workspace" / ".agents" / "skills"
    skill_dirs = list(child_directories(root, skills, errors, "DSH_SKILL_DIRECTORY"))
    if not skill_dirs:
        errors.append(issue("DSH_SKILL_DISCOVERY", "DSH 工作区必须包含可直接发现的技能", relative(skills, root)))
    for skill_dir in skill_dirs:
        entry = skill_dir / "SKILL.md"
        name, description = parse_frontmatter(root, entry)
        if not KEBAB_RE.fullmatch(skill_dir.name) or name != skill_dir.name or not description:
            errors.append(issue("DSH_SKILL_DISCOVERY", "每个直接子目录的 SKILL.md name/description 必须匹配目录", relative(entry, root)))
        if not is_nonempty_regular_file(entry, root):
            errors.append(issue("DSH_SKILL_DISCOVERY", "技能入口必须为非空普通文件", relative(entry, root)))

    preset_path = dsh / "presets" / agent_id / "agent.cordis.yml"
    preset = dsh_yaml(root, preset_path)
    if not isinstance(preset, list) or not preset:
        errors.append(issue("DSH_PRESET_INVALID", "Preset 必须是可装载的插件列表", relative(preset_path, root)))
    else:
        required_preset_rows = {
            "persona": ("@deepseek-ai/dsh-persona", {"id", "name", "disabled", "config"}),
            "agent-instructions": ("@deepseek-ai/dsh-agent-instructions", {"id", "name", "disabled", "config"}),
            "security-operations-guard": ("/opt/dsh-managed/security-operations-guard.mjs", {"id", "name", "disabled"}),
        }
        if len(preset) != len(required_preset_rows) or {item.get("id") for item in preset if isinstance(item, dict) and isinstance(item.get("id"), str)} != set(required_preset_rows):
            errors.append(issue("DSH_PRESET_INVALID", "Preset 必须唯一且仅包含身份、指令与 Guard 三行", relative(preset_path, root)))
        names = [item.get("name") for item in preset if isinstance(item, dict)]
        if "@deepseek-ai/dsh-persona" not in names or "@deepseek-ai/dsh-agent-instructions" not in names or "/opt/dsh-managed/security-operations-guard.mjs" not in names:
            errors.append(issue("DSH_PRESET_INVALID", "Preset 必须包含身份、工作区指令和受控 Guard", relative(preset_path, root)))
        if any(not isinstance(item, dict) or item.get("name") not in {
            "@deepseek-ai/dsh-persona", "@deepseek-ai/dsh-agent-instructions", "/opt/dsh-managed/security-operations-guard.mjs"
        } for item in preset):
            errors.append(issue("DSH_PRESET_SCOPED_TOOLS", "Preset 不得注册可绕过全局 toolFilter 的 scoped 工具", relative(preset_path, root)))
        for item in preset:
            if not isinstance(item, dict):
                continue
            required_row = required_preset_rows.get(item.get("id")) if isinstance(item.get("id"), str) else None
            if required_row is None or item.get("name") != required_row[0] or set(item) != required_row[1] or item.get("disabled") is not False:
                errors.append(issue("DSH_PRESET_DISABLED", "Preset 三行必须精确声明且显式启用；Guard 不得被禁用或重复", relative(preset_path, root)))
            name = item.get("name")
            config = item.get("config", {})
            allowed_config_keys = {
                "@deepseek-ai/dsh-persona": {"prefix", "suffix"},
                "@deepseek-ai/dsh-agent-instructions": {"maxBytes"},
                "/opt/dsh-managed/security-operations-guard.mjs": set(),
            }
            if not isinstance(config, dict) or set(config) - allowed_config_keys.get(name, set()):
                errors.append(issue("DSH_PRESET_SCOPED_TOOLS", "Preset 配置不得扩展为工具注册、脚本或额外 Runtime 能力", relative(preset_path, root)))
    preset_metadata = dsh_yaml(root, dsh / "presets" / agent_id / "preset.yml")
    if not isinstance(preset_metadata, dict) or not preset_metadata.get("name") or not preset_metadata.get("description"):
        errors.append(issue("DSH_PRESET_INVALID", "Preset 元数据缺少名称和说明", relative(dsh / "presets" / agent_id / "preset.yml", root)))

    profile_path = dsh / "managed" / ("%s.patch.yml" % agent_id)
    profile = dsh_yaml(root, profile_path, allow_js=True)
    validate_dsh_profile(root, profile_path, profile, errors)
    validate_dsh_mcp_manifest(root, dsh / "managed" / "mcp-servers.yaml", errors)
    validate_dsh_role_matrix(root, dsh / "managed" / "role-tool-matrix.yaml", profile, errors)
    validate_dsh_public_tool_map(root, dsh / "managed" / "mcp-tool-name-map.json", dsh / "managed" / "role-tool-matrix.yaml", profile, candidate / "runtime.lock.json", dsh / "workspace" / ".agents" / "skills", errors)
    if path_present(candidate / "delivery" / "eval" / "cases.jsonl") or path_present(candidate / "delivery" / "eval" / "results.csv"):
        errors.append(issue("DSH_PENDING_IS_NOT_FORMAL_EVAL", "迁移 pending Case 不得与正式 Case/Trial 文件混用", relative(candidate / "delivery" / "eval", root)))


def validate_dsh_profile(root: Path, path: Path, profile: object, errors: List[Dict[str, str]]) -> None:
    if not isinstance(profile, list):
        errors.append(issue("DSH_PROFILE_INVALID", "DSH Profile patch 必须是 YAML patch 列表", relative(path, root)))
        return
    ordinary: Dict[str, Dict[str, object]] = {}
    inserted: Dict[str, Dict[str, object]] = {}
    for item in profile:
        if not isinstance(item, dict):
            errors.append(issue("DSH_PROFILE_INVALID", "Profile patch 行必须是 mapping", relative(path, root)))
            continue
        if "insert" in item:
            children = item.get("insert")
            if not isinstance(children, list):
                errors.append(issue("DSH_PROFILE_INVALID", "insert 必须是插件列表", relative(path, root)))
                continue
            for child in children:
                if not isinstance(child, dict) or not isinstance(child.get("id"), str) or child["id"] in inserted:
                    errors.append(issue("DSH_PROFILE_INVALID", "insert 插件必须拥有唯一 ID", relative(path, root)))
                else:
                    inserted[child["id"]] = child
        elif isinstance(item.get("id"), str) and item["id"] not in ordinary:
            ordinary[item["id"]] = item
        else:
            errors.append(issue("DSH_PROFILE_INVALID", "patch 插件必须拥有唯一 ID", relative(path, root)))
    expected_patch_ids = {
        "tool-bash", "tool-pwsh", "tool-jobs", "tool-fs", "tool-fs-search",
        "skill-filesystem", "tool-skill", "tool-web", "tool-subagent-control",
        "tool-subagent-list-agents", "tool-subagent", "tool-subagent-fork",
        "workflow-worker-thread", "tool-workflow", "tool-ralph", "agent-presets",
    }
    if set(ordinary) != expected_patch_ids:
        errors.append(issue("DSH_PROFILE_PATCH_SCOPE", "Profile patch 只能修改已审查的 DSH 核心插件集合", relative(path, root)))

    allowed_js = {"process.env.DSH_HARNESS_MODE === 'authoring'"}
    allowed_js.update("process.env.%s" % key for key in DSH_CREDENTIAL_KEYS)
    allowed_js.update("`Bearer ${process.env.%s}`" % key for key in DSH_CREDENTIAL_KEYS if key.endswith("_TOKEN"))
    expressions = dsh_js_expressions(profile)
    if len(expressions) != 7 or {str(expression).strip() for expression in expressions} != {
        "process.env.DSH_HARNESS_MODE === 'authoring'",
        "process.env.SEC_OPS_MCP_URL", "`Bearer ${process.env.SEC_OPS_MCP_TOKEN}`",
        "process.env.INSPECTION_MCP_URL", "`Bearer ${process.env.INSPECTION_MCP_TOKEN}`",
        "process.env.THREAT_ANALYSIS_MCP_URL", "`Bearer ${process.env.THREAT_ANALYSIS_MCP_TOKEN}`",
    }:
        errors.append(issue("DSH_PROFILE_JS_UNBOUNDED", "!!js 只能位于固定观察开关及三类 MCP env 配置", relative(path, root)))
    for expression in expressions:
        if str(expression).strip() not in allowed_js:
            errors.append(issue("DSH_PROFILE_JS_UNBOUNDED", "!!js 只允许固定 Runtime env 引用和 authoring 观察开关", relative(path, root)))
    watched = ordinary.get("skill-filesystem", {}).get("config")
    allowed_skill_config_keys = {
        "providerName", "includeDefaultRoots", "customSkillDirs",
        "watch", "watchFollowSymlinks",
    }
    if (
        not isinstance(watched, dict)
        or set(watched) != allowed_skill_config_keys
        or set(ordinary.get("skill-filesystem", {})) != {"id", "disabled", "config"}
        or ordinary.get("skill-filesystem", {}).get("disabled") is not False
        or watched.get("providerName") != "security-operations-workspace"
        or watched.get("includeDefaultRoots") is not False
        or watched.get("customSkillDirs") != ["/work/harness/workspace/.agents/skills"]
        or not isinstance(watched.get("watch"), DshJsExpression)
        or watched.get("watch") != "process.env.DSH_HARNESS_MODE === 'authoring'"
        or watched.get("watchFollowSymlinks") is not False
    ):
        errors.append(issue("DSH_SKILL_DISCOVERY", "Skill provider 只能发现挂载工作区的直接技能目录；禁止显式 bundled root 与符号链接跟随", relative(path, root)))
    presets = ordinary.get("agent-presets", {}).get("config")
    if not isinstance(presets, dict) or set(presets) != {"default", "roots", "includeShippedRoot", "includeUserRoot"} or presets.get("default") != "security-operations-expert" or presets.get("roots") != [{"path": "/opt/dsh-presets", "trust": "system"}] or presets.get("includeShippedRoot") is not False or presets.get("includeUserRoot") is not False:
        errors.append(issue("DSH_PRESET_ROOT", "Preset 必须仅从受控容器挂载根发现", relative(path, root)))
    if set(ordinary.get("agent-presets", {})) != {"id", "disabled", "config"} or ordinary.get("agent-presets", {}).get("disabled") is not False:
        errors.append(issue("DSH_PRESET_DISABLED", "Profile 的 agent-presets 必须显式启用，不能落入无 Guard 的 bare Agent", relative(path, root)))
    for plugin_id in ("tool-fs", "tool-fs-search", "tool-skill"):
        if ordinary.get(plugin_id, {}).get("disabled") is not False:
            errors.append(issue("DSH_ENTRYPOINT_DISABLED", "%s 必须显式启用以保持受控工作区装载" % plugin_id, relative(path, root)))
    for plugin_id in ("tool-fs", "tool-skill"):
        if set(ordinary.get(plugin_id, {})) != {"id", "disabled"}:
            errors.append(issue("DSH_ENTRYPOINT_DISABLED", "%s 不得重绑定插件或增加未审查的配置" % plugin_id, relative(path, root)))
    search_row = ordinary.get("tool-fs-search", {})
    search_config = search_row.get("config") if isinstance(search_row, dict) else None
    if set(search_row) != {"id", "disabled", "config"} or not isinstance(search_config, dict) or set(search_config) != {"sampleOverCapGlobResults"} or search_config.get("sampleOverCapGlobResults") is not False:
        errors.append(issue("DSH_ENTRYPOINT_DISABLED", "文件检索入口只能使用已审查的 DSH 配置", relative(path, root)))
    for plugin_id in (
        "tool-bash", "tool-pwsh", "tool-jobs", "tool-web", "tool-subagent",
        "tool-subagent-control", "tool-subagent-list-agents", "tool-subagent-fork",
        "workflow-worker-thread", "tool-workflow", "tool-ralph",
    ):
        if ordinary.get(plugin_id, {}).get("disabled") is not True:
            errors.append(issue("DSH_UNSCOPED_TOOL", "%s 必须在受控 Profile 中禁用" % plugin_id, relative(path, root)))

    expected_mcp = {
        "sec-ops": ("SEC_OPS_MCP_URL", "SEC_OPS_MCP_TOKEN"),
        "inspection": ("INSPECTION_MCP_URL", "INSPECTION_MCP_TOKEN"),
        "threat-analysis": ("THREAT_ANALYSIS_MCP_URL", "THREAT_ANALYSIS_MCP_TOKEN"),
    }
    mcp_plugins = [item for item in inserted.values() if item.get("name") == "@deepseek-ai/dsh-mcp-client"]
    if len(mcp_plugins) != len(expected_mcp):
        errors.append(issue("DSH_MCP_BOUNDARY", "只能注册三类已声明 MCP client", relative(path, root)))
    seen_servers: Set[str] = set()
    for item in mcp_plugins:
        config = item.get("config")
        if not isinstance(config, dict):
            errors.append(issue("DSH_MCP_BOUNDARY", "MCP client 缺少配置", relative(path, root)))
            continue
        server = config.get("serverName")
        expected = expected_mcp.get(server) if isinstance(server, str) else None
        seen_servers.add(str(server))
        headers = config.get("headers")
        reconnect = config.get("reconnect")
        url = config.get("url")
        authorization = headers.get("Authorization") if isinstance(headers, dict) else None
        allowed_config_keys = {
            "serverName", "transport", "url", "headers", "failOnStartupError", "reconnect",
        }
        if (
            not expected
            or set(item) != {"id", "name", "config"}
            or item.get("id") != "security-operations-mcp-" + server
            or set(config) != allowed_config_keys
            or config.get("transport") != "streamable-http"
            or not isinstance(url, DshJsExpression)
            or url != "process.env.%s" % expected[0]
            or not isinstance(headers, dict)
            or set(headers) != {"Authorization"}
            or not isinstance(authorization, DshJsExpression)
            or authorization != "`Bearer ${process.env.%s}`" % expected[1]
            or config.get("failOnStartupError") is not True
            or not isinstance(reconnect, dict)
            or set(reconnect) != {"enabled"}
            or reconnect.get("enabled") is not False
        ):
            errors.append(issue("DSH_MCP_BOUNDARY", "MCP client 字段与 headers 必须精确白名单；端点/凭据由 Runtime env 注入且启动失败即停止", relative(path, root)))
    if seen_servers != set(expected_mcp):
        errors.append(issue("DSH_MCP_BOUNDARY", "MCP serverName 与候选声明不一致", relative(path, root)))

    expected_delegates = {
        "delegate_inspection", "delegate_fault_analysis", "delegate_response_planning", "delegate_threat_analysis"
    }
    delegates = [item for item in inserted.values() if item.get("name") == "@deepseek-ai/dsh-tool-subagent"]
    if len(delegates) != len(expected_delegates):
        errors.append(issue("DSH_ROLE_FILTER", "必须仅注册四个受控角色委派工具", relative(path, root)))
    seen_delegates: Set[str] = set()
    for item in delegates:
        config = item.get("config")
        if not isinstance(config, dict):
            errors.append(issue("DSH_ROLE_FILTER", "角色工具缺少配置", relative(path, root)))
            continue
        if set(item) != {"id", "name", "config"}:
            errors.append(issue("DSH_ROLE_FILTER", "角色委派行不得通过 disabled、重绑定或额外字段绕过受控入口", relative(path, root)))
        allowed_delegate_config_keys = {
            "provider", "toolName", "enableRunInBackground", "backgroundMode",
            "maxDepth", "persona", "toolFilter",
        }
        if set(config) != allowed_delegate_config_keys or config.get("provider") != "spawn" or config.get("backgroundMode") != "one-shot" or not isinstance(config.get("persona"), str) or not config.get("persona", "").strip():
            errors.append(issue("DSH_ROLE_FILTER", "委派配置只能使用固定 spawn、one-shot、persona 与受控筛选，不得扩展 modelSelectionSettings/agentOptions 等选项", relative(path, root)))
        tool_name = config.get("toolName")
        seen_delegates.add(str(tool_name))
        filter_config = config.get("toolFilter")
        allow = filter_config.get("allow") if isinstance(filter_config, dict) else None
        if not isinstance(tool_name, str) or tool_name not in expected_delegates or type(config.get("maxDepth")) is not int or config.get("maxDepth") != 1 or config.get("enableRunInBackground") is not False or not isinstance(filter_config, dict) or set(filter_config) != {"allow"} or not isinstance(allow, list) or any(not isinstance(name, str) for name in allow):
            errors.append(issue("DSH_ROLE_FILTER", "角色必须深度 1、无后台任务且显式衰减工具集合", relative(path, root)))
        if isinstance(allow, list) and any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name) for name in allow):
            errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "Profile toolFilter 必须使用 DSH 可公开的至多 64 字符工具名", relative(path, root)))
        if tool_name == "delegate_response_planning" and allow != []:
            errors.append(issue("DSH_RESPONSE_NO_TOOLS", "响应规划子 Agent 的 toolFilter.allow 必须是显式空列表", relative(path, root)))
    if seen_delegates != expected_delegates:
        errors.append(issue("DSH_ROLE_FILTER", "角色委派 toolName 不完整或重复", relative(path, root)))
    permitted_insert_names = {"@deepseek-ai/dsh-mcp-client", "@deepseek-ai/dsh-tool-subagent"}
    if any(item.get("name") not in permitted_insert_names for item in inserted.values()):
        errors.append(issue("DSH_PROFILE_INSERT_UNBOUNDED", "Profile 不得插入未审查的模型工具或 Plugin", relative(path, root)))


def validate_dsh_mcp_manifest(root: Path, path: Path, errors: List[Dict[str, str]]) -> None:
    value = dsh_yaml(root, path)
    servers = value.get("servers") if isinstance(value, dict) else None
    expected = {
        "sec-ops": ("SEC_OPS_MCP_URL", "SEC_OPS_MCP_TOKEN"),
        "inspection": ("INSPECTION_MCP_URL", "INSPECTION_MCP_TOKEN"),
        "threat-analysis": ("THREAT_ANALYSIS_MCP_URL", "THREAT_ANALYSIS_MCP_TOKEN"),
    }
    if not isinstance(value, dict) or value.get("startup_policy") != "fail-closed" or not isinstance(servers, list) or len(servers) != 3:
        errors.append(issue("DSH_MCP_BOUNDARY", "MCP 声明必须仅包含三类启动失败即停止的服务", relative(path, root)))
        return
    seen: Set[str] = set()
    for server in servers:
        if not isinstance(server, dict):
            errors.append(issue("DSH_MCP_BOUNDARY", "MCP 声明项必须为 mapping", relative(path, root)))
            continue
        name = server.get("server_name")
        pair = expected.get(name) if isinstance(name, str) else None
        seen.add(str(name))
        if pair is None or server.get("transport") != "streamable-http" or server.get("url_env") != pair[0] or server.get("bearer_token_env") != pair[1] or server.get("tool_prefix") != "mcp__%s__" % name or "url" in server or "token" in server:
            errors.append(issue("DSH_MCP_BOUNDARY", "MCP 声明只能引用 Runtime 环境变量，不得内联端点/凭据", relative(path, root)))
    if seen != set(expected):
        errors.append(issue("DSH_MCP_BOUNDARY", "MCP 声明 server_name 不完整或重复", relative(path, root)))


def validate_dsh_role_matrix(root: Path, path: Path, profile: object, errors: List[Dict[str, str]]) -> None:
    matrix = dsh_yaml(root, path)
    roles = matrix.get("roles") if isinstance(matrix, dict) else None
    if not isinstance(roles, dict) or set(roles) != {"inspection", "fault-analysis", "response-planning", "threat-analysis"} or matrix.get("max_depth") != 1:
        errors.append(issue("DSH_ROLE_MATRIX", "角色矩阵必须显式冻结四个角色及深度 1", relative(path, root)))
        return
    delegates: Dict[str, object] = {}
    if isinstance(profile, list):
        for item in profile:
            if not isinstance(item, dict) or not isinstance(item.get("insert"), list):
                continue
            for plugin in item["insert"]:
                if isinstance(plugin, dict) and plugin.get("name") == "@deepseek-ai/dsh-tool-subagent":
                    config = plugin.get("config")
                    if isinstance(config, dict) and isinstance(config.get("toolName"), str):
                        delegates[config["toolName"]] = config
    for role_name, role in roles.items():
        if not isinstance(role, dict) or not isinstance(role.get("tools"), list) or not isinstance(role.get("tool_name"), str):
            errors.append(issue("DSH_ROLE_MATRIX", "角色必须绑定工具名和显式工具列表", relative(path, root)))
            continue
        names = role["tools"]
        for name in names:
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
                errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "toolFilter 必须使用 DSH 实际可公开的至多 64 字符工具名", relative(path, root)))
                break
        delegate = delegates.get(role["tool_name"])
        filter_config = delegate.get("toolFilter") if isinstance(delegate, dict) else None
        allow = filter_config.get("allow") if isinstance(filter_config, dict) else None
        if allow != names:
            errors.append(issue("DSH_ROLE_MATRIX", "角色矩阵和 Profile toolFilter.allow 必须逐项一致", relative(path, root)))
        if role_name == "response-planning" and names != []:
            errors.append(issue("DSH_RESPONSE_NO_TOOLS", "响应规划角色不得持有工具", relative(path, root)))


def validate_dsh_public_tool_map(root: Path, path: Path, matrix_path: Path, profile: object, runtime_lock_path: Path, skills_root: Path, errors: List[Dict[str, str]]) -> None:
    try:
        manifest = load_json_object(root, path)
        runtime_lock = load_json_object(root, runtime_lock_path)
    except (OSError, UnicodeError, ValueError, TypeError):
        errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "必须提供可校验的 DSH MCP 公开号映射", relative(path, root)))
        return
    mappings = manifest.get("mappings")
    if manifest.get("schema_version") != "1.0" or manifest.get("runtime_commit") != runtime_lock.get("source_commit") or not isinstance(mappings, list) or not mappings:
        errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "超长旧名必须显式映射为 DSH 公开号", relative(path, root)))
        return
    matrix = dsh_yaml(root, matrix_path)
    roles = matrix.get("roles") if isinstance(matrix, dict) else None
    matrix_names: Set[str] = set()
    if isinstance(roles, dict):
        for role in roles.values():
            if isinstance(role, dict) and isinstance(role.get("tools"), list):
                matrix_names.update(name for name in role["tools"] if isinstance(name, str))
    profile_names: Set[str] = set()
    if isinstance(profile, list):
        for item in profile:
            children = item.get("insert") if isinstance(item, dict) else None
            if isinstance(children, list):
                for plugin in children:
                    config = plugin.get("config") if isinstance(plugin, dict) else None
                    filter_config = config.get("toolFilter") if isinstance(config, dict) else None
                    allow = filter_config.get("allow") if isinstance(filter_config, dict) else None
                    if isinstance(allow, list):
                        profile_names.update(name for name in allow if isinstance(name, str))
    skill_names: Set[str] = set()
    if skills_root.is_dir() and not skills_root.is_symlink():
        for skill_file in sorted(skills_root.rglob("*.md")):
            if skill_file.is_symlink() or not skill_file.is_file():
                continue
            try:
                skill_text = read_text_limited(root, skill_file)
            except (OSError, UnicodeError, ValueError):
                continue
            skill_names.update(re.findall(r"mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_]+", skill_text))
    seen_public: Set[str] = set()
    for entry in mappings:
        if not isinstance(entry, dict):
            errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "公开号映射项必须是完整 mapping", relative(path, root)))
            continue
        server, raw, legacy, public = (entry.get(key) for key in ("server_name", "raw_name", "legacy_qualified_name", "dsh_public_name"))
        if not all(isinstance(value, str) for value in (server, raw, legacy, public)):
            errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "公开号映射项缺少字符串身份", relative(path, root)))
            continue
        qualified = "mcp__%s__%s" % (server, raw)
        digest = hashlib.sha256((server + "\x00" + raw).encode("utf-8")).hexdigest()[:12]
        expected = qualified[:51] + "_" + digest
        referenced = public in matrix_names or public in skill_names
        role_scoped = public in matrix_names
        if (legacy != qualified or len(qualified) <= 64 or public != expected or len(public) != 64
                or public in seen_public or not referenced
                or (role_scoped and public not in profile_names)
                or legacy in matrix_names or legacy in profile_names or legacy in skill_names):
            errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "超长工具名必须登记按锁定 DSH 算法生成的公开号，并在角色矩阵或技能中被引用；不得保留旧超长名", relative(path, root)))
        seen_public.add(public)
    mapped_public = {entry.get("dsh_public_name") for entry in mappings if isinstance(entry, dict)}
    matrix_all_names: Set[str] = set(matrix_names)
    direct_tools = matrix.get("parent_direct_tools") if isinstance(matrix, dict) else None
    if isinstance(direct_tools, dict):
        for key in ("allow", "deny_by_guard"):
            values = direct_tools.get(key)
            if isinstance(values, list):
                matrix_all_names.update(value for value in values if isinstance(value, str) and value.startswith("mcp__"))
    for source, names, source_path in (("技能", skill_names, skills_root), ("角色工具矩阵", matrix_all_names, matrix_path)):
        for name in sorted(value for value in names if len(value) > 64):
            if name not in mapped_public:
                errors.append(issue("DSH_MCP_PUBLIC_TOOL_NAME", "%s引用了未登记公开号的超长工具名：%s" % (source, name), relative(source_path, root)))


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
                        allowed_empty_global_agents = path == root / "runtime" / "adapters" / "dsh-container" / "verification-home-controls" / "locked-global.AGENTS.md"
                        if metadata.st_size == 0 and not allowed_empty_global_agents:
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
    adapter = runtime / "adapters" / "dsh-container"
    if adapter.is_dir() and not adapter.is_symlink():
        validate_dsh_adapter(root, adapter, errors)


def validate_dsh_adapter(root: Path, adapter: Path, errors: List[Dict[str, str]]) -> None:
    required = (
        "Dockerfile", "source.lock.json", "sources.json", "source_contract.py", "preflight-access.py", "build-image.sh", "authoring.compose.yaml",
        "verification.compose.yaml", "prepare-verification-home.mjs",
        "verify-load.mjs", "verify-load.sh", "tree-digest.mjs", "mutation-receipt.py",
        "verification-home-controls/locked-user.patch.yml",
        "verification-home-controls/web-profile.package.json",
        "verification-home-controls/locked-bootstrap.env",
        "verification-home-controls/module-deny/POLICY.md",
    )
    for name in required:
        path = adapter / name
        if not is_nonempty_regular_file(path, root):
            errors.append(issue("DSH_ADAPTER_ENTRYPOINT", "容器薄适配层缺少必需非空入口", relative(path, root)))
    for name, expected_digest in DSH_ADAPTER_PINNED_SHA256.items():
        path = adapter / name
        try:
            actual_digest = sha256(path) if is_nonempty_regular_file(path, root) else None
        except OSError:
            actual_digest = None
        if actual_digest != expected_digest:
            errors.append(issue("DSH_ADAPTER_PINNED_FILE", "安全关键适配文件身份变化；须重新审查并同步门禁摘要，静态身份不代表业务验收", relative(path, root)))
    try:
        lock = load_json_object(root, adapter / "source.lock.json")
    except (OSError, UnicodeError, ValueError, TypeError):
        errors.append(issue("DSH_SOURCE_LOCK", "Runtime source lock 必须是无重复键、可解析的 JSON 对象", relative(adapter / "source.lock.json", root)))
        return
    commit = lock.get("commit")
    tree = lock.get("tree")
    lock_sha = lock.get("pnpm_lock_sha256")
    image_tag = lock.get("local_image_tag")
    if lock.get("schema_version") != "1.0" or not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit) or not isinstance(tree, str) or not re.fullmatch(r"[0-9a-f]{40}", tree) or not isinstance(lock_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", lock_sha) or not isinstance(image_tag, str) or image_tag != "ai-agent-harness/dsh:" + commit[:9] or not isinstance(lock.get("node_base"), str) or not re.fullmatch(r"node:[^@]+@sha256:[0-9a-f]{64}", lock["node_base"]):
        errors.append(issue("DSH_SOURCE_LOCK", "源码提交、树、依赖摘要和本地镜像标识必须完整且固定", relative(adapter / "source.lock.json", root)))
        return
    source_catalog = validate_dsh_source_catalog(root, adapter, lock, errors)
    try:
        dockerfile = read_text_limited(root, adapter / "Dockerfile")
        build_script = read_text_limited(root, adapter / "build-image.sh")
        prepare_script = read_text_limited(root, adapter / "prepare-verification-home.mjs")
        probe_script = read_text_limited(root, adapter / "verify-load.mjs")
        probe_invocation = read_text_limited(root, adapter / "verify-load.sh")
    except (OSError, UnicodeError, ValueError):
        errors.append(issue("DSH_SOURCE_LOCK", "Dockerfile、构建与 HOME/Probe 脚本必须是可读取的仓库文件", relative(adapter, root)))
        return
    for expected in (
        "ARG DSH_NODE_BASE", "FROM ${DSH_NODE_BASE}", "ARG DSH_CLIENT_COMMIT_HASH",
        "ARG DSH_LOCK_SHA256", "ARG DSH_CLI_VERSION", "ARG DSH_PACKAGE_MANAGER",
        "sha256sum pnpm-lock.yaml", '"$DSH_LOCK_SHA256"',
        '"$DSH_CLI_VERSION"', 'corepack prepare "$DSH_PACKAGE_MANAGER"',
        "COPY --from=dsh_source", "pnpm install --frozen-lockfile",
        "prepare-verification-home.mjs /opt/dsh-adapter/prepare-verification-home.mjs",
    ):
        if expected not in dockerfile:
            errors.append(issue("DSH_SOURCE_LOCK", "Dockerfile 必须显式锁定官方 DSH 源码和可复现依赖", relative(adapter / "Dockerfile", root)))
            break
    docker_safety = (
        "COPY --chown=node:node verify-load.mjs /opt/dsh-adapter/verify-load.mjs",
        "COPY --chown=node:node tree-digest.mjs /opt/dsh-adapter/tree-digest.mjs",
        "COPY --chown=node:node prepare-verification-home.mjs /opt/dsh-adapter/prepare-verification-home.mjs",
        "RUN mkdir -p /var/lib/dsh/profiles/node_modules",
        "/var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules",
        "/var/lib/dsh/node_modules /work/harness/workspace",
        "&& chown -R node:node /var/lib/dsh /work/harness",
        "ENV DSH_HOME=/var/lib/dsh",
        "USER node",
        'ENTRYPOINT ["node", "/opt/dsh/apps/cli/lib/bin.js"]',
    )
    if any(marker not in dockerfile for marker in docker_safety):
        errors.append(issue("DSH_DOCKER_SAFETY", "Dockerfile 必须以 node UID 预建/chown HOME 目录并拷贝同审查基线的初始化和探针脚本", relative(adapter / "Dockerfile", root)))
    init_safety = (
        "ensureTarget(join(home, 'AGENTS.md')",
        "ensureTarget(join(home, '.env')",
        "ensureDirectory(join(home, 'node_modules'))",
        "ensureDirectory(join(home, 'profiles', 'web', 'node_modules'))",
        "validateFallback(fallbackDir, expected, true)",
        "validateFallback(fallbackDir, expected, false)",
        "healProfilesModuleFallback",
    )
    if any(marker not in prepare_script for marker in init_safety):
        errors.append(issue("DSH_HOME_INIT_CHECKS", "home-init 必须预备双 .env/全局指令/Node 目标并在官方 healer 前后核对受信 fallback", relative(adapter / "prepare-verification-home.mjs", root)))
    probe_safety = (
        "'/var/lib/dsh/AGENTS.md'",
        "'/var/lib/dsh/.env'",
        "'/work/harness/workspace/.env'",
        "'/var/lib/dsh/node_modules'",
        "'/var/lib/dsh/profiles/node_modules'",
        "'/var/lib/dsh/profiles/web/node_modules'",
        "'/var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules'",
        "validateFallback(fallbackPath, closure, false)",
        "mount.options.includes('ro')",
    )
    if any(marker not in probe_script for marker in probe_safety):
        errors.append(issue("DSH_LOAD_PROBE_CHECKS", "装载探针必须逐处核对 HOME/Workspace deny-layer、Node 解析与只读子挂载", relative(adapter / "verify-load.mjs", root)))
    invocation_safety = (
        "docker run --rm --network none --read-only --user 1000:1000",
        "run --rm --no-deps home-init",
        "--entrypoint node dsh /opt/dsh-adapter/verify-load.mjs",
        "DSH_EXPECT_PREPARE_SCRIPT_SHA",
        "DSH_EXPECT_VERIFY_SCRIPT_SHA",
        "DSH_EXPECT_TREE_SCRIPT_SHA",
        DSH_BOOTSTRAP_DENY_SHA256,
    )
    if any(marker not in probe_invocation for marker in invocation_safety):
        errors.append(issue("DSH_PROBE_INVOCATION", "宿主核验脚本必须先核镜像脚本、再运行 home-init 和受控 Probe", relative(adapter / "verify-load.sh", root)))
    for expected in (
        'source_contract.py" --source "$task_source_id"',
        'git -C "$task_source_dir" fetch --depth=1 origin "$task_source_commit"',
        '"$task_source_tree"', '"$task_lock_sha"',
        'DSH_CLIENT_COMMIT_HASH=$task_source_commit', 'DSH_LOCK_SHA256=$task_lock_sha',
        'DSH_CLI_VERSION=$task_cli_version', 'DSH_PACKAGE_MANAGER=$task_package_manager',
        'DSH_NODE_BASE=$task_node_base', "--build-context", "--load",
    ):
        if expected not in build_script:
            errors.append(issue("DSH_SOURCE_LOCK", "构建脚本必须由来源合同获取固定源码/依赖身份并核对后构建", relative(adapter / "build-image.sh", root)))
            break

    compatibility = dsh_yaml(root, root / "runtime" / "compatibility.yaml")
    if not isinstance(compatibility, dict) or compatibility.get("runtime_source_commit") != commit or compatibility.get("runtime_version") != lock.get("cli_version") or compatibility.get("profile") != "web" or compatibility.get("agent_mount_scope") != "container-only":
        errors.append(issue("DSH_RUNTIME_COMPATIBILITY", "runtime/compatibility.yaml 必须与锁定的容器 DSH 身份一致", "runtime/compatibility.yaml"))
    validate_dsh_verification_home_controls(root, adapter, errors)
    if source_catalog is not None:
        for source in source_catalog.values():
            for mode in ("authoring", "verification"):
                validate_dsh_compose(root, adapter, mode, image_tag, source, errors)


def validate_dsh_source_catalog(root: Path, adapter: Path, lock: Mapping[str, object], errors: List[Dict[str, str]]) -> Optional[Dict[str, object]]:
    path = adapter / "sources.json"
    try:
        catalog = load_json_object(root, path)
    except (OSError, UnicodeError, ValueError, TypeError):
        errors.append(issue("DSH_SOURCE_CATALOG", "来源目录必须是无重复键 JSON 对象", relative(path, root)))
        return None
    sources = catalog.get("sources")
    if catalog.get("schema_version") != "1.0" or not isinstance(sources, dict) or not sources:
        errors.append(issue("DSH_SOURCE_CATALOG", "来源目录必须声明 schema 1.0 和非空 sources", relative(path, root)))
        return None
    required = {"agent_id", "candidate_root", "profile", "patch", "preset", "guard", "config_markers", "required_env_names"}
    for source_id, item in sources.items():
        match = EXPERIMENT_RE.fullmatch(source_id) if isinstance(source_id, str) else None
        expected_root = "evolution/experiments/%s/candidate/dsh" % source_id
        if not match or not isinstance(item, dict) or set(item) != required or item.get("agent_id") != match.group(1) or item.get("candidate_root") != expected_root or item.get("profile") != "web":
            errors.append(issue("DSH_SOURCE_CATALOG", "来源身份、候选根、web Profile 或字段不符合合同", relative(path, root)))
            continue
        candidate_dsh = root / expected_root
        for key, folder in (("patch", "managed"), ("preset", "presets"), ("guard", "managed")):
            part = item[key]
            if key == "guard" and part is None:
                continue
            target = dsh_path_within(candidate_dsh / folder, part)
            if target is None or not is_nonempty_regular_file(target, root):
                errors.append(issue("DSH_SOURCE_CATALOG", "%s 必须指向所选候选内存在的受控文件" % key, relative(path, root)))
        for key in ("config_markers", "required_env_names"):
            values = item[key]
            if not isinstance(values, list) or (key == "config_markers" and not values) or any(not isinstance(value, str) or not value for value in values) or len(values) != len(set(values)):
                errors.append(issue("DSH_SOURCE_CATALOG", "%s 必须为合法无重复字符串列表" % key, relative(path, root)))
            elif key == "required_env_names" and any(not re.fullmatch(r"[A-Z][A-Z0-9_]*", value) for value in values):
                errors.append(issue("DSH_SOURCE_CATALOG", "环境变量只能以名称引用，不能内联值", relative(path, root)))
        try:
            candidate_lock = load_json_object(root, candidate_dsh.parent / "runtime.lock.json")
        except (OSError, UnicodeError, ValueError, TypeError):
            candidate_lock = {}
        paired = {
            "repository": "official_source", "commit": "source_commit", "tree": "source_tree",
            "cli_package": "cli_package", "cli_version": "cli_version",
            "package_manager": "package_manager", "pnpm_lock_sha256": "pnpm_lock_sha256",
            "platform": "platform",
        }
        if (candidate_lock.get("schema_version") != "1.0" or candidate_lock.get("agent_id") != item["agent_id"]
            or candidate_lock.get("experiment_id") != source_id or candidate_lock.get("runtime_family") != "dsh"
            or candidate_lock.get("container_only") is not True
            or any(lock.get(key) != candidate_lock.get(other) for key, other in paired.items())
            or lock.get("node_base") != "node:24-bookworm-slim@" + str(candidate_lock.get("node_base_oci_index_digest"))
            or candidate_lock.get("profile") != item["profile"]
            or candidate_lock.get("profile_patch") != "dsh/managed/" + str(item["patch"])):
            errors.append(issue("DSH_SOURCE_LOCK", "来源目录、Adapter 锁与 Candidate 锁须绑定同一 DSH 组合", relative(candidate_dsh.parent / "runtime.lock.json", root)))
    return dict(sources)


def validate_dsh_verification_home_controls(root: Path, adapter: Path, errors: List[Dict[str, str]]) -> None:
    patch_path = adapter / "verification-home-controls" / "locked-user.patch.yml"
    manifest_path = adapter / "verification-home-controls" / "web-profile.package.json"
    agents_path = adapter / "verification-home-controls" / "locked-global.AGENTS.md"
    bootstrap_path = adapter / "verification-home-controls" / "locked-bootstrap.env"
    module_deny = adapter / "verification-home-controls" / "module-deny"
    expected_patch = (
        "# Verification deny-layer：固定两处 DSH_HOME 用户 Patch 为无额外条目。\n"
        "# 保留官方 base + web-app 与显式受控 --patch，不接受 home/profile 私有 Plugin 注入。\n"
        "[]\n"
    )
    try:
        patch_text = read_text_limited(root, patch_path)
    except (OSError, UnicodeError, ValueError):
        patch_text = None
    if patch_text != expected_patch:
        errors.append(issue("DSH_VERIFICATION_HOME_PATCH", "核验态 home/profile 用户 patch 必须精确为受控 [] deny-layer", relative(patch_path, root)))
    expected_manifest = {
        "name": "dsh-profile-web",
        "private": True,
        "dependencies": {},
        "dsh": {
            "profile": {
                "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
                "patchReload": "startup",
            },
        },
    }
    try:
        manifest = load_json_object(root, manifest_path)
    except (OSError, UnicodeError, ValueError, TypeError):
        manifest = None
    if not strict_json_equal(manifest, expected_manifest):
        errors.append(issue("DSH_VERIFICATION_HOME_MANIFEST", "核验态 web Profile 必须仅由官方 base+web-app、空 dependencies 与 startup patch 组成", relative(manifest_path, root)))
    if not is_empty_regular_file(agents_path, root):
        errors.append(issue("DSH_GLOBAL_AGENTS_DENY", "全局 AGENTS.md 必须是唯一允许的零字节受控 deny-layer", relative(agents_path, root)))
    try:
        bootstrap_text = read_text_limited(root, bootstrap_path)
    except (OSError, UnicodeError, ValueError):
        bootstrap_text = None
    if bootstrap_text != DSH_BOOTSTRAP_DENY_TEXT or (bootstrap_text is not None and hashlib.sha256(bootstrap_text.encode("utf-8")).hexdigest() != DSH_BOOTSTRAP_DENY_SHA256):
        errors.append(issue("DSH_BOOTSTRAP_ENV_DENY", "受控 .env 必须仅是精确注释，不得承载任意变量", relative(bootstrap_path, root)))
    expected_policy = (
        "# DSH_HOME module deny-layer\n\n"
        "此目录只作为容器内精确只读覆盖层，不存放 Node 包、Plugin 或可执行代码。不得把 DSH_HOME 中的可写数据用作 Runtime 依赖解析来源。\n"
    )
    try:
        policy_text = read_text_limited(root, module_deny / "POLICY.md")
        children = {child.name for child in module_deny.iterdir()}
        module_directory_ok = has_real_path_components(root, module_deny) and stat.S_ISDIR(module_deny.lstat().st_mode)
    except (OSError, UnicodeError, ValueError):
        policy_text = None
        children = set()
        module_directory_ok = False
    if not module_directory_ok or children != {"POLICY.md"} or policy_text != expected_policy:
        errors.append(issue("DSH_MODULE_DENY_CONTENT", "受控 Node deny-layer 目录只能包含固定 POLICY.md，禁止包/Plugin/可执行代码", relative(module_deny, root)))


def validate_dsh_compose(root: Path, adapter: Path, mode: str, image_tag: str,
                         source: Mapping[str, object], errors: List[Dict[str, str]]) -> None:
    path = adapter / (mode + ".compose.yaml")
    if (not isinstance(source.get("patch"), str)
        or not isinstance(source.get("candidate_root"), str)
        or source.get("profile") != "web"
        or not isinstance(source.get("required_env_names"), list)
        or any(not isinstance(name, str) for name in source["required_env_names"])):
        errors.append(issue("DSH_SOURCE_CATALOG", "默认来源缺少可用于 Compose 的受控装载字段", relative(path, root)))
        return
    doc = dsh_yaml(root, path)
    if not isinstance(doc, dict):
        errors.append(issue("DSH_COMPOSE_INVALID", "Compose 必须是可安全解析的 YAML mapping", relative(path, root)))
        return
    services = doc.get("services")
    service = services.get("dsh") if isinstance(services, dict) else None
    expected_services = {"home-init", "dsh"}
    if not isinstance(services, dict) or set(services) != expected_services or not isinstance(service, dict):
        errors.append(issue("DSH_COMPOSE_INVALID", "Compose 只能定义阶段需要的受控 dsh/home-init 服务", relative(path, root)))
        return
    image_expression = "${DSH_IMAGE_TAG:-" + image_tag + "}"
    patch_expression = "${DSH_MANAGED_PATCH:-/opt/dsh-managed/" + str(source["patch"]) + "}"
    validate_dsh_home_init(root, adapter, mode, services.get("home-init"), image_expression, errors)
    if service.get("depends_on") != {"home-init": {"condition": "service_completed_successfully"}}:
        code = "DSH_AUTHORING_HOME_INIT" if mode == "authoring" else "DSH_VERIFICATION_HOME_INIT"
        errors.append(issue(code, "DSH 必须等待阶段独立的受控 home-init 成功完成", relative(path, root)))
    expected_service_keys = {
        "image", "pull_policy", "init", "depends_on", "user", "working_dir",
        "read_only", "cap_drop", "security_opt", "pids_limit", "stop_grace_period",
        "tmpfs", "environment", "entrypoint", "command", "volumes",
    }
    dangerous = {"ports", "expose", "devices", "privileged", "network_mode", "pid", "ipc", "userns_mode", "docker_socket", "build", "env_file", "extends"}
    if set(service) != expected_service_keys or any(key in service for key in dangerous) or service.get("read_only") is not True or service.get("cap_drop") != ["ALL"] or service.get("security_opt") != ["no-new-privileges:true"] or service.get("pull_policy") != "never" or service.get("image") != image_expression or service.get("working_dir") != "/work/harness/workspace" or service.get("user") != "1000:1000" or service.get("init") is not True or type(service.get("pids_limit")) is not int or service.get("pids_limit") != 256 or service.get("tmpfs") != ["/tmp:rw,nosuid,nodev,size=64m,mode=1777"]:
        errors.append(issue("DSH_COMPOSE_ISOLATION", "容器必须无宿主端口/socket/特权，根文件系统只读并锁定本地镜像", relative(path, root)))
    expected_entrypoint = ["node", "--expose-internals", "/opt/dsh/apps/cli/lib/bin.js"]
    if service.get("entrypoint") != expected_entrypoint:
        errors.append(issue("DSH_COMPOSE_ENTRYPOINT", "两种模式的主 DSH 只能以审查过的 node --expose-internals CLI 向量启动，不得省略或增加 Node flag", relative(path, root)))
    if service.get("command") != ["--profile", source["profile"], "--patch", patch_expression, "--no-open"]:
        errors.append(issue("DSH_COMPOSE_LOAD", "Compose 必须从受控 web Profile patch 装载 Candidate", relative(path, root)))
    environment = service.get("environment")
    if isinstance(environment, list) and any(isinstance(value, str) and value.split("=", 1)[0] == "NODE_OPTIONS" for value in environment):
        errors.append(issue("DSH_COMPOSE_NODE_OPTIONS", "不得通过 NODE_OPTIONS 注入未审查的 Node flag", relative(path, root)))
    required_env = {
        "DSH_HOME=/var/lib/dsh",
        "DSH_HARNESS_MODE=" + mode,
        "DSH_PERMISSION_MODE=" + ("workspace-write" if mode == "authoring" else "read-only"),
        "DSH_TELEMETRY_DISABLED=1",
        *source["required_env_names"],
    }
    if not isinstance(environment, list) or any(not isinstance(value, str) for value in environment) or len(environment) != len(required_env) or set(environment) != required_env:
        errors.append(issue("DSH_COMPOSE_ENV", "DSH_HOME、模式、MCP 凭据和模型密钥只能由白名单 Runtime 环境注入，不得内联值", relative(path, root)))

    volumes = service.get("volumes")
    expected_sources = {
        "/work/harness/workspace": "workspace",
        "/opt/dsh-presets": "presets",
        "/opt/dsh-managed": "managed",
    }
    candidate_dsh = root / str(source["candidate_root"])
    controlled_targets = {
        "/var/lib/dsh/cordis.patch.yml": "./verification-home-controls/locked-user.patch.yml",
        "/var/lib/dsh/profiles/web/cordis.patch.yml": "./verification-home-controls/locked-user.patch.yml",
        "/var/lib/dsh/profiles/web/package.json": "./verification-home-controls/web-profile.package.json",
        "/var/lib/dsh/AGENTS.md": "./verification-home-controls/locked-global.AGENTS.md",
        "/var/lib/dsh/.env": "./verification-home-controls/locked-bootstrap.env",
        "/work/harness/workspace/.env": "./verification-home-controls/locked-bootstrap.env",
    }
    module_deny_targets = {
        "/var/lib/dsh/node_modules",
        "/var/lib/dsh/profiles/web/node_modules",
        "/var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules",
    }
    seen_targets: Set[str] = set()
    expected_count = 14
    if not isinstance(volumes, list) or len(volumes) != expected_count:
        errors.append(issue("DSH_COMPOSE_MOUNTS", "Compose 必须精确挂载 Candidate、独立数据卷和受控 HOME/Bootstrap/Module deny-layer", relative(path, root)))
        return
    for volume in volumes:
        if not isinstance(volume, dict) or not isinstance(volume.get("target"), str):
            errors.append(issue("DSH_COMPOSE_MOUNTS", "挂载条目必须为完整 mapping", relative(path, root)))
            continue
        target = volume["target"]
        if target in seen_targets:
            errors.append(issue("DSH_COMPOSE_MOUNTS", "挂载目标不得重复", relative(path, root)))
        seen_targets.add(target)
        if target == "/var/lib/dsh":
            if not strict_json_equal(volume, {"type": "volume", "source": "dsh-" + mode + "-home", "target": "/var/lib/dsh"}):
                errors.append(issue("DSH_COMPOSE_MOUNTS", "DSH_HOME 必须是独立命名卷而非候选资产", relative(path, root)))
            continue
        if target == "/var/lib/dsh/profiles/node_modules":
            expected_fallback = {"type": "volume", "source": "dsh-" + mode + "-trusted-fallback", "target": target, "read_only": True}
            if not strict_json_equal(volume, expected_fallback):
                errors.append(issue("DSH_MODULE_SHADOW_MOUNT", "受信安装 fallback 必须使用阶段独立命名卷，主 DSH 精确只读挂载", relative(path, root)))
            continue
        if target in module_deny_targets:
            expected_deny = {"type": "bind", "source": "./verification-home-controls/module-deny", "target": target, "read_only": True}
            if not strict_json_equal(volume, expected_deny):
                errors.append(issue("DSH_MODULE_SHADOW_MOUNT", "三处可写 HOME Node 解析目录必须由受控无包目录精确只读覆盖", relative(path, root)))
            continue
        if target in controlled_targets:
            expected_source = controlled_targets[target]
            source_ok = (is_empty_regular_file(adapter / expected_source, root) if target == "/var/lib/dsh/AGENTS.md" else is_nonempty_regular_file(adapter / expected_source, root))
            if not strict_json_equal(volume, {"type": "bind", "source": expected_source, "target": target, "read_only": True}) or not source_ok:
                code = "DSH_AUTHORING_HOME_MOUNT" if mode == "authoring" else "DSH_VERIFICATION_HOME_MOUNT"
                errors.append(issue(code, "受控用户 Patch、manifest、全局指令和双 .env 必须精确来源且只读挂载", relative(path, root)))
            continue
        component = expected_sources.get(target)
        volume_source = volume.get("source")
        default_source = os.path.relpath(candidate_dsh / component, adapter) if component else None
        variable = {"workspace": "DSH_WORKSPACE_HOST", "presets": "DSH_PRESETS_HOST", "managed": "DSH_MANAGED_HOST"}.get(component)
        expected_source = "${" + variable + ":-" + default_source + "}" if variable else None
        if component is None or volume.get("type") != "bind" or volume_source != expected_source or volume.get("read_only") is not (mode == "verification" or component != "workspace"):
            errors.append(issue("DSH_COMPOSE_MOUNTS", "只允许精确 Candidate 工作区/预设/受控配置挂载及对应 RW/RO", relative(path, root)))
    expected_targets = set(expected_sources) | {"/var/lib/dsh", "/var/lib/dsh/profiles/node_modules"} | module_deny_targets | set(controlled_targets)
    if seen_targets != expected_targets:
        errors.append(issue("DSH_COMPOSE_MOUNTS", "挂载目标必须精确覆盖三类资产、独立 HOME、受信 fallback 与受控遮蔽文件/目录", relative(path, root)))
    declared_volumes = doc.get("volumes")
    if not isinstance(declared_volumes, dict) or set(declared_volumes) != {"dsh-" + mode + "-home", "dsh-" + mode + "-trusted-fallback"} or any(value is not None for value in declared_volumes.values()):
        errors.append(issue("DSH_COMPOSE_MOUNTS", "Compose 顶层只能声明模式独立的 HOME 与受信 fallback 卷", relative(path, root)))


def validate_dsh_home_init(root: Path, adapter: Path, mode: str, init: object, image_tag: str, errors: List[Dict[str, str]]) -> None:
    compose_path = adapter / (mode + ".compose.yaml")
    code = "DSH_AUTHORING_HOME_INIT" if mode == "authoring" else "DSH_VERIFICATION_HOME_INIT"
    required_keys = {
        "image", "pull_policy", "user", "network_mode", "read_only", "cap_drop",
        "security_opt", "environment", "entrypoint", "volumes",
    }
    if not isinstance(init, dict) or set(init) != required_keys or init.get("image") != image_tag or init.get("pull_policy") != "never" or init.get("user") != "1000:1000" or init.get("network_mode") != "none" or init.get("read_only") is not True or init.get("cap_drop") != ["ALL"] or init.get("security_opt") != ["no-new-privileges:true"] or init.get("environment") != ["DSH_HOME=/var/lib/dsh", "DSH_HARNESS_MODE=" + mode] or init.get("entrypoint") != ["node", "/opt/dsh-adapter/prepare-verification-home.mjs"]:
        errors.append(issue(code, "home-init 必须为无网络、无特权、非 root 的受控一次性准备服务", relative(compose_path, root)))
        return
    volumes = init.get("volumes")
    if not isinstance(volumes, list) or len(volumes) != 3:
        errors.append(issue(code, "home-init 只能读取受控文件目录并写阶段独立 HOME/fallback 卷", relative(compose_path, root)))
        return
    expected = {
        "/opt/dsh-verification-controls": {"type": "bind", "source": "./verification-home-controls", "target": "/opt/dsh-verification-controls", "read_only": True},
        "/var/lib/dsh": {"type": "volume", "source": "dsh-" + mode + "-home", "target": "/var/lib/dsh"},
        "/var/lib/dsh/profiles/node_modules": {"type": "volume", "source": "dsh-" + mode + "-trusted-fallback", "target": "/var/lib/dsh/profiles/node_modules"},
    }
    found: Set[str] = set()
    for volume in volumes:
        if not isinstance(volume, dict) or not isinstance(volume.get("target"), str):
            errors.append(issue(code, "home-init 挂载条目必须为完整 mapping", relative(compose_path, root)))
            continue
        target = volume["target"]
        found.add(target)
        if target not in expected or not strict_json_equal(volume, expected[target]):
            errors.append(issue(code, "home-init 挂载必须精确隔离受控目录和 DSH_HOME", relative(compose_path, root)))
    if found != set(expected):
        errors.append(issue(code, "home-init 缺少受控文件或阶段独立 HOME/fallback 挂载", relative(compose_path, root)))


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
