import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fraction } from '../src/math.ts'
import { defaultPreferences } from '../src/preferences.ts'

test('auto-fraction keeps a balanced numerator and inserts two cursor stops', () => {
  assert.deepEqual(fraction('a+(x + y)', 0, []), {
    from: 2, insert: '\\frac{x + y}{}',
    stops: [[{ from: 13, to: 13 }], [{ from: 14, to: 14 }]],
  })
  assert.equal(fraction('a^{x', 0, ['^']), null)
})

test('auto-fraction respects nested, custom, and escaped exclusion delimiters', () => {
  const round = { ...defaultPreferences, fractionExcluded: '[["(", ")"]]' }
  assert.equal(fraction('(x+(y)z', 0, [], '', round), null)
  assert.equal(fraction('z', 0, [], '', round, '(x+(y))z')?.insert, '\\frac{z}{}')
  assert.equal(fraction('z', 0, [], '', round, '\\(z')?.insert, '\\frac{z}{}')

  const compound = { ...defaultPreferences, fractionExcluded: '[["tag{", "}"], ["|", "|"]]' }
  assert.equal(fraction('z', 0, [], '', compound, 'tag{x{y}z'), null)
  assert.equal(fraction('z', 0, [], '', compound, 'tag{x{y}}z')?.insert, '\\frac{z}{}')
  assert.equal(fraction('z', 0, [], '', compound, '|x+z'), null)
  assert.equal(fraction('z', 0, [], '', compound, '|x|+z')?.insert, '\\frac{z}{}')
})
