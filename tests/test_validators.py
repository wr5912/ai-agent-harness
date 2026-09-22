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


def write_minimal_experiment(root: Path, *, status: str = "active", outcome: str | None = None) -> Path:
    experiment_id = "EXP-example-agent-001"
    experiment = root / "evolution/experiments" / experiment_id
    (experiment / "candidate").mkdir(parents=True)
    evaluation = root / "agents/example-agent/evaluation.md"
    evaluation.parent.mkdir(parents=True)
    evaluation.write_text(
        """# 示例评测

## 测试数据

### 测试预置

#### EXAMPLE-F01 最小研究输入

**公共基线**

使用当前 Candidate 和空白运行状态。

```mermaid
flowchart TD
    START[装载 Candidate] --> RUN[执行最小输入]
    RUN --> RECORD[记录实际观察]
```

**金标准**

实际观察与输入一致。

**适用边界**

本预置只验证最小研究输入。

### 测试用例

##### T-EXAMPLE-001

**用户输入**

```text
最小输入。
```

**执行器：** `repository-contract`

**工具边界：** `repository-read-only`

**副作用预算：** `none`

## 评估方法

### m-example

记录实际观察。

## 测试验收

### AC-001

观察与输入一致。

## Experiment 评估选择

### EXP-example-agent-001

- 测试用例：`T-EXAMPLE-001`
- 评估方法：`m-example`
- 测试验收：`AC-001`
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
                        "evaluation_ref: agents/example-agent/evaluation.md#EXP-example-agent-001",
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
                        "evaluation_sha256": hashlib.sha256(evaluation.read_bytes()).hexdigest(),
                        "evaluation_selection": {
                            "case_ids": ["T-EXAMPLE-001"],
                            "method_ids": ["m-example"],
                            "acceptance_ids": ["AC-001"],
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            evidence = run_dir / "evidence/T-EXAMPLE-001/checks.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text('{"checked":true}\n', encoding="utf-8")
            row = {
                "run_id": run_id,
                "trial_id": "trial-1",
                "input_id": "T-EXAMPLE-001",
                "execution_status": "completed",
                "verdict": "passed",
                "observation": "观察到预期变化",
                "evidence_ref": "evidence/T-EXAMPLE-001",
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
                        "evaluation_ref: agents/example-agent/evaluation.md#EXP-example-agent-001",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            evaluation = experiment.parents[2] / "agents/example-agent/evaluation.md"
            old_digest = hashlib.sha256(evaluation.read_bytes()).hexdigest()
            (run_dir / "inputs.lock.json").write_text(
                json.dumps(
                    {
                        "schema_version": "2.0",
                        "run_id": run_id,
                        "evaluation_sha256": old_digest,
                        "evaluation_selection": {
                            "case_ids": ["T-EXAMPLE-001"],
                            "method_ids": ["m-example"],
                            "acceptance_ids": ["AC-001"],
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            evidence = run_dir / "evidence/T-EXAMPLE-001/checks.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text('{"checked":true}\n', encoding="utf-8")
            row = {
                "run_id": run_id,
                "trial_id": "trial-1",
                "input_id": "T-EXAMPLE-001",
                "execution_status": "completed",
                "verdict": "passed",
                "observation": "观察到预期变化",
                "evidence_ref": "evidence/T-EXAMPLE-001",
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
            evaluation.write_text(evaluation.read_text(encoding="utf-8") + "\n<!-- 后续 Experiment 定义 -->\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
            self.assertNotEqual(completed.returncode, 0)
            self.assertIn("RUN_EVALUATION_HASH", error_codes(payload))
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

    def test_lifecycle_records_and_seals_observations(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            init = subprocess.run(
                [
                    "python3", str(repository / "runtime/adapters/dsh-container/run_record.py"),
                    "--repo", str(repository), "init", "--source", f"experiment:{EXPERIMENT_ID}",
                    "--case", "T-MIGRATION-SOURCE", "--kind", "research",
                ],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(init.returncode, 0, init.stderr)
            run_id = init.stdout.strip()
            run_dir = repository / f"evolution/experiments/{EXPERIMENT_ID}/runs/{run_id}"
            evidence = run_dir / "evidence/T-MIGRATION-SOURCE/checks.json"
            evidence.parent.mkdir(parents=True)
            evidence.write_text('{"loaded":true}\n', encoding="utf-8")
            trial = repository / "trial.json"
            trial.write_text(
                json.dumps(
                    {
                        "run_id": run_id,
                        "trial_id": "trial-1",
                        "input_id": "T-MIGRATION-SOURCE",
                        "execution_status": "completed",
                        "verdict": "passed",
                        "observation": "目标会话观察到新增 Skill",
                        "evidence_ref": "evidence/T-MIGRATION-SOURCE",
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
            self.assertEqual(summary["verdict_counts"]["passed"], 1)
            self.assertEqual(summary["overall_verdict"], "passed")
            self.assertIn('baseline_ref: "none:first-experiment"', (run_dir / "run.yaml").read_text(encoding="utf-8"))
            inputs = json.loads((run_dir / "inputs.lock.json").read_text(encoding="utf-8"))
            self.assertIn("git_version", inputs)
            self.assertEqual(inputs["evaluation_selection"]["case_ids"], ["T-MIGRATION-SOURCE"])
            self.assertIn(
                'evaluation_ref: "agents/security-operations-expert/evaluation.md#EXP-security-operations-expert-001"',
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
            module.validate_trial_row(row["run_id"], row, {"T-MIGRATION-SOURCE"})

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
                 "--source", f"experiment:{EXPERIMENT_ID}"],
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
if mode == "exception":
    raise SystemExit(9)
if mode == "hang":
    Path(os.environ["TEST_BROWSER_READY"]).write_text("ready\\n", encoding="utf-8")
    time.sleep(120)

rows = []
for index, item in enumerate(payload["cases"]):
    evidence = Path(payload["evidence_root"]) / item["case_id"]
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / "response.json").write_text(json.dumps({"assistant_text": "模型连通"}) + "\\n")
    (evidence / "trace.jsonl").write_text(json.dumps({"route": "local-qwen"}) + "\\n")
    (evidence / "tools.jsonl").write_text("")
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
            "DSH_EVAL_BROWSER_DRIVER": str(fake_browser),
            "TEST_DSH_LOG": str(command_log),
            "TEST_BROWSER_MODE": mode,
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
    ) -> tuple[subprocess.CompletedProcess[str], dict]:
        command = [
            "python3", str(repository / "runtime/adapters/dsh-container/dsh-eval"),
            "--source", "experiment:EXP-security-operations-expert-006",
            "--timeout-seconds", "10",
        ]
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
                    "--case", "T-LOCAL-QWEN-CHAT", "--dry-run",
                ],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180, env=env,
            )
            payload = json.loads(completed.stdout)
            after = set(runs.glob("run-*")) if runs.is_dir() else set()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(payload["runtime_required"])
        self.assertEqual(payload["missing_env_names"], list(self.REQUIRED_RUNTIME_ENV))
        self.assertEqual(before, after)

    def test_runtime_flow_seals_run_stops_instance_and_does_not_persist_auth_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repository, env, command_log = self.runtime_fixture(root)
            completed, payload = self.run_eval(repository, env, "T-LOCAL-QWEN-CHAT")
            run_dir = (repository / payload["summary"]).parent
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
            commands = [json.loads(line) for line in command_log.read_text(encoding="utf-8").splitlines()]
            persisted = b"\n".join(path.read_bytes() for path in run_dir.rglob("*") if path.is_file())
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(payload["verdict"], "passed")
        self.assertEqual(
            payload["cases"],
            {"total": 1, "passed": 1, "failed": 0, "inconclusive": 0},
        )
        self.assertTrue(payload["instance_stopped"])
        self.assertEqual(summary["overall_verdict"], "passed")
        self.assertEqual([command[0] for command in commands], ["up", "url", "down"])
        self.assertNotIn("opaque-eval-auth-token", completed.stdout + completed.stderr)
        self.assertNotIn(b"opaque-eval-auth-token", persisted)

    def test_case_failure_continues_and_returns_one(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository, env, command_log = self.runtime_fixture(Path(temp), mode="case-failure")
            completed, payload = self.run_eval(
                repository,
                env,
                "T-LOCAL-QWEN-CHAT",
                "T-SELECTED-ROUTE-TRACE",
            )
            results = [
                json.loads(line)
                for line in ((repository / payload["summary"]).parent / "results.jsonl")
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            commands = [json.loads(line)[0] for line in command_log.read_text().splitlines()]
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertEqual(payload["verdict"], "failed")
        self.assertEqual(
            payload["cases"],
            {"total": 2, "passed": 1, "failed": 1, "inconclusive": 0},
        )
        self.assertEqual(
            [row["input_id"] for row in results],
            ["T-LOCAL-QWEN-CHAT", "T-SELECTED-ROUTE-TRACE"],
        )
        self.assertEqual(commands, ["up", "url", "down"])

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
            completed, payload = self.run_eval(repository, env, "T-LOCAL-QWEN-CHAT")
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
            completed, payload = self.run_eval(repository, env, "T-LOCAL-QWEN-CHAT")
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
                "T-LOCAL-QWEN-CHAT",
                "T-SELECTED-ROUTE-TRACE",
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
                    "--case", "T-LOCAL-QWEN-CHAT", "--timeout-seconds", "10",
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


class DefinitionSourceTests(unittest.TestCase):
    def test_agent_definition_and_evaluation_have_one_concern_each(self) -> None:
        definition = ROOT / "agents" / AGENT_ID / "definition.md"
        definition_text = definition.read_text(encoding="utf-8")
        evaluation = definition.with_name("evaluation.md")
        evaluation_text = evaluation.read_text(encoding="utf-8")
        self.assertEqual(
            re.findall(r"^## (.+)$", definition_text, re.MULTILINE),
            ["需求定义", "任务定义"],
        )
        self.assertIn("[evaluation.md](./evaluation.md)", definition_text)
        self.assertNotIn("以本文“测试数据”为准", definition_text)
        self.assertEqual(
            re.findall(r"^## (.+)$", evaluation_text, re.MULTILINE),
            ["测试数据", "评估方法", "测试验收", "Experiment 评估选择"],
        )
        self.assertEqual(len(re.findall(r"^### task-", definition_text, re.MULTILINE)), 34)
        self.assertEqual(len(re.findall(r"^##### (?:D|U|T)-[A-Z0-9-]+$", evaluation_text, re.MULTILINE)), 200)
        self.assertEqual(len(re.findall(r"^### m-", evaluation_text, re.MULTILINE)), 44)
        self.assertEqual(len(re.findall(r"^### AC-", evaluation_text, re.MULTILINE)), 44)
        user_case_ids = re.findall(r"^##### (U-[A-Z0-9-]+)$", evaluation_text, re.MULTILINE)
        self.assertEqual(len(user_case_ids), 66)
        user_case_bodies = re.findall(
            r"^##### U-[A-Z0-9-]+$(.*?)(?=^##### |\Z)",
            evaluation_text,
            re.MULTILINE | re.DOTALL,
        )
        self.assertEqual(len(user_case_bodies), len(user_case_ids))
        self.assertTrue(all(body.count("**用户输入**") == 1 for body in user_case_bodies))
        spec = importlib.util.spec_from_file_location("evaluation_contract", EVALUATION_CONTRACT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        loaded = module.load_evaluation(evaluation)
        self.assertEqual(
            loaded["preset_ids"],
            [
                "RSP-F01", "RSP-F02", "RSP-F03", "INS-F01", "INS-F02", "INS-F03",
                "FLT-F01", "FLT-F02", "FLT-F03", "FLT-F04", "FLT-F05", "POL-F01",
                "POL-F02", "QA-F01", "QA-F02",
            ],
        )
        selection = loaded["selections"]["EXP-security-operations-expert-006"]
        self.assertLessEqual(set(user_case_ids), set(selection["case_ids"]))
        self.assertFalse(list((ROOT / "evolution/experiments").glob("EXP-*/evaluation/plan.yaml")))
        retired = (
            "spec/requirements.md", "spec/tasks.yaml", "spec/acceptance.yaml",
            "eval/methods.yaml", "eval/fixtures", "eval/pending",
        )
        for relative in retired:
            self.assertFalse((definition.parent / relative).exists(), relative)

    def test_unknown_selection_id_is_rejected(self) -> None:
        spec = importlib.util.spec_from_file_location("evaluation_contract", EVALUATION_CONTRACT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            evaluation = Path(temp) / "evaluation.md"
            text = (ROOT / "agents" / AGENT_ID / "evaluation.md").read_text(encoding="utf-8")
            evaluation.write_text(
                text.replace("`T-MIGRATION-SOURCE`、`T-DSH-LOAD-CYCLE`", "`T-NOT-DEFINED`、`T-DSH-LOAD-CYCLE`"),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "未定义"):
                module.load_evaluation(evaluation)

    def test_selected_case_requires_execution_metadata(self) -> None:
        spec = importlib.util.spec_from_file_location("evaluation_contract", EVALUATION_CONTRACT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            evaluation = Path(temp) / "evaluation.md"
            text = (ROOT / "agents" / AGENT_ID / "evaluation.md").read_text(encoding="utf-8")
            evaluation.write_text(text.replace("**执行器：**`repository-contract`", "", 1), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "执行元数据"):
                module.execution_for(evaluation, "EXP-security-operations-expert-001")

    def test_named_preset_requires_complete_decision_structure(self) -> None:
        spec = importlib.util.spec_from_file_location("evaluation_contract", EVALUATION_CONTRACT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            evaluation = Path(temp) / "evaluation.md"
            text = (ROOT / "agents" / AGENT_ID / "evaluation.md").read_text(encoding="utf-8")
            evaluation.write_text(text.replace("```mermaid\nflowchart TD", "```text\nflowchart TD", 1), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "RSP-F01 缺少 Mermaid"):
                module.load_evaluation(evaluation)
            evaluation.write_text(text.replace("**公共基线**", "**固定事实**", 1), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "RSP-F01 必须且只能声明一次公共基线"):
                module.load_evaluation(evaluation)
            for label in ("金标准", "适用边界"):
                evaluation.write_text(text.replace(f"**{label}**", f"**缺少{label}**", 1), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, f"RSP-F01 必须且只能声明一次{label}"):
                    module.load_evaluation(evaluation)
            evaluation.write_text(
                text.replace("**公共基线**", "**临时标记**", 1).replace("**金标准**", "**公共基线**", 1).replace("**临时标记**", "**金标准**", 1),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "RSP-F01 必须依次声明"):
                module.load_evaluation(evaluation)


if __name__ == "__main__":
    unittest.main()
