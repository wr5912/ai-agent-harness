export const name = 'evaluation-judge-guard'
export const inject = ['tools']

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: [] })
  })
}
