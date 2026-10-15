/** 真实模型的文本比较；HTTP 是外部边界，不替代锁定 Runtime 与真实 TTS 验证。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const [baselineSource, evaluationPath, keyPath, outputPath] = process.argv.slice(2)
if (!outputPath) throw new Error('baseline-source evaluation key-file output required')
const key = readFileSync(keyPath, 'utf8').trim()
const evaluation = readFileSync(evaluationPath, 'utf8').split('#### U-VOICE-004')[1]
const inputs = [...evaluation.matchAll(/^> (.+)$/gm)].map(match => match[1].replace(/^只根据以下事实回答，不调用工具：/, ''))
if (inputs.length !== 3) throw new Error('U-VOICE-004 must contain three inputs')
const load = async path => {
  const compiled = await build({ entryPoints: [resolve(path)], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
}
const variants = { baseline: await load(baselineSource), candidate: await load('src/speech-summary.ts') }
const report = { model: 'deepseek-flash', transport: 'direct HTTP boundary with actual SpeechSummaryQueue',
  startedAt: new Date().toISOString(), baselineWatchdogMs: 45000, candidateDeadlineMs: 15000,
  scope: '仅真实模型摘要文字；未连接真实 TTS，未验证物理听感。SDK 参数映射另测。', trials: [] }
const save = () => writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n')
save()

async function run(variant, input, repetition) {
  const started = performance.now()
  const record = { variant, input, repetition, text: inputs[input - 1], startedAt: new Date().toISOString() }
  report.trials.push(record)
  let result, finish, timer
  const done = new Promise(resolve => { finish = resolve })
  const queue = new variants[variant].SpeechSummaryQueue(async function* (options) {
    const body = { model: 'deepseek-flash', stream: true, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: options.system }, { role: 'user', content: inputs[input - 1] }],
      ...(options.reasoningEffort === 'off' ? { thinking: { type: 'disabled' } } : {}),
      ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }) }
    record.request = { thinking: body.thinking ?? 'provider-default', maxTokens: body.max_tokens ?? 'provider-default',
      roles: body.messages.map(m => m.role), tools: false, history: false }
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body), signal: options.signal,
    })
    record.httpStatus = response.status
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    record.firstResponseMs = performance.now() - started
    let pending = '', reasoningCharacters = 0
    const decoder = new TextDecoder()
    for await (const bytes of response.body) {
      pending += decoder.decode(bytes, { stream: true })
      let end
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1)
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        const data = JSON.parse(line.slice(6))
        record.actualModel = data.model ?? record.actualModel
        if (data.usage) { record.usage = data.usage; yield { type: 'usage', usage: { reasoningTokens: data.usage.completion_tokens_details?.reasoning_tokens } } }
        const choice = data.choices?.[0], delta = choice?.delta
        if (delta?.reasoning_content) {
          reasoningCharacters += delta.reasoning_content.length
          record.reasoningCharacters = reasoningCharacters
          yield { type: 'reasoning-delta', text: delta.reasoning_content }
        }
        if (delta?.content) {
          record.firstTextMs ??= performance.now() - started
          yield { type: 'text-delta', text: delta.content }
        }
        if (choice?.finish_reason) {
          record.finishReason = choice.finish_reason
          record.finishMs = performance.now() - started
          yield { type: 'finish', reason: { kind: choice.finish_reason } }
        }
      }
    }
  }, event => { result = event; finish() }, () => {}, () => { record.status = 'failed-or-timeout'; finish() },
  async () => ({ provider: 'deepseek', id: 'deepseek-flash', name: 'DeepSeek Flash', defaultMaxTokens: 8192,
    reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] } }))
  timer = setTimeout(() => { record.status = 'watchdog-timeout'; queue.dispose(); finish() }, 45000)
  try {
    queue.enqueue({ sessionId: 'bench', sourceMessageId: `${variant}-${input}-${repetition}`, turn: 1, step: 1,
      targetTabId: 'bench', text: inputs[input - 1], provider: 'deepseek', model: 'deepseek-flash', settings: variants[variant].SUMMARY_DEFAULTS })
    await done
    record.elapsedMs = performance.now() - started
    if (result) { record.status = 'completed'; record.summary = result.text; record.characters = [...result.text].length; record.metrics = result }
  } finally { clearTimeout(timer); queue.dispose(); save() }
  console.log(JSON.stringify({ variant, input, repetition, status: record.status, elapsedMs: Math.round(record.elapsedMs), reasoningCharacters: record.reasoningCharacters ?? 0 }))
}
// 交替顺序，避免始终由同一版本承担网络或模型热身差异；保留全部逐次结果。
for (let repetition = 1; repetition <= 3; repetition++) {
  for (let input = 1; input <= inputs.length; input++) {
    for (const variant of repetition % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline']) await run(variant, input, repetition)
  }
}
report.finishedAt = new Date().toISOString()
save()
