import assert from 'node:assert/strict'
import { apply } from './web-unsafe-no-auth/index.js'
import { readFileSync } from 'node:fs'

const original = {
  requestRejection: () => 403,
  authorizeIndex: () => false,
  authenticatedUrl: (url) => `${url}?token=existing`,
}
const connection = Object.create(original)
let dispose
apply({ connection, effect: (setup) => { dispose = setup() } })
assert.equal(connection.requestRejection({ headers: { host: 'evil.invalid' } }), undefined)
assert.equal(connection.authorizeIndex({}, {}), true)
assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080/'), 'http://127.0.0.1:3080/')
dispose()
assert.equal(connection.requestRejection({}), 403)
assert.equal(connection.authorizeIndex({}, {}), false)
assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080/'), 'http://127.0.0.1:3080/?token=existing')

const manifest = JSON.parse(readFileSync(new URL('./web-unsafe-no-auth/package.json', import.meta.url)))
assert.equal(manifest.dsh, undefined)
assert.equal(manifest.exports['./client'], undefined)
