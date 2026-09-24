#!/usr/bin/env python3
"""解析 evaluation.md 中按阅读顺序排列的业务 Case。"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


CASE_RE = re.compile(r"^#### (U-[A-Z0-9-]+)\s+([^\n]+)$", re.MULTILINE)
CASE_LIKE_RE = re.compile(r"^#### ([A-Z]-[A-Z0-9-]+)\s+", re.MULTILINE)
LABEL_RE = re.compile(r"^\*\*(用户输入(?: ([1-9][0-9]*))?|预期)\*\*\s*$", re.MULTILINE)
BOLD_LABEL_RE = re.compile(r"^\*\*[^*\n]+\*\*\s*$", re.MULTILINE)


def _input(block: str, case_id: str, label: str) -> str:
    values = []
    for line in block.strip().splitlines():
        if not line.strip():
            continue
        if not line.startswith(">"):
            raise ValueError(f"{case_id} {label}必须使用 Markdown 引用块")
        values.append(line[1:].removeprefix(" "))
    value = "\n".join(values).strip()
    if not value:
        raise ValueError(f"{case_id} {label}不能为空")
    return value


def _case(case_id: str, title: str, body: str) -> dict[str, object]:
    labels = list(LABEL_RE.finditer(body))
    all_labels = list(BOLD_LABEL_RE.finditer(body))
    if len(labels) != len(all_labels):
        raise ValueError(f"{case_id} 只允许用户输入和预期两个字段")
    if not labels:
        raise ValueError(f"{case_id} 缺少用户输入和预期")

    values = []
    for index, match in enumerate(labels):
        end = labels[index + 1].start() if index + 1 < len(labels) else len(body)
        values.append((match.group(1), match.group(2), body[match.end():end]))

    expected = [value for value in values if value[0] == "预期"]
    inputs = [value for value in values if value[0] != "预期"]
    if len(expected) != 1 or not inputs or values[-1][0] != "预期":
        raise ValueError(f"{case_id} 必须先写用户输入，最后写一次预期")
    if any(value[0] == "预期" for value in values[:-1]):
        raise ValueError(f"{case_id} 预期必须位于 Case 末尾")

    numbers = [value[1] for value in inputs]
    if len(inputs) == 1:
        if numbers != [None]:
            raise ValueError(f"{case_id} 单轮输入必须使用“用户输入”")
    elif numbers != [str(index) for index in range(1, len(inputs) + 1)]:
        raise ValueError(f"{case_id} 多轮输入必须从 1 连续编号")

    prompts = [_input(value[2], case_id, value[0]) for value in inputs]
    expected_behavior = expected[0][2].strip()
    if not expected_behavior:
        raise ValueError(f"{case_id} 预期不能为空")
    return {
        "case_id": case_id,
        "title": title.strip(),
        "inputs": prompts,
        "expected_behavior": expected_behavior,
    }


def load_evaluation(path: Path) -> dict[str, object]:
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"缺少实体评测文件：{path}")
    text = path.read_text(encoding="utf-8")
    unsupported = [match.group(1) for match in CASE_LIKE_RE.finditer(text)
                   if not match.group(1).startswith("U-")]
    if unsupported:
        raise ValueError("evaluation.md 只允许业务 U-* Case：" + "、".join(unsupported))
    matches = list(CASE_RE.finditer(text))
    if not matches:
        raise ValueError("evaluation.md 至少需要一个 U-* Case")

    case_ids = [match.group(1) for match in matches]
    duplicates = sorted({case_id for case_id in case_ids if case_ids.count(case_id) > 1})
    if duplicates:
        raise ValueError("Case ID 重复：" + "、".join(duplicates))

    cases = {}
    signatures = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end():end]
        next_section = re.search(r"^#{1,3} ", body, re.MULTILINE)
        if next_section:
            body = body[:next_section.start()]
        value = _case(match.group(1), match.group(2), body)
        signature = tuple("".join(item.split()) for item in value["inputs"])
        if signature in signatures:
            raise ValueError(f"业务测试输入重复：{signatures[signature]}、{value['case_id']}")
        signatures[signature] = value["case_id"]
        cases[value["case_id"]] = value
    return {"case_ids": case_ids, "cases": cases}


def execution_for(path: Path, selected_case_ids: list[str]) -> list[dict[str, object]]:
    evaluation = load_evaluation(path)
    if not selected_case_ids:
        raise ValueError("至少显式选择一个 Case")
    if len(selected_case_ids) != len(set(selected_case_ids)):
        raise ValueError("Case 不能重复选择")
    unknown = [case_id for case_id in selected_case_ids if case_id not in evaluation["cases"]]
    if unknown:
        raise ValueError("未定义的 Case：" + "、".join(unknown))
    selected = set(selected_case_ids)
    return [evaluation["cases"][case_id] for case_id in evaluation["case_ids"] if case_id in selected]


def evaluation_digest(path: Path, selected_case_ids: list[str]) -> str:
    """只摘要本次锁定的 Case，忽略其他 Case 的变化。"""
    raw = json.dumps(
        execution_for(path, selected_case_ids),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(raw).hexdigest()
