import { parse, parseExpressionAt, tokenizer, type Expression, type Node, type Options } from 'acorn'
import { InvalidLiteralTrigger, snippetTrigger, type SnippetData } from './snippet-rules.ts'

type IssueCode = 'syntax' | 'format' | 'field' | 'trigger' | 'replacement' | 'function'
  | 'options' | 'priority' | 'macros' | 'regex' | 'empty' | 'single'

export type SnippetIssue = { code: IssueCode; line?: number; column?: number; field?: string }

export class SnippetSourceError extends Error {
  readonly issue: SnippetIssue

  constructor(code: IssueCode, node?: Node, field?: string) {
    super(field ? code + ': ' + field : code)
    this.issue = {
      code, field, line: node?.loc?.start.line,
      column: node?.loc ? node.loc.start.column + 1 : undefined,
    }
  }
}

export type BundledSource = { source: string; replacementCode: string | null }
export type ParsedSnippet = { source: string; rule: SnippetData }
const syntax: Options = { ecmaVersion: 2022, sourceType: 'module', locations: true }

function readExpressions(source: string): Expression {
  try {
    const first = tokenizer(source, syntax).getToken()
    if (first.type.label === 'eof') throw new SnippetSourceError('empty')
    if (first.type.label === 'export') {
      const { body } = parse(source, syntax)
      const stmt = body[0]
      if (body.length !== 1 || stmt.type !== 'ExportDefaultDeclaration') throw new SnippetSourceError('format', stmt)
      if (stmt.declaration.type !== 'ArrayExpression' && stmt.declaration.type !== 'ObjectExpression') {
        throw new SnippetSourceError('format', stmt.declaration)
      }
      return stmt.declaration
    }
    // An object literal is accepted without wrapping it in an array.
    const expr = parseExpressionAt(source, first.start, syntax)
    const rest = tokenizer(source.slice(expr.end), syntax)
    let next = rest.getToken()
    if (next.type.label === ';') next = rest.getToken()
    if (next.type.label !== 'eof') throw new SnippetSourceError('format')
    return expr
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    const loc = (error as SyntaxError & { loc: { line: number; column: number } }).loc
    const result = new SnippetSourceError('syntax')
    result.issue.line = loc.line
    result.issue.column = loc.column + 1
    throw result
  }
}

function fieldsOf(node: Expression): Map<string, Expression> {
  if (node.type !== 'ObjectExpression') throw new SnippetSourceError('format', node)
  const fields = new Map<string, Expression>()
  for (const prop of node.properties) {
    if (prop.type !== 'Property' || prop.kind !== 'init' || prop.computed || prop.shorthand || prop.method) {
      throw new SnippetSourceError('format', prop)
    }
    const key = prop.key.type === 'Identifier' ? prop.key.name
      : prop.key.type === 'Literal' ? prop.key.value : undefined
    if (typeof key !== 'string' || fields.has(key)
      || !['trigger', 'replacement', 'options', 'priority', 'description', 'excludedMacros', 'flags'].includes(key)) {
      throw new SnippetSourceError('field', prop, typeof key === 'string' ? key : undefined)
    }
    fields.set(key, prop.value)
  }
  return fields
}

function asText(node: Expression | undefined): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked ?? undefined
  return undefined
}

export function parseSnippetSource(
  source: string,
  { preserve, single = false, allowEmpty = false, variables }: {
    preserve?: { index: number; replacementCode: string | null }
    single?: boolean
    allowEmpty?: boolean
    // Supplying variable bindings also requests validation of the resulting regex.
    variables?: Readonly<Record<string, string>>
  } = {},
): ParsedSnippet[] {
  const expression = readExpressions(source)
  const items = expression.type === 'ArrayExpression' ? expression.elements : [expression]
  if (!items.length && !allowEmpty) throw new SnippetSourceError('empty', expression)
  if (single && items.length !== 1) throw new SnippetSourceError('single', expression)
  return items.map(node => {
    if (!node || node.type === 'SpreadElement') throw new SnippetSourceError('format', node ?? expression)
    const fields = fieldsOf(node)
    const trigger = fields.get('trigger')
    const textTrigger = asText(trigger)
    const regex = trigger?.type === 'Literal' ? trigger.regex : undefined
    if (!textTrigger && !regex) throw new SnippetSourceError('trigger', trigger ?? node)
    const optionsNode = fields.get('options')
    const options = asText(optionsNode)
    if (options === undefined || !/^[tmnMTArwvU]*$/.test(options)) {
      throw new SnippetSourceError('options', optionsNode ?? node)
    }
    const flagsNode = fields.get('flags')
    const flags = asText(flagsNode) ?? ''
    if ((flagsNode && asText(flagsNode) === undefined) || !/^[imsu]*$/.test(flags)
      || (regex && !/^[imsu]*$/.test(regex.flags)) || (flags && !regex && !options.includes('r'))) {
      throw new SnippetSourceError('regex', flagsNode ?? trigger)
    }
    if (options.includes('v') && (regex || options.includes('r')
      || (textTrigger!.length !== 1 && !/\$\{\w+\}/.test(textTrigger!)))) {
      throw new SnippetSourceError('trigger', trigger)
    }
    const actualTrigger = regex || options.includes('r')
      ? { pattern: regex?.pattern ?? textTrigger!, flags: [...new Set((regex?.flags ?? '') + flags)].join('') }
      : textTrigger!
    try {
      if (variables) snippetTrigger(actualTrigger, options, variables)
    } catch (error) {
      if (error instanceof InvalidLiteralTrigger) throw new SnippetSourceError('trigger', trigger)
      if (!(error instanceof SyntaxError)) throw error
      throw new SnippetSourceError('regex', trigger)
    }
    const replacement = fields.get('replacement')
    const textReplacement = asText(replacement)
    let resolvedReplacement: SnippetData['replacement']
    if (textReplacement !== undefined) resolvedReplacement = textReplacement
    else if (replacement?.type === 'FunctionExpression' || replacement?.type === 'ArrowFunctionExpression') {
      if (preserve?.replacementCode !== source.slice(replacement.start, replacement.end)
        || typeof actualTrigger === 'string') throw new SnippetSourceError('function', replacement)
      resolvedReplacement = { builtin: preserve.index }
    } else throw new SnippetSourceError('replacement', replacement ?? node)

    const priorityNode = fields.get('priority')
    const numericPriority = priorityNode?.type === 'UnaryExpression' && priorityNode.operator === '-'
      && priorityNode.argument.type === 'Literal' && typeof priorityNode.argument.value === 'number'
      ? -priorityNode.argument.value : priorityNode?.type === 'Literal' ? priorityNode.value : undefined
    if (priorityNode && (typeof numericPriority !== 'number' || !Number.isFinite(numericPriority))) {
      throw new SnippetSourceError('priority', priorityNode)
    }
    const descriptionNode = fields.get('description')
    const description = asText(descriptionNode)
    if (descriptionNode && description === undefined) throw new SnippetSourceError('field', descriptionNode, 'description')
    const macrosNode = fields.get('excludedMacros')
    let excludedMacros: string[] | undefined
    if (macrosNode) {
      if (macrosNode.type !== 'ArrayExpression') throw new SnippetSourceError('macros', macrosNode)
      excludedMacros = macrosNode.elements.map(item => {
        const name = item ? asText(item as Expression) : undefined
        if (!name) throw new SnippetSourceError('macros', item ?? macrosNode)
        return name
      })
    }
    return {
      source: items.length === 1 ? source.trim() : source.slice(node.start, node.end),
      rule: {
        trigger: actualTrigger, replacement: resolvedReplacement, options,
        ...(typeof numericPriority === 'number' ? { priority: numericPriority } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(excludedMacros ? { excludedMacros } : {}),
      },
    }
  })
}

export function bundledSnippetSources(source: string): BundledSource[] {
  const declaration = parse(source, syntax).body.find(node => node.type === 'ExportDefaultDeclaration')
  if (declaration?.declaration.type !== 'ArrayExpression') throw new Error('Expected the bundled snippet array')
  return declaration.declaration.elements.map(node => {
    if (!node || node.type === 'SpreadElement') throw new Error('Expected bundled snippet object')
    const replacement = fieldsOf(node).get('replacement')!
    return {
      source: source.slice(node.start, node.end),
      replacementCode: replacement.type === 'ArrowFunctionExpression' || replacement.type === 'FunctionExpression'
        ? source.slice(replacement.start, replacement.end) : null,
    }
  })
}

export function parseSnippetVariables(source: string): Record<string, string> {
  if (!source.trim()) return {}
  const expression = readExpressions(source)
  if (expression.type !== 'ObjectExpression') throw new SnippetSourceError('format', expression)
  const variables: [string, string][] = []
  const used = new Set<string>()
  for (const prop of expression.properties) {
    if (prop.type !== 'Property' || prop.kind !== 'init' || prop.computed || prop.shorthand || prop.method) {
      throw new SnippetSourceError('format', prop)
    }
    const key = prop.key.type === 'Identifier' ? prop.key.name : asText(prop.key)
    const name = key?.replace(/^\$\{(\w+)\}$/, '$1')
    const value = asText(prop.value)
    if (!name || !/^\w+$/.test(name) || used.has(name) || value === undefined) {
      throw new SnippetSourceError('field', prop, key)
    }
    used.add(name)
    variables.push([name, value])
  }
  return Object.fromEntries(variables)
}
