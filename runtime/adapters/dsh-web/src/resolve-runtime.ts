import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 解析当前进程真正装载的 Runtime；不把系统 shell 包装器当成 Node 包入口。 */
export function runtimeRequire(name: string, containerManifest?: string): NodeRequire {
  const candidates = containerManifest ? [containerManifest] : [
    process.env.HARNESS_DSH_ENTRY,
    process.argv[1],
    fileURLToPath(import.meta.url),
    new URL('../../../../platform/plugin/package.json', import.meta.url).pathname,
  ]
  for (const entry of candidates) {
    if (!entry) continue
    let canonical: string
    let require: NodeRequire
    try {
      canonical = realpathSync(entry)
      require = createRequire(canonical)
      require.resolve(name)
    } catch { continue }
    if (!containerManifest) process.env.HARNESS_DSH_ENTRY = canonical
    return require
  }
  throw new Error(`Web 路径适配器无法从当前 Runtime 解析 ${name}`)
}

export async function runtimeModule(name: string, containerManifest?: string): Promise<any> {
  return import(pathToFileURL(runtimeRequire(name, containerManifest).resolve(name)).href)
}
