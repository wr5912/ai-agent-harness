import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 部署配置在工作区维护，编译产物不固化用户的 URL 前缀。 */
export function sitePath(site: 'assistant' | 'platform'): string {
  const path = process.env.HARNESS_SITES_CONFIG
    || (process.env.HARNESS_ASSET_ROOT ? join(process.env.HARNESS_ASSET_ROOT, 'config', 'sites.json') : undefined)
  const values = path ? JSON.parse(readFileSync(path, 'utf8')) : { assistant: '/assistant/', platform: '/hep/' }
  const value = values[site]
  if (typeof value !== 'string' || !/^\/[a-z][a-z0-9-]*\/$/.test(value)) throw new Error(`无效 ${site} 站点基址`)
  return value
}
