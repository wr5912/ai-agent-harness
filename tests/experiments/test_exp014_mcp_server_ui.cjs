const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { test } = require('node:test')

test('EXP-014 现成 MCP URL 和请求 Header 可编辑保存，并可切换接入方式',
  { skip: !process.env.TEST_URL || !process.env.PLAYWRIGHT_CORE }, async () => {
    const { chromium } = require(process.env.PLAYWRIGHT_CORE)
    let origin
    const fixture = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/openapi') {
        response.end(JSON.stringify({ openapi: '3.1.0', servers: [{ url: origin }], paths: {
          '/state': { get: { operationId: 'state', summary: '受控资源' } },
          '/state/{id}': { get: { operationId: 'stateById', summary: '按 ID 查询', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] } },
          '/change': { post: { operationId: 'probe_tool', summary: '受控工具' } },
        } }))
        return
      }
      if (request.url !== '/mcp' || request.headers['x-test-token'] !== 'e2e-test-value') {
        response.statusCode = 401
        response.end('{}')
        return
      }
      if (request.method !== 'POST') { response.statusCode = 405; response.end('{}'); return }
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const message = JSON.parse(Buffer.concat(chunks).toString())
      if (message.id === undefined) { response.statusCode = 202; response.end(); return }
      const result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'ui-fixture', version: '1.0.0' } }
        : message.method === 'tools/list' ? { tools: [{ name: 'probe_tool', description: '受控工具', inputSchema: { type: 'object', properties: {} } }] }
          : message.method === 'resources/list' ? { resources: [{ name: '状态', uri: 'probe://state', description: '受控资源' }] }
            : message.method === 'resources/templates/list' ? { resourceTemplates: [{ name: '按 ID 查询', uriTemplate: 'probe://state/{id}' }] } : {}
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    })
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${fixture.address().port}`
    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    const openServer = async (id = 'policy-configuration') => {
      await page.goto(process.env.TEST_URL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '插件', exact: true }).waitFor()
      await page.getByRole('button', { name: '插件', exact: true }).click()
      await page.getByText('MCP 配置管理', { exact: true }).first().click()
      await page.locator('.mcp-manager').waitFor()
      await page.locator('aside[aria-label="服务器列表"] .mcp-list-item').filter({ hasText: id }).first().click()
    }
    const save = async () => {
      await page.getByRole('button', { name: '保存更改' }).click()
      await page.waitForFunction(() => document.querySelector('.mcp-manager [role=status]')?.textContent?.includes('配置已保存'))
    }
    const probeId = 'e2e-ui-convert'
    let probeSaved = false
    try {
      await openServer()
      assert.equal(await page.getByLabel('接入方式').inputValue(), 'mcp')
      assert.equal(await page.getByLabel('OpenAPI 管理 API 地址（可选）').count(), 0)
      const originalUrl = await page.getByLabel('MCP URL', { exact: true }).inputValue()
      assert.match(originalUrl, /^https?:\/\//)
      const originalName = await page.getByLabel('模型可见名称').inputValue()
      await page.getByLabel('接入方式').selectOption('openapi')
      assert.equal(await page.getByLabel('OpenAPI 接口规范地址').count(), 1)
      assert.equal(await page.getByLabel('授权方式').count(), 1)
      assert.equal(await page.getByLabel('模型可见名称').inputValue(), originalName)
      await page.getByLabel('接入方式').selectOption('mcp')
      assert.equal(await page.getByLabel('MCP URL', { exact: true }).inputValue(), originalUrl)

      await page.getByRole('button', { name: '＋ 新增服务器' }).click()
      await page.getByLabel('ID', { exact: true }).fill(probeId)
      await page.getByLabel('接入方式').selectOption('mcp')
      await page.getByLabel('MCP URL', { exact: true }).fill(`${origin}/mcp`)
      await page.getByRole('button', { name: '＋ 添加请求 Header' }).click()
      await page.getByLabel('Header 名称 1').fill('X-Test-Token')
      await page.getByLabel('Header 值 1').fill('e2e-test-value')
      await page.getByRole('checkbox', { name: '启用' }).uncheck()
      await save()
      probeSaved = true

      await openServer(probeId)
      assert.equal(await page.getByLabel('接入方式').inputValue(), 'mcp')
      assert.equal(await page.getByLabel('MCP URL', { exact: true }).inputValue(), `${origin}/mcp`)
      assert.equal(await page.getByLabel('Header 名称 1').inputValue(), 'X-Test-Token')
      assert.equal(await page.getByLabel('Header 值 1').inputValue(), 'e2e-test-value')
      assert.equal(await page.getByLabel('OpenAPI 管理 API 地址（可选）').count(), 0)
      const checkInventory = async (title, resourceUri, templateUri) => {
        await page.getByRole('button', { name: '工具与资源', exact: true }).click()
        await page.getByLabel('服务器').selectOption(probeId)
        await page.getByRole('button', { name: '发现工具与资源' }).click()
        await page.getByRole('heading', { name: title }).waitFor()
        assert.equal(await page.getByText('probe_tool', { exact: true }).count(), 1)
        assert.equal(await page.getByText(`${resourceUri} · 受控资源`, { exact: true }).count(), 1)
        assert.equal(await page.locator('.mcp-catalog li').filter({ hasText: templateUri }).count(), 1)
      }
      await checkInventory('现成 MCP 服务的能力', 'probe://state', 'probe://state/{id}')
      await openServer(probeId)
      await page.getByLabel('接入方式').selectOption('openapi')
      await page.getByLabel('OpenAPI 接口规范地址').fill(`${origin}/openapi`)
      await save()
      await openServer(probeId)
      assert.equal(await page.getByLabel('接入方式').inputValue(), 'openapi')
      assert.equal(await page.getByLabel('OpenAPI 接口规范地址').inputValue(), `${origin}/openapi`)
      assert.equal(await page.getByLabel('MCP URL', { exact: true }).count(), 0)
      await checkInventory('OpenAPI 生成的 MCP 能力', `${origin}/state`, `${origin}/state/{id}`)
    } finally {
      try {
        if (probeSaved) {
          await openServer(probeId)
          page.once('dialog', dialog => dialog.accept())
          await page.getByRole('button', { name: '删除服务器' }).click()
          await save()
          await openServer()
          assert.equal(await page.locator('aside[aria-label="服务器列表"] .mcp-list-item').count(), 4)
          assert.equal(await page.locator('aside[aria-label="服务器列表"] .mcp-list-item').filter({ hasText: probeId }).count(), 0)
        }
      } finally { await browser.close(); await new Promise(resolve => fixture.close(resolve)) }
    }
  })

test('EXP-014 统一 Token 从页面生成；分组端点只接受当前 Token',
  { skip: !process.env.TEST_URL || !process.env.PLAYWRIGHT_CORE }, async () => {
    const { chromium } = require(process.env.PLAYWRIGHT_CORE)
    const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    try {
      await page.goto(process.env.TEST_URL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '插件', exact: true }).click()
      await page.getByText('MCP 配置管理', { exact: true }).first().click()
      await page.getByRole('button', { name: /工具分组/ }).click()
      const status = async token => page.evaluate(async value =>
        (await fetch('/mcp/groups/missing', { headers: value ? { Authorization: `Bearer ${value}` } : {} })).status, token)
      assert.equal(await status(), 401)
      await page.getByRole('button', { name: '生成 Token', exact: true }).click()
      const first = await page.getByLabel('Token', { exact: true }).inputValue()
      assert.match(first, /^[0-9a-f]{64}$/)
      await page.getByRole('button', { name: '保存更改' }).click()
      await page.waitForFunction(() => document.querySelector('.mcp-manager [role=status]')?.textContent?.includes('配置已保存'))
      assert.equal(await status('change-me'), 401)
      assert.equal(await status(first), 404)
      page.once('dialog', dialog => dialog.accept())
      await page.getByRole('button', { name: '重新生成 Token' }).click()
      const second = await page.getByLabel('Token', { exact: true }).inputValue()
      assert.match(second, /^[0-9a-f]{64}$/)
      assert.notEqual(second, first)
      await page.getByRole('button', { name: '保存更改' }).click()
      await page.waitForFunction(() => document.querySelector('.mcp-manager [role=status]')?.textContent?.includes('配置已保存'))
      assert.equal(await status(first), 401)
      assert.equal(await status(second), 404)
    } finally { await browser.close() }
  })
