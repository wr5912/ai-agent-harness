from __future__ import annotations

import argparse
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock

import test_validators as fixtures


def load_module(path: Path, prefix: str):
    loader = importlib.machinery.SourceFileLoader(f"{prefix}_{uuid.uuid4().hex}", str(path))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def evaluation_text(case_id: str, stage: str) -> str:
    return f"""# 测试用例

### {stage}场景

#### {case_id} {stage}用例

**评估档位：** `fast`

**用户输入**

> {stage}输入。

**预期**

{stage}预期。
"""


def recorded_run(module, repo: Path) -> tuple[Path, dict]:
    experiment = fixtures.write_minimal_experiment(repo)
    for name in ("workspace", "presets", "managed"):
        folder = experiment / "candidate" / name
        folder.mkdir()
        (folder / "role.md").write_text("基本测试角色。\n", encoding="utf-8")
    contract = {
        "source_id": f"experiment:{experiment.name}", "source_kind": "experiment",
        "experiment_id": experiment.name, "agent_id": "example-agent",
        **{name: str(experiment / "candidate" / name) for name in ("workspace", "presets", "managed")},
        "config_markers": [], "required_env_names": [], "optional_env_names": [],
    }
    args = argparse.Namespace(source=contract["source_id"], baseline_ref=None, case=["U-EXAMPLE-001"],
                              selection_mode="explicit", kind="research", model=None,
                              executor="api", review_mode="none", compare_to=None)
    with mock.patch.object(module, "resolve", return_value=contract), contextlib.redirect_stdout(io.StringIO()) as output:
        module.command_init(repo, args)
    run_id = output.getvalue().strip()
    run_dir = experiment / "runs" / run_id
    (run_dir / "evidence").mkdir()
    (run_dir / "evidence/observation.txt").write_text("基本测试观察。", encoding="utf-8")
    trial = repo / "trial.json"
    trial.write_text(json.dumps({"run_id": run_id, "trial_id": "trial-" + str(uuid.uuid4()),
                                "input_id": "U-EXAMPLE-001", "execution_status": "completed", "verdict": "passed",
                                "observation": "基本测试观察。", "evidence_ref": "evidence/observation.txt"}), encoding="utf-8")
    with contextlib.redirect_stdout(io.StringIO()):
        module.command_record(repo, argparse.Namespace(run=run_id, trial_file=str(trial)))
    return run_dir, contract


class FrozenRunSnapshotTests(unittest.TestCase):
    def test_run_records_program_and_asset_versions_separately(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            (repo / "workspace.json").write_text(json.dumps({"schemaVersion": 1, "id": "workspace-fixture"}))
            module = load_module(fixtures.RUN_RECORD, "run_origins")
            run_dir, _ = recorded_run(module, repo)
            inputs = json.loads((run_dir / "inputs.lock.json").read_text())
            self.assertEqual(inputs["asset_origin"]["workspace_id"], "workspace-fixture")
            self.assertEqual(inputs["asset_origin"]["commit"], inputs["git_version"]["commit"])
            self.assertEqual(inputs["asset_origin"]["candidate_sha256"], inputs["candidate_sha256"])
            self.assertEqual(inputs["program_origin"]["root"], str(module.PROGRAM_ROOT))
            self.assertNotEqual(str(repo), inputs["program_origin"]["root"])

    def test_finalize_verifies_frozen_source_and_preserves_real_case_results(self) -> None:
        for mutation in ("unchanged", "content", "directory_permission", "unresolvable"):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                repo = Path(temporary)
                module = load_module(fixtures.RUN_RECORD, "run_source_verification")
                run_dir, contract = recorded_run(module, repo)
                inputs_before = (run_dir / "inputs.lock.json").read_bytes()
                results_before = (run_dir / "results.jsonl").read_bytes()
                candidate = run_dir.parents[1] / "candidate"
                if mutation == "content":
                    (candidate / "harness.yaml").write_text('schema_version: "1.0"\nvalue: changed-during-run\n', encoding="utf-8")
                if mutation == "directory_permission":
                    (candidate / "managed").chmod(0o500)
                resolve = mock.patch.object(module, "resolve", side_effect=ValueError("source missing")) \
                    if mutation == "unresolvable" else mock.patch.object(module, "resolve", return_value=contract)
                try:
                    with resolve, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()) as diagnostic:
                        module.command_finalize(repo, argparse.Namespace(run=run_dir.name, status="completed"))
                finally:
                    (candidate / "managed").chmod(0o755)
                manifest = module.read_flat_yaml(run_dir / "run.yaml")
                summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
                changed = mutation != "unchanged"
                self.assertEqual(manifest["status"], "failed" if changed else "completed")
                self.assertEqual(summary["effective_verdict"], "inconclusive" if changed else "passed")
                self.assertEqual(summary["machine_overall_verdict"], "passed")
                self.assertEqual((run_dir / "inputs.lock.json").read_bytes(), inputs_before)
                self.assertEqual((run_dir / "results.jsonl").read_bytes(), results_before)
                verification = summary["source_verification"]
                self.assertEqual(verification["status"], "unavailable" if mutation == "unresolvable" else "changed" if changed else "matched")
                if changed:
                    self.assertIn(verification["reason"], diagnostic.getvalue())
                    self.assertIn(verification["reason"], (run_dir / "report.md").read_text(encoding="utf-8"))
                if mutation == "directory_permission":
                    checks = {item["component"]: item["status"] for item in verification["checks"]}
                    self.assertEqual(checks, {"candidate": "matched", "workspace": "matched", "presets": "matched", "managed": "changed", "evaluation_implementation": "matched"})
                completed, validation = fixtures.run_json(fixtures.VALIDATE_EXPERIMENT, run_dir.parents[1])
                self.assertEqual(completed.returncode, 0, validation)
                self.assertTrue(validation["valid"])
                if mutation == "content":
                    # 聚合状态不能掩盖下属清单中的摘要差异。
                    verification["status"] = "matched"
                    (run_dir / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
                    _, invalid = fixtures.run_json(fixtures.VALIDATE_EXPERIMENT, run_dir.parents[1])
                    self.assertIn("RUN_SOURCE_VERIFICATION", fixtures.error_codes(invalid))

    def test_cancelled_run_keeps_cancelled_status_when_source_has_changed(self) -> None:
        module = load_module(fixtures.RUN_RECORD, "cancelled_run_source")
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            run_dir, contract = recorded_run(module, repo)
            (run_dir.parents[1] / "candidate/harness.yaml").write_text("value: changed-during-run\n", encoding="utf-8")
            with mock.patch.object(module, "resolve", return_value=contract), contextlib.redirect_stdout(io.StringIO()), \
                    contextlib.redirect_stderr(io.StringIO()):
                module.command_finalize(repo, argparse.Namespace(run=run_dir.name, status="cancelled"))
            self.assertEqual(module.read_flat_yaml(run_dir / "run.yaml")["status"], "cancelled")
            summary = json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["source_verification"]["reason"], "source-changed")
            self.assertEqual(summary["effective_verdict"], "inconclusive")

    def test_init_uses_one_authoritative_read_when_evaluation_changes_during_initialization(self) -> None:
        module = load_module(fixtures.RUN_RECORD, "run_snapshot")
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            experiment = fixtures.write_minimal_experiment(repo)
            evaluation = repo / "agents/example-agent/evaluation.md"
            case_id = "U-EXAMPLE-001"
            evaluation.write_text(evaluation_text(case_id, "初始化读取"), encoding="utf-8")
            original_load = module.load_evaluation
            before = original_load(evaluation)
            frozen_cases = module.execution_from(before, [case_id])

            def read_then_change(path: Path) -> dict:
                value = original_load(path)
                evaluation.write_text(evaluation_text(case_id, "并发保存"), encoding="utf-8")
                return value

            contract = {
                "source_id": f"experiment:{experiment.name}", "source_kind": "experiment",
                "experiment_id": experiment.name, "agent_id": "example-agent",
                "workspace": str(experiment / "candidate"), "presets": str(experiment / "candidate"),
                "managed": str(experiment / "candidate"), "config_markers": [],
                "required_env_names": [], "optional_env_names": [],
            }
            args = argparse.Namespace(source=contract["source_id"], baseline_ref=None, case=[case_id],
                                      selection_mode="fast", kind="research", model=None,
                                      executor="api", review_mode="none", compare_to=None)
            # 只隔离此最小夹具不提供的来源解析；初始化、解析、摘要和写入执行实际代码。
            with mock.patch.object(module, "resolve", return_value=contract), \
                    mock.patch.object(module, "load_evaluation", side_effect=read_then_change) as read, \
                    contextlib.redirect_stdout(io.StringIO()) as output:
                module.command_init(repo, args)
            self.assertEqual(read.call_count, 1)
            run_dir = experiment / "runs" / output.getvalue().strip()
            locked = json.loads((run_dir / "inputs.lock.json").read_text(encoding="utf-8"))
            self.assertEqual(locked["evaluation_cases"], frozen_cases)
            self.assertEqual(locked["case_catalog"], before["catalog"])
            self.assertEqual(locked["evaluation_sha256"], module.cases_digest(frozen_cases))
            self.assertNotEqual(locked["evaluation_sha256"], module.cases_digest(module.execution_from(original_load(evaluation), [case_id])))
            completed, validation = fixtures.run_json(fixtures.VALIDATE_EXPERIMENT, experiment)
            self.assertEqual(completed.returncode, 0, validation)
            self.assertTrue(validation["valid"])

    def test_runtime_driver_executes_init_snapshot_instead_of_earlier_plan_or_later_definition(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            helper = fixtures.DshEvalTests()
            repo, env, _ = helper.runtime_fixture(root)
            with mock.patch.dict(os.environ, env, clear=True):
                module = load_module(repo / "runtime/adapters/dsh-container/dsh-eval", "dsh_eval_snapshot")
            evaluation = repo / "agents/security-operations-expert/evaluation.md"
            case_id = "U-INS-001"
            planning_cases = module.execution_for(evaluation, [case_id])
            captured = root / "actual-driver-payload.json"
            fixture_driver = env["DSH_EVAL_API_DRIVER"]
            tee_driver = root / "capture-driver"
            tee_driver.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, subprocess, sys\n"
                "from pathlib import Path\n"
                "payload = json.load(sys.stdin)\n"
                "Path(os.environ['TEST_FROZEN_PAYLOAD']).write_text(json.dumps(payload), encoding='utf-8')\n"
                "completed = subprocess.run([os.environ['TEST_ORIGINAL_DRIVER']], input=json.dumps(payload), text=True, capture_output=True)\n"
                "sys.stdout.write(completed.stdout)\n"
                "sys.stderr.write(completed.stderr)\n"
                "raise SystemExit(completed.returncode)\n",
                encoding="utf-8",
            )
            tee_driver.chmod(0o755)
            env.update({"DSH_EVAL_API_DRIVER": str(tee_driver), "TEST_FROZEN_PAYLOAD": str(captured),
                        "TEST_ORIGINAL_DRIVER": fixture_driver})
            initialize = module.initialize_run
            initialized = {}

            def initialize_after_concurrent_save(source, cases, *args, **kwargs):
                self.assertEqual(cases, planning_cases)
                evaluation.write_text(evaluation_text(case_id, "真正初始化"), encoding="utf-8")
                run_id = initialize(source, cases, *args, **kwargs)
                run_dir = repo / "evolution/experiments/EXP-security-operations-expert-006/runs" / run_id
                initialized["locked"] = json.loads((run_dir / "inputs.lock.json").read_text(encoding="utf-8"))
                # Run 创建后继续保存用例，执行器仍必须使用自身冻结输入。
                evaluation.write_text(evaluation_text(case_id, "运行期间再次保存"), encoding="utf-8")
                return run_id

            args = argparse.Namespace(source="experiment:EXP-security-operations-expert-006", case=[case_id],
                                      mode="fast", executor="api", review="none", dry_run=False,
                                      model=None, compare_to=None, timeout_seconds=10, export_response_markdown=None)
            with mock.patch.dict(os.environ, env, clear=True), \
                    mock.patch.object(module, "initialize_run", side_effect=initialize_after_concurrent_save), \
                    contextlib.redirect_stdout(io.StringIO()) as output, \
                    contextlib.redirect_stderr(io.StringIO()) as diagnostics:
                exit_code = module.execute(args)
            self.assertEqual(exit_code, 0, diagnostics.getvalue())
            result = json.loads(output.getvalue())
            self.assertEqual(result["verdict"], "passed")
            actual_payload = json.loads(captured.read_text(encoding="utf-8"))
            locked = initialized["locked"]
            self.assertEqual(actual_payload["cases"], locked["evaluation_cases"])
            self.assertNotEqual(actual_payload["cases"], planning_cases)
            self.assertNotEqual(actual_payload["cases"], module.execution_for(evaluation, [case_id]))
            self.assertEqual(actual_payload["cases"][0]["inputs"], ["真正初始化输入。"])
            run_dir = (repo / result["summary"]).parent
            recorded_response = json.loads((run_dir / "evidence" / case_id / "response.json").read_text(encoding="utf-8"))
            self.assertEqual(recorded_response["inputs"], locked["evaluation_cases"][0]["inputs"])
            report = (repo / result["report"]).read_text(encoding="utf-8")
            self.assertIn("真正初始化输入。", report)
            self.assertNotIn("运行期间再次保存输入。", report)


if __name__ == "__main__":
    unittest.main()
