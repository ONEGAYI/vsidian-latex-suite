import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const local = relative => fileURLToPath(new URL(relative, import.meta.url))
const bundle = await build({
  stdin: {
    resolveDir: local('..'),
    contents: String.raw`
      import * as state from '@codemirror/state'
      import * as view from '@codemirror/view'
      import { mathAppearance } from './src/math-appearance.ts'
      import { defaultPreferences } from './src/preferences.ts'
      const prefs = { ...defaultPreferences, conceal: true, previewCursor: '›' }
      const zone = (view, position) => position > 0 && position < view.state.doc.length
        ? {from: 1, to: view.state.doc.length - 1, end: view.state.doc.length, mode: 'inline'} : null
      const feature = mathAppearance({state,view}, zone, () => prefs)
      globalThis.editor = new view.EditorView({
        doc: '$\\alpha+(x)$', extensions: feature.extension, parent: document.querySelector('main'),
      })
      globalThis.options = prefs
      globalThis.redraw = () => editor.dispatch({ effects: feature.refresh.of() })
    `,
  },
  bundle: true, write: false, format: 'iife', target: 'chrome114',
})
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 760, height: 410 } })
  page.on('pageerror', error => console.error(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  await page.setContent(`<!doctype html><style>
    body { padding: 130px 40px; font: 16px system-ui; color: #d3d3d3; background: #202123; }
    :root {
      --vscode-editor-foreground: #d3d3d3; --vscode-editor-background: #202123;
      --vscode-editorBracketHighlight-foreground1: #e5c65d; --vscode-editorBracketMatch-background: #374657;
      --vscode-symbolIcon-operatorForeground: #79b6f3; --vscode-editorHoverWidget-background: #292c30;
      --vscode-editorHoverWidget-border: #4d6483; --vscode-widget-shadow: #101112;
    }
  </style><main></main>`)
  await page.addStyleTag({ path: local('../dist/editor.css') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.locator('.cm-content').click()
  await page.evaluate(() => editor.dispatch({ selection: { anchor: 9 } }))

  const popup = page.locator('.ls-math-preview math')
  try { await popup.waitFor({ timeout: 3000 }) } catch (error) {
    console.error(await page.evaluate(() => ({ focused: editor.hasFocus, tooltip: document.querySelector('.cm-tooltip')?.outerHTML, content: editor.contentDOM.innerHTML })))
    throw error
  }
  assert.equal(await page.locator('.ls-math-preview').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(41, 44, 48)')
  const bounds = await popup.boundingBox()
  assert.ok(bounds.width > 10 && bounds.height > 8)
  assert.equal(await page.locator('.ls-math-glyph').innerText(), 'α')
  assert.equal(await page.locator('.ls-bracket-current').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(55, 70, 87)')
  assert.equal(await page.locator('.ls-math-dollar').first().evaluate(el => getComputedStyle(el).color), 'rgb(121, 182, 243)')
  assert.equal(await page.evaluate(() => editor.state.doc.toString()), '$\\alpha+(x)$')
  await mkdir(local('../out/test'), { recursive: true })
  await page.screenshot({ path: local('../out/test/math-appearance.png') })
  await page.evaluate(() => {
    options.concealDelay = 0
    editor.dispatch({ selection: { anchor: 3 } })
  })
  const glyph = page.locator('.ls-math-glyph')
  await glyph.waitFor({ state: 'hidden', timeout: 1500 })
  await page.evaluate(() => { options.concealDelay = 300; redraw() })
  await glyph.waitFor({ state: 'visible', timeout: 1500 })
  await glyph.waitFor({ state: 'hidden', timeout: 1500 })
  assert.match(await page.locator('.cm-content').innerText(), /\\alpha/)

  await page.evaluate(() => {
    const formula = '$\\frac{a}{b}$'
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: formula },
      selection: { anchor: formula.indexOf('{b}') },
    })
  })
  const previewFraction = popup.locator('mfrac')
  await previewFraction.waitFor({ timeout: 1500 })
  assert.equal(await previewFraction.locator(':scope > :nth-child(2)').textContent(), 'b')
  assert.equal(await page.locator('.ls-math-preview .katex-error').count(), 0)

  for (const anchor of [2, 3]) {
    await page.evaluate(anchor => editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: '$x^2$' }, selection: { anchor },
    }), anchor)
    const superscript = popup.locator('msup')
    await superscript.waitFor({ timeout: 1500 })
    assert.equal(await superscript.textContent(), 'x2')
  }

  await page.evaluate(() => {
    options.preview = false
    options.conceal = false
    options.bracketColors = false
    options.bracketAtCursor = false
    options.highlightDollars = false
    redraw()
  })
  await popup.waitFor({ state: 'hidden' })
  assert.equal(await page.locator('.ls-math-glyph, .ls-bracket-current, .ls-math-dollar').count(), 0)
  console.log('PASS: drawn conceal, bracket and dollar decorations, and MathML popup respond to settings')
} finally {
  await browser.close()
}
