import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { bundledSnippetSources } from '../src/snippet-source.ts'
import { createSnippetStore } from '../src/snippet-store.ts'
import { createSnippetExpander } from '../src/snippets.ts'

const defaults = bundledSnippetSources(await readFile(new URL('../src/upstream/default_snippets.js', import.meta.url), 'utf8'))

async function profile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'latex-shared-'))
  t.after(() => rm(directory, { recursive: true }))
  return directory
}

test('saves a rule override, notifies an already listening editor, and reloads from disk', { timeout: 1000 }, async t => {
  const directory = await profile(t)
  const store = createSnippetStore(directory, defaults)
  const initial = await store.settings()
  const original = initial.rows.find(row => row.trigger === 'sr')
  assert.match(original.source, /replacement:\s*"\^\{2\}"/)

  const update = store.watch(initial.revision)
  const edited = await store.save({
    id: original.id, enabled: true, source: '{ trigger: "sr", replacement: "^{4}", options: "mA" }',
  })
  assert.equal(edited.ok, true)
  const live = await update
  assert.equal(createSnippetExpander(live.patches)('$xsr', '$', 'inline', 'auto')?.insert, '^{4}')
  const reopened = createSnippetStore(directory, defaults)
  assert.equal(createSnippetExpander((await reopened.watch(-1)).patches)('$xsr', '$', 'inline', 'auto')?.insert, '^{4}')
})

test('a busy profile never publishes the rejected snippet and can save again once released', async t => {
  const directory = await profile(t)
  const lock = join(directory, 'snippets.lock')
  await mkdir(lock)
  const store = createSnippetStore(directory, defaults)
  const draft = { id: null, enabled: true, source: '{ trigger: "u", replacement: "test", options: "mA" }' }
  assert.deepEqual(await store.save(draft), { ok: false, issue: { code: 'locked', path: lock } })
  const active = await store.watch(-1)
  assert.equal(active.revision, 0)
  assert.deepEqual(active.patches, [])
  await assert.rejects(readFile(join(directory, 'snippets.json')), { code: 'ENOENT' })
  await rmdir(lock)
  assert.equal((await store.save(draft)).ok, true)
})

test('persists the options and hot-loads variables before applying them to snippets', async t => {
  const directory = await profile(t)
  const store = createSnippetStore(directory, defaults)
  const initial = await store.settings()
  const waiting = store.watch(initial.revision)
  const applied = await store.savePreferences({ autoFraction: false, variables: '{ TOKEN: "[a-z]" }' })
  assert.equal(applied.ok, true)
  assert.equal((await waiting).preferences.autoFraction, false)

  const source = '{trigger: "(${TOKEN})qq", replacement: "[[0]]^{2}", options: "rmA"}'
  assert.equal((await store.save({id:null,source,enabled:true})).ok, true)
  const restarted = createSnippetStore(directory, defaults)
  const state = await restarted.watch(-1)
  assert.equal(state.variables.TOKEN, '[a-z]')
  assert.equal(createSnippetExpander(state.patches, state.preferences, state.variables)('$xqq', '$', 'inline', 'auto')?.insert, 'x^{2}')
  assert.equal((await restarted.savePreferences({variables:'{ TOKEN: "(" }'})).ok, false)
})

test('a linked file replaces only its own overlay; invalid refresh leaves the last good rules', async t => {
  const store = createSnippetStore(await profile(t), defaults)
  const uri = 'file:///D:/snippets.js'
  const text = replacement => 'export default [{ trigger: "msk", replacement: "' + replacement + '", options: "mA" }]'
  await store.setFile('rules', async () => ({ uri, source: text('^{6}') }))
  assert.equal((await store.settings()).linked.rules, uri)
  assert.equal((await store.refreshFile('rules', uri, async () => ({ uri, source: '[' }))).ok, false)
  const first = await store.watch(-1)
  assert.equal(createSnippetExpander(first.patches)('$xmsk', '$', 'inline', 'auto')?.insert, '^{6}')
  await store.refreshFile('rules', uri, async () => ({ uri, source: text('^{8}') }))
  const second = await store.watch(-1)
  assert.equal(createSnippetExpander(second.patches)('$xmsk', '$', 'inline', 'auto')?.insert, '^{8}')
  await store.setFile('rules', null)
  const third = await store.watch(-1)
  assert.equal(createSnippetExpander(third.patches)('$xmsk', '$', 'inline', 'auto'), null)
})

test('two warm VS Code windows merge concurrent independent saves in the same profile', async t => {
  const directory = await profile(t)
  const open = () => createSnippetStore(directory, defaults)
  const first = open()
  const second = open()
  await Promise.all([first.settings(), second.settings()])

  const results = await Promise.all([
    first.save({ id: null, enabled: true, source: '{ trigger: "window-a", replacement: "alpha", options: "mA" }' }),
    second.savePreferences({ autoFraction: false }),
  ])
  assert.ok(results.every(result => result.ok))
  const reopened = await open().settings()
  assert.equal(reopened.preferences.autoFraction, false)
  assert.equal(reopened.rows.find(row => row.trigger === 'window-a')?.source, '{ trigger: "window-a", replacement: "alpha", options: "mA" }')
})

test('a disabled regex remains editable after its variable is changed, including after restart', async t => {
  const directory = await profile(t)
  const store = createSnippetStore(directory, defaults)
  const source = '{ trigger: "(${LOCAL_TOKEN})review", replacement: "[[0]]", options: "rmA" }'
  assert.equal((await store.savePreferences({ variables: '{ LOCAL_TOKEN: "x" }' })).ok, true)
  const disabled = await store.save({ id: null, source, enabled: false })
  assert.equal(disabled.ok, true)
  assert.equal((await store.savePreferences({ variables: '{ LOCAL_TOKEN: "(" }' })).ok, true)
  const reopened = createSnippetStore(directory, defaults)
  const state = await reopened.settings()
  assert.equal(state.rows.find(row => row.id === disabled.selected)?.enabled, false)
  const enabled = await reopened.save({ id: disabled.selected, source, enabled: true })
  assert.equal(enabled.ok, false)
  assert.equal(enabled.issue.code, 'regex')
  assert.equal((await reopened.settings()).rows.find(row => row.id === disabled.selected)?.enabled, false)
})

test('an explicit empty linked array removes old linked rules without touching local snippets', async t => {
  const directory = await profile(t)
  const store = createSnippetStore(directory, defaults)
  const uri = 'file:///D:/my-rules.js'
  await store.save({ id: null, enabled: true, source: '{ trigger: "@local", replacement: "local", options: "mA" }' })
  const loaded = await store.setFile('rules', async () => ({
    uri, source: 'export default [{ trigger: "@linked", replacement: "from-file", options: "mA" }]',
  }))
  assert.ok(loaded.ok)
  const cleared = await store.refreshFile('rules', uri, async () => ({ uri, source: 'export default []' }))
  assert.ok(cleared.ok)
  assert.equal(cleared.state.linked.rules, uri)
  for (const client of [store, createSnippetStore(directory, defaults)]) {
    const runtime = await client.watch(-1)
    const expand = createSnippetExpander(runtime.patches)
    assert.equal(expand('$@linked', '$', 'inline', 'auto'), null)
    assert.equal(expand('$@local', '$', 'inline', 'auto')?.insert, 'local')
    assert.equal(expand('$xsr', '$', 'inline', 'auto')?.insert, '^{2}')
  }
  assert.deepEqual(await store.save({ id: null, enabled: true, source: '[]' }), {
    ok: false, issue: { code: 'empty', field: undefined, line: 1, column: 1 },
  })
})

test('toggling a stale row does not overwrite a peer’s source edit', async t => {
  const directory = await profile(t)
  const editing = createSnippetStore(directory, defaults)
  const toggling = createSnippetStore(directory, defaults)
  const original = (await toggling.settings()).rows.find(row => row.trigger === 'sr')
  const source = '{ trigger: "sr", replacement: "^{42}", options: "mA" }'
  assert.ok((await editing.save({ id: original.id, source, enabled: true })).ok)
  const saved = await toggling.save({ id: original.id, enabled: false })
  assert.ok(saved.ok)
  const row = (await createSnippetStore(directory, defaults).settings()).rows.find(row => row.id === original.id)
  assert.equal(row.enabled, false)
  assert.equal(row.source, source)
})

test('a later linked-file refresh cannot persist before an older read still in flight', async t => {
  const directory = await profile(t)
  const first = createSnippetStore(directory, defaults)
  const second = createSnippetStore(directory, defaults)
  const uri = 'file:///D:/concurrent.js'
  const source = replacement => '[{ trigger: "qq", options: "mA", replacement: "' + replacement + '" }]'
  await first.setFile('rules', async () => ({ uri, source: source('initial') }))

  const pending = Promise.withResolvers()
  const entered = Promise.withResolvers()
  const newer = Promise.withResolvers()
  const refresh = (client, read) => client.refreshFile('rules', uri, read)
  const firstRefresh = refresh(first, async () => {
    entered.resolve()
    await pending.promise
    return { uri, source: source('old') }
  })
  await entered.promise
  const secondRefresh = refresh(second, async () => {
    newer.resolve()
    return { uri, source: source('latest') }
  })
  const raced = await Promise.race([newer.promise.then(() => true), delay(40, false)])
  pending.resolve()
  assert.equal(raced, false)
  assert.ok((await firstRefresh).ok)
  assert.ok((await secondRefresh).ok)
  assert.equal((await first.files()).rules.source, source('latest'))
})

test('version 1 data with an empty resolved literal can reopen and edit its variable', async t => {
  const directory = await profile(t)
  await writeFile(join(directory, 'snippets.json'), JSON.stringify({
    version: 1,
    preferences: { variables: '{ EMPTY: "" }' },
    entries: [{ id: 'user:legacy-empty', enabled: true,
      source: '{ trigger: "${EMPTY}", replacement: "marker", options: "mA" }' }],
  }))
  const store = createSnippetStore(directory, defaults)
  const unavailable = await store.watch(-1)
  assert.ok((await store.settings()).rows.some(row => row.id === 'user:legacy-empty'))
  assert.equal(createSnippetExpander(unavailable.patches, unavailable.preferences, unavailable.variables)('$xyz', '$', 'inline', 'auto'), null)
  assert.ok((await store.savePreferences({ variables: '{ EMPTY: "revive" }' })).ok)
  const active = await store.watch(-1)
  assert.equal(createSnippetExpander(active.patches, active.preferences, active.variables)('$revive', '$', 'inline', 'auto')?.insert, 'marker')
})

test('a stalled linked read times out without writing or blocking another window’s save', async t => {
  const directory = await profile(t)
  const first = createSnippetStore(directory, defaults)
  const second = createSnippetStore(directory, defaults)
  const entered = Promise.withResolvers()
  const provider = Promise.withResolvers()
  const linking = first.setFile('rules', () => { entered.resolve(); return provider.promise })
  await entered.promise
  const unrelated = second.savePreferences({ autoFraction: false })
  const timer = new AbortController()
  const result = await Promise.race([linking, delay(3250, null, { signal: timer.signal })])
  timer.abort()
  provider.resolve({ uri: 'file:///stalled.js', source: '[]' })
  await linking
  const saved = await unrelated

  assert.deepEqual(result, { ok: false, issue: { code: 'file-timeout' } })
  assert.ok(saved.ok)
  assert.deepEqual((await second.settings()).linked, {})
  assert.equal((await second.settings()).preferences.autoFraction, false)
})

test('a batch updates Live and disk once, and only custom rules can be deleted', async t => {
  const dir = await profile(t)
  const store = createSnippetStore(dir, defaults)
  t.after(store.releaseWatchers)
  const added = await store.save({ id: null, enabled: true, source: '[{trigger:"@onebatch", replacement:"one", options:"mA"},{trigger:"@twobatch", replacement:"two", options:"mA"}]' })
  assert.ok(added.ok)
  const one = added.state.rows.find(row => row.trigger === '@onebatch')
  const two = added.state.rows.find(row => row.trigger === '@twobatch')
  const square = added.state.rows.find(row => row.trigger === 'sr')
  const pending = store.watch(added.state.revision)
  const disabled = await store.manage({ action: 'disable', ids: [one.id, two.id, square.id] })
  assert.ok(disabled.ok)
  assert.equal(disabled.state.revision, added.state.revision + 1)
  const live = await pending
  const expand = createSnippetExpander(live.patches)
  assert.equal(expand('$xsr', '$', 'inline', 'auto'), null)
  assert.equal(expand('$@onebatch', '$', 'inline', 'auto'), null)

  const refused = await store.manage({ action: 'delete', ids: [one.id, square.id] })
  assert.equal(refused.ok, false)
  assert.equal((await store.settings()).rows.find(row => row.id === one.id).enabled, false)

  const enabled = await store.manage({ action: 'enable', ids: [one.id, square.id] })
  assert.ok(enabled.ok)
  const removed = await store.manage({ action: 'delete', ids: [one.id, two.id] })
  assert.ok(removed.ok)
  assert.equal(removed.state.rows.some(row => row.id === one.id || row.id === two.id), false)
  const restored = createSnippetStore(dir, defaults)
  const state = await restored.watch(-1)
  assert.equal(createSnippetExpander(state.patches)('$xsr', '$', 'inline', 'auto')?.insert, '^{2}')
  assert.equal(createSnippetExpander(state.patches)('$@onebatch', '$', 'inline', 'auto'), null)
})
