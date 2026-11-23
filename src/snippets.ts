import { defaultId, defaultRules, snippetTrigger, type SnippetData, type SnippetPatch, type SnippetRule } from './snippet-rules.ts'

import { defaultPreferences, type Preferences } from './preferences.ts'

export type MathMode = 'inline' | 'display'
export type Stop = { from: number; to: number }
export type Expansion = { from: number; insert: string; stops: Stop[][] }

const textMacros = new Set([
  'text', 'textrm', 'textup', 'textit', 'textbf', 'textsf', 'texttt', 'textnormal',
  'clap', 'textllap', 'textrlap', 'textclap', 'hbox', 'mbox', 'fbox', 'framebox',
])
const noSnippets = new Set([
  'tag', 'begin', 'end', 'mmlToken', 'unicode', 'textcolor', 'color', 'colorbox', 'fcolorbox',
])

function compile(rule: SnippetRule | SnippetData, variables: Readonly<Record<string, string>>) {
  const source = rule.trigger instanceof RegExp
    ? { pattern: rule.trigger.source, flags: rule.trigger.flags } : rule.trigger
  const trigger = snippetTrigger(source, rule.options, variables)
  const replacement = typeof rule.replacement === 'object'
    ? defaultRules[rule.replacement.builtin].replacement : rule.replacement
  const visual = rule.options.includes('v') || (typeof trigger === 'string' && trigger.length === 1
    && typeof replacement === 'string' && replacement.includes('${VISUAL}'))
  return { ...rule, trigger, replacement, visual, length: typeof trigger === 'string' ? trigger.length : trigger.source.length }
}

type CompiledSnippet = ReturnType<typeof compile>
type SnippetInput = [before: string, after: string, mode: 'text' | MathMode | 'codeMath',
  trigger: 'auto' | 'tab' | { key: string; selected: string }, groups?: readonly string[]]

export function createSnippetExpander(patches: readonly SnippetPatch[] = [], prefs: Preferences = defaultPreferences,
  variables: Readonly<Record<string, string>> = {}) {
  const changes = new Map(patches.map(entry => [entry.id, entry]))
  const snippets = defaultRules.flatMap((original, index) => {
    const patch = changes.get(defaultId(index))
    return patch?.enabled === false ? [] : [compile(patch?.rule ?? original, variables)]
  })
  for (const patch of patches) {
    if (patch.id.startsWith('user:') && patch.enabled && patch.rule) snippets.push(compile(patch.rule, variables))
  }
  snippets.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || b.length - a.length)
  return (...args: SnippetInput): Expansion | null => {
    if (!prefs.snippetsEnabled) return null
    let result = matchSnippet(snippets, prefs, variables, ...args)
    if (!result) return null
    const [before, after, mode, trigger, groups] = args
    if (trigger === 'auto') {
      for (let count = 0; count < prefs.recursion && result.stops.length === 0; count++) {
        const expanded: string = before.slice(0, result.from) + result.insert
        const next = matchSnippet(snippets, prefs, variables, expanded, after, mode, 'auto', groups)
        if (!next || expanded.slice(next.from) === next.insert) break
        const prefix: string = expanded.slice(result.from, next.from)
        result = {
          from: Math.min(result.from, next.from),
          insert: prefix + next.insert,
          stops: next.stops.map(group => group.map(stop => ({ from: stop.from + prefix.length, to: stop.to + prefix.length }))),
        }
      }
    }
    if (prefs.logLevel !== 'off') {
      console.debug('[Latex Suite] snippet expanded', mode,
        prefs.logLevel === 'info' ? undefined : { from: result.from, length: result.insert.length,
          ...(prefs.logLevel === 'vverbose' ? { trigger, stopGroups: result.stops.length } : {}) })
    }
    return result
  }
}

export function isMath(groups: readonly string[]): boolean {
  return !groups.some(group => textMacros.has(group) || noSnippets.has(group))
}

export function activeGroups(tex: string): string[] {
  const stack: string[] = []
  for (const token of tex.matchAll(/(?:\\([A-Za-z]+)|(\^))\s*\{|\\.|\{|\}/g)) {
    if (token[0] === '\\(' && stack.slice(stack.lastIndexOf('\\(') + 1).some(group => textMacros.has(group))) {
      stack.push('\\(')
    } else if (token[0] === '\\)') {
      const open = stack.lastIndexOf('\\(')
      if (open >= 0) stack.length = open
    } else if (token[0] === '}') {
      if (stack.at(-1) === '\\(') stack.pop()
      stack.pop()
    } else if (token[0] === '{' || token[1] || token[2]) {
      stack.push(token[1] ?? token[2] ?? '')
    }
  }
  return stack.slice(stack.lastIndexOf('\\(') + 1)
}

function matchSnippet(
  snippets: CompiledSnippet[],
  prefs: Preferences,
  variables: Readonly<Record<string, string>>,
  ...[before, after, mode, trigger, groups = []]: SnippetInput
): Expansion | null {
  if (groups.some(group => noSnippets.has(group))) return null
  const textInMath = groups.some(group => textMacros.has(group))
  for (const rule of snippets) {
    const { options } = rule
    const applicable = mode === 'text' ? options.includes('t')
      : textInMath ? options.includes('T')
      : options.includes('m') || (mode === 'codeMath' ? /[nM]/.test(options) : options.includes(mode === 'inline' ? 'n' : 'M'))
    if ((!applicable && /[tmnMT]/.test(options)) || rule.excludedMacros?.some(name => groups.includes(name))) continue

    const visual = typeof trigger === 'object'
    if (visual !== rule.visual || (!visual && options.includes('A') !== (trigger === 'auto'))) continue
    let from: number
    let match: RegExpExecArray | null = null
    if (visual) {
      if (rule.trigger !== trigger.key) continue
      from = before.length
    } else if (typeof rule.trigger === 'string') {
      if (!rule.trigger || !before.endsWith(rule.trigger)) continue
      from = before.length - rule.trigger.length
    } else {
      match = rule.trigger.exec(before)
      if (!match) continue
      from = match.index
    }

    if (options.includes('w')) {
      const delimiters = prefs.wordDelimiters.replace('\\n', '\n')
      if (!delimiters.includes(before.charAt(from - 1)) || !delimiters.includes(after.charAt(0))) continue
    }

    let template: string
    if (typeof rule.replacement === 'function') {
      // All bundled function replacements have a regex trigger.
      const result = rule.replacement(match!, variables)
      if (result === false) continue
      if (options.includes('U') && result === before.slice(from)) return null
      template = result
    } else {
      template = rule.replacement
    }

    const byIndex = new Map<number, Stop[]>()
    let insert = ''
    let offset = 0
    // Resolve captures and selection literally: their content must not become a tab stop.
    for (const token of template.matchAll(/\[\[(\d+)\]\]|\$\{VISUAL\}|\$(\d)|\$\{(\d+):([^}]*)\}/g)) {
      insert += template.slice(offset, token.index)
      if (token[1] !== undefined) {
        const group = Number(token[1]) + 1
        insert += match && typeof rule.replacement === 'string' && group < match.length ? match[group] ?? '' : token[0]
      } else if (token[0] === '${VISUAL}') {
        insert += visual ? trigger.selected : token[0]
      } else {
        const index = Number(token[2] ?? token[3])
        const start = insert.length
        insert += token[4] ?? ''
        const stop = { from: start, to: insert.length }
        const group = byIndex.get(index)
        if (group) group.push(stop)
        else byIndex.set(index, [stop])
      }
      offset = token.index + token[0].length
    }
    insert += template.slice(offset)
    if (mode === 'inline' && prefs.trimInline) insert = insert.trimEnd()
    const stops = [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, group]) => group.map(stop => ({
      from: Math.min(stop.from, insert.length), to: Math.min(stop.to, insert.length),
    })))
    if (visual && stops.length === 0) stops.push([{ from: 0, to: insert.length }])
    return { from, insert, stops }
  }
  return null
}

export const expandSnippet = createSnippetExpander()
