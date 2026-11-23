import { render } from 'katex'
import type { EditorView, Tooltip, DecorationSet, ViewUpdate } from '@codemirror/view'
import type { AddonCm6Runtime } from '../types/vendor/shared/addonPage'
import type { Preferences } from './preferences.ts'
import type { MathRegion } from './math.ts'
import { bracketPairs } from './math-features.ts'
import { bar, cmd_symbols, dot, fractions, greek, hat, map_sub, map_super, not_remap } from './upstream/conceal_maps.ts'

const symbols = { ...cmd_symbols, ...greek, ...not_remap }
const markerEscapes: Record<string, string> = {
  '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', '$': '\\$', '%': '\\%', '&': '\\&',
  '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}',
}

function concealed(tex: string) {
  const translations: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    dot, hat, bar, '^': map_super, '_': map_sub,
  }
  return [...tex.matchAll(/\\(?:frac|dfrac|tfrac)(\{\d+\}\{\d+\})|\\(dot|hat|bar)\{([A-Za-z])\}|([_^])(?:\{([^{}\\\n]+)\}|([A-Za-z0-9]))|\\([A-Za-z]+|.)/g)].flatMap(token => {
    let glyph: string | undefined
    if (token[1]) glyph = fractions[token[1]]
    else if (token[2]) glyph = translations[token[2]][token[3]]
    else if (token[4]) {
      const letters = [...(token[5] ?? token[6])].map(char => translations[token[4]][char])
      if (letters.every(Boolean)) glyph = letters.join('')
    } else if (Object.hasOwn(symbols, token[7])) glyph = symbols[token[7]]
    return glyph ? [{ from: token.index!, to: token.index! + token[0].length, glyph }] : []
  })
}

function previewSource(tex: string, offset: number, prefs: Preferences): string {
  // Do not split a control word with the preview cursor.
  const command = /\\[A-Za-z]*$/.exec(tex.slice(0, offset))
  const pos = command?.index ?? offset
  // A cursor at a script boundary would become the base or exponent itself.
  const scriptBoundary = /(?:^|[^\\])(?:\\\\)*[_^]\s*$/.test(tex.slice(0, pos)) || /^\s*[_^]/.test(tex.slice(pos))
  const marker = prefs.previewCursor && !scriptBoundary
    ? '\\text{' + prefs.previewCursor.replace(/[\\{}#$%&_^~]/g, char => markerEscapes[char]) + '}' : ''
  const marked = tex.slice(0, pos) + marker + tex.slice(pos)
  if (!prefs.previewBrackets) return marked
  const pair = bracketPairs(tex).find(item => item.open.symbol === '{' && item.open.to <= pos && item.close.from >= pos)
  if (!pair) return marked
  return marked.slice(0, pair.open.to) + '\\color{RoyalBlue}' + marked.slice(pair.open.to)
}

export function mathAppearance(
  cm6: AddonCm6Runtime,
  getRegion: (view: EditorView, position: number) => MathRegion | null,
  getPrefs: () => Preferences,
) {
  const { StateEffect, StateField } = cm6.state
  const { Decoration, showTooltip, ViewPlugin, WidgetType } = cm6.view
  const refresh = StateEffect.define<void>()
  const setPopup = StateEffect.define<Tooltip | null>()
  const popup = StateField.define<Tooltip | null>({
    create: () => null,
    update(value, transaction) {
      for (const effect of transaction.effects) if (effect.is(setPopup)) return effect.value
      return transaction.docChanged || transaction.selection ? null : value
    },
    provide: field => showTooltip.from(field),
  })

  class Glyph extends WidgetType {
    readonly glyph: string
    constructor(glyph: string) { super(); this.glyph = glyph }
    eq(other: Glyph) { return this.glyph === other.glyph }
    toDOM() {
      const element = document.createElement('span')
      element.className = 'ls-math-glyph'
      element.textContent = this.glyph
      return element
    }
    ignoreEvent() { return false }
  }

  const plugin = ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none
    readonly view: EditorView
    revealAt = -1
    revealDelay = -1
    revealed = -1
    timer: ReturnType<typeof setTimeout> | undefined
    pending = false
    disposed = false
    constructor(view: EditorView) { this.view = view; this.draw() }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged
        || update.transactions.some(tr => tr.effects.some(effect => effect.is(refresh)))) this.draw()
    }
    destroy() { this.disposed = true; clearTimeout(this.timer) }

    draw() {
      const view = this.view
      const prefs = getPrefs()
      const position = view.state.selection.main.head
      const region = getRegion(view, position)
      const marks = []
      let activeToken = -1
      if (region && view.hasFocus) {
        const tex = view.state.sliceDoc(region.from, region.to)
        const offset = position - region.from
        const pairs = bracketPairs(tex)
        const current = pairs.find(pair => pair.open.from <= offset && pair.close.to >= offset)
        for (const pair of pairs) {
          const cls = prefs.bracketColors ? 'ls-bracket-' + (pair.depth % 6) : ''
          const active = prefs.bracketAtCursor && pair === current
          if (!cls && !active) continue
          const mark = Decoration.mark({ class: cls + (active ? ' ls-bracket-current' : '') })
          marks.push(mark.range(region.from + pair.open.from, region.from + pair.open.to),
            mark.range(region.from + pair.close.from, region.from + pair.close.to))
        }
        if (prefs.highlightDollars && !region.fenced) {
          const delimiter = Decoration.mark({ class: 'ls-math-dollar' })
          const size = region.end - region.to
          marks.push(delimiter.range(region.from - size, region.from), delimiter.range(region.to, region.end))
        }
        if (prefs.conceal) {
          for (const token of concealed(tex)) {
            const from = region.from + token.from
            const to = region.from + token.to
            if (view.state.selection.ranges.some(range => range.from <= to && range.to >= from)) {
              activeToken = from
              if (prefs.concealDelay === 0 || (this.revealed === from && this.revealDelay === prefs.concealDelay)) continue
            }
            marks.push(Decoration.replace({ widget: new Glyph(token.glyph) }).range(from, to))
          }
        }
      }
      this.decorations = Decoration.set(marks, true)
      if (activeToken !== this.revealAt || prefs.concealDelay !== this.revealDelay) {
        this.revealAt = activeToken
        this.revealDelay = prefs.concealDelay
        this.revealed = -1
        clearTimeout(this.timer)
        if (activeToken >= 0 && prefs.concealDelay > 0) {
          this.timer = setTimeout(() => {
            this.revealed = activeToken
            view.dispatch({ effects: refresh.of() })
          }, prefs.concealDelay)
        }
      }
      if (this.pending) return
      this.pending = true
      queueMicrotask(() => {
        this.pending = false
        if (this.disposed) return
        const prefs = getPrefs()
        const pos = view.state.selection.main.head
        const region = view.hasFocus && prefs.preview ? getRegion(view, pos) : null
        let next: Tooltip | null = null
        if (region && (region.mode === 'inline' || prefs.previewBlock)) {
          const tex = view.state.sliceDoc(region.from, region.to)
          if (tex.trim()) {
            const content = previewSource(tex, pos - region.from, prefs)
            next = {
              pos, above: prefs.previewAbove, arrow: true,
              create() {
                const dom = document.createElement('div')
                dom.className = 'ls-math-preview'
                const options = { output: 'mathml' as const, displayMode: region.mode === 'display', throwOnError: false }
                render(content, dom, options)
                // The marker can be mistaken for a macro argument. In that case show the unmarked equation.
                if (content !== tex && dom.querySelector('.katex-error')) render(tex, dom, options)
                return { dom }
              },
            }
          }
        }
        if (next || view.state.field(popup, false)) view.dispatch({ effects: setPopup.of(next) })
      })
    }
  }, { decorations: value => value.decorations })
  return { extension: [popup, plugin], refresh }
}
