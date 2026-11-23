import { randomUUID } from 'node:crypto'
import { env, extensions, RelativePattern, Uri, window, workspace, type ExtensionContext, type FileSystemWatcher } from 'vscode'
import type { AddonDefinition } from '../types/vendor/host/addons/addonRegistry'
import type { AddonRegistrationResult } from '../types/vendor/shared/addonIdentity'
import { createSnippetStore, type LinkedFiles, type LinkedRead } from './snippet-store.ts'
import { snippetTopics, type SourceKind, type SaveSettingsResult, type SettingsSaveFailure, type SourceChoice } from './snippet-protocol.ts'
import type { BundledSource } from './snippet-source.ts'

declare const __BUNDLED_SNIPPET_SOURCES__: readonly BundledSource[]

interface HostExports {
  registerAddon(owner: { id: string }, definition: AddonDefinition): AddonRegistrationResult & { dispose?(): void }
}

async function activate(context: ExtensionContext): Promise<void> {
  const host = extensions.getExtension<HostExports>('onegayi.vsidian')
  if (!host) throw new Error('Vsidian is not available in this extension host')
  let snippets: ReturnType<typeof createSnippetStore>
  const watchers = new Map<SourceKind, { uri: string; watcher: FileSystemWatcher }>()
  const choices = new Map<SourceKind, { ticket: string; uri?: Uri }>()
  const invalid: SettingsSaveFailure = { ok: false, issue: { code: 'format' } }
  const warn = () => window.showWarningMessage(env.language.startsWith('zh')
    ? 'Latex Suite 无法重载关联文件，已保留上一份有效规则。'
    : 'Latex Suite could not reload the linked file. Previous rules remain active.')
  const result = host.exports.registerAddon(context.extension, {
    setup({ settings, storage, channel }) {
      for (const { watcher } of watchers.values()) watcher.dispose()
      watchers.clear()
      choices.clear()
      // Vsidian resolves this storage URI via fsPath, including VS Code's vscode-userdata scheme.
      snippets = createSnippetStore(Uri.parse(storage.uri()).fsPath, __BUNDLED_SNIPPET_SOURCES__, syncFileWatchers)
      settings.registerPage({ entry: 'dist/settings.js', css: ['dist/settings.css'] })
      channel.handle(snippetTopics.settings, snippets.settings)
      channel.handle(snippetTopics.save, snippets.save)
      channel.handle(snippetTopics.manage, snippets.manage)
      channel.handle(snippetTopics.preferences, snippets.savePreferences)
      channel.handle(snippetTopics.choose, chooseSource)
      channel.handle(snippetTopics.link, linkSource)
    },
    enable({ pages, channel, onDispose }) {
      channel.handle(snippetTopics.watch, snippets.watch)
      onDispose(snippets.releaseWatchers)
      pages.registerEditor({ entry: 'dist/editor.js', css: ['dist/editor.css'] })
    },
  })
  if (!result.ok) throw new Error('Vsidian rejected Latex Suite: ' + result.reason)
  context.subscriptions.push({ dispose() {
    for (const { watcher } of watchers.values()) watcher.dispose()
    watchers.clear()
    choices.clear()
    result.dispose?.()
  } })
  await snippets!.files()

  async function readSource(uri: Uri): Promise<LinkedRead> {
    try {
      if ((await workspace.fs.stat(uri)).size > 1024 * 1024) return { detail: '1 MiB' }
      const bytes = await workspace.fs.readFile(uri)
      return { uri: uri.toString(), source: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { detail: error.message }
    }
  }

  function syncFileWatchers(files: LinkedFiles) {
    const store = snippets
    for (const kind of ['variables', 'rules'] as const) {
      const uri = files[kind]?.uri
      const existing = watchers.get(kind)
      if (existing?.uri === uri) continue
      existing?.watcher.dispose()
      if (!uri) {
        watchers.delete(kind)
        continue
      }
      const target = Uri.parse(uri)
      const watcher = workspace.createFileSystemWatcher(new RelativePattern(Uri.joinPath(target, '..'), '*'))
      const binding = { uri, watcher }
      watchers.set(kind, binding)
      const refresh = (changed: Uri) => {
        if (changed.toString() !== uri || watchers.get(kind) !== binding) return
        void store.refreshFile(kind, uri, () => readSource(target)).then(result => {
          if (!result.ok && watchers.get(kind) === binding) void warn()
        }, error => {
          console.error('[Latex Suite] Linked file refresh failed:', error)
          if (watchers.get(kind) === binding) void warn()
        })
      }
      watcher.onDidCreate(refresh)
      watcher.onDidChange(refresh)
      watcher.onDidDelete(refresh)
      // Also catch a file changed while VS Code was closed or before the watcher was bound.
      refresh(target)
    }
  }

  async function chooseSource(kind: unknown): Promise<SourceChoice> {
    if (kind !== 'rules' && kind !== 'variables') return invalid
    const pending: { ticket: string; uri?: Uri } = { ticket: randomUUID() }
    choices.set(kind, pending)
    const selection = await window.showOpenDialog({ canSelectMany: false, canSelectFiles: true, canSelectFolders: false })
    if (!selection || choices.get(kind) !== pending) return null
    pending.uri = selection[0]
    return { ok: true, ticket: pending.ticket }
  }

  async function linkSource(payload: unknown): Promise<SaveSettingsResult> {
    if (!payload || typeof payload !== 'object' || !('kind' in payload)
      || (payload.kind !== 'rules' && payload.kind !== 'variables')
      || !('ticket' in payload) || !(typeof payload.ticket === 'string' || payload.ticket === null)) return invalid
    const { kind, ticket } = payload
    const selected = choices.get(kind)
    const uri = selected?.uri
    if (ticket !== null && (!uri || selected?.ticket !== ticket)) return invalid
    choices.delete(kind)
    return snippets.setFile(kind, ticket === null ? null : () => readSource(uri!))
  }
}

module.exports = { activate }
