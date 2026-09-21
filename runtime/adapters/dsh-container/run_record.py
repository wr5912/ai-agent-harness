#!/usr/bin/env python3
"""创建、追加并封存一次 Research Run；只记录事实，不执行 Harness。"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

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
RUN_ID_RE = re.compile(
    r"^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
RELEASE_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")
RESULT_FIELDS = ("run_id", "trial_id", "input_id", "status", "observation")
RESULT_STATUSES = ("completed", "failed", "error", "skipped")
RUN_STATUSES = ("planned", "running", "completed", "failed", "cancelled")
FINAL_STATUSES = ("completed", "failed", "cancelled")
RUN_KINDS = ("research", "technical")
GAP_CLASSIFICATIONS = ("harness", "input", "method", "environment", "unknown")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def valid_baseline_ref(value: str) -> bool:
    if value == "none:first-experiment":
        return True
    if value.startswith("git:"):
        return bool(COMMIT_RE.fullmatch(value[4:]))
    if value.startswith("release:"):
        return bool(RELEASE_RE.fullmatch(value[8:]))
    return False


def repo_relative(repo: Path, value: str) -> Path:
    path = Path(value)
    if not value or "\\" in value or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"unsafe relative path: {value}")
    return repo / path


def tree_digest(repo: Path, root: Path) -> dict:
    root = root.absolute()
    try:
        root.relative_to(repo)
    except ValueError as exc:
        raise ValueError("run inputs must live inside the repository") from exc
    return snapshot(root, allowed_roots={root})


def git_version(repo: Path) -> dict:
    def git(*args: str) -> tuple[int, str]:
        completed = subprocess.run(
            ["git", *args], cwd=repo, text=True, capture_output=True, check=False, timeout=60
        )
        return completed.returncode, completed.stdout.strip()

    commit_code, commit = git("rev-parse", "HEAD")
    status_code, status = git("status", "--porcelain")
    if commit_code != 0 or status_code != 0:
        return {"commit": None, "dirty": None, "detail": "无法读取 Git 版本"}
    changed = [line for line in status.splitlines() if line.strip()]
    return {"commit": commit, "dirty": bool(changed), "changed_path_count": len(changed)}


def read_flat_yaml(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
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


def write_flat_yaml(path: Path, values: dict[str, str]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}: {value}\n")


def append_jsonl(path: Path, value: dict) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def load_run_manifest(repo: Path, run_id: str) -> tuple[Path, dict[str, str]]:
    if not RUN_ID_RE.fullmatch(run_id):
        raise ValueError("run 必须是 run-<UUIDv4>")
    matches = []
    experiments = repo / "evolution/experiments"
    if experiments.is_dir():
        for experiment in experiments.iterdir():
            run_dir = experiment / "runs" / run_id
            if run_dir.is_dir() and not run_dir.is_symlink():
                matches.append(run_dir)
    if len(matches) != 1:
        raise ValueError(f"unknown or ambiguous run: {run_id}")
    run_dir = matches[0]
    return run_dir, read_flat_yaml(run_dir / "run.yaml")


def validate_trial_row(run_id: str, row: dict) -> None:
    missing = [field for field in RESULT_FIELDS if field not in row]
    if missing:
        raise ValueError("trial row missing fields: " + ", ".join(missing))
    if row["run_id"] != run_id:
        raise ValueError("trial row run_id must match the selected Run")
    for field in ("trial_id", "input_id", "observation"):
        if not isinstance(row[field], str) or not row[field].strip():
            raise ValueError(f"{field} must be a non-empty string")
    if row["status"] not in RESULT_STATUSES:
        raise ValueError("status must be one of completed/failed/error/skipped")
    if row["status"] in {"failed", "error"} and not (
        isinstance(row.get("failure_reason"), str) and row["failure_reason"].strip()
    ):
        raise ValueError("failed/error trial must carry failure_reason")
    if "evidence_ref" in row and not (
        isinstance(row["evidence_ref"], str) and row["evidence_ref"].strip()
    ):
        raise ValueError("evidence_ref must be a non-empty string when provided")


def command_init(repo: Path, args: argparse.Namespace) -> None:
    match = EXPERIMENT_RE.fullmatch(args.experiment)
    if not match or match.group(1) != args.agent:
        raise ValueError("experiment must be EXP-<agent-id>-NNN for the selected agent")
    experiment = repo / "evolution/experiments" / args.experiment
    if not experiment.is_dir() or experiment.is_symlink():
        raise ValueError(f"unknown experiment: {args.experiment}")
    change = read_flat_yaml(experiment / "change.yaml")
    baseline_ref = args.baseline_ref or change.get("baseline_ref", "")
    if not valid_baseline_ref(baseline_ref):
        raise ValueError("baseline_ref must be git:<commit>, release:<id> or none:first-experiment")
    contract = resolve(args.source, repo=repo)
    if contract.get("agent_id") != args.agent:
        raise ValueError("source agent does not match --agent")
    run_id = "run-" + str(uuid.uuid4())
    run_dir = experiment / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    try:
        inputs = {
            "schema_version": "1.0",
            "run_id": run_id,
            "source_id": contract["source_id"],
            "source_kind": contract["source_kind"],
            "baseline_ref": baseline_ref,
            "created_at": utc_now(),
            "harness_trees": {
                "workspace": tree_digest(repo, Path(contract["workspace"])),
                "presets": tree_digest(repo, Path(contract["presets"])),
                "managed": tree_digest(repo, Path(contract["managed"])),
            },
            "reference_tree": tree_digest(repo, Path(contract["reference_root"])) if contract.get("reference_root") else None,
            "git_version": git_version(repo),
        }
        plan_ref = ""
        if args.plan:
            plan_path = repo_relative(repo, args.plan)
            if not plan_path.is_file() or plan_path.is_symlink():
                raise ValueError(f"plan file missing or unsafe: {args.plan}")
            inputs["plan_sha256"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            plan_ref = args.plan
        if args.model:
            inputs["model"] = args.model
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
            "baseline_ref": baseline_ref,
        }
        if plan_ref:
            manifest["plan_ref"] = plan_ref
        write_flat_yaml(run_dir / "run.yaml", manifest)
    except BaseException:
        shutil.rmtree(run_dir)
        raise
    print(run_id)


def command_record(repo: Path, args: argparse.Namespace) -> None:
    run_dir, manifest = load_run_manifest(repo, args.run)
    if manifest.get("status") not in {"planned", "running"}:
        raise ValueError("finalized Run refuses new results")
    if args.trial_file == "-":
        row = json.loads(sys.stdin.read())
    else:
        row = json.loads(Path(args.trial_file).read_text(encoding="utf-8"))
    if not isinstance(row, dict):
        raise ValueError("trial must be a JSON object")
    validate_trial_row(args.run, row)
    results = run_dir / "results.jsonl"
    if results.is_file():
        for line in results.read_text(encoding="utf-8").splitlines():
            if line.strip() and json.loads(line).get("trial_id") == row["trial_id"]:
                raise ValueError("trial_id duplicated inside the Run")
    append_jsonl(results, row)
    if manifest["status"] == "planned":
        manifest["status"] = "running"
        write_flat_yaml(run_dir / "run.yaml", manifest)
    print(args.run)


def command_gap(repo: Path, args: argparse.Namespace) -> None:
    run_dir, manifest = load_run_manifest(repo, args.run)
    if manifest.get("status") in FINAL_STATUSES:
        raise ValueError("finalized Run refuses new gaps")
    if not args.title.strip() or not args.observed.strip() or not args.next_step.strip():
        raise ValueError("gap 必须提供非空标题、观察和下一步")
    row = {
        "gap_id": "gap-" + str(uuid.uuid4()),
        "run_id": args.run,
        "classification": args.classification,
        "title": args.title.strip(),
        "observed": args.observed.strip(),
        "next_step": args.next_step.strip(),
    }
    if args.evidence:
        row["evidence_ref"] = args.evidence
    append_jsonl(run_dir / "gaps.jsonl", row)
    print(row["gap_id"])


def command_finalize(repo: Path, args: argparse.Namespace) -> None:
    run_dir, manifest = load_run_manifest(repo, args.run)
    if manifest.get("status") not in {"planned", "running"}:
        raise ValueError("Run is already finalized")
    results = run_dir / "results.jsonl"
    counts = {name: 0 for name in RESULT_STATUSES}
    if results.is_file():
        for line in results.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            validate_trial_row(args.run, row)
            counts[row["status"]] += 1
    summary = {"schema_version": "1.0", "run_id": args.run, "trial_count": sum(counts.values()), **counts}
    summary_path = run_dir / "summary.json"
    with summary_path.open("w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    manifest["status"] = args.status
    manifest["finished_at"] = utc_now()
    manifest["results_sha256"] = hashlib.sha256(results.read_bytes() if results.is_file() else b"").hexdigest()
    manifest["summary_sha256"] = hashlib.sha256(summary_path.read_bytes()).hexdigest()
    gaps = run_dir / "gaps.jsonl"
    if gaps.is_file():
        manifest["gaps_sha256"] = hashlib.sha256(gaps.read_bytes()).hexdigest()
    write_flat_yaml(run_dir / "run.yaml", manifest)
    print(args.run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=REPO, help="仓库根目录")
    commands = parser.add_subparsers(dest="command", required=True)
    init_parser = commands.add_parser("init", help="创建 Run 并记录输入身份")
    init_parser.add_argument("--agent", required=True)
    init_parser.add_argument("--experiment", required=True)
    init_parser.add_argument("--source", required=True, help="当前支持 experiment:<id>")
    init_parser.add_argument("--kind", default="research", choices=RUN_KINDS)
    init_parser.add_argument("--baseline-ref", help="默认读取 Experiment change.yaml")
    init_parser.add_argument("--plan", help="可选研究计划的仓库相对路径")
    init_parser.add_argument("--model", help="可选的实际模型标识")
    record_parser = commands.add_parser("record", help="追加一条观察")
    record_parser.add_argument("--run", required=True)
    record_parser.add_argument("trial_file", help="Trial JSON 文件；- 表示标准输入")
    gap_parser = commands.add_parser("gap", help="追加一个研究缺口")
    gap_parser.add_argument("--run", required=True)
    gap_parser.add_argument("--classification", required=True, choices=GAP_CLASSIFICATIONS)
    gap_parser.add_argument("--title", required=True)
    gap_parser.add_argument("--observed", required=True)
    gap_parser.add_argument("--next-step", required=True)
    gap_parser.add_argument("--evidence", help="可选证据引用")
    finalize_parser = commands.add_parser("finalize", help="生成摘要并封存 Run")
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
