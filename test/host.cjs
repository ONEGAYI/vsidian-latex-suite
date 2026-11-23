const assert = require('node:assert/strict')
const vscode = require('vscode')
const ADDON_ID = 'ONEGAYI.vsidian-latex-suite'

exports.run = async () => {
  await vscode.extensions.getExtension('onegayi.vsidian').activate()
  const root = vscode.workspace.workspaceFolders[0].uri
  const command = (suffix, ...args) => vscode.commands.executeCommand('onegayi.vsidian._test.' + suffix, ...args)
  const channel = (topic, payload) => command('addonChannelRequest', { addonId: ADDON_ID, topic, payload })
  const events = (options) => command('addonPageEvents', options)
  const watchCount = async () => (await events()).filter(event => event.topic === 'snippets.watch'
    && event.addonId.toLowerCase() === ADDON_ID.toLowerCase()).length
  async function waitFor(label, probe) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      if (await probe()) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Timeout: ' + label)
  }
  async function open(name, text, caret, head = caret) {
    // The test hook retains only the most recent 200 events. Start an observation window for this fixture.
    await events({ clear: true })
    const uri = vscode.Uri.joinPath(root, name)
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text))
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.commands.executeCommand('vscode.openWith', uri, 'onegayi.vsidian.editor')
    const state = () => command('requestViewState', uri.toString(), 0)
    const post = message => command('postToPanel', uri.toString(), message)
    await waitFor('Live editor ready: ' + name, async () => {
      const snapshot = await state()
      return snapshot?.viewMode === 'live' && snapshot.addonPage?.active.some(
        entry => entry.addonId.toLowerCase() === 'onegayi.vsidian-latex-suite',
      )
    })
    await waitFor('snippet rules loaded: ' + name, async () => (await watchCount()) >= 2)
    await post({ kind: 'table.test.crossSelect', anchor: caret, head })
    await waitFor('caret: ' + name, async () => (await state())?.selectionHead === head)
    return { doc, state, post, watches: await watchCount() }
  }
  const square = await open('square.md', '$xs$', 3)
  await square.post({ kind: 'table.test.key', key: 'r' })
  await waitFor('automatic square expansion', () => square.doc.getText() === '$x^{2}$')
  assert.equal((await square.state()).selectionHead, 6)
  console.log('PASS: automatic square expansion')

  await square.post({ kind: 'table.test.history', op: 'undo' })
  await waitFor('undo square', () => square.doc.getText() === '$xs$')
  console.log('PASS: host undo')


  const inline = await open('inline-mk.md', 'm', 1)
  await inline.post({ kind: 'table.test.key', key: 'k' })
  await waitFor('mk inserts bare inline delimiters', async () => inline.doc.getText() === '$$'
    && (await inline.state()).selectionHead === 1)
  await inline.post({ kind: 'table.test.domType', text: '@' })
  await waitFor('mk caret accepts literal formula input', () => inline.doc.getText() === '$@$')
  await inline.post({ kind: 'table.test.key', key: 't' })
  await waitFor('mk-created formula expands math snippets', () => inline.doc.getText() === '$\\theta$')
  console.log('PASS: mk creates brace-free inline math and expands inside it')

  const display = await open('display.md', 'd', 1)
  await display.post({ kind: 'table.test.key', key: 'm' })
  await waitFor('display math snippet', () => display.doc.getText().replaceAll('\r\n', '\n') === '$$\n\n$$')
  assert.equal((await display.state()).selectionHead, 3)
  await display.post({ kind: 'table.test.domType', text: '@' })
  await waitFor('display math input', () => display.doc.getText().replaceAll('\r\n', '\n') === '$$\n@\n$$')
  await display.post({ kind: 'table.test.key', key: 't' })
  await waitFor('display math expansion', () => display.doc.getText().replaceAll('\r\n', '\n') === '$$\n\\theta\n$$')
  console.log('PASS: display math creation and expansion')

  const multilineText = '$$\nx\n\n  \n$$'
  const quote = await open('quote-after-blank-lines.md', multilineText, multilineText.lastIndexOf('\n'))
  await quote.post({ kind: 'table.test.key', key: '"' })
  await waitFor('line-start text snippet sees the entire preceding whitespace run', () =>
    quote.doc.getText().replaceAll('\r\n', '\n') === '$$\nx\n\\text{ } \n$$')
  console.log('PASS: upstream line-start text snippet spans preceding blank lines')

  const nestedText = '$\\text{m}$'
  const nested = await open('nested-mk.md', nestedText, nestedText.indexOf('}'))
  await nested.post({ kind: 'table.test.key', key: 'k' })
  await waitFor('math-text mk creates inner math', () => nested.doc.getText() === '$\\text{\\(\\)}$')
  await nested.post({ kind: 'table.test.domType', text: '@' })
  await waitFor('math-text mk caret starts inside the inner delimiters', () => nested.doc.getText() === '$\\text{\\(@\\)}$')
  await nested.post({ kind: 'table.test.key', key: 't' })
  await waitFor('inner math permits regular snippets', () => nested.doc.getText() === '$\\text{\\(\\theta\\)}$')
  console.log('PASS: upstream math-text mk allows a snippet inside its new delimiters')

  const wrapped = await open('wrap-sqrt.md', '$x+y$', 1, 4)
  await wrapped.post({ kind: 'table.test.key', key: 'S' })
  await waitFor('S wraps and selects the entire result', async () => {
    const result = '$\\sqrt{ x+y }$'
    const { selectionOffset, selectionHead } = await wrapped.state()
    return wrapped.doc.getText() === result && selectionOffset === 1 && selectionHead === result.length - 1
  })
  console.log('PASS: upstream S keeps the wrapped result selected')

  const derivative = await open('derivative.md', '$par$', 4)
  await derivative.post({ kind: 'table.test.key', key: 'tab' })
  const expected = '$\\frac{ \\partial y }{ \\partial x }$'
  await waitFor('manual derivative snippet', () => derivative.doc.getText() === expected)
  assert.equal((await derivative.state()).selectionOffset, expected.indexOf('y'))
  await derivative.post({ kind: 'table.test.key', key: 'tab' })
  await waitFor('next derivative placeholder', async () => (await derivative.state()).selectionOffset === expected.indexOf('x'))
  await derivative.post({ kind: 'table.test.key', key: 'shift-tab' })
  await waitFor('previous derivative placeholder', async () => (await derivative.state()).selectionOffset === expected.indexOf('y'))
  console.log('PASS: manual expansion and forward/backward placeholder navigation')

  const frac = await open('fraction.md', '$x$', 2)
  await frac.post({ kind: 'table.test.key', key: '/' })
  await waitFor('automatic fraction', () => frac.doc.getText() === '$\\frac{x}{}$')
  await frac.post({ kind: 'table.test.domType', text: 'y' })
  await waitFor('denominator text', () => frac.doc.getText() === '$\\frac{x}{y}$')
  await frac.post({ kind: 'table.test.key', key: 'tab' })
  await waitFor('fraction exit', async () => (await frac.state()).selectionHead === frac.doc.getText().length - 1)
  console.log('PASS: fraction and mapped cursor stops')

  const codeText = '```text\n$xs$\n```\n'
  const code = await open('code.md', codeText, codeText.indexOf('s$') + 1)
  await code.post({ kind: 'table.test.key', key: 'r' })
  await code.post({ kind: 'table.test.domType', text: 'r' })
  await waitFor('literal code input', () => code.doc.getText() === codeText.replace('xs', 'xsr'))
  console.log('PASS: fenced code is left untouched')

  const actualSettings = await channel('snippets.settings', null)
  assert.equal(actualSettings.ok, true)
  const sr = actualSettings.result.rows.find(row => row.trigger === 'sr')
  assert.match(sr.source, /replacement:\s*"\^\{2\}"/)
  const configured = await open('configured.md', '$xs$', 3)
  const changed = await channel('snippets.save', {
    id: sr.id, enabled: true, source: '{trigger: "sr", replacement: "^{4}", options: "mA"}',
  })
  assert.equal(changed.result.ok, true)
  await waitFor('open editor has received saved rule', async () => (await watchCount()) > configured.watches)
  await configured.post({ kind: 'table.test.key', key: 'r' })
  await waitFor('same open editor expands edited rule', () => configured.doc.getText() === '$x^{4}$')
  console.log('PASS: saved override reaches the same open editor')

  const custom = await channel('snippets.save', {
    id: null, enabled: true,
    source: '{trigger: "/", replacement: "\\\\sqrt{${VISUAL}}", options: "mA"}',
  })
  assert.equal(custom.result.ok, true)
  const visual = await open('visual.md', '$x$', 1, 2)
  await visual.post({ kind: 'table.test.key', key: '/' })
  await waitFor('custom selection snippet takes priority over auto-fraction', () => visual.doc.getText() === '$\\sqrt{x}$')
  console.log('PASS: custom declarative selection snippet')

  const unconverted = await open('fraction-toggle.md', '$x$', 2)
  assert.equal((await channel('snippets.preferences', { autoFraction: false })).result.ok, true)
  await waitFor('options reach already opened editor', async () => (await watchCount()) > unconverted.watches)
  await unconverted.post({ kind: 'table.test.key', key: '/' })
  await unconverted.post({ kind: 'table.test.domType', text: '/' })
  await waitFor('disabled auto-fraction lets typing through', () => unconverted.doc.getText() === '$x/$')
  assert.equal((await channel('snippets.preferences', { autoFraction: true, fractionCommand: '\\dfrac' })).result.ok, true)
  const dfrac = await open('chosen-fraction.md', '$x$', 2)
  await dfrac.post({ kind: 'table.test.key', key: '/' })
  await waitFor('configured fraction macro is written', () => dfrac.doc.getText() === '$\\dfrac{x}{}$')
  console.log('PASS: hot auto-fraction settings change the production input path')


  assert.equal((await channel('snippets.preferences', { fractionCommand: '\\frac' })).result.ok, true)
  const enclosed = await open('enlarge.md', '$(x)$', 3)
  await enclosed.post({ kind: 'table.test.key', key: '/' })
  await waitFor('fraction resizes both enclosing delimiters', () => enclosed.doc.getText() === '$\\left( \\frac{x}{} \\right)$')
  await enclosed.post({ kind: 'table.test.history', op: 'undo' })
  await waitFor('fraction and resizing undo together', () => enclosed.doc.getText() === '$(x)$')
  console.log('PASS: enlargement and fraction share the host undo boundary')

  const matrixText = '$$\\begin{pmatrix}x\\end{pmatrix}$$'
  const cellPosition = matrixText.indexOf('x\\end') + 1
  const matrix = await open('matrix.md', matrixText, cellPosition)
  await matrix.post({ kind: 'table.test.key', key: 'tab' })
  await waitFor('matrix Tab inserts a cell', () => matrix.doc.getText() === matrixText.replace('x\\end', 'x & \\end'))
  await matrix.post({ kind: 'table.test.key', key: 'enter' })
  await waitFor('matrix Enter inserts a new row', () => matrix.doc.getText() === matrixText.replace('x\\end', 'x &  \\\\  \\end'))
  console.log('PASS: real matrix cell and row shortcuts')


  const sized = '$\\bigl|x\\bigr|+y$'
  const rightAt = sized.lastIndexOf('|')
  const tabout = await open('sized-tabout.md', sized, rightAt)
  await tabout.post({ kind: 'table.test.key', key: 'tab' })
  await waitFor('tab jumps past the sized right delimiter', async () => (await tabout.state()).selectionHead === rightAt + 1)
  assert.equal(tabout.doc.getText(), sized)
  console.log('PASS: Tab crosses a sized delimiter without changing formula text')


  const temporary = await channel('snippets.save', {
    id: null, enabled: true, source: '{trigger:"delme",replacement:"gone",options:"mA"}',
  })
  assert.ok(temporary.result.ok)
  const deletion = await open('delete-live.md', '$delm$', 5)
  const removed = await channel('snippets.manage', { action: 'delete', ids: [temporary.result.selected] })
  assert.ok(removed.result.ok)
  await waitFor('open editor has received deletion', async () => (await watchCount()) > deletion.watches)
  await deletion.post({ kind: 'table.test.key', key: 'e' })
  await deletion.post({ kind: 'table.test.domType', text: 'e' })
  await waitFor('deleted snippet leaves its trigger literal', () => deletion.doc.getText() === '$delme$')
  console.log('PASS: deletion updates an already open Live editor')

  const disabled = await open('disabled.md', '$xs$', 3)
  await command('addonSetEnabled', { addonId: ADDON_ID, enabled: false })
  await waitFor('unload on disable', async () => !(await disabled.state()).addonPage.active.length)
  await disabled.post({ kind: 'table.test.key', key: 'r' })
  await disabled.post({ kind: 'table.test.domType', text: 'r' })
  await waitFor('disabled leaves keys alone', () => disabled.doc.getText() === '$xsr$')
  console.log('PASS: hot disable removes the editor feature')

  await vscode.commands.executeCommand('onegayi.vsidian.openSettings')
  await waitFor('Vsidian settings ready', async () => (await command('settingsPageInfo'))?.ready === true)
  assert.equal(await command('addonOpenSettingsPage', { addonId: ADDON_ID }), 'ok')
  await waitFor('registered settings page loads and requests snippets while disabled', async () =>
    (await events()).some(event => event.panel === 'settings' && event.kind === 'outbound.request'
      && event.topic === 'snippets.settings' && event.addonId.toLowerCase() === ADDON_ID.toLowerCase()))
  console.log('PASS: registered settings page loads and reads snippets while disabled')
}
