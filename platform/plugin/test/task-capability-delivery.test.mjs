import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createServer } from 'node:http'
import { discoverTaskCapabilities } from '../src/tasks/capabilities.ts'
import { applyTaskAssembly, previewTaskAssembly } from '../src/tasks/assembly.ts'
import { candidateDigest, sha256 } from '../src/tasks/files.ts'
import { verifyInspectionReport } from '../src/tasks/inspection-report.ts'
import { verifyTaskDelivery } from '../src/tasks/delivery.ts'

const program = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const adapter = join(program, 'runtime/adapters/dsh-container'), python = process.env.HARNESS_PYTHON || 'python3'
const sourceId = 'EXP-inspection-task-001-r123456abcdef', targetId = 'EXP-inspection-task-002-r123456abcdef'
function write(root, path, body) { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); return file }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'task delivery ')); t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, 'workspace.json', JSON.stringify({ schemaVersion: 1, id: 'workspace-task-test' }))
  const sources = {}
  for (const id of [sourceId, targetId]) {
    const candidate = `evolution/experiments/${id}/candidate`
    write(root, `${candidate}/dsh/workspace/AGENTS.md`, '只读巡检测试资产。')
    write(root, `${candidate}/dsh/managed/task.patch.yml`, '- name: cordis:include\n  config:\n    path: /opt/dsh-presets/inspection-task/agent.cordis.yml\n')
    write(root, `${candidate}/dsh/presets/inspection-task/agent.cordis.yml`, '- name: "@deepseek-ai/dsh-agent"\n')
    write(root, `evolution/experiments/${id}/change.yaml`, 'baseline_ref: "none:first-experiment"\n')
    sources[id] = { agent_id: 'inspection-task', candidate_root: `${candidate}/dsh`, profile: 'web', patch: 'task.patch.yml', preset: 'inspection-task/agent.cordis.yml', guard: null, config_markers: ['inspection-task'], required_env_names: [] }
  }
  write(root, 'config/sources.json', JSON.stringify({ schema_version: '1.1', sources }))
  write(root, `evolution/experiments/${sourceId}/candidate/dsh/workspace/.agents/skills/inspection/SKILL.md`, '# 巡检\n查询指定设备并核对完整性。\n')
  return root
}
function assemblyInput(root) {
  const path = 'dsh/workspace/.agents/skills/inspection/SKILL.md'
  return { target_source: `experiment:${targetId}`, expected_candidate_sha256: candidateDigest(join(root, `evolution/experiments/${targetId}/candidate`)), files: [{ source: `experiment:${sourceId}`, path, expected_source_sha256: sha256(readFileSync(join(root, `evolution/experiments/${sourceId}/candidate/${path}`))), expected_target_sha256: null }] }
}

test('能力目录读取实际来源和原生 MCP，区分发现与验证并过滤凭据', async t => {
  const root = fixture(t)
  const result = await discoverTaskCapabilities(root, { nativeServers: () => [{ id: 'inspection', url: 'https://private.invalid/mcp', token: 'do-not-output', enabled: true, tools: { names: ['list_devices'] } }] })
  assert.equal(result.sources.length, 2); assert.equal(result.sources[0].skills[0].name, 'inspection')
  assert.equal(result.mcp[0].verification, 'configured'); assert.deepEqual(result.mcp[0].tools, ['list_devices'])
  assert.doesNotMatch(JSON.stringify(result), /do-not-output|private.invalid/)
  const digest = execFileSync(python, ['-c', 'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from run_record import candidate_digest; print(candidate_digest(Path(sys.argv[2])))', adapter, join(root, `evolution/experiments/${sourceId}/candidate`)], { encoding: 'utf8', env: { ...process.env, HARNESS_PROGRAM_ROOT: program } }).trim()
  assert.equal(result.sources[0].candidate_sha256, digest)
})

test('装配预览无写入，应用复制真实 Skill 并核对配置引用，拒绝重复应用和来源漂移', async t => {
  const root = fixture(t), input = assemblyInput(root), target = join(root, `evolution/experiments/${targetId}/candidate/${input.files[0].path}`)
  assert.equal((await previewTaskAssembly(root, input)).bindings.status, 'declared'); assert.equal(existsSync(target), false)
  const receipt = await applyTaskAssembly(root, input)
  assert.equal(receipt.experiment_id, targetId); assert.equal(receipt.bindings.runtime_verified, false); assert.match(readFileSync(target, 'utf8'), /完整性/)
  await assert.rejects(applyTaskAssembly(root, input), /已变化/)
  const second = fixture(t), next = assemblyInput(second); next.files[0].expected_source_sha256 = '0'.repeat(64)
  await assert.rejects(previewTaskAssembly(second, next), /来源已变化/)
})

test('整批装配先检查配置绑定，缺失依赖或越界路径不得部分写入', async t => {
  const root = fixture(t), input = assemblyInput(root), config = 'dsh/presets/inspection-task/agent.cordis.yml'
  input.configuration_edits = [{ path: config, content: '- name: cordis:include\n  config:\n    path: /opt/dsh-managed/missing.mjs\n', expected_target_sha256: sha256(readFileSync(join(root, `evolution/experiments/${targetId}/candidate/${config}`))) }]
  await assert.rejects(applyTaskAssembly(root, input), /不存在的资产/)
  assert.equal(existsSync(join(root, `evolution/experiments/${targetId}/candidate/${input.files[0].path}`)), false)
  delete input.configuration_edits; input.files[0].target_path = '../escape.md'; await assert.rejects(applyTaskAssembly(root, input), /相对路径/)
  input.files[0].target_path = 'dsh/workspace/.env'; await assert.rejects(applyTaskAssembly(root, input), /不能作为装配资产/)
  input.files[0].target_path = 'dsh/workspace/link/report.md'; symlinkSync(tmpdir(), join(root, `evolution/experiments/${targetId}/candidate/dsh/workspace/link`))
  await assert.rejects(applyTaskAssembly(root, input), /符号链接/)
})

test('CSV 和 Markdown 真实报告检查设备集合、重复、状态和统计', () => {
  const contract = { expected_device_ids: ['D-1', 'D-2'], expected_statuses: { 'D-1': '正常', 'D-2': '待核对' } }
  assert.equal(verifyInspectionReport('device_id,status\nD-1,正常\nD-2,待核对\n', 'csv', contract).ok, true)
  const text = '# 巡检报告\n\n| 设备ID | 状态 |\n| --- | --- |\n| D-1 | 正常 |\n| D-2 | 待核对 |\n\n设备总数：2\n'
  assert.equal(verifyInspectionReport(text, 'markdown', contract).ok, true)
  assert.equal(verifyInspectionReport(text.replace('设备总数：2', '设备总数：3'), 'markdown', contract).ok, false)
  const missing = verifyInspectionReport('device_id,status\nD-1,正常\nD-1,正常\n', 'csv', contract)
  assert.deepEqual(missing.missing, ['D-2']); assert.deepEqual(missing.duplicates, ['D-1'])
  assert.equal(verifyInspectionReport('device_id,status\nD-1,未知\nD-2,待核对\n', 'csv', contract).ok, false)
  assert.throws(() => verifyInspectionReport('"device_id,status', 'csv', contract), /引号未闭合/)
})

function sealedRun(root) {
  const env = { ...process.env, HARNESS_ASSET_ROOT: root, HARNESS_PROGRAM_ROOT: program }
  const cli = (...args) => execFileSync(python, [join(adapter, 'run_record.py'), '--repo', root, ...args], { env, encoding: 'utf8' }).trim()
  write(root, 'agents/inspection-task/evaluation.md', '# 巡检\n\n#### U-INS-001 报告设备完整\n\n**用户输入**\n\n> 查询 D-1、D-2 并生成 CSV。\n\n**预期**\n\nCSV 含两台设备，设备清单完整。\n')
  const run = cli('init', '--source', `experiment:${sourceId}`, '--case', 'U-INS-001', '--kind', 'technical'), prefix = `evolution/experiments/${sourceId}/runs/${run}`
  const report = 'device_id,status\nD-1,正常\nD-2,正常\n'
  write(root, `${prefix}/evidence/U-INS-001/response.json`, JSON.stringify({ assistant_texts: [report] }))
  const toolReport = { completed: true, markdown: report, report_sha256: sha256(report), download_url: '/assistant/api/task-examples/artifact?run_id=task-test&file=report.md' }
  write(root, `${prefix}/evidence/U-INS-001/trace.jsonl`, [
    { type: 'session', id: 'session-test-1' },
    { type: 'tool/call', data: { callId: 'inspection-call', name: 'task_inspection', arguments: '{}' } },
    { type: 'tool/result', data: { message: { toolCallId: 'inspection-call', isError: false, content: [{ type: 'text', text: JSON.stringify(toolReport) }] } } },
  ].map(event => JSON.stringify({ session_log: 'session.v4.jsonl', event })).join('\n') + '\n')
  write(root, `${prefix}/evidence/U-INS-001/checks.json`, JSON.stringify({ session_id: 'session-test-1', session_preset: 'inspection-task', session_workspace: '/work/harness/workspace', preset_matches: true, workspace_matches: true }))
  write(root, `${prefix}/results.jsonl`, JSON.stringify({ run_id: run, trial_id: 'trial-test', input_id: 'U-INS-001', execution_status: 'completed', verdict: 'passed', observation: '确定性设备清单通过。', evidence_ref: 'evidence/U-INS-001' }) + '\n')
  const contract = JSON.parse(execFileSync(python, [join(adapter, 'source_contract.py'), '--repo', root, '--source', `experiment:${sourceId}`], { env, encoding: 'utf8' })), image = 'sha256:' + '1'.repeat(64)
  write(root, `${prefix}/evidence/dsh-image.json`, JSON.stringify({ local_image_id: image, local_image_tag: contract.image.local_image_tag, image_build_fingerprint: contract.image.build_fingerprint }))
  cli('finalize', '--run', run, '--status', 'completed')
  const artifact = `${prefix}/artifacts/report.csv`; write(root, artifact, report)
  const directory = join(root, '.local/instances/delivery-test')
  write(root, '.local/instances/delivery-test/instance.json', JSON.stringify({ name: 'delivery-test', workspace_id: 'workspace-task-test', asset_root: root, source_id: `experiment:${sourceId}`, agent_id: 'inspection-task', container_name: 'delivery-test-container', image_id: image, image_tag: contract.image.local_image_tag, port: 3184 }))
  const observed = { container: [{ Image: image, State: { Running: true }, Config: { Labels: { 'com.docker.compose.project.working_dir': directory, 'com.docker.compose.project.config_files': join(directory, 'compose.yaml') } }, Mounts: ['workspace', 'presets', 'managed'].map((key, index) => ({ Destination: ['/work/harness/workspace', '/opt/dsh-presets', '/opt/dsh-managed'][index], Source: contract[key], RW: false })) }], image: [{ Config: { Labels: { 'org.ai-agent-harness.dsh.image-build-fingerprint': contract.image.build_fingerprint } } }] }
  return { run, artifact, observed }
}

test('交付检查执行真实封存与来源校验，仅隔离 Docker 边界；不能只凭 running 通过', async t => {
  const root = fixture(t), { run, artifact, observed } = sealedRun(root)
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/csv' }); response.end('device_id,status\nD-1,正常\nD-2,正常\n') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const manifestPath = join(root, '.local/instances/delivery-test/instance.json')
  writeFileSync(manifestPath, JSON.stringify({ ...JSON.parse(readFileSync(manifestPath, 'utf8')), port: server.address().port }))
  const bin = join(root, 'bin'); write(root, 'observation.json', JSON.stringify(observed))
  const script = write(root, 'bin/docker', '#!/usr/bin/env node\nconst fs=require("fs");const o=JSON.parse(fs.readFileSync(process.env.HEP_DELIVERY_TEST_OBSERVATION));process.stdout.write(JSON.stringify(process.argv[2]==="image"?o.image:o.container));\n'); chmodSync(script, 0o700)
  const before = Object.fromEntries(['PATH', 'HARNESS_PYTHON', 'HARNESS_PROGRAM_ROOT', 'HEP_DELIVERY_TEST_OBSERVATION'].map(key => [key, process.env[key]]))
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, HARNESS_PYTHON: python, HARNESS_PROGRAM_ROOT: program, HEP_DELIVERY_TEST_OBSERVATION: join(root, 'observation.json') })
  t.after(() => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value })
  const input = { agent_id: 'inspection-task', source: `experiment:${sourceId}`, run_id: run, instance_name: 'delivery-test', artifacts: [artifact], expected_device_ids: ['D-1', 'D-2'], required_case_ids: ['U-INS-001'], required_tool_names: ['task_inspection'] }
  const passed = await verifyTaskDelivery(root, input); assert.equal(passed.ready, true, JSON.stringify(passed.checks))
  assert.equal((await verifyTaskDelivery(root, { ...input, required_tool_names: ['unrelated_business_tool'] })).ready, false)
  assert.equal((await verifyTaskDelivery(root, { ...input, ready: true, artifacts: ['agents/inspection-task/evaluation.md'] })).ready, false)
  observed.container[0].Mounts[0].RW = true; write(root, 'observation.json', JSON.stringify(observed)); assert.equal((await verifyTaskDelivery(root, input)).ready, false)
  observed.container[0].Mounts[0].RW = false; write(root, 'observation.json', JSON.stringify(observed)); write(root, artifact, 'device_id,status\nD-1,正常\n')
  const missing = await verifyTaskDelivery(root, input); assert.equal(missing.ready, false); assert.equal(missing.checks.find(check => check.name.startsWith('inspection:')).ok, false)
  write(root, `evolution/experiments/${sourceId}/candidate/dsh/workspace/AGENTS.md`, '已改变的指令。')
  const changed = await verifyTaskDelivery(root, input); assert.equal(changed.checks.find(check => check.name === 'candidate_unchanged').ok, false); assert.equal(changed.ready, false)
})
