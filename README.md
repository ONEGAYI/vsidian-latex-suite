# Vsidian Latex Suite

在 Vsidian 的 **Live 编辑器**里键入 `dm`，即可创建块公式并把光标放到公式内。接着输入 `xsr`，得到 `x^{2}`；输入 `@t`，得到 `\theta`。输入 `mk` 创建行内公式：只插入两个美元符号，光标停在中间。

| 输入 | 效果 |
| --- | --- |
| `sq`，再输入 `x` | 展开平方根，把 `x` 填入根号 |
| `x/`，再输入 `y` | 生成 `\frac{x}{y}`；`/` 也可把选中的公式文本当作分子 |
| `par`，按 `Tab` | 展开偏导数，并选中第一个占位符 |
| `Tab` / `Shift+Tab` | 在占位符间前进或后退；没有后续占位符时，`Tab` 可越过公式中的闭合符号 |

199 条默认片段来自 [Obsidian Latex Suite 1.13.1](https://github.com/artisticat1/obsidian-latex-suite/releases/tag/1.13.1)，保留原有顺序、触发词、优先级和替换规则；仅正文的 `mk` 不插入原版模板中的空花括号。`Tab` 和 `/` 在命中相应数学输入情境时才接管；三项操作也可在 Vsidian 的快捷键设置中另行绑定。开关位于 Vsidian 的「第三方组件」。

## 配置片段

打开 **Vsidian 设置 → 第三方组件 → Latex Suite → 公式片段**。搜索触发词（例如 `sr`），选中结果后直接编辑源码。取消勾选「启用此片段」并保存即可停用；「载入默认值」会恢复默认源码和启用状态，点保存后生效。保存会更新当前窗口已经打开的 Live 编辑器。规则保存在当前 VS Code 配置中，不按工作区隔离；保存时会合并其他窗口已经写入的独立更改。

新建片段可以粘贴一条规则，或粘贴多条规则组成的数组（可带 `export default`）。例如：

```js
{ trigger: "mytheta", replacement: "\\theta", options: "mA" }
```

`m` 表示数学模式，`A` 表示自动展开；省略 `A` 则按 `Tab` 展开；不指定模式时，正文、普通数学和数学文本都可触发（代码与 frontmatter 仍由 Vsidian 原样处理）。单字符规则使用 `${VISUAL}` 时会自动识别为选区片段，不必另写 `v`。支持原版的正则字面量、`[[0]]` 捕获组、`$0` / `$1` 占位符、`${VISUAL}` 选区模板和 `priority`。用户规则只接受声明式文本替换；内置 JavaScript 函数可以保留、停用或改用文本模板，粘贴的自定义函数不会运行。


列表左侧的复选框可多选。勾选后可批量启用、停用或删除自定义片段；单条自定义片段也可在编辑区删除。内置片段可停用和恢复默认，关联文件中的规则在文件中管理。

## 功能目录

从 **Vsidian 设置 → 第三方组件 → Latex Suite** 进入目录。选择一项打开独立子页；子页顶部可返回。目录按原版 1.13.1 已接入项目的顺序排列。

- **公式片段**：管理默认与自定义规则，关联声明式片段文件；下方的高级选项可编辑变量、词边界、行内空白、输入法提交行为和数学围栏语言。
- **符号隐藏与括号高亮**：符号隐藏不改源文；光标进入被替换的符号后可查看源码。括号页控制配对颜色、光标所在括号对和美元定界符。
- **公式预览**：用 KaTeX 的 MathML 输出显示独立浮窗。位置、光标标记、花括号提示和块公式预览都可配置。标记会干扰公式解析时，优先显示公式本身。
- **输入**：自动分式可改命令、截断字符和排除范围；矩阵默认用 `Tab` 加单元格、`Enter` 新建行、`Shift+Enter` 离开；跳出括号和自动放大括号各有独立子页。
- **快捷键与实验功能**：可重设片段、分式、矩阵和跳出等情境键位，并选择片段递归上限与日志级别。可绑定命令也可从 Vsidian 的统一快捷键入口使用。

选项与片段是当前 VS Code 配置的用户级数据；保存后，此窗口已有的 Live 编辑器会更新。关联文件支持 UTF-8 的单个规则或变量文件；保存文件会重载，格式错误时保留上一份有效配置。规则文件追加到已有片段，不覆盖已编辑的默认片段。保存 `export default []` 会清空这个文件提供的规则，保留关联和其他片段。

## 安装和构建

先安装 Vsidian，再在 VSCode 命令面板执行 **Extensions: Install from VSIX…**，选择本组件的 VSIX。已在 VSCode 1.82.3 与 Vsidian 1.7.0 的隔离宿主验证。

从源码构建需要 Node.js 22.18 或更新版本，以及 VSCE（用于打包）：

```powershell
npm ci
npm test
vsce package --no-dependencies
```

打包前会编译并检查类型，不打包第二份 CodeMirror。需要验证真宿主时，先构建，再运行 `node test/run-host.mjs <Vsidian源码目录> <Code.exe> <Vsidian扩展目录>`；Windows 使用 Vsidian 的独立桌面启动器，测试报告写入 `out/test/`。设置页绘制与交互测试用 `npm run test:settings-ui`，编辑器绘制测试用 `npm run test:appearance`（首次先执行 `npx playwright install chromium`）。

## 自动发布

GitHub Actions 在 PR 与 `main` 推送时运行单测、编译打包和 Chromium 回归。通过的 `main` 构建会保存 VSIX，发版时直接使用标签所指提交的那份产物。

1. 发版前，在 [更新日志](CHANGELOG.md) 把当期内容移到 `## [X.Y.Z] - YYYY-MM-DD`，版本与 `package.json` 一致。合入 `main` 后等待该提交的 CI 通过，再推送 `vX.Y.Z`。如果产物缺失，可用 **CI → Run workflow** 为 `main` 当前提交重新生成；标签和产物必须对应同一提交。
2. 首次上架前，在 [Marketplace 发布者管理台](https://marketplace.visualstudio.com/manage/publishers/) 的 `ONEGAYI` 下创建 Trusted Publishing 策略：Repository owner 填 `ONEGAYI`，Repository 填 `vsidian-latex-suite`，Workflow 填 `release.yml`，Environment 留空。
3. 在仓库 **Settings → Secrets and variables → Actions → Variables** 设置 `MARKETPLACE_PUBLISH=true`，Release 才会上传 VSIX 到市场，不需要配置 PAT。要补发已创建的正式 Release，从 **Release → Run workflow** 选择 `main` 并输入原标签；这不会重打包。

## 移植范围

这一版包含默认片段、片段配置和主要输入操作。公式显示继续交给 Vsidian 的 KaTeX；部分上游 MathJax 命令能输入，但不一定能在 KaTeX 中显示。Vim 和 Excalidraw 集成依赖 Obsidian 宿主，未移植。关联文件支持单文件而非整个 Obsidian 库目录，仍只解析声明式规则，不执行脚本。

片段和宏数据锚定上游提交 `ea68e658eae82826d4f97ac6cd89ab4e06f1c5b9`。默认片段里的少量上游函数随组件静态打包，替换了 Obsidian 的模块加载入口。上游版权和 MIT 授权见 `LICENSE`。
