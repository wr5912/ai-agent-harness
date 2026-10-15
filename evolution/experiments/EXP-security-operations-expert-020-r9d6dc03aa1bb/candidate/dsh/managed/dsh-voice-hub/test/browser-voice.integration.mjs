/**
 * 隔离 DSH Web 闭环：真实 TTS 造测试语音 → Chromium 虚拟麦克风 → 流式 ASR
 * → 草稿 → 语音确认发送；再核对播报开关及审批提示进入浏览器音频解码器。
 * 仅在指定 DSH_WEB_BOOT_LOG 时运行，日志中含临时访问令牌，不打印其内容。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { RemoteTtsEngine, pcm24ToWav } from '../src/tts-remote.ts'

const logPath = process.env.DSH_WEB_BOOT_LOG
if (!logPath) throw new Error('请设置 DSH_WEB_BOOT_LOG，指向隔离 DSH Web 的启动日志')
const bootUrl = readFileSync(logPath, 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]
if (!bootUrl) throw new Error('启动日志中没有本地 DSH Web 地址')
const chrome = process.env.DSHVM_CHROME || '/usr/bin/google-chrome'
const temp = mkdtempSync(join(tmpdir(), 'dsh-voice-browser-'))
let browser
let savedServiceConfig
try {
  const tts = new RemoteTtsEngine(() => process.env.DSHVM_TTS_STREAM_URL || 'http://127.0.0.1:8003/tts/stream/cancellable', () => '')
  const content = await tts.synthesize('你好，这是语音测试。')
  const command = await tts.synthesize('确认发送。')
  await tts.close()
  const pcm = Buffer.concat([
    Buffer.alloc(24000 * 2 * 3),
    content.subarray(44),
    Buffer.alloc(24000 * 2 * 5),
    command.subarray(44),
    Buffer.alloc(24000 * 2 * 3),
    command.subarray(44),
    Buffer.alloc(24000 * 2 * 4),
  ])
  const capturePath = join(temp, 'capture.wav')
  writeFileSync(capturePath, pcm24ToWav(pcm))

  browser = await chromium.launch({
    executablePath: chrome, headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${capturePath}%noloop`],
  })
  const context = await browser.newContext({ permissions: ['microphone'] })
  const page = await context.newPage()
  const asrResponses = []
  let sessionId = ''
  let tabId = ''
  page.on('request', request => {
    if (!request.url().endsWith('/voice-mode/toggle')) return
    try {
      const body = request.postDataJSON()
      if (body.on) { sessionId = body.sessionId; tabId = body.tabId }
    } catch { /* 其他请求格式不影响验证 */ }
  })
  page.on('response', response => {
    if (response.url().includes('/voice-mode/asr?')) asrResponses.push(response.status())
  })
  await page.addInitScript(() => {
    // 模拟浏览器未启用原生回声消除：自动探测会落入手动打断，
    // 此时闲置朗读之外仍必须持续采音并显示波形、识别文字。
    const originalGetSettings = MediaStreamTrack.prototype.getSettings
    MediaStreamTrack.prototype.getSettings = function () {
      const settings = originalGetSettings.call(this)
      return this.kind === 'audio' ? { ...settings, echoCancellation: false } : settings
    }
    window.__dshVoiceDecodeCount = 0
    const original = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function (...args) {
      window.__dshVoiceDecodeCount++
      return original.apply(this, args)
    }
  })
  await page.goto(bootUrl, { waitUntil: 'domcontentloaded' })
  const later = page.getByRole('button', { name: 'Configure later' })
  try { await page.locator('[data-dshvm="mic"]').waitFor({ state: 'visible', timeout: 45000 }) }
  catch (error) {
    console.error('隔离 DSH 页面未就绪：', (await page.locator('body').innerText()).slice(-1000))
    throw error
  }
  const continueNotice = page.getByRole('button', { name: 'Continue', exact: true })
  let readySince = 0
  let handledNotice = false
  const onboardingDeadline = Date.now() + 90000
  while (Date.now() < onboardingDeadline) {
    if (await later.isVisible() && await later.isEnabled()) {
      await later.click()
      handledNotice = true
      readySince = 0
    } else if (await continueNotice.isVisible() && await continueNotice.isEnabled()) {
      await continueNotice.click()
      handledNotice = true
      readySince = 0
    } else {
      const micCanReceiveClick = await page.evaluate(() => {
        const mic = document.querySelector('[data-dshvm="mic"]')
        if (!mic) return false
        const rect = mic.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return hit !== null && mic.contains(hit)
      })
      if (micCanReceiveClick) {
        if (!readySince) readySince = Date.now()
        if (Date.now() - readySince > (handledNotice ? 1500 : 8000)) break
      } else readySince = 0
    }
    await page.waitForTimeout(250)
  }
  if (Date.now() >= onboardingDeadline) {
    console.error('隔离 DSH 首次引导未完成：', (await page.locator('body').innerText()).slice(-1000))
    throw new Error('隔离 DSH 首次引导未完成')
  }
  try { await page.getByRole('button', { name: 'Settings' }).click({ timeout: 10000 }) }
  catch (error) {
    console.error('设置入口被页面遮挡：', (await page.locator('body').innerText()).slice(-1000))
    throw error
  }
  await page.getByRole('button', { name: '语音设置' }).click()
  await page.getByRole('textbox', { name: /流式语音识别地址/ }).waitFor()
  const wakeWordField = page.getByRole('textbox', { name: /^唤醒词/ })
  await wakeWordField.waitFor()
  assert.equal(await wakeWordField.evaluate((element) => element.tagName), 'INPUT')
  await wakeWordField.fill('小安小安')
  const sendCommandsField = page.getByRole('textbox', { name: /发送触发词/ })
  await sendCommandsField.waitFor()
  assert.equal(await sendCommandsField.evaluate((element) => element.tagName), 'INPUT')
  await sendCommandsField.fill('发送;确认发送；确认;提交消息')
  const approvalSwitch = page.getByRole('checkbox', { name: /待审批、待回答和计划审阅时播放语音提示/ })
  const approvalBefore = await approvalSwitch.isChecked()
  await approvalSwitch.setChecked(!approvalBefore)
  assert.match(await approvalSwitch.locator('xpath=..').innerText(), approvalBefore ? /已关闭/ : /已开启/)
  assert.equal(await approvalSwitch.locator('xpath=..').locator('svg').count(), 0)
  await approvalSwitch.setChecked(approvalBefore)
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.getByText('流式识别、批量识别和语音合成连接成功；取消地址已检查格式。').waitFor({ timeout: 45000 })
  assert.match(await page.getByRole('list', { name: '语音服务连接结果' }).innerText(), /流式语音识别：成功[\s\S]*批量语音识别：成功[\s\S]*语音合成：成功/)
  await page.getByRole('button', { name: '保存配置' }).click()
  await page.getByText('已保存。常开唤醒及唤醒词在返回聊天页后生效；发送触发词在下次进入语音模式时生效。').waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  const config = await page.evaluate(async () => (await fetch(new URL('voice-mode/config', document.baseURI))).json())
  savedServiceConfig = await page.evaluate(async () => (await fetch(new URL('voice-mode/service-config', document.baseURI))).json())
  assert.deepEqual(savedServiceConfig.sendCommands, ['发送', '确认发送', '确认', '提交消息'])
  assert.equal(savedServiceConfig.alwaysListen, false, '未开启常开唤醒时必须由麦克风手动录入')
  assert.deepEqual(config.sendCommands, savedServiceConfig.sendCommands, '发送触发词未下发到浏览器配置')
  const tooMany = await page.evaluate(async (value) => {
    const response = await fetch(new URL('voice-mode/service-config', document.baseURI), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...value, sendCommands: Array(11).fill('发送') }),
    })
    return { status: response.status, body: await response.json() }
  }, savedServiceConfig)
  assert.equal(tooMany.status, 400)
  assert.match(tooMany.body.error, /最多 10 个/)
  const invalidProbe = await page.evaluate(async value => (await fetch(new URL('voice-mode/service-check', document.baseURI), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...value, asrStreamUrl: 'ws://127.0.0.1:1/v1/asr/stream' }),
  })).json(), savedServiceConfig)
  assert.equal(invalidProbe.results.stream.ok, false, '无效流式地址应显示连接失败')
  assert.equal(invalidProbe.results.batch.ok, true, '流式地址失败不应掩盖批量识别结果')
  assert.equal(invalidProbe.results.tts.ok, true, '流式地址失败不应掩盖合成结果')
  assert.equal(config.autoSend, false, '此用例要求识别后先保留草稿')
  assert.equal(config.approvalVoice, true, '此用例要求启用审批语音提示')
  try { await page.getByRole('button', { name: '进入语音对话模式' }).click({ timeout: 15000 }) }
  catch (error) {
    if (await later.isVisible()) {
      await later.click()
      try { await page.getByRole('button', { name: '进入语音对话模式' }).click({ timeout: 15000 }) }
      catch (retryError) {
        console.error('麦克风按钮被页面遮挡：', (await page.locator('body').innerText()).slice(-1300))
        throw retryError
      }
    } else {
      console.error('麦克风按钮被页面遮挡：', (await page.locator('body').innerText()).slice(-1300))
      throw error
    }
  }
  await page.waitForFunction(() => [...document.querySelectorAll('[data-slot="conversation.input.dock"] .dshvm-bar')]
    .some(bar => Number.parseFloat(bar.style.height) > 4), null, { timeout: 10000 })
  try { await page.waitForFunction(() => document.querySelector('[data-slot="conversation.input.dock"]')?.textContent?.includes('你好'), null, { timeout: 20000 }) }
  catch (error) {
    console.error('语音状态条未出现预期文字，页面末尾：', (await page.locator('body').innerText()).slice(-900))
    console.error('识别接口状态：', asrResponses)
    throw error
  }
  await page.waitForFunction(() => document.querySelector('[data-composer-input="true"]')?.textContent?.includes('你好'), null, { timeout: 1000 })
  await page.waitForFunction(() => document.body.innerText.includes('这是语音测试。'), { timeout: 30000 })
  try { await page.waitForFunction(() => document.body.innerText.includes('1 turns'), null, { timeout: 30000 }) }
  catch (error) {
    console.error('语音发送未完成，页面末尾：', (await page.locator('body').innerText()).slice(-1000))
    console.error('识别接口状态：', asrResponses)
    throw error
  }
  assert.ok(asrResponses.some(status => status === 200), '浏览器没有成功调用语音识别接口')
  assert.ok(sessionId && tabId, '语音会话没有取得标签页归属')
  const bodyText = await page.locator('body').innerText()
  assert.ok(bodyText.includes('这是语音测试。'), '识别内容没有进入消息')
  assert.ok(!bodyText.includes('确认发送。'), '语音命令不应作为消息内容')

  await page.getByRole('button', { name: '开启后续回复自动播报' }).click()
  const readConfig = await page.evaluate(async () => (await fetch(new URL('voice-mode/config', document.baseURI))).json())
  assert.equal(readConfig.readSessionId, sessionId, '播报开关未绑定当前会话')
  await page.getByRole('button', { name: '关闭后续回复自动播报' }).click()
  await page.locator('[data-dshvm="mic"]').click()
  await page.waitForFunction(() => document.querySelector('[data-dshvm="mic"]')?.getAttribute('aria-pressed') === 'false')

  const decodedBefore = await page.evaluate(() => window.__dshVoiceDecodeCount)
  const announce = await page.evaluate(async ({ sessionId, tabId }) => {
    const response = await fetch(new URL('voice-mode/announce', document.baseURI), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, tabId, key: `browser-e2e-${Date.now()}`, kind: 'approval', toolName: '测试工具' }),
    })
    return { status: response.status, body: await response.json() }
  }, { sessionId, tabId })
  assert.equal(announce.status, 200, `审批提示未进入语音队列：${JSON.stringify(announce.body)}`)
  try { await page.waitForFunction(before => window.__dshVoiceDecodeCount > before, decodedBefore, { timeout: 20000 }) }
  catch (error) {
    console.error('审批语音未解码，页面状态：', (await page.locator('body').innerText()).slice(-900))
    console.error('语音配置状态：', await page.evaluate(async () => (await fetch(new URL('voice-mode/config', document.baseURI))).json()))
    throw error
  }
  await page.waitForTimeout(2200)
  const invalid = { ...savedServiceConfig, asrStreamUrl: 'ws://127.0.0.1:1/v1/asr/stream', asrBatchUrl: 'http://127.0.0.1:1/v1/audio/transcriptions' }
  const changed = await page.evaluate(async value => (await fetch(new URL('voice-mode/service-config', document.baseURI), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  })).status, invalid)
  assert.equal(changed, 200, '无法构造语音识别服务不可用场景')
  await page.locator('[data-composer-input="true"]').fill('')
  await page.locator('[data-dshvm="mic"]').click()
  try { await page.waitForFunction(() => document.body.innerText.includes('语音识别服务不可用'), null, { timeout: 15000 }) }
  catch (error) {
    console.error('ASR 不可用提示未出现，麦克风状态：', await page.locator('[data-dshvm="mic"]').getAttribute('aria-pressed'))
    console.error('页面末尾：', (await page.locator('body').innerText()).slice(-700))
    throw error
  }
  console.log(JSON.stringify({ asrRequests: asrResponses.length, submittedText: '这是语音测试。', readSession: true, approvalAudioDecoded: true, unavailableNotice: true }, null, 2))
} finally {
  if (savedServiceConfig) {
    await fetch(new URL('voice-mode/service-config', bootUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(savedServiceConfig),
    }).catch(() => {})
  }
  await browser?.close()
  rmSync(temp, { recursive: true, force: true })
}
