import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const [vsidianSource, codeExe, vsidianExtension, addonExtension] = process.argv.slice(2)
if (!vsidianSource || !codeExe || !vsidianExtension) {
  throw new Error('Usage: node test/run-host.mjs <vsidian-source> <Code.exe> <vsidian-extension> [latex-suite-extension]')
}
const { buildTestHostArgs, runTestHost } = await import(pathToFileURL(path.resolve(vsidianSource, 'test/integration/testHost.mjs')))
const root = fileURLToPath(new URL('..', import.meta.url))
const output = path.join(root, 'out', 'test')
await mkdir(output, { recursive: true })
const session = await mkdtemp(path.join(output, 'host-'))
const workspaceDir = path.join(session, 'workspace')
await mkdir(path.join(workspaceDir, '.vscode'), { recursive: true })
await writeFile(path.join(workspaceDir, '.vscode', 'settings.json'), '{"workbench.startupEditor":"none"}')
const reportPath = path.join(session, 'host.log')
const result = await runTestHost({
  executable: path.resolve(codeExe),
  args: buildTestHostArgs({
    workspaceDir,
    extensionPath: path.resolve(vsidianExtension),
    extraExtensionPaths: [path.resolve(addonExtension ?? root)],
    extensionsDir: path.join(session, 'extensions'),
    userDataDir: path.join(session, 'user'),
    testsPath: path.join(root, 'test/host.cjs'),
  }),
  env: { ...process.env, VSIDIAN_TEST_HOOKS: '1' },
  timeoutMs: 90_000,
  reportPath,
})
assert.equal(result, 0, reportPath)
assert.match(await readFile(reportPath, 'utf8'), /PASS: registered settings page loads and reads snippets while disabled/, reportPath)
