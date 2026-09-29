"""存储协议、SOC 回写数据与部分失败回归。"""
import base64
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

CODE = Path(__file__).resolve().parents[2] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'
sys.path.insert(0, str(CODE))
import result_storage as storage
from result_delivery import build_delivery


def run(fast=True):
    return {'schema_version': '1.0', 'incident_id': 'INC-20260917-000001',
            'run_id': 'run-test', 'status': 'completed',
            'route': 'fast_classification' if fast else 'five_source', 'llm_invoked': not fast,
            'validation': {'status': 'not_applicable_fast_classification' if fast else 'failed',
                           **({} if fast else {'error_type': 'ValueError', 'error': 'bad path'})},
            'model': None if fast else 'model-returned-name',
            'result': {'verdict': '误报' if fast else '可疑', 'matches': [],
                       'confidence_score': None if fast else 0.7,
                       'reasoning_summary': '待核查证据'}}


class StorageTests(unittest.TestCase):
    def test_soc_fields_and_unchanged_raw_result(self):
        for fast in (True, False):
            r = run(fast); before = copy.deepcopy(r)
            p = storage.build_writeback(r, '<html>报告</html>')
            self.assertEqual(r, before)
            self.assertEqual(p['resultJson'], r)
            self.assertEqual(p['validationStatus'], r['validation']['status'])
            self.assertEqual(p['runId'], r['run_id'])
            self.assertEqual(p['schemaVersion'], '1.0')
            self.assertEqual(p['reportHtml'], '<html>报告</html>')
            self.assertLessEqual(len(p['summary']), 500)
            self.assertEqual(p.get('model'), r['model'])
            self.assertEqual(p.get('confidence'), None if fast else .7)
            if fast:
                self.assertNotIn('model', p)
                self.assertNotIn('confidence', p)
            self.assertNotIn('agentVersion', p)

    def test_soc_claim_and_write_use_registered_tools_and_preserve_request(self):
        def transport(endpoint, payload, timeout):
            calls.append((endpoint, payload))
            data = {'judgementId': 'judgement-test'} if 'claim/invoke' in endpoint else {'reportUrl': '/soc/report', 'replayed': True}
            return {'status': 'success', 'status_code': 200, 'result': {'code': 200, 'data': data}}
        calls = []
        with tempfile.TemporaryDirectory() as root, patch.object(storage, '_default_transport', side_effect=transport):
            client = storage.SocJudgementClient({'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')}, Path(root))
            claim = client.claim(run()['incident_id'])
            body = storage.build_writeback(run(False), '报告')
            state = client.write('result', claim['judgementId'], body)
            self.assertEqual(json.loads((Path(root) / 'soc-result-request.json').read_text()), calls[1][1]['arguments'])
            self.assertEqual(calls[1][1]['arguments'], {'judgementId': 'judgement-test', 'body': body})
            self.assertEqual(calls[1][1]['arguments']['body']['validationStatus'], 'failed')
            self.assertEqual(state['status'], 'saved')
            self.assertNotIn('download_url', state)
            self.assertTrue(state['replayed'])
            self.assertTrue(calls[1][0].endswith('/ai_soc_correlate__update_incident_judgement_result/invoke'))

    def test_soc_business_failure_and_conflict_are_not_success(self):
        for code in (409, 500):
            with tempfile.TemporaryDirectory() as root, patch.object(storage, '_default_transport', return_value={
                    'status': 'success', 'status_code': 200, 'result': {'code': code, 'data': {}}}):
                client = storage.SocJudgementClient({'url': 'http://example.invalid', 'catalogDir': str(CODE / 'catalog')}, Path(root))
                with self.assertRaises(storage.SocWriteError):
                    client.claim(run()['incident_id'])
                state = client.write('result', 'judgement-test', {})
                self.assertEqual(state['status'], 'failed')
                self.assertEqual(state['code'], code)

    def test_long_summary_uses_short_projection_without_truncating_result(self):
        r = run(False); r['result']['reasoning_summary'] = '😀' * 501
        p = storage.build_writeback(r, '报告')
        self.assertLessEqual(len(p['summary']), 500)
        self.assertEqual(p['resultJson']['result']['reasoning_summary'], '😀' * 501)
        self.assertIn('报告', p['summary'])

    def test_html_limit_counts_utf8_not_characters(self):
        storage.build_writeback(run(), 'a' * 1048576)
        with self.assertRaisesRegex(ValueError, 'reportHtml'):
            storage.build_writeback(run(), '中' * 349526)

    def test_invalid_result_is_not_coerced_into_soc_verdict(self):
        r = run(False); r['result']['verdict'] = ['可疑']
        with self.assertRaisesRegex(ValueError, 'verdict'):
            storage.build_writeback(r, '报告')
        r = run(False); r['validation']['status'] = 'request_failed'
        with self.assertRaisesRegex(ValueError, 'validationStatus'):
            storage.build_writeback(r, '报告')

    def test_mcp_and_business_errors_are_not_success(self):
        for response in ({'error': {'code': -1}}, {'result': {'isError': True}},
                         {'result': {'content': [{'type': 'text', 'text': '{"code":"500","msg":"失败"}'}]}},
                         {'result': {'content': [{'type': 'text', 'text': 'not JSON'}]}}):
            with self.subTest(response=response), self.assertRaises(ValueError):
                storage.tool_data(response)
        self.assertEqual(storage.tool_data({'result': {'content': [{'type': 'text', 'text': '{"code":"200","data":{"id":"file-test"}}'}]}}), {'id': 'file-test'})

    def test_report_failure_preserves_result_and_never_saves_summary(self):
        r = run(); calls = []
        def save(self, args):
            calls.append(args)
            if args['resultType'] == 'report': raise TimeoutError()
            return {'id': 'record-test'}
        with patch.object(storage.PersistenceClient, 'save', save):
            result = storage.persist(r, '<html>报告</html>', 'http://example.invalid/mcp')
        self.assertEqual(result['report']['status'], 'failed')
        self.assertEqual(result['summary']['status'], 'not_configured')
        self.assertEqual(len(calls), 1)
        self.assertNotIn('payloadJson', calls[0])
        self.assertEqual(r['status'], 'completed')

    def test_saved_report_uses_only_returned_http_url(self):
        for url in ('https://example.invalid/report?q=a&b=2', None, 'javascript:alert(1)'):
            def save(self, args):
                if args['resultType'] == 'report':
                    self_outer.assertEqual(base64.b64decode(args['fileContentBase64']).decode(), '<html>报告</html>')
                    return {'id': 'file-test', 'downloadUrl': url}
                return {'id': 'record-test'}
            self_outer = self
            with patch.object(storage.PersistenceClient, 'save', save):
                state = storage.persist(run(), '<html>报告</html>', 'http://example.invalid/mcp')
            self.assertEqual(state['summary']['status'], 'not_configured')
            d = build_delivery(run(), storage=state)
            self.assertIn('已保存', d['markdown'])
            if url and url.startswith('https:'):
                self.assertEqual(state['report']['download_url'], url)
                self.assertIn('[下载 HTML 报告]', d['markdown'])
            else:
                self.assertNotIn('download_url', state['report'])
                self.assertIn('未返回有效下载链接', d['markdown'])
            self.assertNotIn('保存与下载', d['report_html'])


if __name__ == '__main__': unittest.main()
