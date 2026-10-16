"""评测入口同时接受当前免认证 URL 和历史 Token URL。"""

import importlib.util
import io
import os
from importlib.machinery import SourceFileLoader
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import json
import types
import unittest
from unittest import mock
from contextlib import redirect_stderr

spec = importlib.util.spec_from_loader("dsh_eval", SourceFileLoader("dsh_eval", str(Path(__file__).with_name("dsh-eval"))))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


CHILD = '''
import json,sys
from pathlib import Path
root=Path(__file__).parent
with (root/"calls.jsonl").open("a") as output:
    output.write(json.dumps({"script":Path(__file__).name,"args":sys.argv[1:],"python":sys.executable})+"\\n")
name=Path(__file__).name
if name.startswith("validate"):
    print(json.dumps({"valid":True,"errors":[]}))
elif name=="run_record.py":
    if sys.argv[3]=="init": print("run-11111111-1111-4111-8111-111111111111")
    elif sys.argv[3]=="record": json.loads(sys.stdin.read())
elif sys.argv[1]=="up":
    image="sha256:"+"1"*64
    print(json.dumps({"image_tag":"fixture","image_id":image,"image_ref":"fixture@"+image,"image_build_fingerprint":image,"platform":"fixture"}))
elif sys.argv[1]=="url": print("http://127.0.0.1:3081/?token=fixture-only")
'''


class EvaluationAccessTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "config").mkdir()
        (self.root / "config/sites.json").write_text(json.dumps({"platform": "/hep/", "assistant": "/assistant/"}))
        self.repo_patch = mock.patch.object(evaluation, "REPO", self.root)
        self.repo_patch.start()

    def tearDown(self):
        self.repo_patch.stop()
        self.temporary.cleanup()

    def test_external_workspace_site_configuration_is_used(self):
        (self.root / "config/sites.json").write_text(json.dumps({"platform": "/platform/", "assistant": "/custom-agent/"}))
        url = "http://127.0.0.1:3081/custom-agent/"
        with mock.patch.object(evaluation, "checked_process", return_value=subprocess.CompletedProcess([], 0, url, "")):
            self.assertEqual(evaluation.authentication_url("probe"), url)

    def test_local_plain_and_legacy_token_urls_are_accepted(self):
        for url in ("http://127.0.0.1:3081/", "http://127.0.0.1:3081/?token=test-only",
                    "http://127.0.0.1:3081/assistant/", "http://127.0.0.1:3081/assistant/?token=test-only"):
            with self.subTest(url=url), mock.patch.object(evaluation, "checked_process", return_value=subprocess.CompletedProcess([], 0, url + "\n", "")):
                self.assertEqual(evaluation.authentication_url("probe"), url)

    def test_malformed_external_and_credential_urls_are_rejected(self):
        for url in ("http://127.0.0.1.evil:3081/", "http://example.org:3081/", "https://127.0.0.1:3081/", "http://127.0.0.1/", "http://user:pass@127.0.0.1:3081/", "http://127.0.0.1:0/", "http://127.0.0.1:65536/", "http://127.0.0.1:3081/api/", "http://127.0.0.1:3081/assistant",
                    "http://127.0.0.1:3081/assistant/api/", "http://127.0.0.1:3081/#fragment"):
            with self.subTest(url=url), mock.patch.object(evaluation, "checked_process", return_value=subprocess.CompletedProcess([], 0, url, "")):
                with self.assertRaises(evaluation.EvaluationError):
                    evaluation.authentication_url("probe")


class EvaluationInterpreterTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dsh eval interpreter ")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "config").mkdir()
        (self.root / "config/sites.json").write_text(json.dumps({"platform": "/hep/", "assistant": "/assistant/"}))
        binary = self.root / "bin"
        binary.mkdir()
        fallback = binary / "python3"
        fallback.write_text("#!/bin/sh\necho unavailable-python3 >&2\nexit 77\n")
        fallback.chmod(0o755)
        environment = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ["PATH"],
                           HARNESS_PYTHON=sys.executable)
        environment.pop("DSH_EVAL_DSH_DEV", None)
        self.patch(mock.patch.dict(os.environ, environment, clear=True))
        self.patch(mock.patch.object(evaluation, "REPO", self.root))

    def patch(self, patcher):
        self.addCleanup(patcher.stop)
        return patcher.start()

    def children(self):
        for key, name in (("VALIDATE_REPOSITORY", "validate_repository.py"),
                          ("VALIDATE_EXPERIMENT", "validate_experiment.py"),
                          ("RUN_RECORD", "run_record.py"), ("DSH_DEV", "dsh-dev")):
            script = self.root / name
            script.write_text(CHILD)
            self.patch(mock.patch.object(evaluation, key, script))

    def calls(self):
        return [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]

    def test_validation_runs_real_scripts_with_parent_python_despite_unusable_path_python(self):
        checks = evaluation.validate_before_run({"experiment_root": str(self.root)})
        for check in checks.values():
            self.assertFalse(check["valid"])
            self.assertIn("error_codes", check, check)
            self.assertNotEqual(check["exit_code"], 77)

    def test_run_lifecycle_and_default_instance_children_keep_parent_python(self):
        self.children()
        contract = {"experiment_root": str(self.root)}
        self.assertTrue(all(check["valid"] for check in evaluation.validate_before_run(contract).values()))
        evaluation.validate_after_run(contract)
        run_id = evaluation.initialize_run("fixture", [{"case_id": "U-BASIC-001"}], "api", "explicit", "none")
        evaluation.record_trial(run_id, "U-BASIC-001", {
            "execution_status": "completed", "verdict": "passed", "observation": "模拟状态正常",
            "evidence_ref": "evidence/U-BASIC-001/checks.json",
        })
        evaluation.finalize_run(run_id, "completed")
        evaluation.start_instance("fixture", "fixture")
        evaluation.authentication_url("fixture")
        self.assertTrue(evaluation.stop_instance("fixture"))
        calls = self.calls()
        self.assertEqual([row["script"] for row in calls], [
            "validate_repository.py", "validate_experiment.py", "validate_experiment.py",
            "run_record.py", "run_record.py", "run_record.py", "dsh-dev", "dsh-dev", "dsh-dev",
        ])
        self.assertEqual({row["python"] for row in calls}, {sys.executable})
        self.assertEqual([row["args"][0] for row in calls[-3:]], ["up", "url", "down"])

    def test_review_and_custom_non_python_instance_entry_preserve_execution_semantics(self):
        self.children()
        import scenario_analysis
        self.patch(mock.patch.object(scenario_analysis, "ADAPTER", self.root))
        self.patch(mock.patch.object(scenario_analysis, "_locked_harness", return_value=[]))
        self.patch(mock.patch.object(scenario_analysis, "_target_route", return_value={}))
        self.patch(mock.patch.object(scenario_analysis, "_review_driver", side_effect=RuntimeError("fixture-driver-stop")))
        override = self.root / "custom-entry"
        override.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(self.root / 'dsh-dev'))} \"$@\"\n")
        override.chmod(0o755)
        for custom in (False, True):
            if custom:
                os.environ["DSH_EVAL_DSH_DEV"] = str(override)
                evaluation.start_instance("fixture", "fixture")
                evaluation.authentication_url("fixture")
                self.assertTrue(evaluation.stop_instance("fixture"))
            run = self.root / "evolution/experiments/EXP-fixture-001/runs" / str(custom)
            scenario_analysis.review_full(run, [], {"run_id": "run-fixture", "source_id": "fixture", "evaluation_cases": [], "case_catalog": []})
        calls = self.calls()
        self.assertEqual([row["args"][0] for row in calls], ["up", "url", "down"] * 3)
        self.assertEqual({row["python"] for row in calls}, {sys.executable})

    def test_validator_failure_keeps_exit_status_and_safe_diagnostic_in_progress(self):
        self.children()
        os.environ["FIXTURE_API_KEY"] = "fixture-private-value"
        failure = "import sys\nprint('RuntimeError: fixture-private-value token=fixture-secret', file=sys.stderr)\nsys.exit(17)\n"
        evaluation.VALIDATE_REPOSITORY.write_text(failure)
        evaluation.VALIDATE_EXPERIMENT.write_text(failure)
        contract = {"experiment_root": str(self.root), "experiment_id": "EXP-fixture-001", "agent_id": "fixture"}
        check = evaluation.validate_before_run(contract)["repository"]
        self.assertEqual(check["exit_code"], 17)
        self.assertEqual(check["error"], "RuntimeError: <redacted> token=<redacted>")
        with self.assertRaisesRegex(evaluation.EvaluationError, "退出码 17.*RuntimeError"):
            evaluation.validate_after_run(contract)
        for name, result in (("resolve", contract), ("load_evaluation", {}), ("select_case_ids", []),
                             ("execution_for", []), ("dry_run_payload", {"missing_env_names": []})):
            self.patch(mock.patch.object(evaluation, name, return_value=result))
        self.patch(mock.patch.object(evaluation, "emit_result"))
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            result = evaluation.execute(types.SimpleNamespace(source="fixture", case=[], mode="fast", executor="api",
                                       review="none", compare_to=None, dry_run=False))
        self.assertEqual(result, 2)
        self.assertIn("repository（退出码 17）：RuntimeError", stderr.getvalue())
        self.assertNotIn("fixture-private-value", stderr.getvalue())
        self.assertNotIn("fixture-secret", stderr.getvalue())
        self.assertNotIn("JSONDecodeError", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
