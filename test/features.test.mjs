import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Text } from '@codemirror/state'
import { defaultPreferences, patchPreferences } from '../src/preferences.ts'
import { fraction } from '../src/math.ts'
import { bracketPairs, matrixEdit, enlargement, taboutOffset } from '../src/math-features.ts'

test('uses the saved fraction command and breaks only on the configured characters', () => {
  const options = patchPreferences(defaultPreferences, { fractionCommand: '\\dfrac', fractionBreak: '+' })
  assert.equal(fraction('x-y', 0, [], '', options).insert, '\\dfrac{x-y}{}')
  assert.equal(fraction('x+y', 0, [], '', options).insert, '\\dfrac{y}{}')
  assert.equal(patchPreferences(defaultPreferences, { fractionCommand: '' }), null)
})

test('matrix navigation edits only the configured environment and keeps quote indentation', () => {
  const doc = Text.of(['> $$', '> \\begin{pmatrix}', '> x', '> \\end{pmatrix}', '> $$'])
  const inner = doc.sliceString(4, doc.length - 2)
  const pos = doc.line(3).to
  assert.equal(matrixEdit(doc, {from:4,to:doc.length-2,end:doc.length,mode:'display'}, pos, 'cell', defaultPreferences)?.insert, ' & ')
  assert.equal(matrixEdit(doc, {from:4,to:doc.length-2,end:doc.length,mode:'display'}, pos, 'row', defaultPreferences)?.insert, ' \\\\\n> ')
  assert.equal(matrixEdit(doc, {from:4,to:doc.length-2,end:doc.length,mode:'display'}, pos, 'exit', defaultPreferences)?.cursor, doc.line(4).to)
  assert.match(inner, /pmatrix/)
})

test('leaves bracket arguments alone and enlarges unsized math fences around fractions', () => {
  const tex = '(\\frac{x}{y}) + [z]'
  const changes = enlargement(tex, defaultPreferences)
  assert.deepEqual(changes, [{from:0,to:1,insert:'\\left( '},{from:12,to:13,insert:' \\right)'}])
  assert.equal(bracketPairs('\\left( x \\right)').length, 1)
  assert.equal(taboutOffset('x\\right) + y', defaultPreferences), 8)
})

test('tabout recognizes sized right delimiters even when the symbol is not a bare closer', () => {
  assert.equal(taboutOffset('x\\bigr|+y', defaultPreferences), 'x\\bigr|'.length)
  assert.equal(taboutOffset('x\\Biggr\\Vert+y', defaultPreferences), 'x\\Biggr\\Vert'.length)
  assert.equal(taboutOffset('x\\right + y', defaultPreferences), 'x\\right'.length)
  assert.equal(taboutOffset('x\\left\\rvert + y', defaultPreferences), null)
})

test('a new align row preserves the current row’s leading alignment cells', () => {
  const doc = Text.of(['> $$', '> \\begin{align}', '>   & x=y', '> \\end{align}', '> $$'])
  const region = { from: doc.line(2).from, to: doc.line(4).to, end: doc.length, mode: 'display' }
  assert.equal(matrixEdit(doc, region, doc.line(3).to, 'row', defaultPreferences)?.insert, ' \\\\\n>   & ')
  const inline = Text.of(['$$\\begin{align}& a=b \\\\ & x=y\\end{align}$$'])
  const inlineEnd = inline.toString().indexOf('\\end')
  assert.equal(matrixEdit(inline,
    { from: 2, to: inline.length - 2, end: inline.length, mode: 'display' },
    inlineEnd, 'row', defaultPreferences)?.insert, ' \\\\  & ')
})

test('tabout uses the whole equation to resolve a right command at the cursor and custom closers', () => {
  const tex = '(x) + y\\bigr|+z'
  assert.equal(taboutOffset(tex, defaultPreferences, tex.indexOf('|')), tex.indexOf('|') + 1)
  assert.equal(taboutOffset(tex, defaultPreferences, tex.indexOf('|') + 1), null)
  const custom = { ...defaultPreferences, taboutClosers: '/, »' }
  assert.equal(taboutOffset('x / y » z', custom), 3)
  assert.equal(taboutOffset('x / y » z', custom, 4), 7)
})

test('tabout does not treat delimiters in a TeX line comment as targets', () => {
  const tex = 'x % ) ignored\n(y)'
  assert.equal(taboutOffset(tex, defaultPreferences, 1), tex.length)
  assert.equal(taboutOffset('x \\% (y)', defaultPreferences, 1), 8)
})
