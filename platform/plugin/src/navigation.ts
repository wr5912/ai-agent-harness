import type { PageId, PlatformNavigation } from './protocol.ts'

const pages: PageId[] = ['home', 'conversations', 'agents', 'evaluation', 'instances', 'mcp']
const fields = ['agent_id', 'experiment_id', 'run_id', 'case_id', 'tab'] as const

export function readNavigation(hash: string): PlatformNavigation {
  const [path, query] = hash.replace(/^#\/?/, '').split('?')
  const page = pages.includes(path as PageId) ? path as PageId : 'home'
  const result: PlatformNavigation = { page }
  const params = new URLSearchParams(query)
  for (const field of fields) {
    const value = params.get(field)
    if (value && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)) result[field] = value
  }
  return result
}

export function navigationHash(target: PlatformNavigation) {
  const params = new URLSearchParams()
  for (const field of fields) if (target[field]) params.set(field, target[field])
  return `#/${target.page}${params.size ? `?${params}` : ''}`
}
