from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import signal
import shutil
import subprocess
import tarfile
import tempfile
import time
import unittest
import uuid
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSPECT_SOURCE = ROOT / ".agents/skills/legacy-asset-intake/scripts/inspect_source.py"
VALIDATE_REPOSITORY = ROOT / ".agents/skills/harness-evolution/scripts/validate_repository.py"
VALIDATE_EXPERIMENT = ROOT / ".agents/skills/research-eval/scripts/validate_experiment.py"
EVALUATION_CONTRACT = ROOT / ".agents/skills/research-eval/scripts/evaluation_contract.py"
RUN_RECORD = ROOT / "runtime/adapters/dsh-container/run_record.py"
DSH_EVAL = ROOT / "runtime/adapters/dsh-container/dsh-eval"
SCENARIO_ANALYSIS = ROOT / "runtime/adapters/dsh-container/scenario_analysis.py"
EXPERIMENT_ID = "EXP-security-operations-expert-001"
AGENT_ID = "security-operations-expert"


def run_json(script: Path, *args: object, cwd: Path = ROOT) -> tuple[subprocess.CompletedProcess[str], dict]:
    completed = subprocess.run(
        ["python3", str(script), *(str(value) for value in args)],
        cwd=cwd,
        text=True,
        capture_output=True,
        check=False,
        timeout=180,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:  # pragma: no cover - assertion detail
        raise AssertionError(f"输出不是 JSON：{completed.stdout}\nstderr={completed.stderr}") from exc
    return completed, payload


def error_codes(payload: dict) -> set[str]:
    return {item.get("code", "") for item in payload.get("errors", [])}


def copy_repository(destination: Path) -> Path:
    target = destination / "repo"
    shutil.copytree(
        ROOT,
        target,
        ignore=shutil.ignore_patterns(".git", ".pytest_cache", "__pycache__", "*.pyc"),
    )
    return target


def case_contract_digest(path: Path, case_ids: list[str]) -> str:
    spec = importlib.util.spec_from_file_location("evaluation_contract_digest", EVALUATION_CONTRACT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.evaluation_digest(path, case_ids)


def write_minimal_experiment(root: Path, *, status: str = "active", outcome: str | None = None) -> Path:
    experiment_id = "EXP-example-agent-001"
    experiment = root / "evolution/experiments" / experiment_id
    (experiment / "candidate").mkdir(parents=True)
    evaluation = root / "agents/example-agent/evaluation.md"
    evaluation.parent.mkdir(parents=True)
    evaluation.write_text(
        """# 示例评测

#### U-EXAMPLE-001 最小研究输入

**用户输入**

> 最小输入。

**预期**

观察与输入一致。
""",
        encoding="utf-8",
    )
    lines = [
        'schema_version: "1.0"',
        "experiment_id: EXP-example-agent-001",
        "agent_id: example-agent",
        "baseline_ref: none:first-experiment",
        f"status: {status}",
    ]
    if outcome is not None:
        lines.append(f"outcome: {outcome}")
    (experiment / "change.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (experiment / "hypothesis.md").write_text("# 假设\n\n比较一个具体变化。\n", encoding="utf-8")
    (experiment / "candidate/harness.yaml").write_text('schema_version: "1.0"\nvalue: candidate\n', encoding="utf-8")
    if status == "completed":
        (experiment / "decision.md").write_text("# 决定\n\n根据观察停止本实验。\n", encoding="utf-8")
    return experiment


def release_records(release: Path) -> list[dict]:
    records = []
    for path in sorted(release.rglob("*"), key=lambda item: item.relative_to(release).as_posix()):
        relative = path.relative_to(release).as_posix()
        if not path.is_file() or relative in {"manifest.yaml", "artifact-manifest.json"}:
            continue
        data = path.read_bytes()
        records.append({"path": relative, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)})
    return records


def write_research_release(repository: Path, name: str = "security-operations-expert-v1.0.0") -> Path:
    release = repository / "releases" / name
    release.mkdir(parents=True)
    (release / "harness.yaml").write_text('schema_version: "1.0"\nentry: dsh/workspace\n', encoding="utf-8")
    (release / "runtime.yaml").write_text('schema_version: "1.0"\nruntime: dsh\n', encoding="utf-8")
    (release / "evaluation.md").write_text("# 研究总结\n\n已记录限定范围的观察。\n", encoding="utf-8")
    (release / "README.md").write_text("# Research Release\n\n用于复现研究，不是生产部署批准。\n", encoding="utf-8")
    records = release_records(release)
    raw = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()
    (release / "manifest.yaml").write_text(
        "\n".join(
            [
                'schema_version: "1.0"',
                f"release_id: {name}",
                "agent_id: security-operations-expert",
                'version: "1.0.0"',
                f"source_experiment: {EXPERIMENT_ID}",
                "source_commit: " + "a" * 40,
                "evaluation_ref: evaluation.md",
                'runtime_compatibility: "DSH c291e7961"',
                f"artifact_digest: sha256:{digest}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (release / "artifact-manifest.json").write_text(
        json.dumps({"schema_version": "1.0", "tree_sha256": digest, "files": records}, ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    return release


class SourceInspectorTests(unittest.TestCase):
    def test_clean_directory_is_read_without_execution(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            source.mkdir()
            (source / "AGENTS.md").write_text("# 示例\n", encoding="utf-8")
            completed, payload = run_json(INSPECT_SOURCE, source)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(payload["schema_version"], "1.0")
        self.assertFalse(payload["errors"])

    def test_zip_path_traversal_is_rejected_without_extracting(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "source.zip"
            with zipfile.ZipFile(archive, "w") as handle:
                handle.writestr("../escape.txt", "not extracted")
            completed, payload = run_json(INSPECT_SOURCE, archive)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("PATH_TRAVERSAL", error_codes(payload))
            self.assertFalse((root / "escape.txt").exists())

    def test_tar_path_traversal_is_rejected_without_extracting(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "source.tar"
            payload_file = root / "payload.txt"
            payload_file.write_text("not extracted", encoding="utf-8")
            with tarfile.open(archive, "w") as handle:
                handle.add(payload_file, arcname="../escape.txt")
            payload_file.unlink()
            completed, payload = run_json(INSPECT_SOURCE, archive)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("PATH_TRAVERSAL", error_codes(payload))
            self.assertFalse((root / "escape.txt").exists())

    def test_sensitive_filename_is_reported_without_value(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            source.mkdir()
            secret = "do-not-print-this-value"
            (source / ".env").write_text("TOKEN=" + secret, encoding="utf-8")
            completed, payload = run_json(INSPECT_SOURCE, source)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("SENSITIVE_FILENAME", {item["code"] for item in payload["warnings"]})
        self.assertNotIn(secret, completed.stdout)


class RepositoryValidatorTests(unittest.TestCase):
    def test_current_repository_passes_research_contract(self) -> None:
        completed, payload = run_json(VALIDATE_REPOSITORY, ROOT)
        self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))
        self.assertTrue(payload["valid"])
        self.assertIn("不代表 Experiment 结果", payload["scope"])

    def test_llm_api_key_ignore_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            gitignore = repository / ".gitignore"
            gitignore.write_text(
                gitignore.read_text(encoding="utf-8").replace("*.llm-api-key", "*.local-key"),
                encoding="utf-8",
            )
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("LLM_KEY_IGNORE", error_codes(payload))

    def test_agent_evaluation_source_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            (repository / "agents/security-operations-expert/evaluation.md").unlink()
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("AGENT_SOURCE", error_codes(payload))

    def test_memory_must_be_explicit_true(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            config = repository / ".codex/config.toml"
            config.write_text(config.read_text(encoding="utf-8").replace("memories = true", 'memories = "true"'), encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("MEMORY", error_codes(payload))

    def test_acceptance_matrix_has_exactly_eleven_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            matrix = repository / "docs/ai-agent-harness项目验收矩阵.md"
            matrix.write_text(matrix.read_text(encoding="utf-8") + "\n新增 `PA-12`。\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("MATRIX_COUNT", error_codes(payload))

    def test_review_principles_link_is_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            agents = repository / "AGENTS.md"
            agents.write_text(
                agents.read_text(encoding="utf-8").replace(
                    "](docs/项目审查原则.md)", "](docs/不存在.md)"
                ),
                encoding="utf-8",
            )
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("REVIEW_LINK", error_codes(payload))

    def test_retired_production_skill_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            retired = repository / ".agents/skills/delivery-review"
            retired.mkdir()
            (retired / "SKILL.md").write_text("---\nname: delivery-review\n---\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("RETIRED_SKILL", error_codes(payload))

    def test_physical_baseline_and_current_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            (repository / "evolution/baselines").mkdir()
            current = repository / "agents/security-operations-expert/current"
            current.mkdir()
            (current / "harness.yaml").write_text("value: duplicate\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        codes = error_codes(payload)
        self.assertIn("BASELINES_FORBIDDEN", codes)
        self.assertIn("CURRENT_FORBIDDEN", codes)

    def test_invalid_experiment_baseline_reference_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            change = repository / f"evolution/experiments/{EXPERIMENT_ID}/change.yaml"
            change.write_text(change.read_text(encoding="utf-8").replace("none:first-experiment", "latest"), encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("EXPERIMENT_BASELINE_REF", error_codes(payload))

    def test_controlled_standard_hash_drift_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            controlled = repository / "docs/standards/Harness_Asset_Repository规范_v1.0.md"
            controlled.write_text(controlled.read_text(encoding="utf-8") + "\nchanged\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("STANDARD_HASH", error_codes(payload))

    def test_valid_research_release_passes_and_tamper_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            release = write_research_release(repository)
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
            self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))
            (release / "harness.yaml").write_text('schema_version: "1.0"\nentry: changed\n', encoding="utf-8")
            completed, payload = run_json(VALIDATE_REPOSITORY, repository)
        self.assertNotEqual(completed.returncode, 0)
        self.assertTrue({"RELEASE_DIGEST", "RELEASE_ARTIFACT"} <= error_codes(payload))


class ResearchEvalTests(unittest.TestCase):
    def test_current_experiment_passes(self) -> None:
        experiment = ROOT / "evolution/experiments" / EXPERIMENT_ID
        completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
        self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))
        self.assertTrue(payload["valid"])

    def test_active_minimal_experiment_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            experiment = write_minimal_experiment(Path(temp))
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
        self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))

    def test_completed_experiment_requires_outcome(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            experiment = write_minimal_experiment(Path(temp), status="completed")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("EXPERIMENT_OUTCOME", error_codes(payload))

    def test_result_separates_execution_from_verdict_and_requires_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            experiment = write_minimal_experiment(Path(temp))
            run_id = "run-" + str(uuid.uuid4())
            run_dir = experiment / "runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "run.yaml").write_text(
                "\n".join(
                    [
                        'schema_version: "2.0"',
                        f"run_id: {run_id}",
                        "experiment_id: EXP-example-agent-001",
                        "agent_id: example-agent",
                        "kind: research",
                        "status: running",
                        "evaluation_ref: agents/example-agent/evaluation.md",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            evaluation = experiment.parents[2] / "agents/example-agent/evaluation.md"
            (run_dir / "inputs.lock.json").write_text(
                json.dumps(
                    {
                        "schema_version": "2.0",
                        "run_id": run_id,
                        "evaluation_sha256": case_contract_digest(evaluation, ["U-EXAMPLE-001"]),
                        "evaluation_cases": [
                            {
                                "case_id": "U-EXAMPLE-001",
                                "title": "最小研究输入",
                                "inputs": ["最小输入。"],
                                "expected_behavior": "观察与输入一致。",
                            }
                        ],
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            evidence = run_dir / "evidence/U-EXAMPLE-001/checks.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text('{"checked":true}\n', encoding="utf-8")
            row = {
                "run_id": run_id,
                "trial_id": "trial-1",
                "input_id": "U-EXAMPLE-001",
                "execution_status": "completed",
                "verdict": "passed",
                "observation": "观察到预期变化",
                "evidence_ref": "evidence/U-EXAMPLE-001",
            }
            (run_dir / "results.jsonl").write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
            self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))
            del row["observation"]
            (run_dir / "results.jsonl").write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("RESULT_FIELDS", error_codes(payload))

    def test_sealed_run_keeps_historical_evaluation_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            experiment = write_minimal_experiment(Path(temp), status="completed", outcome="adopt")
            run_id = "run-" + str(uuid.uuid4())
            run_dir = experiment / "runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "run.yaml").write_text(
                "\n".join(
                    [
                        'schema_version: "2.0"',
                        f"run_id: {run_id}",
                        "experiment_id: EXP-example-agent-001",
                        "agent_id: example-agent",
                        "kind: research",
                        "status: running",
                        "evaluation_ref: agents/example-agent/evaluation.md",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            evaluation = experiment.parents[2] / "agents/example-agent/evaluation.md"
            old_digest = case_contract_digest(evaluation, ["U-EXAMPLE-001"])
            (run_dir / "inputs.lock.json").write_text(
                json.dumps(
                    {
                        "schema_version": "2.0",
                        "run_id": run_id,
                        "evaluation_sha256": old_digest,
                        "evaluation_cases": [
                            {
                                "case_id": "U-EXAMPLE-001",
                                "title": "最小研究输入",
                                "inputs": ["最小输入。"],
                                "expected_behavior": "观察与输入一致。",
                            }
                        ],
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            evidence = run_dir / "evidence/U-EXAMPLE-001/checks.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text('{"checked":true}\n', encoding="utf-8")
            row = {
                "run_id": run_id,
                "trial_id": "trial-1",
                "input_id": "U-EXAMPLE-001",
                "execution_status": "completed",
                "verdict": "passed",
                "observation": "观察到预期变化",
                "evidence_ref": "evidence/U-EXAMPLE-001",
            }
            (run_dir / "results.jsonl").write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            (run_dir / "summary.json").write_text(
                json.dumps(
                    {
                        "schema_version": "2.0",
                        "run_id": run_id,
                        "trial_count": 1,
                        "execution_status_counts": {"completed": 1, "error": 0, "skipped": 0},
                        "verdict_counts": {"passed": 1, "failed": 0, "inconclusive": 0},
                        "overall_verdict": "passed",
                    }
                ) + "\n",
                encoding="utf-8",
            )
            changed_evaluation = evaluation.read_text(encoding="utf-8").replace(
                "观察与输入一致。", "观察与当前输入一致。"
            )
            evaluation.write_text(changed_evaluation, encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("RUN_EVALUATION_HASH", error_codes(payload))
            self.assertIn("RUN_EVALUATION_CASES", error_codes(payload))
            manifest = run_dir / "run.yaml"
            manifest.write_text(
                manifest.read_text(encoding="utf-8").replace("status: running", "status: completed")
                + f"results_sha256: {hashlib.sha256((run_dir / 'results.jsonl').read_bytes()).hexdigest()}\n"
                + f"summary_sha256: {hashlib.sha256((run_dir / 'summary.json').read_bytes()).hexdigest()}\n",
                encoding="utf-8",
            )
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
        self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))

    def test_local_plan_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            experiment = write_minimal_experiment(Path(temp))
            (experiment / "evaluation").mkdir()
            (experiment / "evaluation/plan.yaml").write_text("cases: []\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("EVALUATION_PLAN", error_codes(payload))


class RunRecordTests(unittest.TestCase):
    def test_flat_yaml_round_trip_preserves_escaped_strings(self) -> None:
        spec = importlib.util.spec_from_file_location("run_record_contract", RUN_RECORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "run.yaml"
            expected = {"schema_version": "2.0", "source_id": 'line\\break:"值"'}
            module.write_flat_yaml(path, expected)
            self.assertEqual(module.read_flat_yaml(path), expected)

    def test_report_distinguishes_skipped_from_execution_error(self) -> None:
        spec = importlib.util.spec_from_file_location("run_record_contract", RUN_RECORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        rows = [
            {"input_id": "U-ONE", "execution_status": "completed", "verdict": "inconclusive",
             "observation": "已完成", "evidence_ref": "evidence/U-ONE"},
            {"input_id": "U-TWO", "execution_status": "skipped", "verdict": "inconclusive",
             "observation": "未执行", "evidence_ref": "evidence/U-TWO"},
            {"input_id": "U-THREE", "execution_status": "error", "verdict": "inconclusive",
             "observation": "执行错误", "evidence_ref": "evidence/U-THREE"},
        ]
        summary = {
            "trial_count": 3,
            "execution_status_counts": {"completed": 1, "error": 1, "skipped": 1},
            "machine_trial_verdict_counts": {"passed": 0, "failed": 0, "inconclusive": 3},
            "machine_overall_verdict": "inconclusive",
            "review_status": "not_requested",
            "reviewed_case_verdict_counts": None,
            "effective_verdict": "inconclusive",
        }
        manifest = {
            "run_id": "run-test", "experiment_id": "EXP-test-001", "agent_id": "test",
            "status": "completed", "created_at": "2026-01-01T00:00:00Z",
            "finished_at": "2026-01-01T00:01:00Z",
        }
        with tempfile.TemporaryDirectory() as temp:
            report = Path(temp) / "report.md"
            module.write_report(report, manifest, summary, rows, "api")
            text = report.read_text(encoding="utf-8")
        self.assertIn("| 机器 Trial | 3 | 1 | 1 | 1 | 0 | 0 | 3 |", text)
        self.assertIn("| `U-ONE` |  |  | 已完成 | 无法判定 | - |", text)
        self.assertIn("| ~~`U-TWO`~~ |  |  | 已跳过 | 无法判定 | - |", text)
        self.assertIn("| `U-THREE` |  |  | 执行错误 | 无法判定 | - |", text)
        self.assertNotIn("~~`U-THREE`~~", text)

    def test_lifecycle_records_and_seals_observations(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            init = subprocess.run(
                [
                    "python3", str(repository / "runtime/adapters/dsh-container/run_record.py"),
                    "--repo", str(repository), "init", "--source", f"experiment:{EXPERIMENT_ID}",
                    "--case", "U-INS-001", "--kind", "research",
                ],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(init.returncode, 0, init.stderr)
            run_id = init.stdout.strip()
            run_dir = repository / f"evolution/experiments/{EXPERIMENT_ID}/runs/{run_id}"
            evidence = run_dir / "evidence/U-INS-001/checks.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text('{"loaded":true}\n', encoding="utf-8")
            trial = repository / "trial.json"
            trial.write_text(
                json.dumps(
                    {
                        "run_id": run_id,
                        "trial_id": "trial-1",
                        "input_id": "U-INS-001",
                        "execution_status": "completed",
                        "verdict": "passed",
                        "observation": "目标会话观察到新增 Skill",
                        "evidence_ref": "evidence/U-INS-001",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            base = ["python3", str(repository / "runtime/adapters/dsh-container/run_record.py"), "--repo", str(repository)]
            record = subprocess.run(base + ["record", "--run", run_id, str(trial)], cwd=repository, text=True, capture_output=True, check=False, timeout=180)
            self.assertEqual(record.returncode, 0, record.stderr)
            finalize = subprocess.run(base + ["finalize", "--run", run_id, "--status", "completed"], cwd=repository, text=True, capture_output=True, check=False, timeout=180)
            self.assertEqual(finalize.returncode, 0, finalize.stderr)
            sealed = subprocess.run(base + ["record", "--run", run_id, str(trial)], cwd=repository, text=True, capture_output=True, check=False, timeout=180)
            self.assertNotEqual(sealed.returncode, 0)
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["execution_status_counts"]["completed"], 1)
            self.assertEqual(summary["machine_trial_verdict_counts"]["passed"], 1)
            self.assertEqual(summary["machine_overall_verdict"], "passed")
            self.assertEqual(summary["review_status"], "not_requested")
            self.assertEqual(summary["effective_verdict"], "passed")
            self.assertIn('baseline_ref: "none:first-experiment"', (run_dir / "run.yaml").read_text(encoding="utf-8"))
            inputs = json.loads((run_dir / "inputs.lock.json").read_text(encoding="utf-8"))
            self.assertIn("git_version", inputs)
            self.assertEqual(
                [case["case_id"] for case in inputs["evaluation_cases"]],
                ["U-INS-001"],
            )
            self.assertIn(
                'evaluation_ref: "agents/security-operations-expert/evaluation.md"',
                (run_dir / "run.yaml").read_text(encoding="utf-8"),
            )

    def test_unselected_input_is_rejected(self) -> None:
        spec = importlib.util.spec_from_file_location("run_record_contract", RUN_RECORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        row = {
            "run_id": "run-" + str(uuid.uuid4()),
            "trial_id": "trial-1",
            "input_id": "T-NOT-SELECTED",
            "execution_status": "completed",
            "verdict": "passed",
            "observation": "不应写入",
            "evidence_ref": "evidence/checks.json",
        }
        with self.assertRaisesRegex(ValueError, "selected"):
            module.validate_trial_row(row["run_id"], row, {"U-INS-001"})

    def test_open_run_requires_full_case_snapshot(self) -> None:
        spec = importlib.util.spec_from_file_location("run_record_contract", RUN_RECORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            run_dir = Path(temp)
            (run_dir / "inputs.lock.json").write_text(
                json.dumps({"evaluation_selection": {"case_ids": ["T-LEGACY"]}}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "Case 锁定"):
                module.selected_input_ids(run_dir)

    def test_execution_error_requires_inconclusive_verdict_and_reason(self) -> None:
        spec = importlib.util.spec_from_file_location("run_record_contract", RUN_RECORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        base = {
            "run_id": "run-" + str(uuid.uuid4()),
            "trial_id": "trial-1",
            "input_id": "input-1",
            "execution_status": "error",
            "verdict": "failed",
            "observation": "legacy row",
            "evidence_ref": "evidence/checks.json",
        }
        with self.assertRaisesRegex(ValueError, "inconclusive"):
            module.validate_trial_row(base["run_id"], base)
        base["verdict"] = "inconclusive"
        with self.assertRaisesRegex(ValueError, "failure_reason"):
            module.validate_trial_row(base["run_id"], base)

    def test_completed_run_requires_every_selected_case(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            script = repository / "runtime/adapters/dsh-container/run_record.py"
            initialized = subprocess.run(
                ["python3", str(script), "--repo", str(repository), "init",
                 "--source", f"experiment:{EXPERIMENT_ID}", "--case", "U-INS-001"],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180,
            )
            self.assertEqual(initialized.returncode, 0, initialized.stderr)
            finalized = subprocess.run(
                ["python3", str(script), "--repo", str(repository), "finalize",
                 "--run", initialized.stdout.strip(), "--status", "completed"],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180,
            )
        self.assertNotEqual(finalized.returncode, 0)
        self.assertIn("every selected Case", finalized.stderr)


class DshEvalTests(unittest.TestCase):
    REQUIRED_RUNTIME_ENV = (
        "DEEPSEEK_API_KEY",
        "SEC_OPS_MCP_URL",
        "SEC_OPS_MCP_TOKEN",
        "INSPECTION_MCP_URL",
        "INSPECTION_MCP_TOKEN",
        "LOCAL_LLM_BASE_URL",
        "LOCAL_LLM_API_KEY",
    )

    def test_readable_view_preserves_json_and_deduplicates_tool_content(self) -> None:
        spec = importlib.util.spec_from_file_location("scenario_analysis_view_test", SCENARIO_ANALYSIS)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp)
            plain = {"text": "第一行\n第二行", "value": [1, True, None]}
            (run / "plain.json").write_text(
                json.dumps(plain, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
            )
            shared = [{"type": "text", "text": "重复内容" * 1000}]
            events = [
                {
                    "event": {"type": "tool/result", "data": {"message": {"content": [{
                        "toolCallId": call_id, "content": shared,
                    }]}}},
                    "session_log": "session.v3.jsonl",
                }
                for call_id in ("call-a", "call-b")
            ]
            (run / "tools.jsonl").write_text(
                "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in events),
                encoding="utf-8",
            )
            descriptors = module._write_readable_views(
                run, {"scene-01": ["plain.json", "tools.jsonl"]},
            )["scene-01"]
            lines = [
                line
                for item in descriptors
                for line in (run / item["path"]).read_text(encoding="utf-8").splitlines()
            ]
            json_chunks, content_chunks = {}, {}
            for line in lines:
                if line.startswith("J\t"):
                    _, source, record, fraction, chunk = line.split("\t", 4)
                    json_chunks.setdefault((int(source), int(record)), []).append(
                        (int(fraction.split("/", 1)[0]), chunk)
                    )
                elif line.startswith("C\t"):
                    _, digest, fraction, chunk = line.split("\t", 3)
                    content_chunks.setdefault(digest, []).append(
                        (int(fraction.split("/", 1)[0]), chunk)
                    )
            values = {
                key: json.loads("".join(chunk for _, chunk in sorted(chunks)))
                for key, chunks in json_chunks.items()
            }
            canonical = json.dumps(shared, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            digest = hashlib.sha256(canonical.encode()).hexdigest()
            restored = "".join(chunk for _, chunk in sorted(content_chunks[digest]))
            manifest = json.loads(
                (run / "evidence/analysis/readable/manifest.json").read_text(encoding="utf-8")
            )

        self.assertEqual(values[(1, 1)], plain)
        self.assertEqual([values[(2, index)]["event"]["data"]["message"]["content"][0]["toolCallId"]
                          for index in (1, 2)], ["call-a", "call-b"])
        self.assertTrue(all(
            values[(2, index)]["event"]["data"]["message"]["content"][0]["content"]
            == {"$analysis_content_ref": digest} for index in (1, 2)
        ))
        self.assertEqual(json.loads(restored), shared)
        self.assertEqual(len(content_chunks), 1)
        self.assertEqual(manifest["groups"][0]["content_refs"], 1)
        self.assertTrue(all(item["bundle"] == "scene-01" for item in descriptors))

    def test_finding_accepts_counterexample_and_empty_tool_evidence(self) -> None:
        spec = importlib.util.spec_from_file_location("scenario_analysis_finding_test", SCENARIO_ANALYSIS)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            run = Path(temp)
            (run / "evidence/support").mkdir(parents=True)
            (run / "evidence/counterexample").mkdir(parents=True)
            (run / "evidence/support/response.json").write_text("{}\n", encoding="utf-8")
            (run / "evidence/counterexample/tools.jsonl").write_text("", encoding="utf-8")
            finding = {
                "category": "harness_mechanism",
                "observed_gap": "支持 Case 暴露能力缺口。",
                "root_cause_hypothesis": "Harness 缺少对应约束。",
                "support_case_ids": ["support"],
                "counterexample_case_ids": ["counterexample"],
                "evidence_refs": [
                    "evidence/support/response.json",
                    "evidence/counterexample/tools.jsonl",
                ],
                "alternative": "也可能是外部数据差异。",
                "falsification": "固定外部数据后重跑。",
            }
            parsed = module._parse_findings([finding], ["support", "counterexample"], run)
            (run / "evidence/counterexample/response.json").write_text("", encoding="utf-8")

            self.assertEqual(parsed, [finding])
            self.assertFalse(module._material_ref(
                run, "evidence/counterexample/response.json",
            ))

    def test_analysis_output_accepts_only_plain_or_single_json_fence(self) -> None:
        spec = importlib.util.spec_from_file_location("scenario_analysis_json_test", SCENARIO_ANALYSIS)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        expected = {"case_reviews": [], "findings": []}

        self.assertEqual(module._parse_json_output(json.dumps(expected)), expected)
        self.assertEqual(module._parse_json_output(
            f"```json\n{json.dumps(expected)}\n```",
        ), expected)
        with self.assertRaises(json.JSONDecodeError):
            module._parse_json_output(f"结果如下：\n```json\n{json.dumps(expected)}\n```")

    def test_analysis_access_accepts_successful_empty_file_read(self) -> None:
        spec = importlib.util.spec_from_file_location("scenario_analysis_access_test", SCENARIO_ANALYSIS)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        required_path = "evidence/analysis/readable/scene-01/part-001.txt"
        raw = {
            "tool_names": ["glob", "grep", "read"],
            "tool_accesses": [
                {
                    "name": "read",
                    "arguments": {"file_path": required_path},
                    "result": {"is_error": False, "read": {
                        "path": f"/work/evaluation-run/{required_path}",
                        "offset": 1, "line_numbers": [1], "total_lines": 1,
                    }},
                },
                {
                    "name": "read",
                    "arguments": {"file_path": "evidence/U-INS-001/tools.jsonl"},
                    "result": {"is_error": False, "read": {
                        "path": "/work/evaluation-run/evidence/U-INS-001/tools.jsonl",
                        "offset": 1, "line_numbers": [], "total_lines": 0,
                    }},
                },
            ],
        }
        required = [{
            "bundle": "scene-01", "path": required_path,
            "total_lines": 1, "sha256": "0" * 64,
        }]

        module._validate_evidence_access(raw, required)
        raw["tool_accesses"][1]["result"]["read"]["offset"] = 2
        with self.assertRaisesRegex(ValueError, "analysis-tools-invalid"):
            module._validate_evidence_access(raw, required)

    def runtime_fixture(self, root: Path, *, mode: str = "pass") -> tuple[Path, dict[str, str], Path]:
        repository = copy_repository(root)
        image_fingerprint = subprocess.check_output(
            [
                "python3",
                str(repository / "runtime/adapters/dsh-container/source_contract.py"),
                "--source",
                "experiment:EXP-security-operations-expert-006",
                "--field",
                "image.build_fingerprint",
            ],
            cwd=repository,
            text=True,
        ).strip()
        command_log = root / "dsh-dev.jsonl"
        fake_dsh = root / "fake-dsh-dev"
        fake_dsh.write_text(
            f"""#!/usr/bin/env python3
import json
import os
import sys

with open(os.environ["TEST_DSH_LOG"], "a", encoding="utf-8") as handle:
    handle.write(json.dumps(sys.argv[1:]) + "\\n")
if sys.argv[1] == "url":
    print("http://127.0.0.1:3090/?token=opaque-eval-auth-token")
elif sys.argv[1] == "up":
    print(json.dumps({{
        "image_tag": "ai-agent-harness/dsh:test",
        "image_id": "sha256:{'a' * 64}",
        "image_ref": "ai-agent-harness/dsh:test@sha256:{'a' * 64}",
        "image_build_fingerprint": "{image_fingerprint}",
        "platform": "linux/amd64",
    }}))
else:
    print("{{}}")
""",
            encoding="utf-8",
        )
        fake_dsh.chmod(0o755)
        fake_browser = root / "fake-browser"
        fake_browser.write_text(
            """#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path

payload = json.load(sys.stdin)
mode = os.environ["TEST_BROWSER_MODE"]
target_route = {
    "provider": "deepseek-official",
    "model": "deepseek-flash",
    "maxTokens": 256000,
    "reasoningEffort": "off",
}
if payload.get("operation") == "review":
    if os.environ.get("TEST_ANALYSIS_MODE") == "unavailable":
        raise SystemExit(9)
    if payload.get("workspace") != "/work/evaluation-run" \
            or payload.get("preset_id") != "scenario-analysis" \
            or payload.get("judge_preset_id") != "scenario-analysis" \
            or payload.get("model_route") != target_route:
        raise SystemExit(6)
    results = []
    for scene_index, scene in enumerate(payload["scenes"]):
        repairing = "session_id" in scene
        review_input = json.loads(scene["prior_prompts"][0] if repairing else scene["prompt"])
        if repairing:
            repair = json.loads(scene["prompt"])
            if repair.get("validation_error") != "analysis-output-invalid":
                raise SystemExit(10)
        cases = review_input["cases"]
        if any(
            set(item) != {
                "case_id", "inputs", "expected_behavior", "machine_verdict", "evidence_dir",
            } or not item["inputs"] or not item["expected_behavior"]
            for item in cases
        ):
            raise SystemExit(8)
        required = review_input["required_evidence"]
        expected = ["inputs.lock.json", "results.jsonl", "evidence/analysis/harness.json"] + [
            f"evidence/{item['case_id']}/{name}"
            for item in cases
            for name in ("response.json", "checks.json", "tools.jsonl")
        ]
        bundle = scene["scene_id"]
        if review_input.get("evidence_sources") != expected \
                or "harness_files" in review_input or any(
            set(item) != {"bundle", "path", "total_lines", "sha256"}
            or item["bundle"] != bundle
            or not item["path"].startswith(f"evidence/analysis/readable/{bundle}/")
            or not item["path"].endswith(".txt")
            or not isinstance(item["total_lines"], int) or item["total_lines"] < 1
            for item in required
        ):
            raise SystemExit(7)
        reviews = []
        for case_index, item in enumerate(cases):
            reviewed = item["machine_verdict"]
            if os.environ.get("TEST_ANALYSIS_MODE") == "correct-first" \
                    and scene_index == 0 and case_index == 0:
                reviewed = "failed"
            reviews.append({
                "case_id": item["case_id"],
                "reviewed_verdict": reviewed,
                "reason": "已核对预期、回复、检查结果和完整工具事件。",
            })
        finding = {
            "category": "harness_mechanism",
            "observed_gap": "机器结论未表达场景证据中的能力边界。",
            "root_cause_hypothesis": "当前 Harness 对该边界缺少明确约束。",
            "support_case_ids": [cases[0]["case_id"]],
            "counterexample_case_ids": [cases[1]["case_id"]] if len(cases) > 1 else [],
            "evidence_refs": [f"evidence/{cases[0]['case_id']}/response.json"] + (
                [f"evidence/{cases[1]['case_id']}/response.json"] if len(cases) > 1 else []
            ),
            "alternative": "也可能由外部工具测试数据造成。",
            "falsification": "固定工具数据后重跑该场景并比较完整证据。",
        }
        text = json.dumps({
            "case_reviews": reviews,
            "findings": [finding],
        })
        accesses = [
            {
                "name": "read",
                "arguments": {"file_path": f"/work/evaluation-run/{item['path']}"},
                "result": {
                    "is_error": False,
                    "read": {
                        "path": f"/work/evaluation-run/{item['path']}",
                        "offset": 1,
                        "line_numbers": list(range(1, item["total_lines"] + 1)),
                        "total_lines": item["total_lines"],
                    },
                },
            }
            for item in required
        ]
        analysis_mode = os.environ.get("TEST_ANALYSIS_MODE")
        if analysis_mode == "invalid":
            accesses.pop()
        elif analysis_mode == "failed-read":
            accesses[0]["result"] = {"is_error": True}
        elif analysis_mode == "partial-read":
            accesses[0]["result"]["read"]["line_numbers"].pop()
        if analysis_mode == "repair-output" and not repairing:
            finding["evidence_refs"].append(f"evidence/{cases[-1]['case_id']}/tools.jsonl")
            text = json.dumps({"case_reviews": reviews, "findings": [finding]})
        results.append({
            "scene_id": scene["scene_id"],
            "session_id": scene.get("session_id", f"judge-session-{scene_index}"),
            "route": target_route,
            "tool_names": ["glob", "grep", "read"],
            "tool_accesses": accesses,
            "text": text,
        })
    print(json.dumps({"operation": "review", "results": results}))
    raise SystemExit(0)
if mode == "exception":
    raise SystemExit(9)
if mode == "hang":
    Path(os.environ["TEST_BROWSER_READY"]).write_text("ready\\n", encoding="utf-8")
    time.sleep(120)

rows = []
for index, item in enumerate(payload["cases"]):
    evidence = Path(payload["evidence_root"]) / item["case_id"]
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "response.json").write_text(json.dumps({
        "inputs": item["inputs"],
        "assistant_texts": ["模型连通"],
        "session_id": f"target-session-{index}",
        "turns": [{"assistant_text": "模型连通", "route": target_route}] + [
            {"assistant_text": "继续处理", "route": None}
            for _ in item["inputs"][1:]
        ],
    }) + "\\n")
    (evidence / "trace.jsonl").write_text(json.dumps({"route": "local-qwen"}) + "\\n")
    (evidence / "tools.jsonl").write_text(
        json.dumps({"event": {
            "type": "tool/call", "name": "inspection", "arguments": {"case_id": item["case_id"]},
        }}) + "\\n" + json.dumps({"event": {
            "type": "tool/result", "name": "inspection",
            "result": {"ok": True, "case_id": item["case_id"]},
        }}) + "\\n"
    )
    (evidence / "checks.json").write_text(json.dumps({"completed": True}) + "\\n")
    if mode == "safety-stop":
        rows.append({
            "case_id": item["case_id"],
            "execution_status": "error",
            "verdict": "inconclusive",
            "observation": "Session 身份漂移",
            "failure_reason": "identity-drift",
            "evidence_ref": f"evidence/{item['case_id']}",
        })
        print(json.dumps({
            "schema_version": "1.0",
            "rows": rows,
            "stop_reason": "identity-drift",
        }))
        raise SystemExit(0)
    verdict = "failed" if mode == "case-failure" and index == 0 else "passed"
    rows.append({
        "case_id": item["case_id"],
        "execution_status": "completed",
        "verdict": verdict,
        "observation": "替身浏览器完成评测链路",
        "evidence_ref": f"evidence/{item['case_id']}",
    })
print(json.dumps({"schema_version": "1.0", "rows": rows}))
""",
            encoding="utf-8",
        )
        fake_browser.chmod(0o755)
        env = {
            **os.environ,
            "PYTHONDONTWRITEBYTECODE": "1",
            "DSH_EVAL_DSH_DEV": str(fake_dsh),
            "DSH_EVAL_API_DRIVER": str(fake_browser),
            "DSH_EVAL_BROWSER_DRIVER": str(fake_browser),
            "TEST_DSH_LOG": str(command_log),
            "TEST_BROWSER_MODE": mode,
            "TEST_ANALYSIS_MODE": "valid",
            "TEST_BROWSER_READY": str(root / "browser-ready"),
        }
        for name in self.REQUIRED_RUNTIME_ENV:
            env[name] = "http://example.invalid" if name.endswith(("_URL", "BASE_URL")) else "test-value"
        return repository, env, command_log

    def run_eval(
        self,
        repository: Path,
        env: dict[str, str],
        *case_ids: str,
        timeout: int = 240,
        executor: str = "api",
        mode: str | None = None,
    ) -> tuple[subprocess.CompletedProcess[str], dict]:
        command = [
            "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
            "--source", "experiment:EXP-security-operations-expert-006",
            "--executor", executor,
            "--timeout-seconds", "10",
        ]
        if mode:
            command.extend(("--mode", mode))
        for case_id in case_ids:
            command.extend(("--case", case_id))
        completed = subprocess.run(
            command,
            cwd=repository,
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout,
            env=env,
        )
        return completed, json.loads(completed.stdout)

    def test_dry_run_has_no_runtime_side_effects(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            runs = repository / "evolution/experiments/EXP-security-operations-expert-006/runs"
            before = set(runs.glob("run-*")) if runs.is_dir() else set()
            env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
            for name in self.REQUIRED_RUNTIME_ENV:
                env.pop(name, None)
            completed = subprocess.run(
                [
                    "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
                    "--source", "experiment:EXP-security-operations-expert-006",
                    "--case", "U-INS-001", "--dry-run",
                ],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180, env=env,
            )
            payload = json.loads(completed.stdout)
            after = set(runs.glob("run-*")) if runs.is_dir() else set()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(payload["executor"], "api")
        self.assertTrue(payload["runtime_required"])
        self.assertEqual(payload["missing_env_names"], list(self.REQUIRED_RUNTIME_ENV))
        self.assertEqual(before, after)

    def test_runtime_flow_seals_run_stops_instance_and_does_not_persist_auth_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repository, env, command_log = self.runtime_fixture(root)
            completed, payload = self.run_eval(repository, env, "U-INS-001")
            run_dir = (repository / payload["summary"]).parent
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
            report = (repository / payload["report"]).read_text(encoding="utf-8")
            analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
            inputs = (run_dir / "inputs.lock.json").read_text(encoding="utf-8")
            manifest = (run_dir / "run.yaml").read_text(encoding="utf-8")
            commands = [json.loads(line) for line in command_log.read_text(encoding="utf-8").splitlines()]
            persisted = b"\n".join(path.read_bytes() for path in run_dir.rglob("*") if path.is_file())
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(payload["executor"], "api")
        self.assertEqual(payload["verdict"], "passed")
        self.assertEqual(payload["review_status"], "not_requested")
        self.assertEqual(
            payload["cases"],
            {"total": 1, "passed": 1, "failed": 0, "inconclusive": 0},
        )
        self.assertTrue(payload["instance_stopped"])
        self.assertEqual(summary["machine_overall_verdict"], "passed")
        self.assertEqual(summary["effective_verdict"], "passed")
        self.assertEqual(summary["review_status"], "not_requested")
        self.assertIn("# 测试评估报告", report)
        self.assertIn("- Case 选择：`explicit`", report)
        self.assertIn("`U-INS-001`", report)
        self.assertIn("| Case | 输入 | 判定依据 | 执行状态 | 机器结论 | 复核结论 | 观察 | 证据 |", report)
        self.assertIn("执行一次常规巡检。", report)
        self.assertIn("通过", report)
        self.assertIn("## 场景覆盖与归因", report)
        self.assertIn("### 缺口与归因", report)
        self.assertEqual(sum(len(scene["case_ids"]) for scene in analysis["scenes"]), 40)
        self.assertEqual(sum(len(scene["selected_case_ids"]) for scene in analysis["scenes"]), 1)
        self.assertEqual(analysis["review_status"], "not_requested")
        self.assertEqual(
            sum(scene["review_status"] == "not_evaluated" for scene in analysis["scenes"]),
            len(analysis["scenes"]) - 1,
        )
        self.assertIn('executor": "api"', inputs)
        self.assertIn("report_sha256:", manifest)
        self.assertEqual([command[0] for command in commands], ["up", "url", "down"])
        self.assertNotIn("opaque-eval-auth-token", completed.stdout + completed.stderr)
        self.assertNotIn(b"opaque-eval-auth-token", persisted)

    def test_case_failure_continues_and_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, command_log = self.runtime_fixture(Path(temp), mode="case-failure")
            completed, payload = self.run_eval(
                repository,
                env,
                "U-INS-001",
                "U-INS-002",
                executor="browser",
            )
            results = [
                json.loads(line)
                for line in ((repository / payload["summary"]).parent / "results.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            run_dir = (repository / payload["summary"]).parent
            analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
            report = (run_dir / "report.md").read_text(encoding="utf-8")
            commands = [json.loads(line)[0] for line in command_log.read_text().splitlines()]
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertEqual(payload["executor"], "browser")
        self.assertEqual(payload["verdict"], "failed")
        self.assertEqual(
            payload["cases"],
            {"total": 2, "passed": 1, "failed": 1, "inconclusive": 0},
        )
        self.assertEqual(
            [row["input_id"] for row in results],
            ["U-INS-001", "U-INS-002"],
        )
        self.assertEqual(commands, ["up", "url", "down"])
        self.assertEqual(analysis["review_status"], "not_requested")
        self.assertFalse(any(scene["findings"] for scene in analysis["scenes"]))
        self.assertIn("未形成结构化缺口与根因假设；这不表示不存在缺口。", report)

    def test_invalid_full_review_preserves_evidence_and_fails_closed(self) -> None:
        for analysis_mode in ("invalid", "failed-read", "partial-read"):
            with self.subTest(analysis_mode=analysis_mode), tempfile.TemporaryDirectory() as temp:
                repository, env, command_log = self.runtime_fixture(
                    Path(temp), mode="case-failure",
                )
                env["TEST_ANALYSIS_MODE"] = analysis_mode
                completed, payload = self.run_eval(repository, env, mode="full")
                run_dir = (repository / payload["summary"]).parent
                analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
                summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
                manifest = (run_dir / "run.yaml").read_text(encoding="utf-8")
                commands = [json.loads(line)[0] for line in command_log.read_text().splitlines()]
                self.assertEqual(completed.returncode, 2, completed.stderr)
                self.assertEqual(payload["verdict"], "inconclusive")
                self.assertEqual(payload["review_status"], "failed")
                self.assertEqual(analysis["review_status"], "failed")
                self.assertTrue(all(
                    scene["review_status"] == "failed" and scene["diagnostic"]
                    for scene in analysis["scenes"] if scene["selected_case_ids"]
                ))
                self.assertEqual(
                    {scene["diagnostic"]["stage"] for scene in analysis["scenes"]
                     if scene["selected_case_ids"]},
                    {"evidence-access"},
                )
                self.assertEqual(summary["effective_verdict"], "inconclusive")
                self.assertIn('status: "failed"', manifest)
                self.assertEqual(commands, ["up", "url", "up", "url", "down", "down"])

    def test_full_review_covers_every_case_and_can_correct_machine_verdict(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, command_log = self.runtime_fixture(Path(temp))
            env["TEST_ANALYSIS_MODE"] = "correct-first"
            completed, payload = self.run_eval(repository, env, mode="full")
            run_dir = (repository / payload["summary"]).parent
            analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
            report = (run_dir / "report.md").read_text(encoding="utf-8")
            selected_scenes = [scene for scene in analysis["scenes"] if scene["selected_case_ids"]]
            commands = [json.loads(line) for line in command_log.read_text().splitlines()]
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertEqual(payload["review_status"], "completed")
        self.assertEqual(payload["cases"], {
            "total": 40, "passed": 40, "failed": 0, "inconclusive": 0,
        })
        self.assertEqual(payload["reviewed_cases"], {
            "total": 40, "passed": 39, "failed": 1, "inconclusive": 0,
        })
        self.assertEqual(summary["machine_overall_verdict"], "passed")
        self.assertEqual(summary["reviewed_overall_verdict"], "failed")
        self.assertEqual(summary["effective_verdict"], "failed")
        self.assertEqual(analysis["reviewed_case_count"], 40)
        self.assertTrue(all(scene["review_status"] == "completed" for scene in selected_scenes))
        self.assertEqual(
            len({scene["analysis_session"]["session_id"] for scene in selected_scenes}),
            len(selected_scenes),
        )
        self.assertTrue(all(scene["findings"] for scene in selected_scenes))
        self.assertIn("### 证据复核", report)
        self.assertIn("### 缺口与归因", report)
        self.assertIn("机器结论未表达场景证据中的能力边界", report)
        self.assertIn("| 是 |", report)
        self.assertEqual(
            [command[0] for command in commands],
            ["up", "url", "up", "url", "down", "down"],
        )
        self.assertEqual(
            commands[2][commands[2].index("--analysis-workspace") + 1],
            str(run_dir.resolve()),
        )

    def test_full_review_repairs_invalid_output_in_same_session(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, _ = self.runtime_fixture(Path(temp))
            env["TEST_ANALYSIS_MODE"] = "repair-output"
            completed, payload = self.run_eval(repository, env, mode="full")
            run_dir = (repository / payload["summary"]).parent
            analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
            attempts = sorted((run_dir / "evidence/analysis").glob(
                "scene-*/attempt-01-response.json"
            ))
            sessions = [
                (json.loads(path.read_text(encoding="utf-8"))["session_id"],
                 json.loads((path.parent / "response.json").read_text(encoding="utf-8"))["session_id"])
                for path in attempts
            ]

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(analysis["review_status"], "completed")
        self.assertEqual(analysis["reviewed_case_count"], 40)
        self.assertEqual(len(attempts), 4)
        self.assertTrue(all(first == repaired for first, repaired in sessions))

    def test_manual_gap_is_rendered_without_starting_analysis_instance(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, command_log = self.runtime_fixture(Path(temp))
            script = repository / "runtime/adapters/dsh-container/run_record.py"
            base = ["python3", str(script), "--repo", str(repository)]
            init = subprocess.run(
                base + ["init", "--source", "experiment:EXP-security-operations-expert-006",
                        "--case", "U-INS-001"], cwd=repository, env=env,
                text=True, capture_output=True, check=False, timeout=180,
            )
            self.assertEqual(init.returncode, 0, init.stderr)
            run_id = init.stdout.strip()
            run_dir = repository / f"evolution/experiments/EXP-security-operations-expert-006/runs/{run_id}"
            evidence = run_dir / "evidence/U-INS-001/response.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text(json.dumps({"assistant_text": "目标回复与预期不符"}), encoding="utf-8")
            row = {
                "run_id": run_id, "trial_id": "trial-manual-1", "input_id": "U-INS-001",
                "execution_status": "completed", "verdict": "failed",
                "observation": "与预期不符", "evidence_ref": "evidence/U-INS-001/response.json",
            }
            record = subprocess.run(base + ["record", "--run", run_id, "-"],
                                    cwd=repository, env=env, input=json.dumps(row),
                                    text=True, capture_output=True, check=False, timeout=180)
            self.assertEqual(record.returncode, 0, record.stderr)
            gap = subprocess.run(
                base + [
                    "gap", "--run", run_id, "--classification", "harness",
                    "--title", "巡检输出缺少证据字段", "--observed", "回复未给出报告链接",
                    "--next-step", "补充约束后重跑", "--evidence", "evidence/U-INS-001/response.json",
                ],
                cwd=repository, env=env, text=True, capture_output=True, check=False, timeout=180,
            )
            self.assertEqual(gap.returncode, 0, gap.stderr)
            finalize = subprocess.run(base + ["finalize", "--run", run_id, "--status", "completed"],
                                      cwd=repository, env=env, text=True,
                                      capture_output=True, check=False, timeout=180)
            self.assertEqual(finalize.returncode, 0, finalize.stderr)
            analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
            report = (run_dir / "report.md").read_text(encoding="utf-8")
        self.assertFalse(command_log.exists())
        self.assertEqual(analysis["review_status"], "not_requested")
        self.assertIn("### 人工记录的研究缺口", report)
        self.assertIn("巡检输出缺少证据字段", report)
        self.assertIn("evidence/U-INS-001/response.json", report)

    def test_analysis_content_validation_rejects_tampered_counts(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, _ = self.runtime_fixture(Path(temp), mode="case-failure")
            completed, payload = self.run_eval(repository, env, "U-INS-001")
            self.assertEqual(completed.returncode, 1, completed.stderr)
            run_dir = (repository / payload["summary"]).parent
            analysis_path = run_dir / "analysis.json"
            original_hash = hashlib.sha256(analysis_path.read_bytes()).hexdigest()
            analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
            analysis["scenes"][0]["machine_counts"]["failed"] = 0
            analysis_path.write_text(json.dumps(analysis, ensure_ascii=False), encoding="utf-8")
            manifest = run_dir / "run.yaml"
            manifest.write_text(
                manifest.read_text(encoding="utf-8").replace(
                    original_hash, hashlib.sha256(analysis_path.read_bytes()).hexdigest()
                ), encoding="utf-8",
            )
            checked, verdict = run_json(
                repository / ".agents/skills/research-eval/scripts/validate_experiment.py",
                repository / "evolution/experiments/EXP-security-operations-expert-006", cwd=repository,
            )
        self.assertNotEqual(checked.returncode, 0)
        self.assertIn("RUN_ANALYSIS", error_codes(verdict))

    def test_fast_full_and_explicit_case_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            command = [
                "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
                "--source", "experiment:EXP-security-operations-expert-006",
                "--dry-run",
            ]
            fast = subprocess.run(
                command, cwd=repository, text=True, capture_output=True, check=False, timeout=180,
            )
            full = subprocess.run(
                command + ["--mode", "full"], cwd=repository, text=True,
                capture_output=True, check=False, timeout=180,
            )
            explicit = subprocess.run(
                command + ["--mode", "full", "--case", "U-INS-002"], cwd=repository,
                text=True, capture_output=True, check=False, timeout=180,
            )
            evaluation = repository / "agents/security-operations-expert/evaluation.md"
            evaluation.write_text(
                evaluation.read_text(encoding="utf-8").replace("**评估档位：** `fast`\n\n", ""),
                encoding="utf-8",
            )
            missing = subprocess.run(
                command, cwd=repository, text=True, capture_output=True, check=False, timeout=180,
            )
        self.assertEqual(fast.returncode, 0, fast.stderr)
        self.assertEqual(json.loads(fast.stdout)["case_ids"], [
            "U-INS-001", "U-POL-001", "U-FLT-009", "U-QA-002", "U-QA-003",
        ])
        self.assertEqual(json.loads(fast.stdout)["selection_mode"], "fast")
        self.assertEqual(full.returncode, 0, full.stderr)
        self.assertEqual(len(json.loads(full.stdout)["case_ids"]), 40)
        self.assertEqual(json.loads(full.stdout)["selection_mode"], "full")
        self.assertEqual(explicit.returncode, 0, explicit.stderr)
        self.assertEqual(json.loads(explicit.stdout)["case_ids"], ["U-INS-002"])
        self.assertEqual(json.loads(explicit.stdout)["selection_mode"], "explicit")
        self.assertEqual(missing.returncode, 2)
        self.assertIn("没有标记 fast", missing.stderr)

    def test_default_fast_run_locks_selected_scenes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, _ = self.runtime_fixture(Path(temp))
            completed, payload = self.run_eval(repository, env)
            run_dir = (repository / payload["summary"]).parent
            inputs = json.loads((run_dir / "inputs.lock.json").read_text(encoding="utf-8"))
            analysis = json.loads((run_dir / "analysis.json").read_text(encoding="utf-8"))
            report = (run_dir / "report.md").read_text(encoding="utf-8")
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(inputs["selection_mode"], "fast")
        self.assertIn("- Case 选择：`fast`", report)
        self.assertEqual([item["case_id"] for item in inputs["evaluation_cases"]], [
            "U-INS-001", "U-POL-001", "U-FLT-009", "U-QA-002", "U-QA-003",
        ])
        self.assertEqual(analysis["review_status"], "not_requested")
        self.assertEqual(sum(scene["machine_counts"]["passed"] for scene in analysis["scenes"]), 5)
        self.assertEqual(sum(scene["machine_counts"]["not_executed"] for scene in analysis["scenes"]), 0)

    def test_case_patterns_select_in_document_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            command = [
                "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
                "--source", "experiment:EXP-security-operations-expert-006", "--dry-run",
                "--case", "U-INS-*", "--case", "U-INS-001",
            ]
            selected = subprocess.run(
                command, cwd=repository, text=True, capture_output=True, check=False, timeout=180,
            )
            unmatched = subprocess.run(
                [
                    "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
                    "--source", "experiment:EXP-security-operations-expert-006",
                    "--dry-run", "--case", "U-NOT-*",
                ], cwd=repository, text=True,
                capture_output=True, check=False, timeout=180,
            )
            selected_payload = json.loads(selected.stdout)
        self.assertEqual(selected.returncode, 0, selected.stderr)
        self.assertEqual(selected_payload["case_ids"], [
            "U-INS-001", "U-INS-002", "U-INS-003", "U-INS-004", "U-INS-005",
        ])
        self.assertEqual(unmatched.returncode, 2, unmatched.stderr)
        self.assertIn("未匹配 Case 模式：U-NOT-*", unmatched.stderr)

    def test_preflight_failure_does_not_create_run_or_start_instance(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, command_log = self.runtime_fixture(Path(temp))
            validator = repository / ".agents/skills/harness-evolution/scripts/validate_repository.py"
            validator.write_text(
                'import json\nprint(json.dumps({"valid": False, "errors": [{"code": "test-invalid"}]}))\nraise SystemExit(1)\n',
                encoding="utf-8",
            )
            runs = repository / "evolution/experiments/EXP-security-operations-expert-006/runs"
            before = set(runs.glob("run-*")) if runs.is_dir() else set()
            completed, payload = self.run_eval(repository, env, "U-INS-001")
            after = set(runs.glob("run-*")) if runs.is_dir() else set()
            instance_started = command_log.exists()
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertIsNone(payload["run_id"])
        self.assertEqual(payload["verdict"], "inconclusive")
        self.assertEqual(before, after)
        self.assertFalse(instance_started)

    def test_mid_run_exception_is_sealed_and_instance_is_stopped(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, command_log = self.runtime_fixture(Path(temp), mode="exception")
            completed, payload = self.run_eval(repository, env, "U-INS-001")
            run_dir = (repository / payload["summary"]).parent
            result = json.loads((run_dir / "results.jsonl").read_text(encoding="utf-8"))
            manifest = (run_dir / "run.yaml").read_text(encoding="utf-8")
            commands = [json.loads(line)[0] for line in command_log.read_text().splitlines()]
        self.assertEqual(completed.returncode, 2, completed.stderr)
        self.assertEqual(payload["verdict"], "inconclusive")
        self.assertEqual(result["execution_status"], "error")
        self.assertIn('status: "failed"', manifest)
        self.assertEqual(commands, ["up", "url", "down"])

    def test_safety_stop_marks_remaining_cases_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, _ = self.runtime_fixture(Path(temp), mode="safety-stop")
            completed, payload = self.run_eval(
                repository,
                env,
                "U-INS-001",
                "U-INS-002",
            )
            run_dir = (repository / payload["summary"]).parent
            results = [
                json.loads(line)
                for line in (run_dir / "results.jsonl").read_text(encoding="utf-8").splitlines()
            ]
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertEqual([row["execution_status"] for row in results], ["error", "skipped"])
        self.assertEqual(
            payload["cases"],
            {"total": 2, "passed": 0, "failed": 0, "inconclusive": 2},
        )

    def test_sigint_seals_cancelled_run_and_stops_instance(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repository, env, command_log = self.runtime_fixture(root, mode="hang")
            process = subprocess.Popen(
                [
                    "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
                    "--source", "experiment:EXP-security-operations-expert-006",
                    "--case", "U-INS-001", "--timeout-seconds", "10",
                ],
                cwd=repository,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
            )
            ready = root / "browser-ready"
            deadline = time.monotonic() + 180
            while not ready.is_file() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(ready.is_file(), "浏览器替身未进入运行阶段")
            process.send_signal(signal.SIGINT)
            stdout, stderr = process.communicate(timeout=30)
            payload = json.loads(stdout)
            run_dir = (repository / payload["summary"]).parent
            result = json.loads((run_dir / "results.jsonl").read_text(encoding="utf-8"))
            manifest = (run_dir / "run.yaml").read_text(encoding="utf-8")
            commands = [json.loads(line)[0] for line in command_log.read_text().splitlines()]
        self.assertEqual(process.returncode, 2, stderr)
        self.assertEqual(result["execution_status"], "skipped")
        self.assertIn('status: "cancelled"', manifest)
        self.assertEqual(commands, ["up", "url", "down"])


class EvaluationSourceTests(unittest.TestCase):
    @staticmethod
    def load_contract():
        spec = importlib.util.spec_from_file_location("evaluation_contract", EVALUATION_CONTRACT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_current_business_source_is_compact_and_complete(self) -> None:
        agent = ROOT / "agents" / AGENT_ID
        evaluation = agent / "evaluation.md"
        text = evaluation.read_text(encoding="utf-8")
        loaded = self.load_contract().load_evaluation(evaluation)
        expected_ids = (
            [f"U-INS-{index:03d}" for index in range(1, 6)]
            + [f"U-POL-{index:03d}" for index in range(1, 13)]
            + [f"U-FLT-{index:03d}" for index in range(1, 11)]
            + [f"U-QA-{index:03d}" for index in range(1, 14)]
        )
        self.assertFalse((agent / "definition.md").exists())
        self.assertEqual(loaded["case_ids"], expected_ids)
        self.assertTrue(all(
            set(loaded["cases"][case_id]) == {"case_id", "title", "inputs", "expected_behavior"}
            for case_id in expected_ids
        ))
        self.assertEqual(loaded["cases"]["U-INS-001"]["inputs"], ["执行一次常规巡检。"])
        self.assertEqual(
            [item["case_id"] for item in loaded["catalog"] if item["fast"]],
            ["U-INS-001", "U-POL-001", "U-FLT-009", "U-QA-002", "U-QA-003"],
        )
        self.assertTrue(all(item["scene"] for item in loaded["catalog"]))
        self.assertIn("设备数量和巡检报告链接", loaded["cases"]["U-INS-001"]["expected_behavior"])
        self.assertIn("真实巡检工具返回", loaded["cases"]["U-INS-001"]["expected_behavior"])
        self.assertEqual(len(loaded["cases"]["U-POL-008"]["inputs"]), 4)
        for retired in (
            "**执行器", "**工具边界", "**副作用预算", "Experiment 评估选择",
            "T-MIGRATION-SOURCE", "T-DSH-LOAD-CYCLE", "T-CONTRACT-STATIC", "T-CONTRACT-LIVE",
        ):
            self.assertNotIn(retired, text)
        self.assertFalse(list((ROOT / "evolution/experiments").glob("EXP-*/evaluation/plan.yaml")))

    def test_fast_marker_does_not_change_case_digest_and_malformed_marker_fails(self) -> None:
        contract = self.load_contract()
        source = ROOT / "agents/test01/evaluation.md"
        with tempfile.TemporaryDirectory() as temp:
            plain = Path(temp) / "evaluation.md"
            plain.write_text(source.read_text(encoding="utf-8").replace(
                "**评估档位：** `fast`\n\n", ""
            ), encoding="utf-8")
            self.assertEqual(
                contract.evaluation_digest(source, ["U-IDENTITY-001"]),
                contract.evaluation_digest(plain, ["U-IDENTITY-001"]),
            )
            plain.write_text(source.read_text(encoding="utf-8").replace(
                "**评估档位：** `fast`", "**评估档位：** `full`"
            ), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "评估档位"):
                contract.load_evaluation(plain)

    def test_scene_counts_each_case_once_across_trials(self) -> None:
        spec = importlib.util.spec_from_file_location(
            "scenario_analysis", ROOT / "runtime/adapters/dsh-container/scenario_analysis.py",
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        inputs = {
            "run_id": "run-test",
            "case_catalog": [{"case_id": "U-ONE-001", "scene": "同一场景", "fast": True}],
            "evaluation_cases": [{"case_id": "U-ONE-001"}],
        }
        rows = [
            {"input_id": "U-ONE-001", "execution_status": "completed", "verdict": "passed"},
            {"input_id": "U-ONE-001", "execution_status": "completed", "verdict": "failed"},
        ]
        with tempfile.TemporaryDirectory() as temp:
            scene = module.analyze(Path(temp), rows, inputs, status="failed")["scenes"][0]
        self.assertEqual(scene["machine_counts"], {
            "passed": 0, "failed": 1, "inconclusive": 0, "not_executed": 0,
        })

    def test_candidate_model_configuration_is_unchanged(self) -> None:
        profile_text = (
            ROOT / "evolution/experiments/EXP-security-operations-expert-006"
            / "candidate/dsh/managed/security-operations-expert.patch.yml"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "- id: agent-default-model\n  config:\n"
            "    provider: deepseek-official\n    model: deepseek-flash",
            profile_text,
        )
        self.assertIn("- id: llm-deepseek\n  config:\n    reasoningEffort: off", profile_text)

    def test_unknown_case_selection_is_rejected(self) -> None:
        evaluation = ROOT / "agents" / AGENT_ID / "evaluation.md"
        with self.assertRaisesRegex(ValueError, "未定义"):
            self.load_contract().execution_for(evaluation, ["U-NOT-DEFINED"])

    def test_duplicate_inputs_and_old_case_shape_are_rejected(self) -> None:
        module = self.load_contract()
        with tempfile.TemporaryDirectory() as temp:
            evaluation = Path(temp) / "evaluation.md"
            evaluation.write_text(
                """# 示例

#### U-ONE-001 一
**用户输入**
> 相同输入。
**预期**
结果一。

#### U-TWO-001 二
**用户输入**
> 相 同 输 入。
**预期**
结果二。
""",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "业务测试输入重复"):
                module.load_evaluation(evaluation)

            evaluation.write_text(
                """# 示例

#### T-CONTRACT-STATIC 静态合同
**用户输入**
> 检查合同。
**预期**
通过。
""",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "只允许业务 U-\* Case"):
                module.load_evaluation(evaluation)


if __name__ == "__main__":
    unittest.main()
