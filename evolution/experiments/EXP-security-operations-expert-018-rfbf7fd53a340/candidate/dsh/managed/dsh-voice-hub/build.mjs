// dsh-voice-hub build: esbuild-based, replicating the official tsdown.client.ts
// artifact shape for the client half; the host half is a plain ESM bundle
// with native runtime deps (sherpa-onnx) external.

import { build } from 'esbuild'
import { mkdirSync, readFileSync, renameSync, writeFileSync, mkdtempSync, copyFileSync, cpSync, symlinkSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WorkspaceAnalyzer, FaceModelEmitter } from '@deepseek-ai/dsh-typert-generator'

const PKG_ID = '@aisoc/dsh-voice-hub'

// 构建版本号：git 短哈希（进入语音模式时打到控制台，供确认运行版本）。
const pluginVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
let BUILD_TAG = `${pluginVersion}+unknown`
try {
  const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  const dirty = execSync('git status --porcelain -- .', { encoding: 'utf8' }).trim() !== ''
  BUILD_TAG = `${pluginVersion}+${hash}${dirty ? '-dirty' : ''}`
} catch {
  // 非 git 环境：保持 unknown
}

/**
 * 原子构建：先写 `lib/.tmp-*` 再 rename 覆盖成品。
 * 直接覆盖成品文件存在窗口：运行中的 dsh 若恰在此时重建合成子进程（崩溃重试/
 * 引擎切换）会 fork 到写了一半的脚本；用户刷新网页也可能拿到半成品 client.js。
 */
async function buildAtomically(opts) {
  const tmp = join('lib', `.tmp-${opts.outfile.split('/').pop()}-${process.pid}`)
  await build({ ...opts, outfile: tmp })
  renameSync(tmp, opts.outfile)
}

const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

mkdirSync('lib', { recursive: true })
// 从唯一的 TypeScript Remote 声明生成契约；typecheck 随后检查两端。
// 官方生成器只识别 packages/ 项目，临时工作区仅用于读取当前 Remote 声明。
const workspace = mkdtempSync(join(tmpdir(), 'voice-typert-'))
try {
  const project = join(workspace, 'packages/voice')
  const protocol = join(workspace, 'packages/protocol')
  mkdirSync(protocol, { recursive: true })
  cpSync('node_modules/@deepseek-ai/dsh-typert-protocol/lib/types', join(protocol, 'types'), { recursive: true })
  writeFileSync(join(protocol, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-typert-protocol', exports: {} }))
  writeFileSync(join(protocol, 'tsconfig.json'), JSON.stringify({ include: ['types/**/*.d.ts'] }))
  symlinkSync(join(process.cwd(), 'node_modules'), join(workspace, 'node_modules'), 'dir')
  mkdirSync(join(project, 'src'), { recursive: true })
  copyFileSync('src/voice-remote.ts', join(project, 'src/voice-remote.ts'))
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  manifest.exports = { './voice-remote': manifest.exports['./voice-remote'] }
  writeFileSync(join(project, 'package.json'), JSON.stringify(manifest))
  symlinkSync(join(process.cwd(), 'node_modules'), join(project, 'node_modules'), 'dir')
  const config = JSON.parse(readFileSync('tsconfig.json', 'utf8'))
  config.include = ['src/voice-remote.ts']
  config.compilerOptions.paths = { '@deepseek-ai/dsh-typert-protocol': [join(protocol, 'types/index.d.ts')] }
  writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(config))
  writeFileSync(join(workspace, 'tsconfig.host.json'), JSON.stringify({ compilerOptions: config.compilerOptions, references: [{ path: './packages/voice' }, { path: './packages/protocol' }] }))
  const model = new WorkspaceAnalyzer({ root: workspace, packages: [PKG_ID], faces: ['host'], checkDiagnostics: false }).analyze()
  const artifact = new FaceModelEmitter(model.faces[0]).emit(PKG_ID)
  if (!artifact.remote) throw new Error('未生成语音 Remote 契约')
  writeFileSync('lib/typert.host.js', artifact.js)
  writeFileSync('lib/typert.host.d.ts', artifact.dts)
  writeFileSync('lib/typert.remote-client.js', artifact.remote.js)
  writeFileSync('lib/typert.remote-client.d.ts', artifact.remote.dts)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}


// Edge TTS 作为 CJS 单独打包：DSH profile 对依赖的 buffer/index 子路径解析有缺陷。
await buildAtomically({
  entryPoints: ['msedge-tts'],
  outfile: 'lib/msedge-tts.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['node:*'],
  logLevel: 'info',
})

// --- host half: plain ESM cordis plugin; runtime deps stay external ---
await buildAtomically({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-typert-protocol',
    'ws',
    'sherpa-onnx',
    'sherpa-onnx-node',
    'node:*',
  ],
  logLevel: 'info',
})

// --- SenseVoice 定稿解码 worker（P4-1 离主线程）：独立 ESM，主线程 new Worker 加载 ---
await build({
  entryPoints: ['src/sense-worker.ts'],
  outfile: 'lib/sense-worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: [
    'sherpa-onnx',
    'node:*',
  ],
  logLevel: 'info',
})

// --- AudioWorklet（客户端采集）：独立 IIFE 字符串，经 define 注入 client bundle，
//     运行时用 Blob URL 交给 audioCtx.audioWorklet.addModule 加载（浏览器仅服务 client.js）。 ---
const workletBuild = await build({
  entryPoints: ['src/audio-worklet.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  logLevel: 'info',
})
const AUDIO_WORKLET_SOURCE = workletBuild.outputFiles[0].text

// --- 本地 TTS 合成子进程（child_process.fork，CJS 以获得 IPC 通道）---
await buildAtomically({
  entryPoints: ['src/tts-vits-worker.ts'],
  outfile: 'lib/tts-vits-worker.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['sherpa-onnx', 'sherpa-onnx-node', 'node:*'],
  logLevel: 'info',
})

// --- client half: module-loader closure artifact ---
await buildAtomically({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  // Keep the native import() for the transformers.js CDN ESM bundle.
  supported: { 'dynamic-import': true },
  external: PLATFORM_EXTERNALS,
  define: {
    __BUILD_TAG__: JSON.stringify(BUILD_TAG),
    __AUDIO_WORKLET__: JSON.stringify(AUDIO_WORKLET_SOURCE),
  },
  banner: {
    js:
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_ID)}, factory: (require) => {\n` +
      'var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'info',
})

console.log('[dsh-voice-hub] 构建完成：宿主端 lib/index.js、浏览器端 lib/client.js 和语音工作线程')
