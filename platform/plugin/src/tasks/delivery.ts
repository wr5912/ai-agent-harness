import { execFile as execFileCallback } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { instanceStateRoot, programRoot, workspaceOwnsInstance } from '../workspace.ts'
import { dataPath, RUN, sha256, sourceInfo, candidateDigest } from './files.ts'
import { verifyInspectionReport } from './inspection-report.ts'
import { randomUUID } from 'node:crypto'
import { unzipSync, strFromU8 } from 'fflate'
import { runDeliverySession } from '../../../../runtime/adapters/dsh-container/dsh-eval-api.mjs'
import { workspaceLocalPath } from '../workspace.ts'
import { measureModelUsage } from '../evaluation/model-usage.ts'

const execFile = promisify(execFileCallback)
export interface TaskDeliveryInput {
  agent_id: string
  source: string
  run_id: string
  instance_name: string
  artifacts: (string | { path: string; sha256?: string })[]
  expected_device_ids?: string[]
  required_case_ids?: string[]
  required_tool_names?: string[]
  deadline_at?: string
}
interface DeliveryServices { instanceUrl?: () => Promise<string> }
export interface DeliveryCheck { name: string; ok: boolean; message: string }

function decodedObjects(value: unknown): Record<string, any>[] {
  if (typeof value === 'string') {
    try { return decodedObjects(JSON.parse(value)) } catch { return [] }
  }
  if (Array.isArray(value)) return value.flatMap(decodedObjects)
  if (!value || typeof value !== 'object') return []
  return [value as Record<string, any>, ...Object.values(value).flatMap(decodedObjects)]
}
function successfulTools(root: string, prefix: string, caseInfo: any, actualPath?: string) {
  const path = actualPath ?? dataPath(root, `${prefix}evidence/${caseInfo.case_id}/trace.jsonl`)
  if (!existsSync(path) || lstatSync(path).size > 10 * 1024 * 1024) return []
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const sessionLogs = new Set(rows.filter(row => (row.event ?? row).type === 'session' && (row.event ?? row).id === caseInfo.load_observation?.session_id).map(row => row.session_log ?? 'root'))
  const calls = new Map<string, { name: string; log: string }>()
  const results: { name: string; call_id: string; value: Record<string, any> }[] = []
  for (const row of rows) {
    const event = row.event ?? row, data = event.data ?? {}, log = row.session_log ?? 'root'
    if (!sessionLogs.has(log)) continue
    if (event.type === 'tool/call') calls.set(data.callId, { name: data.name, log })
    if (event.type === 'tool/result') {
      const message = data.message, id = message?.toolCallId ?? message?.source?.callId
      const call = calls.get(id)
      if (!call || call.log !== log || message.isError === true) continue
      const values = decodedObjects(message.content)
      for (const value of values.length ? values : [{}]) results.push({ name: call.name, call_id: id, value })
    }
  }
  return results
}

const runEvidenceScript = [
  'import json,sys', 'from pathlib import Path', 'sys.path.insert(0,sys.argv[1])',
  'from run_record import comparison_run_view,verify_run_source', 'from source_contract import resolve',
  'root=Path(sys.argv[2]); run=sys.argv[3]',
  'view=comparison_run_view(root,run)',
  'inputs=json.loads((root/view["source"]["inputs_lock_path"]).read_text())',
  'verification=verify_run_source(root,view["manifest"],inputs)',
  'contract=resolve(view["manifest"]["source_id"],repo=root)',
  'print(json.dumps({"manifest":view["manifest"],"summary":view["summary"],"verification":verification,"image":view["image"],"contract":{key:contract[key] for key in ("source_id","agent_id","image","workspace","presets","managed","preset_id")},"cases":[{"case_id":case["case_id"],"trials":[{"execution_status":row["execution_status"],"verdict":row["verdict"]} for row in case["trials"]],"load_observation":case["load_observation"],"trace_present":case["raw_evidence"]["trace.jsonl"]["present"],"contract_changed":case["contract_changed"]} for case in view["cases"]]}))',
].join('\n')

/** 成功由服务器回读封存 Run、真实容器及产物共同决定；不采纳请求中的完成自报。 */
export async function verifyTaskDelivery(root: string, input: TaskDeliveryInput, signal?: AbortSignal, services: DeliveryServices = {}) {
  if (!RUN.test(input.run_id ?? '') || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.instance_name ?? '')) throw new Error('Run 或实例身份无效')
  const info = sourceInfo(root, input.source)
  const initialCandidate = candidateDigest(info.candidate)
  if (info.agent_id !== input.agent_id) throw new Error('Agent 与来源身份不一致')
  const checks: DeliveryCheck[] = []
  const record = (name: string, ok: unknown, message: string) => checks.push({ name, ok: Boolean(ok), message })
  let run: any
  let businessCaseIds: string[] = []
  const artifactCases = new Map<string, string>()
  const businessTools: Array<ReturnType<typeof successfulTools>[number] & { case_id: string }> = []
  try {
    const result = await execFile(process.env.HARNESS_PYTHON || 'python3', ['-c', runEvidenceScript,
      join(programRoot(), 'runtime/adapters/dsh-container'), resolve(root), input.run_id], {
      cwd: root, env: { ...process.env, HARNESS_ASSET_ROOT: resolve(root), HARNESS_PROGRAM_ROOT: programRoot() },
      encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 30_000, signal,
    })
    run = JSON.parse(result.stdout)
    record('run_sealed', run.manifest.status === 'completed', 'Run 已封存且状态为 completed')
    record('run_source', run.manifest.source_id === info.source && run.manifest.agent_id === input.agent_id, 'Run 与本次交付的固定来源一致')
    record('candidate_unchanged', run.verification.status === 'matched', '当前 Candidate 与评测时冻结的资产一致')
    const required = input.required_case_ids?.length ? input.required_case_ids : run.cases.map((item: any) => item.case_id)
    const cases = required.map((id: string) => run.cases.find((item: any) => item.case_id === id))
    record('business_coverage', required.length && required.some((id: string) => !/IDENTITY|ROLE/i.test(id)), '至少覆盖一个业务 Case')
    record('business_results', cases.length && cases.every((item: any) => item?.trials?.length && item.contract_changed === false
      && item.trials.every((trial: any) => trial.execution_status === 'completed' && trial.verdict === 'passed'))
      && run.summary?.effective_verdict === 'passed', '固定验收项全部执行通过，且评判口径未变化')
    record('session_evidence', cases.length && cases.every((item: any) => item?.trace_present
      && item.load_observation?.session_id && item.load_observation.preset_matches === true && item.load_observation.workspace_matches === true), '业务 Session 有实际轨迹，Preset 和工作目录装载吻合')
    const requiredTools = input.required_tool_names ?? []
    if (input.expected_device_ids?.length) record('business_tools_declared', requiredTools.length > 0, '巡检交付要求固定业务工具，不能只根据回复中的设备列表判断完成')
    const prefix = `evolution/experiments/${info.id}/runs/${input.run_id}/`
    const indexPath = dataPath(root, prefix + 'artifacts/index.json')
    const indexBytes = existsSync(indexPath) ? readFileSync(indexPath) : undefined
    if (run.manifest.artifacts_sha256 && (!indexBytes || sha256(indexBytes) !== run.manifest.artifacts_sha256)) throw new Error('封存业务产物索引摘要不匹配')
    const index = indexBytes && run.manifest.artifacts_sha256 ? JSON.parse(indexBytes.toString('utf8')).artifacts ?? [] : []
    const linkedCases = (input.artifacts ?? []).map(ref => {
      const path = typeof ref === 'string' ? ref : ref.path
      const relative = path.startsWith(prefix) ? path.slice(prefix.length) : ''
      const entry = index.find((item: any) => item.path === relative)
      const evidenceCase = /^evidence\/([^/]+)\//.exec(entry?.source_evidence ?? '')?.[1]
      const pathCase = /^artifacts\/([^/]+)\//.exec(relative)?.[1]
      // 封存索引优先；旧版单 Case 产物没有分目录时，来源仍可唯一确定。
      const id = entry ? entry.case_id ?? evidenceCase : pathCase ?? (required.length === 1 ? required[0] : undefined)
      if (!id || !required.includes(id) || evidenceCase && evidenceCase !== id) return undefined
      artifactCases.set(path, id)
      return id
    })
    businessCaseIds = [...new Set(linkedCases.filter((id): id is string => Boolean(id)))]
    if (requiredTools.length) record('business_artifact_cases', linkedCases.length && linkedCases.every(Boolean), '业务产物可唯一关联到固定验收 Case；身份与摘要回归不要求调用业务工具')
    for (const item of cases.filter((item: any) => item && businessCaseIds.includes(item.case_id))) {
      const tools = successfulTools(root, `evolution/experiments/${info.id}/runs/${input.run_id}/`, item)
      businessTools.push(...tools.filter(tool => requiredTools.includes(tool.name)).map(tool => ({ ...tool, case_id: item.case_id })))
      if (requiredTools.length) record(`business_tools:${item.case_id}`, requiredTools.every(name => tools.some(tool => tool.name === name)), '固定 Case 的同一业务 Session 中存在实际业务工具调用及匹配成功回执')
    }
  } catch {
    signal?.throwIfAborted()
    record('run_evidence', false, 'Run 不存在、摘要不匹配或证据无法核验，请查看原始运行记录')
  }
  let instance: { name: string; source: string; state: string; port?: number; image_id?: string } | undefined
  try {
    const stateDirectory = join(instanceStateRoot(root), input.instance_name)
    const manifest = JSON.parse(readFileSync(join(stateDirectory, 'instance.json'), 'utf8'))
    if (!workspaceOwnsInstance(root, manifest)) throw new Error('实例不属于当前工作区')
    record('instance_source', manifest.source_id === info.source && manifest.agent_id === input.agent_id, '交付实例与 Agent、固定来源一致')
    const result = await execFile('docker', ['inspect', manifest.container_name || `${manifest.project}-dsh-1`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 15_000, signal })
    const observed = JSON.parse(result.stdout)[0]
    const labels = observed.Config?.Labels ?? {}
    const registration = labels['com.docker.compose.project.working_dir'] === stateDirectory
      && labels['com.docker.compose.project.config_files']?.split(',').includes(join(stateDirectory, 'compose.yaml'))
    record('instance_running', observed.State?.Running === true && registration, '实际容器正在运行，且来自当前实例登记')
    const imageResult = await execFile('docker', ['image', 'inspect', observed.Image], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 15_000, signal })
    const actualImage = JSON.parse(imageResult.stdout)[0]
    const expectedImage = run?.contract?.image
    const actualFingerprint = actualImage.Config?.Labels?.['org.ai-agent-harness.dsh.image-build-fingerprint']
    record('standard_image', expectedImage && observed.Image === manifest.image_id && observed.Image === run.image?.local_image_id
      && actualFingerprint === expectedImage.build_fingerprint && manifest.image_tag === expectedImage.local_image_tag,
    '当前容器、评测和标准 Runtime 镜像身份一致')
    const mountPaths: Record<string, string> = { workspace: '/work/harness/workspace', presets: '/opt/dsh-presets', managed: '/opt/dsh-managed' }
    record('actual_mounts', run && Object.entries(mountPaths).every(([key, destination]) => {
      const mount = observed.Mounts?.find((item: any) => item.Destination === destination)
      return mount?.Source === run.contract[key] && mount.RW === false
    }), '实际只读挂载与通过评测的 Candidate 一致')
    instance = { name: input.instance_name, source: manifest.source_id, state: observed.State?.Running ? 'running' : 'stopped', port: manifest.port, image_id: observed.Image }
  } catch {
    signal?.throwIfAborted()
    record('instance_evidence', false, '实例或实际容器无法核验')
  }
  const artifacts = []
  record('artifacts_declared', Array.isArray(input.artifacts) && input.artifacts.length > 0, '至少交付一份可读取业务产物')
  for (const item of Array.isArray(input.artifacts) ? input.artifacts : []) {
    const ref = typeof item === 'string' ? { path: item } : item
    try {
      // 只允许当前 Run 内产物，避免把其他任务或以前生成的报告作为本次交付。
      const prefix = `evolution/experiments/${info.id}/runs/${input.run_id}/`
      if (!ref.path.startsWith(prefix + 'artifacts/')) throw new Error('业务产物必须位于本次 Run 的 artifacts 目录')
      const path = dataPath(root, ref.path)
      const stat = lstatSync(path)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 10 * 1024 * 1024) throw new Error('产物必须是 10 MiB 以内的普通文件')
      const content = readFileSync(path)
      if (!content.length) throw new Error('产物为空')
      const digest = sha256(content)
      if (ref.sha256 && ref.sha256 !== digest) throw new Error('产物摘要不匹配')
      record(`artifact:${ref.path}`, true, '已回读本次 Run 的非空产物并计算摘要')
      if (input.required_tool_names?.length) record(`business_artifact:${ref.path}`, businessTools.some(tool => tool.case_id === artifactCases.get(ref.path) && tool.value.completed === true
        && typeof tool.value.markdown === 'string' && sha256(tool.value.markdown) === tool.value.report_sha256 && tool.value.report_sha256 === digest), '报告内容摘要与已声明业务工具的真实完成回执一致')
      let inspection
      if (input.expected_device_ids?.length) {
        const extension = extname(ref.path).toLowerCase()
        if (extension !== '.csv' && extension !== '.md') throw new Error('巡检报告必须为 CSV 或 Markdown')
        const text = content.toString('utf8').trim()
        const evidenceLinked = (run?.cases ?? []).some((item: any) => ['response.json', 'trace.jsonl'].some(name => {
          const evidence = dataPath(root, prefix + 'evidence/' + item.case_id + '/' + name)
          if (!existsSync(evidence) || lstatSync(evidence).size > 10 * 1024 * 1024) return false
          const raw = readFileSync(evidence, 'utf8')
          function contains(value: unknown): boolean {
            if (typeof value === 'string') { if (value.includes(text)) return true; try { return contains(JSON.parse(value)) } catch { return false } }
            if (Array.isArray(value)) return value.some(contains)
            return Boolean(value && typeof value === 'object' && Object.values(value).some(contains))
          }
          try { return name.endsWith('.jsonl') ? raw.split('\n').filter(Boolean).some(line => contains(JSON.parse(line))) : contains(JSON.parse(raw)) } catch { return false }
        }))
        record(`artifact_origin:${ref.path}`, evidenceLinked, '巡检报告正文可在本次业务 Session 的输出或工具轨迹中回读')
        inspection = verifyInspectionReport(content.toString('utf8'), extension === '.csv' ? 'csv' : 'markdown', { expected_device_ids: input.expected_device_ids })
        record(`inspection:${ref.path}`, inspection.ok, inspection.ok ? '设备集合、逐行状态及报告统计一致' : `报告校验失败：漏项 ${inspection.missing.length}，重复 ${inspection.duplicates.length}，异常 ${inspection.errors.length}`)
      }
      artifacts.push({ path: ref.path, run_path: ref.path.slice(prefix.length), sha256: digest, bytes: content.length, ...(inspection ? { inspection } : {}) })
    } catch {
      record(`artifact:${String(ref?.path ?? '')}`, false, '产物不可读取、来源不符或格式校验失败')
    }
  }
  let probe: Record<string, any> | undefined
  if (input.required_tool_names?.length && checks.every(check => check.ok)) {
    const id = randomUUID(), directory = workspaceLocalPath(root, 'delivery-probes', id)
    mkdirSync(directory, { recursive: true })
    probe = { id, path: directory, status: 'failed' }
    try {
      if (!services.instanceUrl || !instance?.port) throw new Error('缺少实际交付实例访问能力')
      const authUrl = await services.instanceUrl()
      const parsed = new URL(authUrl)
      if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || Number(parsed.port) !== instance.port) throw new Error('交付实例访问地址不匹配')
      const frozen = JSON.parse(readFileSync(dataPath(root, `evolution/experiments/${info.id}/runs/${input.run_id}/inputs.lock.json`), 'utf8'))
      const representative = frozen.evaluation_cases.find((item: any) => businessCaseIds.includes(item.case_id))
      if (!representative) throw new Error('冻结业务输入不存在')
      probe.case_id = representative.case_id
      const remaining = input.deadline_at ? Date.parse(input.deadline_at) - Date.now() : 120000
      if (remaining <= 0) throw new Error('任务总时限已耗尽')
      const timeout = Math.min(120000, remaining), timeoutSignal = AbortSignal.timeout(timeout)
      const probeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      const observed = await runDeliverySession({ auth_url: authUrl, workspace: '/work/harness/workspace', preset_id: run.contract.preset_id,
        timeout_ms: timeout, evidence_root: join(directory, 'evidence') }, representative, probeSignal, { unzipSync, strFromU8 })
      probe.session_id = observed.session_id
      probe.model_usage = measureModelUsage([{ path: join(directory, 'evidence', representative.case_id, 'trace.jsonl'), rows: observed.trace }])
      probe.case_id = representative.case_id
      const sessionCheck = observed.checks.completed && observed.checks.preset_matches && observed.checks.workspace_matches
      record('delivery_session', sessionCheck, '交付实例的新业务 Session 实际完成，Preset 与工作目录吻合')
      const tools = successfulTools(root, '', { case_id: representative.case_id, load_observation: { session_id: observed.session_id } }, join(directory, 'evidence', representative.case_id, 'trace.jsonl'))
      record('delivery_business_tools', input.required_tool_names.every(name => tools.some(tool => tool.name === name)), '交付实例实际成功调用约定业务工具')
      const report = tools.find(tool => input.required_tool_names!.includes(tool.name) && tool.value.completed === true && typeof tool.value.markdown === 'string'
        && sha256(tool.value.markdown) === tool.value.report_sha256)
      if (input.expected_device_ids?.length) {
        record('delivery_report', report && verifyInspectionReport(report.value.markdown, 'markdown', { expected_device_ids: input.expected_device_ids }).ok, '交付实例新报告的设备集合、状态及汇总完整一致')
        const downloaded = report && typeof report.value.download_url === 'string' ? await observed.download(report.value.download_url) : null
        record('delivery_download', downloaded && report && sha256(Buffer.from(downloaded)) === report.value.report_sha256, '从交付实例实际下载的新报告与该实例业务工具回执摘要一致')
        if (report) { writeFileSync(join(directory, 'report.md'), report.value.markdown); probe.report_sha256 = report.value.report_sha256 }
      }
      probe.status = checks.every(check => check.ok) ? 'completed' : 'failed'
    } catch {
      if (probe.case_id) {
        const tracePath = join(directory, 'evidence', probe.case_id, 'trace.jsonl')
        if (existsSync(tracePath)) try { probe.model_usage = measureModelUsage([{ path: tracePath, rows: readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) }]) } catch { /* 原始失败证据保留，统计不完备不当作零消耗。 */ }
      }
      record('delivery_probe', false, '交付实例代表业务未通过；已保留新 Session 或失败采集证据，评测实例产物不能代替交付实例验收')
    }
    writeFileSync(join(directory, 'probe.json'), JSON.stringify(probe, null, 2) + '\n')
  }
  record('delivery_candidate_unchanged', candidateDigest(info.candidate) === initialCandidate, '交付检查期间目标 Candidate 未发生并行变化')
  return { ready: checks.every(check => check.ok), checks, instance, artifacts, probe, run_id: input.run_id,
    note: '结论仅覆盖所选 Case、实际工具环境和已回读产物。模拟服务通过不代表真实业务上游已验收。' }
}
