#!/usr/bin/env python3
"""校验 EXP-003 的精确工具合同，并可只读比对实时 MCP tools/list。"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml


EXPERIMENT = Path(__file__).resolve().parents[2]
CANDIDATE = EXPERIMENT / "candidate" / "dsh"
MANAGED = CANDIDATE / "managed"
MAX_RESPONSE_BYTES = 32 * 1024 * 1024
MCP_NAME = re.compile(r"mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+")


class ContractError(RuntimeError):
    pass


class ProfileLoader(yaml.SafeLoader):
    pass


ProfileLoader.add_constructor(
    "tag:yaml.org,2002:js",
    lambda loader, node: loader.construct_scalar(node),
)


def load_yaml(path: Path, loader: type[yaml.SafeLoader] = yaml.SafeLoader) -> dict | list:
    with path.open(encoding="utf-8") as stream:
        return yaml.load(stream, Loader=loader)


def require_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise ContractError(f"{label} 必须是非空字符串列表")
    if len(value) != len(set(value)):
        raise ContractError(f"{label} 包含重复项")
    return value


def matrix_routes(matrix: dict) -> dict[str, list[str]]:
    roles = matrix.get("roles")
    direct = matrix.get("parent_direct_tools")
    if not isinstance(roles, dict) or set(roles) != {"fault-analysis", "response-planning"}:
        raise ContractError("角色矩阵必须且只能声明故障分析与响应规划")
    if not isinstance(direct, dict) or not isinstance(direct.get("mcp"), dict):
        raise ContractError("角色矩阵缺少主 Agent MCP 声明")
    if roles["response-planning"].get("tools") != []:
        raise ContractError("响应规划必须保持零工具")
    routes = {
        "workspace": require_list(direct.get("workspace"), "workspace"),
        "policy": require_list(direct["mcp"].get("policy"), "policy"),
        "inspection": require_list(direct["mcp"].get("inspection"), "inspection"),
        "faultAnalysis": require_list(roles["fault-analysis"].get("tools"), "fault-analysis"),
        "delegates": require_list(direct.get("delegates"), "delegates"),
        "denied": require_list(matrix.get("denied_mcp_tools"), "denied_mcp_tools"),
    }
    expected_delegates = [entry.get("tool_name") for entry in roles.values()]
    if routes["delegates"] != expected_delegates:
        raise ContractError("角色 tool_name 与主 Agent delegate 列表不一致")
    root = routes["workspace"] + routes["policy"] + routes["inspection"] + routes["delegates"]
    if len(root) != len(set(root)):
        raise ContractError("主 Agent 工具集合包含重复项")
    allowed = routes["policy"] + routes["inspection"] + routes["faultAnalysis"]
    if len(allowed) != len(set(allowed)) or set(allowed) & set(routes["denied"]):
        raise ContractError("MCP 允许集合存在重复项或与拒绝集合重叠")
    for name in allowed + routes["denied"]:
        if not MCP_NAME.fullmatch(name) or len(name) > 64:
            raise ContractError(f"MCP 工具名不合法或超过 64 字符：{name}")
    return routes


def profile_contract() -> tuple[set[str], dict[str, list[str]]]:
    profile = load_yaml(MANAGED / "security-operations-expert.patch.yml", ProfileLoader)
    if not isinstance(profile, list):
        raise ContractError("DSH Profile patch 必须是列表")
    inserted = [item for entry in profile if isinstance(entry, dict) for item in entry.get("insert", [])]
    servers: set[str] = set()
    delegates: dict[str, list[str]] = {}
    for item in inserted:
        if not isinstance(item, dict) or not isinstance(item.get("config"), dict):
            continue
        config = item["config"]
        if item.get("name") == "@deepseek-ai/dsh-mcp-client":
            server = config.get("serverName")
            if not isinstance(server, str) or server in servers:
                raise ContractError("Profile MCP serverName 缺失或重复")
            servers.add(server)
        if item.get("name") == "@deepseek-ai/dsh-tool-subagent":
            tool = config.get("toolName")
            allowed = (config.get("toolFilter") or {}).get("allow")
            if not isinstance(tool, str) or tool in delegates or not isinstance(allowed, list):
                raise ContractError("Profile delegate 声明无效或重复")
            delegates[tool] = allowed
    return servers, delegates


def guard_contract() -> dict:
    guard = MANAGED / "security-operations-guard.mjs"
    source = (
        "import { pathToFileURL } from 'node:url';"
        "const m=await import(pathToFileURL(process.argv[1]).href);"
        "process.stdout.write(JSON.stringify({routes:m.TOOL_ROUTES,visible:[0,1,2].map(m.visibleToolsForDepth)}));"
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", source, str(guard)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        raise ContractError("无法加载 Guard 工具合同")
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ContractError("Guard 未导出有效工具合同") from error
    if not isinstance(value, dict):
        raise ContractError("Guard 工具合同必须是对象")
    return value


def referenced_mcp_names() -> set[str]:
    names: set[str] = set()
    for path in CANDIDATE.rglob("*"):
        if path.is_file() and path.name != ".env":
            try:
                names.update(MCP_NAME.findall(path.read_text(encoding="utf-8")))
            except UnicodeDecodeError:
                continue
    return names


def verify_static() -> dict:
    matrix = load_yaml(MANAGED / "role-tool-matrix.yaml")
    if not isinstance(matrix, dict):
        raise ContractError("角色矩阵必须是对象")
    routes = matrix_routes(matrix)

    server_doc = load_yaml(MANAGED / "mcp-servers.yaml")
    declared_servers = {entry.get("server_name") for entry in server_doc.get("servers", [])}
    if declared_servers != {"sec-ops", "inspection"}:
        raise ContractError("MCP server 声明必须且只能包含 sec-ops 与 inspection")

    profile_servers, profile_delegates = profile_contract()
    if profile_servers != declared_servers:
        raise ContractError("Profile 与 mcp-servers.yaml 的服务集合不一致")

    expected_delegates = {
        matrix["roles"][role]["tool_name"]: matrix["roles"][role]["tools"]
        for role in matrix["roles"]
    }
    if profile_delegates != expected_delegates:
        raise ContractError("Profile toolFilter 与角色矩阵不一致")
    guard = guard_contract()
    if guard.get("routes") != routes:
        raise ContractError("Guard TOOL_ROUTES 与角色矩阵不一致")
    expected_visible = [
        routes["workspace"] + routes["policy"] + routes["inspection"] + routes["delegates"],
        routes["faultAnalysis"],
        [],
    ]
    if guard.get("visible") != expected_visible:
        raise ContractError("Guard 的父子 Agent 可见工具集合与角色矩阵不一致")

    if (MANAGED / "mcp-tool-name-map.json").exists():
        raise ContractError("EXP-003 不应保留 MCP 工具别名映射")
    expected_names = set(routes["policy"] + routes["inspection"] + routes["faultAnalysis"] + routes["denied"])
    unknown_names = referenced_mcp_names() - expected_names
    if unknown_names:
        raise ContractError("候选资产引用了矩阵外 MCP 工具：" + "、".join(sorted(unknown_names)))

    return {
        "status": "ok",
        "servers": len(declared_servers),
        "allowed_tools": len(routes["policy"] + routes["inspection"] + routes["faultAnalysis"]),
        "denied_tools": len(routes["denied"]),
        "delegates": len(routes["delegates"]),
        "parent_visible_tools": len(expected_visible[0]),
        "fault_visible_tools": len(expected_visible[1]),
    }


def decode_rpc(body: bytes, content_type: str) -> dict:
    if len(body) > MAX_RESPONSE_BYTES:
        raise ContractError("MCP 响应超过大小上限")
    text = body.decode("utf-8")
    if "text/event-stream" not in content_type.lower():
        value = json.loads(text)
        if not isinstance(value, dict):
            raise ContractError("MCP JSON-RPC 响应不是对象")
        return value

    payloads: list[str] = []
    current: list[str] = []
    for line in text.splitlines() + [""]:
        if not line:
            if current:
                payloads.append("\n".join(current))
                current = []
            continue
        if line.startswith("data:"):
            current.append(line[5:].lstrip())
    for payload in payloads:
        value = json.loads(payload)
        if isinstance(value, dict) and ("result" in value or "error" in value):
            return value
    raise ContractError("MCP SSE 中没有 JSON-RPC 响应")


class McpSession:
    def __init__(self, server: str, url: str, token: str):
        self.server = server
        self.url = url
        self.token = token
        self.session_id: str | None = None
        self.request_id = 0
        self.protocol_version = "2025-06-18"

    def post(self, method: str, params: dict | None = None, *, notification: bool = False) -> dict | None:
        payload: dict = {"jsonrpc": "2.0", "method": method}
        if not notification:
            self.request_id += 1
            payload["id"] = self.request_id
        if params is not None:
            payload["params"] = params
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self.protocol_version,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                session_id = response.headers.get("Mcp-Session-Id")
                if session_id:
                    self.session_id = session_id
                if notification and not body:
                    return None
                value = decode_rpc(body, response.headers.get("Content-Type", "application/json"))
        except urllib.error.HTTPError as error:
            raise ContractError(f"{self.server} MCP 返回 HTTP {error.code}") from None
        except (urllib.error.URLError, TimeoutError):
            raise ContractError(f"{self.server} MCP 连接失败") from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ContractError(f"{self.server} MCP 返回无法解析的协议数据") from None
        if value.get("error") is not None:
            raise ContractError(f"{self.server} MCP 返回 JSON-RPC 错误")
        if not isinstance(value.get("result"), dict):
            raise ContractError(f"{self.server} MCP 缺少 JSON-RPC result")
        return value

    def list_tools(self) -> set[str]:
        initialized = self.post("initialize", {
            "protocolVersion": self.protocol_version,
            "capabilities": {},
            "clientInfo": {"name": "security-operations-contract-check", "version": "1.0"},
        })
        negotiated = initialized["result"].get("protocolVersion")
        if isinstance(negotiated, str):
            self.protocol_version = negotiated
        self.post("notifications/initialized", notification=True)

        names: set[str] = set()
        cursor: str | None = None
        seen_cursors: set[str] = set()
        for _ in range(100):
            params = {"cursor": cursor} if cursor is not None else None
            listed = self.post("tools/list", params)
            tools = listed["result"].get("tools")
            if not isinstance(tools, list):
                raise ContractError(f"{self.server} tools/list 缺少工具列表")
            for tool in tools:
                name = tool.get("name") if isinstance(tool, dict) else None
                if not isinstance(name, str) or not name:
                    raise ContractError(f"{self.server} tools/list 包含无效工具")
                names.add(name)
            cursor = listed["result"].get("nextCursor")
            if cursor in (None, ""):
                return names
            if not isinstance(cursor, str) or cursor in seen_cursors:
                raise ContractError(f"{self.server} tools/list 分页游标无效")
            seen_cursors.add(cursor)
        raise ContractError(f"{self.server} tools/list 分页超过上限")


def raw_name(public_name: str, server: str) -> str:
    prefix = f"mcp__{server}__"
    if not public_name.startswith(prefix):
        raise ContractError(f"工具不属于预期 MCP 服务：{public_name}")
    return public_name[len(prefix):]


def verify_live() -> dict:
    matrix = load_yaml(MANAGED / "role-tool-matrix.yaml")
    routes = matrix_routes(matrix)
    expected_public = {
        "sec-ops": routes["policy"] + routes["faultAnalysis"]
        + [name for name in routes["denied"] if name.startswith("mcp__sec-ops__")],
        "inspection": routes["inspection"]
        + [name for name in routes["denied"] if name.startswith("mcp__inspection__")],
    }
    env_names = {
        "sec-ops": ("SEC_OPS_MCP_URL", "SEC_OPS_MCP_TOKEN"),
        "inspection": ("INSPECTION_MCP_URL", "INSPECTION_MCP_TOKEN"),
    }
    result = {"status": "ok", "servers": {}}
    for server, names in expected_public.items():
        url_name, token_name = env_names[server]
        url, token = os.environ.get(url_name), os.environ.get(token_name)
        if not url or not token:
            raise ContractError(f"缺少运行时环境变量：{url_name}/{token_name}")
        live_names = McpSession(server, url, token).list_tools()
        expected_raw = {raw_name(name, server) for name in names}
        missing = expected_raw - live_names
        if missing:
            raise ContractError(f"{server} 实时目录缺少 {len(missing)} 个合同工具")
        result["servers"][server] = {
            "listed": len(live_names),
            "contract_matched": len(expected_raw),
        }
    return result


def self_test() -> dict:
    sample = {"jsonrpc": "2.0", "id": 1, "result": {"tools": []}}
    encoded = json.dumps(sample).encode("utf-8")
    assert decode_rpc(encoded, "application/json") == sample
    assert decode_rpc(b"event: message\ndata: " + encoded + b"\n\n", "text/event-stream") == sample
    return {"status": "ok", "protocol_parser": "json+sse"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="静态校验后只读调用实时 tools/list")
    parser.add_argument("--self-test", action="store_true", help="仅运行 JSON/SSE 解析自检")
    args = parser.parse_args()
    try:
        if args.self_test:
            output = self_test()
        else:
            output = {"static": verify_static()}
            if args.live:
                output["live"] = verify_live()
        print(json.dumps(output, ensure_ascii=False, sort_keys=True))
        return 0
    except (ContractError, KeyError, TypeError, yaml.YAMLError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
