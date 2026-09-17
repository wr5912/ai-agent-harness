import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { openSync, closeSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
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
const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const fields = line.split(' ')
    return { target: decodeMountPath(fields[4]), options: fields[5].split(',') }
  })

assert.ok(mounts.some(item => item.target === '/var/lib/dsh' && item.options.includes('rw')))
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
  controlled_patch_sha256: createHash('sha256').update(first).digest('hex'),
  note: 'Docker mount semantics only; no DSH Profile or Plugin activation was tested.',
}))
