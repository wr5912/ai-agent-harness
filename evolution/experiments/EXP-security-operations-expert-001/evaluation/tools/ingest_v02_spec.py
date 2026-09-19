#!/usr/bin/env python3
"""将 V0.2 五类场景设计稿摄入为 security-operations-expert 的 spec/eval 事实源。

输入：evolution/history/imports/security-operations-expert-2026-09-17/ 下的 V0.2 源文档。
输出：agents/security-operations-expert/spec/{requirements.md,tasks.yaml,acceptance.yaml}
      agents/security-operations-expert/eval/{methods.yaml,fixtures/*.md,pending/scenario-design.pending.jsonl}
      摄入证据 evaluation/evidence/v02-spec-ingestion.json

编号契约：仓库事实源使用 REQ-[0-9]{3,}/AC-[0-9]{3,}；源文档的 REQ-SOC-*/TASK-SOC-*/AC-SOC-*
作为 source_id 逐条保留，形成唯一迁移映射，不并存两套可编辑事实源。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SOURCE_NAME = "网络安全运营五类场景_需求任务测试评估与验收标准_V0.2_2026-09-17.md"
REQ_ID_RE = re.compile(r"REQ-SOC-[A-Z]+-[0-9]+")
AC_ID_RE = re.compile(r"AC-SOC-[A-Z]+-Q?[0-9]+")
TASK_ID_RE = re.compile(r"TASK-SOC-[A-Z]+-[0-9]+")

# 生成文件一次性导入后即转为人工维护；重新生成只用于核对与修正映射，不能当作默认修复方式。
MAINTENANCE_NOTE = (
    "> 维护方式：本文件首次由 `evaluation/tools/ingest_v02_spec.py` 从源文档生成，"
    "此后由维护者维护；重新生成须显式 `--refresh`，会覆盖维护者新增内容。"
)

# 源文档在同一句里反复追加的通用判定原则；逐条重复只会淹没该条真正的可观察结果，
# 因此提取为文件级说明，条目只保留该条特有的判定内容。
GENERIC_CRITERION_TAILS = (
    "对冻结的核心及风险状态逐条满足，不允许禁止结果发生。",
    "对应已承诺分支逐条满足，不允许以能力缺口替代应完成结果。",
)
SOURCE_LEGEND = """# 来源代号（源文档附录 C）
#   S1        智能化网络安全运营与AI交互核心场景与Story全景.md，V1.2；S21—S41 为其第 5.5—5.9 节的故事编号
#   S2-RSP    agent_delivery_data 响应处置_delivery
#   S2-INS    agent_delivery_data 巡检_delivery
#   S2-FLT    agent_delivery_data 故障排查_delivery
#   S2-POL    agent_delivery_data 策略配置_delivery
#   S3        知识库管理平台
#   S4        常见的网络安全运营语音指令.md，17 个章节
#   S5        本轮用户澄清（2026-09-17）
#   B0        V0.1 修订基稿
#   G1/G2/G3  agent-engineering-spec 锁定提交 1afe0eec1bb786e5313bb0a06717871fd14ebe28 的 02/04/06 号规范
"""

SCENARIO_ORDER = (
    ("RSP", "3. 响应处置"),
    ("INS", "4. 巡检"),
    ("FLT", "5. 故障排查"),
    ("POL", "6. 策略配置"),
    ("QA", "7. 知识问答"),
)


def fail(message: str) -> None:
    print(f"ingest_v02_spec failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def split_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def is_separator(line: str) -> bool:
    cells = split_row(line)
    return bool(cells) and all(re.fullmatch(r":?-{2,}:?", cell) for cell in cells)


def parse_tables(text: str) -> list[tuple[list[str], list[list[str]]]]:
    tables: list[tuple[list[str], list[list[str]]]] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.strip().startswith("|") and index + 1 < len(lines) and is_separator(lines[index + 1]):
            header = split_row(line)
            rows: list[list[str]] = []
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(split_row(lines[index]))
                index += 1
            tables.append((header, rows))
            continue
        index += 1
    return tables


def chapters(text: str) -> dict[str, str]:
    """按一级标题切分章节，返回 {标题行: 正文}。"""
    result: dict[str, str] = {}
    lines = text.splitlines()
    starts: list[int] = []
    for index, line in enumerate(lines):
        if line.startswith("# ") and not line.startswith("# 网络安全"):
            starts.append(index)
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        result[lines[start]] = "\n".join(lines[start:end])
    return result


def subsections(block: str, level: int) -> dict[str, str]:
    """按指定级标题切分块，返回 {标题行: 正文}。"""
    marker = "#" * level + " "
    result: dict[str, str] = {}
    lines = block.splitlines()
    starts: list[int] = []
    for index, line in enumerate(lines):
        if line.startswith(marker) and not line.startswith("#" * (level + 1)):
            starts.append(index)
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        result[lines[start]] = "\n".join(lines[start:end])
    return result


def table_with(block: str, key: str) -> tuple[list[str], list[list[str]]]:
    for header, rows in parse_tables(block):
        if any(key in cell for cell in header):
            return header, rows
    fail(f"block 中缺少含“{key}”的表格")


def split_label(cell: str, pattern: re.Pattern) -> tuple[str, str]:
    """把“REQ-SOC-INS-01 立即执行常规全面巡检”拆成编号与业务名称。"""
    match = pattern.search(cell)
    if not match:
        fail(f"单元格缺少编号：{cell}")
    name = cell[match.end():].strip(" 　:：-—")
    return match.group(0), name


def demote_headings(block: str, levels: int = 1) -> str:
    """源文档小节标题整体降级，保留其编号以便追溯，同时不与本文标题争同级。

    附录与共享契约降一级；场景小节的设计边界说明要落在需求条目之下，因此降两级。
    """
    for _ in range(max(1, levels)):
        block = re.sub(r"^(#{2,5}) ", r"#\1 ", block, flags=re.MULTILINE)
    return block


def drop_table_with(block: str, key: str) -> str:
    """从原始小节中剔除已投影为事实源的那张表，保留其余业务说明与设计边界。

    否则同一张表会在转换表和“源文档原始表”中出现两次，而转换表只显示编号。
    """
    lines = block.splitlines()
    output: list[str] = []
    index = 0
    dropped = False
    while index < len(lines):
        line = lines[index]
        is_table_start = (not dropped and line.strip().startswith("|")
                          and index + 1 < len(lines) and is_separator(lines[index + 1])
                          and any(key in cell for cell in split_row(line)))
        if is_table_start:
            dropped = True
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                index += 1
            continue
        output.append(line)
        index += 1
    if not dropped:
        fail(f"原始小节中缺少含“{key}”的表格")
    return "\n".join(output).strip()


def build_maps(ac_tables: dict[str, tuple[list[str], list[list[str]]]]) -> tuple[dict[str, str], dict[str, str], dict[str, list[str]]]:
    req_map: dict[str, str] = {}
    ac_map: dict[str, str] = {}
    ac_reqs: dict[str, list[str]] = {}
    scenario_index = {pair[0]: position for position, pair in enumerate(SCENARIO_ORDER)}
    for scenario, _ in SCENARIO_ORDER:
        _, ac_rows = ac_tables[scenario]
        for row in ac_rows:
            if len(row) < 2:
                fail(f"{scenario} AC 行缺列：{row}")
            ac_id = AC_ID_RE.search(row[0])
            req_cell = row[1]
            if not ac_id:
                fail(f"{scenario} AC 行缺少 AC 编号：{row[0]}")
            ac_map[ac_id.group(0)] = ""
            ac_reqs[ac_id.group(0)] = REQ_ID_RE.findall(req_cell)
            for req_id in ac_reqs[ac_id.group(0)]:
                req_map.setdefault(req_id, "")
    req_ids = sorted(req_map, key=lambda value: scenario_index[value.split("-")[2]])
    for index, req_id in enumerate(req_ids, start=1):
        req_map[req_id] = f"REQ-{index:03d}"
    def ac_sort_key(value: str) -> tuple[int, int]:
        tail = value.rsplit("-", 1)[1]
        number = int(tail) if tail.isdigit() else 999
        return (scenario_index[value.split("-")[2]], number)
    ac_ids = sorted(ac_map, key=ac_sort_key)
    for index, ac_id in enumerate(ac_ids, start=1):
        ac_map[ac_id] = f"AC-{index:03d}"
    return req_map, ac_map, ac_reqs


def map_ids(text: str, mapping: dict[str, str]) -> str:
    for source, target in sorted(mapping.items(), key=lambda pair: -len(pair[0])):
        text = text.replace(source, target)
    return text


def yaml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True, help="仓库根目录")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="显式覆盖既有输出；默认拒绝覆盖，避免把维护者新增内容静默丢弃",
    )
    args = parser.parse_args()
    repo = args.repo.resolve()
    targets = [
        repo / "agents" / "security-operations-expert" / "spec" / name
        for name in ("requirements.md", "tasks.yaml", "acceptance.yaml")
    ]
    targets.append(repo / "agents" / "security-operations-expert" / "eval" / "methods.yaml")
    targets.extend(
        repo / "agents" / "security-operations-expert" / "eval" / "fixtures" / f"{scenario.lower()}.md"
        for scenario, _ in SCENARIO_ORDER
    )
    targets.append(repo / "agents" / "security-operations-expert" / "eval" / "pending" / "scenario-design.pending.jsonl")
    targets.append(
        repo / "evolution" / "experiments" / "EXP-security-operations-expert-001"
        / "evaluation" / "evidence" / "v02-spec-ingestion.json"
    )
    existing = [path for path in targets if path.is_file() or path.is_symlink()]
    if existing and not args.refresh:
        fail(
            "输出已存在，默认拒绝覆盖（防止静默丢弃维护者新增内容）；确认要重新生成时显式加 --refresh："
            + "、".join(str(path.relative_to(repo)) for path in existing)
        )
    source = repo / "evolution" / "history" / "imports" / "security-operations-expert-2026-09-17" / SOURCE_NAME
    if not source.is_file() or source.is_symlink():
        fail(f"源文档缺失或不安全：{source}")
    text = source.read_text(encoding="utf-8")
    digest = sha256_bytes(source.read_bytes())
    chapter_map = chapters(text)

    def chapter(title_fragment: str) -> str:
        for title, body in chapter_map.items():
            if title_fragment in title:
                return body
        fail(f"缺少章节：{title_fragment}")

    # ---- 场景表抽取 ----
    req_tables: dict[str, tuple[list[str], list[list[str]]]] = {}
    task_tables: dict[str, tuple[list[str], list[list[str]]]] = {}
    ac_tables: dict[str, tuple[list[str], list[list[str]]]] = {}
    d_tables: dict[str, list[list[str]]] = {}
    fixture_blocks: dict[str, str] = {}
    scenario_meta: dict[str, dict[str, str]] = {}
    for scenario, title in SCENARIO_ORDER:
        body = chapter(title)
        sub = subsections(body, 2)
        req_block = next((value for key, value in sub.items() if "需求定义" in key), None)
        task_block = next((value for key, value in sub.items() if "任务定义" in key), None)
        data_block = next((value for key, value in sub.items() if "测试数据" in key), None)
        ac_block = next((value for key, value in sub.items() if "验收标准" in key), None)
        if not req_block or not task_block or not data_block or not ac_block:
            fail(f"{scenario} 缺少需求/任务/测试数据/验收标准块")
        req_tables[scenario] = table_with(req_block, "需求")
        task_tables[scenario] = table_with(task_block, "任务编号")
        ac_tables[scenario] = table_with(ac_block, "验收编号")
        d_rows: list[list[str]] = []
        for header, rows in parse_tables(data_block):
            if any("设计样例" in cell for cell in header):
                d_rows.extend(rows)
        d_tables[scenario] = d_rows
        fixture_parts: list[str] = []
        for heading, block in subsections(data_block, 3).items():
            if "预置" in heading or "快照" in heading:
                fixture_parts.append(block)
        if not fixture_parts:
            fail(f"{scenario} 源文档缺少预置/快照小节")
        fixture_blocks[scenario] = "\n\n".join(fixture_parts)
        scenario_meta[scenario] = {
            "req_block": req_block,
            "title": title,
        }

    req_names: dict[str, str] = {}
    for scenario, _ in SCENARIO_ORDER:
        for row in req_tables[scenario][1]:
            source, name = split_label(row[0], REQ_ID_RE)
            req_names[source] = name

    req_map, ac_map, ac_reqs = build_maps(ac_tables)

    # ---- requirements.md ----
    shared = chapter("2. 统一定义与评测契约")
    shared_subs = subsections(shared, 2)
    shared_parts = [
        body.strip()
        for key, body in shared_subs.items()
        if key.startswith(("## 2.1", "## 2.2", "## 2.3", "## 2.4", "## 2.6", "## 2.7", "## 2.8", "## 2.9", "## 2.10"))
    ]
    shared_text = demote_headings("\n\n".join(shared_parts))

    req_sections: list[str] = []
    for scenario, _ in SCENARIO_ORDER:
        header, rows = req_tables[scenario]
        index_rows = []
        detail_blocks = []
        for row in rows:
            if len(row) < 8:
                fail(f"{scenario} 需求行缺列：{row}")
            req_source, req_name = split_label(row[0], REQ_ID_RE)
            mapped = req_map[req_source]
            hard_gate = map_ids(row[7], ac_map)
            index_rows.append([mapped, req_name, hard_gate, req_source])
            # 长文本用段落，不放单元格：宽表只适合索引，读者要在条目里看清每个字段。
            detail_blocks.append(
                "\n".join(
                    [
                        f"### {mapped} {req_name}",
                        "",
                        f"**来源：**{row[1]}",
                        "",
                        f"**触发：**{row[2]}",
                        "",
                        f"**目标任务：**{row[3]}",
                        "",
                        f"**最小输入：**{row[4]}",
                        "",
                        f"**输出/动作：**{row[5]}",
                        "",
                        f"**非目标/禁止：**{row[6]}",
                        "",
                        f"**硬门禁：**{hard_gate}",
                    ]
                )
            )
        index_lines = [
            "| 编号 | 需求名称 | 硬门禁 | 源编号 |",
            "|---|---|---|---|",
        ]
        index_lines.extend("| " + " | ".join(row) + " |" for row in index_rows)
        # 原始需求表已逐列投影到索引表与下面的条目；这里只保留该小节的业务说明与设计边界。
        remainder = demote_headings(drop_table_with(scenario_meta[scenario]["req_block"], "需求"), levels=2)
        req_sections.append(
            "\n".join(
                [
                    f"## {scenario_meta[scenario]['title'].split('. ', 1)[1]} 需求定义",
                    "",
                    "\n".join(index_lines),
                    "",
                    "\n\n".join(detail_blocks),
                    "",
                    "源文档设计边界、动作族与归并说明（原始需求表已逐列投影到上表，不在此重复）：",
                    "",
                    remainder,
                ]
            )
        )

    semantic = chapter("附录 D")
    semantic_parts = [
        semantic.split("## D.1", 1)[0].strip(),
    ]
    for heading, body in subsections(semantic, 2).items():
        if heading.startswith("## D.1") or heading.startswith("## D.2") or heading.startswith("## D.3") or heading.startswith("## D.4"):
            semantic_parts.append(body.strip())
    semantic_text = "\n\n".join(part for part in semantic_parts if part)

    requirements = "\n\n".join(
        [
            "# security-operations-expert 需求定义",
            "",
            f"> 事实源：本文件。来源文档：{SOURCE_NAME}（V0.2，2026-09-17），归档于 evolution/history/imports/security-operations-expert-2026-09-17/。",
            f"> 来源摘要：原始业务文件 SHA-256：051501599389c2f797c9f8ff493e6b2c704b55c89878e921fee4f791e9e95776；归档副本按本仓库术语统一后保存，副本 SHA-256：{digest}。",
            "> 确认状态：待交付负责人确认。REQ-xxx/AC-xxx 为仓库编号，REQ-SOC-*/AC-SOC-* 为源文档编号（source_id 迁移映射）；两者不并存为可编辑事实源。",
            "> 各场景需求表的「需求名称」取自源文档需求表首列的业务名称；转换后不再只剩编号。",
            "> 术语：本仓库统一用「预置/预置场景」表达 fixture（测试环境、数据与状态的固定预置）；归档源文（evolution/history/imports/）保留其原有用词，语义一致。",
            MAINTENANCE_NOTE,
            "",
            "## 统一定义与评测契约",
            "",
            "> 以下各节为源文档第 2 章统一契约的原文；2.5 的机器契约由仓库交付契约替代。",
            "",
            shared_text,
            "",
            "> 源文档 2.5（正式 Case 与结果契约）的机器契约以本仓库交付契约为准（.agents/skills/baseline-eval/references/delivery-contract.md），不在此重复导入。",
            "",
            "\n\n".join(req_sections),
            "",
            "## 附录：常见运营表达与五类业务的语义覆盖映射",
            "",
            semantic_text,
        ]
    )
    (repo / "agents" / "security-operations-expert" / "spec").mkdir(parents=True, exist_ok=True)
    (repo / "agents" / "security-operations-expert" / "spec" / "requirements.md").write_text(requirements + "\n", encoding="utf-8")

    # ---- tasks.yaml ----
    task_lines = [
        "# 维护方式：本文件首次由 evaluation/tools/ingest_v02_spec.py 从源文档生成，此后由维护者维护；",
        "# 重新生成须显式 --refresh，会覆盖维护者新增内容。字段含义：",
        "#   goal 完成什么任务（取自关联需求的目标任务）；output 交付什么（取自任务的最终交付列）；",
        "#   process 怎样做；stop_condition 达到什么状态就结束。",
        'schema_version: "1.0"',
        "tasks:",
    ]
    for scenario, _ in SCENARIO_ORDER:
        header, rows = task_tables[scenario]
        for row in rows:
            if len(row) < 5:
                fail(f"{scenario} 任务行缺列：{row}")
            task_match = TASK_ID_RE.search(row[0])
            if not task_match:
                fail(f"{scenario} 任务行缺编号：{row[0]}")
            task_source = task_match.group(0)
            req_source = REQ_ID_RE.search(row[1])
            if not req_source:
                fail(f"{scenario} 任务行缺关联需求：{row[1]}")
            task_id = "task-soc-" + task_source.rsplit("-", 2)[1].lower() + "-" + task_source.rsplit("-", 1)[1]
            req_id = req_map[req_source.group(0)]
            req_goal = ""
            req_min_input = ""
            for req_row in req_tables[scenario][1]:
                if len(req_row) >= 5 and req_source.group(0) in req_row[0]:
                    req_goal = req_row[3]
                    req_min_input = req_row[4]
                    break
            if not req_goal:
                fail(f"{task_source} 关联需求缺少目标任务：{req_source.group(0)}")
            task_lines.append(
                "\n".join(
                    [
                        # 面向人的标签用"编号＋业务名称"：任务表本身没有名称列，取关联需求的名称。
                        f"  # {task_id}：{req_names.get(req_source.group(0), req_id)}",
                        f"  - task_id: {yaml_quote(task_id)}",
                        f"    source_id: {yaml_quote(task_source)}",
                        f"    related_req: {yaml_quote(req_id)}",
                        f"    related_req_source: {yaml_quote(req_source.group(0))}",
                        # goal 回答“完成什么任务”，取自关联需求的目标任务；
                        # output 回答“交付什么”，取自本任务的最终交付列。两者含义不同，不能写成同一段文字。
                        f"    goal: {yaml_quote(req_goal)}",
                        f"    input_contract: {yaml_quote(req_min_input or '认证主体、数据范围、目录/知识及工具版本已明确')}",
                        f"    process: {yaml_quote(row[2])}",
                        f"    output: {yaml_quote(row[3])}",
                        f"    stop_condition: {yaml_quote(row[4])}",
                    ]
                )
            )
    (repo / "agents" / "security-operations-expert" / "spec" / "tasks.yaml").write_text("\n".join(task_lines) + "\n", encoding="utf-8")

    # ---- acceptance.yaml ----
    ac_lines = [
        SOURCE_LEGEND.rstrip(),
        "#",
        "# 通用判定原则：每条 blocking 条目都必须满足；缺少必要证据时不算通过。",
        "# 该原则对全部条目一致，因此不在每条中重复；条目只写该条特有的可观察结果与失败条件。",
        "# 阈值与允许结果的事实源是本文件；评估实现见 eval/methods.yaml。",
        "#",
        "# " + MAINTENANCE_NOTE,
        'schema_version: "1.0"',
        "acceptance:",
    ]
    for scenario, _ in SCENARIO_ORDER:
        header, rows = ac_tables[scenario]
        for row in rows:
            if len(row) < 6:
                fail(f"{scenario} 验收行缺列：{row}")
            ac_match = AC_ID_RE.search(row[0])
            if not ac_match:
                fail(f"{scenario} 验收行缺编号：{row[0]}")
            ac_source = ac_match.group(0)
            ac_id = ac_map[ac_source]
            req_ids = [req_map[item] for item in REQ_ID_RE.findall(row[1])]
            if not req_ids:
                fail(f"{ac_source} 未关联任何需求")
            gate = "blocking" if row[3].strip() == "硬门禁" else "scored"
            if row[3].strip() not in ("硬门禁", "质量目标"):
                fail(f"{ac_source} 判定作用未知：{row[3]}")
            criterion = row[4]
            for tail in GENERIC_CRITERION_TAILS:
                criterion = criterion.replace(tail, "")
            criterion = criterion.strip()
            if not criterion:
                fail(f"{ac_source} 剥离通用说明后无可判定内容")
            ac_lines.append(
                "\n".join(
                    [
                        f"  - id: {yaml_quote(ac_id)}",
                        f"    source_id: {yaml_quote(ac_source)}",
                        f"    requirement_ids: [{', '.join(yaml_quote(item) for item in req_ids)}]",
                        f"    gate: {yaml_quote(gate)}",
                        f"    criterion: {yaml_quote(criterion)}",
                        f"    basis: {yaml_quote(row[5])}",
                    ]
                )
            )
    (repo / "agents" / "security-operations-expert" / "spec" / "acceptance.yaml").write_text("\n".join(ac_lines) + "\n", encoding="utf-8")

    # ---- methods.yaml（附录 B 逐 AC 登记） ----
    appendix_b = chapter("附录 B")
    method_header, method_rows = table_with(appendix_b, "正式范围选择器")
    method_lines = [
        SOURCE_LEGEND.rstrip(),
        "#",
        "# 字段含义：selector 选哪些 Case；grader 由谁、按什么方式判定；",
        "# trial_scheme 每个 Case 重复运行几次；aggregation 如何把多次结果合成一条判定。",
        "# 判定阈值只在 spec/acceptance.yaml 维护，本文件只引用 AC 编号，不复制阈值。",
        "# 人工判定、规则脚本与模型评分器必须分别标明，未实现的判定方式不写成现有能力。",
        "#",
        "# " + MAINTENANCE_NOTE,
        'schema_version: "1.0"',
        "methods:",
    ]
    for row in method_rows:
        if len(row) < 6:
            fail(f"附录 B 行缺列：{row}")
        ac_match = AC_ID_RE.search(row[0])
        if not ac_match:
            fail(f"附录 B 行缺 AC：{row[0]}")
        ac_source = ac_match.group(0)
        ac_id = ac_map[ac_source]
        method_id = "m-" + ac_source.split("-", 2)[2].lower()
        selector = map_ids(row[1], ac_map)
        scored = ac_source.endswith("-Q01")
        if scored:
            grader = (
                "人工评分：按四个适用维度各自打分并保存原始分，score 取适用维度的最低值，不用均值掩盖短板；"
                f"原始评分与依据记入 evidence_ref，判定阈值见 spec/acceptance.yaml 的 {ac_id}。"
            )
            trial_scheme = "每个 Case 默认运行 1 次；结果出现波动或评测计划要求一致性时增加次数；最终次数在冻结候选基线前确认。"
            aggregation = (
                f"先按试次与各维度取最低等级，再对照 spec/acceptance.yaml 中 {ac_id}（源编号 {ac_source}）的 3/4 阈值判定通过或失败；"
                "质量分不能抵消任何硬门禁失败。"
            )
        else:
            grader = (
                "人工判定为主，必要时用确定性检查复核：对照 spec/acceptance.yaml 中 "
                f"{ac_id}（源编号 {ac_source}）列出的可观察结果与禁止结果逐项核对；"
                "原始对照、工具回执与证据位置记入 evidence_ref。"
            )
            trial_scheme = "每个 Case 默认运行 1 次；高风险动作或需要判断一致性时运行 3 次；最终次数在冻结候选基线前确认。"
            aggregation = (
                "该 blocking Case 在本次评测计划规定的每次运行中都必须通过；缺少必要证据时不算通过；"
                "多个问题同时出现时，按 agent-engineering-spec 锁定提交的 04_评估测试与回归规范（G2）所列优先级处理。"
            )
        method_lines.append(
            "\n".join(
                [
                    f"  - id: {yaml_quote(method_id)}",
                    f"    source_id: {yaml_quote(ac_source)}",
                    f"    acceptance_ids: [{yaml_quote(ac_id)}]",
                    f"    selector: {yaml_quote(selector)}",
                    f"    design_points: {yaml_quote(row[2])}",
                    f"    grader: {yaml_quote(grader)}",
                    f"    trial_scheme: {yaml_quote(trial_scheme)}",
                    f"    aggregation: {yaml_quote(aggregation)}",
                ]
            )
        )
    (repo / "agents" / "security-operations-expert" / "eval").mkdir(parents=True, exist_ok=True)
    (repo / "agents" / "security-operations-expert" / "eval" / "methods.yaml").write_text("\n".join(method_lines) + "\n", encoding="utf-8")

    # ---- fixtures/*.md ----
    fixtures_dir = repo / "agents" / "security-operations-expert" / "eval" / "fixtures"
    fixtures_dir.mkdir(parents=True, exist_ok=True)
    for scenario, _ in SCENARIO_ORDER:
        block = fixture_blocks[scenario]
        fixture_text = "\n".join(
            [
                f"# {scenario_meta[scenario]['title'].split('. ', 1)[1]} 测试预置（合成）",
                "",
                f"> 来源文档：{SOURCE_NAME}（V0.2；归档副本 SHA-256：{digest}，原始业务文件摘要见需求事实源）。"
                "全部为测试预置，不是生产事实；金标准仅由评估端持有，不得注入被测智能体提示词。",
                "> 维护方式：本文件首次由 `evaluation/tools/ingest_v02_spec.py` 从源文档生成，此后由维护者维护（含补充输入映射与新增分支）；重新生成须显式 `--refresh`，会覆盖维护者新增内容。",
                "> 术语：本仓库统一用「预置/预置场景」表达 fixture（测试环境、数据与状态的固定预置）；归档源文（evolution/history/imports/）保留其原有用词，语义一致。",
                "",
                block.strip(),
            ]
        )
        (fixtures_dir / f"{scenario.lower()}.md").write_text(fixture_text + "\n", encoding="utf-8")

    # ---- pending/scenario-design.pending.jsonl（115 条 D-*） ----
    pending_dir = repo / "agents" / "security-operations-expert" / "eval" / "pending"
    pending_dir.mkdir(parents=True, exist_ok=True)
    entries: list[dict] = []
    for scenario, _ in SCENARIO_ORDER:
        for row in d_tables[scenario]:
            if len(row) < 7:
                fail(f"{scenario} 设计样例行缺列：{row}")
            d_id = row[0]
            ac_match = AC_ID_RE.search(row[1])
            if not ac_match:
                fail(f"{d_id} 缺关联 AC：{row[1]}")
            ac_source = ac_match.group(0)
            ac_id = ac_map[ac_source]
            requirement_ids = sorted({req_map[item] for item in ac_reqs.get(ac_source, [])})
            if not requirement_ids:
                fail(f"{d_id} 关联 AC 无需求映射")
            scene_intent, separator, variant = row[2].partition("；")
            if not separator or not variant.strip():
                fail(f"{d_id} 场景/意图/变体无法解析：{row[2]}")
            scenario_id, slash, intent_id = scene_intent.partition("/")
            if not slash or not intent_id.strip():
                fail(f"{d_id} 场景/意图无法解析：{row[2]}")
            check_cell = row[6]
            parts = [part.strip() for part in check_cell.split("；") if part.strip()]
            if not parts or parts[-1] not in ("blocking", "scored"):
                fail(f"{d_id} 检查与门禁缺 blocking/scored：{row[6]}")
            gate = parts[-1]
            checks = parts[:-1]
            entries.append(
                {
                    "id": d_id,
                    "requirement_ids": requirement_ids,
                    "acceptance_id": ac_id,
                    "scenario_id": scenario_id.strip(),
                    "intent_id": intent_id.strip(),
                    "tags": [],
                    "variant_types": [variant.strip()],
                    "input": row[3],
                    "context": {
                        "fixture_state": row[4],
                        "design": {
                            "source_document": SOURCE_NAME,
                            "source_sha256": digest,
                            "status": "pending_domain_review",
                        },
                    },
                    "expected_behavior": [row[5]],
                    "check": checks,
                    "gate": gate,
                    "review_status": "pending",
                    "acceptance_mapping_status": "pending",
                    "source_id": d_id,
                }
            )
    if len(entries) != 115:
        fail(f"设计样例数量应为 115，实际 {len(entries)}")
    pending_path = pending_dir / "scenario-design.pending.jsonl"
    pending_path.write_text(
        "".join(json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for entry in entries),
        encoding="utf-8",
    )

    # ---- 摄入证据 ----
    evidence_dir = repo / "evolution" / "experiments" / "EXP-security-operations-expert-001" / "evaluation" / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence = {
        "schema_version": "1.0",
        "generated_at": utc_now(),
        "source": {
            "name": SOURCE_NAME,
            "sha256": digest,
            "archived_path": f"evolution/history/imports/security-operations-expert-2026-09-17/{SOURCE_NAME}",
        },
        "counts": {
            "requirements": len(req_map),
            "tasks": sum(len(task_tables[scenario][1]) for scenario, _ in SCENARIO_ORDER),
            "acceptance": len(ac_map),
            "design_samples": len(entries),
        },
        "id_maps": {
            "requirements": {source: target for source, target in sorted(req_map.items())},
            "acceptance": {source: target for source, target in sorted(ac_map.items())},
        },
        "status": "design ingested; domain confirmation and per-item review still pending",
    }
    evidence_path = evidence_dir / "v02-spec-ingestion.json"
    evidence_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"requirements: {len(req_map)} tasks: {evidence['counts']['tasks']} acceptance: {len(ac_map)} design_samples: {len(entries)}")
    print(f"evidence: {evidence_path}")


if __name__ == "__main__":
    main()
