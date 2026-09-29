"""验证 DSH 接入不改变快速分流和冻结模型输入边界。"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

CODE = Path(__file__).resolve().parents[2] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(CODE))
import dsh_runner


class DeliveryTests(unittest.TestCase):
    def deliver(self, raw, route='fast_classification', validation=None):
        self.assertTrue(hasattr(dsh_runner, 'build_delivery'), '需要固定代码交付摘要和报告')
        return dsh_runner.build_delivery({
            'incident_id': 'INC-20260917-000001', 'run_id': 'run-test',
            'status': 'completed', 'route': route, 'result': raw,
            'validation': validation or {'status': 'passed'},
        })

    def test_fast_projection_preserves_all_matches_and_raw_result(self):
        raw = {'verdict': '误报', 'matches': [
            {'source': 'alert_whitelist', 'entry_id': f'wl-{i}', 'entity_value': '192.0.2.1',
             'evidence_refs': [f'ref-{n}' for n in range(414)], 'list_version': None,
             'queried_at': '2026-09-28T10:00:00+08:00'} for i in range(2)]}
        before = json.dumps(raw)
        delivery = self.deliver(raw)
        self.assertEqual(json.dumps(raw), before)
        self.assertEqual(len(delivery['summary']['matches']), 2)
        self.assertEqual(delivery['summary']['matches'][0]['evidence_refs_nums'], 414)
        self.assertNotIn('entry_id', delivery['summary']['matches'][0])
        self.assertIn('ref-413', delivery['report_html'])
        self.assertIn('wl-1', delivery['report_html'])
        self.assertNotIn('ref-413', delivery['markdown'])
        self.assertEqual(delivery['storage'], {'summary': 'not_configured', 'report': 'not_configured'})
        self.assertNotIn('report_url', delivery)
        self.assertIn('暂无下载链接', delivery['markdown'])

    def test_malformed_fields_still_have_readable_unvalidated_delivery(self):
        for raw in ({'verdict': ['可疑'], 'primary_claim': '主张原文', 'key_claims': None},
                    {'key_claims': [None], 'recommended_actions': '核查主机'},
                    {'verdict': '可疑', 'rule_optimization_suggestions': [{'rule': None}],
                     'reasoning_summary': '<script>模型原文</script>'}):
            with self.subTest(raw=raw):
                before = json.dumps(raw)
                delivery = self.deliver(raw, 'five_source', {'status': 'failed', 'error': 'invalid fields'})
                self.assertEqual(json.dumps(raw), before)
                for label in ('校验状态', '校验问题', '校验提示', '校验未通过', 'invalid fields', '不能视为已核实结论'):
                    self.assertNotIn(label, delivery['markdown'])
                    self.assertNotIn(label, delivery['report_html'])
                self.assertIn('字段原文', delivery['report_html'])
                self.assertNotIn('字段原文', delivery['markdown'])
                self.assertIn('核心判断', delivery['markdown'])
                self.assertIn('推理摘要', delivery['markdown'])
                self.assertNotIn('核查主机', delivery['markdown'])
                for content in (delivery['markdown'], delivery['report_html']):
                    self.assertNotIn('<script>', content)
                self.assertEqual(delivery['summary']['validation']['status'], 'failed')

    def test_full_content_warning_and_untrusted_text(self):
        raw = {'verdict': '可疑', 'primary_claim': {'type': '<script>alert(1)</script>', 'result': '证据不足'},
               'secondary_findings': None, 'confidence_score': 0.7, 'attack_stage': None,
               'technique': None, 'technique_name': None,
               'verified_facts': [{'id': 'F01', 'fact': '已观察事实', 'source': 'graph'}],
               'key_claims': [{'claim': '[伪链接](https://example.invalid) | test', 'result': '支持',
                               'weight': 0.2, 'evidence': [{'source': 'graph', 'field': 'hosts[0]', 'value': {'a': '<img src=x>'}}]}],
               'counter_evidence': [{'claim': '反向主张', 'fact': '反向事实', 'source': 'asset', 'field': 'tags', 'value': 'allowed'}],
               'uncertainty_notes': '仍有缺口', 'attack_chain_speculation': {'current_stage': None, 'observed_path': [], 'possible_next_steps': [], 'supporting_evidence': []},
               'rule_optimization_suggestions': [],
               'recommended_actions': [{'priority': 'P1', 'action': '核查', 'target': '主机', 'reason': '缺口'}],
               'reasoning_summary': '推理内容'}
        delivery = self.deliver(raw, 'five_source', {'status': 'passed_with_warnings', 'warnings': ['引用待核对']})
        self.assertFalse(delivery['summary']['is_fast'])
        self.assertEqual(delivery['summary']['key_claims'], [{'claim': raw['key_claims'][0]['claim'], 'result': '支持'}])
        self.assertIsNone(delivery['summary']['secondary_findings'])
        self.assertNotIn('校验提示', delivery['markdown'])
        self.assertNotIn('引用待核对', delivery['markdown'])
        self.assertEqual(delivery['summary']['validation'], {'status': 'passed_with_warnings', 'warnings': ['引用待核对']})
        self.assertNotIn('引用待核对', delivery['report_html'])
        self.assertNotIn('校验提示', delivery['report_html'])
        self.assertIn('反向事实', delivery['report_html'])
        for content in (delivery['markdown'], delivery['report_html']):
            self.assertIn('推理内容', content)
            self.assertNotIn('<script>', content)
        for removed in ('研判依据与缺口', '反向事实', '仍有缺口', '攻击链分析', '处置建议', '规则优化建议', '已观察事实', '证据引用明细'):
            self.assertNotIn(removed, delivery['markdown'])
        self.assertEqual([line for line in delivery['markdown'].splitlines() if line.startswith('#')],
                         ['### 威胁事件研判摘要', '#### 核心判断', '#### 推理摘要', '#### 保存与下载'])
        for kept in ('结论', '快速研判', '事件 ID', '结论置信度', '原始主张', '主张判断', '其他攻击发现', '攻击阶段', '攻击技术', '技术名称', '置信度表示', '摘要存储', '报告存储', '报告下载', '运行 ID'):
            self.assertIn(kept, delivery['markdown'])
        self.assertIn('hosts[0]', delivery['report_html'])
        self.assertIn('已观察事实', delivery['report_html'])
        self.assertNotIn('[伪链接](', delivery['markdown'])
        for status in ('passed', 'passed_with_warnings', 'failed'):
            with self.subTest(status=status):
                validation = {'status': status, 'error': 'unresolved evidence path', 'warnings': ['引用待核对']}
                projected = self.deliver(raw, 'five_source', validation)
                for text in ('校验状态', '校验问题', '校验提示', 'unresolved evidence path', '引用待核对'):
                    self.assertNotIn(text, projected['markdown'])
                    self.assertNotIn(text, projected['report_html'])
                self.assertNotIn('校验提示', projected['report_html'])
                self.assertNotIn('引用待核对', projected['report_html'])
                self.assertEqual(projected['summary']['validation'], validation)
                self.assertIn('推理内容', projected['markdown'])


class RunnerTests(unittest.TestCase):
    def setUp(self):
        mock = patch.object(dsh_runner, 'SocJudgementClient')
        self.soc = mock.start().return_value
        self.addCleanup(mock.stop)
        self.soc.claim.return_value = {'judgementId': 'judgement-test'}
        self.soc.write.return_value = {'status': 'saved', 'judgement_id': 'judgement-test'}

    def fusion(self, args):
        target = Path(args.output_dir)
        target.mkdir(parents=True)
        (target / 'manifest.json').write_text(json.dumps({'route': self.route}))
        (target / 'fast-classification-output.json').write_text('{"verdict":"误报"}')
        (target / 'five-source-output.json').write_text('{"unified_event_id":"INC-20260917-000001"}')
        (target / 'five-source-audit.json').write_text('{"secret_label":"attack"}')
        return target

    def run_case(self, root):
        return dsh_runner.analyze('INC-20260917-000001', root, {
            'connections': {'soc': {'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')}},
            'analysisModel': {'baseURL': 'http://example.invalid/v1', 'model': 'configured-test-model', 'apiKeyEnv': 'TEST_THREAT_KEY'},
        })

    def test_fast_path_does_not_invoke_model(self):
        self.route = 'fast_classification'
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'run_inference') as model:
            result = self.run_case(Path(root))
            run = Path(root) / result['run_id']
            self.assertTrue((run / 'summary.json').is_file())
            self.assertTrue((run / 'summary.md').is_file())
            self.assertTrue((run / 'report.html').is_file())
            self.assertEqual(json.loads((run / 'result.json').read_text())['result'], {'verdict': '误报'})
        model.assert_not_called()
        self.assertEqual(result['route'], self.route)
        self.assertFalse(result['llm_invoked'])
        self.assertEqual(result['validation']['status'], 'not_applicable_fast_classification')
        self.assertEqual(result['result'], {'verdict': '误报'})

    def test_report_storage_failure_keeps_completed_result_and_local_writeback(self):
        self.route = 'fast_classification'
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'persist', return_value={
                'summary': {'status': 'not_configured'}, 'report': {'status': 'failed', 'error_type': 'TimeoutError'}}) as save:
            result = dsh_runner.analyze('INC-20260917-000001', root, {
                'connections': {'soc': {'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')}, 'report': {'url': 'http://example.invalid/report'}}})
            save.assert_called_once()
            self.assertEqual(result['status'], 'completed')
            self.assertIn('暂无下载链接', result['delivery']['markdown'])
            self.assertEqual(result['delivery']['storage']['summary']['status'], 'saved')
            self.assertTrue((Path(root) / result['run_id'] / 'writeback.json').is_file())

    def test_model_sees_only_frozen_input_and_prompt(self):
        self.route = 'five_source'
        def model(**kwargs):
            self.assertEqual(kwargs['model'], 'configured-test-model')
            self.assertEqual(kwargs['base_url'], 'http://example.invalid/v1')
            self.assertEqual(kwargs['five_source'], {'unified_event_id': 'INC-20260917-000001'})
            self.assertEqual(kwargs['system_prompt'], (CODE / 'prompts/threat-analysis-system.txt').read_text())
            kwargs['output_dir'].mkdir()
            (kwargs['output_dir'] / 'validation.json').write_text('{"status":"passed"}')
            return {'verdict': '真实告警'}
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'run_inference', side_effect=model):
            result = self.run_case(Path(root))
        self.assertEqual(result['status'], 'completed')
        self.assertTrue(result['llm_invoked'])

    def test_missing_model_configuration_is_not_a_model_call(self):
        self.route = 'five_source'
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'run_inference') as model:
            result = dsh_runner.analyze('INC-20260917-000001', root, {'connections': {'soc': {'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')}}})
        model.assert_not_called()
        self.assertFalse(result['llm_invoked'])
        self.assertEqual(result['status'], 'model_failed')

    def test_parsed_contract_failure_is_delivered_with_validation(self):
        self.route = 'five_source'
        raw = {'verdict': '真实告警', 'reasoning_summary': '模型的原始判断'}
        validation = {'status': 'failed', 'error_type': 'ValueError', 'error': 'invalid evidence path'}
        def model(**kwargs):
            kwargs['output_dir'].mkdir()
            for name, value in [('model-analysis-output.json', raw), ('validation.json', validation)]:
                (kwargs['output_dir'] / name).write_text(json.dumps(value))
            raise ValueError(validation['error'])
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'run_inference', side_effect=model) as call:
            result = self.run_case(Path(root))
            self.assertEqual(result['status'], 'completed')
            self.assertEqual(result['result'], raw)
            self.assertEqual(result['validation'], validation)
            self.assertEqual(result['delivery']['summary']['validation'], validation)
            run = Path(root) / result['run_id']
            self.assertFalse((run / 'model/forced-analysis-output.json').exists())
            for name in ('summary.md', 'report.html'):
                content = (run / name).read_text()
                for text in ('校验状态', '校验问题', '校验提示', 'invalid evidence path', '模型结论，校验未通过'):
                    self.assertNotIn(text, content)
                self.assertIn('模型的原始判断', content)
            call.assert_called_once()
            self.assertEqual(self.soc.write.call_args.args[0], 'result')
            body = self.soc.write.call_args.args[2]
            self.assertEqual(body['validationStatus'], 'failed')
            self.assertEqual(body['resultJson']['result'], raw)

    def test_unparseable_model_output_has_no_result(self):
        self.route = 'five_source'
        def model(**kwargs):
            kwargs['output_dir'].mkdir()
            (kwargs['output_dir'] / 'raw-response.json').write_text('{"content":"not json"}')
            (kwargs['output_dir'] / 'validation.json').write_text('{"status":"failed","error_type":"JSONDecodeError","error":"invalid JSON"}')
            raise json.JSONDecodeError('invalid JSON', 'not json', 0)
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'run_inference', side_effect=model):
            result = self.run_case(Path(root))
            self.assertFalse((Path(root) / result['run_id'] / 'report.html').exists())
            self.assertTrue((Path(root) / result['run_id'] / 'model/raw-response.json').exists())
            self.assertIn('无法解析', result['delivery']['markdown'])
        self.assertEqual(result['status'], 'contract_failed')
        self.assertNotIn('result', result)
        self.assertEqual(self.soc.write.call_args.args[0], 'fail')

    def test_claim_failure_stops_evidence_and_model(self):
        self.soc.claim.side_effect = RuntimeError('conflict')
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run') as evidence, patch.object(dsh_runner, 'run_inference') as model:
            result = self.run_case(root)
        self.assertEqual(result['status'], 'claim_failed')
        evidence.assert_not_called()
        model.assert_not_called()
        self.soc.write.assert_not_called()

    def test_evidence_failure_is_written_to_fail(self):
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', side_effect=RuntimeError('connection details')):
            result = self.run_case(root)
        self.assertEqual(result['status'], 'evidence_failed')
        operation, judgement_id, body = self.soc.write.call_args.args
        self.assertEqual((operation, judgement_id), ('fail', 'judgement-test'))
        self.assertEqual(body['runId'], result['run_id'])
        self.assertNotIn('connection details', body['error'])

    def test_unmappable_soc_result_does_not_block_report_storage(self):
        self.route = 'fast_classification'
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'build_writeback', side_effect=ValueError('verdict cannot be mapped to SOC')), patch.object(dsh_runner, 'persist', return_value={
                'report': {'status': 'saved', 'download_url': 'https://example.invalid/report'}}) as report:
            result = dsh_runner.analyze('INC-20260917-000001', root, {'connections': {
                'soc': {'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')},
                'report': {'url': 'http://example.invalid/report'}}})
        report.assert_called_once()
        self.soc.write.assert_not_called()
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['delivery']['storage']['summary']['status'], 'failed')

    def test_soc_failure_does_not_replace_persistence_url_or_result(self):
        self.route = 'fast_classification'
        self.soc.write.return_value = {'status': 'failed', 'error_type': 'TimeoutError'}
        with tempfile.TemporaryDirectory() as root, patch.object(dsh_runner.evidence_collection, 'run', self.fusion), patch.object(dsh_runner, 'persist', return_value={
                'summary': {'status': 'not_configured'}, 'report': {'status': 'saved', 'download_url': 'https://example.invalid/persistence-report'}}):
            result = dsh_runner.analyze('INC-20260917-000001', root, {'connections': {
                'soc': {'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')},
                'report': {'url': 'http://example.invalid/report'}}})
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['delivery']['storage']['summary']['status'], 'failed')
        self.assertIn('https://example.invalid/persistence-report', result['delivery']['markdown'])
        self.assertEqual(self.soc.write.call_args.args[0], 'result')


if __name__ == '__main__':
    unittest.main()
