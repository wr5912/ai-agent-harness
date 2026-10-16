import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { observeLlm, type ModelAttempt } from '../evaluation/model-attempts.ts'
import { compileSequence } from './graph.ts'
import { registerFixedCompositionTools, withFixedCompositionExecution, type FixedCompositionBinding } from './fixed-composition.ts'
import { runtimeModule, runtimeRequire } from '../../../../runtime/adapters/dsh-web/src/resolve-runtime.ts'

export { Annotation, END, START, StateGraph }
export { fixedCompositionToolName, type FixedCompositionBinding } from './fixed-composition.ts'
declare const __WORKFLOW_BUILD_DIGEST__: string
declare const __WORKFLOW_SOURCE_DIGEST__: string
// 在模块装载时固定，后续宿主重建同路径不改写本进程实际装载的身份。
const loadedEsmSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex')
// 与真实工具执行器使用同一无损 JSON 校验，不用 stringify 静默删除业务字段。
const toolsManifest = '/opt/dsh/packages/core/tools/package.json'
const { snapshotJsonValue } = await runtimeModule('@deepseek-ai/dsh-util-values', existsSync(toolsManifest) ? toolsManifest
  : runtimeRequire('@deepseek-ai/dsh-api-session-controller').resolve('@deepseek-ai/dsh-api-session-controller'))

export interface WorkflowContext {
  input: Record<string, any>
  signal: AbortSignal
  executionId: string
  trace: Record<string, any>[]
  callTool(name: string, args: Record<string, any>): Promise<any>
  infer(config: Record<string, any>, input: { system?: string; messages: any[] }): Promise<{ content: string }>
}
export interface WorkflowDefinition {
  id: string
  toolName: string
  description: string
  inputSchema: Record<string, any>
  fixedCompositions?: Record<string, FixedCompositionBinding>
  run(context: WorkflowContext): Promise<any>
}
export function defineWorkflow<T extends WorkflowDefinition>(definition: T): T { return definition }

/** 顺序节点共用 LangGraph；业务条件和参数来源留在业务源码。 */
export async function runWorkflow(context: WorkflowContext, steps: { id: string; run(values: Record<string, any>, context: WorkflowContext): Promise<any> }[]) {
  if (!steps.length || new Set(steps.map(step => step.id)).size !== steps.length) throw new Error('工作流节点不能为空或重名')
  const State = Annotation.Root({ values: Annotation<Record<string, any>>() })
  const graph = compileSequence(State, steps.map(step => ({ id: step.id, run: async (state: typeof State.State) => {
    context.signal.throwIfAborted()
    const started = Date.now()
    try {
      const result = await step.run(state.values, context)
      context.trace.push({ node: step.id, status: 'completed', elapsed_ms: Date.now() - started })
      return { values: { ...state.values, [step.id]: result } }
    } catch (error) {
      context.trace.push({ node: step.id, status: context.signal.aborted ? 'cancelled' : 'failed', elapsed_ms: Date.now() - started })
      throw error
    }
  } })))
  const result = await graph.invoke({ values: {} }, { signal: context.signal })
  return result.values as Record<string, any>
}

/** 通过原生工具管线执行子调用，保留调用身份、取消和真实回执。 */
export function registerWorkflowTool(ctx: any, definition: WorkflowDefinition) {
  const aliases = registerFixedCompositionTools(ctx, definition.fixedCompositions ?? {})
  return ctx.tools.register({
    name: definition.toolName, description: definition.description, parameters: definition.inputSchema,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args: any, value: any) => [{ type: 'text', text: JSON.stringify(value) }],
      presentationMeta: (_args: any, value: any) => ({ graph_execution: value.graph_execution }),
    },
    isConcurrencySafe: () => false,
    async execute(input: Record<string, any>, exec: any) {
      const executionId = `workflow-${randomUUID()}`, trace: Record<string, any>[] = [], attempts: ModelAttempt[] = []
      const identity = { execution_id: executionId, role: 'target' as const,
        ...(exec.agent?.session?.id ? { session_id: exec.agent.session.id } : {}), ...(exec.callId ? { tool_call_id: exec.callId } : {}),
        ...(exec.parent_run_id ? { parent_run_id: exec.parent_run_id } : {}), ...(exec.case_id ? { case_id: exec.case_id } : {}) }
      const observed = ctx.llm ? observeLlm(ctx.llm, identity, (event: ModelAttempt) => {
        attempts.push(Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined)) as ModelAttempt)
      }) : null
      const context: WorkflowContext = {
        input, signal: exec.signal, executionId, trace,
        async callTool(name, args) {
          exec.signal.throwIfAborted()
          const callId = `${exec.callId}:workflow:${trace.length}:${randomUUID()}`
          const started = Date.now()
          const result = await withFixedCompositionExecution(identity, () => ctx.tools.execute({ name: aliases.get(name) ?? name,
            arguments: args, callId, rootCallId: exec.rootCallId ?? exec.callId, parent: exec.token, agent: exec.agent, signal: exec.signal }))
          const failed = result.isError || result.value?.isError === true
          trace.push({ node: name, call_id: callId, arguments: args, status: failed ? 'failed' : 'completed',
            elapsed_ms: Date.now() - started, result: result.isError ? {
              ...(result.error !== undefined ? { error: result.error } : {}), ...(result.content !== undefined ? { content: result.content } : {}),
            } : result.value,
            ...(result.meta ? { meta: result.meta } : {}) })
          if (result.additionalContexts?.length && exec.deferContext) for (const value of result.additionalContexts) exec.deferContext(value)
          if (failed) throw new Error(`工作流工具失败：${name}`)
          return result.value
        },
        async infer(config, payload) {
          if (!observed) throw new Error('工作流模型服务未装载')
          const prepared = await observed.prepareCall(config, exec.signal)
          let content = '', completed = false
          for await (const chunk of prepared.stream({ ...prepared.config, ...payload, signal: exec.signal })) {
            if (chunk.type === 'text-delta') content += chunk.text
            if (chunk.type === 'finish') { if (chunk.reason?.kind !== 'stop') throw new Error('工作流模型响应未完成'); completed = true }
          }
          if (!completed) throw new Error('工作流模型响应未完成')
          return { content }
        },
      }
      let result: any, failure: string | undefined, errorCode: string | undefined
      try {
        result = snapshotJsonValue(await definition.run(context))
        if (result === undefined) {
          failure = '工作流返回值不是无损 JSON；请修复业务源码中的 undefined 或其他非 JSON 值'
          errorCode = 'WORKFLOW_INVALID_RESULT'
        }
      } catch { failure = exec.signal.aborted ? '工作流已取消' : '工作流执行失败，请查看节点回执' }
      const graph_execution = { ...identity, workflow_id: definition.id, complete: true,
        ...(typeof __WORKFLOW_BUILD_DIGEST__ === 'string' ? { build_digest: __WORKFLOW_BUILD_DIGEST__, source_digest: __WORKFLOW_SOURCE_DIGEST__ } : {}),
        esm_sha256: loadedEsmSha256,
        status: failure ? exec.signal.aborted ? 'cancelled' : 'failed' : 'completed', trace, model_attempts: attempts }
      // 失败也返回完整结构化证据；上层必须检查 ok，不能用工具文字流畅代替成功。
      return { ok: !failure, ...(failure ? { error: failure, ...(errorCode ? { error_code: errorCode } : {}) } : { result }), graph_execution }
    },
  })
}
