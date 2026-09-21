from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSPECT_SOURCE = ROOT / ".agents/skills/legacy-asset-intake/scripts/inspect_source.py"
VALIDATE_REPOSITORY = ROOT / ".agents/skills/harness-evolution/scripts/validate_repository.py"
VALIDATE_EXPERIMENT = ROOT / ".agents/skills/research-eval/scripts/validate_experiment.py"
RUN_RECORD = ROOT / "runtime/adapters/dsh-container/run_record.py"
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
    experiment = root / "EXP-example-agent-001"
    (experiment / "candidate").mkdir(parents=True)
    (experiment / "evaluation").mkdir()
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
    (experiment / "evaluation/notes.md").write_text("# 观察\n\n尚未运行。\n", encoding="utf-8")
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

    def test_result_uses_lightweight_five_field_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            experiment = write_minimal_experiment(Path(temp))
            run_id = "run-" + str(uuid.uuid4())
            run_dir = experiment / "runs" / run_id
            run_dir.mkdir(parents=True)
            (run_dir / "run.yaml").write_text(
                "\n".join(
                    [
                        'schema_version: "1.0"',
                        f"run_id: {run_id}",
                        "experiment_id: EXP-example-agent-001",
                        "agent_id: example-agent",
                        "kind: research",
                        "status: running",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (run_dir / "inputs.lock.json").write_text("{}\n", encoding="utf-8")
            row = {"run_id": run_id, "trial_id": "trial-1", "input_id": "input-1", "status": "completed", "observation": "观察到预期变化"}
            (run_dir / "results.jsonl").write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
            self.assertEqual(completed.returncode, 0, json.dumps(payload, ensure_ascii=False, indent=2))
            del row["observation"]
            (run_dir / "results.jsonl").write_text(json.dumps(row, ensure_ascii=False) + "\n", encoding="utf-8")
            completed, payload = run_json(VALIDATE_EXPERIMENT, experiment)
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("RESULT_FIELDS", error_codes(payload))


class RunRecordTests(unittest.TestCase):
    def test_lifecycle_records_and_seals_observations(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            repository = copy_repository(Path(temp))
            init = subprocess.run(
                [
                    "python3", str(repository / "runtime/adapters/dsh-container/run_record.py"),
                    "--repo", str(repository), "init", "--agent", AGENT_ID,
                    "--experiment", EXPERIMENT_ID, "--source", f"experiment:{EXPERIMENT_ID}",
                    "--kind", "research",
                ],
                cwd=repository, text=True, capture_output=True, check=False, timeout=180,
                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
            )
            self.assertEqual(init.returncode, 0, init.stderr)
            run_id = init.stdout.strip()
            trial = repository / "trial.json"
            trial.write_text(
                json.dumps(
                    {
                        "run_id": run_id,
                        "trial_id": "trial-1",
                        "input_id": "input-1",
                        "status": "completed",
                        "observation": "目标会话观察到新增 Skill",
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
            run_dir = repository / f"evolution/experiments/{EXPERIMENT_ID}/runs/{run_id}"
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["completed"], 1)
            self.assertIn("baseline_ref: none:first-experiment", (run_dir / "run.yaml").read_text(encoding="utf-8"))
            inputs = json.loads((run_dir / "inputs.lock.json").read_text(encoding="utf-8"))
            self.assertIn("git_version", inputs)

    def test_old_pass_status_and_failed_without_reason_are_rejected(self) -> None:
        spec = importlib.util.spec_from_file_location("run_record_contract", RUN_RECORD)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        base = {
            "run_id": "run-" + str(uuid.uuid4()),
            "trial_id": "trial-1",
            "input_id": "input-1",
            "status": "pass",
            "observation": "legacy row",
        }
        with self.assertRaisesRegex(ValueError, "completed/failed/error/skipped"):
            module.validate_trial_row(base["run_id"], base)
        base["status"] = "failed"
        with self.assertRaisesRegex(ValueError, "failure_reason"):
            module.validate_trial_row(base["run_id"], base)


class DefinitionSourceTests(unittest.TestCase):
    def test_agent_definition_is_the_only_current_source(self) -> None:
        definition = ROOT / "agents" / AGENT_ID / "definition.md"
        text = definition.read_text(encoding="utf-8")
        self.assertEqual(
            re.findall(r"^## (.+)$", text, re.MULTILINE),
            ["需求定义", "任务定义", "测试数据", "评估方法", "测试验收"],
        )
        self.assertEqual(len(re.findall(r"^### task-", text, re.MULTILINE)), 34)
        self.assertEqual(len(re.findall(r"^##### (?:D|U)-[A-Z]+-[0-9]+$", text, re.MULTILINE)), 121)
        self.assertEqual(len(re.findall(r"^### m-", text, re.MULTILINE)), 39)
        self.assertEqual(len(re.findall(r"^### AC-", text, re.MULTILINE)), 39)
        retired = (
            "spec/requirements.md", "spec/tasks.yaml", "spec/acceptance.yaml",
            "eval/methods.yaml", "eval/fixtures", "eval/pending",
        )
        for relative in retired:
            self.assertFalse((definition.parent / relative).exists(), relative)


if __name__ == "__main__":
    unittest.main()
