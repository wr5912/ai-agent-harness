#!/usr/bin/env node
/** Compare two frozen Run views without changing either Run. */
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

type Trial = { execution_status: string; verdict: string; observation: string };
type Case = {
  case_id: string; frozen: unknown; trials: Trial[]; output: unknown;
  actual_routes: Array<{ model?: string } | null> | null;
  review: { reviewed_verdict?: string; reason?: string } | null;
  load_observation: { preset_matches?: boolean; workspace_matches?: boolean } | null;
  evidence: Array<{ path: string; present: boolean }>;
};
type View = {
  run_id: string; run_path: string; manifest: { agent_id: string; status: string };
  source: Record<string, any>; image: Record<string, any> | null;
  cases: Case[]; missing: string[];
};

const { left, right } = JSON.parse(readFileSync(0, 'utf8')) as { left: View; right: View };
if (left.manifest.agent_id !== right.manifest.agent_id) throw new Error('只能比较同一 Agent 的 Run');

const limits: string[] = [];
const limit = (value: string) => { if (!limits.includes(value)) limits.push(value); };
const value = (item: unknown) => item === null || item === undefined || item === '' ? '未记录' : String(item);
const cell = (item: unknown) => value(item).replaceAll('|', '\\|').replaceAll('\n', '<br>');
const link = (path: string, label: string) => `[${label}](${posix.relative(right.run_path, path)})`;
const trialVerdicts = (item: Case) => item.trials.map(row => `${row.execution_status}/${row.verdict}`).join('、') || '未记录';
const observation = (item: Case) => item.review?.reason || item.trials.map(row => row.observation).join('；') || '未记录';
const models = (item: Case) => item.actual_routes?.map(route => route?.model).filter(Boolean) || [];

for (const field of ['executor', 'model'] as const) {
  const a = left.source[field], b = right.source[field];
  if (!a || !b) limit(`${field}: 未记录`);
  else if (a !== b) limit(`${field}: 不同`);
}
for (const [side, run] of [['left', left], ['right', right]] as const) {
  if (run.source.git_version?.dirty !== false) limit(`${side}: Git 来源不干净或未记录`);
  if (run.missing.length) limit(`${side}: 缺少证据或记录（${run.missing.join('；')}）`);
}
for (const field of ['image_build_fingerprint', 'local_image_id']) {
  const a = left.image?.[field], b = right.image?.[field];
  if (!a || !b) limit(`${field}: 缺少实际镜像证据`);
  else if (a !== b) limit(`${field}: 不同`);
}

const leftCases = new Map(left.cases.map(item => [item.case_id, item]));
const rightCases = new Map(right.cases.map(item => [item.case_id, item]));
const shared = [...leftCases.keys()].filter(id => rightCases.has(id)).sort();
const leftOnly = [...leftCases.keys()].filter(id => !rightCases.has(id)).sort();
const rightOnly = [...rightCases.keys()].filter(id => !leftCases.has(id)).sort();
if (!shared.length) limit('没有共同 Case');
if (leftOnly.length || rightOnly.length) limit('选择的 Case 集合不同');
const cases = shared.map(case_id => {
  const a = leftCases.get(case_id)!, b = rightCases.get(case_id)!;
  const frozen_contract_same = isDeepStrictEqual(a.frozen, b.frozen);
  if (!frozen_contract_same) limit(`${case_id}: 冻结 Case 口径不同`);
  for (const [side, item] of [['left', a], ['right', b]] as const) {
    if (!item.load_observation?.preset_matches || !item.load_observation?.workspace_matches)
      limit(`${case_id}: ${side} 缺少正确装载观察`);
  }
  const aModels = models(a), bModels = models(b);
  if (!aModels.length || !bModels.length) limit(`${case_id}: 缺少实际模型记录`);
  else if (!isDeepStrictEqual(aModels, bModels)) limit(`${case_id}: 实际模型不同`);
  if (!a.trials.length || !b.trials.length) limit(`${case_id}: 缺少 Trial 结果`);
  return {
    case_id, frozen_contract_same,
    left_trials: a.trials, right_trials: b.trials,
    left_output: a.output, right_output: b.output,
    left_actual_routes: a.actual_routes, right_actual_routes: b.actual_routes,
    left_review: a.review, right_review: b.review,
    left_evidence: a.evidence, right_evidence: b.evidence,
    observed_change: isDeepStrictEqual(
      [trialVerdicts(a), a.review?.reviewed_verdict, observation(a), a.output],
      [trialVerdicts(b), b.review?.reviewed_verdict, observation(b), b.output],
    ) ? '记录相同' : '记录有差异',
  };
});
const comparable = cases.some(item => item.left_trials.length && item.right_trials.length);
const causal_comparable = comparable && limits.length === 0;

const sourceFacts = (run: View) => {
  const trees = Object.entries(run.source.candidate_trees || {})
    .map(([name, tree]: [string, any]) => `${name}: ${value(tree.tree_sha256)}`).join('<br>') || '未记录';
  const actualModels = [...new Set(run.cases.flatMap(models))].join('、') || '未记录';
  return {
    'Run': link(`${run.run_path}/report.md`, run.run_id),
    'Git': `${cell(run.source.git_version?.commit)}；dirty=${cell(run.source.git_version?.dirty)}`,
    'Candidate': trees,
    '执行器 / 预期模型': `${cell(run.source.executor)} / ${cell(run.source.model)}`,
    '实际模型': cell(actualModels),
    '实际镜像': `${cell(run.image?.image_build_fingerprint)}；${cell(run.image?.local_image_id)}`,
    '硬件 / 资源消耗': '未记录',
  };
};
const evidenceLinks = (items: Case['evidence']) => items.length
  ? items.map(item => item.present ? link(item.path, posix.basename(item.path)) : `${cell(item.path)}（缺失）`).join('、')
  : '未记录';
const leftFacts = sourceFacts(left), rightFacts = sourceFacts(right);
const markdown = [
  '## 与之前版本的对比', '',
  '这是两次 Run 的观察性对照；模型、执行器、镜像、输入口径或环境有差异时，不能单独归因于 Harness。', '',
  '| 来源 | 旧版 | 新版 |', '| --- | --- | --- |',
  ...Object.entries(leftFacts).map(([name, oldValue]) =>
    `| ${name} | ${oldValue} | ${rightFacts[name as keyof typeof rightFacts]} |`),
  '',
  `- 共同 Case：${shared.join('、') || '无'}；仅旧版：${leftOnly.join('、') || '无'}；仅新版：${rightOnly.join('、') || '无'}。`,
  `- 可观察对照：${comparable ? '有共同 Case 结果' : '缺少共同 Case 结果'}；因果归因：${causal_comparable ? '条件一致，但仍需结合实验设计判断' : '受下列限制，不能认定 Harness 单独导致差异'}。`,
  ...limits.map(item => `- 限制：${cell(item)}`),
  '',
  '| Case | 冻结口径 | 旧 Trial / 复核 | 新 Trial / 复核 | 观察 | 旧证据 | 新证据 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...shared.map(id => {
    const a = leftCases.get(id)!, b = rightCases.get(id)!;
    const decision = (item: Case) => `${trialVerdicts(item)} / ${value(item.review?.reviewed_verdict)}`;
    const change = cases.find(item => item.case_id === id)!.observed_change;
    return `| ${cell(id)} | ${isDeepStrictEqual(a.frozen, b.frozen) ? '相同' : '不同'} | ${cell(decision(a))} | ${cell(decision(b))} | ${change}；旧：${cell(observation(a))}；新：${cell(observation(b))} | ${evidenceLinks(a.evidence)} | ${evidenceLinks(b.evidence)} |`;
  }),
  ...(shared.length ? [] : ['| - | - | - | - | 无共同 Case | - | - |']),
  '',
].join('\n');

process.stdout.write(JSON.stringify({
  left_run: left.run_id, right_run: right.run_id,
  left_source: left.source, right_source: right.source,
  left_image: left.image, right_image: right.image,
  comparable, causal_comparable, limits, cases, left_only: leftOnly, right_only: rightOnly,
  left_missing: left.missing, right_missing: right.missing, markdown,
}));
