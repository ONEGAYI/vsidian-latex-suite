import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url))
const changelog = '# 更新日志\n\n## [Unreleased] - 开发中\n\n待发布。\n\n'
  + '## [0.1.0] - 2026-11-22\n\n首个版本。\n\n### 新功能\n\n- 支持公式片段。\n\n'
  + '## [0.0.1] - 2026-11-01\n\n旧版。\n'

function notes(tag, log = changelog) {
  const cwd = mkdtempSync(join(tmpdir(), 'latex-release-'))
  try {
    writeFileSync(join(cwd, 'package.json'), '{"version":"0.1.0"}')
    writeFileSync(join(cwd, 'CHANGELOG.md'), log)
    return spawnSync(process.execPath, [script, tag], { cwd, encoding: 'utf8' })
  } finally {
    rmSync(cwd, { recursive: true })
  }
}

test('release notes contain exactly the tagged version section', () => {
  const result = notes('v0.1.0', changelog.replaceAll('\n', '\r\n'))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '## [0.1.0] - 2026-11-22\n\n首个版本。\n\n### 新功能\n\n- 支持公式片段。\n')
})

test('cannot publish a tag whose version differs from the package', () => {
  const result = notes('v0.0.1')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /v0\.1\.0/)
})

test('cannot publish without dated notes for the tagged version', () => {
  const result = notes('v0.1.0', '## [Unreleased] - 开发中\n\n待发布。\n')
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CHANGELOG\.md/)
})
