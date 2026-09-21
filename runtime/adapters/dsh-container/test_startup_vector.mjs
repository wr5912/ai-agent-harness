import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adapterDir = dirname(fileURLToPath(import.meta.url))
const expected = ['node', '--expose-internals', '/opt/dsh/apps/cli/lib/bin.js']
// 模板不含任何仓库内默认路径：来源相关的值必须由调用方注入。这里用占位值，
// 先断言"不注入即失败关闭"，再用占位值核对启动向量本身。
const required = {
  DSH_IMAGE_TAG: 'ai-agent-harness/dsh:000000000',
  DSH_ADAPTER_HOST: '/tmp/placeholder/adapter',
  DSH_DEV_TARGET_HOST: '/tmp/placeholder/dev-target.AGENTS.local.md',
  DSH_MANAGED_PATCH: '/opt/dsh-managed/placeholder.patch.yml',
  DSH_MANAGED_PATCH_OVERLAY: '/opt/dsh-managed/placeholder.development.patch.yml',
  DSH_WORKSPACE_HOST: '/tmp/placeholder/workspace',
  DSH_PRESETS_HOST: '/tmp/placeholder/presets',
  DSH_MANAGED_HOST: '/tmp/placeholder/managed',
  DSH_REFERENCE_HOST: '/tmp/placeholder/reference',
}
function composeConfig(mode, env) {
  return spawnSync('docker', [
    'compose', '-f', join(adapterDir, `${mode}.compose.yaml`), 'config', '--format', 'json',
  ], {
    cwd: adapterDir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
}
for (const mode of ['authoring', 'verification']) {
  const missing = composeConfig(mode, {})
  assert.notEqual(missing.status, 0,
    `${mode}: compose must fail closed when the source-injected variables are absent`)
  assert.match(missing.stderr, /required variable/, `${mode}: failure must name the missing variable`)
  const result = composeConfig(mode, required)
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
