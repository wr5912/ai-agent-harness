import assert from 'node:assert/strict'
import test from 'node:test'
import { instanceWebUrl } from '../src/instances/url.ts'

test('允许局域网访问时使用当前浏览器主机并保留实例端口及路径', () => {
  const result = { url: 'http://127.0.0.1:3181/assistant/?token=fixture#chat', lan_access: true }
  assert.equal(instanceWebUrl(result, '10.0.0.8'), 'http://10.0.0.8:3181/assistant/?token=fixture#chat')
  assert.equal(instanceWebUrl(result, 'localhost'), 'http://localhost:3181/assistant/?token=fixture#chat')
})

test('本机访问及不允许局域网访问时保留回环地址', () => {
  assert.equal(instanceWebUrl({ url: 'http://127.0.0.1:3181/assistant/', lan_access: true }, '127.0.0.1'), 'http://127.0.0.1:3181/assistant/')
  assert.equal(instanceWebUrl({ url: 'http://127.0.0.1:3181/assistant/', lan_access: false }, '10.0.0.8'), 'http://127.0.0.1:3181/assistant/')
})
