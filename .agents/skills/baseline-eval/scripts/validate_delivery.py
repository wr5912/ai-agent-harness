#!/usr/bin/env python3
"""校验 Agent 项目的六项交付内容、Case、Trial、范围证据与标识关联。"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import uuid
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import DefaultDict, Dict, List, Optional, Set, Tuple


SCHEMA_VERSION = "1.0"
DELIVERY_MARKDOWN_CONTRACT_VERSION = "1.0"
SPLIT_DELIVERY_FILES = (
    "01_智能体需求定义.md",
    "02_用户场景与输入覆盖矩阵.md",
    "03_任务与评估数据集说明.md",
    "04_安全与控制边界清单.md",
    "05_候选基线.md",
    "06_自测与交付评估报告.md",
)
DELIVERY_SECTION_HEADINGS = (
    "智能体需求定义",
    "用户场景与输入覆盖矩阵",
    "任务与评估数据集说明",
    "安全与控制边界清单",
    "候选基线",
    "自测与交付评估报告",
)
CASE_FIELDS = {
    "id",
    "requirement_ids",
    "acceptance_id",
    "scenario_id",
    "intent_id",
    "tags",
    "source_type",
    "variant_types",
    "input",
    "context",
    "expected_behavior",
    "check",
    "required_trials",
    "gate",
}
TAG_VALUES = {"core", "boundary", "safety", "regression"}
SOURCE_VALUES = {"real", "real_redacted", "near_real", "synthetic_reviewed"}
VARIANT_VALUES = {
    "standard",
    "colloquial",
    "elliptical",
    "multi_intent",
    "incorrect_or_noisy",
    "missing_info",
    "high_risk",
}
GATE_VALUES = {"blocking", "scored"}
CONTROL_VALUES = {"allow", "block", "require_approval"}
RESULT_HEADER = [
    "run_id",
    "trial_id",
    "case_id",
    "baseline_id",
    "status",
    "score",
    "safety_violation",
    "duration_ms",
    "input_tokens",
    "output_tokens",
    "tool_call_count",
    "retry_count",
    "cost_amount",
    "cost_currency",
    "resolved_model",
    "failure_reason",
    "evidence_ref",
]
REQ_RE = re.compile(r"^REQ-[0-9]{3,}$")
AC_RE = re.compile(r"^AC-[0-9]{3,}$")
REQ_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_-])REQ-[0-9]{3,}(?![A-Za-z0-9_-])")
CASE_TOKEN_RE = re.compile(r"(?<![A-Za-z0-9_.:-])case-[A-Za-z0-9_-]+(?![A-Za-z0-9_.:-])")
RUN_RE = re.compile(r"run-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
BASELINE_RE = re.compile(r"bl-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")


def issue(code: str, message: str, path: Optional[str] = None) -> Dict[str, str]:
    value = {"code": code, "message": message}
    if path:
        value["path"] = path
    return value


def rel(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def is_nonempty_string(value: object) -> bool:
    return isinstance(value, str) and bool(value.strip())


def is_string_list(value: object, require_nonempty: bool = True) -> bool:
    return isinstance(value, list) and (bool(value) or not require_nonempty) and all(is_nonempty_string(item) for item in value)


def find_line(text: str, needle: str) -> Optional[str]:
    for line in text.splitlines():
        stripped = line.lstrip()
        if not stripped.startswith("-"):
            continue
        field = stripped[1:].lstrip().lstrip("*`")
        if field.startswith(needle):
            return line.strip()
    return None


def value_after(line: Optional[str], needle: str) -> str:
    if line is None:
        return ""
    start = line.find(needle)
    if start < 0:
        return ""
    remainder = line[start + len(needle) :]
    candidates = [index for index in (remainder.find("："), remainder.find(":")) if index >= 0]
    if not candidates:
        return ""
    return remainder[min(candidates) + 1 :].strip()


def meaningful(value: str) -> bool:
    normalized = value.strip().strip("`*_ ")
    if not normalized:
        return False
    if re.match(r"^N/A(?:\b|（|\()", normalized, flags=re.IGNORECASE):
        return False
    placeholders = {
        "是 / 否",
        "无 / 有",
        "一般门槛 / 影响范围明确的有限交付",
        "确定性新建或变更 / 既有智能体的局部维护变更",
        "仓库内 / 受控系统及权限说明",
    }
    return normalized not in placeholders and normalized not in {"待填写", "TODO", "TBD"}


def has_yes(line: Optional[str]) -> bool:
    if line is None:
        return False
    return bool(re.search(r"(?:^|[：:；;,，])\s*是(?:\s|[，,；;。]|$)", line)) and "是 / 否" not in line


def section_for_heading(text: str, phrase: str) -> str:
    lines = text.splitlines()
    start = None
    level = None
    for index, line in enumerate(lines):
        match = re.match(r"^(#{1,6})\s+.*%s" % re.escape(phrase), line.strip())
        if match:
            start = index
            level = len(match.group(1))
            break
    if start is None or level is None:
        return ""
    end = len(lines)
    for index in range(start + 1, len(lines)):
        match = re.match(r"^(#{1,6})\s+", lines[index].strip())
        if match and len(match.group(1)) <= level:
            end = index
            break
    return "\n".join(lines[start:end])


def acceptance_requirement_map(text: str) -> Dict[str, Set[str]]:
    linked: Dict[str, Set[str]] = {}
    for row in semantic_table_rows(text, {"验收编号", "关联需求"}):
        acceptance_id = row["验收编号"]
        if AC_RE.fullmatch(acceptance_id):
            linked[acceptance_id] = set(REQ_TOKEN_RE.findall(row["关联需求"]))
    return linked


def validate_uuid(value: str, prefix: str) -> bool:
    pattern = RUN_RE if prefix == "run-" else BASELINE_RE
    if not pattern.fullmatch(value):
        return False
    try:
        parsed = uuid.UUID(value[len(prefix) :])
    except ValueError:
        return False
    return parsed.version == 4 and parsed.variant == uuid.RFC_4122


def load_delivery_docs(
    project: Path,
    errors: List[Dict[str, str]],
    warnings: List[Dict[str, str]],
) -> Tuple[str, Dict[str, str], str]:
    delivery = project / "delivery"
    if not delivery.is_dir():
        errors.append(issue("DELIVERY_DIRECTORY_MISSING", "缺少 delivery/ 目录", rel(delivery, project)))
        return "", {}, "missing"
    combined = delivery / "交付记录.md"
    split_present = [name for name in SPLIT_DELIVERY_FILES if (delivery / name).is_file()]
    docs: Dict[str, str] = {}
    shape = "missing"
    if combined.is_file() and split_present:
        errors.append(issue("DELIVERY_SHAPE_CONFLICT", "合并版与拆分版六件套不得同时存在", rel(delivery, project)))
        shape = "conflict"
        docs[combined.name] = combined.read_text(encoding="utf-8")
        for name in split_present:
            docs[name] = (delivery / name).read_text(encoding="utf-8")
    elif combined.is_file():
        shape = "combined"
        docs[combined.name] = combined.read_text(encoding="utf-8")
    elif len(split_present) == len(SPLIT_DELIVERY_FILES):
        shape = "split"
        for name in SPLIT_DELIVERY_FILES:
            docs[name] = (delivery / name).read_text(encoding="utf-8")
    else:
        errors.append(issue("DELIVERY_SHAPE_INCOMPLETE", "必须提供交付记录合并版或完整六文件拆分版", rel(delivery, project)))
        for name in SPLIT_DELIVERY_FILES:
            if name not in split_present:
                errors.append(issue("DELIVERY_FILE_MISSING", "拆分版缺少必需文件", "delivery/" + name))
        for name in split_present:
            docs[name] = (delivery / name).read_text(encoding="utf-8")

    for markdown in delivery.glob("*.md"):
        lowered = markdown.name.lower()
        if any(marker in lowered for marker in ("latest", "final-final", "最终版", "副本", "copy")):
            errors.append(issue("DUPLICATE_DELIVERY_COPY", "禁止维护 latest/final-final 等重复交付副本", rel(markdown, project)))
    if docs and any(not text.strip() for text in docs.values()):
        errors.append(issue("EMPTY_DELIVERY_DOCUMENT", "交付文档不得为空", rel(delivery, project)))
    if shape == "combined":
        combined_text = docs.get(combined.name, "")
        for heading in DELIVERY_SECTION_HEADINGS:
            if not section_for_heading(combined_text, heading):
                errors.append(issue("DELIVERY_SECTION_MISSING", "合并交付记录缺少章节：%s" % heading, rel(combined, project)))
    elif shape == "split":
        for filename, heading in zip(SPLIT_DELIVERY_FILES, DELIVERY_SECTION_HEADINGS):
            if not section_for_heading(docs.get(filename, ""), heading):
                errors.append(issue("DELIVERY_SECTION_MISSING", "拆分交付文件缺少对应章节：%s" % heading, "delivery/" + filename))
    all_text = "\n\n".join(docs.values())
    if "```markdown" in all_text and "# 模板一" in all_text:
        warnings.append(issue("TEMPLATE_CONTENT_DETECTED", "交付内容疑似仍是未填写模板，需逐项核验", rel(delivery, project)))
    return all_text, docs, shape


def load_cases(
    path: Path,
    project: Path,
    acceptance_source_text: str,
    errors: List[Dict[str, str]],
) -> Dict[str, Dict[str, object]]:
    cases: Dict[str, Dict[str, object]] = {}
    if not path.is_file():
        errors.append(issue("CASES_MISSING", "缺少可访问的 delivery/eval/cases.jsonl", rel(path, project)))
        return cases
    documented_requirements = set(re.findall(r"REQ-[0-9]{3,}", acceptance_source_text))
    documented_acceptance = set(re.findall(r"AC-[0-9]{3,}", acceptance_source_text))
    acceptance_requirements = acceptance_requirement_map(acceptance_source_text)
    hard_gate_acceptance = {
        row["验收编号"]
        for row in semantic_table_rows(acceptance_source_text, {"验收编号", "判定作用"})
        if AC_RE.fullmatch(row["验收编号"]) and row["判定作用"].strip("`*_ ") == "硬门禁"
    }

    with path.open("r", encoding="utf-8") as handle:
        for line_number, raw in enumerate(handle, start=1):
            if not raw.strip():
                continue
            location = "%s:%d" % (rel(path, project), line_number)
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as exc:
                errors.append(issue("CASE_JSON", "JSONL 行无法解析：%s" % exc.msg, location))
                continue
            if not isinstance(value, dict):
                errors.append(issue("CASE_OBJECT", "每个 JSONL 行必须是对象", location))
                continue
            missing = sorted(CASE_FIELDS - set(value))
            if missing:
                errors.append(issue("CASE_FIELDS", "缺少字段：%s" % ", ".join(missing), location))
            case_id = value.get("id")
            if not is_nonempty_string(case_id):
                errors.append(issue("CASE_ID", "id 必须是非空字符串", location))
                continue
            case_id = str(case_id).strip()
            if case_id in cases:
                errors.append(issue("CASE_ID_DUPLICATE", "Case id 重复：%s" % case_id, location))
                continue
            cases[case_id] = value

            requirement_ids = value.get("requirement_ids")
            if not is_string_list(requirement_ids):
                errors.append(issue("CASE_REQUIREMENTS", "requirement_ids 必须是非空字符串数组", location))
            else:
                for requirement_id in requirement_ids:
                    if not REQ_RE.fullmatch(requirement_id):
                        errors.append(issue("REQUIREMENT_ID_FORMAT", "需求编号格式无效：%s" % requirement_id, location))
                    elif requirement_id not in documented_requirements:
                        errors.append(issue("REQUIREMENT_UNBOUND", "需求编号未出现在交付记录中：%s" % requirement_id, location))
            acceptance_id = value.get("acceptance_id")
            acceptance_text = str(acceptance_id).strip() if is_nonempty_string(acceptance_id) else ""
            if not acceptance_text or not AC_RE.fullmatch(acceptance_text):
                errors.append(issue("ACCEPTANCE_ID_FORMAT", "acceptance_id 必须为 AC-xxx", location))
            elif acceptance_text not in documented_acceptance:
                errors.append(issue("ACCEPTANCE_UNBOUND", "acceptance_id 未出现在交付记录中", location))
            if is_string_list(requirement_ids) and acceptance_text in acceptance_requirements:
                unrelated = sorted(set(requirement_ids) - acceptance_requirements[acceptance_text])
                if unrelated:
                    errors.append(
                        issue(
                            "CASE_REQUIREMENT_ACCEPTANCE_MISMATCH",
                            "%s 未在模板一中与 %s 关联" % (", ".join(unrelated), acceptance_text),
                            location,
                        )
                    )
            for field in ("scenario_id", "intent_id", "input"):
                if not is_nonempty_string(value.get(field)):
                    errors.append(issue("CASE_TEXT_FIELD", "%s 必须是非空字符串" % field, location))
            if not isinstance(value.get("context"), dict):
                errors.append(issue("CASE_CONTEXT", "context 必须是对象", location))
            for field in ("expected_behavior", "check"):
                if not is_string_list(value.get(field)):
                    errors.append(issue("CASE_CHECK", "%s 必须是非空字符串数组" % field, location))
            tags = value.get("tags")
            if not is_string_list(tags) or not set(tags).issubset(TAG_VALUES):
                errors.append(issue("CASE_TAGS", "tags 必须是允许枚举的非空数组", location))
            source_type = value.get("source_type")
            if not isinstance(source_type, str) or source_type not in SOURCE_VALUES:
                errors.append(issue("CASE_SOURCE", "source_type 不在允许枚举中", location))
            variants = value.get("variant_types")
            if not is_string_list(variants) or not set(variants).issubset(VARIANT_VALUES):
                errors.append(issue("CASE_VARIANTS", "variant_types 必须是允许枚举的非空数组", location))
            trials = value.get("required_trials")
            if isinstance(trials, bool) or not isinstance(trials, int) or trials < 1:
                errors.append(issue("CASE_REQUIRED_TRIALS", "required_trials 必须是大于等于 1 的整数", location))
            gate = value.get("gate")
            if not isinstance(gate, str) or gate not in GATE_VALUES:
                errors.append(issue("CASE_GATE", "gate 必须为 blocking 或 scored", location))
            elif gate == "blocking" and acceptance_text not in hard_gate_acceptance:
                errors.append(issue("BLOCKING_AC_NOT_HARD_GATE", "blocking Case 必须关联模板一硬门禁 AC", location))
            expected_control = value.get("expected_control")
            if isinstance(tags, list) and "safety" in tags and (
                not isinstance(expected_control, str) or expected_control not in CONTROL_VALUES
            ):
                errors.append(issue("SAFETY_CONTROL", "safety Case 必须填写允许的 expected_control", location))
            if isinstance(tags, list) and "safety" in tags and gate != "blocking":
                errors.append(issue("SAFETY_GATE", "safety Case 必须使用 blocking 门禁", location))
    if not cases:
        errors.append(issue("CASES_EMPTY", "cases.jsonl 没有可用 Case", rel(path, project)))
    return cases


def markdown_tables(text: str) -> List[List[List[str]]]:
    tables: List[List[List[str]]] = []
    current: List[List[str]] = []
    for line in text.splitlines() + [""]:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            current.append([cell.strip() for cell in stripped.strip("|").split("|")])
        elif current:
            tables.append(current)
            current = []
    return tables


def semantic_table_rows(
    text: str,
    required_headers: Set[str],
    errors: Optional[List[Dict[str, str]]] = None,
    error_code: str = "AC_TABLE_ROW_INVALID",
    location: str = "delivery",
) -> List[Dict[str, str]]:
    """交付 Markdown v1.0：以唯一列名定位事实，允许列顺序和强调样式变化。"""

    rows: List[Dict[str, str]] = []
    for table in markdown_tables(text):
        if len(table) < 2:
            continue
        headers = [cell.strip().strip("`*_ ") for cell in table[0]]
        if not required_headers.issubset(headers) or len(headers) != len(set(headers)):
            continue
        for cells in table[2:]:
            if len(cells) == len(headers):
                rows.append(dict(zip(headers, cells)))
            elif errors is not None:
                errors.append(issue(error_code, "验收表格行列数与表头不一致", location))
    return rows


def mentioned_case_ids(text: str, case_ids: Set[str]) -> Set[str]:
    mentioned: Set[str] = set()
    for case_id in case_ids:
        start = 0
        while True:
            index = text.find(case_id, start)
            if index < 0:
                break
            before = text[index - 1] if index > 0 else ""
            after_index = index + len(case_id)
            after = text[after_index] if after_index < len(text) else ""
            before_ok = not before or not (before.isalnum() or before in "_.:-")
            after_ok = not after or not (after.isalnum() or after in "_.:-")
            if before_ok and after_ok:
                mentioned.add(case_id)
                break
            start = index + 1
    return mentioned


def validate_case_matrix(
    docs: Dict[str, str],
    shape: str,
    cases: Dict[str, Dict[str, object]],
    errors: List[Dict[str, str]],
) -> None:
    if shape == "split":
        matrix_text = docs.get(SPLIT_DELIVERY_FILES[1], "")
    else:
        matrix_text = section_for_heading(docs.get("交付记录.md", ""), "用户场景与输入覆盖矩阵")
    case_ids = set(cases)
    links: Set[Tuple[str, str, str]] = set()
    found_matrix = False
    for table in markdown_tables(matrix_text):
        if len(table) < 2:
            continue
        header = [cell.replace("`", "").strip() for cell in table[0]]
        try:
            requirement_index = next(index for index, cell in enumerate(header) if "需求" in cell and "ID" in cell.upper())
            scenario_index = next(index for index, cell in enumerate(header) if "场景" in cell and "ID" in cell.upper())
            intent_index = next(index for index, cell in enumerate(header) if "意图" in cell and "ID" in cell.upper())
        except StopIteration:
            continue
        variant_columns: Dict[int, str] = {}
        for index, cell in enumerate(header):
            for variant in VARIANT_VALUES:
                if re.search(r"(?:^|[^a-z0-9_])%s(?:$|[^a-z0-9_])" % re.escape(variant), cell.lower()):
                    variant_columns[index] = variant
        if not variant_columns:
            continue
        found_matrix = True
        for row_number, cells in enumerate(table[2:], start=3):
            if len(cells) < len(header):
                errors.append(issue("MATRIX_ROW_SHAPE", "模板二矩阵行列数不足", "delivery:matrix:%d" % row_number))
                continue
            requirement_ids = set(REQ_TOKEN_RE.findall(cells[requirement_index]))
            scenario_id = cells[scenario_index].strip("`*_ ")
            intent_id = cells[intent_index].strip("`*_ ")
            if not requirement_ids or not scenario_id or not intent_id:
                errors.append(issue("MATRIX_ROW_IDENTITY", "模板二矩阵行缺少需求、场景或意图标识", "delivery:matrix:%d" % row_number))
                continue
            for column_index, variant in variant_columns.items():
                cell = cells[column_index].strip()
                if not cell or re.match(r"^N/A(?:\b|（|\()", cell, flags=re.IGNORECASE):
                    continue
                unknown_references = sorted(set(CASE_TOKEN_RE.findall(cell)) - case_ids)
                if unknown_references:
                    errors.append(
                        issue(
                            "MATRIX_CASE_UNKNOWN",
                            "模板二矩阵单元格引用未知 Case：%s" % ", ".join(unknown_references[:10]),
                            "delivery:matrix:%d:%s" % (row_number, variant),
                        )
                    )
                referenced = mentioned_case_ids(cell, case_ids)
                if not referenced:
                    errors.append(
                        issue(
                            "MATRIX_CASE_REFERENCE",
                            "模板二矩阵单元格没有引用 cases.jsonl 中的 Case",
                            "delivery:matrix:%d:%s" % (row_number, variant),
                        )
                    )
                    continue
                for case_id in sorted(referenced):
                    case = cases[case_id]
                    if str(case.get("scenario_id", "")).strip() != scenario_id or str(case.get("intent_id", "")).strip() != intent_id:
                        errors.append(
                            issue(
                                "MATRIX_SCENARIO_INTENT_MISMATCH",
                                "%s 的 scenario_id/intent_id 与模板二矩阵行不一致" % case_id,
                                "delivery:matrix:%d" % row_number,
                            )
                        )
                    case_requirements = case.get("requirement_ids")
                    if isinstance(case_requirements, list) and not set(case_requirements).issuperset(requirement_ids):
                        errors.append(
                            issue(
                                "MATRIX_REQUIREMENT_MISMATCH",
                                "%s 未关联模板二矩阵行中的全部需求" % case_id,
                                "delivery:matrix:%d" % row_number,
                            )
                        )
                    variants = case.get("variant_types")
                    if isinstance(variants, list) and variant not in variants:
                        errors.append(
                            issue(
                                "MATRIX_VARIANT_MISMATCH",
                                "%s 未声明矩阵列变体 %s" % (case_id, variant),
                                "delivery:matrix:%d" % row_number,
                            )
                        )
                    for requirement_id in requirement_ids:
                        links.add((case_id, requirement_id, variant))
    if not found_matrix:
        errors.append(issue("MATRIX_TABLE_MISSING", "模板二缺少可解析的需求/场景/意图/输入变体矩阵", "delivery"))
        return
    for case_id, case in sorted(cases.items()):
        requirement_ids = case.get("requirement_ids")
        variants = case.get("variant_types")
        if not isinstance(requirement_ids, list) or not isinstance(variants, list):
            continue
        for requirement_id in requirement_ids:
            for variant in variants:
                if (case_id, requirement_id, variant) not in links:
                    errors.append(
                        issue(
                            "CASE_MATRIX_UNBOUND",
                            "%s 的 %s + %s 未被模板二对应矩阵格引用" % (case_id, requirement_id, variant),
                            "delivery/eval/cases.jsonl",
                        )
                    )


def validate_acceptance_mapping(
    docs: Dict[str, str],
    shape: str,
    cases: Dict[str, Dict[str, object]],
    project: Path,
    errors: List[Dict[str, str]],
    warnings: List[Dict[str, str]],
) -> Tuple[Set[str], Dict[str, str]]:
    combined = docs.get("交付记录.md", "")
    if shape == "split":
        template_one = docs.get(SPLIT_DELIVERY_FILES[0], "")
        template_three = docs.get(SPLIT_DELIVERY_FILES[2], "")
    else:
        template_one = section_for_heading(combined, "智能体需求定义")
        template_three = section_for_heading(combined, "交付验收标准的评估实现")
    if not template_three:
        template_three = section_for_heading("\n".join(docs.values()), "交付验收标准的评估实现")
    source_location = "delivery/" + (SPLIT_DELIVERY_FILES[0] if shape == "split" else "交付记录.md")
    implementation_location = "delivery/" + (SPLIT_DELIVERY_FILES[2] if shape == "split" else "交付记录.md")
    implementation_rows = semantic_table_rows(
        template_three, {"验收编号", "评估用例编号或筛选条件"}, errors, "AC_IMPLEMENTATION_ROW_INVALID", implementation_location
    )
    mapping_ids = [row["验收编号"] for row in implementation_rows if AC_RE.fullmatch(row["验收编号"])]
    mapping_counts = Counter(mapping_ids)
    mapping_rows: DefaultDict[str, List[Dict[str, str]]] = defaultdict(list)
    mapping_selectors: Dict[str, str] = {}
    for row in implementation_rows:
        if AC_RE.fullmatch(row["验收编号"]):
            mapping_rows[row["验收编号"]].append(row)
    case_acceptance = {str(case.get("acceptance_id", "")) for case in cases.values()}
    if not mapping_ids:
        errors.append(issue("AC_IMPLEMENTATION_MISSING", "未找到模板三的 AC-xxx 评估实现表", "delivery"))
    for acceptance_id in sorted(case_acceptance):
        if mapping_counts[acceptance_id] != 1:
            errors.append(
                issue(
                    "AC_IMPLEMENTATION_CARDINALITY",
                    "%s 必须且只能有一行评估实现，当前为 %d" % (acceptance_id, mapping_counts[acceptance_id]),
                    "delivery",
                )
            )
        elif not any(meaningful(row["评估用例编号或筛选条件"]) and row["评估用例编号或筛选条件"] != "相关用例" for row in mapping_rows[acceptance_id]):
            errors.append(
                issue(
                    "AC_IMPLEMENTATION_EMPTY",
                    "%s 的评估实现行仍为空或为不可执行占位内容" % acceptance_id,
                    "delivery",
                )
            )
        else:
            mapping_selectors[acceptance_id] = mapping_rows[acceptance_id][0]["评估用例编号或筛选条件"].strip()
    source_ids: Set[str] = set()
    if template_one:
        source_rows = semantic_table_rows(template_one, {"验收编号", "判定作用", "关联需求"}, errors, "AC_SOURCE_ROW_INVALID", source_location)
        source_id_list = [row["验收编号"] for row in source_rows if AC_RE.fullmatch(row["验收编号"])]
        source_ids = set(source_id_list)
        if not source_ids:
            errors.append(issue("AC_SOURCE_MISSING", "模板一未定义任何 AC-xxx 验收项", "delivery"))
        for acceptance_id, count in sorted(Counter(source_id_list).items()):
            if count != 1:
                errors.append(
                    issue(
                        "AC_SOURCE_DUPLICATE",
                        "模板一验收项必须唯一：%s 出现 %d 次" % (acceptance_id, count),
                        "delivery",
                    )
                )
        for acceptance_id in sorted(source_ids):
            if mapping_counts[acceptance_id] != 1:
                errors.append(issue("AC_SOURCE_UNMAPPED", "模板一验收项未唯一映射：%s" % acceptance_id, "delivery"))
            if acceptance_id not in case_acceptance:
                errors.append(issue("AC_WITHOUT_CASE", "模板一验收项未命中任何冻结 Case：%s" % acceptance_id, "delivery"))
        for acceptance_id in sorted(set(mapping_ids) - source_ids):
            errors.append(issue("AC_IMPLEMENTATION_WITHOUT_SOURCE", "模板三出现模板一未定义的验收项：%s" % acceptance_id, "delivery"))
    else:
        warnings.append(issue("AC_SOURCE_SECTION_UNCLEAR", "无法可靠分离模板一；需人工核对 AC 唯一事实源", "delivery"))
    return source_ids, mapping_selectors


def evaluate_case_selector(
    acceptance_id: str,
    selector: str,
    cases: Dict[str, Dict[str, object]],
    errors: List[Dict[str, str]],
) -> Optional[Set[str]]:
    json_list = re.fullmatch(r"\s*case_ids\s*=\s*(\[.*\])\s*", selector)
    if json_list:
        try:
            values = json.loads(json_list.group(1))
        except json.JSONDecodeError:
            errors.append(issue("AC_SELECTOR_JSON", "%s 的 case_ids 不是有效 JSON 数组" % acceptance_id, "delivery"))
            return None
        if not isinstance(values, list) or not values or not all(is_nonempty_string(value) for value in values):
            errors.append(issue("AC_SELECTOR_JSON", "%s 的 case_ids 必须是非空字符串数组" % acceptance_id, "delivery"))
            return None
        selected = {str(value).strip() for value in values}
        if len(selected) != len(values):
            errors.append(issue("AC_SELECTOR_DUPLICATE", "%s 的 case_ids 包含重复项" % acceptance_id, "delivery"))
        unknown = sorted(selected - set(cases))
        if unknown:
            errors.append(
                issue(
                    "AC_SELECTOR_CASE_UNKNOWN",
                    "%s 的筛选器引用未知 Case：%s" % (acceptance_id, ", ".join(unknown[:10])),
                    "delivery",
                )
            )
        return selected & set(cases)

    simple_acceptance = re.fullmatch(
        r"\s*(?:筛选条件\s*[:：]\s*)?`?acceptance_id`?\s*(?:==|=|等于)\s*`?(AC-[0-9]{3,})`?\s*",
        selector,
    )
    if simple_acceptance:
        selected_acceptance = simple_acceptance.group(1)
        if selected_acceptance != acceptance_id:
            errors.append(
                issue(
                    "AC_SELECTOR_ACCEPTANCE_MISMATCH",
                    "%s 的筛选器却选择 %s" % (acceptance_id, selected_acceptance),
                    "delivery",
                )
            )
        return {
            case_id
            for case_id, case in cases.items()
            if str(case.get("acceptance_id", "")).strip() == selected_acceptance
        }

    plain_ids = [item.strip().strip("`'\" ") for item in re.split(r"[,，、;；]", selector)]
    if plain_ids and all(item in cases for item in plain_ids):
        return set(plain_ids)
    errors.append(
        issue(
            "AC_SELECTOR_UNVERIFIABLE",
            "%s 的评估用例选择器无法由检查器无歧义执行；请使用 case_ids=<JSON 数组> 或简单 acceptance_id 筛选"
            % acceptance_id,
            "delivery",
        )
    )
    return None


def validate_run_mapping_scope(
    run_id: str,
    run_case_ids: Set[str],
    source_ids: Set[str],
    mapping_selectors: Dict[str, str],
    cases: Dict[str, Dict[str, object]],
    errors: List[Dict[str, str]],
) -> None:
    selected_union: Set[str] = set()
    all_selectors_resolved = True
    for acceptance_id in sorted(source_ids):
        selector = mapping_selectors.get(acceptance_id)
        if not selector:
            all_selectors_resolved = False
            continue
        selected = evaluate_case_selector(acceptance_id, selector, cases, errors)
        if selected is None:
            all_selectors_resolved = False
            continue
        if not selected:
            errors.append(issue("AC_SELECTOR_EMPTY", "%s 的选择器未命中任何 Case" % acceptance_id, "delivery"))
        mismatched = sorted(
            case_id
            for case_id in selected
            if str(cases[case_id].get("acceptance_id", "")).strip() != acceptance_id
        )
        if mismatched:
            errors.append(
                issue(
                    "AC_SELECTOR_CASE_MISMATCH",
                    "%s 的选择器命中了其他 acceptance_id 的 Case：%s"
                    % (acceptance_id, ", ".join(mismatched[:10])),
                    "delivery",
                )
            )
        selected_union.update(selected)
    if all_selectors_resolved and selected_union != run_case_ids:
        missing = sorted(selected_union - run_case_ids)
        unexpected = sorted(run_case_ids - selected_union)
        details: List[str] = []
        if missing:
            details.append("未执行 " + ", ".join(missing[:10]))
        if unexpected:
            details.append("未被选择器命中 " + ", ".join(unexpected[:10]))
        errors.append(
            issue(
                "FORMAL_SCOPE_SELECTOR_MISMATCH",
                "%s 与模板三冻结范围不一致：%s" % (run_id, "；".join(details)),
                "delivery",
            )
        )


def validate_scope(
    text: str,
    errors: List[Dict[str, str]],
) -> Tuple[str, str, Optional[int], Optional[int]]:
    scope_line = find_line(text, "适用规模规则")
    scope_value = value_after(scope_line, "适用规模规则")
    declared = "unknown"
    if meaningful(scope_value) and "一般门槛" in scope_value and "有限交付" not in scope_value:
        declared = "general"
    elif meaningful(scope_value) and "影响范围明确的有限交付" in scope_value and "一般门槛" not in scope_value:
        declared = "limited"
    else:
        errors.append(issue("SCOPE_RULE_UNSELECTED", "适用规模规则必须明确选择一般门槛或有限交付", "delivery"))

    applied = declared
    if declared == "limited":
        proof_errors: List[str] = []
        premise_line = find_line(text, "适用前提")
        premise = value_after(premise_line, "适用前提")
        deterministic = meaningful(premise) and premise.startswith("确定性新建或变更") and "/" not in premise
        maintenance = meaningful(premise) and premise.startswith("既有智能体的局部维护变更") and "/" not in premise
        if not (deterministic or maintenance):
            proof_errors.append("未唯一选择允许的有限交付前提")
        if deterministic:
            line = find_line(text, "确定性新建或变更")
            if not has_yes(line) or not line or not meaningful(value_after(line, "检查方式与依据")):
                proof_errors.append("确定性前提或检查依据不足")
        if maintenance:
            line = find_line(text, "局部维护变更")
            if not line or not RUN_RE.search(line) or not BASELINE_RE.search(line) or not has_yes(line):
                proof_errors.append("局部维护缺少前一一般门槛通过基线或不扩边界确认")
        for label, message in (
            ("范围限定依据", "缺少可核验的范围限定依据"),
            ("本次新增或受影响的需求", "缺少新增或受影响项目清单"),
        ):
            line = find_line(text, label)
            if not meaningful(value_after(line, label)):
                proof_errors.append(message)
        included_line = find_line(text, "已纳入上述项目关联的全部评估用例")
        if not has_yes(included_line) or not included_line or not meaningful(value_after(included_line, "评估用例编号或可执行筛选条件")):
            proof_errors.append("未证明纳入全部受影响及关联 blocking/safety/regression Case")
        coverage_line = find_line(text, "本次范围内的需求场景和适用输入矩阵格均 100% 覆盖")
        if not has_yes(coverage_line) or not coverage_line or not meaningful(value_after(coverage_line, "覆盖结果")):
            proof_errors.append("未证明范围内场景与矩阵格 100% 覆盖")
        confirmation = find_line(text, "交付负责人于候选基线冻结前确认")
        if not meaningful(value_after(confirmation, "交付负责人于候选基线冻结前确认适用前提、范围限定依据、评估范围和覆盖结果（姓名 / 时间）")):
            proof_errors.append("缺少冻结前交付负责人及时间确认")
        if proof_errors:
            applied = "general"
            for message in proof_errors:
                errors.append(issue("LIMITED_SCOPE_UNPROVEN", message + "；已 fail-closed 应用一般门槛", "delivery"))
    elif declared == "unknown":
        applied = "general"

    def integer_field(label: str) -> Optional[int]:
        value = value_after(find_line(text, label), label)
        match = re.match(r"^([0-9]+)\b", value)
        return int(match.group(1)) if match else None

    declared_cases = integer_field("本次冻结范围内的唯一有效评估用例数")
    declared_inputs = integer_field("本次冻结范围内的不同用户输入数")
    if declared_cases is None:
        errors.append(issue("DECLARED_CASE_COUNT", "缺少本次冻结范围的有效 Case 数", "delivery"))
    if declared_inputs is None:
        errors.append(issue("DECLARED_INPUT_COUNT", "缺少本次冻结范围的不同输入数", "delivery"))
    return declared, applied, declared_cases, declared_inputs


def validate_input_review(text: str, errors: List[Dict[str, str]]) -> None:
    for label in ("逐条输入质量复核执行人", "复核执行人的业务知识或选取依据", "复核日期"):
        if not meaningful(value_after(find_line(text, label), label)):
            errors.append(issue("INPUT_REVIEW_EVIDENCE", "缺少输入逐条质量复核信息：%s" % label, "delivery"))
    review_line = find_line(text, "是否逐条确认来源、代表性、有意义差异、预期行为和可执行检查")
    if not has_yes(review_line):
        errors.append(issue("INPUT_REVIEW_EVIDENCE", "未确认逐条输入质量复核已经完成", "delivery"))


def extract_document_ids(text: str) -> Tuple[Set[str], Set[str], Set[str]]:
    baselines: Set[str] = set()
    selftest_runs: Set[str] = set()
    adopted_runs: Set[str] = set()
    for line in text.splitlines():
        if ("候选基线编号" in line or "实际执行的候选基线编号" in line) and "对照" not in line:
            baselines.update(BASELINE_RE.findall(line))
        if "自测运行编号" in line:
            selftest_runs.update(RUN_RE.findall(line))
        if "本次结论采用的运行编号" in line:
            adopted_runs.update(RUN_RE.findall(line))
    return baselines, selftest_runs, adopted_runs


def extract_b2_run_decisions(
    text: str,
    errors: List[Dict[str, str]],
) -> Dict[str, Tuple[str, bool, str]]:
    """读取模板六 B2 逐次复跑表，并拒绝含糊或重复的采用决定。"""

    decisions: Dict[str, Tuple[str, bool, str]] = {}
    for table in markdown_tables(text):
        if len(table) < 2:
            continue
        header = [cell.replace("`", "").strip() for cell in table[0]]
        try:
            run_index = next(index for index, cell in enumerate(header) if "复核运行编号" in cell)
            level_index = next(index for index, cell in enumerate(header) if "复核等级" in cell)
            result_index = next(index for index, cell in enumerate(header) if "运行或范围结果" in cell)
            adopted_index = next(index for index, cell in enumerate(header) if "纳入本次结论" in cell)
        except StopIteration:
            continue
        for row_number, cells in enumerate(table[2:], start=3):
            location = "delivery:B2:%d" % row_number
            if len(cells) <= max(run_index, level_index, result_index, adopted_index):
                errors.append(issue("B2_ROW_SHAPE", "B2 复核记录行列数不足", location))
                continue
            run_cell = cells[run_index].strip().strip("`*_ ")
            level = cells[level_index].strip().strip("`*_ ")
            result_value = cells[result_index].strip().strip("`*_ ")
            adopted_value = cells[adopted_index].strip().strip("`*_ ")
            run_ids = RUN_RE.findall(run_cell)
            if not run_ids:
                if re.match(r"^N/A(?:\b|（|\()", run_cell, flags=re.IGNORECASE):
                    if level != "R1":
                        errors.append(issue("B2_REVIEW_LEVEL", "未复跑的 N/A 行必须明确为 R1", location))
                    if not re.match(r"^N/A(?:\b|（|\()", result_value, flags=re.IGNORECASE):
                        errors.append(issue("B2_RESULT_VALUE", "R1 未复跑时结果必须填写带原因的 N/A", location))
                    if adopted_value != "否":
                        errors.append(issue("B2_ADOPTION_UNSELECTED", "没有 Run ID 的 R1 行不得纳入 Run 结论列表", location))
                    continue
                errors.append(issue("B2_RUN_ID_FORMAT", "B2 复跑必须填写 run-<UUIDv4>；只有明确的 R1 N/A 行可以没有 Run", location))
                continue
            if len(run_ids) != 1 or not RUN_RE.fullmatch(run_cell) or not validate_uuid(run_ids[0], "run-"):
                errors.append(issue("B2_RUN_ID_FORMAT", "B2 每行必须唯一填写 run-<UUIDv4>", location))
                continue
            run_id = run_ids[0]
            if level not in {"R1", "R2", "R3"}:
                errors.append(issue("B2_REVIEW_LEVEL", "B2 复核等级必须明确为 R1、R2 或 R3", location))
                continue
            if level == "R1":
                errors.append(issue("B2_R1_RUN_FORBIDDEN", "R1 只核验原始证据，不得填写复跑 Run ID", location))
            allowed_results = {
                "R1": set(),
                "R2": {"范围内通过", "范围内不通过", "范围内不完整"},
                "R3": {"通过", "不通过", "不完整"},
            }
            if result_value not in allowed_results[level]:
                errors.append(
                    issue(
                        "B2_RESULT_VALUE",
                        "%s 结果措辞无效；R2 使用范围内结论，R3 使用正式评估运行结论" % level,
                        location,
                    )
                )
            if adopted_value not in {"是", "否"}:
                errors.append(issue("B2_ADOPTION_UNSELECTED", "B2 纳入本次结论必须明确选择是或否", location))
                continue
            if run_id in decisions:
                errors.append(issue("B2_RUN_DUPLICATE", "B2 重复记录复核运行：%s" % run_id, location))
                continue
            decisions[run_id] = (level, adopted_value == "是", result_value)
    return decisions


def parse_nonnegative_integer(
    value: str,
    field: str,
    location: str,
    errors: List[Dict[str, str]],
) -> None:
    try:
        parsed = int(value)
        if parsed < 0:
            raise ValueError
    except ValueError:
        errors.append(issue("RESULT_INTEGER", "%s 必须是非负整数" % field, location))


def parse_decimal_value(
    value: str,
    field: str,
    location: str,
    errors: List[Dict[str, str]],
    require_nonnegative: bool = False,
) -> None:
    try:
        parsed = Decimal(value)
        if not parsed.is_finite() or (require_nonnegative and parsed < 0):
            raise InvalidOperation
    except InvalidOperation:
        qualifier = "非负有限数" if require_nonnegative else "有限数值"
        errors.append(issue("RESULT_NUMBER", "%s 必须是%s" % (field, qualifier), location))


def load_results(
    path: Path,
    project: Path,
    cases: Dict[str, Dict[str, object]],
    conclusion_checked_runs: Set[str],
    errors: List[Dict[str, str]],
) -> Tuple[List[Dict[str, str]], Dict[str, Set[str]], Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    run_cases: DefaultDict[str, Set[str]] = defaultdict(set)
    run_baselines: Dict[str, str] = {}
    counts: Counter[Tuple[str, str]] = Counter()
    trial_keys: Set[Tuple[str, str]] = set()
    if not path.is_file():
        errors.append(issue("RESULTS_MISSING", "缺少可访问的 delivery/eval/results.csv", rel(path, project)))
        return rows, dict(run_cases), run_baselines
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != RESULT_HEADER:
            errors.append(
                issue(
                    "RESULT_HEADER",
                    "results.csv 表头必须精确为 17 列且顺序一致",
                    rel(path, project),
                )
            )
            return rows, dict(run_cases), run_baselines
        for row_number, raw in enumerate(reader, start=2):
            location = "%s:%d" % (rel(path, project), row_number)
            if None in raw:
                errors.append(issue("RESULT_EXTRA_COLUMNS", "CSV 行包含表头之外的额外列", location))
            row = {key: (value or "").strip() for key, value in raw.items() if key is not None}
            rows.append(row)
            run_id = row["run_id"]
            trial_id = row["trial_id"]
            case_id = row["case_id"]
            baseline_id = row["baseline_id"]
            if not validate_uuid(run_id, "run-"):
                errors.append(issue("RUN_ID_FORMAT", "run_id 必须为 run-<UUIDv4>", location))
            if not validate_uuid(baseline_id, "bl-"):
                errors.append(issue("BASELINE_ID_FORMAT", "baseline_id 必须为 bl-<UUIDv4>", location))
            if not trial_id:
                errors.append(issue("TRIAL_ID_EMPTY", "trial_id 不得留空", location))
            key = (run_id, trial_id)
            if key in trial_keys:
                errors.append(issue("TRIAL_ID_DUPLICATE", "run_id + trial_id 重复", location))
            trial_keys.add(key)
            if case_id not in cases:
                errors.append(issue("RESULT_CASE_UNKNOWN", "结果引用未知 Case：%s" % case_id, location))
            else:
                run_cases[run_id].add(case_id)
                counts[(run_id, case_id)] += 1
            existing_baseline = run_baselines.get(run_id)
            if existing_baseline is not None and existing_baseline != baseline_id:
                errors.append(issue("RUN_BASELINE_MIXED", "同一 run_id 使用了多个 baseline_id", location))
            else:
                run_baselines[run_id] = baseline_id

            status = row["status"]
            if status not in {"pass", "fail", "error"}:
                errors.append(issue("RESULT_STATUS", "status 必须为 pass/fail/error", location))
            if status == "error" and row["score"]:
                errors.append(issue("ERROR_SCORE", "status=error 时 score 必须为空", location))
            elif row["score"]:
                parse_decimal_value(row["score"], "score", location, errors)
            if status != "pass" and not row["failure_reason"]:
                errors.append(issue("FAILURE_REASON", "status!=pass 时 failure_reason 不得留空", location))
            if not row["evidence_ref"]:
                errors.append(issue("EVIDENCE_REF", "evidence_ref 不得留空", location))
            safety = row["safety_violation"]
            if safety not in {"true", "false", "unknown"}:
                errors.append(issue("SAFETY_VALUE", "safety_violation 必须为 true/false/unknown", location))
            if status != "error" and safety == "unknown":
                errors.append(issue("SAFETY_UNKNOWN", "仅 error Trial 可将 safety_violation 记为 unknown", location))
            for field in ("tool_call_count", "retry_count"):
                if not row[field]:
                    errors.append(issue("RESULT_REQUIRED_FIELD", "%s 不得留空" % field, location))
                else:
                    parse_nonnegative_integer(row[field], field, location, errors)
            for field in ("duration_ms", "input_tokens", "output_tokens"):
                if row[field]:
                    parse_nonnegative_integer(row[field], field, location, errors)
            if row["cost_amount"]:
                parse_decimal_value(row["cost_amount"], "cost_amount", location, errors, require_nonnegative=True)
            if row["cost_amount"] and not row["cost_currency"]:
                errors.append(issue("COST_CURRENCY", "cost_amount 有值时 cost_currency 不得留空", location))
            if not row["cost_amount"] and row["cost_currency"]:
                errors.append(issue("COST_AMOUNT", "cost_currency 有值时 cost_amount 不得留空", location))
            if row["cost_currency"] and not re.fullmatch(r"[A-Z]{3}", row["cost_currency"]):
                errors.append(issue("COST_CURRENCY", "cost_currency 必须是三位大写币种代码", location))
            if case_id in cases:
                case = cases[case_id]
                if case.get("gate") == "scored" and status != "error" and not row["score"]:
                    errors.append(issue("SCORED_RESULT_SCORE", "正常完成的 scored Trial 必须填写 score", location))
                if run_id in conclusion_checked_runs and case.get("gate") == "blocking" and status == "fail":
                    errors.append(issue("BLOCKING_TRIAL_FAILED", "blocking Trial 已确认失败", location))
            if run_id in conclusion_checked_runs and safety == "true":
                errors.append(issue("SAFETY_VIOLATION", "Trial 已确认安全违规", location))
            if run_id in conclusion_checked_runs and status == "error":
                errors.append(issue("UNRESOLVED_ERROR", "结果包含未解决 error", location))
    if not rows:
        errors.append(issue("RESULTS_EMPTY", "results.csv 没有 Trial 结果", rel(path, project)))
    for (run_id, case_id), actual in sorted(counts.items()):
        if run_id not in conclusion_checked_runs:
            continue
        required = cases[case_id].get("required_trials")
        if isinstance(required, int) and not isinstance(required, bool) and actual != required:
            errors.append(
                issue(
                    "TRIAL_COUNT",
                    "%s / %s 应有 %d 个 Trial，实际 %d" % (run_id, case_id, required, actual),
                    rel(path, project),
                )
            )
    return rows, dict(run_cases), run_baselines


def validate_formal_runs(
    formal_runs: Set[str],
    document_baselines: Set[str],
    run_cases: Dict[str, Set[str]],
    run_baselines: Dict[str, str],
    cases: Dict[str, Dict[str, object]],
    acceptance_source_ids: Set[str],
    mapping_selectors: Dict[str, str],
    applied_scope: str,
    declared_cases: Optional[int],
    declared_inputs: Optional[int],
    errors: List[Dict[str, str]],
) -> None:
    if not document_baselines:
        errors.append(issue("DOCUMENT_BASELINE_ID", "交付记录未绑定 bl-<UUIDv4> 候选基线", "delivery"))
    elif len(document_baselines) > 1:
        errors.append(issue("DOCUMENT_BASELINE_MIXED", "当前交付记录出现多个候选 baseline_id", "delivery"))
    if not formal_runs:
        errors.append(issue("FORMAL_RUN_ID", "交付记录未绑定正式自测或 R3 的 run-<UUIDv4>", "delivery"))
        return
    comparable_runs = {
        run_id: run_cases[run_id]
        for run_id in sorted(formal_runs)
        if run_id in run_cases
    }
    if len(comparable_runs) > 1:
        reference_run = next(iter(comparable_runs))
        reference_cases = comparable_runs[reference_run]
        for run_id, case_ids in list(comparable_runs.items())[1:]:
            if case_ids != reference_cases:
                errors.append(
                    issue(
                        "FORMAL_RUN_SCOPE_DIVERGED",
                        "正式自测与 R3 必须执行同一冻结 Case 范围：%s 与 %s 不一致"
                        % (reference_run, run_id),
                        "delivery",
                    )
                )
    for run_id in sorted(formal_runs):
        if run_id not in run_cases:
            errors.append(issue("FORMAL_RUN_RESULTS_MISSING", "正式 Run 在 results.csv 中没有结果：%s" % run_id, "delivery"))
            continue
        baseline_id = run_baselines.get(run_id, "")
        if document_baselines and baseline_id not in document_baselines:
            errors.append(issue("FORMAL_RUN_BASELINE_MISMATCH", "正式 Run 与交付记录候选基线不一致", "delivery"))
        case_ids = run_cases[run_id]
        validate_run_mapping_scope(
            run_id,
            case_ids,
            acceptance_source_ids,
            mapping_selectors,
            cases,
            errors,
        )
        run_acceptance_ids = {
            str(cases[case_id].get("acceptance_id", "")).strip()
            for case_id in case_ids
            if case_id in cases and is_nonempty_string(cases[case_id].get("acceptance_id"))
        }
        missing_acceptance_ids = sorted(acceptance_source_ids - run_acceptance_ids)
        if missing_acceptance_ids:
            errors.append(
                issue(
                    "FORMAL_AC_COVERAGE",
                    "%s 未命中模板一验收项：%s" % (run_id, ", ".join(missing_acceptance_ids)),
                    "delivery",
                )
            )
        unique_inputs = {
            str(cases[case_id].get("input", ""))
            for case_id in case_ids
            if case_id in cases and is_nonempty_string(cases[case_id].get("input"))
        }
        if declared_cases is not None and len(case_ids) != declared_cases:
            errors.append(
                issue(
                    "FORMAL_CASE_COUNT_MISMATCH",
                    "%s 的唯一 Case 数 %d 与交付记录声明 %d 不一致" % (run_id, len(case_ids), declared_cases),
                    "delivery",
                )
            )
        if declared_inputs is not None and declared_inputs > len(unique_inputs):
            errors.append(
                issue(
                    "FORMAL_INPUT_COUNT_MISMATCH",
                    "%s 声明 %d 条不同输入，但最多只有 %d 条字面不同输入"
                    % (run_id, declared_inputs, len(unique_inputs)),
                    "delivery",
                )
            )
        if applied_scope == "general":
            if len(case_ids) < 50:
                errors.append(issue("GENERAL_CASE_MINIMUM", "%s 少于一般门槛的 50 个有效 Case" % run_id, "delivery"))
            if declared_inputs is None or declared_inputs < 50 or len(unique_inputs) < 50:
                errors.append(issue("GENERAL_INPUT_MINIMUM", "%s 少于一般门槛的 50 条不同输入" % run_id, "delivery"))


def validate_r2_language(text: str, warnings: List[Dict[str, str]], errors: List[Dict[str, str]]) -> None:
    for line in text.splitlines():
        if not line.lstrip().startswith("|") or not re.search(r"\|\s*R2\s*\|", line):
            continue
        if "范围内通过" in line:
            warnings.append(issue("R2_SCOPE_ONLY", "R2 的范围内通过不是正式评估运行通过", "delivery"))
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if any(cell == "通过" for cell in cells):
            errors.append(issue("R2_AS_FORMAL_PASS", "R2 只能记录范围结果，不得记录正式“通过”", "delivery"))


def validate_hash_tokens(text: str, errors: List[Dict[str, str]]) -> None:
    for line_number, line in enumerate(text.splitlines(), start=1):
        marker = re.search(r"SHA-?256\s*[:=：]\s*", line, flags=re.IGNORECASE)
        if not marker:
            continue
        value = line[marker.end() :].strip().strip("`").strip()
        if re.fullmatch(r"N/A(?:（[^）]+）|\([^\)]+\))", value, flags=re.IGNORECASE):
            continue
        token_match = re.match(r"([0-9A-Za-z]+)", value)
        if token_match is None or not re.fullmatch(r"[0-9a-fA-F]{64}", token_match.group(1)):
            errors.append(issue("SHA256_FORMAT", "显式填写的 SHA-256 必须是 64 位十六进制或带原因的 N/A", "delivery:%d" % line_number))


def run(project: Path) -> Tuple[Dict[str, object], int]:
    project = project.resolve()
    if not project.is_dir():
        raise ValueError("Agent 项目路径不存在或不是目录")
    errors: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []
    text, docs, shape = load_delivery_docs(project, errors, warnings)
    cases_path = project / "delivery" / "eval" / "cases.jsonl"
    results_path = project / "delivery" / "eval" / "results.csv"
    if shape == "split":
        acceptance_source_text = docs.get(SPLIT_DELIVERY_FILES[0], "")
    else:
        acceptance_source_text = section_for_heading(docs.get("交付记录.md", ""), "智能体需求定义")
    cases = load_cases(cases_path, project, acceptance_source_text, errors)
    validate_case_matrix(docs, shape, cases, errors)
    acceptance_source_ids, mapping_selectors = validate_acceptance_mapping(
        docs, shape, cases, project, errors, warnings
    )
    declared_scope, applied_scope, declared_cases, declared_inputs = validate_scope(text, errors)
    validate_input_review(text, errors)
    document_baselines, selftest_runs, adopted_runs = extract_document_ids(text)
    b2_decisions = extract_b2_run_decisions(text, errors)
    r3_runs = {run_id for run_id, (level, _, _) in b2_decisions.items() if level == "R3"}
    b2_adopted_runs = {run_id for run_id, (_, adopted, _) in b2_decisions.items() if adopted}
    for run_id in sorted(set(b2_decisions) & selftest_runs):
        errors.append(
            issue(
                "B2_RUN_REUSED_SELFTEST",
                "B2 独立复跑必须使用不同于开发自测的新 Run ID：%s" % run_id,
                "delivery",
            )
        )
    expected_adopted_runs = selftest_runs | b2_adopted_runs
    if not adopted_runs:
        errors.append(issue("ADOPTED_RUNS_MISSING", "交付记录未填写本次结论采用的 Run ID 列表", "delivery"))
    if not selftest_runs:
        errors.append(issue("SELFTEST_RUN_ID", "交付记录未绑定开发自测 run-<UUIDv4>", "delivery"))
    elif len(selftest_runs) > 1:
        errors.append(issue("SELFTEST_RUN_MIXED", "当前报告出现多个开发自测 Run ID", "delivery"))
    for run_id in sorted(selftest_runs - adopted_runs):
        errors.append(issue("SELFTEST_NOT_ADOPTED", "开发自测 Run 未纳入本次结论：%s" % run_id, "delivery"))
    if adopted_runs != expected_adopted_runs:
        missing = sorted(expected_adopted_runs - adopted_runs)
        unexpected = sorted(adopted_runs - expected_adopted_runs)
        details: List[str] = []
        if missing:
            details.append("顶部列表遗漏 " + ", ".join(missing))
        if unexpected:
            details.append("顶部列表多出 " + ", ".join(unexpected))
        errors.append(
            issue(
                "ADOPTED_RUN_LIST_MISMATCH",
                "本次结论采用的运行编号列表必须等于开发自测加 B2 标记为是的复跑：%s" % "；".join(details),
                "delivery",
            )
        )
    # 列表或 B2 任一处声称采用，都按当前结论运行处理，避免不一致时隐藏失败。
    effective_adopted_runs = adopted_runs | expected_adopted_runs
    # B2 即使未被采用，只要声明通过，其结果也必须足以支撑该声明。
    # 如实标记为不通过或不完整的未采用历史 Run 不加入检查集，不污染当前结论。
    b2_passing_runs = {
        run_id
        for run_id, (level, _, result_value) in b2_decisions.items()
        if (level == "R2" and result_value == "范围内通过")
        or (level == "R3" and result_value == "通过")
    }
    conclusion_checked_runs = effective_adopted_runs | b2_passing_runs
    formal_runs = (selftest_runs | r3_runs) & effective_adopted_runs
    rows, run_cases, run_baselines = load_results(
        results_path,
        project,
        cases,
        conclusion_checked_runs,
        errors,
    )
    selftest_case_scope: Set[str] = set()
    for run_id in selftest_runs:
        selftest_case_scope.update(run_cases.get(run_id, set()))
    for run_id in sorted(b2_decisions):
        level, adopted, result_value = b2_decisions[run_id]
        if run_id not in run_baselines:
            errors.append(issue("B2_RUN_RESULTS_MISSING", "B2 复跑未写入同一 results.csv：%s" % run_id, "delivery"))
        elif document_baselines and run_baselines[run_id] not in document_baselines:
            errors.append(issue("B2_RUN_BASELINE_MISMATCH", "B2 复跑与候选基线不一致：%s" % run_id, "delivery"))
        if adopted and result_value in {"不通过", "范围内不通过"}:
            errors.append(issue("ADOPTED_REVIEW_FAILED", "纳入本次结论的 B2 复核明确为不通过：%s" % run_id, "delivery"))
        if adopted and result_value in {"不完整", "范围内不完整"}:
            errors.append(issue("ADOPTED_REVIEW_INCOMPLETE", "纳入本次结论的 B2 复核明确为不完整：%s" % run_id, "delivery"))
        review_scope = run_cases.get(run_id, set())
        if level == "R2" and selftest_case_scope:
            outside = sorted(review_scope - selftest_case_scope)
            if outside:
                errors.append(
                    issue(
                        "B2_R2_SCOPE_OUTSIDE_FORMAL",
                        "R2 复跑包含冻结正式范围外的 Case：%s" % ", ".join(outside[:10]),
                        "delivery",
                    )
                )
            if result_value == "范围内通过":
                mandatory = {
                    case_id
                    for case_id in selftest_case_scope
                    if case_id in cases
                    and (
                        cases[case_id].get("gate") == "blocking"
                        or "safety" in cases[case_id].get("tags", [])
                    )
                }
                missing = sorted(mandatory - review_scope)
                if missing:
                    errors.append(
                        issue(
                            "B2_R2_REQUIRED_SCOPE_MISSING",
                            "R2 范围内通过但未覆盖正式范围中的全部 blocking/safety Case：%s"
                            % ", ".join(missing[:10]),
                            "delivery",
                        )
                    )
        if level == "R3" and result_value == "通过" and selftest_case_scope and review_scope != selftest_case_scope:
            errors.append(
                issue(
                    "B2_R3_SCOPE_MISMATCH",
                    "R3 声明通过但未完整复跑与开发自测相同的冻结正式范围：%s" % run_id,
                    "delivery",
                )
            )
    for run_id in sorted(effective_adopted_runs):
        if run_id not in run_baselines:
            errors.append(issue("ADOPTED_RUN_RESULTS_MISSING", "本次结论采用的 Run 没有结果：%s" % run_id, "delivery"))
        elif document_baselines and run_baselines[run_id] not in document_baselines:
            errors.append(issue("ADOPTED_RUN_BASELINE_MISMATCH", "本次结论采用的 Run 与候选基线不一致：%s" % run_id, "delivery"))
    validate_formal_runs(
        formal_runs,
        document_baselines,
        run_cases,
        run_baselines,
        cases,
        acceptance_source_ids,
        mapping_selectors,
        applied_scope,
        declared_cases,
        declared_inputs,
        errors,
    )
    validate_r2_language(text, warnings, errors)
    validate_hash_tokens(text, errors)

    result: Dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "status": "fail" if errors else "pass",
        "errors": errors,
        "warnings": warnings,
        "manual_checks": [
            "逐条确认输入具有真实测试差异、业务代表性和具备业务知识人员的质量复核；字面去重不能证明质量。",
            "确认模板一是 AC-xxx 阈值唯一事实源，Case 与模板三评估实现完整覆盖冻结范围。",
            "复核评分规则、证据内容、最终业务状态、安全判定和冻结时间的真实性。",
            "机器校验通过不等于正式评估运行通过、交付评估通过或允许发布。",
        ],
        "summary": {
            "agent_project": str(project),
            "delivery_shape": shape,
            "markdown_contract_version": DELIVERY_MARKDOWN_CONTRACT_VERSION,
            "scope_declared": declared_scope,
            "scope_applied": applied_scope,
            "case_count": len(cases),
            "result_row_count": len(rows),
            "document_formal_run_ids": sorted(formal_runs),
            "adopted_run_ids": sorted(adopted_runs),
            "b2_adopted_run_ids": sorted(b2_adopted_runs),
            "effective_conclusion_run_ids": sorted(effective_adopted_runs),
            "reported_r3_run_ids": sorted(r3_runs),
            "result_run_ids": sorted(run_cases),
        },
    }
    return result, 1 if errors else 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("agent_project", type=Path, help="包含 delivery/ 的 Agent 项目目录")
    args = parser.parse_args(argv)
    try:
        result, code = run(args.agent_project)
    except (OSError, UnicodeError, ValueError, csv.Error) as exc:
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
