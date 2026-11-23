import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { defaultId, defaultRules, InvalidLiteralTrigger, type SnippetPatch } from './snippet-rules.ts'
import { parseSnippetSource, parseSnippetVariables, SnippetSourceError, type BundledSource } from './snippet-source.ts'
import { createSnippetExpander } from './snippets.ts'
import { defaultPreferences, patchPreferences, type Preferences } from './preferences.ts'
import type { RuntimeSnippets, SaveSettingsResult, SaveSnippet, SaveSnippetResult, SettingsSaveFailure, SettingsSnippet, SettingsSnippets, SourceKind } from './snippet-protocol.ts'

type Entry = SnippetPatch & { source: string; rule: NonNullable<SnippetPatch['rule']> }
type PersistedEntry = Pick<Entry, 'id' | 'enabled' | 'source'>
export type LinkedFile = { uri: string; source: string }
export type LinkedFiles = Partial<Record<SourceKind, LinkedFile>>
export type LinkedRead = LinkedFile | { detail: string }
const FILENAME = 'snippets.json'
const WATCH_IDLE_MS = 20_000
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
const WRITE_LOCK_WAIT_MS = 3500
const LINK_FILE_READ_MS = 2500
const fileTimeout: SettingsSaveFailure = { ok: false, issue: { code: 'file-timeout' } }

async function readLinkedBefore(read: () => Promise<LinkedRead>, deadline: number): Promise<LinkedRead | null> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) return null
  const timer = new AbortController()
  try {
    const file = await Promise.race([read(), delay(remaining, null, { signal: timer.signal })])
    return performance.now() < deadline ? file : null
  } finally {
    timer.abort()
  }
}

function persistedEntry(value: unknown): value is PersistedEntry {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'source' in value && typeof value.source === 'string'
    && 'enabled' in value && typeof value.enabled === 'boolean'
}

function linkedFiles(value: unknown): value is LinkedFiles {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.entries(value).every(([kind, item]) => (kind === 'rules' || kind === 'variables')
      && typeof item?.uri === 'string' && typeof item.source === 'string')
}

function triggerLabel(trigger: Entry['rule']['trigger'] | RegExp): string {
  if (typeof trigger === 'string' || trigger instanceof RegExp) return trigger.toString()
  return '/' + trigger.pattern + '/' + trigger.flags
}

export function createSnippetStore(
  directory: string,
  sources: readonly BundledSource[],
  onLinksChanged?: (files: LinkedFiles) => void,
) {
  if (sources.length !== defaultRules.length) throw new Error('Bundled snippet source and rules disagree')
  const originals = new Map(sources.map((item, index) => [defaultId(index), { ...item, index }]))
  const filename = join(directory, FILENAME)
  const lock = join(directory, 'snippets.lock')
  const staged = join(lock, 'next.json')
  let revision = 0
  let entries: Entry[] = []
  let preferences = { ...defaultPreferences }
  let linked: LinkedFiles = {}
  let runtime = materialize(entries, preferences, linked)
  let loaded = false
  let persisted: string | undefined
  let pending: Promise<unknown> = Promise.resolve()
  const waiters = new Set<(state: RuntimeSnippets | null | 'released') => void>()

  function materialize(next: Entry[], prefs: Preferences, files: LinkedFiles): RuntimeSnippets {
    const variables = {
      ...parseSnippetVariables(prefs.variables),
      ...parseSnippetVariables(files.variables?.source ?? ''),
    }
    const patches = next.map(({ id, enabled, rule }) => ({ id, enabled, rule }))
    if (files.rules) {
      for (const [index, parsed] of parseSnippetSource(files.rules.source, { allowEmpty: true, variables }).entries()) {
        patches.push({ id: 'user:linked:' + index, enabled: true, rule: parsed.rule })
      }
    }
    createSnippetExpander(patches, prefs, variables) // Validate every active regex before making the revision visible.
    return { revision, patches, preferences: prefs, variables }
  }

  function publish(text: string | undefined, next: Entry[], prefs: Preferences, files: LinkedFiles, state: RuntimeSnippets) {
    const pathsChanged = linked.rules?.uri !== files.rules?.uri || linked.variables?.uri !== files.variables?.uri
    entries = next
    preferences = prefs
    linked = files
    persisted = text
    runtime = { ...state, revision: ++revision }
    for (const waiter of waiters) waiter(runtime)
    if (pathsChanged) onLinksChanged?.(linked)
  }

  async function load() {
    let text: string | undefined
    try {
      text = await readFile(filename, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (text !== persisted) {
      if (text === undefined) {
        publish(undefined, [], defaultPreferences, {}, materialize([], defaultPreferences, {}))
      } else {
        const data = JSON.parse(text)
        if (data?.version !== 1 || !Array.isArray(data.entries) || !data.entries.every(persistedEntry)) {
          throw new Error('Invalid persisted snippet data')
        }
        const saved = patchPreferences(defaultPreferences, data.preferences ?? {})
        if (!saved || (data.linked !== undefined && !linkedFiles(data.linked))) throw new Error('Invalid saved Latex Suite settings')
        const files: LinkedFiles = data.linked ?? {}
        const next = (data.entries as PersistedEntry[]).map(entry => {
          const original = originals.get(entry.id)
          if (!original && !entry.id.startsWith('user:')) throw new Error('Invalid persisted snippet identity')
          return { ...entry, rule: parseSnippetSource(entry.source, { preserve: original, single: true })[0].rule }
        })
        publish(text, next, saved, files, materialize(next, saved, files))
      }
    }
    loaded = true
  }

  function settingsState(): SettingsSnippets {
    const changes = new Map(entries.map(entry => [entry.id, entry]))
    const rows: SettingsSnippet[] = sources.map((original, index) => {
      const id = defaultId(index)
      const entry = changes.get(id)
      const rule = entry?.rule ?? defaultRules[index]
      return {
        id, trigger: triggerLabel(rule.trigger), options: rule.options,
        description: rule.description ?? '', enabled: entry?.enabled ?? true,
        source: entry?.source ?? original.source, original: original.source,
      }
    })
    for (const entry of entries) {
      if (!entry.id.startsWith('user:')) continue
      rows.push({
        id: entry.id, trigger: triggerLabel(entry.rule.trigger), options: entry.rule.options,
        description: entry.rule.description ?? '', enabled: entry.enabled,
        source: entry.source, original: null,
      })
    }
    const files: SettingsSnippets['linked'] = {}
    if (linked.rules) files.rules = linked.rules.uri
    if (linked.variables) files.variables = linked.variables.uri
    return { revision, rows, preferences, linked: files }
  }

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = pending.then(work, work)
    pending = next
    return next
  }

  function serialize<T extends SaveSettingsResult>(work: () => Promise<T>): Promise<T | SettingsSaveFailure> {
    return enqueue(async () => {
      try {
        // Read, validate and write under a profile-wide lock, not a per-window queue.
        await mkdir(directory, { recursive: true })
        const retryUntil = performance.now() + WRITE_LOCK_WAIT_MS
        for (;;) {
          try {
            await mkdir(lock)
            break
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            if (performance.now() >= retryUntil) return { ok: false, issue: { code: 'locked', path: lock } }
            await delay(25)
          }
        }
        try {
          await load()
          return await work()
        } finally {
          await rm(staged, { force: true })
          await rmdir(lock)
        }
      } catch (error) {
        if (!(error instanceof Error) || typeof (error as NodeJS.ErrnoException).code !== 'string') throw error
        return { ok: false, issue: { code: 'storage', detail: error.message } }
      }
    })
  }

  async function commit(next: Entry[], prefs: Preferences, files: LinkedFiles): Promise<SaveSettingsResult> {
    let state: RuntimeSnippets
    try {
      state = materialize(next, prefs, files)
    } catch (error) {
      if (error instanceof SnippetSourceError) return { ok: false, issue: error.issue }
      if (error instanceof InvalidLiteralTrigger) return { ok: false, issue: { code: 'trigger' } }
      if (error instanceof SyntaxError) return { ok: false, issue: { code: 'regex' } }
      throw error
    }
    const data = {
      version: 1, preferences: prefs, linked: files,
      entries: next.map(({ id, source, enabled }) => ({ id, source, enabled })),
    }
    const text = JSON.stringify(data, null, 2) + '\n'
    if (Buffer.byteLength(text) > MAX_SNAPSHOT_BYTES) return { ok: false, issue: { code: 'storage', detail: '8 MiB' } }
    await writeFile(staged, text)
    await rename(staged, filename)
    publish(text, next, prefs, files, state)
    return { ok: true, state: settingsState() }
  }

  const invalid: SettingsSaveFailure = { ok: false, issue: { code: 'format' } }

  function putEntry(next: Map<string, Entry>, entry: Entry) {
    if (entry.enabled && entry.source === originals.get(entry.id)?.source) next.delete(entry.id)
    else next.set(entry.id, entry)
  }

  async function save(payload: unknown): Promise<SaveSnippetResult> {
    if (typeof payload !== 'object' || !payload || !('id' in payload)
      || !(payload.id === null || typeof payload.id === 'string')
      || ('source' in payload && typeof payload.source !== 'string')
      || ('enabled' in payload && typeof payload.enabled !== 'boolean')) return invalid
    const draft = payload as SaveSnippet
    const { id } = draft
    if (draft.source === undefined && draft.enabled === undefined) return invalid
    const original = id === null ? undefined : originals.get(id)
    const previous = entries.find(entry => entry.id === id)
    if (id !== null && !original && !previous) return invalid
    const source = draft.source ?? previous?.source ?? original?.source
    const enabled = draft.enabled ?? previous?.enabled ?? (original ? true : undefined)
    if (source === undefined || enabled === undefined) return invalid
    let changes: Entry[]
    try {
      changes = parseSnippetSource(source, { preserve: original, single: id !== null, variables: enabled ? runtime.variables : undefined }).map(
        parsed => ({ ...parsed, id: id ?? 'user:' + randomUUID(), enabled }),
      )
    } catch (error) {
      if (!(error instanceof SnippetSourceError)) throw error
      return { ok: false, issue: error.issue }
    }
    const next = new Map(entries.map(entry => [entry.id, entry]))
    for (const change of changes) putEntry(next, change)
    const result = await commit([...next.values()], preferences, linked)
    return result.ok ? { ...result, selected: changes[0].id } : result
  }

  async function manage(payload: unknown): Promise<SaveSettingsResult> {
    if (!payload || typeof payload !== 'object' || !('action' in payload)
      || (payload.action !== 'enable' && payload.action !== 'disable' && payload.action !== 'delete')
      || !('ids' in payload) || !Array.isArray(payload.ids) || !payload.ids.length
      || payload.ids.some(id => typeof id !== 'string')) return invalid
    const { action } = payload
    const ids = new Set<string>(payload.ids)
    // Default snippets may be disabled, but they must remain available to restore.
    if ([...ids].some(id => !id.startsWith('user:') && (action === 'delete' || !originals.has(id)))) return invalid

    const next = new Map(entries.map(entry => [entry.id, entry]))
    let changed = false
    for (const id of ids) {
      if (action === 'delete') {
        if (next.delete(id)) changed = true
        continue
      }
      const previous = next.get(id)
      const original = originals.get(id)
      if (!previous && !original) continue // A peer may already have removed a custom rule.
      const enabled = action === 'enable'
      if ((previous?.enabled ?? true) === enabled) continue
      changed = true
      if (previous) putEntry(next, { ...previous, enabled })
      else {
        const [parsed] = parseSnippetSource(original!.source, { preserve: original, single: true })
        next.set(id, { ...parsed, id, enabled })
      }
    }
    return changed ? commit([...next.values()], preferences, linked) : { ok: true, state: settingsState() }
  }

  return {
    settings: () => enqueue(async () => { await load(); return settingsState() }),
    files: () => enqueue(async () => { await load(); return { ...linked } }),
    save: (payload: unknown) => serialize(() => save(payload)),
    manage: (payload: unknown) => serialize(() => manage(payload)),
    savePreferences(payload: unknown): Promise<SaveSettingsResult> {
      return serialize(async (): Promise<SaveSettingsResult> => {
        const next = patchPreferences(preferences, payload)
        return next ? commit(entries, next, linked) : { ok: false, issue: { code: 'preferences' } }
      })
    },
    setFile(kind: SourceKind, read: (() => Promise<LinkedRead>) | null): Promise<SaveSettingsResult> {
      const deadline = performance.now() + LINK_FILE_READ_MS
      return serialize(async (): Promise<SaveSettingsResult> => {
        const file = read ? await readLinkedBefore(read, deadline) : null
        if (read && file === null) return fileTimeout
        if (file && 'detail' in file) return { ok: false, issue: { code: 'storage', detail: file.detail } }
        const next = { ...linked }
        if (file) next[kind] = file
        else delete next[kind]
        return commit(entries, preferences, next)
      })
    },
    refreshFile(kind: SourceKind, uri: string, read: () => Promise<LinkedRead>): Promise<SaveSettingsResult> {
      const deadline = performance.now() + LINK_FILE_READ_MS
      return serialize(async (): Promise<SaveSettingsResult> => {
        const current = linked[kind]
        if (current?.uri !== uri) return { ok: true, state: settingsState() }
        // Read only after entering the transaction so an older IO cannot overtake a newer refresh.
        const file = await readLinkedBefore(read, deadline)
        if (file === null) return fileTimeout
        if ('detail' in file) return { ok: false, issue: { code: 'storage', detail: file.detail } }
        if (current.source === file.source) return { ok: true, state: settingsState() }
        return commit(entries, preferences, { ...linked, [kind]: file })
      })
    },
    async watch(value: unknown): Promise<RuntimeSnippets | null | 'released'> {
      if (!loaded) await enqueue(async () => { if (!loaded) await load() })
      if (value !== revision) return runtime
      return new Promise(resolve => {
        const listener = (state: RuntimeSnippets | null | 'released') => {
          clearTimeout(timer)
          waiters.delete(listener)
          resolve(state)
        }
        const timer = setTimeout(() => listener(null), WATCH_IDLE_MS)
        waiters.add(listener)
      })
    },
    releaseWatchers() {
      for (const listener of waiters) listener('released')
    },
  }
}
