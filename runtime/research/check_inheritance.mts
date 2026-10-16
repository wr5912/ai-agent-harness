import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

const [sourceId, sourceRef, targetId] = process.argv.slice(2)
const experimentId = /^EXP-([a-z0-9-]+)-\d{3}(?:-r[0-9a-f]{12})?$/
if (!sourceId || !targetId || !sourceRef || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceRef)
  || !experimentId.test(sourceId) || !experimentId.test(targetId)
  || experimentId.exec(sourceId)?.[1] !== experimentId.exec(targetId)?.[1]) {
  console.error('用法: node --experimental-strip-types check_inheritance.mts <来源 Experiment ID> <Git commit> <目标 Experiment ID>')
  process.exit(2)
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const sourceCommit = execFileSync('git', ['rev-parse', '--verify', `${sourceRef}^{commit}`], { cwd: root, encoding: 'utf8' }).trim()
const algorithm = execFileSync('git', ['rev-parse', '--show-object-format'], { cwd: root, encoding: 'utf8' }).trim()
const sourcePrefix = `evolution/experiments/${sourceId}/candidate/`
const targetRoot = join(root, 'evolution', 'experiments', targetId, 'candidate')
if (!existsSync(targetRoot)) {
  console.error(`目标 Candidate 不存在: ${targetId}`)
  process.exit(2)
}

const entries = execFileSync('git', ['ls-tree', '-r', '-z', sourceCommit, '--', sourcePrefix], { cwd: root })
  .toString('utf8').split('\0').filter(Boolean)
if (!entries.length) {
  console.error(`来源提交中没有 Candidate 文件: ${sourceId}@${sourceCommit}`)
  process.exit(2)
}

const missing: string[] = []
const changed: string[] = []
for (const entry of entries) {
  const [header, fullPath] = entry.split('\t')
  const [mode, type, sourceHash] = header.split(' ')
  if (type !== 'blob') throw new Error(`不支持的来源对象: ${fullPath}`)
  const relativePath = fullPath.slice(sourcePrefix.length)
  const targetPath = join(targetRoot, relativePath)
  if (!existsSync(targetPath)) {
    missing.push(relativePath)
    continue
  }
  const stat = lstatSync(targetPath)
  const targetMode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644'
  const bytes = targetMode === '120000' ? Buffer.from(readlinkSync(targetPath)) : readFileSync(targetPath)
  const hash = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (targetMode !== mode || hash !== sourceHash) changed.push(relativePath)
}

console.log(`来源 ${sourceId}@${sourceCommit} → ${targetId}: ${entries.length} 个文件；缺失 ${missing.length}；内容变化 ${changed.length}`)
for (const path of missing) console.log(`缺失 ${path}`)
for (const path of changed) console.log(`需审查 ${path}`)
if (missing.length || changed.length) process.exitCode = 1
