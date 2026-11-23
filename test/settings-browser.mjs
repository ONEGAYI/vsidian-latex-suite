import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { bundledSnippetSources } from '../src/snippet-source.ts'
import { createSnippetStore } from '../src/snippet-store.ts'
import { createSnippetExpander } from '../src/snippets.ts'

const local = relative => fileURLToPath(new URL(relative, import.meta.url))
const defaults = bundledSnippetSources(await readFile(local('../src/upstream/default_snippets.js'), 'utf8'))
const browser = await chromium.launch()
const directory = await mkdtemp(join(tmpdir(), 'latex-settings-'))
const file = join(directory, 'snippets.json')
const store = createSnippetStore(directory, defaults)
let choose = { ok: false, reason: 'timeout' }
let linkCalls = 0
try {
  const page = await browser.newPage({ viewport: { width: 930, height: 740 } })
  await page.setContent(`<style>
    :root {
      --vscode-foreground: #d4d4d4; --vscode-editor-background: #1e1e1e;
      --vscode-descriptionForeground: #a8a8a8; --vscode-input-background: #282828;
      --vscode-input-foreground: #e0e0e0; --vscode-button-background: #0e639c;
      --vscode-button-foreground: white; --vscode-button-secondaryBackground: #3a3d41;
      --vscode-button-secondaryForeground: white; --vscode-button-border: #89929e;
      --vscode-list-hoverBackground: #292d31;
      --vscode-list-activeSelectionBackground: #094771; --vscode-list-activeSelectionForeground: white;
      --vscode-focusBorder: #62aeff; --vscode-errorForeground: #f48771;
      --vscode-editor-font-family: Consolas, monospace;
      font: 14px system-ui; color: var(--vscode-foreground); background: var(--vscode-editor-background);
    }
    main { margin: 20px auto; max-width: 840px; }
  </style><main></main>`)
  await page.exposeFunction('snippetRequest', async (topic, payload) => {
    if (topic === 'snippets.settings') return { ok: true, result: await store.settings() }
    if (topic === 'snippets.preferences') return { ok: true, result: await store.savePreferences(payload) }
    if (topic === 'snippets.save') return { ok: true, result: await store.save(payload) }
    if (topic === 'snippets.manage') return { ok: true, result: await store.manage(payload) }
    if (topic === 'snippets.choose') return choose
    if (topic === 'snippets.link') {
      linkCalls++
      assert.equal(payload.ticket, 'picked-fixture')
      return { ok: true, result: await store.setFile('rules', async () => ({ uri: 'file:///fixture.js', source: '[]' })) }
    }
    throw new Error(topic)
  })
  await page.addStyleTag({ path: local('../dist/settings.css') })
  await page.addScriptTag({ path: local('../dist/settings.js') })
  await page.evaluate(async () => {
    const [entry] = globalThis.__vsidianAddonPages
    await entry.factory({
      locale: { get: () => 'zh-cn' },
      mountRoot: () => document.querySelector('main'),
      channel: { request: globalThis.snippetRequest },
      onDispose() {},
    })
  })


  await page.getByRole('button', { name: /^自动分式/ }).click()
  const fractionPanel = page.locator('.ls-feature-options')
  const fractionToggle = page.getByRole('checkbox', { name: '启用自动分式' })
  const secondWindow = createSnippetStore(directory, defaults)
  assert.ok((await secondWindow.savePreferences({ fractionCommand: '\\dfrac' })).ok)
  await fractionToggle.uncheck()
  await fractionPanel.getByRole('button', { name: '保存选项' }).click()
  await fractionPanel.getByRole('status').getByText('已保存', { exact: false }).waitFor()
  assert.equal((await store.watch(-1)).preferences.autoFraction, false)
  assert.equal((await store.watch(-1)).preferences.fractionCommand, '\\dfrac')
  assert.equal(await page.getByRole('textbox', { name: /^分式命令/ }).inputValue(), '\\dfrac')
  await page.getByRole('button', { name: /返回功能目录/ }).click()
  assert.equal(await page.locator('.ls-feature-link:visible').count(), 10)
  await mkdir(local('../out/test'), { recursive: true })
  await page.screenshot({ path: local('../out/test/feature-directory.png') })
  await page.getByRole('button', { name: /^公式片段/ }).click()

  const linkPanel = page.locator('.ls-feature-options').first()
  const link = linkPanel.getByRole('button', { name: '关联文件…' })
  await link.click()
  await linkPanel.getByRole('status').getByText('片段服务未响应', { exact: false }).waitFor()
  assert.equal(linkCalls, 0)
  choose = { ok: true, result: { ok: true, ticket: 'picked-fixture' } }
  await link.click()
  await linkPanel.getByText('file:///fixture.js', { exact: true }).waitFor()
  assert.equal(linkCalls, 1)

  const search = page.getByRole('searchbox')
  const editor = page.getByRole('textbox', { name: '片段源码' })
  const save = page.getByRole('button', { name: '保存片段' })
  const status = page.locator('.ls-snippets:has(.ls-snippet-form)').getByRole('status')
  await search.fill('sr')
  await page.getByRole('button', { name: 'sr mA', exact: true }).click()
  const srDefault = await editor.inputValue()
  assert.match(srDefault, /replacement:\s*"\^\{2\}"/)
  const visible = await editor.boundingBox()
  assert.ok(visible && visible.width >= 370 && visible.height >= 190)
  const selected = page.locator('button[aria-pressed="true"]')
  const selectedColor = await selected.evaluate(node => getComputedStyle(node).backgroundColor)
  assert.equal(selectedColor, 'rgb(9, 71, 113)')

  const hot = store.watch((await store.settings()).revision)
  await editor.fill('{ trigger: "sr", replacement: "^{4}", options: "mA" }')
  await save.click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal(createSnippetExpander((await hot).patches)('$xsr', '$', 'inline', 'auto')?.insert, '^{4}')
  assert.match(await readFile(file, 'utf8'), /\^\{4\}/)

  const checkbox = page.getByRole('checkbox', { name: '启用此片段' })
  const square = (await secondWindow.settings()).rows.find(row => row.trigger === 'sr')
  assert.ok((await secondWindow.save({ id: square.id, source: '{ trigger: "sr", replacement: "^{6}", options: "mA" }' })).ok)
  await checkbox.uncheck()
  await save.click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal(createSnippetExpander((await store.watch(-1)).patches)('$xsr', '$', 'inline', 'auto'), null)

  assert.match(await editor.inputValue(), /\^\{6\}/)

  await page.getByRole('button', { name: '新建片段' }).click()
  await editor.fill('export default [{trigger: "qms", replacement: "^{7}", options: "mA"}, {trigger: "qmt", replacement: "_{5}", options: "mA"}]')
  await save.click()
  await status.getByText('已保存', { exact: false }).waitFor()
  const expander = createSnippetExpander((await store.watch(-1)).patches)
  assert.equal(expander('$xqms', '$', 'inline', 'auto')?.insert, '^{7}')
  assert.equal(expander('$xqmt', '$', 'inline', 'auto')?.insert, '_{5}')

  const lastSaved = await readFile(file, 'utf8')
  await editor.fill('{ trigger: "qms", replacement: () => "unsafe", options: "mA" }')
  await save.click()
  await status.getByText('JavaScript 函数', { exact: false }).waitFor()
  assert.equal(await readFile(file, 'utf8'), lastSaved)

  await search.fill('sr')
  await page.getByRole('button', { name: /sr mA 已停用/, exact: true }).click()
  // Explicitly restoring defaults must reset both fields, even if only one looks changed here.
  await editor.fill(srDefault)
  await save.click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.ok((await secondWindow.save({ id: square.id, source: '{ trigger: "sr", replacement: "^{42}", options: "mA" }' })).ok)
  await page.getByRole('button', { name: '载入默认值' }).click()
  await save.click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal(createSnippetExpander((await store.watch(-1)).patches)('$xsr', '$', 'inline', 'auto')?.insert, '^{2}')
  await mkdir(local('../out/test'), { recursive: true })

  const all = page.getByRole('checkbox', { name: '全选当前结果', exact: true })
  const clear = page.getByRole('button', { name: '清空', exact: true })
  const bulk = page.locator('.ls-snippet-bulk')
  const remove = bulk.getByRole('button', { name: '删除自定义', exact: true })
  const paintDelete = () => remove.evaluate(button => {
    const { width, height } = button.getBoundingClientRect()
    const { opacity, visibility, color, backgroundColor, borderTopColor } = getComputedStyle(button)
    return { visible: width > 0 && height > 0 && Number(opacity) > 0 && visibility === 'visible',
      color, backgroundColor, borderTopColor }
  })
  await search.fill('sr')
  await page.keyboard.press('Tab')
  const searchTabFocusesSelectAll = await all.evaluate(input => input === document.activeElement)
  await page.getByText('已选 0 项', { exact: true }).evaluate(count => {
    globalThis.selectionAnnouncements = []
    new MutationObserver(() => globalThis.selectionAnnouncements.push(count.textContent)).observe(count, { childList: true })
  })
  const sourceBeforeEdit = await editor.inputValue()
  await editor.fill(sourceBeforeEdit + '\n')
  await editor.fill(sourceBeforeEdit)
  assert.deepEqual({
    searchTabFocusesSelectAll,
    announcementsWhileEditing: await page.evaluate(() => globalThis.selectionAnnouncements),
    idleDeletePaint: await paintDelete(),
  }, {
    searchTabFocusesSelectAll: true,
    announcementsWhileEditing: [],
    idleDeletePaint: {
      visible: true, color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(58, 61, 65)', borderTopColor: 'rgb(137, 146, 158)',
    },
  }, 'keyboard order, selected-count announcements, and idle button paint')
  const layout = () => page.locator('.ls-snippet-grid').evaluate(grid => {
    const frame = grid.getBoundingClientRect()
    return [[frame.width, frame.height], ...[
      '.ls-snippet-selection', '.ls-snippet-quiet', '.ls-snippet-bulk',
      '.ls-snippet-search', '.ls-snippet-list', '.ls-snippet-source',
    ].map(selector => {
      const rect = grid.querySelector(selector).getBoundingClientRect()
      return [rect.left - frame.left, rect.top - frame.top, rect.width, rect.height]
    })]
  })
  await search.fill('')
  const resting = await layout()
  await all.check()
  assert.deepEqual(await layout(), resting, 'selecting all rules must not move the list, actions, or source editor')
  assert.ok(await page.evaluate(() => globalThis.selectionAnnouncements.some(text => text !== '已选 0 项')))
  await clear.click()
  assert.deepEqual(await layout(), resting, 'clearing selection must not change the layout')
  assert.equal(await clear.isDisabled(), true)
  assert.equal(await bulk.getByRole('button', { name: '启用', exact: true }).isDisabled(), true)
  assert.equal(await bulk.getByRole('button', { name: '停用', exact: true }).isDisabled(), true)
  await page.getByRole('checkbox', { name: '勾选 sr', exact: true }).check()
  assert.deepEqual(await layout(), resting)
  assert.equal(await remove.isDisabled(), true, 'default rules cannot be deleted')
  await clear.click()

  await search.fill('qm')
  await page.getByRole('button', { name: 'qms mA', exact: true }).click()
  const qmtMark = page.getByRole('checkbox', { name: '勾选 qmt', exact: true })
  await qmtMark.waitFor({ timeout: 2000 })
  await qmtMark.check()
  assert.match(await editor.inputValue(), /"qms"/, 'marking a row must not switch the source editor')
  assert.equal(await all.evaluate(input => input.indeterminate), true)
  await all.check()
  await page.getByText('已选 2 项', { exact: true }).waitFor()
  const dangerPaint = await paintDelete()
  assert.equal(dangerPaint.visible, true)
  assert.equal(dangerPaint.color, 'rgb(244, 135, 113)')
  assert.notEqual(dangerPaint.borderTopColor, 'rgb(137, 146, 158)')
  await page.screenshot({ path: local('../out/test/snippet-multiselect.png') })

  await bulk.getByRole('button', { name: '停用', exact: true }).click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal(await checkbox.isChecked(), false)
  assert.equal(createSnippetExpander((await store.watch(-1)).patches)('$xqmt', '$', 'inline', 'auto'), null)
  await bulk.getByRole('button', { name: '启用', exact: true }).click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal(await checkbox.isChecked(), true)

  const dialog = page.getByRole('dialog', { name: '删除自定义片段？' })
  await remove.click()
  await dialog.getByText(/qms.*qmt|qmt.*qms/).waitFor()
  await page.screenshot({ path: local('../out/test/snippet-delete-dialog.png') })
  await dialog.getByRole('button', { name: '取消' }).click()
  assert.equal((await store.settings()).rows.filter(row => row.trigger.startsWith('qm')).length, 2)
  await remove.click()
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal((await store.settings()).rows.some(row => row.trigger.startsWith('qm')), false)
  await page.getByText('没有匹配的片段。', { exact: true }).waitFor()

  await page.getByRole('button', { name: '新建片段' }).click()
  await editor.fill('{trigger:"one-to-delete",replacement:"temporary",options:"mA"}')
  await save.click()
  await status.getByText('已保存', { exact: false }).waitFor()
  await page.getByRole('button', { name: '删除片段', exact: true }).click()
  await dialog.getByRole('button', { name: '删除', exact: true }).click()
  await status.getByText('已保存', { exact: false }).waitFor()
  assert.equal((await store.settings()).rows.some(row => row.trigger === 'one-to-delete'), false)
  await search.fill('sr')
  await page.getByRole('button', { name: 'sr mA', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '删除片段', exact: true }).count(), 0)
  await page.screenshot({ path: local('../out/test/snippet-settings.png') })
  await page.setViewportSize({ width: 570, height: 850 })
  const grid = await page.locator('.ls-snippet-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns)
  assert.match(grid, /^[\d.]+px$/)
  await search.fill('')
  const narrow = await layout()
  await all.check()
  assert.deepEqual(await layout(), narrow, 'narrow panels must not reflow when the selection changes')
  await clear.click()
  assert.deepEqual(await layout(), narrow)
  await page.screenshot({ path: local('../out/test/snippet-settings-narrow.png'), fullPage: true })
  console.log('PASS: actual settings bundle renders, edits, disables, adds, validates, restores and updates live snippets')
} finally {
  store.releaseWatchers()
  await browser.close()
  await rm(directory, { recursive: true })
}
