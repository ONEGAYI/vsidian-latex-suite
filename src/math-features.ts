import type { Text } from '@codemirror/state'
import { csv, type Preferences } from './preferences.ts'
import type { MathRegion } from './math.ts'

type Mark = { from: number; to: number; symbol: string; sized: boolean }
type Pair = { open: Mark; close: Mark; depth: number }
type Edit = { from: number; to: number; insert: string }
const closes: Record<string, string> = {
  '(': ')', '[': ']', '{': '}', '\\{': '\\}', '\\lparen': '\\rparen', '\\lbrack': '\\rbrack',
  '\\lbrace': '\\rbrace', '\\langle': '\\rangle', '\\lvert': '\\rvert', '\\lVert': '\\rVert',
  '\\lfloor': '\\rfloor', '\\lceil': '\\rceil', '\\ulcorner': '\\urcorner',
}
const rightSymbols = new Set(Object.values(closes))
const sizes = /^\\(?:left|right|[bB]ig(?:g)?[lr]?)$/
const tokens = /\\(?:[A-Za-z]+|.)|[()[\]{}.|<>]/g
const sizedDelimiters = new Set([
  ...Object.keys(closes), ...rightSymbols, '.', '|', '<', '>', '\\|', '\\vert', '\\Vert',
  '\\lt', '\\gt', '/', '\\\\', '\\backslash', '\\uparrow', '\\downarrow', '\\Uparrow', '\\Downarrow',
])

export function bracketPairs(tex: string): Pair[] {
  const stack: { open: Mark; close: string | undefined; depth: number }[] = []
  const pairs: Pair[] = []
  let size: { token: string; from: number; to: number } | null = null
  for (const match of tex.matchAll(tokens)) {
    const symbol = match[0]
    const from = match.index!
    const to = from + symbol.length
    if (sizes.test(symbol)) {
      size = { token: symbol, from, to }
      continue
    }
    const sized = size && !tex.slice(size.to, from).trim() ? size : null
    size = null
    const mark = { symbol, from: sized?.from ?? from, to, sized: sized !== null }
    const left = sized && (sized.token === '\\left' || sized.token.endsWith('l'))
    const right = sized && (sized.token === '\\right' || sized.token.endsWith('r'))
    if ((left || right) && !closes[symbol] && !rightSymbols.has(symbol) && !['.', '|', '<', '>', '\\|', '\\vert', '\\Vert'].includes(symbol)) continue
    if (left || (!right && Object.hasOwn(closes, symbol))) {
      stack.push({ open: mark, close: closes[symbol], depth: stack.length })
    } else if (right || rightSymbols.has(symbol)) {
      const top = stack.at(-1)
      if (top && (top.close === symbol || (right && top.open.sized) || top.open.symbol === '.')) {
        stack.pop()
        pairs.push({ open: top.open, close: mark, depth: top.depth })
      }
    }
  }
  return pairs
}

export function enlargement(tex: string, settings: Preferences): Edit[] {
  if (!settings.enlarge) return []
  const triggers = csv(settings.enlargeTriggers).map(token => /^[A-Za-z]+$/.test(token) ? '\\' + token : token)
  const space = settings.enlargeSpace ? ' ' : ''
  return bracketPairs(tex).flatMap(({ open, close }) => {
    if (open.sized || close.sized || open.symbol === '{') return []
    const content = tex.slice(open.to, close.from)
    if (!triggers.some(trigger => content.includes(trigger))) return []
    return [
      { from: open.from, to: open.to, insert: '\\left' + open.symbol + space },
      { from: close.from, to: close.to, insert: space + '\\right' + close.symbol },
    ]
  }).sort((a, b) => a.from - b.from)
}

export function taboutOffset(tex: string, prefs: Preferences, cursor = 0): number | null {
  const closers = new Set(csv(prefs.taboutClosers))
  let afterOpening = 0
  for (const token of tex.matchAll(/\\(?:[A-Za-z]+|.)|%[^\r\n]*|[^\s]/gu)) {
    if (token.index! < afterOpening || token[0].startsWith('%')) continue
    const symbol = token[0]
    const end = token.index! + symbol.length
    if (sizes.test(symbol)) {
      const right = symbol === '\\right' || symbol.endsWith('r')
      const left = symbol === '\\left' || symbol.endsWith('l')
      const match = /^\s*(\\[A-Za-z]+|\\.|[()[\]{}|<>./])/.exec(tex.slice(end))
      const delimiter = match?.[1]
      const adjacentEnd = match && delimiter && sizedDelimiters.has(delimiter) ? end + match[0].length : end
      if (right && adjacentEnd > cursor) return adjacentEnd
      if (left) afterOpening = adjacentEnd
    }
    if (end > cursor && closers.has(symbol)) return end
  }
  return null
}

export function matrixEdit(
  doc: Text, region: MathRegion, cursor: number, action: 'row' | 'cell' | 'exit', prefs: Preferences,
): { insert: string; cursor?: never } | { cursor: number; insert?: never } | null {
  if (!prefs.matrix) return null
  const tex = doc.sliceString(region.from, region.to)
  const offset = cursor - region.from
  const allowed = csv(prefs.matrixEnvs)
  const stack: { name: string; from: number }[] = []
  let active: { from: number; to: number } | null = null
  for (const token of tex.matchAll(/\\(begin|end)\s*\{([^{}]+)\}|\\(?:[A-Za-z]+|.)/g)) {
    if (token[1] === 'begin') stack.push({ name: token[2], from: token.index! + token[0].length })
    else if (token[1] === 'end' && stack.at(-1)?.name === token[2]) {
      const opening = stack.pop()!
      if (allowed.includes(opening.name) && opening.from <= offset && offset <= token.index!
        && (!active || opening.from > active.from)) active = { from: opening.from, to: token.index! + token[0].length }
    }
  }
  for (const { open, close } of bracketPairs(tex)) {
    if (open.symbol !== '{' || open.to > offset || close.from < offset || (active && active.from >= open.to)) continue
    const macro = /\\([A-Za-z]+)\s*$/.exec(tex.slice(0, open.from))
    if (macro && csv(prefs.matrixMacros).includes(macro[1])) active = { from: open.to, to: close.to }
  }
  if (!active) return null
  if (action === 'exit') return { cursor: region.from + active.to }
  if (action === 'cell') return { insert: ' & ' }
  const multiline = doc.lineAt(region.from).number !== doc.lineAt(region.to).number
  const line = doc.lineAt(cursor)
  const indent = /^[ \t]*(?:>[ \t]*)*/.exec(line.text)![0]
  const from = Math.max(line.from + indent.length, region.from + active.from)
  const lineInMatrix = doc.sliceString(from, cursor)
  // A single-line matrix may contain several LaTeX rows.
  let depth = 0
  let rowFrom = 0
  for (const token of lineInMatrix.matchAll(/\\(?:[A-Za-z]+|.)|[{}]/g)) {
    if (token[0] === '{') depth++
    if (token[0] === '}') depth--
    if (token[0] === '\\\\' && depth === 0) rowFrom = token.index! + 2
  }
  const leadingCells = /^[ \t&]*/.exec(lineInMatrix.slice(rowFrom))![0].trimStart()
  return { insert: (multiline ? ' \\\\\n' + indent : ' \\\\  ') + leadingCells }
}

export function fencedMathRegion(doc: Text, pos: number, languages: string): MathRegion | null {
  const allowed = csv(languages)
  const current = doc.lineAt(pos)
  for (let i = current.number; i > 0; i--) {
    const line = doc.line(i)
    const fence = /^[ \t]*(?:>[ \t]*)*([~`]{3,})[ \t]*(\S*)/.exec(line.text)
    if (!fence) continue
    if (i === current.number || !allowed.includes(fence[2])) return null
    for (let j = i + 1; j <= doc.lines; j++) {
      const close = doc.line(j)
      const match = /^[ \t]*(?:>[ \t]*)*([~`]{3,})[ \t]*$/.exec(close.text)
      if (match?.[1][0] !== fence[1][0] || match[1].length < fence[1].length) continue
      if (j <= current.number) return null
      return { mode: 'display', from: line.to + 1, to: close.from - 1, end: close.from - 1, fenced: true }
    }
    return null
  }
  return null
}
