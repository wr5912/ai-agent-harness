import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const require = createRequire(process.env.DSH_TYPESCRIPT_ANCHOR || join(root, 'package.json'))
const ts = require('typescript')
for (const [source, output, module, jsx] of [
  ['index.ts', 'index.mjs', ts.ModuleKind.ESNext, undefined],
  ['openapi.ts', 'openapi.mjs', ts.ModuleKind.ESNext, undefined],
  ['client.tsx', 'client.js', ts.ModuleKind.ESNext, ts.JsxEmit.React],
]) {
  const result = ts.transpileModule(readFileSync(join(root, source), 'utf8'), {
    fileName: source,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module, ...(jsx === undefined ? {} : { jsx }), strict: true },
    reportDiagnostics: true,
  })
  const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: name => name,
    getNewLine: () => '\n',
  }))
  writeFileSync(join(root, output), result.outputText)
}
