/**
 * Thin trusted bridge to the DSH native question surface.
 * Domain runtimes remain responsible for draft validation and execution authority.
 */

function questionSpec(spec) {
  if (!spec || typeof spec.id !== 'string' || !spec.id ||
      typeof spec.confirmLabel !== 'string' || !spec.confirmLabel ||
      typeof spec.cancelLabel !== 'string' || !spec.cancelLabel) {
    throw new Error('invalid native operation question specification')
  }
  return spec
}

export function nativeOperationQuestion(specification) {
  const spec = questionSpec(specification)
  return {
    questions: [{
      id: spec.id,
      header: spec.header,
      question: spec.question,
      ...spec.detail !== undefined ? { detail: spec.detail } : {},
      options: [
        { label: spec.confirmLabel, description: spec.confirmDescription },
        { label: spec.cancelLabel, description: spec.cancelDescription },
      ],
      multiSelect: false,
    }],
  }
}

/** Free text always wins and can never be execution authority. */
export function nativeOperationDecision(answer, specification) {
  const spec = questionSpec(specification)
  const item = answer?.answers?.find(candidate => candidate?.id === spec.id)
  const custom = typeof item?.custom === 'string' ? item.custom.trim() : ''
  if (custom) return { kind: 'custom', text: custom }
  if (Array.isArray(item?.selected) && item.selected.length === 1) {
    if (item.selected[0] === spec.confirmLabel) return { kind: 'confirm' }
    if (item.selected[0] === spec.cancelLabel) return { kind: 'cancel' }
  }
  return { kind: 'skip' }
}

/** Ask through DSH itself; unavailable providers preserve the existing text fallback. */
export async function askNativeOperationQuestion(ctx, exec, specification) {
  let answer
  try {
    answer = await ctx.userQuestions.ask({
      ...nativeOperationQuestion(specification), agent: exec.agent, signal: exec.signal,
    })
  } catch (error) {
    if (error?.code !== 'ASK_ABORTED') {
      ctx.logger?.warn?.(`native ${specification.domain ?? 'operation'} question unavailable: ${error?.message ?? String(error)}`)
      return { available: false, answer: null, decision: null }
    }
    answer = { answers: [{ id: specification.id, selected: [] }] }
  }
  return {
    available: true,
    answer,
    decision: nativeOperationDecision(answer, specification),
  }
}
