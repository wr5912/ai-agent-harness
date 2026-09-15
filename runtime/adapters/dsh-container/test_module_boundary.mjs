import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateFallback } from './prepare-verification-home.mjs'

const fixture = mkdtempSync(join(tmpdir(), 'dsh-module-boundary-'))
try {
  const root = join(fixture, 'install')
  const packageDir = join(root, 'pkg')
  const outside = join(fixture, 'outside')
  const fallback = join(fixture, 'fallback')
  mkdirSync(packageDir, { recursive: true })
  mkdirSync(outside)
  mkdirSync(fallback)
  writeFileSync(join(packageDir, 'package.json'), '{}')
  writeFileSync(join(outside, 'package.json'), '{}')
  const expected = new Map([['trusted-pkg', packageDir]])
  const trustedRoot = `${root}/`

  assert.equal(validateFallback(fallback, expected, true, trustedRoot), false)
  assert.throws(() => validateFallback(fallback, expected, false, trustedRoot), /missing or extra/)
  symlinkSync(packageDir, join(fallback, 'trusted-pkg'))
  assert.equal(validateFallback(fallback, expected, false, trustedRoot), true)

  writeFileSync(join(fallback, 'evil.js'), 'malicious code')
  assert.throws(() => validateFallback(fallback, expected, false, trustedRoot), /missing or extra/)
  rmSync(join(fallback, 'evil.js'))

  rmSync(join(fallback, 'trusted-pkg'))
  symlinkSync(outside, join(fallback, 'trusted-pkg'))
  assert.throws(() => validateFallback(fallback, expected, false, trustedRoot), /not pinned/)
  rmSync(join(fallback, 'trusted-pkg'))

  writeFileSync(join(fallback, 'trusted-pkg'), 'fake package')
  assert.throws(() => validateFallback(fallback, expected, false, trustedRoot), /not pinned/)
  rmSync(join(fallback, 'trusted-pkg'))

  mkdirSync(join(fallback, '@empty'))
  assert.throws(() => validateFallback(fallback, expected, true, trustedRoot), /empty unknown scope/)
} finally {
  rmSync(fixture, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'trusted-fallback-negative-tests-passed', cases: 6 }))
