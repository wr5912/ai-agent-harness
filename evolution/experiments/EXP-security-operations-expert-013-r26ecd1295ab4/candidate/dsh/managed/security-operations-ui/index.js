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
const activitySchema = { parse(value) {
  if (!value || typeof value !== 'object' || typeof value.sessionId !== 'string'
    || typeof value.at !== 'number' || ![0, 1].includes(value.toolCalls)
    || ![0, 1].includes(value.skillLoads)) {
    throw new Error('invalid overview activity record')
  }
  return value
} }

export async function apply(ctx) {
  const hours = 24
  await ctx.effect(async () => {
    const domain = await ctx.storageDomain.open({
      name: 'security_operations_overview', version: 1,
      tables: { calls: { valueSchema: schema }, activities: { valueSchema: activitySchema } },
    })
    const calls = domain.table('calls')
    const activities = domain.table('activities')
    let queue = Promise.resolve()
    let storageFailed = false
    let lastPruned = 0
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
    const recordActivity = (key, value) => enqueue(async () => {
      await activities.put(key, value)
      if (value.at - lastPruned < 3_600_000) return
      lastPruned = value.at
      for (const [oldKey, row] of activities.entries()) {
        if (row.at < value.at - hours * 3_600_000) await activities.delete(oldKey)
      }
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
        const sessionId = exec.agent?.session?.id
        if (sessionId) void recordActivity(`${sessionId}:tool:${exec.callId}`, {
          sessionId: String(sessionId), at: Date.now(), toolCalls: 1,
          skillLoads: exec.name === 'skill' && !result.isError ? 1 : 0,
        })
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
      disposers.push(ctx.on('session/event', (session, event) => {
        if (event.type !== 'user/message' || event.data.source.kind !== 'skill-invocation') return
        void recordActivity(`${session.id}:skill:${event.seq}`, {
          sessionId: String(session.id), at: event.time, toolCalls: 0, skillLoads: 1,
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
            const allCalls = [...calls.entries()].map(([, row]) => row)
            const recent = allCalls.filter(row => row.startedAt >= since)
            const sessions = new Map(items.map(item => [String(item.sessionId), item]))
            const parent = items.filter(item => !item.parentSessionId && !item.blank)
            const activeParent = parent.filter(item => item.running)
            const activity = [...activities.entries()].map(([, row]) => row).filter(row => row.at >= since)
            const counts = ids => activity.reduce((sum, row) => {
              if (ids.has(row.sessionId)) {
                sum.toolCalls += row.toolCalls
                sum.skillLoads += row.skillLoads
              }
              return sum
            }, { toolCalls: 0, skillLoads: 0 })
            const roles = ROLES.map(([id, title]) => {
              const rows = recent.filter(row => row.role === id).sort((a, b) => b.startedAt - a.startedAt)
              const children = new Set(allCalls.filter(row => row.role === id && row.childSessionId).map(row => row.childSessionId))
              const active = rows.filter(row => row.status === 'running' && sessions.get(row.childSessionId)?.running).length
              const unknown = rows.filter(row => row.status === 'running' && !sessions.get(row.childSessionId)?.running).length
              return {
                id, title, state: active ? 'running' : unknown ? 'unknown' : 'idle',
                ...counts(children),
                active, completed: rows.filter(row => row.status === 'completed').length,
                failed: rows.filter(row => row.status === 'failed').length,
                noChild: rows.filter(row => row.status === 'no_child').length,
                unknown, recent: rows.slice(0, 5),
              }
            })
            return Response.json({
              windowHours: hours, asOf: Date.now(),
              parent: { state: activeParent.length ? 'running' : 'idle', active: activeParent.length,
                sessions: parent.length, recentSessionId: parent[0]?.sessionId ?? null,
                ...counts(new Set(parent.map(item => String(item.sessionId)))) },
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
