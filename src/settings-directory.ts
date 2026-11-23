import type { AddonChannelOutcome, VsidianAddonPageSdk } from '../types/vendor/shared/addonPage'
import { defaultPreferences, type PreferenceKey, type Preferences } from './preferences.ts'
import { snippetTopics, type SaveSettingsResult, type SettingsSnippets, type SourceChoice, type SourceKind } from './snippet-protocol.ts'
import { snippetSettingsText } from './settings-text.ts'

type Field = readonly [PreferenceKey, string, string, string?, string?]
type Page = { name: string; zh: string; summary: string; zhSummary: string; fields: readonly Field[]; file?: SourceKind }
const pages: Page[] = [
  { name: 'Snippets', zh: '公式片段', summary: 'Expansion rules and their sources', zhSummary: '展开规则与片段来源', fields: [
    ['snippetsEnabled', 'Enable snippet expansion', '启用片段展开'],
  ], file: 'rules' },
  { name: 'Conceal', zh: '符号隐藏', summary: 'Show glyphs in place of LaTeX commands', zhSummary: '用数学字形替代部分 LaTeX 命令', fields: [
    ['conceal', 'Conceal supported symbols', '以字形显示支持的命令'],
    ['concealDelay', 'Reveal delay (ms)', '恢复源码延时（毫秒）'],
  ] },
  { name: 'Bracket highlighting', zh: '括号高亮', summary: 'Color pairs and focus the pair at the cursor', zhSummary: '区分括号层级和光标所在括号对', fields: [
    ['bracketColors', 'Color bracket pairs by depth', '按嵌套深度为括号着色'],
    ['bracketAtCursor', 'Highlight the innermost pair around the cursor', '突出光标所在的最内层括号对'],
    ['highlightDollars', 'Highlight the formula delimiters', '高亮公式两端的美元符号'],
  ] },
  { name: 'Math preview', zh: '公式预览', summary: 'A rendered popup while editing the source', zhSummary: '编辑公式源码时显示渲染浮窗', fields: [
    ['preview', 'Show math preview', '显示公式预览'],
    ['previewAbove', 'Show above the formula', '在公式上方显示'],
    ['previewCursor', 'Cursor marker', '光标标记'],
    ['previewBrackets', 'Highlight the cursor’s brace pair in the preview', '在预览中突出光标所在花括号对'],
    ['previewBlock', 'Also preview display equations in Live', 'Live 中也预览块公式'],
  ] },
  { name: 'Auto-fraction', zh: '自动分式', summary: 'Convert a numerator when you type a slash', zhSummary: '输入分式触发键时自动识别分子', fields: [
    ['autoFraction', 'Enable auto-fraction', '启用自动分式'],
    ['fractionCommand', 'Fraction command', '分式命令', 'For example \\frac or \\dfrac.', '例如 \\frac 或 \\dfrac。'],
    ['fractionBreak', 'Numerator stop characters', '分子截断字符', 'An ungrouped character in this set ends the scan.', '未被括号包围的这些字符会截断分子扫描。'],
    ['fractionExcluded', 'Excluded delimiter pairs', '排除的定界符对', 'JSON array of [opening, closing] pairs.', '使用 JSON 数组，每项为 [起始, 结束]。'],
  ] },
  { name: 'Matrix shortcuts', zh: '矩阵快捷键', summary: 'Add cells, add rows, and leave the environment', zhSummary: '添加单元格、换行或退出矩阵环境', fields: [
    ['matrix', 'Enable matrix shortcuts', '启用矩阵快捷键'],
    ['matrixEnvs', 'Matrix environments', '矩阵环境'],
    ['matrixMacros', 'Matrix macros', '矩阵宏', 'Separate names with commas.', '多个名称以逗号分隔。'],
  ] },
  { name: 'Tabout', zh: '跳出括号', summary: 'Jump to the next closing delimiter or leave a formula', zhSummary: '跳到右定界符之后，或退出公式', fields: [
    ['tabout', 'Enable tabout', '启用跳出括号'],
    ['taboutClosers', 'Closing delimiters', '右定界符', 'Separate delimiters with commas.', '多个定界符以逗号分隔。'],
    ['taboutEndOnly', 'Leave the formula only at the end', '仅在到达公式末尾时退出'],
  ] },
  { name: 'Auto-enlarge brackets', zh: '自动放大括号', summary: 'Resize surrounding brackets around tall expressions', zhSummary: '在分式等较高的表达式周围补上伸缩括号', fields: [
    ['enlarge', 'Enlarge surrounding brackets', '自动放大周围括号'],
    ['enlargeTriggers', 'Commands that trigger enlargement', '触发放大的命令', 'Separate names with commas. A leading slash is optional.', '多个名称用逗号分隔，可省略命令前的反斜杠。'],
    ['enlargeSpace', 'Add spaces inside enlarged brackets', '在伸缩括号内插入空格'],
  ] },
  { name: 'Keybindings', zh: '快捷键', summary: 'Configure the keys used inside Live math', zhSummary: '配置 Live 公式中的操作键', fields: [
    ['snippetKey', 'Expand manual snippet', '展开手动片段'],
    ['nextKey', 'Next placeholder', '下一占位符'],
    ['previousKey', 'Previous placeholder', '上一占位符'],
    ['fractionKey', 'Auto-fraction', '自动分式'],
    ['rowKey', 'New matrix row', '新建矩阵行'],
    ['cellKey', 'New matrix cell', '新建矩阵单元格'],
    ['exitKey', 'Exit matrix', '退出矩阵'],
    ['taboutKey', 'Tabout', '跳出括号'],
  ] },
  { name: 'Experimental', zh: '实验功能', summary: 'Limit recursive expansions and control diagnostics', zhSummary: '限制递归展开次数与诊断信息', fields: [
    ['recursion', 'Additional automatic expansions', '自动片段递归次数', '0 disables recursion; a placeholder ends the current chain.', '0 表示不递归；生成占位符后停止本次递归。'],
    ['logLevel', 'Snippet log level', '片段日志级别'],
  ] },
]
const advanced: Page = {
  name: 'Advanced snippet settings', zh: '片段高级设置', summary: '', zhSummary: '', file: 'variables', fields: [
    ['variables', 'Snippet variables', '片段变量', 'Example: { NAME: "value" }. The linked variable file takes precedence.', '例如 { NAME: "value" }。同名变量优先采用关联文件中的值。'],
    ['wordDelimiters', 'Word delimiters', '词边界字符'],
    ['trimInline', 'Trim trailing spaces in inline math', '移除行内公式片段末尾的空白'],
    ['deleteEmptyMath', 'Delete both delimiters of empty math', '退格时同时删除空公式的两个定界符'],
    ['expandAfterComposition', 'Expand a snippet when IME composition is committed', '输入法提交组合文字后尝试展开片段'],
    ['mathLanguages', 'Treat these fenced languages as math', '视为数学公式的围栏语言', 'Separate language names with commas.', '多个语言名称以逗号分隔。'],
  ],
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) {
  const node = document.createElement(tag)
  node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

export function mountSettingsDirectory(
  root: HTMLElement,
  snippetPanel: HTMLElement,
  sdk: VsidianAddonPageSdk,
  language: string,
  state: () => SettingsSnippets,
  receive: (state: SettingsSnippets) => void,
) {
  const zh = language.startsWith('zh')
  const t = (en: string, cn: string) => zh ? cn : en
  const copy = snippetSettingsText(language)
  const directory = element('section', 'ls-snippets ls-settings-directory')
  const titleBar = element('header', 'ls-snippet-head')
  const title = element('h4', '', t('Latex Suite features', 'Latex Suite 功能目录'))
  titleBar.append(title)
  const lead = element('p', 'ls-snippet-scope', t('Options and snippets are shared across workspaces in this VS Code profile.', '功能选项和片段在此 VS Code 配置的各工作区共享。'))
  const listing = element('div', 'ls-feature-list')
  directory.append(titleBar, lead, listing)

  const detail = element('section', 'ls-feature-detail')
  detail.hidden = true
  const back = element('button', 'ls-secondary ls-feature-back', t('‹ Back to features', '‹ 返回功能目录'))
  back.type = 'button'
  const description = element('h4', 'ls-feature-title')
  const detailHead = element('div', 'ls-feature-toolbar')
  detailHead.append(back, description)
  const content = element('div', 'ls-feature-content')
  detail.append(detailHead, content)
  snippetPanel.hidden = true
  root.append(directory, detail)

  let opened: HTMLElement
  function open(page: Page, from: HTMLElement) {
    opened = from
    directory.hidden = true
    detail.hidden = false
    description.textContent = t(page.name, page.zh)
    content.replaceChildren(renderOptions(page))
    if (page === pages[0]) {
      snippetPanel.hidden = false
      content.append(snippetPanel)
      content.append(renderOptions(advanced))
    }
    back.focus()
  }

  back.addEventListener('click', () => {
    snippetPanel.hidden = true
    root.append(snippetPanel) // Keep the editor and its drafts alive between visits.
    detail.hidden = true
    directory.hidden = false
    opened.focus()
  })

  function errorText(result: Extract<SaveSettingsResult, { ok: false }>): string {
    const { issue } = result
    if (issue.code === 'preferences') return t('Check the setting values and key names.', '请检查设置值和快捷键写法。')
    if (issue.code === 'file-timeout') return copy.label.fileTimeout
    if (issue.code === 'locked') return copy.label.locked + ' ' + issue.path
    if (issue.code === 'storage') return copy.label.storage + ' ' + issue.detail
    return copy.issue[issue.code] + (issue.line ? ' (' + issue.line + ':' + issue.column + ')' : '')
  }

  function renderOptions(page: Page) {
    const form = element('form', 'ls-snippets ls-feature-options')
    const head = element('header', 'ls-snippet-head')
    head.append(element('h4', '', page === advanced ? t(advanced.name, advanced.zh) : t('Options', '功能选项')))
    form.append(head)
    const fields = new Map<PreferenceKey, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>()
    let baseline = state().preferences
    let resetAll = false
    for (const [key, english, chinese, enHint, zhHint] of page.fields) {
      const value = baseline[key]
      const row = element('label', 'ls-feature-row')
      const label = element('span', 'ls-feature-label', t(english, chinese))
      if (enHint && zhHint) label.append(element('small', 'ls-feature-hint', t(enHint, zhHint)))
      let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      if (key === 'variables' || key === 'fractionExcluded' || key === 'wordDelimiters') {
        control = element('textarea', 'ls-snippet-search')
        control.spellcheck = false
        control.rows = 3
      } else if (key === 'logLevel') {
        control = element('select', 'ls-snippet-search')
        for (const [val, en, cn] of [['off','Off','关闭'],['info','Info','基本'],['verbose','Verbose','详细'],['vverbose','Very verbose','最详细']]) {
          const option = element('option', '', t(en, cn))
          option.value = val
          control.append(option)
        }
      } else {
        control = element('input', 'ls-snippet-search')
        control.type = typeof value === 'boolean' ? 'checkbox' : typeof value === 'number' ? 'number' : 'text'
        if (typeof value === 'number') {
          control.min = '0'
          control.max = key === 'recursion' ? '10' : '10000'
        }
      }
      if (typeof value === 'boolean') (control as HTMLInputElement).checked = value
      else control.value = String(value)
      row.append(label, control)
      fields.set(key, control)
      form.append(row)
    }
    if (page.name === 'Keybindings') {
      form.append(element('p', 'ls-snippet-hint', t('Examples: Tab, Shift-Tab, Ctrl-Enter. Clear a field to leave the key unbound.',
        '例如 Tab、Shift-Tab、Ctrl-Enter。留空表示不绑定。')))
    }

    const actions = element('div', 'ls-snippet-actions')
    const save = element('button', 'ls-primary', t('Save options', '保存选项'))
    save.type = 'submit'
    const reset = element('button', 'ls-secondary', t('Load option defaults', '载入选项默认值'))
    reset.type = 'button'
    actions.append(save, reset)
    form.append(actions)
    const status = element('p', 'ls-snippet-status')
    status.setAttribute('role', 'status')
    form.append(status)

    function report(text: string, error = false) {
      status.textContent = text
      status.classList.toggle('ls-snippet-error', error)
    }
    async function request(work: () => Promise<AddonChannelOutcome>, optionsSaved?: () => void) {
      if (save.disabled) return
      const controls = [...form.querySelectorAll('button'), ...(optionsSaved ? fields.values() : [])]
      for (const control of controls) control.disabled = true
      const response = await work()
      for (const control of controls) control.disabled = false
      if (!response.ok) {
        if (response.reason !== 'released') report(copy.label.unavailable, true)
        return
      }
      const result = response.result as SaveSettingsResult | null
      if (!result) return
      if (!result.ok) {
        report(errorText(result), true)
        return
      }
      receive(result.state)
      optionsSaved?.()
      report(copy.label.saved)
      if (page.file) showFile(page.file)
    }

    function fillOptions(values: Preferences) {
      for (const [key, control] of fields) {
        const value = values[key]
        if (typeof value === 'boolean') (control as HTMLInputElement).checked = value
        else control.value = String(value)
      }
    }

    reset.addEventListener('click', () => {
      fillOptions(defaultPreferences)
      resetAll = true
      report(copy.label.pending)
    })
    form.addEventListener('submit', event => {
      event.preventDefault()
      const patch: Partial<Preferences> = {}
      for (const [key, control] of fields) {
        const value = defaultPreferences[key]
        const next = typeof value === 'boolean' ? (control as HTMLInputElement).checked
          : typeof value === 'number' ? (control as HTMLInputElement).valueAsNumber : control.value
        if (resetAll || next !== baseline[key]) Object.assign(patch, { [key]: next })
      }
      void request(() => sdk.channel.request(snippetTopics.preferences, patch), () => {
        baseline = state().preferences
        resetAll = false
        fillOptions(baseline)
      })
    })

    const linked = element('p', 'ls-feature-hint')
    const unlink = element('button', 'ls-secondary', t('Unlink file', '解除关联'))
    unlink.type = 'button'
    function showFile(kind: SourceKind) {
      linked.textContent = state().linked[kind] ?? t('No linked file.', '尚未关联文件。')
      unlink.hidden = !state().linked[kind]
    }
    const kind = page.file
    if (kind) {
      const files = element('div', 'ls-feature-files')
      const link = element('button', 'ls-secondary', t('Link a file…', '关联文件…'))
      link.type = 'button'
      const note = kind === 'rules'
        ? t('Linked rules are added to existing snippets and reload when the file is saved.', '关联文件中的规则追加到现有片段，文件保存后自动重载。')
        : t('Variables in the linked file are reloaded on save.', '变量文件保存后自动重载。')
      files.append(element('p', 'ls-snippet-hint', note), linked, link, unlink)
      form.insertBefore(files, actions)
      showFile(kind)
      link.addEventListener('click', () => void request(async () => {
        const chosen = await sdk.channel.request(snippetTopics.choose, kind)
        if (!chosen.ok) return chosen
        const result = chosen.result as SourceChoice
        if (!result?.ok) return chosen
        if (detail.hidden || !form.isConnected) return { ok: false, reason: 'released' }
        return sdk.channel.request(snippetTopics.link, { kind, ticket: result.ticket })
      }))
      unlink.addEventListener('click', () => void request(() => sdk.channel.request(snippetTopics.link, { kind, ticket: null })))
    }
    return form
  }

  for (const page of pages) {
    const button = element('button', 'ls-feature-link')
    button.type = 'button'
    const body = element('span', 'ls-feature-link-body', t(page.name, page.zh))
    body.append(element('small', 'ls-feature-hint', t(page.summary, page.zhSummary)))
    const arrow = element('span', 'ls-feature-arrow', '›')
    arrow.setAttribute('aria-hidden', 'true')
    button.append(body, arrow)
    button.addEventListener('click', () => open(page, button))
    listing.append(button)
  }
}
