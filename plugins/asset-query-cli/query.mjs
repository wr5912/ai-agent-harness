import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'harness-asset-query'
export const inject = ['cmdlineArgs']

const AGENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EXPERIMENT_ID = /^EXP-[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{3,}$/

function directoryNames(path, pattern) {
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return entries.filter(entry => entry.isDirectory() && pattern.test(entry.name))
    .map(entry => entry.name).sort()
}

export function inventory(assetRoot) {
  if (!statSync(assetRoot).isDirectory()) throw new Error('资产根路径不是目录')
  return {
    schema_version: '1.0',
    agents: directoryNames(join(assetRoot, 'agents'), AGENT_ID),
    experiments: directoryNames(join(assetRoot, 'evolution', 'experiments'), EXPERIMENT_ID),
  }
}

export function run(args, assetRoot) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    return { exitCode: 0, stream: 'stdout', output: '用法：dsh --profile asset-query-cli inventory\n查询只读 Agent 与 Experiment 目录；输出 JSON。\n' }
  }
  if (args.length !== 1 || args[0] !== 'inventory') {
    return { exitCode: 2, stream: 'stderr', output: '参数错误：仅支持 inventory 或 --help\n' }
  }
  if (!assetRoot) {
    return { exitCode: 1, stream: 'stderr', output: '未设置 HARNESS_ASSET_ROOT\n' }
  }
  try {
    return { exitCode: 0, stream: 'stdout', output: `${JSON.stringify(inventory(assetRoot))}\n` }
  } catch (error) {
    return { exitCode: 1, stream: 'stderr', output: `资产查询失败：${error?.code ?? error?.name ?? 'unknown'}\n` }
  }
}

export function apply(ctx) {
  const args = ctx.get('cmdlineArgs')
  const exit = ctx.get('appExit')
  if (!args || !exit) throw new Error('DSH 启动器未提供命令行和退出服务')
  const result = run(args.get(), process.env.HARNESS_ASSET_ROOT)
  process[result.stream].write(result.output)
  exit(result.exitCode)
}
