export const name = 'evaluation-judge-guard'
export const inject = ['tools']

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: [] })
    agent.ctx.tools.guard(() => '评审 Session 禁止调用工具')
    agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => ({
      ...await next(),
      tools: [],
    }))
  })
}
