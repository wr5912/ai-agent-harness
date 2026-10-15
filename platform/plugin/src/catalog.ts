import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { CHANNEL } from './protocol.ts'
import type { Inventory } from './protocol.ts'
import type { PlatformUpdates } from './realtime/client.ts'

export type CatalogSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  inventory?: Inventory
  error?: string
}

export function createCatalog(rpc: ClientConnectionRpc, updates?: PlatformUpdates) {
  let snapshot: CatalogSnapshot = { status: 'idle' }
  let request = 0
  const listeners = new Set<() => void>()
  const publish = (next: CatalogSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const catalog = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async refresh() {
      const current = ++request
      publish({ status: 'loading', inventory: snapshot.inventory })
      try {
        const result = await rpc.call(CHANNEL, 'inventory', {})
        if (current !== request) return
        if (result.ok) publish({ status: 'ready', inventory: result.value as Inventory })
        else publish({ status: 'error', inventory: snapshot.inventory, error: result.error.message })
      } catch {
        if (current === request) publish({ status: 'error', inventory: snapshot.inventory, error: '无法连接资产查询服务，请刷新重试。' })
      }
    },
  }
  const dispose = updates?.subscribe(() => {
    if (updates.getSnapshot().domains.some(domain => domain === 'catalog' || domain === 'agents')) void catalog.refresh()
  })
  return { ...catalog, dispose: () => { dispose?.(); request++; listeners.clear() } }
}

export type Catalog = ReturnType<typeof createCatalog>
