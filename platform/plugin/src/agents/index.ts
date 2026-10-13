import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  existsSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'

type JsonMap = Record<string, unknown>
type SourceCatalog = { schema_version?: string; sources?: Record<string, JsonMap> }
type RpcValue = JsonMap | JsonMap[] | string | number | boolean | null

const EXP_ID = /^EXP-([a-z0-9-]+)-(\d{3})(?:-[a-z0-9-]+)?$/
const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const AGENT_ID = /^[a-z0-9][a-z0-9-]*$/
const SOURCE_CATALOG = 'runtime/adapters/dsh-container/sources.json'
const DSH_EVAL = 'runtime/adapters/dsh-container/dsh-eval'
const RUN_RECORD = 'runtime/adapters/dsh-container/run_record.py'
const VALIDATE_EXPERIMENT = '.agents/skills/research-eval/scripts/validate_experiment.py'
const SOURCE_CONTRACT = 'runtime/adapters/dsh-container/source_contract.py'
const EVALUATION_CONTRACT = '.agents/skills/research-eval/scripts/evaluation_contract.py'
const LOG_LIMIT = 16 * 1024

class RpcError extends Error {
  constructor(readonly code: string, message: string, readonly details: JsonMap = {}) {
    super(message)
  }
}

function ok<T extends RpcValue>(value: T): ConnectionRpcResult<T> {
  return { ok: true, value }
}

function failure(error: unknown): ConnectionRpcResult<never> {
  if (error instanceof RpcError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
  const code = (error as NodeJS.ErrnoException).code ?? 'unknown'
  return { ok: false, error: { code: 'asset_operation_failed', message: '智能体资产操作失败', details: { filesystem_code: code } } }
}

function requireObject(payload: unknown): JsonMap {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RpcError('invalid_request', '请求参数必须是对象')
  return payload as JsonMap
}

function stringField(payload: JsonMap, name: string): string {
  const value = payload[name]
  if (typeof value !== 'string' || !value.trim()) throw new RpcError('invalid_request', `缺少 ${name}`)
  return value.trim()
}

function agentIdField(payload: JsonMap, name = 'agent_id'): string {
  const value = stringField(payload, name)
  if (!AGENT_ID.test(value)) throw new RpcError('invalid_request', `${name} 格式无效`, { [name]: value })
  return value
}

function experimentIdValue(value: string, name = 'experiment_id'): string {
  if (!EXP_ID.test(value)) throw new RpcError('invalid_request', `${name} 格式无效`, { [name]: value })
  return value
}

function experimentIdField(payload: JsonMap, name = 'experiment_id'): string {
  return experimentIdValue(stringField(payload, name), name)
}

function optionalString(payload: JsonMap, name: string): string | undefined {
  const value = payload[name]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new RpcError('invalid_request', `${name} 必须是字符串`)
  return value
}

function textField(payload: JsonMap, name: string): string {
  const value = payload[name]
  if (typeof value !== 'string') throw new RpcError('invalid_request', `${name} 必须是字符串`)
  return value
}

function rootOf(assetRoot: string): string {
  return realpathSync(resolve(assetRoot))
}

function repoPath(root: string, rel: string): string {
  if (rel.startsWith('/') || rel.split('/').includes('..')) throw new RpcError('path_rejected', '拒绝仓库外路径', { path: rel })
  return join(root, rel)
}

function repoRelative(root: string, file: string): string {
  const rel = relative(root, file)
  if (rel.startsWith('..') || rel === '' || rel.split(sep).includes('..')) throw new RpcError('path_rejected', '拒绝仓库外路径')
  return rel.split(sep).join('/')
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function readText(file: string, fallback = ''): string {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readText(file))
}

function parseJsonCommand(root: string, args: string[], message = '命令执行失败') {
  const run = spawnSync('python3', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (run.status !== 0) throw new RpcError('command_failed', message, { status: run.status, stderr: redact(run.stderr), stdout: redact(run.stdout) })
  try {
    return JSON.parse(run.stdout) as JsonMap
  } catch {
    throw new RpcError('command_failed', '命令没有返回合法 JSON', { stdout: redact(run.stdout), stderr: redact(run.stderr) })
  }
}

function readYamlMap(root: string, file: string): JsonMap {
  const code = [
    'import json, sys',
    'from pathlib import Path',
    'try:',
    '    import yaml',
    'except ImportError as exc:',
    '    raise SystemExit("缺少 PyYAML，无法读取 YAML") from exc',
    'path = Path(sys.argv[1])',
    'value = yaml.safe_load(path.read_text(encoding="utf-8"))',
    'if value is None:',
    '    value = {}',
    'if not isinstance(value, dict):',
    '    raise SystemExit("YAML 顶层必须是 object")',
    'print(json.dumps(value, ensure_ascii=False))',
  ].join('\n')
  return parseJsonCommand(root, ['-c', code, file], 'YAML 解析失败')
}

function writeYamlMap(file: string, values: JsonMap) {
  const lines = Object.entries(values).map(([key, value]) => `${key}: ${typeof value === 'string' ? JSON.stringify(value) : value ?? ''}`)
  writeFileSync(file, `${lines.join('\n')}\n`)
}

function redact(text: string, limit = 4000): string {
  return text
    .replace(/Bearer\s+[^\s"'&]+/gi, 'Bearer [REDACTED]')
    .replace(/("(?:api[_-]?key|token|password|secret)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/((?:api[_-]?key|token|password|secret)=)[^\s"'&]+/gi, '$1[REDACTED]')
    .slice(0, limit)
}

function catalog(root: string) {
  const file = repoPath(root, SOURCE_CATALOG)
  const text = readText(file)
  const parsed = JSON.parse(text) as SourceCatalog
  if (!parsed.sources || typeof parsed.sources !== 'object') throw new RpcError('asset_read_failed', 'sources.json 缺少 sources')
  return { file, text, parsed, hash: sha256(text) }
}

function atomicWrite(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomBytes(3).toString('hex')}.tmp`
  writeFileSync(tmp, body)
  renameSync(tmp, file)
}

function writeCatalog(root: string, parsed: SourceCatalog, expectedHash: string) {
  const current = catalog(root)
  if (current.hash !== expectedHash) throw new RpcError('conflict', 'sources.json 已被其他任务修改', { expected_sha256: expectedHash, actual_sha256: current.hash })
  const body = `${JSON.stringify(parsed, null, 2)}\n`
  atomicWrite(current.file, body)
  return sha256(body)
}

function listDirs(file: string): string[] {
  try {
    return readdirSync(file, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function listAgents(root: string) {
  return listDirs(join(root, 'agents')).filter(id => AGENT_ID.test(id)).map(id => {
    const manifest = readYamlMap(root, join(root, 'agents', id, 'manifest.yaml'))
    return { id, path: `agents/${id}`, manifest, active_experiment: manifest.active_experiment ?? null }
  })
}

function experimentInfo(root: string, id: string) {
  experimentIdValue(id)
  const base = join(root, 'evolution/experiments', id)
  const change = readYamlMap(root, join(base, 'change.yaml'))
  const agentId = typeof change.agent_id === 'string' ? change.agent_id : id.replace(EXP_ID, '$1')
  if (!AGENT_ID.test(agentId)) throw new RpcError('invalid_request', 'change.yaml agent_id 格式无效', { experiment_id: id, agent_id: agentId })
  return {
    id,
    path: `evolution/experiments/${id}`,
    agent_id: agentId,
    baseline_ref: change.baseline_ref ?? null,
    status: change.status ?? null,
    change,
  }
}

function listExperiments(root: string, agentId?: string) {
  return listDirs(join(root, 'evolution/experiments'))
    .filter(id => EXP_ID.test(id))
    .map(id => experimentInfo(root, id))
    .filter(item => !agentId || item.agent_id === agentId)
}

function listRuns(root: string, experimentId: string) {
  const base = join(root, 'evolution/experiments', experimentId, 'runs')
  return listDirs(base).filter(id => RUN_ID.test(id)).map(id => ({ id, path: `evolution/experiments/${experimentId}/runs/${id}` }))
}

function casesFromEvaluation(parsed: unknown) {
  const raw = parsed as { catalog?: JsonMap[]; cases?: Record<string, JsonMap>; case_ids?: string[] }
  const caseMap = raw.cases ?? {}
  return (raw.catalog ?? []).map(item => {
    const id = typeof item.case_id === 'string' ? item.case_id : ''
    const value = caseMap[id] ?? {}
    const inputs = Array.isArray(value.inputs) ? value.inputs.filter(input => typeof input === 'string') as string[] : []
    return {
      id,
      title: typeof value.title === 'string' ? value.title : '',
      scene: typeof item.scene === 'string' ? item.scene : '未分组',
      tier: item.fast === true ? 'fast' : 'full',
      has_input: inputs.length > 0,
      input_preview: inputs.join('\n').slice(0, 180),
    }
  })
}

function loadEvaluation(root: string, agentId: string) {
  const path = repoPath(root, `agents/${agentId}/evaluation.md`)
  const content = readText(path)
  const code = [
    'import json, sys',
    'from pathlib import Path',
    `sys.path.insert(0, ${JSON.stringify(join(root, dirname(EVALUATION_CONTRACT)))})`,
    'from evaluation_contract import load_evaluation',
    'print(json.dumps(load_evaluation(Path(sys.argv[1])), ensure_ascii=False))',
  ].join('\n')
  const parsed = parseJsonCommand(root, ['-c', code, path], 'evaluation.md 合同解析失败')
  return { path: `agents/${agentId}/evaluation.md`, content, sha256: sha256(content), parsed, cases: casesFromEvaluation(parsed as unknown as string) }
}

function featureList(root: string, experimentId: string) {
  const candidate = join(root, 'evolution/experiments', experimentId, 'candidate')
  const exists = (rel: string) => existsSync(join(candidate, rel))
  const managedRoot = join(candidate, 'dsh/managed')
  const managedEntries = (() => {
    try {
      return readdirSync(managedRoot, { withFileTypes: true }).map(entry => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        declared_only: true,
      })).sort((left, right) => left.name.localeCompare(right.name))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  })()
  return {
    candidate_root: `evolution/experiments/${experimentId}/candidate`,
    harness_yaml: exists('harness.yaml'),
    roles: listDirs(join(candidate, 'roles')),
    presets: listDirs(join(candidate, 'dsh/presets')),
    skills: listDirs(join(candidate, '.agents/skills')),
    managed_entries: managedEntries,
    plugins_note: '仅列出 candidate/dsh/managed 来源项；插件是否生效以 source_contract/Runtime 装载为准',
    mcp: exists('mcp.json') || exists('dsh/mcp.json'),
    model_markers: ['model', 'models', 'llm'].filter(name => exists(`${name}.yaml`) || exists(`${name}.json`)),
    runtime_markers: ['runtime', 'dsh'].filter(name => exists(name)),
  }
}

function declaredFusion(change: JsonMap) {
  const values = [change.fusion_sources, change.inherited_experiments, change.fused_experiments]
    .find(value => Array.isArray(value)) as unknown[] | undefined
  const experiments = (values ?? []).filter(value => typeof value === 'string' && EXP_ID.test(value)) as string[]
  return experiments.length ? { status: 'declared', experiments: [...new Set(experiments)].sort() } : { status: 'unknown', experiments: [] }
}

function relatedRefs(root: string, experimentId: string) {
  const files = ['hypothesis.md', 'decision.md', 'evaluation/observations.md']
  const refs = new Set<string>()
  for (const rel of files) {
    for (const match of readText(join(root, 'evolution/experiments', experimentId, rel)).matchAll(/EXP-[a-z0-9-]+-\d{3}(?:-[a-z0-9-]+)?/g)) {
      if (match[0] !== experimentId) refs.add(match[0])
    }
  }
  return [...refs].sort()
}

function sourceContract(root: string, experimentId: string) {
  try {
    return commandJson(root, [SOURCE_CONTRACT, '--source', `experiment:${experimentId}`])
  } catch (error) {
    return { status: 'unavailable', error: error instanceof RpcError ? error.code : 'asset_operation_failed' }
  }
}

function assertUniqueResolved(edits: { rel: string }[]) {
  const seen = new Set<string>()
  for (const edit of edits) {
    if (seen.has(edit.rel)) throw new RpcError('invalid_request', '同一次写入不能包含重复路径', { path: edit.rel })
    seen.add(edit.rel)
  }
}

function list(root: string) {
  const source = catalog(root)
  return ok({
    schema_version: '1.0',
    root,
    observed_at: new Date().toISOString(),
    agents: listAgents(root),
    experiments: listExperiments(root),
    releases: listDirs(join(root, 'releases')).map(id => ({ id, path: `releases/${id}` })),
    source_catalog: { path: SOURCE_CATALOG, schema_version: source.parsed.schema_version ?? null, sha256: source.hash, count: Object.keys(source.parsed.sources ?? {}).length },
  })
}

function detail(root: string, payload: JsonMap) {
  const agentId = agentIdField(payload)
  const manifest = readYamlMap(root, repoPath(root, `agents/${agentId}/manifest.yaml`))
  const rawExperimentId = optionalString(payload, 'experiment_id') ?? (typeof manifest.active_experiment === 'string' ? manifest.active_experiment : undefined)
  const experimentId = rawExperimentId ? experimentIdValue(rawExperimentId) : undefined
  if (!experimentId) throw new RpcError('invalid_request', '未指定 experiment_id，manifest 也没有 active_experiment')
  const exp = experimentInfo(root, experimentId)
  if (exp.agent_id !== agentId) throw new RpcError('invalid_request', 'Experiment 不属于该 Agent', { agent_id: agentId, experiment_id: experimentId })
  const source = catalog(root)
  const evaluation = loadEvaluation(root, agentId)
  const decision = readText(repoPath(root, `evolution/experiments/${experimentId}/decision.md`))
  return ok({
    agent: { id: agentId, manifest, path: `agents/${agentId}` },
    experiment: exp,
    versions: listExperiments(root, agentId).map(item => ({ id: item.id, status: item.status, baseline_ref: item.baseline_ref })),
    baseline: { ref: exp.baseline_ref, parent_experiment_id: exp.change.parent_experiment_id ?? null, source: exp.baseline_ref ? 'change.yaml' : 'unknown' },
    fusion: declaredFusion(exp.change),
    related_references: relatedRefs(root, experimentId),
    declared: { catalog_source: source.parsed.sources?.[experimentId] ?? null, source_contract: sourceContract(root, experimentId), source_catalog_sha256: source.hash },
    loaded_instance: { status: 'not_queried', note: '实际实例由平台实例模块统一观察。' },
    verification: { runs: listRuns(root, experimentId), note: 'Run 证据通过 runs/index 或 runs/show 查询原始记录' },
    features: featureList(root, experimentId),
    editable_files: editableFiles(root, experimentId),
    evaluation: { path: evaluation.path, sha256: evaluation.sha256, cases: evaluation.cases },
    decision: { path: `evolution/experiments/${experimentId}/decision.md`, sha256: sha256(decision), content: decision },
  })
}

function validateGitParent(root: string, agentId: string, parentRef: string, parentExperiment: string) {
  const commit = parentRef.slice('git:'.length)
  if (!/^[0-9a-f]{40}$/i.test(commit)) throw new RpcError('invalid_request', 'git 父版本必须是固定 40 位提交')
  const check = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, encoding: 'utf8' })
  if (check.status !== 0) throw new RpcError('invalid_request', '父提交不存在', { parent_ref: parentRef })
  const show = spawnSync('git', ['show', `${commit}:${SOURCE_CATALOG}`], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (show.status !== 0) throw new RpcError('invalid_request', '父提交缺少 sources.json', { parent_ref: parentRef, stderr: redact(show.stderr) })
  const parsed = JSON.parse(show.stdout) as SourceCatalog
  const source = parsed.sources?.[parentExperiment]
  if (!source) throw new RpcError('invalid_request', '父提交 sources.json 中没有该 Experiment', { parent_experiment_id: parentExperiment })
  if (source.agent_id !== agentId) throw new RpcError('invalid_request', '父 Experiment 与 Agent 不匹配', { agent_id: agentId, parent_experiment_id: parentExperiment })
  return { commit, source }
}

async function copyGitCandidate(root: string, commit: string, parentExperiment: string, targetExperimentRoot: string) {
  mkdirSync(targetExperimentRoot, { recursive: true })
  const archive = spawnSync('git', ['archive', '--format=tar', commit, `evolution/experiments/${parentExperiment}/candidate`], {
    cwd: root, encoding: 'buffer', maxBuffer: 100 * 1024 * 1024,
  })
  if (archive.status !== 0) throw new RpcError('invalid_request', '父提交缺少 Candidate', { parent_experiment_id: parentExperiment, stderr: redact(String(archive.stderr)) })
  const untar = spawnSync('tar', ['-x', '-C', targetExperimentRoot, '--strip-components=3'], { input: archive.stdout, encoding: 'utf8' })
  if (untar.status !== 0) throw new RpcError('asset_write_failed', '无法复制父 Candidate', { stderr: redact(untar.stderr) })
  if (!existsSync(join(targetExperimentRoot, 'candidate'))) throw new RpcError('asset_write_failed', '父 Candidate 复制结果缺失')
  for (const name of ['runs', 'history', 'RuntimeHOME', 'sessions', 'cache', '.git']) rmSync(join(targetExperimentRoot, 'candidate', name), { recursive: true, force: true })
}

async function createExperiment(root: string, payload: JsonMap) {
  const agentId = agentIdField(payload)
  const parentRef = stringField(payload, 'parent_ref')
  const currentCatalog = catalog(root)
  const manifest = readYamlMap(root, repoPath(root, `agents/${agentId}/manifest.yaml`))
  const defaultParent = typeof manifest.active_experiment === 'string' ? manifest.active_experiment : undefined
  const rawParentExperiment = optionalString(payload, 'parent_experiment_id') ?? defaultParent
  const parentExperiment = rawParentExperiment ? experimentIdValue(rawParentExperiment, 'parent_experiment_id') : undefined
  if (!parentExperiment) throw new RpcError('invalid_request', '缺少 parent_experiment_id')
  const nextNumber = Math.max(0, ...listExperiments(root, agentId).map(item => Number(EXP_ID.exec(item.id)?.[2] ?? 0))) + 1
  let experimentId = ''
  do {
    experimentId = `EXP-${agentId}-${String(nextNumber).padStart(3, '0')}-r${randomBytes(6).toString('hex')}`
  } while (existsSync(join(root, 'evolution/experiments', experimentId)) || currentCatalog.parsed.sources?.[experimentId])

  const experimentRoot = repoPath(root, `evolution/experiments/${experimentId}`)
  let parentSource: JsonMap
  let wroteCatalogHash = ''
  try {
    mkdirSync(experimentRoot, { recursive: true })
    if (parentRef.startsWith('git:')) {
      const parent = validateGitParent(root, agentId, parentRef, parentExperiment)
      parentSource = parent.source
      await copyGitCandidate(root, parent.commit, parentExperiment, experimentRoot)
    } else if (parentRef.startsWith('release:')) {
      throw new RpcError('unsupported_parent', 'Release 来源尚未接入现有不可变 Release 装载格式')
    } else {
      throw new RpcError('invalid_request', 'parent_ref 只支持 git:<commit> 或 release:<id>')
    }
    const researchQuestion = optionalString(payload, 'research_question')
    if (!researchQuestion) throw new RpcError('invalid_request', '缺少真实用户研究问题')
    writeYamlMap(join(experimentRoot, 'change.yaml'), {
      schema_version: '1.0',
      experiment_id: experimentId,
      agent_id: agentId,
      baseline_ref: parentRef,
      parent_experiment_id: parentExperiment,
      status: 'active',
    })
    writeFileSync(join(experimentRoot, 'hypothesis.md'), `# ${experimentId}\n\n父版本：${parentRef}\n\n父 Experiment：${parentExperiment}\n\n研究问题：${researchQuestion}\n`)
    mkdirSync(join(experimentRoot, 'evaluation'), { recursive: true })
    writeFileSync(join(experimentRoot, 'evaluation/observations.md'), `# Evaluation Observations\n\n尚未执行评测。\n`)
    writeFileSync(join(experimentRoot, 'decision.md'), `# Decision\n\n状态：inconclusive\n\n尚未完成评测，不声明采纳。\n`)
    const nextCatalog = JSON.parse(JSON.stringify(currentCatalog.parsed)) as SourceCatalog
    nextCatalog.sources ??= {}
    nextCatalog.sources[experimentId] = {
      ...parentSource,
      agent_id: agentId,
      candidate_root: `evolution/experiments/${experimentId}/candidate/dsh`,
    }
    wroteCatalogHash = writeCatalog(root, nextCatalog, optionalString(payload, 'catalog_sha256') ?? currentCatalog.hash)
    const validation = commandJson(root, [VALIDATE_EXPERIMENT, `evolution/experiments/${experimentId}`])
    commandJson(root, [SOURCE_CONTRACT, '--source', `experiment:${experimentId}`])
    const dryRun = commandJson(root, [DSH_EVAL, '--source', `experiment:${experimentId}`, '--mode', 'fast', '--executor', 'api', '--review', 'none', '--dry-run'])
    return ok({ experiment_id: experimentId, path: `evolution/experiments/${experimentId}`, source_catalog_sha256: catalog(root).hash, validation, dry_run: dryRun })
  } catch (error) {
    if (wroteCatalogHash) {
      try {
        const current = catalog(root)
        if (current.hash === wroteCatalogHash) {
          atomicWrite(current.file, currentCatalog.text)
          rmSync(experimentRoot, { recursive: true, force: true })
        } else if (current.parsed.sources?.[experimentId]) {
          throw new RpcError('needs_recovery', '创建校验失败且 sources.json 已被其他任务修改，保留本次 Experiment 目录避免删除仍被 catalog 引用的 Candidate', {
            experiment_id: experimentId,
            original_error: error instanceof RpcError ? error.code : 'asset_operation_failed',
          })
        } else {
          rmSync(experimentRoot, { recursive: true, force: true })
        }
      } catch (recoveryError) {
        if (recoveryError instanceof RpcError && recoveryError.code === 'needs_recovery') throw recoveryError
        throw new RpcError('needs_recovery', '创建校验失败且 catalog 恢复状态不确定，请人工核对 sources.json 与 Experiment 目录', {
          experiment_id: experimentId,
          original_error: error instanceof RpcError ? error.code : 'asset_operation_failed',
        })
      }
    } else {
      rmSync(experimentRoot, { recursive: true, force: true })
    }
    throw error
  }
}

function editableFiles(root: string, experimentId: string) {
  const exp = experimentInfo(root, experimentId)
  const files = [
    `evolution/experiments/${experimentId}/candidate/harness.yaml`,
    `agents/${exp.agent_id}/evaluation.md`,
    `evolution/experiments/${experimentId}/decision.md`,
  ]
  for (const role of listDirs(join(root, 'evolution/experiments', experimentId, 'candidate/roles'))) {
    files.push(`evolution/experiments/${experimentId}/candidate/roles/${role}/AGENTS.md`)
  }
  return files.filter((rel, index, all) => all.indexOf(rel) === index && existsSync(repoPath(root, rel)))
}

function assertNoSymlinkPath(root: string, target: string) {
  const rel = relative(root, target)
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part)
    if (!existsSync(cursor)) break
    if (lstatSync(cursor).isSymbolicLink()) throw new RpcError('path_rejected', '拒绝访问符号链接路径', { path: repoRelative(root, cursor) })
  }
}

function editablePath(root: string, payload: JsonMap, relPath: string) {
  const experimentId = experimentIdField(payload)
  const exp = experimentInfo(root, experimentId)
  const agentId = exp.agent_id
  let rel = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel === 'evaluation.md') rel = `agents/${agentId}/evaluation.md`
  if (rel === 'decision.md') rel = `evolution/experiments/${experimentId}/decision.md`
  if (rel.startsWith('candidate/')) rel = `evolution/experiments/${experimentId}/${rel}`
  if (!rel.startsWith('evolution/') && !rel.startsWith('agents/')) rel = `evolution/experiments/${experimentId}/candidate/${rel}`
  const parts = rel.split('/')
  if (parts.some(part => ['runs', 'history', 'RuntimeHOME', 'sessions', 'cache', '.git'].includes(part)) || parts.some(part => part.endsWith('.llm-api-key'))) {
    throw new RpcError('path_rejected', 'Run、历史、缓存、Session、RuntimeHOME、Git 和 LLM API Key 不可编辑', { path: rel })
  }
  const allowed = rel.startsWith(`evolution/experiments/${experimentId}/candidate/`) ||
    rel === `evolution/experiments/${experimentId}/decision.md` ||
    rel === `agents/${agentId}/evaluation.md`
  if (!allowed) throw new RpcError('path_rejected', '路径不在可编辑范围内', { path: rel })
  const file = repoPath(root, rel)
  assertNoSymlinkPath(root, dirname(file))
  if (existsSync(file)) assertNoSymlinkPath(root, file)
  return { file, rel, agentId }
}

function simpleDiff(pathName: string, before: string, after: string) {
  if (before === after) return ''
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1
  return [`--- ${pathName}`, `+++ ${pathName}`, '@@',
    ...a.slice(prefix, a.length - suffix).map(line => `-${line}`),
    ...b.slice(prefix, b.length - suffix).map(line => `+${line}`),
  ].join('\n')
}

function edits(payload: JsonMap) {
  const raw = payload.edits
  if (!Array.isArray(raw) || raw.length === 0) throw new RpcError('invalid_request', '缺少 edits')
  const seen = new Set<string>()
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new RpcError('invalid_request', `edits[${index}] 必须是对象`)
    const row = item as JsonMap
    const path = stringField(row, 'path')
    const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (seen.has(normalized)) throw new RpcError('invalid_request', '同一次写入不能包含重复路径', { path })
    seen.add(normalized)
    return { path, content: textField(row, 'content'), expected: optionalString(row, 'expected_sha256') }
  })
}

function rejectsLlmApiKey(pathName: string, content: string) {
  if (pathName.endsWith('.llm-api-key')) return true
  return /(?:DEEPSEEK_API_KEY|OPENAI_API_KEY|LOCAL_LLM_API_KEY|LLM_API_KEY|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+/i.test(content)
}

function readEditable(root: string, payload: JsonMap) {
  const path = optionalString(payload, 'path')
  if (!path) return ok({ files: editableFiles(root, experimentIdField(payload)) })
  const target = editablePath(root, payload, path)
  const content = readText(target.file)
  return ok({ path: target.rel, content, sha256: sha256(content) })
}

function previewEdit(root: string, payload: JsonMap) {
  const raw = edits(payload)
  const targets = raw.map(edit => ({ edit, target: editablePath(root, payload, edit.path) }))
  assertUniqueResolved(targets.map(item => item.target))
  const result = targets.map(({ edit, target }) => {
    const before = readText(target.file)
    if (edit.expected && sha256(before) !== edit.expected) throw new RpcError('conflict', '文件已被修改', { path: target.rel, expected_sha256: edit.expected, actual_sha256: sha256(before) })
    if (rejectsLlmApiKey(target.rel, edit.content)) throw new RpcError('secret_rejected', '拒绝写入 LLM API Key')
    if (target.rel.endsWith('/evaluation.md')) loadEvaluationPreview(root, edit.content)
    return { path: target.rel, before_sha256: sha256(before), after_sha256: sha256(edit.content), changed: before !== edit.content, diff: simpleDiff(target.rel, before, edit.content) }
  })
  return ok({ edits: result })
}

function loadEvaluationPreview(root: string, content: string) {
  const code = [
    'import json, sys, tempfile',
    'from pathlib import Path',
    `sys.path.insert(0, ${JSON.stringify(join(root, dirname(EVALUATION_CONTRACT)))})`,
    'from evaluation_contract import load_evaluation',
    'with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".md", delete=False) as handle:',
    '    handle.write(sys.stdin.read())',
    '    name = handle.name',
    'try:',
    '    print(json.dumps(load_evaluation(Path(name)), ensure_ascii=False))',
    'finally:',
    '    Path(name).unlink(missing_ok=True)',
  ].join('\n')
  const run = spawnSync('python3', ['-c', code], { cwd: root, input: content, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  if (run.status !== 0) throw new RpcError('invalid_request', 'evaluation.md 合同无效', { stderr: redact(run.stderr) })
  return JSON.parse(run.stdout) as JsonMap
}

function applyEdit(root: string, payload: JsonMap) {
  const resolved = edits(payload).map(edit => {
    const target = editablePath(root, payload, edit.path)
    const before = readText(target.file)
    if (!edit.expected) throw new RpcError('invalid_request', '写入必须提供 expected_sha256', { path: target.rel })
    if (sha256(before) !== edit.expected) throw new RpcError('conflict', '文件已被修改', { path: target.rel, expected_sha256: edit.expected, actual_sha256: sha256(before) })
    if (rejectsLlmApiKey(target.rel, edit.content)) throw new RpcError('secret_rejected', '拒绝写入 LLM API Key')
    if (target.rel.endsWith('/evaluation.md')) loadEvaluationPreview(root, edit.content)
    return { ...target, content: edit.content, expected: edit.expected }
  })
  assertUniqueResolved(resolved)
  for (const item of resolved) {
    const before = readText(item.file)
    if (!item.expected || sha256(before) !== item.expected) throw new RpcError('conflict', '文件已被修改', { path: item.rel, expected_sha256: item.expected, actual_sha256: sha256(before) })
    atomicWrite(item.file, item.content)
  }
  return ok({ written: resolved.map(item => ({ path: item.rel, sha256: sha256(item.content) })) })
}

function cases(root: string, payload: JsonMap) {
  const agentId = agentIdField(payload)
  const evaluation = loadEvaluation(root, agentId)
  return ok({ path: evaluation.path, sha256: evaluation.sha256, cases: evaluation.cases })
}

function evalArgs(payload: JsonMap, dryRun: boolean) {
  const source = stringField(payload, 'source')
  if (source.startsWith('experiment:')) experimentIdValue(source.slice('experiment:'.length), 'source')
  const args = [DSH_EVAL, '--source', source, '--mode', optionalString(payload, 'mode') ?? 'fast', '--executor', optionalString(payload, 'executor') ?? 'api', '--review', optionalString(payload, 'review') ?? 'none']
  const cases = payload.cases
  if (Array.isArray(cases)) for (const item of cases) if (typeof item === 'string' && item) args.push('--case', item)
  const model = optionalString(payload, 'model')
  const compareTo = optionalString(payload, 'compare_to')
  if (model) args.push('--model', model)
  if (compareTo) args.push('--compare-to', compareTo)
  if (dryRun) args.push('--dry-run')
  return args
}

function commandJson(root: string, args: string[]) {
  return parseJsonCommand(root, args)
}

function evalPreview(root: string, payload: JsonMap) {
  return ok({ command: ['python3', ...evalArgs(payload, true)], result: commandJson(root, evalArgs(payload, true)) as JsonMap })
}

type Job = { status: 'running' | 'completed' | 'failed' | 'cancelled'; started_at: string; updated_at: string; stdout: string; stderr: string; process?: ReturnType<typeof spawn>; result?: unknown; exit_code?: number | null; error?: string }

function appendLog(current: string, chunk: unknown) {
  return (current + String(chunk)).slice(-LOG_LIMIT)
}

function startEval(root: string, payload: JsonMap, jobs: Map<string, Job>) {
  const jobId = randomUUID()
  const args = evalArgs(payload, false)
  const proc = spawn('python3', args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const job: Job = { status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString(), stdout: '', stderr: '', process: proc }
  jobs.set(jobId, job)
  proc.stdout.setEncoding('utf8')
  proc.stderr.setEncoding('utf8')
  proc.stdout.on('data', chunk => { job.stdout = appendLog(job.stdout, chunk); job.updated_at = new Date().toISOString() })
  proc.stderr.on('data', chunk => { job.stderr = appendLog(job.stderr, chunk); job.updated_at = new Date().toISOString() })
  proc.on('error', error => {
    job.status = 'failed'
    job.error = redact(error.message)
    job.updated_at = new Date().toISOString()
    delete job.process
  })
  proc.on('close', code => {
    if (job.status === 'failed' && job.error) return
    job.exit_code = code
    job.updated_at = new Date().toISOString()
    job.status = code === 0 ? 'completed' : job.status === 'cancelled' ? 'cancelled' : 'failed'
    try { job.result = JSON.parse(redact(job.stdout)) } catch { job.result = null }
    delete job.process
  })
  return ok({ job_id: jobId, status: job.status, started_at: job.started_at })
}

function jobStatus(payload: JsonMap, jobs: Map<string, Job>) {
  const job = jobs.get(stringField(payload, 'job_id'))
  if (!job) throw new RpcError('not_found', '评测任务不存在')
  return ok({ ...job, process: undefined, stdout: redact(job.stdout), stderr: redact(job.stderr), log_note: 'stdout/stderr 为截断显示；事实记录以封存 Run 为准' })
}

function cancelJob(payload: JsonMap, jobs: Map<string, Job>) {
  const job = jobs.get(stringField(payload, 'job_id'))
  if (!job) throw new RpcError('not_found', '评测任务不存在')
  if (job.process) {
    job.status = 'cancelled'
    job.updated_at = new Date().toISOString()
    job.process.kill('SIGTERM')
  }
  return ok({ status: job.status })
}

function runRecord(root: string, op: 'index' | 'show' | 'compare', payload: JsonMap) {
  const args = [RUN_RECORD, '--repo', root, op]
  if (op === 'index') args.push('--agent', agentIdField(payload))
  if (op === 'show') {
    assertRunFiles(root, stringField(payload, 'run_id'))
    args.push('--run', stringField(payload, 'run_id'))
    const caseId = optionalString(payload, 'case_id')
    if (caseId) args.push('--case', caseId)
  }
  if (op === 'compare') {
    assertRunFiles(root, stringField(payload, 'left'))
    assertRunFiles(root, stringField(payload, 'right'))
    args.push('--left', stringField(payload, 'left'), '--right', stringField(payload, 'right'))
    const caseId = optionalString(payload, 'case_id')
    if (caseId) args.push('--case', caseId)
  }
  return ok(JSON.parse(redact(JSON.stringify(commandJson(root, args)), Infinity)) as JsonMap)
}

function assertRunFiles(root: string, runId: string) {
  if (!RUN_ID.test(runId)) throw new RpcError('invalid_request', 'run_id 必须是 run-<UUIDv4>')
  const experiments = join(root, 'evolution/experiments')
  function visit(path: string) {
    if (lstatSync(path).isSymbolicLink()) throw new RpcError('path_rejected', 'Run 不得通过符号链接读取外部文件')
    if (lstatSync(path).isDirectory()) for (const entry of readdirSync(path)) visit(join(path, entry))
  }
  for (const id of listDirs(experiments)) {
    const path = join(experiments, id, 'runs', runId)
    if (existsSync(path)) { assertNoSymlinkPath(root, path); visit(path) }
  }
}

function readRunEvidence(root: string, payload: JsonMap) {
  const filename = stringField(payload, 'filename')
  const caseId = stringField(payload, 'case_id')
  const view = runRecord(root, 'show', payload)
  if (!view.ok) return view
  const cases = view.value.cases as JsonMap[]
  const selected = cases.find(item => item.case_id === caseId)
  const entry = (selected?.raw_evidence as Record<string, { path: string; present: boolean }> | undefined)?.[filename]
  if (!entry?.present) throw new RpcError('not_found', '该 Run/Case 没有此轨迹或证据文件')
  const file = repoPath(root, entry.path)
  assertNoSymlinkPath(root, file)
  const limit = 64 * 1024
  const buffer = Buffer.alloc(limit + 1)
  const fd = openSync(file, 'r')
  let size: number
  try { size = readSync(fd, buffer, 0, buffer.length, 0) } finally { closeSync(fd) }
  // shortcut: 轨迹只展示前 64 KiB；日常使用需要完整浏览时再增加分页读取。
  return ok({ path: entry.path, content: redact(buffer.subarray(0, Math.min(size, limit)).toString('utf8'), Infinity), truncated: size > limit })
}

function decisionUpdate(root: string, payload: JsonMap) {
  const result = applyEdit(root, {
    experiment_id: experimentIdField(payload),
    edits: [{ path: 'decision.md', content: textField(payload, 'content'), expected_sha256: stringField(payload, 'expected_sha256') }],
  })
  const written = result.ok ? result.value.written?.[0] : null
  return ok({ path: written?.path ?? '', sha256: written?.sha256 ?? '' })
}

export function createAgentsHandler(assetRoot: string): ConnectionRpcHandler {
  const root = rootOf(assetRoot)
  const jobs = new Map<string, Job>()
  return async (endpoint, payload, signal) => {
    if (signal.aborted) return failure(new RpcError('aborted', '智能体操作已取消'))
    try {
      const body = payload === undefined ? {} : requireObject(payload)
      switch (endpoint) {
        case 'list': return list(root)
        case 'detail': return detail(root, body)
        case 'create': return await createExperiment(root, body)
        case 'edit/read': return readEditable(root, body)
        case 'edit/preview': return previewEdit(root, body)
        case 'edit/apply': return await applyEdit(root, body)
        case 'cases/list': return cases(root, body)
        case 'eval/preview': return evalPreview(root, body)
        case 'eval/start': return startEval(root, body, jobs)
        case 'eval/status': return jobStatus(body, jobs)
        case 'eval/cancel': return cancelJob(body, jobs)
        case 'runs/index': return runRecord(root, 'index', body)
        case 'runs/show': return runRecord(root, 'show', body)
        case 'runs/evidence': return readRunEvidence(root, body)
        case 'runs/compare': return runRecord(root, 'compare', body)
        case 'decision/update': return await decisionUpdate(root, body)
        default: return failure(new RpcError('not_found', '未知的智能体操作', { endpoint }))
      }
    } catch (error) {
      return failure(error)
    }
  }
}
