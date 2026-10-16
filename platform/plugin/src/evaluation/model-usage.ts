type Event = { type: string; seq?: number; data?: Record<string, any>; [key: string]: any }
type Role = 'target' | 'judge' | 'analysis'
export type UsageTrace = { path: string; rows: { session_log?: string; event?: Event }[] }
type Session = { id: string; seeded: boolean; role: Role; events: Map<number, Event> }

/** 基于锁定 DSH 的持久请求尝试结算计数；不把配置头、Step 或 Token 样本推成请求。 */
export function measureModelUsage(files: UsageTrace[]) {
  const sessions = new Map<string, Session>()
  const unknown = new Set<string>()
  const byRole: Record<Role, number> = { target: 0, judge: 0, analysis: 0 }
  let failed = 0, tokensKnown = true
  const tokens = { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
  for (const file of files) {
    if (!file.rows.length) unknown.add('session-trace-empty')
    const logs = new Map<string, UsageTrace['rows']>()
    for (const row of file.rows) {
      if (typeof row.session_log !== 'string' || !row.event) { unknown.add('trace-envelope-missing'); continue }
      const rows = logs.get(row.session_log) ?? []
      rows.push(row); logs.set(row.session_log, rows)
    }
    for (const rows of logs.values()) {
      const header = rows.find(row => row.event?.type === 'session')?.event
      if (typeof header?.id !== 'string') { unknown.add('session-header-missing'); continue }
      const session = sessions.get(header.id) ?? { id: header.id, seeded: header.isSeeded === true,
        role: file.path.includes('/analysis/') ? 'analysis' : file.path.endsWith('/judge-trace.jsonl') ? 'judge' : 'target', events: new Map<number, Event>() }
      for (const row of rows) {
        const event = row.event!
        if (event.type === 'session') continue
        if (!Number.isSafeInteger(event.seq) || event.seq! < 0) { unknown.add('session-event-sequence-missing'); continue }
        const previous = session.events.get(event.seq!)
        if (previous && JSON.stringify(previous) !== JSON.stringify(event)) unknown.add('session-event-conflict')
        session.events.set(event.seq!, event)
      }
      sessions.set(header.id, session)
    }
  }
  function count(session: Session, event: Event) {
    byRole[session.role]++
    if (event.type === 'assistant/attempt' || event.data?.interrupted === true) failed++
    const sample = event.data?.usage ?? [...(event.data?.stream ?? [])].reverse().find(item => item?.chunk?.type === 'usage')?.chunk?.usage
    if (!sample || !['inputTokens', 'outputTokens', 'totalTokens'].every(key => Number.isSafeInteger(sample[key]) && sample[key] >= 0)) {
      tokensKnown = false; return
    }
    const prompt = sample.totalTokens - sample.outputTokens
    if (prompt < sample.inputTokens) { tokensKnown = false; return }
    tokens.input_tokens += prompt
    tokens.output_tokens += sample.outputTokens
    tokens.total_tokens += sample.totalTokens
  }
  for (const session of sessions.values()) {
    const all = [...session.events].sort(([a], [b]) => a - b).map(([, event]) => event)
    const marker = all.find(event => event.type === 'session/end-seed' && event.data?.inherited === true)
    if (session.seeded && !marker) { unknown.add('seed-boundary-missing'); continue }
    const events = marker ? all.filter(event => event.seq! > marker.seq!) : all
    let previousSeq = marker?.seq ?? -1
    let turn: number | undefined
    let step: { turn: number; step: number; state: 'open' | 'message' | 'attempt' | 'retry' } | undefined
    const compacting = new Map<string, boolean>()
    for (const event of events) {
      if (event.seq !== previousSeq + 1) unknown.add('session-events-incomplete')
      previousSeq = event.seq!
      const data = event.data ?? {}
      if (event.type === 'turn/start') {
        if (turn !== undefined || step) unknown.add('turn-boundary-invalid')
        turn = data.turn
      } else if (event.type === 'step/start') {
        if (step || turn !== data.turn) unknown.add('step-boundary-invalid')
        step = { turn: data.turn, step: data.step, state: 'open' }
      } else if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
        if (!step || step.turn !== data.turn || step.step !== data.step || step.state !== 'open') unknown.add('attempt-boundary-invalid')
        else {
          count(session, event)
          step.state = event.type === 'assistant/message' ? 'message' : 'attempt'
        }
      } else if (event.type === 'llm/retry') {
        if (!step || step.turn !== data.turn || step.step !== data.step || step.state !== 'attempt') unknown.add('retry-boundary-invalid')
        else step.state = 'retry'
      } else if (event.type === 'llm/retry-started') {
        if (!step || step.turn !== data.turn || step.step !== data.step || step.state !== 'retry') unknown.add('retry-boundary-invalid')
        else step.state = 'open'
      } else if (event.type === 'step/end') {
        if (!step || step.turn !== data.turn || step.step !== data.step || step.state === 'open') unknown.add('attempt-settlement-missing')
        step = undefined
      } else if (event.type === 'turn/end') {
        if (turn !== data.turn || step) unknown.add('turn-boundary-invalid')
        turn = undefined
      } else if (event.type === 'compaction/start') compacting.set(data.compactionId, false)
      else if (event.type === 'compaction/summary') {
        if (data.llmStreamCall === true) {
          count(session, event)
          if (!compacting.has(data.compactionId)) unknown.add('compaction-boundary-missing')
          compacting.set(data.compactionId, true)
        } else unknown.add('compaction-request-count-unknown')
      } else if (event.type === 'compaction/end') {
        if (!compacting.get(data.compactionId) || data.error !== undefined) unknown.add('compaction-request-count-unknown')
        compacting.delete(data.compactionId)
      }
    }
    if (step || turn !== undefined || compacting.size) unknown.add('request-lifecycle-in-progress')
  }
  if (!files.length || !sessions.size) unknown.add('session-trace-missing')
  const observed = byRole.target + byRole.judge + byRole.analysis
  return { actual_model_calls: unknown.size ? null : observed, observed_model_calls: observed,
    failed_model_calls: failed, model_calls_by_role: byRole, model_calls_complete: unknown.size === 0,
    model_calls_basis: '锁定 DSH 的 assistant/message、assistant/attempt、retry 生命周期及 llmStreamCall 压缩标记；按 Session ID 与 seq 去重。',
    model_calls_unknown_reasons: [...unknown], token_usage: tokensKnown && observed > 0 ? tokens : null,
    hard_cap_supported: false }
}
