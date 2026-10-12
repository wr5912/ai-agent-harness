import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_SEND_COMMANDS, normalizeSendCommand } from './send-command.ts'
import { splitWakeWords } from './wakeword.ts'
import { SUMMARY_DEFAULTS, type SummarySettings } from './speech-summary.ts'

/** 模型地址的用户配置。文件是设置页面的唯一持久化来源，插件 Config 只给初始默认值。 */
export interface ServiceConfig extends SummarySettings {
  asrStreamUrl: string
  asrBatchUrl: string
  asrModel: string
  ttsStreamUrl: string
  ttsCancelUrl: string
  wakeWord: string
  alwaysListen: boolean
  sendCommands: string[]
  approvalVoice: boolean
}

export function serviceConfigPath(): string {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'voice-mode', 'service-config.json')
}

function validUrl(value: unknown, protocols: readonly string[], label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error(`${label}不能为空或过长`)
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error(`${label}不是有效地址`) }
  if (!protocols.includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) {
    throw new Error(`${label}协议或格式不正确`)
  }
  return url.toString()
}

function validCancelUrl(value: unknown): string {
  if (value === '') return ''
  if (typeof value !== 'string' || value.split('{generationId}').length !== 2) {
    throw new Error('语音合成取消地址需包含一个 {generationId}，或留空禁用服务端取消')
  }
  const marker = 'dshgenerationidplaceholder'
  return validUrl(value.replace('{generationId}', marker), ['http:', 'https:'], '语音合成取消地址')
    .replace(marker, '{generationId}')
}

export function validateServiceConfig(value: unknown): ServiceConfig {
  if (!value || typeof value !== 'object') throw new Error('语音服务配置格式不正确')
  const source = value as Record<string, unknown>
  const asrModel = source.asrModel
  if (typeof asrModel !== 'string' || !asrModel.trim() || asrModel.length > 128) throw new Error('批量识别模型名不能为空或过长')
  if (source.wakeWord !== undefined && typeof source.wakeWord !== 'string') throw new Error('唤醒词格式不正确')
  const wakeWords = splitWakeWords(typeof source.wakeWord === 'string' ? source.wakeWord : '')
  if (wakeWords.length > 10 || wakeWords.some((word) => word.length > 32)) throw new Error('唤醒词最多 10 个，每个不超过 32 个字符，请用分号隔开')
  if (new Set(wakeWords.map((word) => word.replace(/\s+/g, ''))).size !== wakeWords.length) throw new Error('唤醒词不能重复')
  if (source.alwaysListen !== undefined && typeof source.alwaysListen !== 'boolean') throw new Error('常开唤醒开关格式不正确')
  if (source.alwaysListen === true && (!wakeWords.length || wakeWords.some((word) => /[^\u3400-\u9fff\s]/u.test(word)))) throw new Error('常开唤醒需要设置中文唤醒词')
  const rawCommands = source.sendCommands === undefined ? [...DEFAULT_SEND_COMMANDS] : source.sendCommands
  if (!Array.isArray(rawCommands) || rawCommands.length > 10 || rawCommands.some((item) => typeof item !== 'string' || item.length > 32 || !normalizeSendCommand(item))) {
    throw new Error('发送触发词最多 10 个，每个不超过 32 个字符，请用分号隔开')
  }
  const sendCommands: string[] = []
  const seenCommands = new Set<string>()
  for (const item of rawCommands) {
    const normalized = normalizeSendCommand(item)
    if (!seenCommands.has(normalized)) { seenCommands.add(normalized); sendCommands.push(item.trim()) }
  }
  if (typeof source.approvalVoice !== 'boolean') throw new Error('审批语音提示开关格式不正确')
  const summaryLength = source.summaryLength ?? SUMMARY_DEFAULTS.summaryLength
  const summaryPrompt = source.summaryPrompt ?? SUMMARY_DEFAULTS.summaryPrompt
  const summaryModel = source.summaryModel ?? null
  if (typeof summaryLength !== 'number' || !Number.isInteger(summaryLength) || summaryLength < 10 || summaryLength > 300) throw new Error('摘要字数需为 10 至 300 的整数')
  if (typeof summaryPrompt !== 'string' || !summaryPrompt.trim() || summaryPrompt.length > 8000) throw new Error('摘要提示词不能为空且不能超过 8000 字符')
  if (summaryModel !== null && (typeof summaryModel !== 'object' || Array.isArray(summaryModel)
    || !['provider', 'model'].every((key) => typeof (summaryModel as Record<string, unknown>)[key] === 'string'
      && (summaryModel as Record<string, string>)[key].trim().length > 0
      && (summaryModel as Record<string, string>)[key].length <= 256))) throw new Error('摘要模型配置无效')
  return {
    asrStreamUrl: validUrl(source.asrStreamUrl, ['ws:', 'wss:'], '流式识别地址'),
    asrBatchUrl: validUrl(source.asrBatchUrl, ['http:', 'https:'], '批量识别地址'),
    asrModel: asrModel.trim(),
    ttsStreamUrl: validUrl(source.ttsStreamUrl, ['http:', 'https:'], '语音合成地址'),
    ttsCancelUrl: validCancelUrl(source.ttsCancelUrl),
    wakeWord: wakeWords.join('；'),
    alwaysListen: source.alwaysListen === true,
    sendCommands,
    approvalVoice: source.approvalVoice,
    summaryLength,
    summaryPrompt: summaryPrompt.trim(),
    summaryModel: summaryModel === null ? null : {
      provider: (summaryModel as { provider: string }).provider,
      model: (summaryModel as { model: string }).model,
    },
  }
}

export function loadServiceConfig(defaults: ServiceConfig): ServiceConfig {
  try {
    const saved = JSON.parse(readFileSync(serviceConfigPath(), 'utf8')) as Record<string, unknown>
    if (typeof saved.ttsBaseUrl === 'string' && saved.ttsStreamUrl === undefined) {
      const base = saved.ttsBaseUrl.replace(/\/+$/, '')
      saved.ttsStreamUrl = `${base}/tts/stream/cancellable`
      saved.ttsCancelUrl = `${base}/tts/cancel/{generationId}`
      if (typeof saved.asrBatchUrl === 'string') {
        const batchUrl = new URL(saved.asrBatchUrl)
        // 旧服务端也可能保存新版页面输入的完整地址；只有根地址可以安全补齐路径。
        if (batchUrl.pathname === '/') {
          batchUrl.pathname = '/v1/audio/transcriptions'
          saved.asrBatchUrl = batchUrl.toString()
        }
      }
    }
    if (Array.isArray(saved.sendCommands) && saved.sendCommands.length > 10) {
      console.warn('[dsh-voice-hub] 旧配置中的发送触发词超过 10 个，当前仅启用前 10 个；请在语音设置中检查并保存。')
      saved.sendCommands = saved.sendCommands.slice(0, 10)
    }
    return validateServiceConfig(saved)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[dsh-voice-hub] 语音服务配置读取失败，使用插件默认值：${error instanceof Error ? error.message : String(error)}`)
    }
    return defaults
  }
}

export async function saveServiceConfig(value: ServiceConfig): Promise<void> {
  const path = serviceConfigPath()
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temp, path)
}
