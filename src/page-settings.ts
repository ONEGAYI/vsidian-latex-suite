import { defineAddonPage } from 'vsidian-addon-sdk'
import { snippetTopics, type SaveSettingsResult, type SaveSnippet, type SaveSnippetResult, type SnippetDraft, type SnippetManagement, type SettingsSnippet, type SettingsSnippets } from './snippet-protocol.ts'
import { snippetSettingsText } from './settings-text.ts'
import { mountSettingsDirectory } from './settings-directory.ts'
import './settings.css'

const newSource = '{\n  trigger: "",\n  replacement: "",\n  options: "mA",\n}'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, name?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (name) node.className = name
  return node
}

function actionButton(text: string, style = 'ls-secondary'): HTMLButtonElement {
  const button = element('button', style)
  button.type = 'button'
  button.textContent = text
  return button
}

defineAddonPage('ONEGAYI.vsidian-latex-suite', async sdk => {
  const root = sdk.mountRoot()
  if (!root) throw new Error('Missing Latex Suite settings mount root')
  const language = sdk.locale?.get() ?? 'en'
  const copy = snippetSettingsText(language)
  const { label } = copy
  const section = element('section', 'ls-snippets')
  const header = element('header', 'ls-snippet-head')
  const title = element('h4')
  title.textContent = label.title
  const add = element('button', 'ls-secondary')
  add.type = 'button'
  add.textContent = label.add
  add.disabled = true
  header.append(title, add)
  const scope = element('p', 'ls-snippet-scope')
  scope.textContent = label.scope
  const status = element('p', 'ls-snippet-status')
  status.setAttribute('role', 'status')
  status.textContent = label.load

  const grid = element('div', 'ls-snippet-grid')
  grid.hidden = true
  const search = element('input', 'ls-snippet-search')
  search.type = 'search'
  search.placeholder = label.search
  search.setAttribute('aria-label', label.search)
  const list = element('div', 'ls-snippet-list')
  list.setAttribute('role', 'group')
  list.setAttribute('aria-label', label.list)
  const selection = element('div', 'ls-snippet-selection')
  const resultsLabel = element('label')
  const all = element('input')
  all.type = 'checkbox'
  resultsLabel.append(all, label.selectResults)
  const count = element('span', 'ls-snippet-count')
  count.setAttribute('aria-live', 'polite')
  const clear = actionButton(label.clearSelection, 'ls-snippet-quiet')
  selection.append(resultsLabel, count, clear)
  const bulk = element('div', 'ls-snippet-bulk')
  bulk.setAttribute('role', 'group')
  bulk.setAttribute('aria-label', label.batchActions)
  const enableSelected = actionButton(label.batchEnable)
  const disableSelected = actionButton(label.batchDisable)
  const removeSelected = actionButton(label.deleteSelected, 'ls-snippet-danger')
  bulk.append(enableSelected, disableSelected, removeSelected)
  const toolbar = element('div', 'ls-snippet-toolbar')
  toolbar.append(search, selection, bulk)

  const form = element('form', 'ls-snippet-form')
  const heading = element('div', 'ls-snippet-detail-head')
  const selectedTitle = element('code')
  const origin = element('span', 'ls-snippet-tag')
  const enabledLabel = element('label', 'ls-snippet-enable')
  const enabled = element('input')
  enabled.type = 'checkbox'
  const enabledText = element('span')
  enabledText.textContent = label.enabled
  enabledLabel.append(enabled, enabledText)
  heading.append(selectedTitle, origin, enabledLabel)

  const source = element('textarea', 'ls-snippet-source')
  source.spellcheck = false
  source.setAttribute('aria-label', label.source)
  const hint = element('p', 'ls-snippet-hint')
  const actions = element('div', 'ls-snippet-actions')
  const save = element('button', 'ls-primary')
  save.type = 'submit'
  save.textContent = label.save
  const restore = element('button', 'ls-secondary')
  restore.type = 'button'
  restore.textContent = label.restore
  const removeOne = actionButton(label.deleteOne, 'ls-snippet-danger')
  actions.append(save, restore, removeOne)
  form.append(heading, source, hint, actions)
  grid.append(toolbar, list, form)
  const dialog = element('dialog', 'ls-snippet-dialog')
  dialog.setAttribute('aria-label', label.deleteTitle)
  const deleteTitle = element('h4')
  deleteTitle.textContent = label.deleteTitle
  const deletePrompt = element('p')
  const deleteActions = element('div', 'ls-snippet-actions')
  const cancelDelete = actionButton(label.cancel)
  cancelDelete.autofocus = true
  const confirmDelete = actionButton(label.deleteConfirm, 'ls-snippet-danger')
  deleteActions.append(cancelDelete, confirmDelete)
  dialog.append(deleteTitle, deletePrompt, deleteActions)
  section.append(header, scope, grid, status, dialog)
  root.append(section)

  const initial = await sdk.channel.request(snippetTopics.settings, null)
  if (!initial.ok) {
    if (initial.reason !== 'released') report(label.unavailable, true)
    return
  }
  let state = initial.result as SettingsSnippets
  let selected: SettingsSnippet | null = state.rows[0]
  let saving = false
  const drafts = new Map<string | null, SnippetDraft>()
  const checked = new Set<string>()
  const checks = new Map<string, HTMLInputElement>()
  let deleting: string[] = []

  function report(text: string, error = false) {
    status.textContent = text
    status.classList.toggle('ls-snippet-error', error)
  }

  function matchingRows() {
    const query = search.value.trim().toLowerCase()
    return state.rows.filter(row => !query || (row.trigger + ' ' + row.description).toLowerCase().includes(query))
  }

  function updateSelection() {
    let visibleCount = 0
    for (const [id, input] of checks) {
      input.checked = checked.has(id)
      input.disabled = saving
      if (input.checked) visibleCount++
    }
    all.checked = checks.size > 0 && visibleCount === checks.size
    all.indeterminate = visibleCount > 0 && !all.checked
    all.disabled = saving || checks.size === 0
    const selectionText = copy.selectionCount(checked.size)
    if (count.textContent !== selectionText) count.textContent = selectionText
    clear.disabled = enableSelected.disabled = disableSelected.disabled = saving || checked.size === 0
    removeSelected.disabled = saving || !state.rows.some(row => checked.has(row.id) && row.original === null)
  }

  function drawList() {
    checks.clear()
    const rows = matchingRows()
    const items = rows.map(row => {
      const item = element('div', 'ls-snippet-row')
      const check = element('input', 'ls-snippet-check')
      check.type = 'checkbox'
      check.setAttribute('aria-label', copy.selectRule(row.trigger))
      checks.set(row.id, check)
      check.addEventListener('change', () => {
        if (check.checked) checked.add(row.id)
        else checked.delete(row.id)
        updateSelection()
      })
      const button = element('button', 'ls-snippet-rule')
      button.type = 'button'
      button.setAttribute('aria-pressed', row.id === selected?.id ? 'true' : 'false')
      const key = element('code')
      key.textContent = row.trigger
      const options = element('small')
      options.textContent = row.options
      button.append(key, options)
      if (!row.enabled) {
        const disabled = element('small')
        disabled.className = 'ls-snippet-disabled'
        disabled.textContent = label.disabled
        button.append(disabled)
      }
      button.disabled = saving
      button.addEventListener('click', () => select(row))
      item.append(check, button)
      return item
    })
    if (items.length) list.replaceChildren(...items)
    else {
      const noResults = element('p', 'ls-snippet-empty')
      noResults.textContent = label.empty
      list.replaceChildren(noResults)
    }
    updateSelection()
  }

  function updateControls() {
    save.disabled = saving || (selected !== null && !drafts.has(selected.id))
    add.disabled = saving
    enabled.disabled = saving
    source.readOnly = saving
    restore.disabled = removeOne.disabled = saving
    removeOne.hidden = selected?.original !== null
    for (const button of list.querySelectorAll('button')) button.disabled = saving
    updateSelection()
    restore.hidden = !selected?.original || (source.value === selected.original && enabled.checked)
  }

  function select(row: SettingsSnippet | null, message?: string) {
    selected = row
    const draft = drafts.get(row?.id ?? null)
    source.value = draft?.source ?? row?.source ?? newSource
    enabled.checked = draft?.enabled ?? row?.enabled ?? true
    selectedTitle.textContent = row?.trigger ?? label.newTitle
    origin.textContent = row?.original ? label.builtin : label.custom
    hint.textContent = row?.original && /\breplacement:\s*(?:function\b|\([^)]*\)\s*=>)/.test(row.original)
      ? label.functionHint : label.hint
    source.removeAttribute('aria-invalid')
    updateControls()
    drawList()
    report(message ?? (draft ? label.pending : ''))
  }

  function updateDraft(change: SnippetDraft, explicitReset = false) {
    const id = selected?.id ?? null
    const patch = { ...drafts.get(id), ...change }
    if (!explicitReset) {
      if ('source' in change && change.source === selected?.source) delete patch.source
      if ('enabled' in change && change.enabled === selected?.enabled) delete patch.enabled
    }
    if (patch.source !== undefined || patch.enabled !== undefined) {
      drafts.set(id, patch)
      report(label.pending)
    } else {
      drafts.delete(id)
      report('')
    }
    source.removeAttribute('aria-invalid')
    updateControls()
  }

  grid.hidden = false
  search.addEventListener('input', drawList)
  source.addEventListener('input', () => updateDraft({ source: source.value }))
  enabled.addEventListener('change', () => updateDraft({ enabled: enabled.checked }))
  add.addEventListener('click', () => { select(null); source.focus() })
  restore.addEventListener('click', () => {
    source.value = selected!.original!
    enabled.checked = true
    updateDraft({ source: source.value, enabled: true }, true)
    source.focus()
  })
  all.addEventListener('change', () => {
    for (const id of checks.keys()) {
      if (all.checked) checked.add(id)
      else checked.delete(id)
    }
    updateSelection()
  })
  clear.addEventListener('click', () => { checked.clear(); updateSelection(); all.focus() })
  enableSelected.addEventListener('click', () => void manage('enable', [...checked]))
  disableSelected.addEventListener('click', () => void manage('disable', [...checked]))
  removeSelected.addEventListener('click', () => askDelete(state.rows.filter(row => checked.has(row.id) && row.original === null)))
  removeOne.addEventListener('click', () => askDelete([selected!]))

  cancelDelete.addEventListener('click', () => dialog.close())
  confirmDelete.addEventListener('click', () => {
    dialog.close()
    void manage('delete', deleting)
  })

  function askDelete(rows: SettingsSnippet[]) {
    deleting = rows.map(row => row.id)
    const names = rows.slice(0, 3).map(row => row.trigger).join(', ') + (rows.length > 3 ? '…' : '')
    deletePrompt.textContent = copy.deletePrompt(rows.length, names)
    dialog.showModal()
  }

  async function requestChange<Result extends SaveSettingsResult>(
    topic: string, payload: unknown, editSource = false,
  ): Promise<Extract<Result, { ok: true }> | undefined> {
    if (saving) return
    saving = true
    updateControls()
    report(label.saving)
    const outcome = await sdk.channel.request(topic, payload)
    if (!outcome.ok && outcome.reason === 'released') return
    saving = false
    updateControls()
    if (!outcome.ok) {
      report(label.unavailable, true)
      return
    }
    const result = outcome.result as Result
    if (!result.ok) {
      const issue = result.issue
      if (issue.code === 'storage') report(label.storage + ' ' + issue.detail, true)
      else if (issue.code === 'locked') report(label.locked + ' ' + issue.path, true)
      else if (issue.code === 'file-timeout') report(label.fileTimeout, true)
      else if (issue.code === 'preferences') report(label.unavailable, true)
      else {
        if (editSource) source.setAttribute('aria-invalid', 'true')
        const detail = issue.field ? ' ' + issue.field : ''
        const location = issue.line ? ' (' + issue.line + ':' + issue.column + ')' : ''
        report(copy.issue[issue.code] + detail + location, true)
      }
      return
    }
    return result as Extract<Result, { ok: true }>
  }

  async function manage(action: SnippetManagement['action'], ids: string[]) {
    const result = await requestChange<SaveSettingsResult>(snippetTopics.manage, { action, ids })
    if (!result) return
    receive(result.state)
    for (const id of ids) {
      if (action === 'delete') {
        drafts.delete(id)
        checked.delete(id)
      } else {
        const draft = drafts.get(id)
        if (draft?.source !== undefined) drafts.set(id, { source: draft.source })
        else drafts.delete(id)
      }
    }
    const active = selected && (state.rows.find(row => row.id === selected!.id) ?? matchingRows()[0] ?? state.rows[0])
    select(active, label.saved)
    if (action === 'delete') search.focus()
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (save.disabled) return
    const id = selected?.id ?? null
    const payload: SaveSnippet = id === null
      ? { id, source: source.value, enabled: enabled.checked } : { id, ...drafts.get(id) }
    const result = await requestChange<SaveSnippetResult>(snippetTopics.save, payload, true)
    if (!result) return
    drafts.delete(id)
    receive(result.state)
    const row = state.rows.find(item => item.id === result.selected)
    if (row && !matchingRows().includes(row)) search.value = ''
    select(row ?? matchingRows()[0] ?? state.rows[0], label.saved)
  })

  function receive(next: SettingsSnippets) {
    if (next.revision < state.revision) return
    state = next
    const ids = new Set(next.rows.map(row => row.id))
    for (const id of checked) if (!ids.has(id)) checked.delete(id)
  }

  select(selected)
  mountSettingsDirectory(root, section, sdk, language, () => state, receive)
})
