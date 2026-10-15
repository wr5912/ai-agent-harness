import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { homedir } from 'node:os'

export const THREAT_SOURCE_COMMIT = '6e80f2c92b7983cbe8fc7957685d36338080b134'
export const THREAT_SOURCE_DIRECTORY = 'evolution/experiments/EXP-security-operations-expert-020/candidate/dsh/managed/threat-analysis'
export type ThreatSource = { root: string; catalog: string; commit: string; digest: string }

export function defaultThreatStateRoot(assetRoot: string) {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'harness-platform', 'threat', createHash('sha256').update(assetRoot).digest('hex').slice(0, 16))
}

export async function ensureThreatSource(assetRoot: string, opts: { stateRoot?: string } = {}) {
  const source = await loadThreatSource(assetRoot, opts.stateRoot ?? defaultThreatStateRoot(assetRoot))
  return { ...source, directory: source.root, bridgeModule: `${source.root}.mjs` }
}

// 只读运行缓存是 Git 资产的制品，不维护第二份可编辑算法。
export async function loadThreatSource(assetRoot: string, stateRoot: string): Promise<ThreatSource> {
  const cache = join(stateRoot, 'source', THREAT_SOURCE_COMMIT)
  const marker = join(cache, 'source.json')
  let metadata: { digest: string }
  let cached = false
  try { await lstat(cache); cached = true } catch (error: any) { if (error.code !== 'ENOENT') throw new Error('threat_source_integrity_failed') }
  if (!cached) {
    await mkdir(join(stateRoot, 'source'), { recursive: true })
    const temporary = `${cache}.${randomUUID()}.tmp`
    await mkdir(temporary)
    try {
      const archive = await promisify(execFile)('git', ['archive', THREAT_SOURCE_COMMIT, THREAT_SOURCE_DIRECTORY, `${THREAT_SOURCE_DIRECTORY}.mjs`], { cwd: assetRoot, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
      await new Promise<void>((resolve, reject) => {
        const child = spawn('tar', ['-xf', '-', '-C', temporary], { stdio: ['pipe', 'ignore', 'ignore'] })
        child.on('error', reject)
        child.on('close', code => code === 0 ? resolve() : reject(new Error('threat_source_extract_failed')))
        child.stdin.on('error', () => undefined)
        child.stdin.end(archive.stdout)
      })
      // source.json 必须在根目录封只读前写入。
      metadata = { digest: await sourceDigest(join(temporary, 'evolution'), true) }
      await writeFile(join(temporary, 'source.json'), JSON.stringify(metadata), { mode: 0o444 })
      await chmod(temporary, 0o555)
      try { await rename(temporary, cache) }
      catch (error: any) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error }
    } catch { throw new Error('threat_source_unavailable') }
    finally { await rm(temporary, { recursive: true, force: true }).catch(() => undefined) }
  }
  try {
    if ((await lstat(cache)).isSymbolicLink() || (await lstat(marker)).isSymbolicLink()) throw new Error('symlink')
    metadata = JSON.parse(await readFile(marker, 'utf8'))
    if (!/^[0-9a-f]{64}$/.test(metadata.digest) || await sourceDigest(join(cache, 'evolution')) !== metadata.digest) throw new Error('digest')
  } catch { throw new Error('threat_source_integrity_failed') }
  const root = join(cache, THREAT_SOURCE_DIRECTORY)
  return { root, catalog: join(root, 'catalog'), commit: THREAT_SOURCE_COMMIT, digest: metadata.digest }
}

async function sourceDigest(root: string, seal = false) {
  const hash = createHash('sha256')
  async function walk(folder: string, prefix = ''): Promise<void> {
    if ((await lstat(folder)).isSymbolicLink()) throw new Error('source_symlink')
    for (const name of (await readdir(folder)).sort()) {
      const file = join(folder, name), stat = await lstat(file)
      if (stat.isSymbolicLink()) throw new Error('source_symlink')
      if (stat.isDirectory()) await walk(file, `${prefix}${name}/`)
      else if (stat.isFile()) {
        hash.update(prefix + name).update('\0').update(await readFile(file))
        if (seal) await chmod(file, 0o444)
      } else throw new Error('source_file_type')
    }
    if (seal) await chmod(folder, 0o555)
  }
  await walk(root)
  return hash.digest('hex')
}
