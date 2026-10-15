export type ThreatStage = 'collect' | 'infer' | 'writeback' | 'report'
export type ThreatPhaseStatus = 'completed' | 'failed' | 'unknown' | 'skipped'
export type ThreatModelRoute = { provider: string; model: string; reasoningEffort?: string }
export type ThreatBindings = { socConnectionId: string; reportConnectionId: string; model?: ThreatModelRoute }
export type ThreatArtifact = { id: string; name: string; content_type: string; bytes: number }
export type ThreatTrace = { stage: ThreatStage; status: ThreatPhaseStatus | 'running'; started_at: string; finished_at?: string; error_type?: string }
export type ThreatResult = Record<string, any> & {
  run_id: string; incident_id: string; status: string; phase_status: ThreatPhaseStatus
  artifacts: ThreatArtifact[]; trace: ThreatTrace[]
}
export interface ThreatServices {
  connectionFingerprint(connectionId: string): string | Promise<string>
  invoke(connectionId: string, toolName: string, args: Record<string, any>, signal: AbortSignal, expectedFingerprint?: string): Promise<any>
  inferFrozen(payload: Record<string, any>, route: ThreatModelRoute | undefined, signal: AbortSignal): Promise<any>
  resolveModel?(route?: ThreatModelRoute): ThreatModelRoute | Promise<ThreatModelRoute>
}
export type ThreatRuntimeOptions = { stateRoot?: string; python?: string }
export interface ThreatRuntime {
  execute(stage: ThreatStage, bindings: ThreatBindings, input: Record<string, any>, signal: AbortSignal): Promise<ThreatResult>
  inspect(runId: string): Promise<ThreatResult>
  artifact(runId: string, artifactId: string): Promise<{ filename: string; contentType: string; body: string }>
}
