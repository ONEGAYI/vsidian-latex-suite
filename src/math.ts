import type { Text } from '@codemirror/state'
import { isMath, type Expansion, type MathMode } from './snippets.ts'
import { defaultPreferences, fractionExclusions, type Preferences } from './preferences.ts'
import variables from './upstream/default_snippet_variables.js'

export type MathRegion = { mode: MathMode; from: number; to: number; end: number; fenced?: boolean }

export function mathRegion(doc: Text, pos: number, formula: boolean, block: boolean): MathRegion | null {
  const line = doc.lineAt(pos)
  const caret = pos - line.from
  let open: { from: number; size: number } | null = null
  for (const token of line.text.matchAll(/\\.|\$+/g)) {
    if (token[0].startsWith('\\')) continue
    const from = token.index!
    const size = token[0].length
    // The host parser has no formula content to classify between empty delimiter pairs.
    if ((size === 2 || size === 4) && caret === from + size / 2) {
      return { mode: size === 2 ? 'inline' : 'display', from: pos, to: pos, end: line.from + from + size }
    }
    if (from + size <= caret) {
      open = { from, size }
      continue
    }
    if (formula && from >= caret && open?.size === size && size <= 2) {
      return {
        mode: size === 1 ? 'inline' : 'display',
        from: line.from + open.from + size, to: line.from + from, end: line.from + from + size,
      }
    }
    break
  }

  if (!block) return null
  const opening = /^\s*(?:>\s*)*\$\$/
  for (let number = line.number; number >= 1; number--) {
    const candidate = doc.line(number)
    const marker = opening.exec(candidate.text)
    if (!marker) continue
    const from = candidate.from + marker[0].length
    if (from > pos) continue
    for (let closing = number + 1; closing <= doc.lines; closing++) {
      const candidate = doc.line(closing)
      const index = candidate.text.trimEnd().endsWith('$$')
        ? candidate.text.lastIndexOf('$$') : candidate.text.indexOf('$$')
      if (index < 0) continue
      const to = candidate.from + index
      return pos <= to ? { mode: 'display', from, to, end: to + 2 } : null
    }
    return null
  }
  return null
}

export function fraction(before: string, lowerBound: number, groups: readonly string[], selection = '',
  prefs: Preferences = defaultPreferences, equationBefore = before): Expansion | null {
  if (!prefs.autoFraction || !isMath(groups)) return null
  const excluded = fractionExclusions(prefs.fractionExcluded)!
  if (excluded.some(([open, close]) => {
    if (close === '}' && /^(?:\^|\\[A-Za-z]+)\{$/.test(open)) {
      return groups.includes(open.slice(0, -1).replace(/^\\/, ''))
    }
    // If a compound opener ends with a bracket, non-excluded nested brackets
    // must still consume their closers (for example, tag{x{y}z).
    const bracket = close === '}' ? '{' : close === ')' ? '(' : close === ']' ? '[' : ''
    const nested = bracket && open !== bracket && open.endsWith(bracket)
    const stack: boolean[] = []
    for (let i = 0; i < equationBefore.length;) {
      if (equationBefore.startsWith(open, i)) {
        if (open === close && stack.length) stack.pop()
        else stack.push(true)
        i += open.length
      } else if (equationBefore.startsWith(close, i)) {
        stack.pop()
        i += close.length
      } else if (nested && equationBefore[i] === bracket) {
        stack.push(false)
        i++
      } else {
        i += equationBefore[i] === '\\' ? 2 : 1
      }
    }
    return stack.includes(true)
  })) return null
  const breaking = ' $\n' + prefs.fractionBreak
  const closings: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  let from = before.length
  const stack: string[] = []
  if (!selection) {
    while (from > lowerBound) {
      const char = before[from - 1]
      if (closings[char]) stack.push(closings[char])
      else if ('([{'.includes(char)) {
        if (!stack.length) break
        if (stack.pop() !== char) return null
      } else if (!stack.length && breaking.includes(char)) {
        if (char !== ' ' || !greekBeforeSpace.test(before.slice(lowerBound, from))) break
      }
      from--
    }
    if (stack.length || from === before.length) return null
  }

  let numerator = selection || before.slice(from)
  if (numerator.startsWith('(') && numerator.endsWith(')')) {
    let depth = 0
    for (let i = 0; i < numerator.length; i++) {
      if (numerator[i] === '(') depth++
      if (numerator[i] === ')' && --depth === 0) {
        if (i === numerator.length - 1) numerator = numerator.slice(1, -1)
        break
      }
    }
  }

  const first = prefs.fractionCommand + '{'
  const insert = first + numerator + '}{}'
  const intoDenominator = { from: insert.length - 1, to: insert.length - 1 }
  const afterFraction = { from: insert.length, to: insert.length }
  const stops = [[intoDenominator], [afterFraction]]
  if (!numerator) stops.unshift([{ from: first.length, to: first.length }])
  return { from, insert, stops }
}

const greekBeforeSpace = new RegExp('\\\\' + variables['${GREEK}'] + ' $')
