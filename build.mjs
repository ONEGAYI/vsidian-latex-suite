import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createSdkBridgePlugin } from './tools/sdkBridge.mjs'
import { CM6_RUNTIME_MARKERS } from './tools/cm6Markers.mjs'
import { bundledSnippetSources } from './src/snippet-source.ts'

const root = fileURLToPath(new URL('.', import.meta.url))
const sources = bundledSnippetSources(await readFile(new URL('./src/upstream/default_snippets.js', import.meta.url), 'utf8'))
const pages = ['editor', 'settings']
await Promise.all([
  build({
    absWorkingDir: root, entryPoints: ['src/extension.cts'], outfile: 'dist/extension.cjs',
    bundle: true, platform: 'node', format: 'cjs', target: 'node18', external: ['vscode'],
    define: { __BUNDLED_SNIPPET_SOURCES__: JSON.stringify(sources) },
  }),
  ...pages.map(page => build({
    absWorkingDir: root, entryPoints: ['src/page-' + page + '.ts'], outfile: 'dist/' + page + '.js',
    bundle: true, platform: 'browser', format: 'iife', target: 'chrome114', minify: true,
    plugins: [createSdkBridgePlugin()],
  })),
])

for (const page of pages) {
  const product = await readFile(new URL('./dist/' + page + '.js', import.meta.url), 'utf8')
  for (const marker of CM6_RUNTIME_MARKERS) {
    if (product.includes(marker)) throw new Error(page + ' bundle includes a second CM6 runtime: ' + marker)
  }
}
