#!/usr/bin/env python3
"""解析 Agent 共享评测文件，并校验其中的 ID 与 Experiment 选择。"""

from __future__ import annotations

import re
from pathlib import Path


TOP_SECTIONS = ("测试数据", "评估方法", "测试验收", "Experiment 评估选择")
CASE_RE = re.compile(r"^##### ((?:D|U|T)-[A-Z0-9-]+)$", re.MULTILINE)
PRESET_HEADING_RE = re.compile(r"([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-F[0-9]{2})(?:\s+.+)?")
METHOD_RE = re.compile(r"^### (m-[a-z0-9-]+)$", re.MULTILINE)
ACCEPTANCE_RE = re.compile(r"^### (AC-[0-9]{3})$", re.MULTILINE)
EXPERIMENT_RE = re.compile(r"^### (EXP-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{3,})$", re.MULTILINE)
SELECTION_FIELDS = ("测试用例", "评估方法", "测试验收")
EXECUTORS = {
    "repository-contract",
    "dsh-load-cycle",
    "runtime-tool-contract",
    "web-inspection-boundary",
    "web-model-catalog",
    "web-model-chat",
    "web-route-trace",
    "web-chat",
}


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


def _case_bodies(text: str) -> dict[str, str]:
    matches = list(CASE_RE.finditer(text))
    return {
        match.group(1): text[match.end():matches[index + 1].start() if index + 1 < len(matches) else len(text)]
        for index, match in enumerate(matches)
    }


def _preset_bodies(text: str) -> dict[str, str]:
    headings = list(re.finditer(r"^### (.+)$", text, re.MULTILINE))
    names = [heading.group(1) for heading in headings]
    if names != ["测试预置", "测试用例"]:
        raise ValueError("测试数据必须依次且只能包含测试预置和测试用例章节")
    preset_text = text[headings[0].end():headings[1].start()]
    matches = list(re.finditer(r"^#### (.+)$", preset_text, re.MULTILINE))
    if not matches:
        raise ValueError("测试预置不能为空")
    parsed = [PRESET_HEADING_RE.fullmatch(match.group(1)) for match in matches]
    invalid = [match.group(1) for match, value in zip(matches, parsed) if value is None]
    if invalid:
        raise ValueError(f"测试预置标题格式无效：{', '.join(invalid)}")
    preset_ids = [value.group(1) for value in parsed if value is not None]
    duplicates = sorted({value for value in preset_ids if preset_ids.count(value) > 1})
    if duplicates:
        raise ValueError(f"测试预置 ID 重复：{', '.join(duplicates)}")
    bodies = {
        preset_ids[index]: preset_text[
            match.end():matches[index + 1].start() if index + 1 < len(matches) else len(preset_text)
        ]
        for index, match in enumerate(matches)
    }
    for preset_id, body in bodies.items():
        for label in ("公共基线", "金标准", "适用边界"):
            if body.count(f"**{label}**") != 1:
                raise ValueError(f"{preset_id} 必须且只能声明一次{label}")
        flow = re.search(r"^```mermaid\s*\nflowchart\s+", body, re.MULTILINE)
        if flow is None:
            raise ValueError(f"{preset_id} 缺少 Mermaid 主决策流程图")
        positions = (
            body.index("**公共基线**"),
            flow.start(),
            body.index("**金标准**"),
            body.index("**适用边界**"),
        )
        if positions != tuple(sorted(positions)):
            raise ValueError(f"{preset_id} 必须依次声明公共基线、主决策流程图、金标准和适用边界")
    return bodies


def _field(body: str, label: str) -> str | None:
    matches = re.findall(rf"^\*\*{re.escape(label)}：?\*\*\s*`?([^`\n]+?)`?\s*$", body, re.MULTILINE)
    if len(matches) > 1:
        raise ValueError(f"{label}只能声明一次")
    return matches[0].strip() if matches else None


def _prompt(body: str) -> str | None:
    match = re.search(r"^\*\*用户输入：?\*\*\s*\n+```(?:text)?\n(.*?)\n```", body, re.MULTILINE | re.DOTALL)
    return match.group(1).strip() if match else None


def load_evaluation(path: Path) -> dict[str, object]:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"缺少实体评测文件：{path}")
    sections = _sections(path.read_text(encoding="utf-8"))
    presets = _preset_bodies(sections["测试数据"])
    case_ids = _unique_ids(CASE_RE, sections["测试数据"], "测试用例")
    bodies = _case_bodies(sections["测试数据"])
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
        "preset_ids": list(presets),
        "case_ids": case_ids,
        "cases": {
            case_id: {
                "input": _prompt(bodies[case_id]),
                "executor": _field(bodies[case_id], "执行器"),
                "tool_boundary": _field(bodies[case_id], "工具边界"),
                "side_effect_budget": _field(bodies[case_id], "副作用预算"),
            }
            for case_id in case_ids
        },
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


def execution_for(
    path: Path,
    experiment_id: str,
    selected_case_ids: list[str] | None = None,
) -> list[dict[str, str]]:
    evaluation = load_evaluation(path)
    selection = evaluation["selections"].get(experiment_id)  # type: ignore[union-attr]
    if selection is None:
        raise ValueError(f"evaluation.md 未选择 Experiment：{experiment_id}")
    declared = selection["case_ids"]
    chosen = declared if selected_case_ids is None else selected_case_ids
    if not chosen:
        raise ValueError("至少选择一个测试用例")
    if len(chosen) != len(set(chosen)):
        raise ValueError("测试用例不能重复")
    unknown = [case_id for case_id in chosen if case_id not in declared]
    if unknown:
        raise ValueError(f"测试用例未被 {experiment_id} 选择：{', '.join(unknown)}")
    if chosen != [case_id for case_id in declared if case_id in chosen]:
        raise ValueError("测试用例必须按 evaluation.md 声明顺序选择")
    cases = evaluation["cases"]  # type: ignore[assignment]
    result = []
    for case_id in chosen:
        case = cases[case_id]
        executor = case["executor"]
        missing = [
            label for label, value in (
                ("用户输入", case["input"]),
                ("执行器", executor),
                ("工具边界", case["tool_boundary"]),
                ("副作用预算", case["side_effect_budget"]),
            ) if not value
        ]
        if missing:
            raise ValueError(f"{case_id} 缺少执行元数据：{'、'.join(missing)}")
        if executor not in EXECUTORS:
            raise ValueError(f"{case_id} 使用未知执行器：{executor}")
        result.append({
            "case_id": case_id,
            "input": case["input"],
            "executor": executor,
            "tool_boundary": case["tool_boundary"],
            "side_effect_budget": case["side_effect_budget"],
        })
    return result
