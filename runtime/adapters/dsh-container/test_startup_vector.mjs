import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adapterDir = dirname(fileURLToPath(import.meta.url))
const expected = ['node', '--expose-internals', '/opt/dsh/apps/cli/lib/bin.js']
for (const mode of ['authoring', 'verification']) {
  const result = spawnSync('docker', [
    'compose', '-f', join(adapterDir, `${mode}.compose.yaml`), 'config', '--format', 'json',
  ], {
    cwd: adapterDir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `Compose ${mode} config must parse`)
  const config = JSON.parse(result.stdout)
  assert.deepEqual(config.services.dsh.entrypoint, expected,
    `${mode}: only the main dsh service may expose Node internals`)
  assert.deepEqual(config.services['home-init'].entrypoint,
    ['node', '/opt/dsh-adapter/prepare-verification-home.mjs'])
  assert.equal(config.services.dsh.environment.NODE_OPTIONS, undefined,
    `${mode}: NODE_OPTIONS may not alter the startup vector`)
  assert.equal(config.services['home-init'].environment.NODE_OPTIONS, undefined)
  assert.ok(!config.services.dsh.volumes.some(volume =>
    volume.target === '/opt/dsh/node_modules/@deepseek-ai'),
  `${mode}: no root-scope alias volume may shadow the installation tree`)
}
console.log(JSON.stringify({ status: 'exact-main-dsh-startup-vectors-verified', modes: 2 }))
