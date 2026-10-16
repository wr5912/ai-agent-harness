import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { defaultAssetRoot, instanceStateRoot, workspaceIdentity, workspaceOwnsInstance } from '../src/workspace.ts'

test('平台与CLI的实例状态覆盖均展开HOME并相对于显式数据根解析', t => {
  const temporary = mkdtempSync(join(tmpdir(), 'workspace path contract '))
  const root = join(temporary, 'user data'), home = join(temporary, 'home'), cwd = join(temporary, 'program cwd')
  for (const directory of [root, home, cwd]) mkdirSync(directory)
  const previous = Object.fromEntries(['HOME', 'HARNESS_INSTANCE_STATE_ROOT', 'XDG_STATE_HOME'].map(key => [key, process.env[key]]))
  const previousCwd = process.cwd()
  t.after(() => {
    process.chdir(previousCwd)
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(temporary, { recursive: true, force: true })
  })
  process.env.HOME = home
  process.chdir(cwd)
  const adapter = fileURLToPath(new URL('../../../runtime/adapters/dsh-container/', import.meta.url))
  const python = 'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from workspace_paths import instances_root; print(instances_root(Path(sys.argv[2])))'
  const cases = [
    [{}, join(root, '.local/instances')],
    [{ HARNESS_INSTANCE_STATE_ROOT: '~' }, home],
    [{ HARNESS_INSTANCE_STATE_ROOT: '~/private instances' }, join(home, 'private instances')],
    [{ HARNESS_INSTANCE_STATE_ROOT: 'state/instances' }, join(root, 'state/instances')],
    [{ HARNESS_INSTANCE_STATE_ROOT: join(temporary, 'absolute') }, join(temporary, 'absolute')],
    [{ XDG_STATE_HOME: '~/state' }, join(home, 'state/dsh-dev')],
    [{ XDG_STATE_HOME: 'local-state' }, join(root, 'local-state/dsh-dev')],
    [{ HARNESS_INSTANCE_STATE_ROOT: 'specific', XDG_STATE_HOME: '~/unused' }, join(root, 'specific')],
  ]
  for (const [environment, expected] of cases) {
    delete process.env.HARNESS_INSTANCE_STATE_ROOT
    delete process.env.XDG_STATE_HOME
    Object.assign(process.env, environment)
    assert.equal(instanceStateRoot(root), expected)
    const fromCli = execFileSync(process.env.HARNESS_PYTHON || 'python3', ['-c', python, adapter, root], { cwd: dirname(cwd), env: process.env, encoding: 'utf8' }).trim()
    assert.equal(fromCli, expected)
  }
  process.env.HARNESS_INSTANCE_STATE_ROOT = '~another-user/state'
  assert.throws(() => instanceStateRoot(root), /仅支持当前用户/)
  assert.throws(() => execFileSync(process.env.HARNESS_PYTHON || 'python3', ['-c', python, adapter, root], { encoding: 'utf8', stdio: 'pipe' }), /仅支持当前用户/)
})

test('通用平台与CLI共读唯一部署定位文件，显式环境变量优先', t => {
  const home = mkdtempSync(join(tmpdir(), 'workspace locator '))
  const before = { HOME: process.env.HOME, HARNESS_ASSET_ROOT: process.env.HARNESS_ASSET_ROOT }
  t.after(() => {
    for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(home, { recursive: true, force: true })
  })
  process.env.HOME = home
  delete process.env.HARNESS_ASSET_ROOT
  assert.equal(defaultAssetRoot(), join(home, 'harness-engineering-platform-data'))
  const directory = join(home, '.config/harness-engineering-platform')
  mkdirSync(directory, { recursive: true })
  const selected = join(home, 'selected data')
  writeFileSync(join(directory, 'workspace.json'), JSON.stringify({ assetRoot: selected }))
  const adapter = fileURLToPath(new URL('../../../runtime/adapters/dsh-container/', import.meta.url))
  const python = 'import sys; sys.path.insert(0,sys.argv[1]); from workspace_paths import asset_root; print(asset_root())'
  for (const value of [selected, join(home, 'explicit data')]) {
    if (value !== selected) process.env.HARNESS_ASSET_ROOT = value
    assert.equal(defaultAssetRoot(), value)
    assert.equal(execFileSync(process.env.HARNESS_PYTHON || 'python3', ['-c', python, adapter], { env: process.env, encoding: 'utf8' }).trim(), value)
  }
})

test('平台与 CLI 在共享实例状态中仅接纳匹配身份或可确认的旧 Candidate 挂载', t => {
  const root = mkdtempSync(join(tmpdir(), 'instance ownership '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const oldRoot = join(root, 'old program'), other = join(root, 'other workspace')
  writeFileSync(join(root, 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'workspace-current', legacyRoots: [oldRoot] }))
  const source = 'experiment:EXP-example-001-r0123456789ab'
  const mount = base => ({ source_id: source, mounts: { workspace: join(base, 'evolution/experiments', source.slice(11), 'candidate/dsh/workspace') } })
  const cases = [
    [{ workspace_id: 'workspace-current', asset_root: root }, true],
    [{ workspace_id: 'workspace-current', asset_root: oldRoot }, true],
    [{ workspace_id: 'workspace-other', asset_root: root }, false],
    [{ workspace_id: 'workspace-current', asset_root: other }, false],
    [{ asset_root: root }, true], [{ asset_root: other }, false],
    [{ workspace_id: 'workspace-current' }, false],
    [{ ...mount(root), workspace_id: 'workspace-current' }, true],
    [{ ...mount(other), workspace_id: 'workspace-current' }, false],
    [mount(root), true], [mount(oldRoot), true], [mount(other), false],
    [{ ...mount(oldRoot), source_id: 'experiment:EXP-other-001' }, false],
    [{ ...mount(oldRoot), mounts: { ...mount(oldRoot).mounts, managed: join(other, 'managed') } }, false],
    [{ source_id: source }, false],
  ]
  const adapter = fileURLToPath(new URL('../../../runtime/adapters/dsh-container/', import.meta.url))
  const python = 'import json,sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from workspace_paths import instance_belongs_to_workspace; print(json.dumps([instance_belongs_to_workspace(Path(sys.argv[2]),v) for v in json.loads(sys.argv[3])]))'
  const actual = JSON.parse(execFileSync(process.env.HARNESS_PYTHON || 'python3', ['-c', python, adapter, root, JSON.stringify(cases.map(([value]) => value))], { encoding: 'utf8' }))
  assert.deepEqual(actual, cases.map(([, expected]) => expected))
  for (const [value, expected] of cases) assert.equal(workspaceOwnsInstance(root, value), expected)
})

test('Python 与平台同样拒绝无效工作区身份和相对迁移别名', t => {
  const root = mkdtempSync(join(tmpdir(), 'invalid workspace '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const adapter = fileURLToPath(new URL('../../../runtime/adapters/dsh-container/', import.meta.url))
  const python = 'import sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); from workspace_paths import workspace_id; print(workspace_id(Path(sys.argv[2])))'
  for (const value of [{ schemaVersion: true, id: 'workspace-fixture' }, { schemaVersion: 1, id: 'arbitrary-id' }, { schemaVersion: 1, id: 'workspace-fixture', legacyRoots: ['relative/path'] }]) {
    writeFileSync(join(root, 'workspace.json'), JSON.stringify(value))
    assert.throws(() => workspaceIdentity(root), /工作区描述无效/)
    assert.throws(() => execFileSync(process.env.HARNESS_PYTHON || 'python3', ['-c', python, adapter, root], { stdio: 'pipe' }), /workspace.json/)
  }
})
