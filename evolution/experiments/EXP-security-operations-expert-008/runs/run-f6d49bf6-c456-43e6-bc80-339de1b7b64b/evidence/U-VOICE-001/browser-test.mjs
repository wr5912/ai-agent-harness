import { chromium } from '/opt/dsh/apps/web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
const browser = await chromium.connectOverCDP(process.env.VOICE_CDP_URL)
try {
  const context = browser.contexts()[0]
  await context.grantPermissions(['microphone'], { origin: 'http://127.0.0.1:3102' })
  const page = await context.newPage()
  await page.setViewportSize({width:1600,height:1000})
  await page.addInitScript(() => {
    window.__voiceDecodeCount = 0
    window.__voicePlayCount = 0
    const original = AudioContext.prototype.decodeAudioData
    AudioContext.prototype.decodeAudioData = function(...args) { window.__voiceDecodeCount++; return original.apply(this, args) }
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function(...args) { window.__voicePlayCount++; return start.apply(this, args) }
  })
  const responses = {}
  page.on('response', res => { const path = new URL(res.url()).pathname; if (path.startsWith('/voice-mode/') || path.startsWith('/api/session/prompt')) responses[path] = (responses[path] || 0) + 1 })
  await page.goto('http://127.0.0.1:3102/', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-composer-input]').waitFor({ timeout: 45000 })
  const model = await page.locator('button[title*=' + JSON.stringify('DeepSeek-V41-Flash') + ']').first().getAttribute('title')
  await page.getByRole('button', {name:'新建会话'}).last().click()
  await page.locator('[data-dshvm="mic"]').click()
  console.log('mic-entered', await page.locator('[data-dshvm="mic"]').getAttribute('aria-pressed'))
  let draftSeen = false, sent = false, previous = ''
  for (let i=0;i<30;i++) {
    await page.waitForTimeout(1000)
    const state = await page.evaluate(() => ({ draft:document.querySelector('[data-composer-input]')?.textContent?.trim() || '', user:[...document.querySelectorAll('[data-chat-anchor-key^="13:input-message"]')].map(e=>e.innerText?.trim()).filter(Boolean), replyButtons:document.querySelectorAll('[data-dshvm="reply-speaker"]').length, error:[...document.querySelectorAll('[role="alert"]')].map(e=>e.innerText?.slice(0,120)) }))
    if (state.draft.includes('语音测试')) draftSeen = true
    const signature = JSON.stringify(state)
    if (signature !== previous) { console.log('state',i+1,signature); previous=signature }
    if (state.user.some(x=>x.includes('语音测试'))) {sent=true; break}
  }
  console.log('voice-stage',JSON.stringify({draftSeen,sent,responses}))
  if (await page.locator('[data-dshvm="mic"]').getAttribute('aria-pressed') === 'true') await page.locator('[data-dshvm="mic"]').click({force:true})
  if (!sent) throw new Error('voice-send-not-observed')
  const speaker=page.locator('[data-dshvm="reply-speaker"]').last()
  try {await speaker.waitFor({state:'visible',timeout:120000})} catch(e) {console.log('model-stage',JSON.stringify(await page.evaluate(() => ({alerts:[...document.querySelectorAll('[role="alert"]')].map(x=>x.innerText?.slice(0,120)),body:document.body.innerText.slice(-650)})))); throw e}
  const before=await page.evaluate(()=>window.__voiceDecodeCount)
  const assistant=await page.locator('[data-chat-anchor-key^="14:assistant-step"]').last().innerText()
  console.log('reply-stage',JSON.stringify({replyLength:assistant.trim().length, before, button:await speaker.getAttribute('aria-label')}))
  assert.ok(assistant.trim().length>0)
  await speaker.click()
  await page.waitForFunction(n=>window.__voiceDecodeCount>n,before,{timeout:60000})
  await page.waitForFunction(() => window.__voicePlayCount > 0, undefined, {timeout:60000})
  const result=await page.evaluate(() => ({decoded:window.__voiceDecodeCount,played:window.__voicePlayCount,composerEditable:document.querySelector('[data-composer-input]')?.getAttribute('contenteditable'),user:[...document.querySelectorAll('[data-chat-anchor-key^="13:input-message"]')].map(e=>e.innerText?.trim()).filter(Boolean)}))
  assert.equal(result.user.length,1)
  assert.match(result.user[0],/你好，这是语音测试。/)
  assert.ok(!result.user[0].includes('确认'))
  assert.equal(responses['/api/session/prompt'],1)
  assert.ok(result.decoded>before)
  assert.ok(result.played>0)
  assert.equal(result.composerEditable,'true')
  console.log('full-result',JSON.stringify({...result,model,responses,url:page.url()}))
} finally { await browser.close() }
