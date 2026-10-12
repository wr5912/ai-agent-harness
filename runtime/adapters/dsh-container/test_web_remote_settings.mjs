import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply } from './web-remote-settings/index.js'

let injectIndex
apply({ on(event, listener) {
  assert.equal(event, 'webserver/index-inject')
  injectIndex = listener
} })
const rows = []
injectIndex(rows)
assert.deepEqual(rows, [{ kind: 'global', name: '__DSH_REMOTE_HOST_SETTINGS__', value: true }])
const manifest = JSON.parse(readFileSync(new URL('./web-remote-settings/package.json', import.meta.url)))
assert.ok(manifest.name && manifest.version)
