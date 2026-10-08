#!/usr/bin/env node
/** 最小研究入口：来源、编辑、运行与比较均复用现有仓库合同。 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const adapter = dirname(new URL(import.meta.url).pathname);
const repo = resolve(adapter, '../../..');
const args = process.argv.slice(2);
const command = args.shift();
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`缺少 ${name}`);
  return args[i + 1];
};
const values = (name: string) => args.flatMap((arg, i) => arg === name && args[i + 1] ? [args[i + 1]] : []);
const has = (name: string) => args.includes(name);
const run = (program: string, params: string[], inherit = false) => {
  const result = spawnSync(program, params, {
    cwd: repo, encoding: 'utf8', stdio: inherit ? 'inherit' : 'pipe', maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} 退出码 ${result.status}: ${(result.stderr || '').trim().slice(-500)}`);
  return result.stdout || '';
};
const json = (program: string, params: string[]) => JSON.parse(run(program, params));
const source = () => option('--source');
const contract = (id: string) => json('python3', [join(adapter, 'source_contract.py'), '--source', id]);
const record = (...params: string[]) => json('python3', [join(adapter, 'run_record.py'), '--repo', repo, ...params]);
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const print = (item: unknown) => process.stdout.write(JSON.stringify(item, null, 2) + '\n');
const instancesFor = (c: any) => {
  const entries = json(join(adapter, 'dsh-dev'), ['ps', '--all']).instances as any[];
  return entries.filter(item => item.source_id === c.source_id).map(item => {
    const { name, state, source_id, target_preset, session_preset, container_name, needs_migration } = item;
    if (state !== 'running' || !container_name) return { name, state, source_id, target_preset, session_preset, needs_migration };
    const imageId = run('docker', ['inspect', '--format', '{{.Image}}', container_name]).trim();
    const expectedImageId = run('docker', ['image', 'inspect', '--format', '{{.Id}}', c.image.local_image_tag]).trim();
    const mounts = json('docker', ['inspect', '--format', '{{json .Mounts}}', container_name]) as Array<{Source: string; Destination: string; RW: boolean}>;
    const expected = [[c.workspace, '/work/harness/workspace'], [c.presets, '/opt/dsh-presets'],
      [c.managed, '/opt/dsh-managed']];
    return { name, state, source_id, target_preset, session_preset, needs_migration,
      image_id: imageId, image_matches: imageId === expectedImageId,
      mounts_match: expected.every(([host, target]) => mounts.some(m => m.Source === host && m.Destination === target && !m.RW)),
    };
  });
};

try {
  if (command === 'context') {
    const c = contract(source());
    const index = record('index', '--agent', c.agent_id);
    const experiment = index.experiments.find((item: any) => item.experiment_id === c.experiment_id);
    const decision = join(c.experiment_root, 'decision.md');
    print({
      source_id: c.source_id, agent_id: c.agent_id, experiment_id: c.experiment_id,
      candidate: relative(repo, c.candidate_root), evaluation: index.evaluation_path,
      git_commit: run('git', ['rev-parse', 'HEAD']).trim(),
      git_dirty: Boolean(run('git', ['status', '--porcelain']).trim()),
      image: c.image, status: experiment?.status, runs: experiment?.runs || [],
      decision: existsSync(decision) ? readFileSync(decision, 'utf8') : null,
      instances: instancesFor(c),
      selected_run: has('--run') ? record('show', '--run', option('--run'),
        ...(has('--case') ? ['--case', option('--case')] : [])) : null,
    });
  } else if (command === 'edit') {
    const c = contract(source());
    const root = realpathSync(join(c.experiment_root, 'candidate'));
    const target = realpathSync(resolve(root, option('--file')));
    if (!target.startsWith(root + sep)) throw new Error('只能编辑所选 Experiment 的 candidate/ 文件');
    const before = digest(target);
    const editor = has('--editor') ? option('--editor') : process.env.EDITOR || 'vi';
    run(editor, [target], true);
    const after = digest(target);
    print({ source_id: c.source_id, file: relative(repo, target), before_sha256: before,
      after_sha256: after, changed: before !== after,
      diff: run('git', ['diff', '--', target]) });
  } else if (command === 'run') {
    const id = source();
    const cases = values('--case');
    if (!cases.length) throw new Error('至少选择一个 --case');
    const params = [join(adapter, 'dsh-eval'), '--source', id,
      ...cases.flatMap(item => ['--case', item]), '--review', has('--review') ? option('--review') : 'ai',
      ...(has('--model') ? ['--model', option('--model')] : []),
      ...(has('--compare-to') ? ['--compare-to', option('--compare-to')] : []),
      ...(has('--dry-run') ? ['--dry-run'] : [])];
    const result = spawnSync('python3', params, {cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    const payload = JSON.parse(result.stdout || '{}');
    if (payload.run_id) {
      const view = record('show', '--run', payload.run_id);
      payload.case_status = view.cases.map((item: any) => ({case_id: item.case_id,
        trials: item.trials.map((row: any) => ({status: row.execution_status, verdict: row.verdict,
          failure_reason: row.failure_reason || null})), review: item.review?.reviewed_verdict || null,
        registered_tools: item.registered_tools, tool_calls: item.tool_calls, evidence: item.evidence}));
    }
    print(payload);
    process.exitCode = result.status || 0;
  } else if (command === 'review') {
    print(record('compare', '--left', option('--left'), '--right', option('--right')));
  } else if (command === 'instance') {
    const c = contract(source());
    if (has('--restart')) {
      if (!instancesFor(c).some(item => item.name === option('--name')))
        throw new Error('只能重启所选来源的已有实例');
      run(join(adapter, 'dsh-dev'), ['up', '--source', c.source_id, '--mode', 'eval',
        '--name', option('--name'), '--replace']);
    }
    print({source_id: c.source_id, desired: {preset: c.preset_id, image: c.image},
      actual: instancesFor(c)});
  } else {
    throw new Error('用法：research-tool.mts context|edit|run|review|instance；context/edit/run/instance 需 --source');
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 2;
}
