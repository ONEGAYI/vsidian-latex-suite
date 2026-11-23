import upstream from './upstream/default_snippets.js'
import upstreamVariables from './upstream/default_snippet_variables.js'
const defaults: Readonly<Record<string, string>> = upstreamVariables

export type SnippetFields = {
  options: string
  priority?: number
  description?: string
  excludedMacros?: readonly string[]
}

type BundledReplacement = (match: RegExpExecArray, variables: Readonly<Record<string, string>>) => string | false

export type SnippetRule = SnippetFields & {
  trigger: string | RegExp
  replacement: string | BundledReplacement
}

export type SnippetData = SnippetFields & {
  trigger: string | { pattern: string; flags: string }
  replacement: string | { builtin: number }
}

export type SnippetPatch = {
  id: string
  enabled: boolean
  rule?: SnippetData
}

export const defaultRules: readonly SnippetRule[] = upstream
export const defaultId = (index: number): string => 'builtin:1.13.1:' + index

export class InvalidLiteralTrigger extends Error {}

export function snippetTrigger(trigger: SnippetData['trigger'], options: string, provided: Readonly<Record<string, string>> = {}): string | RegExp {
  let pattern = typeof trigger === 'string' ? trigger : trigger.pattern
  pattern = pattern.replace(/\$\{\w+\}/g, name => {
    const key = name.slice(2, -1)
    return Object.hasOwn(provided, key) ? provided[key] : defaults[name] ?? name
  })
  if (typeof trigger === 'string' && !options.includes('r')) {
    if (options.includes('v') && pattern.length !== 1) throw new InvalidLiteralTrigger('trigger')
    return pattern
  }
  return new RegExp('(?:' + pattern + ')$', typeof trigger === 'string' ? '' : trigger.flags)
}
