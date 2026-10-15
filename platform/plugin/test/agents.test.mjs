import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const repo = new URL('../../../', import.meta.url).pathname
const plugin = new URL('../', import.meta.url).pathname

async function loadServer() {
  const outdir = mkdtempSync(join(tmpdir(), 'agents-build-'))
  const outfile = join(outdir, 'agents-server.mjs')
  await build({
    entryPoints: [join(plugin, 'src/agents/index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['@deepseek-ai/dsh-client-connection'],
  })
  return import(`file://${outfile}`)
}

function run(cwd, command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`)
  return result.stdout.trim()
}

function write(file, body) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, body)
}

function copyFixtureFile(root, rel) {
  const target = join(root, rel)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(repo, rel), target)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'agents-fixture-'))
  for (const rel of [
    'runtime/adapters/dsh-container/dsh-eval',
    'runtime/adapters/dsh-container/source_contract.py',
    'runtime/adapters/dsh-container/scenario_analysis.py',
    'runtime/adapters/dsh-container/run_record.py',
    'runtime/adapters/dsh-container/mutation-receipt.py',
    '.agents/skills/research-eval/scripts/evaluation_contract.py',
    '.agents/skills/research-eval/scripts/validate_experiment.py',
    '.agents/skills/harness-evolution/scripts/validate_repository.py',
  ]) copyFixtureFile(root, rel)
  for (const name of ['Dockerfile', 'apt-mirror.sh', 'build-image.sh', 'dsh-cli.sh', 'remote-host-settings.patch']) {
    write(join(root, 'runtime/adapters/dsh-container', name), `${name}\n`)
  }
  write(join(root, 'runtime/adapters/dsh-container/source.lock.json'), JSON.stringify({
    repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    commit: '21638c5630000000000000000000000000000000',
    tree: '31638c5630000000000000000000000000000000',
    pnpm_lock_sha256: '4'.repeat(64),
    package_manager: 'pnpm@10.0.0',
    node_base: `node:20@sha256:${'5'.repeat(64)}`,
    platform: 'linux/amd64',
    local_image_tag: 'ai-agent-harness/dsh:21638c563',
    cli_version: '0.2.1-alpha.2',
    cli_package: '@deepseek-ai/dsh',
  }, null, 2) + '\n')
  write(join(root, 'agents/test-agent/manifest.yaml'), 'schema_version: 1.0\nagent_id: test-agent\nactive_experiment: EXP-test-agent-001\n')
  write(join(root, 'agents/test-agent/evaluation.md'), [
    '# Evaluation',
    '',
    '## 基础',
    '',
    '#### U-CASE-001 基础',
    '**评估档位：** `fast`',
    '',
    '**用户输入**',
    '> ping',
    '',
    '**预期**',
    '返回 pong。',
    '',
  ].join('\n'))
  write(join(root, 'evolution/experiments/EXP-test-agent-001/change.yaml'), 'schema_version: 1.0\nexperiment_id: EXP-test-agent-001\nagent_id: test-agent\nbaseline_ref: none:first-experiment\nstatus: active\nfusion_sources:\n  - EXP-test-agent-000\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/hypothesis.md'), '# Hypothesis\n\n验证基础资产。参考 EXP-test-agent-099 但不声明继承。\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/evaluation/observations.md'), '# Observations\n\n尚未执行。\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/decision.md'), '# Decision\n\n状态：continue\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/harness.yaml'), 'name: test\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/roles/analyst/AGENTS.md'), '# Analyst\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/dsh/workspace/input.txt'), 'workspace\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/dsh/managed/test-agent.patch.yml'), 'patch: test\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/dsh/presets/test-agent/preset.yml'), 'preset: test\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/RuntimeHOME/session.txt'), 'must not copy\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/candidate/history/log.txt'), 'must not copy\n')
  write(join(root, 'evolution/experiments/EXP-test-agent-001/runs/run-11111111-1111-4111-8111-111111111111/run.json'), '{"status":"failed"}\n')
  write(join(root, 'runtime/adapters/dsh-container/sources.json'), JSON.stringify({
    schema_version: '1.1',
    sources: {
      'EXP-test-agent-001': {
        agent_id: 'test-agent',
        candidate_root: 'evolution/experiments/EXP-test-agent-001/candidate/dsh',
        profile: 'web',
        patch: 'test-agent.patch.yml',
        preset: 'test-agent/preset.yml',
        guard: null,
        config_markers: ['test'],
        required_env_names: [],
      },
    },
  }, null, 2) + '\n')
  run(root, 'git', ['init'])
  run(root, 'git', ['config', 'user.email', 'test@example.invalid'])
  run(root, 'git', ['config', 'user.name', 'Test'])
  run(root, 'git', ['add', '.'])
  run(root, 'git', ['commit', '-m', 'fixture'])
  const commit = run(root, 'git', ['rev-parse', 'HEAD'])
  return { root, commit }
}

async function rpc(handler, endpoint, payload = {}) {
  const result = await handler(endpoint, payload, new AbortController().signal)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message} ${JSON.stringify(result.error.details ?? {})}`)
  return result.value
}

async function waitForJob(handler, jobId) {
  for (let index = 0; index < 20; index += 1) {
    const status = await rpc(handler, 'eval/status', { job_id: jobId })
    if (status.status !== 'running') return status
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('job did not finish')
}

test('agents detail reads manifest, selectable versions, real cases, refs and editable files', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const detail = await rpc(createAgentsHandler(fx.root), 'detail', { agent_id: 'test-agent' })
    assert.equal(detail.agent.manifest.agent_id, 'test-agent')
    assert.equal(detail.declared.catalog_source.candidate_root, 'evolution/experiments/EXP-test-agent-001/candidate/dsh')
    assert.equal(detail.loaded_instance.status, 'not_queried')
    assert.equal(detail.evaluation.cases[0].id, 'U-CASE-001')
    assert.equal(detail.fusion.status, 'declared')
    assert.deepEqual(detail.fusion.experiments, ['EXP-test-agent-000'])
    assert.deepEqual(detail.related_references, ['EXP-test-agent-099'])
    assert.ok(detail.editable_files.includes('evolution/experiments/EXP-test-agent-001/candidate/harness.yaml'))
    assert.ok(detail.editable_files.includes('evolution/experiments/EXP-test-agent-001/candidate/roles/analyst/AGENTS.md'))
    assert.equal(detail.verification.runs[0].id, 'run-11111111-1111-4111-8111-111111111111')
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('agents detail defaults to newest version while preserving explicit selection and manifest', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const manifestPath = join(fx.root, 'agents/test-agent/manifest.yaml')
    const manifest = readFileSync(manifestPath, 'utf8')
    cpSync(join(fx.root, 'evolution/experiments/EXP-test-agent-001/candidate'), join(fx.root, 'evolution/experiments/EXP-test-agent-010-r123456789abc/candidate'), { recursive: true })
    write(join(fx.root, 'evolution/experiments/EXP-test-agent-010-r123456789abc/change.yaml'), 'experiment_id: EXP-test-agent-010-r123456789abc\nagent_id: test-agent\nbaseline_ref: none:first-experiment\nstatus: active\n')
    const handler = createAgentsHandler(fx.root)
    const latest = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    assert.equal(latest.experiment.id, 'EXP-test-agent-010-r123456789abc')
    assert.deepEqual(latest.versions.map(version => version.id), ['EXP-test-agent-010-r123456789abc', 'EXP-test-agent-001'])
    const older = await rpc(handler, 'detail', { agent_id: 'test-agent', experiment_id: 'EXP-test-agent-001' })
    assert.equal(older.experiment.id, 'EXP-test-agent-001')
    assert.equal(readFileSync(manifestPath, 'utf8'), manifest)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('融合确认拒绝预览后变化的 Candidate，避免沿用过期覆盖关系', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const preview = await rpc(handler, 'fusion/preview', {
      agent_id: 'test-agent', parent_experiment_id: 'EXP-test-agent-001', parent_ref: `git:${fx.commit}`,
      research_question: '在固定父版上验证基础能力',
      plan: { sources: [], features: [], conflicts: [], checks: [
        { id: 'actual-load', kind: 'load' },
        { id: 'basic-capability', kind: 'capability', case_ids: ['U-CASE-001'] },
      ] },
    })
    assert.deepEqual(preview.inventory.covered, ['EXP-test-agent-001'])
    write(join(fx.root, 'evolution/experiments/EXP-test-agent-001/candidate/dsh/workspace/input.txt'), 'changed after preview\n')
    await assert.rejects(() => rpc(handler, 'fusion/confirm', { preview_id: preview.preview_id, confirmed: true }), /conflict:/)
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(fx.root, 'runtime/adapters/dsh-container/sources.json'), 'utf8')).sources), ['EXP-test-agent-001'])
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('未变化的融合预览可创建版本，但缺少真实验证不能完成', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const preview = await rpc(handler, 'fusion/preview', {
      agent_id: 'test-agent', parent_experiment_id: 'EXP-test-agent-001', parent_ref: `git:${fx.commit}`,
      research_question: '建立基础能力的待验证版本',
      plan: { sources: [], features: [], conflicts: [], checks: [
        { id: 'actual-load', kind: 'load' },
        { id: 'basic-capability', kind: 'capability', case_ids: ['U-CASE-001'] },
      ] },
    })
    const created = await rpc(handler, 'fusion/confirm', { preview_id: preview.preview_id, confirmed: true })
    assert.equal(created.creation_status, 'integrating')
    const status = await rpc(handler, 'fusion/status', { experiment_id: created.experiment_id })
    assert.equal(status.creation.status, 'integrating')
    assert.deepEqual(status.creation.receipts, [])
    await assert.rejects(() => rpc(handler, 'fusion/finalize', {
      experiment_id: created.experiment_id, expected_candidate_sha256: status.candidate_sha256,
    }), /verification_incomplete:/)
    await assert.rejects(() => rpc(handler, 'fusion/confirm', { preview_id: preview.preview_id, confirmed: true }), /preview_expired:/)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('create validation failure restores catalog and removes dangling source', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const before = readFileSync(join(fx.root, 'runtime/adapters/dsh-container/sources.json'), 'utf8')
    const detail = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    write(join(fx.root, '.agents/skills/research-eval/scripts/validate_experiment.py'), 'import sys\nraise SystemExit("bad validator")\n')
    await assert.rejects(
      () => rpc(handler, 'create', {
        agent_id: 'test-agent',
        parent_ref: `git:${fx.commit}`,
        parent_experiment_id: 'EXP-test-agent-001',
        catalog_sha256: detail.declared.source_catalog_sha256,
        research_question: '验证校验失败时不会留下 dangling source',
      }),
      /command_failed:/,
    )
    assert.equal(readFileSync(join(fx.root, 'runtime/adapters/dsh-container/sources.json'), 'utf8'), before)
    const sources = JSON.parse(before).sources
    assert.deepEqual(Object.keys(sources), ['EXP-test-agent-001'])
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('create source_contract failure restores catalog and removes dangling source', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const sourcesPath = join(fx.root, 'runtime/adapters/dsh-container/sources.json')
    const badCatalog = JSON.parse(readFileSync(sourcesPath, 'utf8'))
    badCatalog.sources['EXP-test-agent-001'].preset = 'missing/preset.yml'
    write(sourcesPath, JSON.stringify(badCatalog, null, 2) + '\n')
    run(fx.root, 'git', ['add', 'runtime/adapters/dsh-container/sources.json'])
    run(fx.root, 'git', ['commit', '-m', 'bad preset catalog'])
    const badCommit = run(fx.root, 'git', ['rev-parse', 'HEAD'])

    const handler = createAgentsHandler(fx.root)
    const before = readFileSync(sourcesPath, 'utf8')
    const detail = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    await assert.rejects(
      () => rpc(handler, 'create', {
        agent_id: 'test-agent',
        parent_ref: `git:${badCommit}`,
        parent_experiment_id: 'EXP-test-agent-001',
        catalog_sha256: detail.declared.source_catalog_sha256,
        research_question: '验证 source_contract 失败时不会留下 dangling source',
      }),
      /command_failed:/,
    )
    assert.equal(readFileSync(sourcesPath, 'utf8'), before)
    assert.deepEqual(Object.keys(JSON.parse(before).sources), ['EXP-test-agent-001'])
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('create keeps files and returns needs_recovery when catalog changed after write', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const detail = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    write(join(fx.root, '.agents/skills/research-eval/scripts/validate_experiment.py'), [
      'import json',
      'from pathlib import Path',
      'path = Path("runtime/adapters/dsh-container/sources.json")',
      'data = json.loads(path.read_text(encoding="utf-8"))',
      'data["external_change"] = True',
      'path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")',
      'raise SystemExit("bad validator with external catalog change")',
      '',
    ].join('\n'))
    await assert.rejects(
      () => rpc(handler, 'create', {
        agent_id: 'test-agent',
        parent_ref: `git:${fx.commit}`,
        parent_experiment_id: 'EXP-test-agent-001',
        catalog_sha256: detail.declared.source_catalog_sha256,
        research_question: '验证外部 catalog 变化时保留恢复现场',
      }),
      /needs_recovery:/,
    )
    const catalog = JSON.parse(readFileSync(join(fx.root, 'runtime/adapters/dsh-container/sources.json'), 'utf8'))
    const createdId = Object.keys(catalog.sources).find(id => id !== 'EXP-test-agent-001')
    assert.ok(createdId)
    assert.equal(existsSync(join(fx.root, 'evolution/experiments', createdId)), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('create copies fixed git parent candidate, validates source and dry-runs dsh-eval', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const detail = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    const created = await rpc(handler, 'create', {
      agent_id: 'test-agent',
      parent_ref: `git:${fx.commit}`,
      parent_experiment_id: 'EXP-test-agent-001',
      catalog_sha256: detail.declared.source_catalog_sha256,
      research_question: '验证从当前版本派生新 Candidate 后仍能定位 DSH source',
    })
    assert.match(created.experiment_id, /^EXP-test-agent-002-r[0-9a-f]{12}$/)
    assert.equal(created.validation.valid, true)
    assert.deepEqual(created.dry_run.case_ids, ['U-CASE-001'])
    assert.equal(readFileSync(join(fx.root, `evolution/experiments/${created.experiment_id}/candidate/harness.yaml`), 'utf8'), 'name: test\n')
    assert.equal(existsSync(join(fx.root, `evolution/experiments/${created.experiment_id}/candidate/RuntimeHOME/session.txt`)), false)
    const sources = JSON.parse(readFileSync(join(fx.root, 'runtime/adapters/dsh-container/sources.json'), 'utf8'))
    assert.equal(sources.sources[created.experiment_id].candidate_root, `evolution/experiments/${created.experiment_id}/candidate/dsh`)
    assert.equal(readFileSync(join(fx.root, `evolution/experiments/${created.experiment_id}/change.yaml`), 'utf8').includes('parent_experiment_id: "EXP-test-agent-001"'), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('edit reads existing content, uses preview hash, rejects unsafe writes and preserves runs', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const read = await rpc(handler, 'edit/read', { experiment_id: 'EXP-test-agent-001', path: 'candidate/harness.yaml' })
    assert.equal(read.content, 'name: test\n')
    await assert.rejects(
      () => rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/harness.yaml', content: 'name: changed\n', expected_sha256: 'bad' }] }),
      /conflict:/,
    )
    const preview = await rpc(handler, 'edit/preview', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/harness.yaml', content: 'name: changed\n', expected_sha256: read.sha256 }] })
    assert.equal(preview.edits[0].before_sha256, read.sha256)
    await rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/harness.yaml', content: 'name: changed\n', expected_sha256: preview.edits[0].before_sha256 }] })
    assert.equal(readFileSync(join(fx.root, 'evolution/experiments/EXP-test-agent-001/candidate/harness.yaml'), 'utf8'), 'name: changed\n')
    await assert.rejects(
      () => rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'evolution/experiments/EXP-test-agent-001/runs/run-11111111-1111-4111-8111-111111111111/run.json', content: '{}', expected_sha256: 'bad' }] }),
      /path_rejected:/,
    )
    for (const path of ['candidate/cache/x', 'candidate/sessions/x', 'candidate/.git/config', 'candidate/nested/key.llm-api-key']) {
      await assert.rejects(
        () => rpc(handler, 'edit/read', { experiment_id: 'EXP-test-agent-001', path }),
        /path_rejected:/,
      )
    }
    const outside = join(fx.root, 'outside.txt')
    writeFileSync(outside, 'outside\n')
    symlinkSync(outside, join(fx.root, 'evolution/experiments/EXP-test-agent-001/candidate/link.txt'))
    await assert.rejects(
      () => rpc(handler, 'edit/preview', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/link.txt', content: 'nope\n' }] }),
      /path_rejected:/,
    )
    await assert.rejects(
      () => rpc(handler, 'edit/preview', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'decision.md', content: 'LOCAL_LLM_API_KEY=sk-secret' }] }),
      error => error instanceof Error && /secret_rejected:/.test(error.message) && !error.message.includes('sk-secret'),
    )
    const beforeRun = readFileSync(join(fx.root, 'evolution/experiments/EXP-test-agent-001/runs/run-11111111-1111-4111-8111-111111111111/run.json'), 'utf8')
    const evalPreview = await rpc(handler, 'edit/preview', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'evaluation.md', content: [
      '# Evaluation',
      '',
      '#### U-CASE-002 新',
      '**评估档位：** `fast`',
      '',
      '**用户输入**',
      '> pong',
      '',
      '**预期**',
      '返回 ping。',
      '',
    ].join('\n') }] })
    assert.equal(evalPreview.edits[0].changed, true)
    assert.equal(evalPreview.dry_run.mode, 'dry')
    assert.deepEqual(evalPreview.dry_run.case_ids, ['U-CASE-002'])
    assert.match(readFileSync(join(fx.root, 'agents/test-agent/evaluation.md'), 'utf8'), /U-CASE-001/)
    assert.equal(readFileSync(join(fx.root, 'evolution/experiments/EXP-test-agent-001/runs/run-11111111-1111-4111-8111-111111111111/run.json'), 'utf8'), beforeRun)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('资产树展示真实嵌套目录，二进制只读，排除运行目录、密钥和链接', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  const base = 'evolution/experiments/EXP-test-agent-001/candidate'
  try {
    write(join(fx.root, base, 'dsh/workspace/.dsh/skills/nested/SKILL.md'), '# Nested\n')
    write(join(fx.root, base, 'image.bin'), Buffer.from([0, 255, 1]))
    write(join(fx.root, base, 'large.txt'), 'x'.repeat(1024 * 1024 + 1))
    write(join(fx.root, base, 'nested/local.llm-api-key'), 'fixture-secret')
    symlinkSync(join(fx.root, 'agents'), join(fx.root, base, 'link'))
    const handler = createAgentsHandler(fx.root)
    const detail = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    assert.equal(detail.assets[0].kind, 'directory')
    const paths = JSON.stringify(detail.assets)
    assert.match(paths, /workspace\/\.dsh\/skills\/nested\/SKILL.md/)
    for (const excluded of ['RuntimeHOME', 'history', 'local.llm-api-key', `${base}/link`]) assert.equal(paths.includes(excluded), false)
    const dir = await rpc(handler, 'edit/read', { experiment_id: 'EXP-test-agent-001', path: base })
    assert.equal(dir.editable, false)
    for (const file of ['image.bin', 'large.txt']) {
      const read = await rpc(handler, 'edit/read', { experiment_id: 'EXP-test-agent-001', path: `${base}/${file}` })
      assert.equal(read.editable, false)
      assert.equal(read.content, undefined)
      await assert.rejects(() => rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: `${base}/${file}`, content: 'replacement', expected_sha256: 'bad' }] }), /只读/)
    }
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('直接保存也执行草稿 dry；格式或来源失败不写入，缺失环境仅提示，!!js 不执行', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const experiment_id = 'EXP-test-agent-001'
    const path = 'candidate/harness.yaml'
    const original = await rpc(handler, 'edit/read', { experiment_id, path })
    const apply = content => rpc(handler, 'edit/apply', { experiment_id, edits: [{ path, content, expected_sha256: original.sha256 }] })
    await assert.rejects(() => apply('name: [invalid\n'), /草稿格式无效/)
    const catalogPath = join(fx.root, 'runtime/adapters/dsh-container/sources.json')
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    catalog.sources[experiment_id].preset = 'missing/preset.yml'
    write(catalogPath, JSON.stringify(catalog))
    await assert.rejects(() => apply('name: valid\n'), /草稿 dry 校验失败/)
    assert.equal((await rpc(handler, 'edit/read', { experiment_id, path })).content, original.content)
    catalog.sources[experiment_id].preset = 'test-agent/preset.yml'
    catalog.sources[experiment_id].required_env_names = ['HARNESS_DRAFT_TEST_MISSING_ENV']
    write(catalogPath, JSON.stringify(catalog))
    const content = 'name: valid\nconfig: !!js |\n  (() => { throw new Error("must not execute") })()\n'
    const saved = await apply(content)
    assert.equal(saved.dry_run.mode, 'dry')
    assert.deepEqual(saved.dry_run.missing_env_names, ['HARNESS_DRAFT_TEST_MISSING_ENV'])
    assert.equal((await rpc(handler, 'edit/read', { experiment_id, path })).content, content)
    assert.equal(readFileSync(join(fx.root, 'evolution/experiments', experiment_id, 'runs/run-11111111-1111-4111-8111-111111111111/run.json'), 'utf8'), '{"status":"failed"}\n')
  } finally { await rm(fx.root, { recursive: true, force: true }) }
})

test('edit apply rejects traversal, duplicate paths and concurrent same-hash writes', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    await assert.rejects(() => rpc(handler, 'detail', { agent_id: '../../bad' }), /invalid_request:/)
    await assert.rejects(() => rpc(handler, 'cases/list', { agent_id: '../../bad' }), /invalid_request:/)
    await assert.rejects(() => rpc(handler, 'edit/read', { experiment_id: '../../bad', path: 'candidate/harness.yaml' }), /invalid_request:/)
    const read = await rpc(handler, 'edit/read', { experiment_id: 'EXP-test-agent-001', path: 'candidate/harness.yaml' })
    await assert.rejects(
      () => rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [
        { path: 'candidate/harness.yaml', content: 'a\n', expected_sha256: read.sha256 },
        { path: 'evolution/experiments/EXP-test-agent-001/candidate/harness.yaml', content: 'b\n', expected_sha256: read.sha256 },
      ] }),
      /重复路径/,
    )
    const first = rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/harness.yaml', content: 'name: one\n', expected_sha256: read.sha256 }] })
    const second = rpc(handler, 'edit/apply', { experiment_id: 'EXP-test-agent-001', edits: [{ path: 'candidate/harness.yaml', content: 'name: two\n', expected_sha256: read.sha256 }] })
    const results = await Promise.allSettled([first, second])
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
    assert.equal(results.filter(item => item.status === 'rejected' && /conflict:/.test(item.reason.message)).length, 1)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('eval preview, case list, run index and decision update use existing backend contracts', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    const handler = createAgentsHandler(fx.root)
    const cases = await rpc(handler, 'cases/list', { agent_id: 'test-agent' })
    assert.deepEqual(cases.cases.map(item => item.id), ['U-CASE-001'])
    const preview = await rpc(handler, 'eval/preview', { source: 'experiment:EXP-test-agent-001', mode: 'fast', executor: 'api', review: 'none', cases: ['U-CASE-001'] })
    assert.deepEqual(preview.result.case_ids, ['U-CASE-001'])
    const runs = await rpc(handler, 'runs/index', { agent_id: 'test-agent' })
    assert.equal(runs.agent_id, 'test-agent')
    const detail = await rpc(handler, 'detail', { agent_id: 'test-agent' })
    const saved = await rpc(handler, 'decision/update', { experiment_id: 'EXP-test-agent-001', content: '# Decision\n\n状态：inconclusive\n', expected_sha256: detail.decision.sha256 })
    assert.equal(saved.path, 'evolution/experiments/EXP-test-agent-001/decision.md')
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('eval job status parses redacted stdout result', async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  try {
    write(join(fx.root, 'runtime/adapters/dsh-container/dsh-eval'), 'import json\nprint(json.dumps({"status":"ok","token":"secret-value","api_key":"key-value"}))\n')
    const handler = createAgentsHandler(fx.root)
    const started = await rpc(handler, 'eval/start', { source: 'experiment:EXP-test-agent-001', mode: 'fast', executor: 'api', review: 'none' })
    const status = await waitForJob(handler, started.job_id)
    assert.equal(status.status, 'completed')
    assert.equal(status.result.token, '[REDACTED]')
    assert.equal(status.stdout.includes('secret-value'), false)
    assert.equal(status.result.api_key, '[REDACTED]')
    assert.equal(status.stdout.includes('key-value'), false)
    assert.match(status.log_note, /截断显示/)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

for (const legacy of [false, true]) test(`Run evidence reads ${legacy ? 'legacy selection with unknown contract' : 'frozen case'}, redacts and never rewrites records`, async () => {
  const { createAgentsHandler } = await loadServer()
  const fx = fixture()
  const runId = 'run-11111111-1111-4111-8111-111111111111'
  const base = join(fx.root, 'evolution/experiments/EXP-test-agent-001/runs', runId)
  try {
    write(join(base, 'run.yaml'), 'run_id: ' + runId + '\nexperiment_id: EXP-test-agent-001\nagent_id: test-agent\nstatus: completed\nevaluation_ref: agents/test-agent/evaluation.md\n')
    const inputs = JSON.stringify(legacy
      ? { evaluation_selection: { case_ids: ['U-CASE-001'] } }
      : { evaluation_cases: [{ case_id: 'U-CASE-001', inputs: ['ping'] }] })
    write(join(base, 'inputs.lock.json'), inputs)
    write(join(base, 'summary.json'), '{"status":"completed"}')
    const trace = JSON.stringify({ event: { type: 'session/created', createdAt: 1, data: { token: 'fixture-secret-value' } } }) + '\n'
    write(join(base, 'evidence/U-CASE-001/trace.jsonl'), trace)
    const handler = createAgentsHandler(fx.root)
    const shown = await rpc(handler, 'runs/show', { run_id: runId })
    assert.equal(shown.cases[0].case_id, 'U-CASE-001')
    if (legacy) {
      assert.equal(shown.cases[0].frozen, null)
      assert.equal(shown.cases[0].contract_changed, null)
      assert.ok(shown.missing.some(item => item.includes('未冻结 Case 定义')))
    } else assert.equal(shown.cases[0].frozen.inputs[0], 'ping')
    const payload = { run_id: runId, case_id: 'U-CASE-001', filename: 'trace.jsonl' }
    const evidence = await rpc(handler, 'runs/evidence', payload)
    assert.equal(evidence.truncated, false)
    assert.match(evidence.content, /session\/created/)
    assert.match(evidence.content, /REDACTED/)
    assert.equal(evidence.content.includes('fixture-secret-value'), false)
    assert.equal(readFileSync(join(base, 'inputs.lock.json'), 'utf8'), inputs)
    assert.equal(readFileSync(join(base, 'evidence/U-CASE-001/trace.jsonl'), 'utf8'), trace)
    await assert.rejects(() => rpc(handler, 'runs/evidence', { ...payload, filename: '../../inputs.lock.json' }), /not_found:/)
    await assert.rejects(() => rpc(handler, 'runs/evidence', { ...payload, filename: 'tools.jsonl' }), /not_found:/)
    write(join(base, 'evidence/U-CASE-001/tools.jsonl'), JSON.stringify({ event: { type: 'session/created' }, long: 'a'.repeat(70 * 1024) }) + '\n')
    const bounded = await rpc(handler, 'runs/evidence', { ...payload, filename: 'tools.jsonl' })
    assert.equal(bounded.truncated, true)
    assert.ok(Buffer.byteLength(bounded.content) <= 64 * 1024)
    write(join(base, 'evidence/U-CASE-001/tools.jsonl'), JSON.stringify({ token: 'truncated-fixture-secret'.repeat(4000) }) + '\n')
    const partialSecret = await rpc(handler, 'runs/evidence', { ...payload, filename: 'tools.jsonl' })
    assert.equal(partialSecret.truncated, true)
    assert.match(partialSecret.content, /REDACTED/)
    assert.equal(partialSecret.content.includes('truncated-fixture-secret'), false)
    const outside = join(fx.root, 'outside.json')
    write(outside, '{"token":"outside-secret"}')
    symlinkSync(outside, join(base, 'evidence/U-CASE-001/judge.json'))
    await assert.rejects(() => rpc(handler, 'runs/evidence', { ...payload, filename: 'judge.json' }), /path_rejected:/)
    await assert.rejects(() => rpc(handler, 'runs/show', { run_id: runId }), /path_rejected:/)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('Run 读取不阻塞服务，取消和失败返回明确错误', async t => {
  const { root } = fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const { createAgentsHandler } = await loadServer()
  write(join(root, 'runtime/adapters/dsh-container/run_record.py'), 'import time, json\ntime.sleep(0.25)\nprint(json.dumps({"experiments": []}))\n')
  const handler = createAgentsHandler(root)
  let settled = false
  const pending = handler('runs/index', { agent_id: 'test-agent' }, new AbortController().signal).then(result => { settled = true; return result })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(settled, false, 'Python 子进程不应阻塞 Node 事件循环')
  assert.equal((await pending).ok, true)
  const abort = new AbortController()
  const cancelled = handler('runs/index', { agent_id: 'test-agent' }, abort.signal)
  abort.abort()
  assert.equal((await cancelled).ok, false)
  write(join(root, 'runtime/adapters/dsh-container/run_record.py'), 'import sys\nprint("broken run", file=sys.stderr)\nsys.exit(1)\n')
  const failed = await handler('runs/index', { agent_id: 'test-agent' }, new AbortController().signal)
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'run_read_failed')
  assert.match(failed.error.details.reason, /broken run/)
})

test('智能体详情解析不阻塞服务，YAML 顶层校验保留', async t => {
  const { root } = fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const { createAgentsHandler } = await loadServer()
  write(join(root, 'runtime/adapters/dsh-container/source_contract.py'), 'import time, json\ntime.sleep(0.25)\nprint(json.dumps({"status":"fixture"}))\n')
  const handler = createAgentsHandler(root)
  let settled = false
  const pending = handler('detail', { agent_id: 'test-agent' }, new AbortController().signal).then(result => { settled = true; return result })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(settled, false, '合同解析期间应允许其他请求响应')
  assert.equal((await pending).ok, true)
  const manifest = join(root, 'agents/test-agent/manifest.yaml')
  const originalManifest = readFileSync(manifest, 'utf8')
  write(manifest, '- invalid-top-level\n')
  const invalid = await handler('list', {}, new AbortController().signal)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'asset_read_failed')
  write(manifest, originalManifest)
  await rm(join(root, 'evolution/experiments/EXP-test-agent-001/change.yaml'))
  const missing = await handler('detail', { agent_id: 'test-agent' }, new AbortController().signal)
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'asset_read_failed')
})

test('用例按选中区块保存，多轮与档位回读一致，冲突和无效内容不改源文件', async t => {
  const { createAgentsHandler } = await loadServer()
  const { root } = fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'agents/test-agent/evaluation.md')
  const first = readFileSync(file, 'utf8')
  const following = '\n## 第二场景\n\n#### U-CASE-002 保留原文\n\n**用户输入**\n\n> untouched\n\n**预期**\n\n原样保留。\n'
  write(file, first + following)
  const handler = createAgentsHandler(root)
  const base = { experiment_id: 'EXP-test-agent-001', case_id: 'U-CASE-001' }
  const before = await rpc(handler, 'cases/read', base)
  assert.deepEqual(before.case.inputs, ['ping'])
  const update = { ...base, title: '多轮保存', inputs: ['first\n\ncontinued', 'second'], expected_behavior: '返回两轮的真实结果。', fast: false, expected_sha256: before.sha256 }
  const saved = await rpc(handler, 'cases/update', update)
  assert.deepEqual(saved.case.inputs, update.inputs)
  assert.equal(saved.case.title, update.title)
  assert.equal(saved.case.expected_behavior, update.expected_behavior)
  assert.equal(saved.case.tier, 'full')
  assert.equal(saved.case.scene, '基础')
  const current = readFileSync(file, 'utf8')
  assert.ok(current.endsWith(following))
  assert.ok(current.startsWith('# Evaluation\n\n## 基础\n\n'))
  await assert.rejects(() => rpc(handler, 'cases/update', update), /conflict:/)
  await assert.rejects(() => rpc(handler, 'cases/update', { ...update, expected_sha256: saved.sha256, expected_behavior: '预期\n\n#### U-CASE-003 注入新用例\n\n**用户输入**\n> unexpected\n\n**预期**\nno' }), /invalid_request:/)
  assert.equal(readFileSync(file, 'utf8'), current)
  assert.deepEqual((await rpc(handler, 'cases/list', { agent_id: 'test-agent' })).cases.map(row => row.id), ['U-CASE-001', 'U-CASE-002'])
})

test('用例解析与摘要来自同一次读取，解析期间的外部修改不会混入口径', async t => {
  const { createAgentsHandler } = await loadServer()
  const { root } = fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'agents/test-agent/evaluation.md')
  const parser = join(root, '.agents/skills/research-eval/scripts/evaluation_contract.py')
  write(parser, 'import time\ntime.sleep(0.25)\n' + readFileSync(parser, 'utf8').replace('from __future__ import annotations\n', ''))
  const handler = createAgentsHandler(root)
  const pending = rpc(handler, 'cases/read', { experiment_id: 'EXP-test-agent-001', case_id: 'U-CASE-001' })
  await new Promise(resolve => setTimeout(resolve, 40))
  write(file, readFileSync(file, 'utf8').replace('> ping', '> changed'))
  const read = await pending
  assert.deepEqual(read.case.inputs, ['ping'])
  assert.notEqual(read.sha256, (await rpc(handler, 'cases/read', { experiment_id: 'EXP-test-agent-001', case_id: 'U-CASE-001' })).sha256)
})

test('用例保存保留预期中的普通四级小节，其他 Case 原文不变', async t => {
  const { createAgentsHandler } = await loadServer()
  const { root } = fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'agents/test-agent/evaluation.md')
  const following = '\n#### U-CASE-002 原样保留\n\n**用户输入**\n\n> second\n\n**预期**\n\n不变。\n'
  write(file, readFileSync(file, 'utf8') + '\n#### 判定细节\n\n旧的详细标准。\n' + following)
  const handler = createAgentsHandler(root)
  const base = { experiment_id: 'EXP-test-agent-001', case_id: 'U-CASE-001' }
  const before = await rpc(handler, 'cases/read', base)
  assert.match(before.case.expected_behavior, /#### 判定细节/)
  const expectedBehavior = '返回新的结果。\n\n#### 判定细节\n\n新的详细标准。'
  const saved = await rpc(handler, 'cases/update', { ...base, title: before.case.title, inputs: before.case.inputs, expected_behavior: expectedBehavior, fast: true, expected_sha256: before.sha256 })
  assert.equal(saved.case.expected_behavior, expectedBehavior)
  const current = readFileSync(file, 'utf8')
  assert.equal((current.match(/#### 判定细节/g) ?? []).length, 1)
  assert.equal(current.includes('旧的详细标准'), false)
  assert.ok(current.endsWith(following))
})

test('运行中 Job 即时返回 stderr 跨数据块输出的 Run ID', async t => {
  const { createAgentsHandler } = await loadServer()
  const { root } = fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const runId = 'run-11111111-1111-4111-8111-111111111111'
  write(join(root, 'runtime/adapters/dsh-container/dsh-eval'), [
    'import sys,time,json',
    'sys.stderr.write("Research Run: run-11111111-1111-");sys.stderr.flush()',
    'time.sleep(0.08)',
    'sys.stderr.write("4111-8111-111111111111\\n");sys.stderr.flush()',
    'time.sleep(0.25)',
    `print(json.dumps({"run_id":"${runId}"}))`,
    '',
  ].join('\n'))
  const handler = createAgentsHandler(root)
  const started = await rpc(handler, 'eval/start', { source: 'experiment:EXP-test-agent-001', mode: 'fast', executor: 'api', review: 'none' })
  let observed
  for (let attempt = 0; attempt < 30; attempt++) {
    observed = await rpc(handler, 'eval/status', { job_id: started.job_id })
    if (observed.run_id) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(observed.run_id, runId)
  assert.equal(observed.status, 'running')
  assert.equal((await waitForJob(handler, started.job_id)).result.run_id, runId)
})
