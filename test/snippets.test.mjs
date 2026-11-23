import assert from 'node:assert/strict'
import { test } from 'node:test'
import { activeGroups, createSnippetExpander, expandSnippet } from '../src/snippets.ts'
import { defaultPreferences } from '../src/preferences.ts'

test('expands the upstream square shortcut only in math', () => {
  assert.deepEqual(expandSnippet('$xsr', '$', 'inline', 'auto'), {
    from: 2, insert: '^{2}', stops: [],
  })
  assert.equal(expandSnippet('xsr', '', 'text', 'auto'), null)
})

test('keeps defaults and capture numbering in an upstream derivative shortcut', () => {
  const result = expandSnippet('$par3', '$', 'inline', 'auto')
  assert.equal(result.insert, '\\frac{ \\partial^{3} y }{ \\partial x^{3} }')
  assert.deepEqual(result.stops.slice(0, 2).map(([stop]) => result.insert.slice(stop.from, stop.to)), ['y', 'x'])
})

test('preserves selection text literally and selects the wrapped result when there is no tab stop', () => {
  const result = expandSnippet('$', '$', 'inline', { key: 'S', selected: '$0' })
  assert.equal(result.insert, '\\sqrt{ $0 }')
  assert.deepEqual(result.stops, [[{ from: 0, to: result.insert.length }]])
})

test('does not apply ordinary math expansions inside math text', () => {
  assert.equal(expandSnippet('$\\text{@t', '}$', 'inline', 'auto', ['text']), null)
})

test('mk inserts exactly an inline dollar pair and starts between the delimiters', () => {
  assert.deepEqual(expandSnippet('mk', '', 'text', 'auto'), {
    from: 0, insert: '$$', stops: [[{ from: 1, to: 1 }]],
  })
})

test('the built-in subscript function uses the configured Greek variable', () => {
  const expand = createSnippetExpander([], defaultPreferences, { GREEK: 'nabla' })
  assert.equal(expand('$\\nabla3', '$', 'inline', 'auto')?.insert, '\\nabla_{3}')
  assert.equal(expand('$\\alpha3', '$', 'inline', 'auto')?.insert, '\\alpha 3')
})

test('the list dm function leaves capture-like text in the list item unchanged', () => {
  assert.equal(expandSnippet('- [[0]] dm', '', 'text', 'auto')?.insert, '- [[0]] \n  $$\n  \n  $$')
})

test('upstream escaped newline in the word delimiter setting matches an actual line break', () => {
  const expand = createSnippetExpander([], { ...defaultPreferences, wordDelimiters: '\\n' })
  assert.equal(expand('and', '\n', 'display', 'auto')?.insert, '\\cap')
  assert.equal(expand('and', 'n', 'display', 'auto'), null)
})

test('ordinary math snippets resume inside mk-created math inside a text macro', () => {
  const before = '\\text{\\(@t'
  assert.equal(expandSnippet(before, '\\)}', 'inline', 'auto', activeGroups(before))?.insert, '\\theta')
  assert.equal(expandSnippet('\\text{\\(x\\)@t', '}', 'inline', 'auto', activeGroups('\\text{\\(x\\)@t')), null)
})

test('a math fence accepts both inline and display snippet triggers', () => {
  assert.equal(expandSnippet(' xbeg', '\n', 'codeMath', 'auto')?.insert, ' x\\begin{}  \\end{}')
  assert.equal(expandSnippet('pmat', '\n', 'codeMath', 'auto')?.insert, '\\begin{pmatrix}\n\n\\end{pmatrix}')
})
