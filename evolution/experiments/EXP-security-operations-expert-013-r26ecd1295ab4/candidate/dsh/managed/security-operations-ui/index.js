import { AsyncLocalStorage } from 'node:async_hooks'

export const name = 'dsh-security-operations-ui'
export const inject = ['storageDomain', 'sessionController', 'connection']

const ROLES = [
  ['delegate_threat_analysis', '威胁研判子智能体'],
  ['delegate_fault_analysis', '故障分析子智能体'],
  ['delegate_response_planning', '响应规划子智能体'],
]
const ROLE_NAMES = new Map(ROLES)
const context = new AsyncLocalStorage()
const schema = { parse(value) {
  if (!value || typeof value !== 'object' || !ROLE_NAMES.has(value.role)
    || typeof value.callId !== 'string' || typeof value.parentSessionId !== 'string'
    || typeof value.startedAt !== 'number' || !['running', 'completed', 'failed', 'no_child'].includes(value.status)) {
    throw new Error('invalid overview call record')
  }
  return value
} }

export async function apply(ctx) {
  const hours = 24
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({
      name: 'security_operations_overview', version: 1, tables: { calls: { valueSchema: schema } },
    })
    const calls = domain.table('calls')
    let queue = Promise.resolve()
    let storageFailed = false
    const disposers = []
    const runIds = new Map()
    const enqueue = update => {
      queue = queue.then(update).catch(error => {
        storageFailed = true
        ctx.logger.error('security-operations-ui overview storage failed', error)
      })
      return queue
    }
    const patch = (key, fields) => enqueue(async () => {
      const old = calls.get(key)
      if (old) await calls.put(key, { ...old, ...fields })
    })
    try {
      disposers.push(ctx.on('tools/execute', async (exec, next) => {
        if (!ROLE_NAMES.has(exec.name)) return next()
        const key = `${exec.agent?.session?.id ?? 'unknown'}:${exec.callId}`
        await enqueue(() => calls.put(key, {
          role: exec.name, callId: String(exec.callId),
          parentSessionId: String(exec.agent?.session?.id ?? 'unknown'),
          startedAt: Date.now(), status: 'running',
        }))
        return context.run(key, next)
      }))
      disposers.push(ctx.on('subagent/start', info => {
        const key = context.getStore()
        if (!key) return
        runIds.set(String(info.runId), key)
        void patch(key, { childSessionId: String(info.id), runId: String(info.runId) })
      }))
      disposers.push(ctx.on('subagent/end', info => {
        const key = runIds.get(String(info.runId))
        if (!key) return
        runIds.delete(String(info.runId))
        void enqueue(async () => {
          const old = calls.get(key)
          if (old) await calls.put(key, { ...old, stopReason: String(info.stopReason),
            ...(old.endedAt ? { status: old.status === 'failed' || info.stopReason !== 'completed' ? 'failed' : 'completed' } : {}) })
        })
      }))
      disposers.push(ctx.on('tools/result', (exec, result) => {
        if (!ROLE_NAMES.has(exec.name)) return
        const key = `${exec.agent?.session?.id ?? 'unknown'}:${exec.callId}`
        void enqueue(async () => {
          const old = calls.get(key)
          const row = old ?? {
            role: exec.name, callId: String(exec.callId),
            parentSessionId: String(exec.agent?.session?.id ?? 'unknown'), startedAt: Date.now(),
          }
          await calls.put(key, {
            ...row, endedAt: Date.now(),
            status: row.childSessionId
              ? result.isError || row.stopReason && row.stopReason !== 'completed' ? 'failed'
                : row.stopReason === 'completed' ? 'completed' : 'running'
              : 'no_child',
          })
        })
      }))
      disposers.push(ctx.connection.fetch.register({
        path: '/api/security-operations/overview', methods: ['GET'], requestBody: 'buffered',
        fetch: async () => {
          try {
            await queue
            if (storageFailed) throw new Error('overview storage unavailable')
            const { items } = await ctx.sessionController.list({}, new AbortController().signal)
            const since = Date.now() - hours * 3_600_000
            const recent = [...calls.entries()].map(([, row]) => row).filter(row => row.startedAt >= since)
            const sessions = new Map(items.map(item => [String(item.sessionId), item]))
            const parent = items.filter(item => !item.parentSessionId && !item.blank)
            const activeParent = parent.filter(item => item.running)
            const roles = ROLES.map(([id, title]) => {
              const rows = recent.filter(row => row.role === id).sort((a, b) => b.startedAt - a.startedAt)
              const active = rows.filter(row => row.status === 'running' && sessions.get(row.childSessionId)?.running).length
              const unknown = rows.filter(row => row.status === 'running' && !sessions.get(row.childSessionId)?.running).length
              return {
                id, title, state: active ? 'running' : unknown ? 'unknown' : 'idle',
                active, completed: rows.filter(row => row.status === 'completed').length,
                failed: rows.filter(row => row.status === 'failed').length,
                noChild: rows.filter(row => row.status === 'no_child').length,
                unknown, recent: rows.slice(0, 5),
              }
            })
            return Response.json({
              windowHours: hours, asOf: Date.now(),
              parent: { state: activeParent.length ? 'running' : 'idle', active: activeParent.length,
                sessions: parent.length, recentSessionId: parent[0]?.sessionId ?? null },
              roles,
            }, { headers: { 'cache-control': 'no-store' } })
          } catch (error) {
            ctx.logger.error('security-operations-ui overview unavailable', error)
            return Response.json({ error: 'overview unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
          }
        },
      }))
      return async () => {
        for (const dispose of disposers.reverse()) await dispose()
        await queue
        await domain.close()
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      await domain.close()
      throw error
    }
  })
}
