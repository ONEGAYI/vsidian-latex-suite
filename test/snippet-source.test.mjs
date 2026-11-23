import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSnippetSource } from '../src/snippet-source.ts'
import { createSnippetExpander } from '../src/snippets.ts'

test('accepts an Obsidian snippet array and expands its regex captures and tab stops', () => {
  const [snippet] = parseSnippetSource(String.raw`
    // A text rule in the upstream format
    export default [
      {trigger: /([a-z])qq/, replacement: "\\overline{[[0]]}{$0}", options: "mA", priority: 2},
    ];
  `)
  const expand = createSnippetExpander([{ id: 'user:qq', enabled: true, rule: snippet.rule }])
  assert.deepEqual(expand('$xqq', '$', 'inline', 'auto'), {
    from: 1, insert: '\\overline{x}{}', stops: [[{ from: 13, to: 13 }]],
  })
})

test('all bundled entries can be saved without losing their executable meaning', async () => {
  const { readFile } = await import('node:fs/promises')
  const { bundledSnippetSources } = await import('../src/snippet-source.ts')
  const { defaultId } = await import('../src/snippet-rules.ts')
  const sources = bundledSnippetSources(await readFile(new URL('../src/upstream/default_snippets.js', import.meta.url), 'utf8'))
  for (const [index, original] of sources.entries()) {
    const [parsed] = parseSnippetSource(original.source, { preserve: { ...original, index }, single: true })
    if (original.replacementCode) assert.deepEqual(parsed.rule.replacement, { builtin: index })
  }

  const index = sources.findIndex(entry => entry.source.includes('/iden'))
  assert.notEqual(index, -1)
  const original = sources[index]
  const [edited] = parseSnippetSource(original.source.replace('description: "N x N identity matrix"', 'description: "Identity"'),
    { preserve: { ...original, index }, single: true })
  const expand = createSnippetExpander([{ id: defaultId(index), enabled: true, rule: edited.rule }])
  assert.equal(expand('$iden2', '$', 'inline', 'auto')?.insert, '\\begin{pmatrix}\n1 & 0 \\\\\n0 & 1\n\\end{pmatrix}')
})

test('rejects executing any text that is not a declarative snippet', () => {
  assert.throws(() => parseSnippetSource('{trigger: "u", replacement: () => "a", options: "mA"}'), /function/)
  assert.throws(() => parseSnippetSource('export default [{trigger:"u", replacement: "", options: "mA"}]; void 0'), /format/)
})

test('upstream one-character VISUAL template expands only on a selection, without a v flag', () => {
  const [snippet] = parseSnippetSource('{ trigger: "=", replacement: "[${VISUAL}]", options: "mA", priority: 100 }')
  const expand = createSnippetExpander([{ id: 'user:visual', enabled: true, rule: snippet.rule }])
  assert.deepEqual(expand('$', '$', 'inline', { key: '=', selected: 'x+y' }), {
    from: 1, insert: '[x+y]', stops: [[{ from: 0, to: 5 }]],
  })
  assert.equal(expand('$=', '$', 'inline', 'auto'), null)
})

test('omitting mode flags allows text, inline math, block math, and math text', () => {
  const [snippet] = parseSnippetSource('{ trigger: "co+p", replacement: "all", options: "rA" }')
  const [manual] = parseSnippetSource('{ trigger: "when-tab", replacement: "manual", options: "" }')
  const expand = createSnippetExpander([
    { id: 'user:any', enabled: true, rule: snippet.rule },
    { id: 'user:manual', enabled: true, rule: manual.rule },
  ])
  for (const mode of ['text', 'inline', 'display']) {
    assert.equal(expand('coop', '', mode, 'auto')?.insert, 'all')
    assert.equal(expand('when-tab', '', mode, 'tab')?.insert, 'manual')
  }
  assert.equal(expand('coop', '', 'inline', 'auto', ['text'])?.insert, 'all')
})

test('explicit math and math-text modes combine without affecting normal text', () => {
  const [snippet] = parseSnippetSource('{ trigger: "mode-combined", replacement: "both", options: "mTA" }')
  const expand = createSnippetExpander([{ id: 'user:union', enabled: true, rule: snippet.rule }])
  assert.equal(expand('mode-combined', '', 'text', 'auto'), null)
  assert.equal(expand('mode-combined', '', 'display', 'auto')?.insert, 'both')
  assert.equal(expand('mode-combined', '', 'inline', 'auto', ['text'])?.insert, 'both')
})

test('variable bindings resolve literal triggers and one-character visual shortcuts', () => {
  const variables = { USERKEY: 'ab', SELECTKEY: ';' }
  const [snippet] = parseSnippetSource('{ trigger: "${USERKEY}qq", replacement: "resolved", options: "mA" }', { variables })
  const expand = createSnippetExpander([{ id: 'user:literal', enabled: true, rule: snippet.rule }], undefined, variables)
  assert.equal(expand('$abqq', '$', 'inline', 'auto')?.insert, 'resolved')
  assert.equal(expand('$${USERKEY}qq', '$', 'inline', 'auto'), null)

  const [visual] = parseSnippetSource('{ trigger: "${SELECTKEY}", replacement: "[${VISUAL}]", options: "mv" }', { variables })
  const select = createSnippetExpander([{ id: 'user:select-literal', enabled: true, rule: visual.rule }], undefined, variables)
  assert.equal(select('$', '$', 'inline', { key: ';', selected: 'x' })?.insert, '[x]')
  assert.throws(() => createSnippetExpander([{ id: 'user:select-literal', enabled: true, rule: visual.rule }],
    undefined, { ...variables, SELECTKEY: 'too-long' }), /trigger/)
})
