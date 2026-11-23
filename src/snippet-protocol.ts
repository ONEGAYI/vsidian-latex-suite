import type { SnippetPatch } from './snippet-rules.ts'
import type { SnippetIssue } from './snippet-source.ts'
import type { Preferences } from './preferences.ts'

export const snippetTopics = {
  settings: 'snippets.settings',
  save: 'snippets.save',
  manage: 'snippets.manage',
  watch: 'snippets.watch',
  preferences: 'snippets.preferences',
  choose: 'snippets.choose',
  link: 'snippets.link',
}

export type SourceKind = 'rules' | 'variables'
export type RuntimeSnippets = {
  revision: number
  patches: readonly SnippetPatch[]
  preferences: Preferences
  variables: Readonly<Record<string, string>>
}

export type SettingsSnippet = {
  id: string
  trigger: string
  options: string
  description: string
  source: string
  enabled: boolean
  original: string | null
}

export type SettingsSnippets = {
  revision: number
  rows: SettingsSnippet[]
  preferences: Preferences
  linked: Partial<Record<SourceKind, string>>
}

export type SnippetDraft = { source?: string; enabled?: boolean }
export type SaveSnippet = ({ id: string } & SnippetDraft) | { id: null; source: string; enabled: boolean }
export type SnippetManagement = { action: 'enable' | 'disable' | 'delete'; ids: string[] }
export type SettingsSaveFailure = { ok: false; issue: SnippetIssue | { code: 'storage'; detail: string } | { code: 'locked'; path: string } | { code: 'file-timeout' } | { code: 'preferences' } }

export type SaveSettingsResult = { ok: true; state: SettingsSnippets } | SettingsSaveFailure
export type SaveSnippetResult = { ok: true; state: SettingsSnippets; selected: string } | SettingsSaveFailure

export type SourceChoice = { ok: true; ticket: string } | SettingsSaveFailure | null
