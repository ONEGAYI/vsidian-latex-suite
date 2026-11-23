import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { bundledSnippetSources } from '../src/snippet-source.ts'
import { createSnippetStore } from '../src/snippet-store.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const sources = bundledSnippetSources(await readFile(new URL('../src/upstream/default_snippets.js', import.meta.url), 'utf8'))
const { outputFiles: [bundle] } = await build({
  absWorkingDir: root, entryPoints: ['src/extension.cts'], write: false,
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'],
  define: { __BUNDLED_SNIPPET_SOURCES__: JSON.stringify(sources) },
})

function profile(t) {
  return mkdtemp(join(tmpdir(), 'latex-link-')).then(directory => {
    t.after(() => rm(directory, { recursive: true }))
    return directory
  })
}

async function openWindow(t, directory, documents) {
  const handlers = new Map()
  const watched = new Map()
  let finishDialog
  const uriOf = uri => ({ scheme: uri.split(':')[0], fsPath: directory, toString: () => uri })
  const subscriptions = []
  const api = {
    extensions: { getExtension: () => ({ exports: { registerAddon(_, definition) {
      definition.setup({
        storage: { uri: () => 'vscode-userdata:///profile' },
        settings: { registerPage() {} },
        channel: { handle(topic, handler) { handlers.set(topic, handler) } },
      })
      return { ok: true }
    } } }) },
    Uri: { parse: uriOf, joinPath: uri => uri },
    RelativePattern: class { constructor(uri) { this.uri = uri } },
    env: { language: 'en' },
    window: {
      showOpenDialog: () => new Promise(resolve => { finishDialog = resolve }),
      showWarningMessage: text => assert.fail(text),
    },
    workspace: {
      fs: {
        stat: async uri => ({ size: Buffer.byteLength(documents.get(uri.toString())) }),
        readFile: async uri => Buffer.from(documents.get(uri.toString())),
      },
      createFileSystemWatcher({ uri }) {
        const name = uri.toString()
        const state = { onDidCreate() {}, onDidChange(fn) { this.change = fn }, onDidDelete() {}, dispose() { watched.delete(name) } }
        watched.set(name, state)
        return state
      },
    },
  }
  const exports = { exports: {} }
  const fromNode = createRequire(import.meta.url)
  new Function('require', 'module', bundle.text)(id => id === 'vscode' ? api : fromNode(id), exports)
  await exports.exports.activate({ extension: {}, subscriptions })
  t.after(() => subscriptions.forEach(item => item.dispose()))
  return { handlers, watched, finish: uri => finishDialog([uriOf(uri)]), change: uri => watched.get(uri).change(uriOf(uri)) }
}

test('even a picker completing after the page is gone cannot link the file until confirmed', async t => {
  const directory = await profile(t)
  const chosenPath = 'file:///fixture/snippets.js'
  const window = await openWindow(t, directory, new Map([[chosenPath, 'export default []']]))
  const choose = () => window.handlers.get('snippets.choose')('rules')
  const commit = window.handlers.get('snippets.link')
  const settings = window.handlers.get('snippets.settings')

  const late = choose()
  assert.deepEqual((await settings()).linked, {})
  window.finish(chosenPath)
  const abandoned = await late
  assert.deepEqual((await settings()).linked, {}, 'a result that the page never confirms must not persist')
  const active = choose()
  window.finish(chosenPath)
  const selected = await active
  assert.equal(selected.ok, true)
  assert.equal((await commit({ kind: 'rules', ticket: abandoned.ticket })).ok, false)
  const linked = await commit({ kind: 'rules', ticket: selected.ticket })
  assert.ok(linked.ok)
  assert.equal(linked.state.linked.rules, chosenPath)
  assert.equal((await commit({ kind: 'rules', ticket: selected.ticket })).ok, false)
  assert.deepEqual((await settings()).linked, { rules: chosenPath })
})

test('fresh shared settings rebind the current window’s watcher to the new file', async t => {
  const directory = await profile(t)
  const writer = createSnippetStore(directory, sources)
  const first = 'file:///one/rules.js'
  const second = 'file:///two/rules.js'
  const documents = new Map([[first, '[]'], [second, '[]']])
  assert.ok((await writer.setFile('rules', async () => ({ uri: first, source: documents.get(first) }))).ok)
  const reader = await openWindow(t, directory, documents)
  assert.deepEqual([...reader.watched.keys()], [first])
  assert.ok((await writer.setFile('rules', async () => ({ uri: second, source: documents.get(second) }))).ok)
  assert.deepEqual((await reader.handlers.get('snippets.settings')()).linked, { rules: second })
  assert.deepEqual([...reader.watched.keys()], [second])

  const latest = '[{ trigger: "qq", replacement: "reloaded", options: "mA" }]'
  documents.set(second, latest)
  reader.change(second)
  await reader.handlers.get('snippets.settings')()
  assert.equal((await writer.files()).rules.source, latest)
})

test('relinking the same URI reads the current file rather than the picked snapshot', async t => {
  const directory = await profile(t)
  const uri = 'file:///fixture/snippets.js'
  const documents = new Map([[uri, '[]']])
  const writer = createSnippetStore(directory, sources)
  assert.ok((await writer.setFile('rules', async () => ({ uri, source: documents.get(uri) }))).ok)
  const window = await openWindow(t, directory, documents)
  const choosing = window.handlers.get('snippets.choose')('rules')
  window.finish(uri)
  const chosen = await choosing
  assert.ok(chosen.ok)

  const latest = '[{ trigger: "qq", replacement: "latest", options: "mA" }]'
  documents.set(uri, latest)
  window.change(uri)
  await window.handlers.get('snippets.settings')()
  assert.equal((await writer.files()).rules.source, latest)

  assert.ok((await window.handlers.get('snippets.link')({ kind: 'rules', ticket: chosen.ticket })).ok)
  assert.equal((await writer.files()).rules.source, latest)
})
