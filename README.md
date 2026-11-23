<div align="center">

# Vsidian Latex Suite

**在 Vsidian 中，让敲击 LaTeX 公式像手写一样快。**

*专为 [Vsidian](https://github.com/ONEGAYI/vsidian) 打造的极速数学排版扩展 · 移植自 [Obsidian Latex Suite 1.13.1](https://github.com/artisticat1/obsidian-latex-suite)*

</div>

---

还在一个字母一个字母地敲 `\frac{\partial f}{\partial x}`？还在多层括号里反复数 `}` 有没有闭合？

**Vsidian Latex Suite** 将经典的快捷展开、智能分式、矩阵流式编辑与实时视觉辅助深度融入 Vsidian 的 **Live 编辑器**——双手无需离开主键盘区，思维走到哪，公式就写到哪。

---

## ⚡ 三秒上手：感受手写般的速度

进入 Vsidian Live 编辑器，试着连贯敲下这些字符：

| 你只需输入 | 瞬间变为 | 发生了什么 |
| :--- | :--- | :--- |
| `mk` | `$ \| $` | 进入行内公式，光标自动停在中间 |
| `dm` | `$$` 换行块 | 创建独立公式块，随时开始推导 |
| `xsr` | `x^{2}` | 自动上标，常用幂次一气呵成 |
| `@t` / `@a` | `\theta` / `\alpha` | `@` 触发希腊字母，告别繁琐反斜杠 |
| `sq` 再输入 `x` | `\sqrt{ x }` | 展开根号并直接填入内容 |
| `x/` 再输入 `y` | `\frac{x}{y}` | 输入 `/` 自动识别分子，按 `Tab` 跳出分母 |
| `par` + `Tab` | `\frac{\partial }{\partial }` | 带占位符的复合模板，`Tab` 依次跳转填空 |

> **内置 199 条经典片段**：完整继承 Gilles Castel 与 Obsidian Latex Suite 社区打磨多年的默认规则库，覆盖微积分、线性代数、希腊字母、上下标、修饰符与常用环境，开箱即用。

---

## ✨ 核心亮点

### 1. 不打断心流的智能输入
* **智能自动分式**：不仅 `a/b` 秒变 `\frac{a}{b}`，连 `(a + b(c + d))/` 也能精准识别整组括号作为分子。选中已有公式按 `/` 还能直接将其送入分子。
* **矩阵与对齐环境快捷键**：身处 `pmatrix`、`cases`、`align` 等矩阵环境中时：
  * `Tab` 自动插入 `&` 进入下一单元格
  * `Enter` 自动添加 `\\` 并换行
  * `Shift + Enter` 一键跳出矩阵继续正文
* **自动放大括号**：输入 `\sum`、`\int`、`\frac` 等较高表达式时，外围括号自动升级为 `\left( ... \right)`，比例始终协调。
* **顺滑的 `Tab` 导航与跳出（Tabout）**：在占位符间用 `Tab` / `Shift + Tab` 自由穿梭；填完最后一个空后继续按 `Tab`，光标会自动越过闭合括号、`}`、`\right` 乃至直接走出 `$` 定界符。
* **选区一键标注**：选中任意一段公式，直接按下 `U`（下括注 `\underbrace`）、`O`（上括注 `\overbrace`）、`C`（删除线 `\cancel`）或 `B`（下方注解 `\underset`），立刻包裹成型。

### 2. 所见即所得的视觉辅助
* **实时公式预览浮窗**：编辑源码时，公式上方自动浮现高清渲染预览，并标注当前光标所在位置与花括号范围，复杂公式边写边校对。（支持配置块公式预览）
* **括号层级着色与配对高亮**：按嵌套深度为括号赋予不同颜色，光标靠近或置身其中时自动突出当前括号对与 `$` 定界符，告别“括号迷宫”。
* **符号隐藏（Conceal，可在设置中开启）**：在不改动任何源文的前提下，把 `\alpha`、`\sqrt`、上标等以更直观的数学字形呈现；光标移入时自动显露源码（支持自定义延时），兼顾阅读美感与编辑精度。

### 3. 为你而定制的片段工作台
* **可视化规则管理**：前往 **Vsidian 设置 → 第三方组件 → Latex Suite → 公式片段**，即可按触发词搜索、直接修改源码、单条启停、多选批量管理，或一键恢复默认。
* **零门槛自定义扩展**：支持直接粘贴单条规则或规则数组（支持正则捕获、`[[0]]` 反向引用、`$0`/`$1` 占位符与 `${VISUAL}` 选区模板），例如：
  ```js
  { trigger: "mytheta", replacement: "\\theta", options: "mA" }
  ```
* **关联本地文件 & 跨工作区同步**：支持绑定本地规则文件或变量文件，保存即自动热重载；所有偏好与自定义片段保存在当前 VS Code 用户配置中，所有笔记库开箱通用。
* **细节可控**：键盘键位、`Tab` 行为、输入法（IME）组合提交后展开、自动分式截断字符等均可在功能目录中独立微调。

---

## 📦 安装与开始

### 前置条件
* 已安装 **VS Code**（1.82.3 及以上）
* 已安装并启用 **Vsidian**（`onegayi.vsidian`）

### 安装步骤
1. 下载本扩展的 `.vsix` 安装包。
2. 在 VS Code 中打开命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`），执行 **Extensions: Install from VSIX…**，选择安装包即可。
3. 打开任意 Markdown 笔记的 **Vsidian Live 编辑器**，键入 `dm` 或 `mk`，即刻体验极速公式录入。

> **开关与设置入口**：Vsidian 设置 → **第三方组件** → **Latex Suite**。

---

<details>
<summary>🛠️ 开发者构建与移植说明（点击展开）</summary>

### 从源码构建
需要 Node.js 22.18+ 与 `vsce`：

```powershell
npm ci
npm test
vsce package --no-dependencies
```

* 宿主集成验证：`node test/run-host.mjs <Vsidian源码目录> <Code.exe> <Vsidian扩展目录>`
* 设置页与编辑器绘制测试：`npm run test:settings-ui` / `npm run test:appearance`（首次需先运行 `npx playwright install chromium`）

### 移植范围与致谢
* 本扩展默认片段与宏数据锚定 [Obsidian Latex Suite 1.13.1](https://github.com/artisticat1/obsidian-latex-suite/releases/tag/1.13.1)（MIT 授权，见 [LICENSE](LICENSE)）。
* 公式最终渲染由 Vsidian 内置 KaTeX 承担；极少数依赖 MathJax 的上游命令虽可快速输入，但显示效果以 KaTeX 支持为准。
* 自定义规则及关联文件仅解析声明式文本与正则模板，不执行外部自定义脚本；依赖 Obsidian 宿主的 Vim / Excalidraw 集成暂未包含在内。

</details>
