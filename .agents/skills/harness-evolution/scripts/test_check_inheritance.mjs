import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const checker = fileURLToPath(new URL('./check_inheritance.mts', import.meta.url))

test('固定 Git 来源的缺失文件失败，同路径修改需要审查', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-inheritance-'))
  const source = 'EXP-example-agent-001'
  const target = 'EXP-example-agent-002'
  const sourceDir = join(root, 'evolution', 'experiments', source, 'candidate')
  const targetDir = join(root, 'evolution', 'experiments', target, 'candidate')
  try {
    mkdirSync(sourceDir, { recursive: true })
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(sourceDir, 'a.txt'), 'old')
    writeFileSync(join(sourceDir, 'b.txt'), 'keep')
    writeFileSync(join(targetDir, 'a.txt'), 'new')
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['add', sourceDir], { cwd: root })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'source'], { cwd: root })
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const run = () => spawnSync(process.execPath, ['--experimental-strip-types', checker, source, commit, target], { cwd: root, encoding: 'utf8' })
    const missing = run()
    assert.equal(missing.status, 1, missing.stderr)
    assert.match(missing.stdout, /缺失 b\.txt/)
    assert.match(missing.stdout, /需审查 a\.txt/)
    writeFileSync(join(targetDir, 'b.txt'), 'keep')
    const complete = run()
    assert.equal(complete.status, 0, complete.stderr)
    assert.match(complete.stdout, /缺失 0；内容变化 1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
