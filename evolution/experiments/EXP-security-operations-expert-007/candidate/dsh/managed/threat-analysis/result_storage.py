"""SOC 认领和结果回写；persistence MCP 独立保存报告并返回下载地址。"""
from __future__ import annotations

import base64
import copy
import json
import urllib.parse
import urllib.request
from pathlib import Path

from mcp_gateway import McpCatalog, _default_transport, classify_response, extract_result_data
from fusion_contract import CallOutcome

LIMIT = 1048576
VALIDATION_STATUSES = {'passed', 'passed_with_warnings', 'failed', 'not_applicable_fast_classification'}


def build_writeback(run, report_html):
    raw = run['result']
    verdict = raw.get('verdict')
    if verdict not in ('误报', '真实告警', '可疑'):
        raise ValueError('verdict cannot be mapped to SOC')
    validation = run.get('validation', {}).get('status')
    if validation not in VALIDATION_STATUSES:
        raise ValueError('validationStatus cannot be mapped to SOC')
    if run['status'] != 'completed':
        raise ValueError('incomplete judgement requires SOC fail interface')
    if len(report_html.encode('utf-8')) > LIMIT:
        raise ValueError('reportHtml exceeds 1048576 UTF-8 bytes')
    fast = run['route'] == 'fast_classification'
    summary = f"事件 {run['incident_id']}，{'快速' if fast else '完整'}研判结论：{verdict}。"
    if fast:
        summary += f"命中 {len(raw.get('matches', []))} 条名单记录；依据名单规则生成，未进行完整行为研判。"
    else:
        reasoning = raw.get('reasoning_summary')
        detail = reasoning if isinstance(reasoning, str) else ''
        suffix = '模型输出校验未通过，需人工复核。' if validation == 'failed' else ''
        # 生成独立短摘要，超出时使用固定概述；原文全部保留在 resultJson 和报告。
        summary += (detail if len(summary + detail + suffix) <= 500 else '完整研判依据与建议见报告。') + suffix
    if len(summary) > 500:
        raise ValueError('summary exceeds 500 Unicode code points')
    confidence = None if fast else raw.get('confidence_score')
    if confidence is not None and (isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1):
        raise ValueError('confidence cannot be mapped to SOC')
    result_json = copy.deepcopy({k: v for k, v in run.items() if k != 'delivery'})
    result_json['schema_version'] = '1.0'
    if len(json.dumps(result_json, ensure_ascii=False).encode('utf-8')) > LIMIT:
        raise ValueError('resultJson exceeds 1048576 UTF-8 bytes')
    body = {'runId': run['run_id'], 'route': run['route'], 'llmInvoked': run['llm_invoked'],
            'verdict': verdict, 'validationStatus': validation,
            'summary': summary, 'reportHtml': report_html, 'resultJson': result_json,
            'schemaVersion': '1.0', 'agentName': 'threat-analysis'}
    if confidence is not None:
        body['confidence'] = confidence
    if run.get('model'):
        body['model'] = run['model']
    return body


class SocWriteError(RuntimeError):
    def __init__(self, code=None):
        super().__init__('SOC judgement MCP request failed')
        self.code = code


class SocJudgementClient:
    # 与只读取证客户端分开，只能执行这三个已确认的写入工具。
    TOOLS = {
        'claim': 'ai_soc_correlate__create_incident_judgement_claim',
        'result': 'ai_soc_correlate__update_incident_judgement_result',
        'fail': 'ai_soc_correlate__create_correlate_incident_judgement_fail',
    }

    def __init__(self, connection, output):
        self.url = connection['url'].rstrip('/')
        self.catalog = McpCatalog.from_directory(Path(connection['catalogDir']))
        self.output = Path(output)

    def invoke(self, operation, arguments):
        name = self.TOOLS[operation]
        resource = self.catalog.resources['ai_soc_correlate']['id']
        tool = self.catalog.tools[name]
        if tool['resource_id'] != resource:
            raise ValueError('SOC judgement tool resource mismatch')
        # 请求在网络调用前保存；同一 judgementId/runId 可用原请求重试，不重跑研判。
        self.output.mkdir(parents=True, exist_ok=True)
        (self.output / f'soc-{operation}-request.json').write_text(
            json.dumps(arguments, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        response = _default_transport(
            f'{self.url}/api/v1/mcp-resources/{resource}/tools/{name}/invoke',
            {'arguments': arguments}, 30)
        (self.output / f'soc-{operation}-response.json').write_text(
            json.dumps(response, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if not isinstance(response, dict):
            raise SocWriteError()
        if classify_response(response) not in (CallOutcome.SUCCESS_WITH_DATA, CallOutcome.SUCCESS_EMPTY):
            inner = response.get('result')
            raise SocWriteError(inner.get('code', response.get('status_code')) if isinstance(inner, dict) else response.get('status_code'))
        return extract_result_data(response)

    def claim(self, incident_id):
        data = self.invoke('claim', {'incidentId': incident_id})
        if not isinstance(data, dict) or not isinstance(data.get('judgementId'), str) or not data['judgementId']:
            raise ValueError('SOC claim missing judgementId')
        return data

    def write(self, operation, judgement_id, body):
        try:
            data = self.invoke(operation, {'judgementId': judgement_id, 'body': body})
            # SOC reportUrl 只保留在响应文件，不作为网页报告下载来源。
            return {'status': 'saved', 'judgement_id': judgement_id,
                    'replayed': isinstance(data, dict) and data.get('replayed') is True}
        except Exception as error:
            state = {'status': 'failed', 'error_type': type(error).__name__}
            if isinstance(error, SocWriteError):
                state['code'] = error.code
            return state


def build_failure_writeback(run):
    # 只传阶段与错误类别，避免异常文本带出连接凭据；详细证据留在本地运行目录。
    body = {'runId': run['run_id'], 'errorType': run.get('error_type', run['status']),
            'error': f"{run['status']}: {run.get('error_type', 'no deliverable result')}",
            'resultJson': copy.deepcopy({k: v for k, v in run.items() if k != 'delivery'}),
            'agentName': 'threat-analysis'}
    if run.get('model'):
        body['model'] = run['model']
    return body


def tool_data(response):
    if response.get('error') or not isinstance(response.get('result'), dict):
        raise ValueError('persistence MCP protocol error')
    result = response['result']
    if result.get('isError'):
        raise ValueError('persistence MCP tool error')
    try:
        body = json.loads(next(c['text'] for c in result.get('content', []) if c.get('type') == 'text'))
    except (ValueError, StopIteration, KeyError, TypeError):
        raise ValueError('persistence MCP invalid result') from None
    if not isinstance(body, dict) or str(body.get('code')) != '200' or not isinstance(body.get('data'), dict):
        raise ValueError('persistence MCP business error')
    return body['data']


class PersistenceClient:
    def __init__(self, url):
        self.url = url
        self.headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        self.initialized = False
        self.sequence = 0

    def rpc(self, method, params, notification=False):
        self.sequence += 1
        payload = {'jsonrpc': '2.0', 'method': method, 'params': params}
        if not notification:
            payload['id'] = self.sequence
        request = urllib.request.Request(self.url, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers=self.headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.headers.get('Mcp-Session-Id'):
                self.headers['Mcp-Session-Id'] = response.headers['Mcp-Session-Id']
            body = response.read().decode('utf-8')
            if notification:
                return {}
            if response.headers.get('Content-Type', '').startswith('text/event-stream'):
                for event in body.split('\n\n'):
                    data = '\n'.join(line[5:].lstrip() for line in event.splitlines() if line.startswith('data:'))
                    if data:
                        value = json.loads(data)
                        if value.get('id') == payload['id']:
                            return value
                raise ValueError('persistence MCP missing response')
            return json.loads(body)

    def save(self, arguments):
        if not self.initialized:
            response = self.rpc('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {},
                                               'clientInfo': {'name': 'threat-analysis', 'version': '1.0'}})
            if response.get('error') or not response.get('result', {}).get('protocolVersion'):
                raise ValueError('persistence MCP initialization failed')
            self.headers['MCP-Protocol-Version'] = response['result']['protocolVersion']
            self.rpc('notifications/initialized', {}, notification=True)
            self.initialized = True
        return tool_data(self.rpc('tools/call', {'name': 'save_persistence_result', 'arguments': arguments}))


def persist(run, report_html, url):
    client = PersistenceClient(url)
    common = {'businessId': run['run_id'], 'sourceModule': 'threat-analysis', 'revision': 1}
    states = {'summary': {'status': 'not_configured'}}
    try:
        if len(report_html.encode('utf-8')) > LIMIT:
            raise ValueError('reportHtml exceeds 1048576 UTF-8 bytes')
        args = dict(common, resultType='report', contentType='text/html',
                    fileName=run['incident_id'] + '-' + run['run_id'] + '.html',
                    fileContentBase64=base64.b64encode(report_html.encode('utf-8')).decode('ascii'))
        data = client.save(args)
        if not isinstance(data.get('id'), str) or not data['id']:
            raise ValueError('persistence MCP missing storage id')
        state = {'status': 'saved', 'id': data['id']}
        url_value = data.get('downloadUrl')
        if isinstance(url_value, str):
            parsed = urllib.parse.urlsplit(url_value)
            if parsed.scheme in ('http', 'https') and parsed.netloc:
                state['download_url'] = url_value
        states['report'] = state
    except Exception as error:
        # 不回显网络异常中的地址或认证信息；保存失败不改变研判结论。
        states['report'] = {'status': 'failed', 'error_type': type(error).__name__}
        if isinstance(error, ValueError):
            states['report']['error'] = str(error)
    return states
