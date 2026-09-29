import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const manifest = JSON.parse(readFileSync(new URL('./web-skip-testing-notice/package.json', import.meta.url)))
assert.ok(manifest.name && manifest.version)
assert.equal(manifest.dsh.client.platform, 'web')
let client
vm.runInNewContext(readFileSync(new URL('./web-skip-testing-notice/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: (entry) => { client = entry.factory(() => ({ useEffect: (effect) => effect() })) } } },
})
assert.equal(client.inject[0], 'slots')
let registered
client.apply({ effect: (setup) => setup(), slots: { inject: (_name, register) => register(), register: (options, component) => {
  registered = options
  let completed = false
  component({ complete: () => { completed = true } })
  assert.equal(completed, true)
} } })
assert.equal(registered.id, 'welcome-notice')
assert.equal(registered.priority, -1)
