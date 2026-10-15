export const PLATFORM_DOMAINS = ['catalog', 'agents', 'instances', 'mcp', 'assistant'] as const
export type PlatformDomain = typeof PLATFORM_DOMAINS[number]
export interface PlatformUpdateSnapshot {
  revision: number
  domains: PlatformDomain[]
  ids: string[]
  connected: boolean
}

type Generation = { subscribe(listener: () => void): () => void }
type UpdateConnection = { generation?: Generation }
type UpdateOptions = { fetch?: typeof globalThis.fetch; retryMs?: number }

/** 仅消费失效通知；业务数据始终通过既有查询接口重新读取。 */
export function createPlatformUpdates(connection: UpdateConnection = {}, options: UpdateOptions = {}) {
  let snapshot: PlatformUpdateSnapshot = { revision: 0, domains: [], ids: [], connected: false }
  const listeners = new Set<() => void>()
  let controller: AbortController | undefined
  let generationDispose: (() => void) | undefined
  const publish = (domains: readonly PlatformDomain[], ids: readonly string[] = [], connected = snapshot.connected) => {
    snapshot = { revision: snapshot.revision + 1, domains: [...domains], ids: [...ids], connected }
    for (const listener of listeners) listener()
  }
  const invalidate = (domains: readonly PlatformDomain[] = PLATFORM_DOMAINS, ids: readonly string[] = []) => publish(domains, ids)
  const pause = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
  async function follow(signal: AbortSignal) {
    let retries = 0
    while (!signal.aborted) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      try {
        // 相对 URL 由当前站点的 <base> 保留 /hap/ 等挂载前缀。
        const response = await (options.fetch ?? globalThis.fetch)('api/harness-platform/events', {
          credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal,
        })
        if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('event stream unavailable')
        retries = 0
        reader = response.body.getReader()
        let remaining = ''
        const decoder = new TextDecoder()
        while (!signal.aborted) {
          const chunk = await reader.read()
          if (chunk.done) break
          remaining = (remaining + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n')
          let end: number
          while ((end = remaining.indexOf('\n\n')) >= 0) {
            const frame = remaining.slice(0, end)
            remaining = remaining.slice(end + 2)
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
            if (!data) continue
            try {
              const value = JSON.parse(data)
              if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.domains) || !Array.isArray(value.ids)
                || !value.domains.every((domain: unknown) => PLATFORM_DOMAINS.includes(domain as PlatformDomain))
                || !value.ids.every((id: unknown) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id))) continue
              publish(snapshot.connected ? value.domains : PLATFORM_DOMAINS, value.ids, true)
            } catch { /* 忽略未知帧，下一条通知或重连仍会核对当前状态。 */ }
          }
          if (remaining.length > 64 * 1024) throw new Error('event frame too large')
        }
      } catch { /* 连接恢复只重读数据，不重新执行业务操作。 */ }
      finally {
        try { await reader?.cancel() } catch { /* 连接可能已关闭。 */ }
        reader?.releaseLock()
      }
      if (!signal.aborted && snapshot.connected) publish([], [], false)
      if (!signal.aborted) await pause(Math.min((options.retryMs ?? 1000) * 2 ** retries++, 15_000), signal)
    }
  }
  const stop = () => {
    controller?.abort()
    controller = undefined
    generationDispose?.()
    generationDispose = undefined
    if (snapshot.connected) publish([], [], false)
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    invalidate,
    start() {
      if (!controller) {
        controller = new AbortController()
        generationDispose = connection.generation?.subscribe(() => invalidate())
        void follow(controller.signal)
      }
      return stop
    },
    stop,
  }
}

export type PlatformUpdates = ReturnType<typeof createPlatformUpdates>
