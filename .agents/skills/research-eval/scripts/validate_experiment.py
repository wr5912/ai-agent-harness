#!/usr/bin/env python3
"""校验一个 Harness Experiment 的最小可复现研究记录。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluation_contract import selection_for

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


EXPERIMENT_RE = re.compile(r"^EXP-([a-z0-9]+(?:-[a-z0-9]+)*)-[0-9]{3,}$")
RUN_RE = re.compile(
    r"^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
RELEASE_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")
OUTCOMES = {"adopt", "continue", "reject", "inconclusive"}
RUN_STATUSES = {"planned", "running", "completed", "failed", "cancelled"}
TRIAL_STATUSES = {"completed", "failed", "error", "skipped"}


def issue(code: str, message: str, path: Path | None = None) -> dict[str, str]:
    result = {"code": code, "message": message}
    if path is not None:
        result["path"] = str(path)
    return result


def load_yaml(path: Path) -> dict:
    if yaml is None:
        raise RuntimeError("缺少 PyYAML；请先安装 scripts/requirements.txt")
    value = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("必须是 YAML object")
    return value


def has_text(path: Path) -> bool:
    if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
        return False
    text = path.read_text(encoding="utf-8", errors="replace")
    visible = []
    in_comment = False
    for line in text.splitlines():
        stripped = line.strip()
        if "<!--" in stripped:
            in_comment = True
        if not in_comment and stripped and not stripped.startswith("#"):
            visible.append(stripped)
        if "-->" in stripped:
            in_comment = False
    return any(item.lower() not in {"todo", "tbd", "待补充", "占位"} for item in visible)


def material_files(directory: Path) -> list[Path]:
    if not directory.is_dir() or directory.is_symlink():
        return []
    result = []
    for path in directory.rglob("*"):
        if path.is_file() and not path.is_symlink() and path.stat().st_size > 0 \
                and path.name not in {".gitkeep", ".keep", ".DS_Store"}:
            result.append(path)
    return result


def valid_baseline_ref(value: object) -> bool:
    if value == "none:first-experiment":
        return True
    if not isinstance(value, str):
        return False
    if value.startswith("git:"):
        return bool(COMMIT_RE.fullmatch(value[4:]))
    if value.startswith("release:"):
        return bool(RELEASE_RE.fullmatch(value[8:]))
    return False


def validate_result(
    path: Path,
    expected_run: str,
    allowed_input_ids: set[str],
    errors: list[dict[str, str]],
) -> None:
    seen: set[str] = set()
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(issue("RESULT_JSON", f"第 {line_number} 行不是合法 JSON：{exc.msg}", path))
            continue
        if not isinstance(row, dict):
            errors.append(issue("RESULT_OBJECT", f"第 {line_number} 行必须是 object", path))
            continue
        required = ("run_id", "trial_id", "input_id", "status", "observation")
        missing = [name for name in required if name not in row]
        if missing:
            errors.append(issue("RESULT_FIELDS", f"第 {line_number} 行缺少：{', '.join(missing)}", path))
            continue
        if row["run_id"] != expected_run:
            errors.append(issue("RESULT_RUN", f"第 {line_number} 行 run_id 与目录不一致", path))
        trial_id = row["trial_id"]
        if not isinstance(trial_id, str) or not trial_id.strip():
            errors.append(issue("RESULT_TRIAL", f"第 {line_number} 行 trial_id 必须是非空字符串", path))
        elif trial_id in seen:
            errors.append(issue("RESULT_TRIAL_DUPLICATE", f"重复 trial_id：{trial_id}", path))
        else:
            seen.add(trial_id)
        if not isinstance(row["input_id"], str) or not row["input_id"].strip():
            errors.append(issue("RESULT_INPUT", f"第 {line_number} 行 input_id 必须是非空字符串", path))
        elif row["input_id"] not in allowed_input_ids:
            errors.append(issue("RESULT_INPUT_SELECTION", f"第 {line_number} 行 input_id 未被本 Experiment 选择", path))
        if row["status"] not in TRIAL_STATUSES:
            errors.append(issue("RESULT_STATUS", f"第 {line_number} 行 status 不合法", path))
        if not isinstance(row["observation"], str) or not row["observation"].strip():
            errors.append(issue("RESULT_OBSERVATION", f"第 {line_number} 行 observation 必须非空", path))
        if row["status"] in {"failed", "error"} and not (
            isinstance(row.get("failure_reason"), str) and row["failure_reason"].strip()
        ):
            errors.append(issue("RESULT_FAILURE_REASON", f"第 {line_number} 行失败或错误必须说明原因", path))


def validate_run(
    run_dir: Path,
    experiment_id: str,
    agent_id: str,
    evaluation_ref: str,
    evaluation_sha256: str,
    evaluation_selection: dict[str, list[str]],
    errors: list[dict[str, str]],
) -> None:
    if not RUN_RE.fullmatch(run_dir.name):
        errors.append(issue("RUN_NAME", "Run 目录必须使用 run-<UUIDv4>", run_dir))
        return
    manifest_path = run_dir / "run.yaml"
    if not manifest_path.is_file():
        errors.append(issue("RUN_MANIFEST", "Run 缺少 run.yaml", run_dir))
        return
    try:
        manifest = load_yaml(manifest_path)
    except (OSError, ValueError, RuntimeError) as exc:
        errors.append(issue("RUN_MANIFEST", str(exc), manifest_path))
        return
    expected = {
        "run_id": run_dir.name,
        "experiment_id": experiment_id,
        "agent_id": agent_id,
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            errors.append(issue("RUN_IDENTITY", f"{key} 必须是 {value}", manifest_path))
    if manifest.get("kind") not in {"research", "technical"}:
        errors.append(issue("RUN_KIND", "kind 必须是 research 或 technical", manifest_path))
    status = manifest.get("status")
    if status not in RUN_STATUSES:
        errors.append(issue("RUN_STATUS", "Run status 不合法", manifest_path))
    if manifest.get("evaluation_ref") != evaluation_ref:
        errors.append(issue("RUN_EVALUATION_REF", f"evaluation_ref 必须是 {evaluation_ref}", manifest_path))
    if "plan_ref" in manifest:
        errors.append(issue("RUN_PLAN_REF", "Run 不再允许引用 Experiment 本地 plan", manifest_path))
    inputs = run_dir / "inputs.lock.json"
    if not inputs.is_file() or inputs.stat().st_size == 0:
        errors.append(issue("RUN_INPUTS", "Run 缺少 inputs.lock.json", run_dir))
        locked_inputs = {}
    else:
        try:
            locked_inputs = json.loads(inputs.read_text(encoding="utf-8"))
            if not isinstance(locked_inputs, dict):
                raise ValueError("必须是 JSON object")
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            errors.append(issue("RUN_INPUTS", f"inputs.lock.json 无效：{exc}", inputs))
            locked_inputs = {}
    if "plan_sha256" in locked_inputs:
        errors.append(issue("RUN_PLAN_REF", "Run 输入锁不再允许保存本地 plan 摘要", inputs))
    if locked_inputs.get("evaluation_sha256") != evaluation_sha256:
        errors.append(issue("RUN_EVALUATION_HASH", "Run 锁定的 evaluation.md 摘要与当前文件不一致", inputs))
    if locked_inputs.get("evaluation_selection") != evaluation_selection:
        errors.append(issue("RUN_EVALUATION_SELECTION", "Run 锁定的 Experiment 选择与当前文件不一致", inputs))
    results = run_dir / "results.jsonl"
    if results.is_file():
        validate_result(results, run_dir.name, set(evaluation_selection["case_ids"]), errors)
    if status in {"completed", "failed", "cancelled"} and not (run_dir / "summary.json").is_file():
        errors.append(issue("RUN_SUMMARY", "已封存 Run 缺少 summary.json", run_dir))


def validate(experiment: Path) -> tuple[dict, int]:
    errors: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []
    match = EXPERIMENT_RE.fullmatch(experiment.name)
    if not experiment.is_dir() or experiment.is_symlink() or not match:
        payload = {"schema_version": "1.0", "valid": False, "errors": [issue("EXPERIMENT_PATH", "输入必须是 EXP-<agent-id>-NNN 实体目录", experiment)], "warnings": []}
        return payload, 2
    agent_id = match.group(1)
    repository = experiment.parents[2]
    evaluation_path = repository / "agents" / agent_id / "evaluation.md"
    evaluation_ref = f"agents/{agent_id}/evaluation.md#{experiment.name}"
    try:
        evaluation_selection = selection_for(evaluation_path, experiment.name)
        evaluation_sha256 = hashlib.sha256(evaluation_path.read_bytes()).hexdigest()
    except (OSError, ValueError) as exc:
        errors.append(issue("EVALUATION_CONTRACT", str(exc), evaluation_path))
        evaluation_selection = None
        evaluation_sha256 = ""
    change_path = experiment / "change.yaml"
    try:
        change = load_yaml(change_path)
    except (OSError, ValueError, RuntimeError) as exc:
        errors.append(issue("CHANGE", str(exc), change_path))
        change = {}
    required = {
        "schema_version": "1.0",
        "experiment_id": experiment.name,
        "agent_id": agent_id,
    }
    for key, expected in required.items():
        if change.get(key) != expected:
            errors.append(issue("CHANGE_IDENTITY", f"{key} 必须是 {expected}", change_path))
    if not valid_baseline_ref(change.get("baseline_ref")):
        errors.append(issue("BASELINE_REF", "baseline_ref 必须是 git:<commit>、release:<id> 或 none:first-experiment", change_path))
    status = change.get("status")
    if status not in {"active", "completed"}:
        errors.append(issue("EXPERIMENT_STATUS", "status 必须是 active 或 completed", change_path))
    outcome = change.get("outcome")
    if status == "completed" and outcome not in OUTCOMES:
        errors.append(issue("EXPERIMENT_OUTCOME", "完成的 Experiment 必须声明 outcome", change_path))
    if status == "active" and outcome not in (None, ""):
        warnings.append(issue("ACTIVE_OUTCOME", "active Experiment 通常不应提前固定 outcome", change_path))
    if not has_text(experiment / "hypothesis.md"):
        errors.append(issue("HYPOTHESIS", "hypothesis.md 缺少实质内容", experiment / "hypothesis.md"))
    if not material_files(experiment / "candidate"):
        errors.append(issue("CANDIDATE", "candidate/ 缺少真实资产", experiment / "candidate"))
    local_plan = experiment / "evaluation/plan.yaml"
    if local_plan.exists():
        errors.append(issue("EVALUATION_PLAN", "评测口径只能维护在 Agent 的 evaluation.md", local_plan))
    if status == "completed" and not has_text(experiment / "decision.md"):
        errors.append(issue("DECISION", "完成的 Experiment 缺少实质 decision.md", experiment / "decision.md"))
    runs = experiment / "runs"
    if runs.exists():
        if not runs.is_dir() or runs.is_symlink():
            errors.append(issue("RUNS", "runs 必须是实体目录", runs))
        else:
            for run_dir in sorted(path for path in runs.iterdir() if path.name not in {".DS_Store"}):
                if run_dir.is_dir():
                    if evaluation_selection is not None:
                        validate_run(
                            run_dir,
                            experiment.name,
                            agent_id,
                            evaluation_ref,
                            evaluation_sha256,
                            evaluation_selection,
                            errors,
                        )
                else:
                    errors.append(issue("RUN_ENTRY", "runs/ 只能包含 Run 目录", run_dir))
    payload = {
        "schema_version": "1.0",
        "experiment_id": experiment.name,
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
    }
    return payload, 0 if not errors else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", type=Path)
    args = parser.parse_args()
    payload, code = validate(args.experiment.resolve())
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
