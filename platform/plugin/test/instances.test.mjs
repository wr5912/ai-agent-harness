import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

async function loadModule() {
  const temp = mkdtempSync(join(tmpdir(), 'harness-platform-instances-build-'))
  const outfile = join(temp, 'instances.mjs')
  await build({
    entryPoints: ['src/instances/index.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  })
  const module = await import(`file://${outfile}?${Date.now()}`)
  return { module, cleanup: () => rmSync(temp, { recursive: true, force: true }) }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-platform-instances-'))
  const state = join(root, 'state')
  const adapter = join(root, 'runtime/adapters/dsh-container')
  mkdirSync(adapter, { recursive: true })
  mkdirSync(join(state, 'dsh-dev/running-one'), { recursive: true })
  mkdirSync(join(state, 'dsh-dev/unknown-one'), { recursive: true })
  mkdirSync(join(root, 'evolution/experiments/EXP-real-001/runs/run-00000000-0000-4000-8000-000000000000'), { recursive: true })
  writeFileSync(join(adapter, 'sources.json'), JSON.stringify({
    schema_version: '1.1',
    sources: { 'EXP-real-001': { agent_id: 'real-agent' } },
  }))
  writeFileSync(join(state, 'dsh-dev/running-one/instance.json'), JSON.stringify({
    name: 'running-one',
    source_id: 'experiment:EXP-real-001',
    image_tag: 'dsh:locked',
    port: 3181,
  }))
  writeFileSync(join(state, 'dsh-dev/unknown-one/instance.json'), JSON.stringify({
    name: 'unknown-one',
    source_id: 'experiment:EXP-real-001',
    image_tag: 'dsh:locked',
    port: 3182,
  }))
  writeFileSync(join(adapter, 'dsh-dev'), `#!/usr/bin/env node
const args = process.argv.slice(2)
const out = value => process.stdout.write(JSON.stringify(value, null, 2) + '\\n')
if (args[0] === 'ps') {
  out({schema_version:'1.0', instances:[
    {name:'running-one', state:'running', source_id:'experiment:EXP-real-001', source_kind:'experiment', image_tag:'dsh:locked', agent_id:'real-agent', port:3181, home_volume:'home-running', home_preserved:true, container_name:'running-one', observed_at:'2026-10-13T00:00:00.000Z', mounts:{workspace:'/x'}, mount_modes:{workspace:'ro'}},
    {name:'unknown-one', state:'unknown', source_id:'experiment:EXP-real-001', image_tag:'dsh:locked', agent_id:'real-agent', port:3182, home_volume:null, home_preserved:null, container_name:'unknown-one', observed_at:'2026-10-13T00:00:00.000Z'}
  ]})
} else if (args[0] === 'up') {
  const dry = args.includes('--dry-run')
  const name = args[args.indexOf('--name') + 1]
  const source = args[args.indexOf('--source') + 1]
  if (dry) out({name, source_id:source, image_tag:'dsh:locked', port:3199, mounts:[{container:'/work/harness/workspace', mode:'ro'}], state_dir:'state'})
  else process.stdout.write(JSON.stringify({warning:'first'}) + '\\n' + JSON.stringify({name, dsh_running:true, token:'receipt-secret'}) + '\\n')
} else if (args[0] === 'down') {
  const name = args[1]
  if (name === 'fail-one') { process.stderr.write('stop failed token=secret-token\\n'); process.exit(1) }
  out({name, stopped:true, home_preserved:true})
} else if (args[0] === 'delete') {
  out({name:args[1], deleted:true, home_preserved:true})
} else if (args[0] === 'logs') {
  process.stdout.write('hello token=secret-token Authorization: Bearer bearer-secret {"password":"json-secret"} API_KEY=abc123\\n')
} else {
  process.stderr.write('unknown command ' + args.join(' '))
  process.exit(2)
}
`)
  chmodSync(join(adapter, 'dsh-dev'), 0o755)
  return { root, state, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('instances list keeps real observed state and detail run/session links', async () => {
  const { module, cleanup: cleanupModule } = await loadModule()
  const fx = fixture()
  const previous = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = fx.state
  try {
    const handler = module.createInstancesHandler(fx.root)
    const listed = await handler('list', {}, new AbortController().signal)
    assert.equal(listed.ok, true)
    assert.equal(listed.value.instances[0].state, 'running')
    assert.equal(listed.value.instances[1].state, 'unknown')
    assert.equal(listed.value.instances[0].home_volume, 'home-running')
    const detail = await handler('detail', { name: 'running-one' }, new AbortController().signal)
    assert.equal(detail.ok, true)
    assert.equal(detail.value.runs.length, 1)
    assert.equal(detail.value.session_scope.note.includes('不读取会话内容'), true)
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous
    fx.cleanup()
    cleanupModule()
  }
})

test('preview uses real sources and rejects invented sources', async () => {
  const { module, cleanup: cleanupModule } = await loadModule()
  const fx = fixture()
  try {
    const handler = module.createInstancesHandler(fx.root)
    const bad = await handler('preview', {
      operation: 'create',
      name: 'stage1-new',
      source: 'experiment:EXP-missing-001',
    }, new AbortController().signal)
    assert.equal(bad.ok, false)
    const good = await handler('preview', {
      operation: 'create',
      name: 'stage1-new',
      source: 'experiment:EXP-real-001',
    }, new AbortController().signal)
    assert.equal(good.ok, true)
    assert.equal(good.value.plan.source_id, 'experiment:EXP-real-001')
    assert.equal(good.value.retention.home, '保留')
  } finally {
    fx.cleanup()
    cleanupModule()
  }
})

test('run parses two stdout JSON objects and redacts bounded logs', async () => {
  const { module, cleanup: cleanupModule } = await loadModule()
  const fx = fixture()
  try {
    const handler = module.createInstancesHandler(fx.root)
    const receipt = await handler('run', {
      operation: 'create',
      name: 'stage1-new',
      source: 'experiment:EXP-real-001',
      allow_missing_env: true,
    }, new AbortController().signal)
    assert.equal(receipt.ok, true)
    assert.equal(receipt.value.ok, true)
    assert.equal(receipt.value.value.json_objects.length, 2)
    assert.deepEqual(receipt.value.value.value, { name: 'stage1-new', dsh_running: true, token: '<redacted>' })
    assert.equal(JSON.stringify(receipt).includes('receipt-secret'), false)
    const logs = await handler('logs', { name: 'running-one', tail: 5 }, new AbortController().signal)
    assert.equal(logs.ok, true)
    assert.equal(logs.value.logs.includes('secret-token'), false)
    assert.equal(logs.value.logs.includes('bearer-secret'), false)
    assert.equal(logs.value.logs.includes('json-secret'), false)
    assert.equal(logs.value.logs.includes('abc123'), false)
  } finally {
    fx.cleanup()
    cleanupModule()
  }
})

test('request boundary rejects invalid port, source and booleans', async () => {
  const { module, cleanup: cleanupModule } = await loadModule()
  const fx = fixture()
  try {
    const handler = module.createInstancesHandler(fx.root)
    for (const payload of [
      { operation: 'create', name: 'stage1-new', source: 'experiment:EXP-real-001', port: 65536 },
      { operation: 'create', name: 'stage1-new', source: 7 },
      { operation: 'create', name: 'stage1-new', source: 'experiment:EXP-real-001', allow_missing_env: 'yes' },
    ]) {
      const result = await handler('preview', payload, new AbortController().signal)
      assert.equal(result.ok, false)
    }
    const logs = await handler('logs', { name: 'running-one', tail: 0 }, new AbortController().signal)
    assert.equal(logs.ok, false)
  } finally {
    fx.cleanup()
    cleanupModule()
  }
})

test('batch returns per-item partial success and unknown mutation fails closed', async () => {
  const { module, cleanup: cleanupModule } = await loadModule()
  const fx = fixture()
  const previous = process.env.XDG_STATE_HOME
  process.env.XDG_STATE_HOME = fx.state
  try {
    const handler = module.createInstancesHandler(fx.root)
    const unknown = await handler('run', {
      operation: 'stop',
      name: 'unknown-one',
    }, new AbortController().signal)
    assert.equal(unknown.ok, true)
    assert.equal(unknown.value.ok, false)
    assert.match(unknown.value.error.message, /状态未知/)
    const preview = await handler('batch-preview', {
      items: [
        { operation: 'stop', name: 'running-one' },
        { operation: 'stop', name: 'missing-one' },
      ],
    }, new AbortController().signal)
    assert.equal(preview.ok, true)
    assert.equal(preview.value.partial_success, true)
    assert.deepEqual(preview.value.previews.map(item => item.ok), [true, false])
    const batch = await handler('batch', {
      items: [
        { operation: 'stop', name: 'running-one' },
        { operation: 'stop', name: 'fail-one' },
      ],
    }, new AbortController().signal)
    assert.equal(batch.ok, true)
    assert.equal(batch.value.ok, false)
    assert.equal(batch.value.partial_success, true)
    assert.deepEqual(batch.value.receipts.map(item => item.ok), [true, false])
  } finally {
    if (previous === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previous
    fx.cleanup()
    cleanupModule()
  }
})

test('json object parser handles adjacent command reports', async () => {
  const { module, cleanup } = await loadModule()
  try {
    assert.deepEqual(module.parseJsonObjects('x {"a":1}\\n{"b":[2]} tail'), [{ a: 1 }, { b: [2] }])
  } finally {
    cleanup()
  }
})
