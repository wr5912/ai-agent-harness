#!/usr/bin/env python3
"""把 eval/pending/ 与 eval/cases.jsonl 渲染成人工复核用的 Markdown 阅读视图。

JSONL 是唯一可编辑事实源；本工具只读它，输出默认写到标准输出，不落盘、不作为第二份事实源。
评审需要留档时用 `--output` 显式指定路径；该路径不得指向任何输入文件（含符号链接与硬链接
别名），也不得落在下次运行会被当作输入的位置。

每个用例按以下顺序排版，以便先理解问题与前提、再判断预期：

1. 名称与状态（编号、场景、意图、变体、审定状态、映射状态、判定作用、标签）
2. 用户输入
3. 测试前提（输入模板、预置/前置状态、关联需求说明）
4. 预期行为
5. 检查方法
6. 关联与来源（关联需求/验收、来源类型与状态）

退出码：0 成功；1 渲染失败（输入不可读或不是合法 JSONL）；2 没有可渲染输入，或输出路径被拒。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


INDEX_FIELDS = (
    ("id", "编号"),
    ("scenario_id", "场景"),
    ("intent_id", "意图"),
    ("variant_types", "输入变体"),
    ("review_status", "用例审定状态"),
    ("acceptance_mapping_status", "验收映射状态"),
    ("gate", "判定作用"),
    ("tags", "标签"),
)
TEXT_FIELDS = (("input", "用户输入"),)
CONTEXT_FIELDS = (
    ("input_template", "输入模板"),
    ("fixture_state", "预置/前置状态"),
    ("related_requirement_note", "关联需求说明"),
)
LIST_FIELDS = (("expected_behavior", "预期行为"), ("check", "检查方法"))
RELATION_FIELDS = (
    ("requirement_ids", "关联需求"),
    ("acceptance_id", "关联验收"),
    ("source_id", "来源编号"),
)
DESIGN_FIELDS = (
    ("source_kind", "来源类型"),
    ("status", "来源状态"),
    ("supplied_by", "提供者"),
    ("supplied_at", "提供时间"),
    ("reuses", "复用关系"),
)


def render_cell(value: object) -> str:
    """把一个值放进 Markdown 单元格：转义竖线并把换行折成空格，避免破坏表格结构。"""
    if isinstance(value, list):
        text = "；".join(str(item) for item in value) if value else ""
    else:
        text = "" if value is None else str(value)
    text = " ".join(text.split())
    return text.replace("|", "\\|") if text else "（无）"


def fenced(text: str) -> list[str]:
    """用比内容中最长反引号串更长的栅栏包裹文本，内容原样保留。"""
    longest = 0
    current = 0
    for character in text:
        current = current + 1 if character == "`" else 0
        longest = max(longest, current)
    fence = "`" * max(3, longest + 1)
    return [fence + "text", text, fence]


def bullet_list(values: list) -> list[str]:
    """把列表字段渲染成 Markdown 列表；项内换行与空行用缩进保持在同一项内。"""
    lines = []
    for value in values:
        text = str(value)
        parts = text.split("\n")
        lines.append(f"- {parts[0].strip()}" if parts[0].strip() else "-")
        for part in parts[1:]:
            lines.append(f"  {part.strip()}")
    return lines or ["- （无）"]


def table(rows: list[tuple[str, str]]) -> list[str]:
    lines = ["| 项目 | 内容 |", "|---|---|"]
    lines.extend(f"| {label} | {render_cell(value)} |" for label, value in rows)
    return lines


def render_row(row: dict) -> list[str]:
    lines = [f"### {render_cell(row.get('id', '（无编号）'))}", ""]

    index_rows = [(label, row[key]) for key, label in INDEX_FIELDS if key in row]
    unknown = sorted(set(row) - {key for key, _ in INDEX_FIELDS} - {"context"} - {key for key, _ in TEXT_FIELDS}
                     - {key for key, _ in LIST_FIELDS} - {key for key, _ in RELATION_FIELDS})
    if unknown:
        index_rows.append(("其他字段", "、".join(unknown)))
    lines.extend(table(index_rows))
    lines.append("")

    for key, label in TEXT_FIELDS:
        if row.get(key):
            lines.append(f"**{label}**")
            lines.append("")
            lines.extend(fenced(str(row[key])))
            lines.append("")

    context = row.get("context") if isinstance(row.get("context"), dict) else {}
    premise = [(label, context[key]) for key, label in CONTEXT_FIELDS if key in context]
    if premise:
        lines.append("**测试前提**")
        lines.append("")
        for label, value in premise:
            lines.append(f"{label}：")
            lines.append("")
            lines.extend(fenced(str(value)))
            lines.append("")

    for key, label in LIST_FIELDS:
        values = row.get(key)
        if values:
            lines.append(f"**{label}**")
            lines.append("")
            lines.extend(bullet_list(values if isinstance(values, list) else [values]))
            lines.append("")

    design = context.get("design") if isinstance(context.get("design"), dict) else {}
    relation_rows = [(label, row[key]) for key, label in RELATION_FIELDS if key in row]
    relation_rows.extend((f"来源·{label}", design[key]) for key, label in DESIGN_FIELDS if key in design)
    if relation_rows:
        lines.append("**关联与来源**")
        lines.append("")
        lines.extend(table(relation_rows))
        lines.append("")

    return lines


def render_file(path: Path) -> str:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"{path.name} 第 {number} 行不是合法 JSON：{error}") from error
        if not isinstance(value, dict):
            raise ValueError(f"{path.name} 第 {number} 行不是 JSON 对象")
        rows.append(value)
    lines = [f"## {path.name}（{len(rows)} 条）", ""]
    for row in rows:
        lines.extend(render_row(row))
    return "\n".join(lines)


def refuse_reason(output: Path, sources: list[Path], pending_dir: Path | None, cases: Path) -> str | None:
    """输出路径落在输入集合内时给出拒绝原因；允许覆盖普通报告文件。"""
    target = output.absolute()
    for source in sources:
        if target == source.absolute():
            return f"输出路径就是输入文件：{source}"
        try:
            if target.exists() and source.exists() and os.path.samefile(target, source):
                return f"输出路径与输入文件是同一个文件（硬链接或符号链接别名）：{source}"
        except OSError:
            continue
        if target.resolve() == source.resolve():
            return f"输出路径解析后指向输入文件：{source}"
    # 尚未存在的输出也要拦：写进 pending/ 的 *.jsonl 会在下次渲染时被当作输入解析。
    if target.resolve() == cases.resolve():
        return f"输出路径是 Case 事实源：{cases}"
    if pending_dir is not None and output.suffix == ".jsonl" \
            and target.parent.resolve() == pending_dir.resolve():
        return f"输出路径落在待复核输入目录内（下次渲染会把它当输入）：{pending_dir}"
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent-dir", type=Path, required=True,
                        help="agents/<agent-id> 目录；读取 eval/cases.jsonl 与 eval/pending/*.jsonl")
    parser.add_argument("--output", type=Path, help="写入指定文件；缺省打印到标准输出")
    args = parser.parse_args()
    eval_dir = args.agent_dir / "eval"
    sources = []
    cases = eval_dir / "cases.jsonl"
    if cases.is_file():
        sources.append(cases)
    pending_dir = eval_dir / "pending"
    if pending_dir.is_dir():
        sources.extend(sorted(pending_dir.glob("*.jsonl")))
    if not sources:
        print(f"没有可渲染的用例文件：{eval_dir}", file=sys.stderr)
        raise SystemExit(2)
    if args.output:
        reason = refuse_reason(args.output, sources, pending_dir if pending_dir.is_dir() else None, cases)
        if reason:
            print(f"pending review render failed: 拒绝写出——{reason}", file=sys.stderr)
            raise SystemExit(2)
    try:
        body = "\n".join(render_file(path) for path in sources)
    except (OSError, ValueError) as error:
        print(f"pending review render failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
    document = "# 待复核用例阅读视图\n\n" + body + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(document, encoding="utf-8")
        print(f"{args.output}（{len(sources)} 个文件）")
        return
    sys.stdout.write(document)


if __name__ == "__main__":
    main()
