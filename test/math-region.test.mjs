import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Text } from '@codemirror/state'
import { mathRegion } from '../src/math.ts'

test('uses the active formula rather than an earlier literal dollar', () => {
  const line = '价格 $5，公式 $xs$'
  const pos = line.lastIndexOf('$')
  assert.deepEqual(mathRegion(Text.of([line]), pos, true, false), {
    mode: 'inline', from: line.indexOf('xs'), to: pos, end: pos + 1,
  })
})

test('accepts new empty delimiter pairs but not whitespace between existing equations', () => {
  assert.equal(mathRegion(Text.of(['$$']), 1, false, false)?.mode, 'inline')
  assert.equal(mathRegion(Text.of(['$$$$']), 2, false, false)?.mode, 'display')
  assert.equal(mathRegion(Text.of(['$x$   $y$']), 4, false, false), null)
})
