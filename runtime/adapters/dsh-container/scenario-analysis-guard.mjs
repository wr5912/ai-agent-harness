import { isAbsolute, relative, resolve, sep } from 'node:path'

export const name = 'scenario-analysis-guard'
export const inject = ['tools']

const ROOT = '/work/evaluation-run'
const ALLOWED = ['glob', 'grep', 'read']

function insideRun(value) {
  if (typeof value !== 'string' || value.trim() === '') return false
  const path = resolve(ROOT, value)
  const rel = relative(ROOT, path)
  return rel !== '' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export function apply(ctx) {
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ALLOWED })
  })
  ctx.tools.guard(exec => {
    const args = exec.arguments
    if (!ALLOWED.includes(exec.name) || !args || typeof args !== 'object' || Array.isArray(args)) {
      return '归因 Session 只允许使用只读证据工具'
    }
    if (exec.name === 'read' && !insideRun(args.file_path)) {
      return 'read 只能读取当前 Run 内的文件'
    }
    if ((exec.name === 'grep' || exec.name === 'glob')
      && args.path !== undefined && !insideRun(args.path)) {
      return `${exec.name} 只能检索当前 Run 内的路径`
    }
  })
}
