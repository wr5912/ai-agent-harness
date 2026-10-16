import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const program = fileURLToPath(new URL('../../../', import.meta.url))
process.env.HARNESS_PROGRAM_ROOT = program
const built = mkdtempSync(join(tmpdir(), 'independent-workspace-build-'))
const entry = join(built, 'agents.mjs')
await build({ entryPoints: [join(program, 'platform/plugin/src/agents/index.ts')], outfile: entry, bundle: true, platform: 'node', format: 'esm' })
const { createAgentsHandler } = await import(pathToFileURL(entry).href)
after(() => rmSync(built, { recursive: true, force: true }))

function value(response) { assert.equal(response.ok, true, JSON.stringify(response)); return response.value }

test('数据根含空格且工作目录任意时，新建、读改回读与草稿验证不需要数据根内有程序副本', async t => {
  const root = mkdtempSync(join(tmpdir(), 'independent user workspace '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of ['agents', 'evolution/experiments', 'config']) mkdirSync(join(root, path), { recursive: true })
  writeFileSync(join(root, 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'workspace-isolated', legacyRoots: [] }))
  writeFileSync(join(root, 'config/sources.json'), JSON.stringify({ schema_version: '1.1', sources: {} }))
  const handler = createAgentsHandler(root), signal = new AbortController().signal
  const invoke = async (endpoint, input) => value(await handler(endpoint, input, signal))
  const previousCwd = process.cwd()
  try {
    process.chdir(tmpdir())
    const created = await invoke('new', { agent_id: 'basic-reader', name: '基本数据助手', description: '读取基本模拟数据。', role: '只读取已提供的基本模拟数据。' })
    const id = created.experiment_id
    const detail = await invoke('detail', { agent_id: 'basic-reader', experiment_id: id })
    assert.equal(detail.agent.id, 'basic-reader')
    assert.equal(detail.declared.catalog_source.agent_id, 'basic-reader')
    const path = 'candidate/dsh/workspace/AGENTS.md'
    const before = await invoke('edit/read', { experiment_id: id, path })
    const content = before.content + '\n使用明确的对象 ID 查询。\n'
    const edits = [{ path, content, expected_sha256: before.sha256 }]
    const preview = await invoke('edit/preview', { experiment_id: id, edits })
    assert.equal(preview.dry_run.mode, 'dry')
    assert.equal(readFileSync(join(root, before.path), 'utf8'), before.content)
    await invoke('edit/apply', { experiment_id: id, edits })
    const saved = await invoke('edit/read', { experiment_id: id, path })
    assert.equal(saved.content, content)
    assert.notEqual(saved.sha256, before.sha256)
    assert.equal(existsSync(join(root, 'runtime')), false)
    assert.equal(existsSync(join(root, 'platform')), false)
    assert.equal(existsSync(join(root, '.agents')), false)
    assert.equal(Object.keys(JSON.parse(readFileSync(join(root, 'config/sources.json'), 'utf8')).sources).length, 1)
  } finally { process.chdir(previousCwd) }
})
