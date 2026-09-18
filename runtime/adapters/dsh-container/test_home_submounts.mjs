import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { decodeMountPath } from './tree-digest.mjs'

const paths = [
  '/var/lib/dsh/cordis.patch.yml',
  '/var/lib/dsh/profiles/web/cordis.patch.yml',
  '/var/lib/dsh/profiles/web/package.json',
  '/var/lib/dsh/AGENTS.md',
  '/var/lib/dsh/.env',
  '/work/harness/workspace/.env',
]
const modulePaths = [
  '/var/lib/dsh/node_modules',
  '/var/lib/dsh/profiles/node_modules',
  '/var/lib/dsh/profiles/web/node_modules',
  '/var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules',
]
// 判分材料（需求/任务/验收阈值、评估方法、测试预置、预期答案）只出现在开发会话里。
const gradingPaths = process.env.DSH_HARNESS_MODE === 'authoring'
  ? ['/work/spec', '/work/eval-reference']
  : []
const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const fields = line.split(' ')
    return { target: decodeMountPath(fields[4]), options: fields[5].split(',') }
  })

assert.ok(mounts.some(item => item.target === '/var/lib/dsh' && item.options.includes('rw')))
// 适配层脚本以只读 bind 提供，脚本改动不需要重建镜像；这里核对只读且不可写。
assert.ok(mounts.some(item => item.target === '/opt/dsh-adapter' && item.options.includes('ro')),
  '/opt/dsh-adapter must be an exact read-only bind mount')
for (const name of ['verify-load.mjs', 'tree-digest.mjs', 'prepare-verification-home.mjs']) {
  assert.ok(existsSync(`/opt/dsh-adapter/${name}`), `${name} must be provided by the adapter mount`)
}
assert.throws(() => writeFileSync('/opt/dsh-adapter/.probe', 'forbidden'),
  error => error.code === 'EROFS' || error.code === 'EACCES')
for (const path of paths) {
  assert.ok(mounts.some(item => item.target === path && item.options.includes('ro')))
  assert.throws(() => {
    const descriptor = openSync(path, 'r+')
    closeSync(descriptor)
  }, error => error.code === 'EROFS' || error.code === 'EACCES')
}
for (const path of modulePaths) {
  assert.ok(mounts.some(item => item.target === path && item.options.includes('ro')))
  assert.throws(() => writeFileSync(`${path}/shadow-package.js`, 'forbidden'),
    error => error.code === 'EROFS' || error.code === 'EACCES')
}
// 开发会话的判分材料必须只读且不可写入；评测模式必须完全没有这些挂载点。
for (const path of gradingPaths) {
  assert.ok(existsSync(path), `${path} must be mounted`)
  assert.ok(mounts.some(item => item.target === path && item.options.includes('ro')))
  assert.throws(() => writeFileSync(`${path}/.context-write-proof`, 'forbidden'),
    error => error.code === 'EROFS' || error.code === 'EACCES')
}
// 评测模式运行被测目标：答案、验收阈值与评估方法必须完全不在容器里，不能只靠只读挂载或业务 Guard。
if (process.env.DSH_HARNESS_MODE !== 'authoring') {
  for (const path of ['/work/spec', '/work/eval-reference', '/work/eval-input']) {
    assert.ok(!existsSync(path), `${path} must be absent in the subject container`)
    assert.ok(!mounts.some(item => item.target === path), `${path} must not be mounted in the subject container`)
  }
  assert.ok(!existsSync('/work/AGENTS.md'), 'the subject container must not carry the development session instructions')
  assert.ok(!mounts.some(item => item.target === '/work/AGENTS.md'))
} else {
  // 开发会话身份来自受控只读的 /work/AGENTS.md：模板不得内联业务身份，也不得可写。
  assert.ok(existsSync('/work/AGENTS.md'), '/work/AGENTS.md must be mounted in the development session')
  assert.ok(mounts.some(item => item.target === '/work/AGENTS.md' && item.options.includes('ro')))
  const instructions = readFileSync('/work/AGENTS.md', 'utf8')
  assert.match(instructions, /开发者/)
  assert.ok(!instructions.includes('security-operations-expert'))
  assert.throws(() => writeFileSync('/work/AGENTS.md', 'forbidden'),
    error => error.code === 'EROFS' || error.code === 'EACCES')
}

const first = readFileSync(paths[0])
const second = readFileSync(paths[1])
assert.deepEqual(first, second)
assert.match(first.toString('utf8'), /^\s*(?:#[^\n]*\n)*\[\]\s*$/)
const manifest = JSON.parse(readFileSync(paths[2], 'utf8'))
assert.deepEqual(manifest.dsh.profile.bundles, [
  '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
])
assert.equal(manifest.dsh.profile.patchReload, 'startup')
assert.equal(readFileSync('/var/lib/dsh/AGENTS.md').length, 0)
for (const path of ['/var/lib/dsh/.env', '/work/harness/workspace/.env']) {
  assert.match(readFileSync(path, 'utf8'), /^(?:\s*#[^\n]*\n)+\s*$/)
}
for (const path of modulePaths.filter(path => path !== '/var/lib/dsh/profiles/node_modules')) {
  assert.deepEqual(readdirSync(path), ['POLICY.md'])
}

const writableProbe = '/var/lib/dsh/.submount-rw-proof'
writeFileSync(writableProbe, 'runtime-data-volume-writable', { flag: 'wx' })
unlinkSync(writableProbe)

console.log(JSON.stringify({
  status: 'engine-subfile-bind-proof',
  home_mount: 'rw',
  controlled_file_mounts: paths.length,
  controlled_module_mounts: modulePaths.length,
  read_only_context_mounts: contextPaths.length,
  controlled_patch_sha256: createHash('sha256').update(first).digest('hex'),
  note: 'Docker mount semantics only; no DSH Profile or Plugin activation was tested.',
}))
