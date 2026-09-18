#!/usr/bin/env python3
"""从候选 Harness 的受控事实源派生 MCP 桩工具清单。

输入（唯一事实源，均为候选资产）：
- `managed/mcp-servers.yaml`：三个 MCP 服务名与传输方式；
- `managed/mcp-tool-name-map.json`：超过 64 字符的工具公开名映射；
- `managed/role-tool-matrix.yaml`：角色工具矩阵与父智能体直连工具集合。

输出：`stub-mcp-streamable-http.mjs` 可直接消费的工具清单 JSON。清单只包含
Harness 实际引用的工具名，因此装载核验能真实触发 DSH 的公开名派生与工具注册
路径。脚本同时充当一致性检查：任一被引用的 MCP 工具无法解析到 `服务名 + 原始名`
即非零退出。

边界：本脚本只做静态派生与一致性检查，不证明 DSH 装载成功，也不构成业务验收。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

import yaml


def public_tool_name(server: str, raw: str) -> str:
    """与 DSH 0.1.5-rc.2 及仓库校验器一致的工具公开名算法。"""
    qualified = f"mcp__{server}__{raw}"
    normalized = re.sub(r"[^A-Za-z0-9_-]", "_", qualified)
    if normalized == qualified and len(normalized) <= 64:
        return normalized
    digest = hashlib.sha256((server + "\x00" + raw).encode("utf-8")).hexdigest()[:12]
    return normalized[:51] + "_" + digest


def load_yaml(path: Path) -> object:
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def referenced_tool_names(matrix: dict, errors: list[str]) -> list[str]:
    names: list[str] = []
    for role, entry in (matrix.get("roles") or {}).items():
        tools = entry.get("tools")
        if tools is None:
            errors.append(f"role {role} 缺少 tools 字段")
            continue
        if not isinstance(tools, list):
            errors.append(f"role {role} 的 tools 不是列表")
            continue
        names.extend(tool for tool in tools if isinstance(tool, str) and tool.startswith("mcp__"))
    direct = matrix.get("parent_direct_tools") or {}
    for key in ("allow", "deny_by_guard"):
        values = direct.get(key) or []
        if not isinstance(values, list):
            errors.append(f"parent_direct_tools.{key} 不是列表")
            continue
        names.extend(value for value in values if isinstance(value, str) and value.startswith("mcp__"))
    return names


def derive(candidate: Path) -> tuple[dict, list[str]]:
    errors: list[str] = []
    servers_doc = load_yaml(candidate / "managed" / "mcp-servers.yaml") or {}
    server_names = [entry["server_name"] for entry in (servers_doc.get("servers") or [])]
    if not server_names:
        return {}, ["mcp-servers.yaml 未声明任何 MCP 服务"]

    name_map = json.loads((candidate / "managed" / "mcp-tool-name-map.json").read_text(encoding="utf-8"))
    by_public = {}
    for entry in name_map.get("mappings") or []:
        by_public[entry["dsh_public_name"]] = (entry["server_name"], entry["raw_name"])

    matrix = load_yaml(candidate / "managed" / "role-tool-matrix.yaml") or {}
    inventory: dict[str, list[str]] = {name: [] for name in server_names}
    unresolved: list[str] = []
    for reference in sorted(set(referenced_tool_names(matrix, errors))):
        # 公开名映射是权威事实源：64 字符的公开名本身也满足"≤64 字符原样保留"，
        # 不能靠长度或算法反推，必须先查映射再回退到"引用即原始名"的解释。
        raw = None
        server = None
        mapped = by_public.get(reference)
        if mapped is not None:
            server, raw = mapped
        else:
            server = max((name for name in server_names if reference.startswith(f"mcp__{name}__")), key=len, default=None)
            if server is not None:
                remainder = reference[len(f"mcp__{server}__"):]
                if public_tool_name(server, remainder) == reference:
                    raw = remainder
        if raw is None:
            unresolved.append(reference)
            continue
        if raw not in inventory[server]:
            inventory[server].append(raw)
    if unresolved:
        errors.append("以下被引用的 MCP 工具无法解析为服务名与原始工具名：" + "、".join(unresolved))

    document = {
        "schema_version": "1.0",
        "generated_from": {
            "mcp_servers": "managed/mcp-servers.yaml",
            "tool_name_map": "managed/mcp-tool-name-map.json",
            "role_tool_matrix": "managed/role-tool-matrix.yaml",
        },
        "servers": {
            name: {
                "path": f"/mcp/{name}",
                "tools": [{"name": tool} for tool in sorted(inventory[name])],
            }
            for name in server_names
        },
    }
    return document, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    default_candidate = (
        Path(__file__).resolve().parents[2] / "candidate" / "dsh"
    )
    parser.add_argument("--candidate", type=Path, default=default_candidate)
    parser.add_argument("--out", type=Path, help="输出路径；省略则写到标准输出")
    parser.add_argument("--check", action="store_true", help="只做一致性检查，不输出清单")
    args = parser.parse_args()

    if not (args.candidate / "managed" / "role-tool-matrix.yaml").is_file():
        print(f"候选目录缺少受控事实源：{args.candidate}", file=sys.stderr)
        return 2

    document, errors = derive(args.candidate)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1

    counts = {name: len(entry["tools"]) for name, entry in document["servers"].items()}
    if args.check:
        print(json.dumps({"checked": True, "tool_counts": counts}, ensure_ascii=False, sort_keys=True))
        return 0
    text = json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(json.dumps({"written": str(args.out), "tool_counts": counts}, ensure_ascii=False, sort_keys=True))
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
