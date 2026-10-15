import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { DEFAULT_SUMMARY_PROMPT } from '../src/speech-summary.ts'

const [container, base, output, mode = 'live'] = process.argv.slice(2)
assert.ok(container && base && output, '参数：隔离容器名 URL 证据目录 [live|cold|absent|unload]')
mkdirSync(output, { recursive: true })
const logs = execFileSync('docker', ['logs', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const token = [...logs.matchAll(/token=([^\s]+)/g)].at(-1)?.[1]
assert.ok(token, '隔离实例未就绪')
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] })
const errors: string[] = [], sockets: string[] = [], events: Record<string, any>[] = [], endpoints: string[] = []
const checks: string[] = []
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const clean = (text: string): string => text.replace(/token=[^&\s]+/g, 'token=[redacted]')
page.on('pageerror', e => errors.push(clean(e.message)))
page.on('websocket', ws => {
  sockets.push(new URL(ws.url()).pathname)
  ws.on('framesent', ({ payload }) => {
    try { const value = JSON.parse(String(payload)); if (value.type === 'open') endpoints.push(value.endpoint) } catch {}
  })
  ws.on('framereceived', ({ payload }) => {
    try { const value = JSON.parse(String(payload)); if (value.type === 'item' && value.value?.type?.startsWith('speech-')) events.push(value.value)
      if (value.type === 'item' && value.value?.event === 'summary-error') events.push(value.value) } catch {}
  })
})
await page.addInitScript(() => {
  const counters = { decode: 0, start: 0 }
  let firstContext: BaseAudioContext | undefined, firstScheduled = 0
  Object.assign(window, { voiceTestHasStarted: () => firstContext?.state === 'running' && firstContext.currentTime >= firstScheduled })
  Object.assign(window, { voiceTestAudio: counters })
  const decode = BaseAudioContext.prototype.decodeAudioData, start = AudioBufferSourceNode.prototype.start
  BaseAudioContext.prototype.decodeAudioData = function (...args) { counters.decode++; return decode.apply(this, args) }
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (!firstContext) { firstContext = this.context; firstScheduled = Number(args[0] ?? this.context.currentTime) }
    counters.start++; return start.apply(this, args)
  }
  const sockets: WebSocket[] = []
  Object.assign(window, { voiceTestSockets: sockets })
  window.WebSocket = new Proxy(WebSocket, { construct(target, args) {
    const socket = Reflect.construct(target, args) as WebSocket
    sockets.push(socket); return socket
  } })
})
const wait = async (test: () => Promise<boolean> | boolean): Promise<void> => {
  const end = Date.now() + 10000
  while (!await test()) { assert.ok(Date.now() < end, '等待观察超时'); await page.waitForTimeout(50) }
}
type Results = { calls: { main: boolean; model: string; system: string | null; aborted: boolean; finished: boolean }[]; audio: string[] }
const results = async (): Promise<Results> => (await context.request.get(base + '/voice-probe/results')).json()
const auxCount = (value: Results): number => value.calls.filter(x => !x.main).length
const control = async (value: object): Promise<void> => { assert.equal((await context.request.post(base + '/voice-probe/control', { data: value })).status(), 200) }
const send = async (text: string): Promise<void> => {
  const before = (await results()).calls.filter(x => x.main).length
  const input = page.locator('[data-composer-input=true][contenteditable=true]')
  await input.fill(text)
  await input.press('Enter')
  await wait(async () => (await results()).calls.filter(x => x.main).length > before)
}
const summaryCount = (): number => events.filter(x => x.type === 'speech-summary').length
const enable = async (): Promise<void> => { await page.getByRole('button', { name: '开启后续回复自动播报', exact: true }).click() }
const disable = async (): Promise<void> => { await page.getByRole('button', { name: '关闭后续回复自动播报', exact: true }).click() }
const settings = async (length: string, route: string, prompt: string): Promise<void> => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByText('语音设置', { exact: true }).first().click()
  await page.getByRole('spinbutton', { name: '自动播报摘要字数' }).fill(length)
  await page.getByRole('combobox', { name: '摘要模型' }).selectOption(route)
  await page.getByRole('textbox', { name: '摘要提示词' }).fill(prompt)
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText(/已保存。摘要配置用于下一次播报/).waitFor()
  await page.screenshot({ path: join(output, 'settings.png') })
  await page.getByRole('button', { name: '关闭', exact: true }).click()
}
let captured: Results | undefined
try {
  await page.goto(base + '/?token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded' })
  await page.locator('[data-composer-input=true]').waitFor({ timeout: 30000 })
  const notice = page.getByRole('button', { name: '继续', exact: true })
  if (await notice.count()) await notice.click()
  if (await page.getByRole('button', { name: '选择工作区', exact: true }).count()) {
    await page.getByRole('button', { name: '选择工作区', exact: true }).click()
    await page.getByRole('menuitem').first().click()
  }
  if (mode === 'baseline') {
    await settings('30', '', DEFAULT_SUMMARY_PROMPT)
    await send('基线准备：保持未确认状态。')
    await enable()
    await control({ holdTts: true })
    await send('基线检查：尚未确认入侵，需继续核对。')
    await wait(() => summaryCount() === 1)
    await wait(async () => (await results()).audio.length > 0)
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => (window as any).voiceTestAudio.start), 0)
    const before = await results()
    assert.equal((before as any).tts.at(-1).complete, false)
    assert.equal((before.calls.at(-1) as any).reasoningEffort, 'high')
    await context.request.post(base + '/voice-probe/tts-release')
    await wait(async () => await page.evaluate(() => (window as any).voiceTestHasStarted()))
    checks.push('原版复现：摘要继承 high，TTS 首包已到但 HTTP 未结束时浏览器没有起播；释放响应后才起播')
  } else if (mode === 'cold') {
    await page.getByText('分析可疑登录，保留尚未确认', { exact: true }).first().click()
    await page.waitForTimeout(700)
    assert.equal(auxCount(await results()), 0)
    assert.equal(summaryCount(), 0)
    checks.push('冷加载历史会话：无摘要调用、无历史播报、无页面错误')
  } else if (mode === 'absent') {
    assert.equal(await page.getByRole('button', { name: '开启后续回复自动播报', exact: true }).count(), 0)
    await send('插件移除后继续正常回答。')
    await page.waitForTimeout(300)
    assert.equal(auxCount(await results()), 0)
    checks.push('未安装插件：无播报入口、无辅助调用、主模型正常完成')
  } else if (mode === 'unload') {
    await settings('30', '', DEFAULT_SUMMARY_PROMPT)
    await send('准备插件卸载验证。')
    await enable()
    const before = await results()
    await control({ delayMs: 1500 })
    await send('卸载插件应取消正在生成的摘要。')
    await wait(async () => auxCount(await results()) > auxCount(before))
    assert.equal((await context.request.post(base + '/voice-probe/unload')).status(), 200)
    await page.waitForTimeout(1800)
    const value = await results()
    assert.equal(value.calls.filter(x => !x.main)[auxCount(before)].aborted, true)
    assert.equal(summaryCount(), 0)
    assert.equal(value.audio.length, before.audio.length)
    assert.equal((await context.request.get(base + '/voice-mode/config')).status(), 404)
    await send('插件卸载后主模型继续回答。')
    checks.push('实际 Cordis 插件卸载：辅助调用取消，无迟到事件或合成，HTTP 路由移除，主模型继续工作')
  } else {
    await settings('30', '', DEFAULT_SUMMARY_PROMPT)
    const initial = await results()
    await send('分析可疑登录，保留尚未确认的状态。')
    await page.waitForTimeout(300)
    assert.equal(auxCount(await results()), auxCount(initial))
    checks.push('自动播报关闭时仅主模型调用')
    await enable()
    await control({ holdTts: true })
    const beforeAudio = await page.evaluate(() => (window as any).voiceTestAudio.start)
    await send('继续检查异常登录。')
    await wait(() => summaryCount() === 1)
    await wait(async () => (await results()).audio.length > initial.audio.length)
    await wait(async () => await page.evaluate(() => (window as any).voiceTestAudio.start) > beforeAudio && await page.evaluate(() => (window as any).voiceTestHasStarted()))
    let value = await results()
    assert.equal((value as any).tts.at(-1).complete, false, 'TTS 响应未结束时浏览器必须已经调度播放')
    await context.request.post(base + '/voice-probe/tts-release')
    assert.equal((value.calls.at(-1) as any).reasoningEffort, 'off')
    assert.equal((value.calls.at(-1) as any).maxTokens, 128)
    assert.ok(value.calls.filter(x => x.main).every(x => (x as any).reasoningEffort === 'high'))
    checks.push('实际 Runtime：摘要 off、主调用 high；TTS HTTP 响应未结束时浏览器已经起播')
    assert.equal(value.audio.at(-1), events.find(x => x.type === 'speech-summary')?.text)
    assert.equal(value.calls.at(-1)?.model, 'main')
    assert.match(value.calls.at(-1)?.system ?? '', /30/)
    assert.equal(sockets.length, 1)
    assert.equal(sockets[0], '/api/remote.mux')
    assert.ok(endpoints.includes('voiceMode/follow') && endpoints.includes('session/follow'))
    checks.push('主模型正文完成后发布一次摘要，原文送入 TTS，原生流与语音流共用一条连接')
    await settings('45', JSON.stringify({ provider: 'voice-probe', model: 'summary' }), '将正文摘要为约 {length} 字，保留未确认状态。')
    await send('验证下一条摘要的新配置。')
    await wait(() => summaryCount() === 2)
    value = await results()
    assert.equal(value.calls.at(-1)?.model, 'summary')
    assert.equal(value.calls.at(-1)?.system, '将正文摘要为约 45 字，保留未确认状态。')
    checks.push('实际设置页保存字数、提示词和模型，下一条辅助调用使用新值')
    const cancelTest = async (name: string, action: () => Promise<void>): Promise<void> => {
      const before = await results(), count = summaryCount()
      await control({ delayMs: 1500 })
      await send(name)
      await wait(async () => auxCount(await results()) > auxCount(before))
      await action()
      await page.waitForTimeout(1800)
      value = await results()
      const canceled = value.calls.filter(x => !x.main)[auxCount(before)]
      assert.equal(canceled.aborted, true, name + '未取消辅助调用')
      assert.equal(summaryCount(), count, name + '发出了迟到事件')
      assert.equal(value.audio.length, before.audio.length, name + '合成了迟到摘要')
      checks.push(name + '：请求收到取消，迟到结果未发布或合成')
    }
    await cancelTest('关闭自动播报', disable)
    await enable()
    const beforeTurn = await results(), beforeTurnSummary = summaryCount()
    await control({ delayMs: 1500 })
    await send('旧回合等待摘要。')
    await wait(async () => auxCount(await results()) > auxCount(beforeTurn))
    await send('新回合正常完成。')
    await wait(() => summaryCount() === beforeTurnSummary + 1)
    await page.waitForTimeout(1800)
    value = await results()
    assert.equal(value.calls.filter(x => !x.main)[auxCount(beforeTurn)].aborted, true)
    assert.equal(summaryCount(), beforeTurnSummary + 1)
    assert.equal(value.audio.length, beforeTurn.audio.length + 1)
    checks.push('新回合取消旧摘要，旧结果未发布；新回合摘要正常播放')
    // 下一项通过取消接口验证打断，避免在无麦克风的浏览器中冒充真实插话。
    await cancelTest('显式打断', async () => {
      const sid = events.find(x => x.type === 'speech-summary')!.sessionId
      assert.equal((await context.request.post(base + '/voice-mode/cancel', { data: { sessionId: sid, keepAsr: true } })).status(), 200)
    })
    const beforeError = await results(), beforeSummary = summaryCount()
    await control({ fail: true })
    await send('受控摘要失败仍正常完成主回合。')
    await wait(() => events.some(x => x.event === 'summary-error'))
    await page.getByText('摘要生成失败，本次播报已跳过。', { exact: true }).waitFor()
    assert.equal(summaryCount(), beforeSummary)
    assert.equal((await results()).audio.length, beforeError.audio.length)
    checks.push('辅助模型失败提示并跳过，无全文合成，主模型正常完成')
    await cancelTest('切换会话', async () => { await page.getByRole('button', { name: '新建会话', exact: true }).last().click() })
    await send('新会话准备断线验证。')
    await enable()
    await cancelTest('断开连接', async () => {
      await page.evaluate(async () => {
        const sockets = (window as Window & { voiceTestSockets?: WebSocket[] }).voiceTestSockets ?? []
        await Promise.all(sockets.filter(socket => socket.readyState === WebSocket.OPEN).map(socket => new Promise<void>(resolve => {
          socket.addEventListener('close', () => resolve(), { once: true })
          socket.close()
        })))
      })
      await context.setOffline(true)
    })
    await context.setOffline(false)
    await wait(() => sockets.length >= 2)
    await page.waitForTimeout(500)
    assert.equal(summaryCount(), beforeSummary)
    const afterReconnect = await results()
    await send('重连后自动播报应保持关闭。')
    await page.waitForTimeout(300)
    assert.equal(auxCount(await results()), auxCount(afterReconnect))
    await enable()
    await send('重连后只播报新的正文。')
    await wait(() => summaryCount() === beforeSummary + 1)
    checks.push('同页重连不补播历史；重新开启后只接收未来摘要')
    await page.waitForTimeout(800)
    const audio = await page.evaluate(() => (window as Window & { voiceTestAudio?: object }).voiceTestAudio)
    assert.ok((audio as { start: number }).start > 0)
    checks.push('浏览器真实调用 PCM 播放 API，无需整句解码；音频为测试音调')
    writeFileSync(join(output, 'audio-counters.json'), JSON.stringify(audio, null, 2))
  }
  captured = await results()
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, mode + '.png') })
  console.log(JSON.stringify({ mode, checks, sockets, errors }))
} catch (error) {
  errors.push(clean(String(error)))
  captured = await results().catch(() => undefined)
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  console.error(clean(String(error))); process.exitCode = 1
} finally {
  writeFileSync(join(output, mode + '.json'), JSON.stringify({ mode, checks, sockets, endpoints, events, errors, results: captured }, null, 2))
  await browser.close()
}
