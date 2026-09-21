#!/usr/bin/env python3
"""解析 Agent 共享评测文件，并校验其中的 ID 与 Experiment 选择。"""

from __future__ import annotations

import re
from pathlib import Path


TOP_SECTIONS = ("测试数据", "评估方法", "测试验收", "Experiment 评估选择")
CASE_RE = re.compile(r"^##### ((?:D|U|T)-[A-Z0-9-]+)$", re.MULTILINE)
METHOD_RE = re.compile(r"^### (m-[a-z0-9-]+)$", re.MULTILINE)
ACCEPTANCE_RE = re.compile(r"^### (AC-[0-9]{3})$", re.MULTILINE)
EXPERIMENT_RE = re.compile(r"^### (EXP-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{3,})$", re.MULTILINE)
SELECTION_FIELDS = ("测试用例", "评估方法", "测试验收")


def _sections(text: str) -> dict[str, str]:
    matches = list(re.finditer(r"^## (.+)$", text, re.MULTILINE))
    names = tuple(match.group(1) for match in matches)
    if names != TOP_SECTIONS:
        raise ValueError(f"顶级章节必须依次为：{'、'.join(TOP_SECTIONS)}")
    return {
        match.group(1): text[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(text)]
        for index, match in enumerate(matches)
    }


def _unique_ids(pattern: re.Pattern[str], text: str, label: str) -> list[str]:
    values = pattern.findall(text)
    duplicates = sorted({value for value in values if values.count(value) > 1})
    if duplicates:
        raise ValueError(f"{label} ID 重复：{', '.join(duplicates)}")
    if not values:
        raise ValueError(f"{label}不能为空")
    return values


def _parse_id_list(value: str, label: str) -> list[str]:
    identifiers = re.findall(r"`([^`]+)`", value)
    remainder = re.sub(r"`[^`]+`", "", value).replace("、", "").strip()
    if not identifiers or remainder:
        raise ValueError(f"{label}必须是用顿号分隔的反引号 ID")
    if len(identifiers) != len(set(identifiers)):
        raise ValueError(f"{label}包含重复 ID")
    return identifiers


def _selections(text: str) -> dict[str, dict[str, list[str]]]:
    matches = list(EXPERIMENT_RE.finditer(text))
    selections: dict[str, dict[str, list[str]]] = {}
    for index, match in enumerate(matches):
        experiment_id = match.group(1)
        if experiment_id in selections:
            raise ValueError(f"Experiment 选择重复：{experiment_id}")
        body = text[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(text)]
        fields: dict[str, list[str]] = {}
        for label in SELECTION_FIELDS:
            field_matches = re.findall(rf"^- {re.escape(label)}：(.+)$", body, re.MULTILINE)
            if len(field_matches) != 1:
                raise ValueError(f"{experiment_id} 必须且只能声明一次{label}")
            fields[label] = _parse_id_list(field_matches[0], f"{experiment_id} {label}")
        selections[experiment_id] = {
            "case_ids": fields["测试用例"],
            "method_ids": fields["评估方法"],
            "acceptance_ids": fields["测试验收"],
        }
    if not selections:
        raise ValueError("Experiment 评估选择不能为空")
    return selections


def load_evaluation(path: Path) -> dict[str, object]:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"缺少实体评测文件：{path}")
    sections = _sections(path.read_text(encoding="utf-8"))
    case_ids = _unique_ids(CASE_RE, sections["测试数据"], "测试用例")
    method_ids = _unique_ids(METHOD_RE, sections["评估方法"], "评估方法")
    acceptance_ids = _unique_ids(ACCEPTANCE_RE, sections["测试验收"], "测试验收")
    selections = _selections(sections["Experiment 评估选择"])
    defined = {
        "case_ids": set(case_ids),
        "method_ids": set(method_ids),
        "acceptance_ids": set(acceptance_ids),
    }
    for experiment_id, selection in selections.items():
        for field, identifiers in selection.items():
            unknown = sorted(set(identifiers) - defined[field])
            if unknown:
                raise ValueError(f"{experiment_id} 引用了未定义的 {field}：{', '.join(unknown)}")
    return {
        "case_ids": case_ids,
        "method_ids": method_ids,
        "acceptance_ids": acceptance_ids,
        "selections": selections,
    }


def selection_for(path: Path, experiment_id: str) -> dict[str, list[str]]:
    evaluation = load_evaluation(path)
    selection = evaluation["selections"].get(experiment_id)  # type: ignore[union-attr]
    if selection is None:
        raise ValueError(f"evaluation.md 未选择 Experiment：{experiment_id}")
    return selection
