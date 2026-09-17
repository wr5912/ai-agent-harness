import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { decodeMountPath, fileSnapshot } from './tree-digest.mjs'
import { installationClosure, validateFallback } from './prepare-verification-home.mjs'

const mode = process.env.DSH_HARNESS_MODE
if (mode !== 'authoring' && mode !== 'verification') {
  throw new Error('DSH_HARNESS_MODE must be authoring or verification')
}
let source
try {
  source = JSON.parse(process.env.DSH_EXPECT_SOURCE_JSON ?? '')
} catch {
  throw new Error('missing or invalid selected DSH source contract')
}
if (source?.schema_version !== '1.0' || !/^EXP-[a-z0-9-]+-[0-9]{3}$/.test(source.source_id)
  || source.profile !== 'web' || !source.patch?.startsWith('/opt/dsh-managed/')
  || !source.preset?.startsWith('/opt/dsh-presets/')
  || (source.guard !== null && !source.guard?.startsWith('/opt/dsh-managed/'))
  || !Array.isArray(source.config_markers) || source.config_markers.length === 0) {
  throw new Error('selected DSH source contract is incomplete')
}

const roots = [
  { key: 'workspace', path: '/work/harness/workspace', expected: process.env.DSH_EXPECT_WORKSPACE_TREE_SHA },
  { key: 'presets', path: '/opt/dsh-presets', expected: process.env.DSH_EXPECT_PRESETS_TREE_SHA },
  { key: 'managed', path: '/opt/dsh-managed', expected: process.env.DSH_EXPECT_MANAGED_TREE_SHA },
]

const mounts = readFileSync('/proc/self/mountinfo', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => {
    const fields = line.split(' ')
    return { target: decodeMountPath(fields[4]), options: fields[5].split(',') }
  })

function fileSha(path, maxBytes = 256 * 1024, allowEmpty = false) {
  const state = lstatSync(path)
  if (!state.isFile() || state.isSymbolicLink() || state.size > maxBytes || (!allowEmpty && state.size === 0)) {
    throw new Error(`controlled file is not bounded regular data: ${path}`)
  }
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

for (const script of [
  { path: '/opt/dsh-adapter/verify-load.mjs', expected: process.env.DSH_EXPECT_VERIFY_SCRIPT_SHA },
  { path: '/opt/dsh-adapter/prepare-verification-home.mjs', expected: process.env.DSH_EXPECT_PREPARE_SCRIPT_SHA },
  { path: '/opt/dsh-adapter/tree-digest.mjs', expected: process.env.DSH_EXPECT_TREE_SCRIPT_SHA },
]) {
  if (!script.expected || fileSha(script.path) !== script.expected) {
    throw new Error(`host/image adapter script digest mismatch: ${script.path}`)
  }
}

const mountEvidence = {}
for (const item of roots) {
  if (!existsSync(item.path)) throw new Error(`asset mount missing: ${item.key}`)
  const mount = mounts.find(entry => entry.target === item.path)
  if (!mount) throw new Error(`asset path is not an exact bind mount: ${item.key}`)
  const expectedMode = item.key === 'workspace' && mode === 'authoring' ? 'rw' : 'ro'
  if (!mount.options.includes(expectedMode)) {
    throw new Error(`asset mount mode mismatch: ${item.key}, expected ${expectedMode}`)
  }
  const snapshot = fileSnapshot(item.path)
  if (!item.expected || snapshot.tree_sha256 !== item.expected) {
    throw new Error(`host/container asset tree mismatch: ${item.key}`)
  }
  mountEvidence[item.key] = { mount_mode: expectedMode, ...snapshot }
}

const homeMount = mounts.find(entry => entry.target === '/var/lib/dsh')
if (!homeMount || !homeMount.options.includes('rw')) {
  throw new Error('independent DSH_HOME volume is absent or read-only')
}

const homeControlEvidence = {}
{
  const controls = [
    {
      key: 'home_user_patch',
      path: '/var/lib/dsh/cordis.patch.yml',
      expected: process.env.DSH_EXPECT_USER_PATCH_SHA,
    },
    {
      key: 'web_user_patch',
      path: '/var/lib/dsh/profiles/web/cordis.patch.yml',
      expected: process.env.DSH_EXPECT_USER_PATCH_SHA,
    },
    {
      key: 'web_profile_manifest',
      path: '/var/lib/dsh/profiles/web/package.json',
      expected: process.env.DSH_EXPECT_WEB_MANIFEST_SHA,
    },
    {
      key: 'global_agent_instructions',
      path: '/var/lib/dsh/AGENTS.md',
      expected: process.env.DSH_EXPECT_GLOBAL_AGENTS_SHA,
    },
    {
      key: 'home_bootstrap_env',
      path: '/var/lib/dsh/.env',
      expected: process.env.DSH_EXPECT_BOOTSTRAP_ENV_SHA,
    },
    {
      key: 'workspace_bootstrap_env',
      path: '/work/harness/workspace/.env',
      expected: process.env.DSH_EXPECT_BOOTSTRAP_ENV_SHA,
    },
  ]
  for (const control of controls) {
    const mount = mounts.find(entry => entry.target === control.path)
    if (!mount || !mount.options.includes('ro')) {
      throw new Error(`controlled DSH_HOME file is not an exact read-only bind: ${control.key}`)
    }
    const state = lstatSync(control.path)
    if (!state.isFile() || state.isSymbolicLink()
      || (control.key !== 'global_agent_instructions' && state.size === 0)
      || state.size > 64 * 1024) {
      throw new Error(`controlled DSH_HOME file is not a bounded regular file: ${control.key}`)
    }
    const bytes = readFileSync(control.path)
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    if (!control.expected || actual !== control.expected) {
      throw new Error(`host/container DSH_HOME control digest mismatch: ${control.key}`)
    }
    homeControlEvidence[control.key] = { mount_mode: 'ro', sha256: actual, size: bytes.length }
  }

  const homePatch = readFileSync('/var/lib/dsh/cordis.patch.yml', 'utf8')
  const profilePatch = readFileSync('/var/lib/dsh/profiles/web/cordis.patch.yml', 'utf8')
  if (homePatch !== profilePatch || !/^\s*(?:#[^\n]*\n)*\[\]\s*$/.test(homePatch)) {
    throw new Error('DSH_HOME user Patch is not the controlled empty deny-layer')
  }
  const manifest = JSON.parse(readFileSync('/var/lib/dsh/profiles/web/package.json', 'utf8'))
  if (manifest.name !== 'dsh-profile-web' || manifest.private !== true
    || Object.keys(manifest.dependencies ?? {}).length !== 0
    || manifest.dsh?.profile?.patchReload !== 'startup'
    || JSON.stringify(manifest.dsh?.profile?.bundles) !== JSON.stringify([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app',
    ])) {
    throw new Error('web Profile manifest differs from locked startup tuple')
  }
  for (const path of ['/var/lib/dsh/.env', '/work/harness/workspace/.env']) {
    const content = readFileSync(path, 'utf8')
    if (!/^(?:\s*#[^\n]*\n)+\s*$/.test(content) || /^[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*=/m.test(content)) {
      throw new Error(`bootstrap environment deny-layer contains assignments: ${path}`)
    }
  }
  if (!/^\s*$/.test(readFileSync('/var/lib/dsh/AGENTS.md', 'utf8'))) {
    throw new Error('global DSH_HOME Agent instructions are not semantically empty')
  }
}

const moduleEvidence = {}
for (const path of [
  '/var/lib/dsh/node_modules',
  '/var/lib/dsh/profiles/web/node_modules',
  '/var/lib/dsh/profiles/web/.dsh-module-fallback/node_modules',
]) {
  const mount = mounts.find(entry => entry.target === path)
  if (!mount || !mount.options.includes('ro')) {
    throw new Error(`DSH_HOME module deny-layer is not an exact read-only mount: ${path}`)
  }
  const state = lstatSync(path)
  if (!state.isDirectory() || state.isSymbolicLink()
    || JSON.stringify(readdirSync(path)) !== JSON.stringify(['POLICY.md'])) {
    throw new Error(`DSH_HOME module deny-layer contains package entries: ${path}`)
  }
  const markerSha = fileSha(join(path, 'POLICY.md'), 64 * 1024)
  if (!process.env.DSH_EXPECT_MODULE_DENY_SHA || markerSha !== process.env.DSH_EXPECT_MODULE_DENY_SHA) {
    throw new Error(`DSH_HOME module deny-layer marker mismatch: ${path}`)
  }
  moduleEvidence[path] = { mount_mode: 'ro', module_entries: 0, policy_sha256: markerSha }
}

const fallbackPath = '/var/lib/dsh/profiles/node_modules'
const fallbackMount = mounts.find(entry => entry.target === fallbackPath)
if (!fallbackMount || !fallbackMount.options.includes('ro')) {
  throw new Error('trusted installation fallback is not an exact read-only volume mount')
}
const closure = installationClosure('/opt/dsh/apps/cli/package.json')
validateFallback(fallbackPath, closure, false)
const profileRequire = createRequire('/var/lib/dsh/profiles/web/cordis.yml')
const criticalModules = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-agent-instructions',
]
for (const name of criticalModules) {
  if (!closure.has(name)) throw new Error(`critical DSH module is outside pinned installation closure: ${name}`)
  let first
  for (const path of profileRequire.resolve.paths(name) ?? []) {
    const candidate = join(path, name)
    if (existsSync(join(candidate, 'package.json'))) {
      first = candidate
      break
    }
  }
  if (!first || !realpathSync.native(first).startsWith('/opt/dsh/')) {
    throw new Error(`critical module resolution escaped immutable image tree: ${name}`)
  }
}
moduleEvidence[fallbackPath] = {
  mount_mode: 'ro',
  pinned_installation_symlinks: closure.size,
  critical_modules_resolved_inside_image: criticalModules.length,
}

const dump = spawnSync(process.execPath, [
  '/opt/dsh/apps/cli/lib/bin.js',
  '--profile', source.profile,
  '--patch', source.patch,
  '--dump-config',
], {
  cwd: '/work/harness/workspace',
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  timeout: 20_000,
  killSignal: 'SIGKILL',
})
if (dump.error?.code === 'ETIMEDOUT') {
  throw new Error('DSH profile composition timed out after 20 seconds; child was killed')
}
if (dump.error) {
  throw new Error(`DSH profile composition could not start (${dump.error.code ?? 'unknown'})`)
}
if (dump.status !== 0) {
  // 不输出原始 stderr；它可能包含 MCP URL、Token 或其他私有配置。
  throw new Error(`DSH profile composition failed (exit=${String(dump.status ?? dump.signal)})`)
}

for (const marker of source.config_markers) {
  if (!dump.stdout.includes(marker)) {
    throw new Error(`DSH composed config missing expected marker: ${marker}`)
  }
}

// --dump-config 只展开全局 Profile，不展开每个 Agent Preset 的 agent.cordis.yml。
// 因此 Guard 仅能在本探针里核对 Preset 声明与挂载文件；实际插件激活须另取证。
let guardPresent = false
if (source.guard !== null) {
  const presetConfig = readFileSync(source.preset, 'utf8')
  if (!presetConfig.includes(source.guard) || !existsSync(source.guard)) {
    throw new Error('Preset Guard declaration or managed Guard file is missing')
  }
  guardPresent = true
}

console.log(JSON.stringify({
  status: 'mount-and-config-composition-only',
  source_id: source.source_id,
  agent_id: source.agent_id,
  dsh_mode: mode,
  profile: source.profile,
  patch: source.patch,
  mounts: mountEvidence,
  dsh_home_mount_mode: 'rw',
  controlled_home_controls: homeControlEvidence,
  controlled_module_resolution: moduleEvidence,
  composed_config_sha256: `sha256:${createHash('sha256').update(dump.stdout).digest('hex')}`,
  expected_markers_present: source.config_markers.length,
  preset_guard_declaration_present: guardPresent,
  limitations: 'Read-only HOME/Module/.env controls and a startup manifest prove only mount and resolution identity, not Plugins/MCP or Preset actually activated; no Agent session, real protocol, final business state, or Release acceptance was tested.',
}))
