#!/usr/bin/env python3
"""创建、追加并收尾一次执行 Run；只写本仓库 Run 目录，不执行 Harness。"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import importlib.util
import sys

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from source_contract import resolve

_MUTATION_PATH = Path(__file__).with_name("mutation-receipt.py")
_MUTATION_SPEC = importlib.util.spec_from_file_location("dsh_mutation_receipt", _MUTATION_PATH)
_mutation_receipt = importlib.util.module_from_spec(_MUTATION_SPEC)
_MUTATION_SPEC.loader.exec_module(_mutation_receipt)
snapshot = _mutation_receipt.snapshot

REPO = Path(__file__).resolve().parents[3]
EXPERIMENT_RE = re.compile(r"^EXP-([a-z0-9]+(?:-[a-z0-9]+)*)-[0-9]{3,}$")
RUN_ID_RE = re.compile(r"^run-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
BASELINE_RE = re.compile(r"^bl-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
RESULT_FIELDS = (
    "run_id", "trial_id", "case_id", "baseline_id", "status", "score", "safety_violation",
    "duration_ms", "input_tokens", "output_tokens", "tool_call_count", "retry_count",
    "cost_amount", "cost_currency", "resolved_model", "failure_reason", "evidence_ref",
)
RESULT_STATUSES = ("pass", "fail", "error", "skipped", "blocked")
RUN_STATUSES = ("planned", "running", "completed", "failed", "cancelled")
FINAL_STATUSES = ("completed", "failed", "cancelled")
RUN_KINDS = ("formal", "research", "technical")
GAP_CLASSIFICATIONS = (
    "harness-capability", "eval-data", "scoring-method",
    "environment-dependency", "spec-ambiguity", "unconfirmed",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def strict_json(path: Path) -> dict:
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate key in {path.name}: {key}")
            result[key] = value
        return result

    with path.open(encoding="utf-8") as stream:
        value = json.load(stream, object_pairs_hook=unique_pairs)
    if not isinstance(value, dict):
        raise ValueError(f"contract must be an object: {path.name}")
    return value


def repo_relative(repo: Path, value: str) -> Path:
    path = Path(value)
    if not value or "\\" in value or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe relative path: {value}")
    return repo / path


def tree_digest(repo: Path, root: Path) -> dict:
    root = root.absolute()
    try:
        root.relative_to(repo)
    except ValueError:
        raise ValueError("run inputs must live inside the repository")
    return snapshot(root, allowed_roots={root})


def git_version(repo: Path) -> dict:
    """记录本次运行对应的 Git 版本与未提交状态。

    源码版本由 Git 管理后，Run 台账要能说明实际跑的是哪一版。未提交修改无法仅凭 HEAD 还原，
    因此如实记录 dirty 状态；读取失败记为 unknown，不猜测、也不虚称已完整冻结。
    """
    def git(*args: str) -> tuple[int, str]:
        completed = subprocess.run(["git", *args], cwd=repo, text=True,
                                   capture_output=True, check=False, timeout=60)
        return completed.returncode, completed.stdout.strip()

    commit_code, commit = git("rev-parse", "HEAD")
    status_code, status = git("status", "--porcelain")
    if commit_code != 0 or status_code != 0:
        return {"commit": None, "dirty": None, "detail": "无法读取 Git 版本；本次运行的源码版本未知"}
    changed = [line for line in status.splitlines() if line.strip()]
    return {
        "commit": commit,
        "dirty": bool(changed),
        "changed_path_count": len(changed),
    }


def load_run_manifest(repo: Path, run_id: str) -> tuple[Path, dict, dict]:
    matches = []
    experiments_root = repo / "evolution" / "experiments"
    if experiments_root.is_dir():
        for experiment in experiments_root.iterdir():
            run_dir = experiment / "runs" / run_id
            if run_dir.is_dir() and not run_dir.is_symlink():
                matches.append(run_dir)
    if len(matches) != 1:
        raise ValueError(f"unknown or ambiguous run: {run_id}")
    run_dir = matches[0]
    manifest = read_flat_yaml(run_dir / "run.yaml")
    return run_dir, manifest, {"experiment_id": run_dir.parents[1].name}


def read_flat_yaml(path: Path) -> dict:
    values: dict = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or ":" not in stripped:
                continue
            key, _, value = stripped.partition(":")
            if key in values:
                raise ValueError(f"duplicate key in {path.name}: {key}")
            raw = value.strip()
            if raw.startswith('"') and raw.endswith('"'):
                raw = raw[1:-1]
            values[key] = raw
    return values


def write_flat_yaml(path: Path, values: dict) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}: {value}\n")


def append_jsonl(path: Path, value: dict) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def validate_trial_row(repo: Path, run_id: str, row: dict) -> None:
    missing = sorted(field for field in RESULT_FIELDS if field not in row)
    if missing:
        raise ValueError("trial row missing fields: %s" % ", ".join(missing))
    if row.get("run_id") != run_id:
        raise ValueError("trial row run_id must match the selected Run")
    if not isinstance(row.get("trial_id"), str) or not row["trial_id"].strip():
        raise ValueError("trial_id must be a non-empty string")
    if not isinstance(row.get("case_id"), str) or not row["case_id"].strip():
        raise ValueError("case_id must be a non-empty string")
    baseline_id = row.get("baseline_id")
    if baseline_id not in (None, "") and (not isinstance(baseline_id, str) or not BASELINE_RE.fullmatch(baseline_id)):
        raise ValueError("baseline_id must be bl-<UUIDv4> or empty")
    status = row.get("status")
    if status not in RESULT_STATUSES:
        raise ValueError("status must be one of pass/fail/error/skipped/blocked")
    if status == "error" and row.get("score") not in (None, ""):
        raise ValueError("status=error trial must not carry a score")
    if status != "pass" and not (isinstance(row.get("failure_reason"), str) and row["failure_reason"].strip()):
        raise ValueError("status!=pass trial must carry failure_reason")
    if row.get("safety_violation") not in ("true", "false", "unknown"):
        raise ValueError("safety_violation must be true/false/unknown")
    for field in ("evidence_ref", "tool_call_count", "retry_count"):
        if not isinstance(row.get(field), str) or not row[field].strip():
            raise ValueError(f"{field} must be a non-empty string")


def command_init(repo: Path, args: argparse.Namespace) -> None:
    match = EXPERIMENT_RE.fullmatch(args.experiment)
    if not match or match.group(1) != args.agent:
        raise ValueError("experiment must be named EXP-<agent-id>-NNN for the selected agent")
    experiment = repo / "evolution" / "experiments" / args.experiment
    if not experiment.is_dir() or experiment.is_symlink():
        raise ValueError(f"unknown experiment: {args.experiment}")
    if args.kind not in RUN_KINDS:
        raise ValueError("kind must be formal、research 或 technical")
    if args.kind == "formal" and not args.baseline:
        raise ValueError("formal Run 必须绑定 --baseline bl-<UUIDv4>")
    if args.baseline and not BASELINE_RE.fullmatch(args.baseline):
        raise ValueError("baseline 必须是 bl-<UUIDv4>")
    contract = resolve(args.source, repo=repo)
    run_id = "run-" + str(uuid.uuid4())
    run_dir = experiment / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    try:
        inputs = {
            "schema_version": "1.0",
            "run_id": run_id,
            "source_id": contract["source_id"],
            "source_kind": contract["source_kind"],
            "created_at": utc_now(),
            "harness_trees": {
                "workspace": tree_digest(repo, Path(contract["workspace"])),
                "presets": tree_digest(repo, Path(contract["presets"])),
                "managed": tree_digest(repo, Path(contract["managed"])),
            },
            "spec_tree": tree_digest(repo, Path(contract["spec_root"])) if contract.get("spec_root") else None,
            "eval_tree": tree_digest(repo, Path(contract["eval_root"])) if contract.get("eval_root") else None,
            "git_version": git_version(repo),
        }
        plan_ref = ""
        if args.plan:
            plan_path = repo_relative(repo, args.plan)
            if not plan_path.is_file() or plan_path.is_symlink():
                raise ValueError(f"plan file missing or unsafe: {args.plan}")
            inputs["plan_sha256"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            plan_ref = args.plan
        if args.baseline:
            inputs["baseline_id"] = args.baseline
        with (run_dir / "inputs.lock.json").open("w", encoding="utf-8") as handle:
            json.dump(inputs, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        manifest = {
            "schema_version": "1.0",
            "run_id": run_id,
            "experiment_id": args.experiment,
            "agent_id": args.agent,
            "kind": args.kind,
            "status": "planned",
            "created_at": utc_now(),
            "source_id": contract["source_id"],
        }
        if plan_ref:
            manifest["plan_ref"] = plan_ref
        if args.baseline:
            manifest["baseline_id"] = args.baseline
        write_flat_yaml(run_dir / "run.yaml", manifest)
    except BaseException:
        shutil.rmtree(run_dir)
        raise
    print(run_id)


def command_record(repo: Path, args: argparse.Namespace) -> None:
    run_dir, manifest, identity = load_run_manifest(repo, args.run)
    status = manifest.get("status")
    if status not in ("planned", "running"):
        raise ValueError("finalized Run refuses new results")
    if args.trial_file == "-":
        row = json.loads(sys.stdin.read())
    else:
        row = json.loads(Path(args.trial_file).read_text(encoding="utf-8"))
    if not isinstance(row, dict):
        raise ValueError("trial must be a JSON object")
    validate_trial_row(repo, args.run, row)
    results_path = run_dir / "results.jsonl"
    if results_path.is_file():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                existing = json.loads(line)
                if existing.get("trial_id") == row.get("trial_id"):
                    raise ValueError("trial_id duplicated inside the Run")
    append_jsonl(results_path, row)
    if status == "planned":
        manifest["status"] = "running"
        write_flat_yaml(run_dir / "run.yaml", manifest)
    print(args.run)


def command_gap(repo: Path, args: argparse.Namespace) -> None:
    run_dir, manifest, identity = load_run_manifest(repo, args.run)
    if manifest.get("status") in FINAL_STATUSES:
        raise ValueError("finalized Run refuses new gaps")
    if args.classification not in GAP_CLASSIFICATIONS:
        raise ValueError("classification must be one of the six agreed categories")
    if not args.title.strip() or not args.observed.strip() or not args.next_step.strip():
        raise ValueError("gap 必须提供非空标题、观察和下一步")
    evidence_ref = ""
    if args.evidence:
        target = repo_relative(repo, args.evidence)
        if not target.is_file() or target.is_symlink():
            raise ValueError(f"evidence reference missing or unsafe: {args.evidence}")
        evidence_ref = args.evidence
    affected = [value for value in (args.affected or "").split(",") if value.strip()]
    row = {
        "gap_id": "gap-" + str(uuid.uuid4()),
        "run_id": args.run,
        "title": args.title.strip(),
        "observed": args.observed.strip(),
        "evidence_ref": evidence_ref,
        "affected": affected,
        "classification": args.classification,
        "cause_verified": bool(args.cause_verified),
        "next_step": args.next_step.strip(),
    }
    append_jsonl(run_dir / "gaps.jsonl", row)
    print(row["gap_id"])


def command_finalize(repo: Path, args: argparse.Namespace) -> None:
    run_dir, manifest, identity = load_run_manifest(repo, args.run)
    if manifest.get("status") not in ("planned", "running"):
        raise ValueError("Run is already finalized")
    if args.status not in FINAL_STATUSES:
        raise ValueError("final status must be completed、failed 或 cancelled")
    results_path = run_dir / "results.jsonl"
    status_counts = {name: 0 for name in RESULT_STATUSES}
    if results_path.is_file():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            validate_trial_row(repo, args.run, row)
            status_counts[row["status"]] += 1
    if manifest.get("kind") == "formal" and args.status == "completed" \
            and not (run_dir / "report.md").is_file():
        raise ValueError("formal Run 收尾为 completed 前必须写入 report.md")
    summary = {
        "schema_version": "1.0",
        "run_id": args.run,
        "trial_count": sum(status_counts.values()),
        **status_counts,
    }
    summary_path = run_dir / "summary.json"
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    manifest["status"] = args.status
    manifest["results_sha256"] = hashlib.sha256(results_path.read_bytes()).hexdigest() if results_path.is_file() else hashlib.sha256(b"").hexdigest()
    manifest["summary_sha256"] = hashlib.sha256(summary_path.read_bytes()).hexdigest()
    gaps_path = run_dir / "gaps.jsonl"
    if gaps_path.is_file():
        manifest["gaps_sha256"] = hashlib.sha256(gaps_path.read_bytes()).hexdigest()
    write_flat_yaml(run_dir / "run.yaml", manifest)
    print(args.run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=REPO, help="仓库根目录")
    commands = parser.add_subparsers(dest="command", required=True)
    init_parser = commands.add_parser("init", help="create a planned Run and pin its inputs")
    init_parser.add_argument("--agent", required=True)
    init_parser.add_argument("--experiment", required=True)
    init_parser.add_argument("--source", required=True, help="experiment:<id> 或 release:<id>")
    init_parser.add_argument("--kind", default="research", choices=RUN_KINDS)
    init_parser.add_argument("--baseline", help="formal Run 必须绑定的 bl-<UUIDv4>")
    init_parser.add_argument("--plan", help="评测计划的仓库相对路径")
    record_parser = commands.add_parser("record", help="append one Trial from a JSON file")
    record_parser.add_argument("--run", required=True)
    record_parser.add_argument("trial_file", help="Trial JSON 文件；- 表示标准输入")
    gap_parser = commands.add_parser("gap", help="append one gap observation")
    gap_parser.add_argument("--run", required=True)
    gap_parser.add_argument("--classification", required=True, choices=GAP_CLASSIFICATIONS)
    gap_parser.add_argument("--title", required=True)
    gap_parser.add_argument("--observed", required=True)
    gap_parser.add_argument("--next-step", required=True)
    gap_parser.add_argument("--affected", help="受影响 REQ/AC/Case 编号，逗号分隔")
    gap_parser.add_argument("--evidence", help="证据引用的仓库相对路径")
    gap_parser.add_argument("--cause-verified", action="store_true", help="根因已经验证（默认视为假设）")
    finalize_parser = commands.add_parser("finalize", help="seal the Run with a final status and derived summary")
    finalize_parser.add_argument("--run", required=True)
    finalize_parser.add_argument("--status", required=True, choices=FINAL_STATUSES)
    args = parser.parse_args()
    try:
        repo = args.repo.resolve()
        if not repo.is_dir():
            raise ValueError("仓库根目录不存在")
        if args.command == "init":
            command_init(repo, args)
        elif args.command == "record":
            command_record(repo, args)
        elif args.command == "gap":
            command_gap(repo, args)
        else:
            command_finalize(repo, args)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"run record failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
