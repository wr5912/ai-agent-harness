import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

export const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxDepth: 256,
  maxNodes: 100_000,
})

function narrowedLimits(override) {
  for (const name of Object.keys(override)) {
    if (!(name in DEFAULT_LIMITS)) throw new Error(`unknown asset scan limit: ${name}`)
  }
  const limits = { ...DEFAULT_LIMITS, ...override }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[name]) {
      throw new Error(`asset scan limit cannot be widened: ${name}`)
    }
  }
  return limits
}

function fileHash(path, prior, limits) {
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new Error('O_NOFOLLOW is required for asset scan')
  }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== prior.dev || opened.ino !== prior.ino) {
      throw new Error(`asset changed type during scan: ${path}`)
    }
    if (!Number.isSafeInteger(opened.size) || opened.size > limits.maxFileBytes) {
      throw new Error(`asset file exceeds 64 MiB limit: ${path}`)
    }
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let bytes = 0
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null)
      if (count === 0) break
      bytes += count
      if (bytes > limits.maxFileBytes) throw new Error(`asset file grew beyond limit: ${path}`)
      hash.update(buffer.subarray(0, count))
    }
    const after = fstatSync(descriptor)
    if (bytes !== opened.size || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
      || (after.mode & 0o7777) !== (opened.mode & 0o7777)) {
      throw new Error(`asset changed during scan: ${path}`)
    }
    return { sha256: hash.digest('hex'), size: bytes, mode: opened.mode & 0o7777 }
  } finally {
    closeSync(descriptor)
  }
}

export function decodeMountPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
}

export function fileSnapshot(root, override = {}) {
  const limits = narrowedLimits(override)
  const files = []
  const pending = [{ folder: root, depth: 0 }]
  let nodes = 1
  let totalBytes = 0
  while (pending.length > 0) {
    const { folder, depth } = pending.pop()
    for (const name of readdirSync(folder)) {
      nodes++
      if (nodes > limits.maxNodes) throw new Error('asset scan exceeds node limit')
      const path = join(folder, name)
      const childDepth = depth + 1
      if (childDepth > limits.maxDepth) throw new Error(`asset scan exceeds depth limit: ${path}`)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`unsupported asset type: ${relative(root, path)}`)
      }
      if (stat.isDirectory()) {
        pending.push({ folder: path, depth: childDepth })
        continue
      }
      if (!Number.isSafeInteger(stat.size) || stat.size > limits.maxFileBytes) {
        throw new Error(`asset file exceeds 64 MiB limit: ${relative(root, path)}`)
      }
      if (totalBytes + stat.size > limits.maxTotalBytes) {
        throw new Error('asset scan exceeds 1 GiB total byte limit')
      }
      const content = fileHash(path, stat, limits)
      totalBytes += content.size
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error('asset scan exceeds 1 GiB total byte limit')
      }
      files.push({
        mode: content.mode.toString(8).padStart(4, '0'),
        path: relative(root, path).split('\\').join('/'),
        sha256: content.sha256,
        size: content.size,
      })
    }
  }
  files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  const serialized = JSON.stringify(files)
  return {
    tree_sha256: `sha256:${createHash('sha256').update(serialized).digest('hex')}`,
    file_count: files.length,
    total_bytes: totalBytes,
  }
}
