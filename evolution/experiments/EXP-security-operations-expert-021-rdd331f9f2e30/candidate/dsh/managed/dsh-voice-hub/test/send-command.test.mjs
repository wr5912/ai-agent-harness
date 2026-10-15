import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const temp = mkdtempSync(join(tmpdir(), 'dsh-vm-send-command-'))
try {
  const outputs = [
    ['send-command.ts', 'send-command.mjs'],
    ['service-config.ts', 'service-config.mjs'],
  ]
  for (const [source, output] of outputs) {
    await build({ entryPoints: [join(here, '..', 'src', source)], outfile: join(temp, output), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' })
  }
  const { DEFAULT_SEND_COMMANDS, matchesSendCommand } = await import(pathToFileURL(join(temp, 'send-command.mjs')).href)
  const { loadServiceConfig, validateServiceConfig } = await import(pathToFileURL(join(temp, 'service-config.mjs')).href)
  const base = {
    asrStreamUrl: 'ws://127.0.0.1:8012/v1/asr/stream',
    asrBatchUrl: 'http://127.0.0.1:8002/v1/audio/transcriptions',
    asrModel: 'Qwen3-ASR',
    ttsStreamUrl: 'http://127.0.0.1:8003/tts/stream/cancellable',
    ttsCancelUrl: 'http://127.0.0.1:8003/tts/cancel/{generationId}',
    wakeWord: '小安小安',
    approvalVoice: true,
  }

  assert.deepEqual(validateServiceConfig(base).sendCommands, DEFAULT_SEND_COMMANDS)
  assert.equal(validateServiceConfig(base).summaryLength, 30)
  assert.equal(validateServiceConfig(base).summaryModel, null)
  assert.match(validateServiceConfig(base).summaryPrompt, /\{length\}/)
  assert.equal(validateServiceConfig({ ...base, summaryLength: 45, summaryPrompt: '约 {length} 字', summaryModel: { provider: 'p', model: 'm' } }).summaryLength, 45)
  for (const summaryLength of [0, 9, 301, 30.5, '30']) assert.throws(() => validateServiceConfig({ ...base, summaryLength }), /摘要字数/)
  assert.throws(() => validateServiceConfig({ ...base, summaryPrompt: ' ' }), /摘要提示词/)
  assert.throws(() => validateServiceConfig({ ...base, summaryModel: { provider: '', model: 'm' } }), /摘要模型/)
  assert.deepEqual(validateServiceConfig({ ...base, sendCommands: ['发送', ' 发送。 ', '提交消息'] }).sendCommands, ['发送', '提交消息'])
  assert.deepEqual(validateServiceConfig({ ...base, sendCommands: [] }).sendCommands, [])
  assert.equal(validateServiceConfig({ ...base, wakeWord: '小安小安;你好小安；小莫', alwaysListen: true }).wakeWord, '小安小安；你好小安；小莫')
  assert.equal(validateServiceConfig({ ...base, wakeWord: Array(10).fill('小安').map((word, index) => `${word}${'好'.repeat(index)}`).join('；'), alwaysListen: true }).wakeWord.split('；').length, 10)
  assert.throws(() => validateServiceConfig({ ...base, wakeWord: Array(11).fill('小安').map((word, index) => `${word}${'好'.repeat(index)}`).join(';'), alwaysListen: true }), /唤醒词最多 10 个/)
  assert.throws(() => validateServiceConfig({ ...base, wakeWord: '小安;小安', alwaysListen: true }), /唤醒词不能重复/)
  assert.throws(() => validateServiceConfig({ ...base, wakeWord: '小安;hey dsh', alwaysListen: true }), /中文唤醒词/)
  assert.throws(() => validateServiceConfig({ ...base, sendCommands: '发送' }), /发送触发词/)
  assert.throws(() => validateServiceConfig({ ...base, sendCommands: ['。'] }), /发送触发词/)
  assert.equal(validateServiceConfig({ ...base, sendCommands: Array(10).fill('发送') }).sendCommands.length, 1)
  assert.throws(() => validateServiceConfig({ ...base, sendCommands: Array(11).fill('发送') }), /发送触发词最多 10 个/)
  assert.equal(validateServiceConfig({ ...base, ttsCancelUrl: '' }).ttsCancelUrl, '')
  assert.throws(() => validateServiceConfig({ ...base, ttsCancelUrl: 'http://127.0.0.1:8003/cancel' }), /generationId/)
  assert.equal(validateServiceConfig({ ...base, asrBatchUrl: 'http://127.0.0.1:8002/custom/transcribe' }).asrBatchUrl,
    'http://127.0.0.1:8002/custom/transcribe')
  const priorHome = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = temp
    mkdirSync(join(temp, 'voice-mode'))
    writeFileSync(join(temp, 'voice-mode', 'service-config.json'), JSON.stringify({
      ...base, asrBatchUrl: 'http://127.0.0.1:8002/', ttsBaseUrl: 'http://127.0.0.1:8003/',
      ttsStreamUrl: undefined, ttsCancelUrl: undefined, sendCommands: Array(11).fill('发送'),
    }))
    const migrated = loadServiceConfig(validateServiceConfig(base))
    assert.equal(migrated.asrStreamUrl, base.asrStreamUrl)
    assert.equal(migrated.asrBatchUrl, base.asrBatchUrl)
    assert.equal(migrated.ttsStreamUrl, base.ttsStreamUrl)
    assert.equal(migrated.ttsCancelUrl, base.ttsCancelUrl)
    assert.deepEqual(migrated.sendCommands, ['发送'])
    for (const batchUrl of [base.asrBatchUrl, 'http://127.0.0.1:8002/custom/transcribe']) {
      writeFileSync(join(temp, 'voice-mode', 'service-config.json'), JSON.stringify({
        ...base, asrBatchUrl: batchUrl, ttsBaseUrl: 'http://127.0.0.1:8003',
        ttsStreamUrl: undefined, ttsCancelUrl: undefined,
      }))
      assert.equal(loadServiceConfig(validateServiceConfig(base)).asrBatchUrl, batchUrl,
        '旧服务端保存的完整批量接口地址不应再次追加路径')
    }
  } finally {
    if (priorHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = priorHome
  }

  assert.equal(matchesSendCommand('确认发送。', DEFAULT_SEND_COMMANDS), true)
  assert.equal(matchesSendCommand('确认，发送！', DEFAULT_SEND_COMMANDS), true)
  assert.equal(matchesSendCommand('提交消息。', ['提交消息']), true)
  assert.equal(matchesSendCommand('确认发送给我', DEFAULT_SEND_COMMANDS), false)
  assert.equal(matchesSendCommand('发', DEFAULT_SEND_COMMANDS), false)
  assert.equal(matchesSendCommand('发送', []), false)
  console.log('发送触发词：配置、默认值、完整短句匹配与防误发通过')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
