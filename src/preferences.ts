export const defaultPreferences = {
  snippetsEnabled: true,
  variables: '',
  wordDelimiters: "., +-\n\t:;!?\\/{}[]()=~$'\"|`<>*^%#@&",
  trimInline: true,
  deleteEmptyMath: true,
  expandAfterComposition: false,
  mathLanguages: 'math',
  conceal: false,
  concealDelay: 0,
  bracketColors: true,
  bracketAtCursor: true,
  highlightDollars: true,
  preview: true,
  previewAbove: true,
  previewCursor: '▶',
  previewBrackets: false,
  previewBlock: false,
  autoFraction: true,
  fractionCommand: '\\frac',
  fractionBreak: '+-=\t',
  fractionExcluded: '[["^{","}"],["\\\\pu{","}"]]',
  matrix: true,
  matrixEnvs: 'pmatrix, cases, align, gather, bmatrix, Bmatrix, vmatrix, Vmatrix, array, matrix',
  matrixMacros: 'eqalign',
  tabout: true,
  taboutClosers: '), ], \\rbrack, \\}, \\rbrace, \\rangle, \\rvert, \\rVert, \\rfloor, \\rceil, \\urcorner, }',
  taboutEndOnly: true,
  enlarge: true,
  enlargeTriggers: 'sum, int, frac, prod, bigcup, bigcap',
  enlargeSpace: true,
  snippetKey: 'Tab',
  nextKey: 'Tab',
  previousKey: 'Shift-Tab',
  fractionKey: '/',
  rowKey: 'Enter',
  cellKey: 'Tab',
  exitKey: 'Shift-Enter',
  taboutKey: 'Tab',
  recursion: 0,
  logLevel: 'off',
}
export type Preferences = typeof defaultPreferences
export type PreferenceKey = keyof Preferences

export function csv(value: string): string[] {
  return value.split(',').map(part => part.trim()).filter(Boolean)
}

export function fractionExclusions(value: string): [string, string][] | null {
  try {
    const pairs: unknown = JSON.parse(value)
    return Array.isArray(pairs) && pairs.every(pair => Array.isArray(pair)
      && pair.length === 2 && pair.every(item => typeof item === 'string' && item.length > 0)) ? pairs : null
  } catch (error) {
    if (error instanceof SyntaxError) return null
    throw error
  }
}

export function patchPreferences(current: Preferences, value: unknown): Preferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const next = { ...current }
  for (const [name, item] of Object.entries(value)) {
    if (!Object.hasOwn(defaultPreferences, name)) return null
    const key = name as PreferenceKey
    if (typeof item !== typeof defaultPreferences[key]) return null
    if (typeof item === 'number' && (!Number.isInteger(item) || item < 0 || item > (key === 'recursion' ? 10 : 10_000))) return null
    if (key === 'fractionCommand' && !/^\\[A-Za-z]+$/.test(item)) return null
    if (key === 'fractionExcluded' && fractionExclusions(item) === null) return null
    if (key === 'logLevel' && !['off', 'info', 'verbose', 'vverbose'].includes(item)) return null
    if (key.endsWith('Key') && item && !/^(?:(?:Ctrl|Control|Meta|Cmd|Alt|Shift|Mod)-)*(?:\S|Tab|Enter|Space|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[012]))$/.test(item)) return null
    Object.assign(next, { [key]: item })
  }
  return next
}
