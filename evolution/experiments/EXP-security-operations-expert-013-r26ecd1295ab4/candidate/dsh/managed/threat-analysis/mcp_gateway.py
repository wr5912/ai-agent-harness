"""Minimal read-only client for the configured MCP resource gateway."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from fusion_contract import CallOutcome


READ_ONLY_POST_TOOLS = frozenset(
    {
        "ai_soc_detect__create_detect_alert_by_ids",
        "ai_soc_event__count_event",
        "ai_soc_event__search_event",
        "ai_soc_correlate__get_correlate_intel_check",
        "ai_soc_correlate__get_correlate_intel_check_list",
    }
)


@dataclass(frozen=True)
class McpCallResult:
    outcome: CallOutcome
    data: Any
    result_count: int | None
    latency_ms: int
    raw_response_file: str
    response: Mapping[str, Any]


class McpCatalog:
    def __init__(
        self,
        resources: Mapping[str, Mapping[str, Any]],
        tools: Mapping[str, Mapping[str, Any]],
    ) -> None:
        self.resources = dict(resources)
        self.tools = dict(tools)

    @classmethod
    def from_documents(
        cls,
        resource_document: Mapping[str, Any],
        tool_documents: Iterable[Mapping[str, Any]],
    ) -> "McpCatalog":
        resources = {
            str(item["slug"]): item
            for item in resource_document.get("items", [])
            if isinstance(item, Mapping) and item.get("slug") and item.get("id")
        }
        tools: dict[str, Mapping[str, Any]] = {}
        for document in tool_documents:
            if "items" in document:
                items = document.get("items", [])
            else:
                items = document.values()
            for item in items:
                if isinstance(item, Mapping) and item.get("name"):
                    tools[str(item["name"])] = item
        return cls(resources, tools)

    @classmethod
    def from_directory(cls, directory: Path) -> "McpCatalog":
        resources = json.loads(
            (directory / ".current-resources.local.json").read_text(encoding="utf-8")
        )
        tool_documents = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(directory.glob(".current-ai_soc_*-tools.local.json"))
        ]
        return cls.from_documents(resources, tool_documents)


def extract_result_data(response: Mapping[str, Any]) -> Any:
    result = response.get("result")
    if isinstance(result, Mapping) and "data" in result:
        return result.get("data")
    return result


def _is_empty_data(data: Any) -> bool:
    if data is None or data == [] or data == {} or data == "":
        return True
    if isinstance(data, Mapping) and isinstance(data.get("items"), list):
        if data["items"]:
            return False
        total = data.get("total")
        return total in (None, 0, "0")
    if isinstance(data, Mapping) and "total" in data:
        total = data.get("total")
        if total in (0, "0"):
            hits = data.get("hits")
            return hits in (None, [])
    return False


def classify_response(response: Mapping[str, Any]) -> CallOutcome:
    status = str(response.get("status", "")).lower()
    status_code = response.get("status_code")
    result = response.get("result")
    inner_code = result.get("code") if isinstance(result, Mapping) else None
    if status not in {"success", "ok"}:
        return CallOutcome.FAILED
    if status_code not in (None, 200) or inner_code not in (None, 200):
        return CallOutcome.FAILED
    if isinstance(result, Mapping) and result.get("_truncated") is True:
        return CallOutcome.TRUNCATED
    return (
        CallOutcome.SUCCESS_EMPTY
        if _is_empty_data(extract_result_data(response))
        else CallOutcome.SUCCESS_WITH_DATA
    )


def result_count(data: Any) -> int | None:
    if data is None:
        return 0
    if isinstance(data, list):
        return len(data)
    if isinstance(data, Mapping):
        total = data.get("total")
        if isinstance(total, int):
            return total
        if isinstance(total, str) and total.isdigit():
            return int(total)
        items = data.get("items")
        if isinstance(items, list):
            return len(items)
        return 0 if not data else 1
    return 1


def _default_transport(endpoint: str, payload: Mapping[str, Any], timeout: int) -> Any:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            parsed = {}
        if not isinstance(parsed, dict):
            parsed = {}
        parsed.setdefault("status", "error")
        parsed.setdefault("status_code", error.code)
        return parsed
    except urllib.error.URLError as error:
        return {
            "status": "error",
            "status_code": None,
            "error_type": type(error.reason).__name__,
        }
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {
            "status": "error",
            "status_code": None,
            "error_type": "UNPARSEABLE_RESPONSE",
        }


class McpGateway:
    def __init__(
        self,
        *,
        base_url: str,
        catalog: McpCatalog,
        raw_directory: Path,
        transport: Callable[[str, Mapping[str, Any], int], Any] = _default_transport,
        timeout: int = 120,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.catalog = catalog
        self.raw_directory = raw_directory
        self.transport = transport
        self.timeout = timeout

    def _validate(
        self, resource: str, tool_name: str, arguments: Mapping[str, Any]
    ) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
        tool = self.catalog.tools.get(tool_name)
        if tool is None:
            raise KeyError(f"MCP tool is absent from catalog: {tool_name}")
        resource_record = self.catalog.resources.get(resource)
        if resource_record is None:
            raise KeyError(f"MCP resource is absent from catalog: {resource}")
        if tool.get("resource_id") != resource_record.get("id"):
            raise ValueError(f"tool does not belong to resource: {tool_name}")
        method = str(tool.get("http_method", "")).upper()
        if method != "GET" and tool_name not in READ_ONLY_POST_TOOLS:
            raise PermissionError(f"tool did not pass read-only gate: {tool_name}")
        schema = tool.get("schema_json")
        parameter_schema = schema.get("parameters", {}) if isinstance(schema, Mapping) else {}
        missing = [
            name
            for name in parameter_schema.get("required", [])
            if name not in arguments
        ]
        if missing:
            raise ValueError(f"missing required MCP arguments: {', '.join(missing)}")
        return resource_record, tool

    def invoke(
        self,
        *,
        call_id: str,
        resource: str,
        tool_name: str,
        arguments: Mapping[str, Any],
    ) -> McpCallResult:
        resource_record, _ = self._validate(resource, tool_name, arguments)
        endpoint = (
            f"{self.base_url}/api/v1/mcp-resources/{resource_record['id']}"
            f"/tools/{tool_name}/invoke"
        )
        started = time.monotonic()
        response = self.transport(
            endpoint, {"arguments": dict(arguments)}, self.timeout
        )
        latency_ms = round((time.monotonic() - started) * 1000)
        if not isinstance(response, Mapping):
            response = {
                "status": "error",
                "status_code": None,
                "error_type": "NON_OBJECT_RESPONSE",
            }
        self.raw_directory.mkdir(parents=True, exist_ok=True)
        raw_path = self.raw_directory / f"{call_id}.json"
        raw_path.write_text(
            json.dumps(response, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        outcome = classify_response(response)
        data = extract_result_data(response)
        return McpCallResult(
            outcome=outcome,
            data=data,
            result_count=(
                result_count(data)
                if outcome not in (CallOutcome.FAILED, CallOutcome.TRUNCATED)
                else None
            ),
            latency_ms=latency_ms,
            raw_response_file=str(raw_path),
            response=response,
        )
