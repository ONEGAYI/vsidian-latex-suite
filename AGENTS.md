# vsidian-latex-suite

Vsidian 附加组件，移植自 Obsidian Latex Suite 1.13.1（MIT）。行为范围、上游锚点与验证入口见 [README.md](README.md)。

- 工程与提交约定遵循 `D:\CODE\Project\AGENTS.md`。新增可执行行为用测试先固定预期。
- 保留 [LICENSE](LICENSE) 中的上游版权。`src/upstream/` 是对应版本的片段、变量与宏数据；更新时核对上游行为、版本与授权。
- 编辑器页只使用 Vsidian 提供的共享 CM6 运行时；`@codemirror/*` 只可作类型导入。`types/vendor/` 是锁定 Vsidian 提交的类型快照；通过 `npm run vendor:sdk` 更新，不手改。
- `npm test` 检查规则；`npm run compile` 构建并检查类型。输入或光标行为变更用 `test/run-host.mjs` 在隔离的 VSCode 宿主验收。
