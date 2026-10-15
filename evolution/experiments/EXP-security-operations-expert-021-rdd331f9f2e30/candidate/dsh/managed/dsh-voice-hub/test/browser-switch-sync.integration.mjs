/** 设置页切换常开唤醒后，聊天框麦克风应立即反映真实待机状态。 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const logPath = process.env.DSH_WEB_BOOT_LOG
if (!logPath) throw new Error('请设置 DSH_WEB_BOOT_LOG')
const bootUrl = readFileSync(logPath, 'utf8').match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]
if (!bootUrl) throw new Error('启动日志中没有本地 DSH Web 地址')

const browser = await chromium.launch({ executablePath: process.env.DSHVM_CHROME || '/usr/bin/google-chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
let saved
let page
try {
  page = await browser.newPage({ permissions: ['microphone'] })
  await page.goto(bootUrl, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-dshvm="mic"]').waitFor({ timeout: 45000 })
  const later = page.getByRole('button', { name: 'Configure later' })
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  let readySince = 0
  let handledNotice = false
  const onboardingDeadline = Date.now() + 90000
  while (Date.now() < onboardingDeadline) {
    if (await later.isVisible() && await later.isEnabled()) {
      await later.click()
      handledNotice = true
      readySince = 0
    } else if (await proceed.isVisible() && await proceed.isEnabled()) {
      await proceed.click()
      handledNotice = true
      readySince = 0
    }
    else {
      const settingsReady = await page.evaluate(() => {
        const button = document.querySelector('button[aria-label="Settings"]')
        if (!button) return false
        const rect = button.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return hit !== null && button.contains(hit)
      })
      if (settingsReady) {
        if (!readySince) readySince = Date.now()
        if (Date.now() - readySince > (handledNotice ? 1500 : 8000)) break
      } else readySince = 0
    }
    await page.waitForTimeout(250)
  }
  if (Date.now() >= onboardingDeadline) throw new Error('隔离 DSH 首次引导未完成')
  saved = await page.evaluate(async () => (await fetch(new URL('voice-mode/service-config', document.baseURI))).json())
  await page.evaluate(async (config) => fetch(new URL('voice-mode/service-config', document.baseURI), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...config, wakeWord: '小安小安', alwaysListen: false }),
  }), saved)
  await page.evaluate(() => window.dispatchEvent(new Event('dshvm-config-saved')))
  await page.locator('[data-dshvm="mic"][data-dshvm-wake="off"]').waitFor({ timeout: 45000 })

  const settings = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: '语音设置' }).click()
  }
  await settings()
  const wakeSwitch = page.getByRole('checkbox', { name: /常开唤醒/ })
  await wakeSwitch.check()
  assert.equal(await page.locator('[data-dshvm="mic"]').getAttribute('data-dshvm-wake'), 'off', '保存前聊天框状态不应改变')
  await page.getByRole('button', { name: '保存配置' }).click()
  await page.getByText('已保存。常开唤醒及唤醒词在返回聊天页后生效；发送触发词在下次进入语音模式时生效。').waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('[data-dshvm="mic"][data-dshvm-wake="on"]').waitFor({ timeout: 15000 })
  assert.equal(await page.locator('[data-dshvm="mic"] svg path[data-dshvm-wake-glyph="on"]').count(), 2,
    '常开唤醒生效后，聊天框麦克风本体应显示明显的声波图标')
  const on = await page.evaluate(async () => (await fetch(new URL('voice-mode/service-config', document.baseURI))).json())
  assert.equal(on.alwaysListen, true)

  await settings()
  assert.equal(await page.getByRole('checkbox', { name: /常开唤醒/ }).locator('xpath=..').locator('svg').count(), 0,
    '设置项旁不应重复放麦克风图标')
  assert.equal(await page.getByRole('checkbox', { name: /待审批、待回答和计划审阅时播放语音提示/ }).locator('xpath=..').locator('svg').count(), 0,
    '审批提示设置项旁不应重复放喇叭图标')
  const offSwitch = page.getByRole('checkbox', { name: /常开唤醒/ })
  await offSwitch.uncheck()
  assert.equal(await page.locator('[data-dshvm="mic"]').getAttribute('data-dshvm-wake'), 'on', '保存前聊天框状态不应改变')
  await page.getByRole('button', { name: '保存配置' }).click()
  await page.getByText('已保存。常开唤醒及唤醒词在返回聊天页后生效；发送触发词在下次进入语音模式时生效。').waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('[data-dshvm="mic"][data-dshvm-wake="off"]').waitFor({ timeout: 10000 })
  assert.equal(await page.locator('[data-dshvm="mic"] svg path[data-dshvm-wake-glyph="on"]').count(), 0)
  const off = await page.evaluate(async () => (await fetch(new URL('voice-mode/service-config', document.baseURI))).json())
  assert.equal(off.alwaysListen, false)
  console.log('设置开关与聊天框麦克风状态同步：开启、关闭均通过')
} finally {
  if (page && saved) await page.evaluate(async (config) => fetch(new URL('voice-mode/service-config', document.baseURI), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
  }), saved).catch(() => {})
  await browser.close()
}
