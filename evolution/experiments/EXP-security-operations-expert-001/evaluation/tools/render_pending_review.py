#!/usr/bin/env python3
"""把 eval/pending/ 与 eval/cases.jsonl 渲染成人工复核用的 Markdown 阅读视图。

JSONL 是唯一可编辑事实源；本工具只读它并按固定顺序排版，输出默认写到标准输出，
不落盘、不作为第二份事实源。评审需要留档时用 `--output` 显式指定路径。

阅读顺序：名称与状态 → 用户输入 → 测试前提 → 预期行为 → 检查方法 → 关联编号与来源。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


FIELDS_IN_ORDER = (
    ("id", "编号"),
    ("source_id", "来源编号"),
    ("scenario_id", "场景"),
    ("intent_id", "意图"),
    ("variant_types", "输入变体"),
    ("review_status", "用例审定状态"),
    ("acceptance_mapping_status", "验收映射状态"),
    ("gate", "判定作用"),
    ("input", "用户输入"),
    ("expected_behavior", "预期行为"),
    ("check", "检查方法"),
    ("requirement_ids", "关联需求"),
    ("acceptance_id", "关联验收"),
    ("tags", "标签"),
)
CONTEXT_FIELDS = (
    ("input_template", "输入模板"),
    ("fixture_state", "预置/前置状态"),
    ("related_requirement_note", "关联需求说明"),
)
DESIGN_FIELDS = (
    ("source_kind", "来源类型"),
    ("status", "来源状态"),
    ("supplied_by", "提供者"),
    ("supplied_at", "提供时间"),
    ("reuses", "复用关系"),
)


def render_value(value: object) -> str:
    if isinstance(value, list):
        return "；".join(str(item) for item in value) if value else "（无）"
    text = str(value).strip()
    return text if text else "（无）"


def render_row(row: dict) -> list[str]:
    title = row.get("input") or row.get("input_template") or ""
    heading = f"### {row.get('id', '（无编号）')}"
    if title:
        heading += f"：{render_value(title)}"
    lines = [heading, ""]
    lines.append("| 项目 | 内容 |")
    lines.append("|---|---|")
    for key, label in FIELDS_IN_ORDER:
        if key == "input" or key not in row:
            continue
        lines.append(f"| {label} | {render_value(row[key])} |")
    context = row.get("context") if isinstance(row.get("context"), dict) else {}
    for key, label in CONTEXT_FIELDS:
        if key in context:
            lines.append(f"| {label} | {render_value(context[key])} |")
    design = context.get("design") if isinstance(context.get("design"), dict) else {}
    for key, label in DESIGN_FIELDS:
        if key in design:
            lines.append(f"| 来源·{label} | {render_value(design[key])} |")
    if row.get("input"):
        lines.append(f"| 用户输入 | {render_value(row['input'])} |")
    unknown = sorted(set(row) - {key for key, _ in FIELDS_IN_ORDER} - {"context"})
    if unknown:
        lines.append(f"| 其他字段 | {'、'.join(unknown)} |")
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
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
