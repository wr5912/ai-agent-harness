import { programRoot } from './workspace.ts'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export interface RecentRun {
  id: string
  agent_id: string
  experiment_id: string
  status: string | null
  created_at: string | null
  finished_at: string | null
  effective_verdict?: string | null
}

export async function recentRuns(root: string, agentIds: string[], signal: AbortSignal): Promise<RecentRun[]> {
  const rows = await Promise.all(agentIds.map(async agentId => {
    const { stdout } = await execute(process.env.HARNESS_PYTHON || 'python3', [join(programRoot(), 'runtime/adapters/dsh-container/run_record.py'),
      '--repo', root, 'index', '--agent', agentId], { signal, timeout: 15000, maxBuffer: 2 * 1024 * 1024 })
    const index = JSON.parse(stdout) as { experiments: { experiment_id: string; runs: {
      run_id: string; status: string | null; created_at: string | null; finished_at: string | null
    }[] }[] }
    return index.experiments.flatMap(experiment => experiment.runs.map(run => ({
      id: run.run_id, agent_id: agentId, experiment_id: experiment.experiment_id,
      status: run.status, created_at: run.created_at, finished_at: run.finished_at,
    })))
  }))
  const recent = rows.flat().sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '')).slice(0, 8)
  return Promise.all(recent.map(async run => {
    try {
      if (!/^run-[0-9a-f-]{36}$/.test(run.id)) return { ...run, effective_verdict: null }
      const summary = JSON.parse(await readFile(join(root, 'evolution/experiments', run.experiment_id, 'runs', run.id, 'summary.json'), 'utf8'))
      const verdict = summary.effective_verdict ?? summary.machine_overall_verdict
      return { ...run, effective_verdict: ['passed', 'failed', 'inconclusive'].includes(verdict) ? verdict : null }
    } catch { return { ...run, effective_verdict: null } }
  }))
}
