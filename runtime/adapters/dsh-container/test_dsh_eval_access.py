"""评测入口同时接受当前免认证 URL 和历史 Token URL。"""

import importlib.util
from importlib.machinery import SourceFileLoader
from pathlib import Path
import subprocess
import tempfile
import json
import unittest
from unittest import mock

spec = importlib.util.spec_from_loader("dsh_eval", SourceFileLoader("dsh_eval", str(Path(__file__).with_name("dsh-eval"))))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


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


if __name__ == "__main__":
    unittest.main()
