import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const { name } = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  legalComments: 'none',
})
await build({
  entryPoints: ['src/client.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  loader: { '.svg': 'dataurl' },
  external: ['react', 'react/jsx-runtime'],
  legalComments: 'none',
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{const module={exports:{}};const exports=module.exports;`,
  },
  footer: { js: 'return module.exports;}});' },
})
