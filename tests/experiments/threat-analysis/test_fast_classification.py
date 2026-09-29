import pathlib
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/threat-analysis'))
from fast_classification import classify, collect_lists, extract_indicators, normalize_ioc
from fusion_contract import CallOutcome

NOW = datetime(2026, 9, 23, tzinfo=timezone.utc)
ALERT = {'alert_id': 'A1', 'rule_id': 'R1', 'source_ip': '192.0.2.1'}
WHITE = {'id': 1, 'type': 'SRC_IP', 'value': '192.0.2.1', 'enabled': True}
BLACK = {'id': 2, 'iocType': 'IP', 'iocValue': '192.0.2.1', 'enabled': 1, 'disposition': 'BLACKLIST'}

class FastClassificationTest(unittest.TestCase):
    def decide(self, white=(), intel=(), complete=True, alerts=None):
        return classify({}, [ALERT] if alerts is None else alerts, list(white), list(intel), complete=complete, queried_at=NOW.isoformat(), now=NOW)

    def test_white_and_exact_contract(self):
        result = self.decide([WHITE])
        self.assertEqual(set(result), {'verdict', 'matches'})
        self.assertEqual(result['verdict'], '误报')
        self.assertEqual(set(result['matches'][0]), {'source', 'entry_id', 'entity_value', 'evidence_refs', 'list_version', 'queried_at'})
        self.assertEqual(result['matches'][0]['source'], 'alert_whitelist')
        self.assertTrue(result['matches'][0]['evidence_refs'])

    def test_black_and_intel_white(self):
        self.assertEqual(self.decide(intel=[BLACK])['verdict'], '真实告警')
        self.assertEqual(self.decide(intel=[dict(BLACK, disposition='WHITELIST')])['verdict'], '误报')

    def test_conflict_no_hit_incomplete_indicator(self):
        for w, b, complete in [([WHITE], [BLACK], True), ([], [], True), ([WHITE], [], False), ([], [dict(BLACK, disposition='INDICATOR')], True)]:
            self.assertIsNone(self.decide(w, b, complete))

    def test_scope_role_disabled_expired(self):
        for changes in [{'scopeRuleIds': ['R2']}, {'type': 'DEST_IP'}, {'enabled': False}, {'expiresAt': '2026-09-22T00:00:00Z'}]:
            self.assertIsNone(self.decide([dict(WHITE, **changes)]))
        self.assertIsNotNone(self.decide([dict(WHITE, type='IP_CIDR', value='192.0.2.0/24', scopeRuleIds=['R1'])]))

    def test_all_ioc_types_and_exactness(self):
        for kind, value, actual in [('DOMAIN', 'EXAMPLE.COM.', 'example.com'), ('URL', 'HTTPS://Example.COM/a?x=1', 'https://example.com/a?x=1'), ('HASH', 'A'*64, 'a'*64)]:
            alert = dict(ALERT, observables=[{'type': kind, 'value': actual}])
            self.assertEqual(self.decide(intel=[dict(BLACK, iocType=kind, iocValue=value)], alerts=[alert])['verdict'], '真实告警')
        self.assertNotEqual(normalize_ioc('URL', 'https://a.test/A'), normalize_ioc('URL', 'https://a.test/a'))
        self.assertIsNone(self.decide(intel=[dict(BLACK, iocValue='192.0.2.10')]))

    def test_no_text_scanning_or_neighbor_expansion(self):
        values = extract_indicators({'description': 'evil.test', 'neighbors': [{'ip': '192.0.2.9'}]}, [{'alert_id': 'A', 'description': 'evil.test'}])
        self.assertEqual(values, [])

    def test_malformed_active_entry_forces_fallback(self):
        self.assertIsNone(self.decide([WHITE], [dict(BLACK, iocType='IP', iocValue='bad')]))

    def test_paginated_lists_and_failure(self):
        class Runner:
            def __init__(self, fail=False): self.calls=[]; self.fail=fail
            def call(self, **kwargs):
                self.calls.append(kwargs)
                if kwargs['resource']=='ai_soc_detect': data=[WHITE]
                else:
                    n=kwargs['arguments']['pageNum']
                    data={'rows': [dict(BLACK, id=n)], 'total': 2}
                return SimpleNamespace(outcome=CallOutcome.FAILED if self.fail else CallOutcome.SUCCESS_WITH_DATA, data=data)
        runner=Runner()
        white, intel, audit=collect_lists(runner, page_size=1)
        self.assertTrue(audit['complete']); self.assertEqual(len(intel), 2)
        self.assertFalse(collect_lists(Runner(True))[2]['complete'])
        self.assertFalse(collect_lists(Runner(), page_size=1, max_pages=1)[2]['complete'])


class EntryRoutingTest(unittest.TestCase):
    def test_fast_exit_precedes_all_enrichment(self):
        import tempfile
        import json
        from unittest.mock import patch
        import evidence_collection as entry
        from mcp_gateway import McpCallResult
        incident = {'incidentId': 'I1', 'contributingAlertsJson': '["A1"]'}
        def result(data):
            return McpCallResult(CallOutcome.SUCCESS_WITH_DATA, data, 1, 1, '', {})
        class Runner:
            def __init__(self, gateway): self.ledger=[]
            def call(self, **kwargs):
                name=kwargs['tool']
                if name.endswith('get_correlate_incident_by_incident_id'): return result(incident)
                if name.endswith('list_detect_whitelist'): return result([WHITE])
                if name.endswith('get_correlate_threat_intel'): return result({'rows': [], 'total': 0})
                raise AssertionError('fast exit made an enrichment call: '+name)
            def fetch_alerts(self, ids, workers): return [result(ALERT)]
        with tempfile.TemporaryDirectory() as tmp, patch.object(entry, 'AuditRunner', Runner), patch.object(entry, 'McpGateway'), patch.object(entry.McpCatalog, 'from_directory'):
            args=SimpleNamespace(output_dir=str(pathlib.Path(tmp)/'run'),base_url='http://unused.invalid',catalog_dir=tmp,timeout=1,incident_id='I1',workers=1)
            out=entry.run(args)
            self.assertFalse((out/'five-source-output.json').exists())
            self.assertEqual(json.loads((out/'fast-classification-output.json').read_text())['verdict'], '误报')
            self.assertEqual(json.loads((out/'manifest.json').read_text())['route'], 'fast_classification')

    def test_available_direct_entities_route_despite_missing_alerts(self):
        import tempfile
        import json
        from unittest.mock import patch
        import evidence_collection as entry
        from mcp_gateway import McpCallResult
        def result(data): return McpCallResult(CallOutcome.SUCCESS_WITH_DATA, data, 1, 1, '', {})
        class ReachedFusion(Exception): pass
        cases = [
            ([ALERT], {}, [WHITE], [], True, '误报'),
            ([ALERT], {}, [], [BLACK], True, '真实告警'),
            ([], {'sourceIp': '192.0.2.1'}, [], [BLACK], True, '真实告警'),
            ([ALERT], {}, [WHITE], [BLACK], True, None),
            ([ALERT], {}, [], [], True, None),
            ([ALERT], {}, [], [BLACK], False, None),
        ]
        for alerts, fields, white, intel, complete, verdict in cases:
            with self.subTest(verdict=verdict, complete=complete, alerts=len(alerts)):
                class Runner:
                    def __init__(self, gateway): self.ledger=[]
                    def call(self, **kwargs):
                        if kwargs['tool'].endswith('get_correlate_incident_by_incident_id'):
                            return result(dict(incidentType='HOST_COMPROMISE', contributingAlertsJson='["A1", "A2"]', **fields))
                        raise AssertionError(kwargs['tool'])
                    def fetch_alerts(self, ids, workers): return [result(a) for a in alerts]
                audit_input={'complete':complete, 'errors':[], 'queried_at':NOW.isoformat()}
                with tempfile.TemporaryDirectory() as tmp, patch.object(entry, 'AuditRunner', Runner), patch.object(entry, 'McpGateway'), patch.object(entry.McpCatalog, 'from_directory'), patch.object(entry,'collect_lists',return_value=(white,intel,audit_input)), patch.object(entry,'derive_effective_time_range',side_effect=ReachedFusion):
                    args=SimpleNamespace(output_dir=str(pathlib.Path(tmp)/'run'),base_url='http://unused.invalid',catalog_dir=tmp,timeout=1,incident_id='I1',workers=1)
                    if verdict:
                        out=entry.run(args)
                        self.assertEqual(json.loads((out/'fast-classification-output.json').read_text())['verdict'],verdict)
                        self.assertFalse((out/'five-source-output.json').exists())
                    else:
                        with self.assertRaises(ReachedFusion): entry.run(args)
                    audit=json.loads((pathlib.Path(args.output_dir)/'fast-classification.audit.json').read_text())
                    self.assertFalse(audit['alerts_complete'])
                    self.assertEqual(audit['route'], 'fast_classification' if verdict else 'five_source')


class EvidenceAndFailureTest(unittest.TestCase):
    def test_entity_type_alias_and_field_observables(self):
        indicators=extract_indicators({'entitiesJson': '[{"entityType":"DOMAIN","value":"Evil.Test"}]'}, [{'alert_id':'A1','observables':[{'field':'file.hash.sha256','value':'b'*64}, {'field':'device.ip','value':'192.0.2.4'}]}])
        self.assertEqual({(i['kind'],i['value']) for i in indicators}, {('DOMAIN','evil.test'),('HASH','b'*64),('IP','192.0.2.4')})

    def test_naive_expiry_needs_timezone_and_disabled_invalid_is_ignored(self):
        entry=dict(WHITE,expiresAt='2026-09-24T00:00:00')
        self.assertIsNone(classify({},[ALERT],[entry],[],complete=True,queried_at=NOW.isoformat(),now=NOW))
        self.assertIsNotNone(classify({},[ALERT],[entry],[],complete=True,queried_at=NOW.isoformat(),now=NOW,list_timezone='Asia/Shanghai'))
        self.assertIsNotNone(classify({},[ALERT],[WHITE],[dict(BLACK,enabled=0,iocValue='bad')],complete=True,queried_at=NOW.isoformat(),now=NOW))

    def test_query_exception_truncation_and_repeated_page(self):
        class Runner:
            def __init__(self,mode): self.mode=mode
            def call(self,**kwargs):
                if self.mode=='exception': raise TimeoutError('must not expose detail')
                data=[WHITE] if kwargs['resource']=='ai_soc_detect' else {'rows':[BLACK], 'total':2}
                return SimpleNamespace(data=data,outcome=CallOutcome.TRUNCATED if self.mode=='truncated' else CallOutcome.SUCCESS_WITH_DATA)
        for mode in ['exception','truncated','repeated']:
            audit=collect_lists(Runner(mode),page_size=1)[2]
            self.assertFalse(audit['complete'])
            self.assertNotIn('must not expose detail',str(audit))

    def test_invalid_direct_ip_cannot_hide_black_side(self):
        audit={}
        result=classify({},[dict(ALERT,destination_ip='broken-ip')],[WHITE],[],complete=True,queried_at=NOW.isoformat(),now=NOW,audit=audit)
        self.assertIsNone(result)
        self.assertEqual(audit['reason'],'invalid_direct_indicator')

class DirectPayloadTest(unittest.TestCase):
    def test_device_ip_and_raw_network_fields(self):
        alert={'alert_id':'A1','ocsf':{'device':{'ip':'192.0.2.2'}},'triggering_event':{'raw':{'src_ip':'192.0.2.3','data':{'win':{'eventdata':{'destinationIp':'192.0.2.4','hashes':'SHA256='+('a'*64)}}}}}}
        values={(i['kind'],i['value']) for i in extract_indicators({},[alert])}
        self.assertTrue({('IP','192.0.2.2'),('IP','192.0.2.3'),('IP','192.0.2.4'),('HASH','a'*64)} <= values)

class OcsfSchemaTest(unittest.TestCase):
    def test_mac_observable_does_not_become_domain_or_block_classification(self):
        alert=dict(ALERT,ocsf={'observables':[{'type_id':3,'value':'aa:bb:cc:dd:ee:ff'}]})
        self.assertIsNotNone(classify({},[alert],[WHITE],[],complete=True,queried_at=NOW.isoformat(),now=NOW))
        self.assertEqual(extract_indicators({},[{'ocsf':{'observables':[{'type_id':3,'value':'aa:bb:cc:dd:ee:ff'}]}}]),[])

class EventPolicyTest(unittest.TestCase):
    def test_partial_white_coverage_still_follows_agreed_event_policy(self):
        result=classify({},[ALERT,dict(ALERT,alert_id='A2',source_ip='192.0.2.2')],[WHITE],[],complete=True,queried_at=NOW.isoformat(),now=NOW)
        self.assertEqual(result['verdict'],'误报')

    def test_opposite_lists_on_different_alerts_are_still_a_conflict(self):
        result=classify({},[ALERT,dict(ALERT,alert_id='A2',source_ip='192.0.2.2')],[WHITE],[dict(BLACK,iocValue='192.0.2.2')],complete=True,queried_at=NOW.isoformat(),now=NOW)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
