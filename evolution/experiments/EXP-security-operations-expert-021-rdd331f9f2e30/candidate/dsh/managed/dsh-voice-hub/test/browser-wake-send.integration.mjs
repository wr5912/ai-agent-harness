/** 隔离 Web 闭环：常开本地唤醒录入草稿后，单独说自定义发送触发词。 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { RemoteTtsEngine, pcm24ToWav } from '../src/tts-remote.ts'

const logPath = process.env.DSH_WEB_BOOT_LOG
if (!logPath) throw new Error('请设置 DSH_WEB_BOOT_LOG')
const bootUrl = readFileSync(logPath, 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]
if (!bootUrl) throw new Error('启动日志中没有本地 DSH Web 地址')
const temp = mkdtempSync(join(tmpdir(), 'dsh-voice-wake-send-'))
let browser
let page
let savedConfig
try {
  const tts = new RemoteTtsEngine(() => process.env.DSHVM_TTS_STREAM_URL || 'http://127.0.0.1:8003/tts/stream/cancellable', () => '')
  const wake = await tts.synthesize('小安小安。')
  const content = await tts.synthesize('请帮我查询今天的天气。')
  const command = await tts.synthesize('提交消息。')
  await tts.close()
  const capturePath = join(temp, 'capture.wav')
  writeFileSync(capturePath, pcm24ToWav(Buffer.concat([
    Buffer.alloc(24000 * 2 * 8), wake.subarray(44), Buffer.alloc(24000 * 2),
    content.subarray(44), Buffer.alloc(24000 * 2 * 4),
    command.subarray(44), Buffer.alloc(24000 * 2 * 5),
  ])))

  browser = await chromium.launch({ executablePath: process.env.DSHVM_CHROME || '/usr/bin/google-chrome', headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${capturePath}%noloop`],
  })
  const context = await browser.newContext({ permissions: ['microphone'] })
  page = await context.newPage()
  const finals = []
  const browserErrors = []
  const voiceRequests = []
  page.on('pageerror', error => browserErrors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error' || message.text().includes('KWS')) browserErrors.push(message.text()) })
  page.on('request', request => { if (request.url().includes('/voice-mode/toggle') || request.url().includes('/voice-mode/asr?')) voiceRequests.push(request.url().replace(/sessionId=[^&]+/, 'sessionId=[redacted]')) })
  page.on('response', async (response) => {
    if (!response.url().includes('/voice-mode/asr?') || new URL(response.url()).searchParams.get('final') !== '1' || !response.ok()) return
    try { finals.push((await response.json()).text) } catch { /* 非 JSON 会由页面提示 */ }
  })
  await page.goto(bootUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-dshvm="mic"]').waitFor({ timeout: 45000 })
  const later = page.getByRole('button', { name: 'Configure later' })
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  for (let i = 0; i < 45; i++) {
    if (await later.isVisible() && await later.isEnabled()) await later.click()
    else if (await proceed.isVisible() && await proceed.isEnabled()) await proceed.click()
    if (!await page.locator('._mask_17i0t_18').isVisible()) break
    await page.waitForTimeout(250)
  }
  savedConfig = await page.evaluate(async () => (await fetch(new URL('voice-mode/service-config', document.baseURI))).json())
  const configured = await page.evaluate(async (value) => {
    const response = await fetch(new URL('voice-mode/service-config', document.baseURI), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
    })
    return { status: response.status, body: await response.json() }
  }, { ...savedConfig, wakeWord: '你好小安；小安小安', alwaysListen: true, sendCommands: ['提交消息'] })
  assert.equal(configured.status, 200, JSON.stringify(configured.body))
  const activeConfig = await page.evaluate(async () => (await fetch(new URL('voice-mode/config', document.baseURI))).json())
  assert.deepEqual(activeConfig.sendCommands, ['提交消息'])
  assert.equal(activeConfig.autoSend, false)
  assert.equal(activeConfig.alwaysListen, true)

  const editor = page.locator('[data-composer-input="true"]')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-dshvm="mic"]').waitFor({ timeout: 45000 })
  await page.waitForFunction(() => document.body.innerText.includes('常开唤醒中'), null, { timeout: 45000 })
  await page.locator('[data-dshvm="mic"][data-dshvm-wake="on"]').waitFor({ timeout: 10000 })
  assert.equal(voiceRequests.filter(url => url.includes('/voice-mode/asr?')).length, 0, '本地唤醒待机期间不应请求 ASR')
  try { await page.waitForFunction(() => document.querySelector('[data-composer-input="true"]')?.textContent?.includes('天气'), null, { timeout: 20000 }) }
  catch (error) {
    console.error('常开唤醒未录入：', { status: (await page.locator('body').innerText()).slice(-700), voiceRequests: voiceRequests.slice(-15), browserErrors: browserErrors.slice(-12) })
    throw error
  }
  await page.waitForFunction(() => document.querySelector('[data-composer-input="true"]')?.textContent?.trim() === '', null, { timeout: 25000 })
  assert.ok(finals.some((text) => text?.includes('提交消息')), `自定义发送命令未定稿：${JSON.stringify(finals)}`)
  assert.equal((await editor.innerText()).trim(), '')
  assert.ok((await page.locator('body').innerText()).includes('请帮我查询今天的天气。'), '语音发送后消息未显示')
  assert.ok(!(await page.locator('body').innerText()).includes('小安小安，请帮我查询'), '唤醒词不应进入用户消息')
  if (await later.isVisible()) await later.click()
  await page.locator('[data-dshvm="mic"]').click({ force: true })
  await page.waitForFunction(() => document.body.innerText.includes('常开唤醒中'), null, { timeout: 45000 })
  // 无头 Chrome 的 bringToFront 不可靠改变 document.hidden；直接派发可见性事件验证清理与重启。
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForFunction(() => !document.body.innerText.includes('常开唤醒中'), null, { timeout: 10000 })
  await page.evaluate(() => {
    delete document.hidden
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForFunction(() => document.body.innerText.includes('常开唤醒中'), null, { timeout: 45000 })
  const setAlwaysListen = async (enabled) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: '语音设置' }).click()
    const checkbox = page.getByRole('checkbox', { name: /常开唤醒（/ })
    await checkbox.setChecked(enabled)
    await page.getByRole('button', { name: '保存配置' }).click()
    await page.getByText('已保存。常开唤醒及唤醒词在返回聊天页后生效；发送触发词在下次进入语音模式时生效。').waitFor()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.locator(`[data-dshvm="mic"][data-dshvm-wake="${enabled ? 'on' : 'off'}"]`).waitFor({ timeout: 45000 })
  }
  await setAlwaysListen(false)
  await setAlwaysListen(true)
  console.log(JSON.stringify({ wakeDraft: true, customSend: '提交消息', submitted: true, switchSync: true }))
} finally {
  if (page && savedConfig) {
    await page.evaluate(async (value) => fetch(new URL('voice-mode/service-config', document.baseURI), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
    }), savedConfig).catch(() => {})
  }
  await browser?.close()
  rmSync(temp, { recursive: true, force: true })
}
