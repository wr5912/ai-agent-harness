"""DSH 工具入口；固定取证链和研判模型之间只传冻结五源输入。"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import sys
import uuid
from pathlib import Path

import evidence_collection
from model_inference import run_inference
from result_delivery import build_delivery, failure_markdown
from result_storage import persist, build_writeback, build_failure_writeback, SocJudgementClient, SocWriteError

ROOT = Path(__file__).resolve().parent


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def analyze(incident_id, output_root, config):
    if not re.fullmatch(r'INC-\d{8}-\d{6}', incident_id):
        raise ValueError('invalid incident ID')
    run_id = 'run-' + str(uuid.uuid4())
    output = Path(output_root) / run_id
    output.mkdir(parents=True)
    result = {'schema_version': '1.0', 'model': None, 'incident_id': incident_id, 'run_id': run_id, 'status': 'claim_failed', 'llm_invoked': False}
    client = None
    try:
        soc = config['connections']['soc']
        client = SocJudgementClient(soc, output)
        claim = client.claim(incident_id)
        result['judgement_id'] = claim['judgementId']
        result['status'] = 'evidence_failed'
        args = evidence_collection.parse_args([
            '--incident-id', incident_id, '--base-url', soc['url'],
            '--catalog-dir', soc['catalogDir'], '--output-dir', str(output / 'fusion'),
            '--list-timezone', 'Asia/Shanghai',
        ])
        # 原入口的路径输出不是模型输入，也不混入工具 JSON。
        with contextlib.redirect_stdout(io.StringIO()):
            fusion = evidence_collection.run(args)
        manifest = read_json(fusion / 'manifest.json')
        result['route'] = manifest['route']
        ledger = fusion / 'call-ledger.audit.json'
        if ledger.exists():
            calls = read_json(ledger)
            result['mcp_calls'] = len(calls)
            result['mcp_failures'] = sum(row['status'] == 'failed' for row in calls)
        if manifest['route'] == 'fast_classification':
            result.update(status='completed', validation={'status': 'not_applicable_fast_classification'},
                          result=read_json(fusion / 'fast-classification-output.json'))
        else:
            frozen = fusion / 'five-source-output.json'
            result['input_sha256'] = hashlib.sha256(frozen.read_bytes()).hexdigest()
            try:
                model_config = config['analysisModel']
                model_base_url = model_config['baseURL']
                model_name = model_config['model']
                if not model_base_url or not model_name:
                    raise ValueError('missing analysis model configuration')
                result['llm_invoked'] = True
                result['model'] = model_name
                verdict = run_inference(
                    five_source=read_json(frozen),
                    system_prompt=(ROOT / 'prompts/threat-analysis-system.txt').read_text(encoding='utf-8'),
                    base_url=model_base_url, model=model_name,
                    api_key=os.environ.get(model_config.get('apiKeyEnv', '')) or None,
                    output_dir=output / 'model', timeout=300, temperature=0.1,
                )
                result.update(status='completed', result=verdict)
            except Exception as error:
                result.update(status='model_failed', error_type=type(error).__name__)
            metadata_path = output / 'model/request-metadata.json'
            if metadata_path.exists():
                metadata = read_json(metadata_path)
                result['model'] = metadata.get('response_model') or metadata.get('model')
            validation_path = output / 'model/validation.json'
            if validation_path.exists():
                validation = read_json(validation_path)
                # 校验结果由代码提供，与模型原文分开交付。
                result['validation'] = {k: validation[k] for k in ('status', 'warnings', 'error_type') if k in validation}
                if validation['status'] == 'failed':
                    result['status'] = 'contract_failed'
                    result['validation']['error'] = validation.get('error')
                    parsed_path = output / 'model/model-analysis-output.json'
                    if parsed_path.exists():
                        # 严格校验仍失败；可解析的模型内容可展示，但不是已核实结论。
                        parsed = read_json(parsed_path)
                        if isinstance(parsed, dict):
                            result.update(status='completed', result=parsed)
                            result.pop('error_type', None)
    except Exception as error:
        result['error_type'] = type(error).__name__
        if isinstance(error, SocWriteError):
            result['error_code'] = error.code
    if result['status'] == 'completed':
        try:
            delivery = build_delivery(result)
            # 先保留报告与回写请求，即使远端保存失败也可独立检查与再次交付。
            (output / 'report.html').write_text(delivery['report_html'], encoding='utf-8')
            storage = {}
            try:
                writeback = build_writeback(result, delivery['report_html'])
                (output / 'writeback.json').write_text(json.dumps(writeback, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                storage['summary'] = client.write('result', result['judgement_id'], writeback)
            except Exception as error:
                state = {'status': 'failed', 'error_type': type(error).__name__}
                if isinstance(error, ValueError):
                    state['error'] = str(error)
                (output / 'writeback-error.json').write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
                storage['summary'] = state
            report_url = config.get('connections', {}).get('report', {}).get('url')
            if report_url:
                storage['report'] = persist(result, delivery['report_html'], report_url)['report']
            delivery = build_delivery(result, storage=storage)
            (output / 'summary.json').write_text(json.dumps(delivery['summary'], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            (output / 'summary.md').write_text(delivery['markdown'], encoding='utf-8')
            (output / 'report.html').write_text(delivery.pop('report_html'), encoding='utf-8')
            result['delivery'] = delivery
        except Exception as error:
            # 阅读视图生成失败与研判结论分开记录；原始结果仍保存。
            result['delivery'] = {'status': 'failed', 'error_type': type(error).__name__,
                                  'markdown': '研判已完成，但阅读内容生成失败。\n\n运行 ID：' + run_id}
    else:
        result['delivery'] = {'status': 'not_generated', 'markdown': failure_markdown(result)}
        if result.get('judgement_id'):
            state = client.write('fail', result['judgement_id'], build_failure_writeback(result))
            result['delivery']['storage'] = {'summary': state}
            result['delivery']['markdown'] += '\nSOC 失败状态回写：' + ('已保存' if state['status'] == 'saved' else '保存失败') + '\n'
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    root = Path(os.environ['DSH_HOME']) / 'threat-analysis'
    print(json.dumps(analyze(sys.argv[1], root, json.loads(os.environ['THREAT_ANALYSIS_CONFIG'])), ensure_ascii=False))
