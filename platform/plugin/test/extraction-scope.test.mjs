import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
// 使用平台已锁定 Controller 依赖树中的真实 SDK，不依赖机器的全局安装位置。
const sdkRequire = createRequire(require.resolve('@deepseek-ai/dsh-api-session-controller'))
const sdk = async name => import(pathToFileURL(sdkRequire.resolve(name)).href)
const [{ Context }, { SystemPrompt }, { ToolRuntime }, { createScope }] = await Promise.all([
  sdk('@deepseek-ai/cordis'), sdk('@deepseek-ai/dsh-system-prompt'), sdk('@deepseek-ai/dsh-tools'), sdk('@deepseek-ai/dsh-scope'),
])
const built = mkdtempSync(join(tmpdir(), 'extraction-scope-build-'))
await build({ entryPoints: [new URL('../src/assistant/extraction-scope.ts', import.meta.url).pathname], outfile: join(built, 'scope.mjs'), bundle: true, platform: 'node', format: 'esm' })
const { createExtractionScope, createComputeVariantScope, isDecisionExtraction, isComputeVariantResearch, createFeatureScope, isFeatureOrganization, createTaskBuilderScope } = await import(pathToFileURL(join(built, 'scope.mjs')).href)
test.after(() => rm(built, { recursive: true, force: true }))

function fixture(t, { parentPtc = false, computeResearch = false, featureOrganization = false, taskBuilding = false } = {}) {
  const ctx = new Context()
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx, { mode: 'native' })
  const calls = []
  const definition = name => ({
    name, description: '受控基本数据能力', parameters: { type: 'object', additionalProperties: true },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(arguments_) { calls.push({ name, arguments: arguments_ }); return { basic: true } },
  })
  for (const name of ['skill', 'platform_agents', ...(taskBuilding ? ['platform_task', 'platform_instances', 'platform_mcp'] : computeResearch ? ['platform_task'] : []), 'bash', 'read', 'write', 'spawn_agent', 'run_in_background']) ctx.tools.register(definition(name))
  const parentKey = { id: 'preset' }
  const parent = parentPtc ? createScope(ctx, parentKey) : null
  if (parent) parent.ctx.tools.presentAs('ptc')
  const agent = { id: 'extraction-agent', session: {} }
  const agentScope = createScope(ctx, agent, parent ? { parent: parentKey } : undefined)
  agent.ctx = agentScope.ctx
  const root = mkdtempSync(join(tmpdir(), 'builder-skills-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['task-builder', 'research-eval', 'harness-evolution', 'harness-guided-workflow', 'legacy-asset-intake']) {
    mkdirSync(join(root, '.agents/skills', name), { recursive: true })
    writeFileSync(join(root, '.agents/skills', name, 'SKILL.md'), '业务技能')
  }
  writeFileSync(join(root, 'workspace.json'), JSON.stringify({ schemaVersion: 1, id: 'workspace-test', extensions: [{ id: 'business', path: 'extensions/business' }] }))
  for (const extension of ['business', 'undeclared']) {
    mkdirSync(join(root, `extensions/${extension}/skills/${extension}-tool`), { recursive: true })
    writeFileSync(join(root, `extensions/${extension}/skills/${extension}-tool/SKILL.md`), '声明扩展技能')
  }
  const skills = { async get(name) { return { name, path: ['business-tool', 'undeclared-tool'].includes(name) ? join(root, `extensions/${name.replace('-tool', '')}/skills/${name}/SKILL.md`) : join(root, '.agents/skills', name, 'SKILL.md'), content: '业务技能' } } }
  const scope = taskBuilding ? createTaskBuilderScope(root, skills) : featureOrganization ? createFeatureScope() : computeResearch ? createComputeVariantScope() : createExtractionScope()
  const other = { id: 'other-agent', session: {} }
  const otherScope = createScope(ctx, other)
  other.ctx = otherScope.ctx
  const execute = (name, arguments_ = {}, target = agent) => ctx.tools.execute({ name, arguments: arguments_, callId: `call-${name}-${calls.length}`, agent: target, signal: new AbortController().signal })
  const schemas = async target => (await ctx.systemPrompt.assemble({ scope: target, agent: target })).tools.map(tool => tool.name).sort()
  t.after(async () => { scope.dispose(); await agentScope.dispose(); await otherScope.dispose(); if (parent) await parent.dispose(); await ctx.fiber.dispose() })
  return { ctx, agent, agentScope, scope, calls, definition, execute, schemas, other }
}

test('真实 SDK 的 schema 与执行共同过滤，重复应用不叠加，其他 Session 不受影响', async t => {
  const f = fixture(t)
  assert.ok((await f.schemas(f.agent)).includes('bash'))
  f.scope.apply(f.agent)
  assert.doesNotThrow(() => f.scope.apply(f.agent), '重复注册 presentAs 会被 Runtime 拒绝，因此这里直接验证幂等性')
  assert.deepEqual(await f.schemas(f.agent), ['platform_agents', 'skill'])
  assert.ok((await f.schemas(f.other)).includes('bash'))
  assert.equal((await f.execute('bash', { command: '本测试不执行 shell' })).isError, true)
  assert.equal((await f.execute('spawn_agent')).isError, true)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.execute('platform_agents', { action: 'datasets/source' })).isError, false)
  assert.deepEqual(f.calls.map(call => call.name), ['platform_agents'])
  f.scope.release(f.agent)
  assert.ok((await f.schemas(f.agent)).includes('bash'))
  assert.equal((await f.execute('bash')).isError, false)
})

test('guard 使用原生 execution.arguments，指定技能通过，其他技能与自己 scope 的工具均拒绝', async t => {
  const f = fixture(t)
  f.scope.apply(f.agent)
  assert.equal((await f.execute('skill', { name: 'decision-sample-extraction' })).isError, false)
  assert.equal((await f.execute('skill', { name: 'other-skill' })).isError, true)
  assert.equal((await f.execute('skill')).isError, true)
  f.agent.ctx.tools.register(f.definition('own_local'))
  assert.ok(f.ctx.tools.get('own_local', f.agent), 'Runtime 自身 scope 工具不受 restrict 隐藏，必须用 guard 拒绝')
  const rejected = await f.execute('own_local')
  assert.equal(rejected.isError, true)
  assert.match(JSON.stringify(rejected.content), /决策样本任务/)
  assert.deepEqual(f.calls.map(call => call.name), ['skill'])
})

test('强制 native 表达移除祖先的 run_code 传输，解除后恢复祖先表达', async t => {
  const f = fixture(t, { parentPtc: true })
  assert.ok(f.ctx.tools.get('run_code', f.agent))
  f.scope.apply(f.agent)
  assert.deepEqual(await f.schemas(f.agent), ['platform_agents', 'skill'])
  assert.equal(f.ctx.tools.get('run_code', f.agent), undefined)
  assert.equal((await f.execute('run_code', { description: '基础测试', code: 'return {}' })).isError, true)
  assert.equal(f.calls.length, 0)
  f.scope.release(f.agent)
  assert.ok(f.ctx.tools.get('run_code', f.agent))
})

test('release 和 dispose 复原能力，作用域销毁后再次清理安全', async t => {
  const f = fixture(t)
  f.scope.apply(f.agent)
  f.scope.apply(f.other)
  f.scope.release(f.agent)
  f.scope.release(f.agent)
  assert.ok((await f.schemas(f.agent)).includes('bash'))
  assert.deepEqual(await f.schemas(f.other), ['platform_agents', 'skill'])
  f.scope.apply(f.agent)
  f.scope.dispose()
  f.scope.dispose()
  assert.ok((await f.schemas(f.agent)).includes('bash'))
  assert.ok((await f.schemas(f.other)).includes('bash'))
  f.scope.apply(f.agent)
  await f.agentScope.dispose()
  assert.doesNotThrow(() => f.scope.release(f.agent))
})

test('初始化中途失败会撤销已经安装的限制，不遗留不可恢复的半个 scope', async t => {
  const f = fixture(t)
  f.agent.ctx.tools.presentAs('native')
  assert.throws(() => f.scope.apply(f.agent), /conflicts/)
  assert.ok(f.ctx.tools.get('bash', f.agent), 'presentAs 冲突前创建的 restrict 必须回滚')
  assert.equal((await f.execute('bash')).isError, false)
})

test('继承抽取上下文到其他工作区不限制工具，当前项目的普通会话保持原能力', async t => {
  const f = fixture(t)
  const state = { task_context: { skill: 'decision-sample-extraction' } }
  f.agent.session.header = { cwd: '/another-project' }
  if (isDecisionExtraction('/project', f.agent, state)) f.scope.apply(f.agent)
  assert.ok((await f.schemas(f.agent)).includes('bash'))
  assert.equal((await f.execute('bash')).isError, false)
  f.agent.session.header.cwd = '/project'
  assert.equal(isDecisionExtraction('/project', f.agent, { task_context: {} }), false)
  if (isDecisionExtraction('/project', f.agent, state)) f.scope.apply(f.agent)
  assert.deepEqual(await f.schemas(f.agent), ['platform_agents', 'skill'])
})

test('算力研究真实原生作用域阻止 shell、读写及其他技能，保留平台动作与普通会话', async t => {
  const f = fixture(t, { computeResearch: true })
  f.agent.session.header = { cwd: '/project' }
  const state = { task_context: { skill: 'compute-variant-research' } }
  assert.equal(isComputeVariantResearch('/other', f.agent, state), false)
  assert.equal(isComputeVariantResearch('/project', f.agent, { task_context: {} }), false)
  assert.equal(isComputeVariantResearch('/project', f.agent, state), true)
  f.scope.apply(f.agent)
  assert.deepEqual(await f.schemas(f.agent), ['platform_agents', 'platform_task', 'skill'])
  for (const name of ['bash', 'read', 'write', 'spawn_agent']) assert.equal((await f.execute(name, { command: '此测试命令不得执行' })).isError, true)
  assert.equal((await f.execute('skill', { name: 'workspace-management' })).isError, true)
  assert.equal((await f.execute('skill', { name: 'compute-variant-research' })).isError, false)
  assert.equal((await f.execute('platform_agents', { action: 'compute-variants/preview' })).isError, false)
  assert.equal((await f.execute('platform_task', { action: 'status' })).isError, false)
  assert.deepEqual(f.calls.map(call => call.name), ['skill', 'platform_agents', 'platform_task'])
  assert.ok((await f.schemas(f.other)).includes('bash'))
  assert.equal((await f.execute('bash', {}, f.other)).isError, false)
})


test('特性整理工具范围精确绑定 workflow，普通维护会话保持原能力', async t => {
  const f = fixture(t, { featureOrganization: true })
  f.agent.session.header = { cwd: '/project' }
  const state = { task_context: { skill: 'agent-maintenance', workflow: 'features' } }
  assert.equal(isFeatureOrganization('/project', f.agent, state), true)
  assert.equal(isFeatureOrganization('/elsewhere', f.agent, state), false)
  assert.equal(isFeatureOrganization('/project', f.agent, { task_context: { skill: 'agent-maintenance', workflow: 'research' } }), false)
  f.scope.apply(f.agent)
  assert.deepEqual(await f.schemas(f.agent), ['platform_agents', 'skill'])
  for (const name of ['bash', 'read', 'write']) assert.equal((await f.execute(name, { command: '不得执行的测试命令' })).isError, true)
  assert.equal((await f.execute('skill', { name: 'agent-maintenance' })).isError, false)
  assert.equal((await f.execute('platform_agents', { action: 'features/read-source' })).isError, false)
  assert.equal((await f.execute('skill', { name: 'compute-variant-research' })).isError, true)
  assert.ok((await f.schemas(f.other)).includes('bash'))
})

test('构建任务使用真实工具作用域阻止shell或子智能体绕过限额，保留平台工具及受信任技能', async t => {
  const f = fixture(t, { taskBuilding: true, parentPtc: true })
  f.scope.apply(f.agent)
  assert.deepEqual(await f.schemas(f.agent), ['platform_agents', 'platform_instances', 'platform_mcp', 'platform_task', 'skill'])
  for (const name of ['task-builder', 'research-eval', 'harness-evolution', 'harness-guided-workflow', 'legacy-asset-intake']) assert.equal((await f.execute('skill', { name })).isError, false)
  assert.equal((await f.execute('skill', { name: 'business-tool' })).isError, false)
  assert.equal((await f.execute('skill', { name: 'undeclared-tool' })).isError, true)
  assert.equal((await f.execute('skill', { name: 'untrusted-skill' })).isError, true)
  assert.equal((await f.execute('platform_task', { action: 'status' })).isError, false)
  for (const name of ['bash', 'spawn_agent', 'run_in_background', 'run_code']) assert.equal((await f.execute(name)).isError, true)
  assert.ok((await f.schemas(f.other)).includes('bash'))
})
