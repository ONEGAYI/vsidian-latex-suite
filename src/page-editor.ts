import type { EditorView, KeyBinding } from '@codemirror/view'
import { defineAddonPage } from 'vsidian-addon-sdk'
import { activeGroups, isMath, createSnippetExpander, type Expansion, type Stop } from './snippets.ts'
import { fraction, mathRegion, type MathRegion } from './math.ts'
import { bracketPairs, enlargement, fencedMathRegion, matrixEdit, taboutOffset } from './math-features.ts'
import { mathAppearance } from './math-appearance.ts'
import './editor-features.css'

type Action = 'next' | 'manual' | 'placeholder' | 'previous' | 'fraction' | 'row' | 'cell' | 'exit' | 'tabout' | 'delete-empty' | { key: string; fraction?: boolean }
import { snippetTopics, type RuntimeSnippets } from './snippet-protocol.ts'

const names = {
  en: {
    next: 'LaTeX: Expand snippet or move forward',
    previous: 'LaTeX: Previous placeholder',
    fraction: 'LaTeX: Make fraction',
    manual: 'LaTeX: Expand manual snippet',
    placeholder: 'LaTeX: Next placeholder',
    row: 'LaTeX: New matrix row',
    cell: 'LaTeX: New matrix cell',
    exit: 'LaTeX: Exit matrix',
    tabout: 'LaTeX: Move past delimiter',
  },
  'zh-cn': {
    next: 'LaTeX：展开片段或向后跳转',
    previous: 'LaTeX：上一个占位符',
    fraction: 'LaTeX：生成分式',
    manual: 'LaTeX：展开手动片段',
    placeholder: 'LaTeX：下一占位符',
    row: 'LaTeX：新建矩阵行',
    cell: 'LaTeX：新建矩阵单元格',
    exit: 'LaTeX：退出矩阵',
    tabout: 'LaTeX：跳出括号',
  },
}

defineAddonPage('ONEGAYI.vsidian-latex-suite', async sdk => {
  const { cm6, syntax, viewIdentity } = sdk.experimental
  const { commands } = sdk
  if (!cm6 || !syntax || !viewIdentity || !commands) throw new Error('Missing Latex Suite editor SDK capabilities')

  const first = await sdk.channel.request(snippetTopics.watch, -1)
  if (!first.ok) {
    if (first.reason !== 'timeout') return
    throw new Error('Latex Suite snippet configuration timed out')
  }
  const initial = first.result as RuntimeSnippets
  let revision = initial.revision
  let prefs = initial.preferences
  let expandSnippet = createSnippetExpander(initial.patches, prefs, initial.variables)

  const { EditorState, EditorSelection, StateEffect, StateField, Prec, ChangeSet, Compartment } = cm6.state
  const { EditorView, ViewPlugin, keymap } = cm6.view
  const { instanceIdOf } = viewIdentity
  const { lineTypeAt, inlineAt } = syntax
  type Session = { stops: Stop[][]; index: number }
  const setSession = StateEffect.define<Session | null>()
  const session = StateField.define<Session | null>({
    create: () => null,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setSession)) return effect.value
      }
      if (!value || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return null
      const stops = !tr.docChanged ? value.stops : value.stops.map(group => group.map(stop => ({
        from: tr.changes.mapPos(stop.from, -1), to: tr.changes.mapPos(stop.to, 1),
      })))
      const within = tr.newSelection.ranges.every(range => stops[value.index].some(stop =>
        stop.from <= range.from && range.to <= stop.to,
      ))
      return within ? { stops, index: value.index } : null
    },
  })

  function selectGroup(view: EditorView, stops: Stop[]) {
    const ranges = stops.map(stop => EditorSelection.range(stop.from, stop.to))
    return EditorSelection.create(view.state.facet(EditorState.allowMultipleSelections)
      ? ranges : ranges.slice(0, 1))
  }

  function apply(view: EditorView, base: number, to: number, result: Expansion, region?: MathRegion | null): true {
    const from = base + result.from
    const end = from + result.insert.length
    let changes = view.state.changes({ from, to, insert: result.insert })
    const expanded = region && prefs.enlarge && result.insert.includes('\\') ? changes.apply(view.state.doc) : null
    const nextFrom = region ? changes.mapPos(region.from, -1) : 0
    const enlarged = expanded && region ? enlargement(expanded.sliceString(nextFrom, changes.mapPos(region.to, 1)), prefs) : []
    const sizing = expanded && enlarged.length ? ChangeSet.of(enlarged.map(edit => ({
      ...edit, from: edit.from + nextFrom, to: edit.to + nextFrom,
    })), expanded.length) : null
    if (sizing) changes = changes.compose(sizing)
    const afterSizing = (at: number) => sizing ? sizing.mapPos(at, 1) : at
    const parent = view.state.field(session)
    const retained = parent && result.stops.length ? parent.stops.slice(parent.index + 1).map(group =>
      group.map(stop => ({ from: changes.mapPos(stop.from, 1), to: changes.mapPos(stop.to, 1) })),
    ) : []
    const stops = result.stops.map(group => group.map(stop => ({ from: afterSizing(from + stop.from), to: afterSizing(from + stop.to) })))
    stops.push(...retained)
    view.dispatch({
      changes,
      selection: stops.length ? selectGroup(view, stops[0]) : { anchor: afterSizing(end) },
      effects: stops.length ? setSession.of({ stops, index: 0 }) : [],
      scrollIntoView: true,
      userEvent: 'input.type',
    })
    return true
  }

  function move(view: EditorView, step: number): boolean {
    const current = view.state.field(session)
    if (!current) return false
    const index = current.index + step
    if (index < 0 || index >= current.stops.length) return false
    view.dispatch({
      selection: selectGroup(view, current.stops[index]),
      effects: setSession.of({ stops: current.stops, index }),
      scrollIntoView: true,
    })
    return true
  }


  function regionAt(view: EditorView, position: number): MathRegion | null {
    const id = instanceIdOf(view)
    if (id === null) return null
    const line = lineTypeAt(id, position)
    const inline = inlineAt(id, position)
    if (!line.ok || !inline.ok || line.kind === 'frontmatter') return null
    if (line.kind === 'code') return fencedMathRegion(view.state.doc, position, prefs.mathLanguages)
    if (inline.kind === 'code') return null
    return mathRegion(view.state.doc, position, inline.kind === 'formula', line.kind === 'formula')
  }

  function handle(view: EditorView, action: Action): boolean {
    if (view.state.readOnly || view.composing) return false
    if (action === 'previous') return move(view, -1)
    if (action === 'placeholder') return move(view, 1)
    if (action === 'next') return handle(view, 'manual') || handle(view, 'placeholder')
      || handle(view, 'cell') || handle(view, 'tabout')
    const { doc, selection } = view.state
    if (selection.ranges.length !== 1) return false
    const range = selection.main
    const id = instanceIdOf(view)
    if (id === null) return false
    const lineKind = lineTypeAt(id, range.from)
    const inline = inlineAt(id, range.from)
    if (!lineKind.ok || !inline.ok || lineKind.kind === 'frontmatter' || inline.kind === 'code') return false

    const region = regionAt(view, range.from)
    if (!region && lineKind.kind === 'code') return false
    if (region && range.to > region.to) return false
    const selected = doc.sliceString(range.from, range.to)
    const equationBefore = region ? doc.sliceString(region.from, range.from) : ''
    const groups = activeGroups(equationBefore)
    const line = doc.lineAt(range.from)
    const base = line.from === 0 ? 0 : line.from - 1
    const before = doc.sliceString(base, range.from)
    if ((action === 'manual' && range.empty) || typeof action === 'object') {
      const pressed = typeof action === 'object' && range.empty ? action.key : ''
      const trigger = action === 'manual' ? 'tab' : range.empty ? 'auto' : { key: action.key, selected }
      // Keep the preceding whitespace run, its last non-space character, and that character's left boundary.
      let snippetBase = base
      for (let number = line.number - 1; number > 0; number--) {
        const previous = doc.line(number)
        const contentEnd = previous.text.trimEnd().length
        if (contentEnd) {
          snippetBase = Math.max(0, previous.from + contentEnd - 2)
          break
        }
        snippetBase = Math.max(0, previous.from - 1)
      }
      const after = doc.sliceString(range.to, Math.min(range.to + 1, doc.length))
      const mode = region?.fenced ? 'codeMath' : region?.mode ?? 'text'
      const result = expandSnippet(doc.sliceString(snippetBase, range.from) + pressed, after, mode, trigger, groups)
      if (result) {
        if (lineKind.kind === 'table' && result.insert.includes('\n')) return false
        return apply(view, snippetBase, range.to, result, region)
      }
    }
    if (!region) return false
    if (action === 'fraction' || (typeof action === 'object' && action.fraction)) {
      const plan = fraction(before, Math.max(region.from - base, line.from - base), groups, selected, prefs, equationBefore)
      return plan ? apply(view, base, range.to, plan, region) : false
    }
    if (!range.empty) return false

    if (action === 'delete-empty') {
      if (!prefs.deleteEmptyMath || region.fenced || region.from !== region.to || range.from !== region.from) return false
      return apply(view, 0, region.end, { from: region.from - (region.end - region.to), insert: '', stops: [] })
    }
    if ((action === 'row' || action === 'cell' || action === 'exit') && isMath(groups)) {
      const plan = matrixEdit(doc, region, range.from, action, prefs)
      if (!plan) return false
      if (action === 'cell' && prefs.tabout && prefs.taboutKey === prefs.cellKey) {
        const offset = range.from - region.from
        const tex = doc.sliceString(region.from, region.to)
        const enclosed = bracketPairs(tex).find(pair => pair.open.to <= offset && pair.close.from >= offset
          && pair.close.symbol !== '}' && region.from + pair.close.to <= line.to)
        if (enclosed) {
          view.dispatch({ selection: { anchor: region.from + enclosed.close.to }, scrollIntoView: true })
          return true
        }
      }
      if (plan.insert !== undefined) return apply(view, 0, range.to, { from: range.from, insert: plan.insert, stops: [] })
      view.dispatch({ selection: { anchor: plan.cursor }, scrollIntoView: true, effects: setSession.of(null) })
      return true
    }
    if (action !== 'tabout' || !prefs.tabout) return false
    const tex = doc.sliceString(region.from, region.to)
    const offset = range.from - region.from
    const ending = taboutOffset(tex, prefs, offset)
    const anchor = ending !== null ? region.from + ending
      : !prefs.taboutEndOnly || tex.slice(offset).trim() === '' ? region.end : null
    if (anchor === null || anchor === range.from) return false
    view.dispatch({ selection: { anchor }, scrollIntoView: true, effects: setSession.of(null) })
    return true
  }

  const appearance = mathAppearance(cm6, regionAt, () => prefs)
  const settingsKeys = new Compartment()
  function bindings(): KeyBinding[] {
    const defined: [string, Action][] = [
      [prefs.snippetKey, 'manual'], [prefs.nextKey, 'placeholder'], [prefs.previousKey, 'previous'],
      [prefs.fractionKey, prefs.fractionKey.length === 1 ? { key: prefs.fractionKey, fraction: true } : 'fraction'],
      [prefs.rowKey, 'row'], [prefs.cellKey, 'cell'], [prefs.exitKey, 'exit'],
      [prefs.taboutKey, 'tabout'], ['Backspace', 'delete-empty'],
    ]
    return defined.filter(([key]) => key !== '').map(([key, action]) => ({ key, run: view => handle(view, action) }))
  }

  const views = new Set<EditorView>()
  const tracker = ViewPlugin.fromClass(class {
    constructor(readonly view: EditorView) { views.add(view) }
    destroy() { views.delete(this.view) }
  })
  const accepted = sdk.registerExtension([
    session,
    tracker,
    appearance.extension,
    settingsKeys.of(Prec.high(keymap.of(bindings()))),
    Prec.high(EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
          || event.key.length !== 1) return false
        return handle(view, { key: event.key })
      },
      compositionend(event, view) {
        if (!prefs.expandAfterComposition || !event.data) return false
        const composed = event.data
        setTimeout(() => {
          if (!views.has(view) || !prefs.expandAfterComposition) return
          const head = view.state.selection.main.head
          if (view.state.sliceDoc(Math.max(0, head - composed.length), head) === composed) handle(view, { key: '' })
        }, 45)
        return false
      },
    })),
  ])
  if (!accepted) throw new Error('Vsidian rejected the Latex Suite editor extension')

  const labels = names[sdk.locale?.get().startsWith('zh') ? 'zh-cn' : 'en']
  for (const action of ['next', 'previous', 'fraction', 'manual', 'placeholder', 'row', 'cell', 'exit', 'tabout'] as const) {
    const result = commands.register({ id: action, title: labels[action], mode: 'live', writes: ['next', 'fraction', 'manual', 'row', 'cell'].includes(action) }, target => {
      if (!target) return
      const view = [...views].find(item => instanceIdOf(item) === target.info.instanceId)
      if (view) handle(view, action)
    })
    if (!result.ok) throw new Error('Vsidian rejected Latex Suite command: ' + result.reason)
  }

  // A held request is answered as soon as a save commits. Idle returns only renew the listener.
  for (;;) {
    const response = await sdk.channel.request(snippetTopics.watch, revision)
    if (!response.ok) {
      if (response.reason !== 'timeout') return
      throw new Error('Latex Suite snippet watch timed out')
    }
    const update = response.result as RuntimeSnippets | null | 'released'
    if (update === 'released') return
    if (!update) continue
    revision = update.revision
    prefs = update.preferences
    expandSnippet = createSnippetExpander(update.patches, prefs, update.variables)
    for (const view of views) {
      view.dispatch({ effects: [settingsKeys.reconfigure(Prec.high(keymap.of(bindings()))), appearance.refresh.of()] })
    }
  }
})
