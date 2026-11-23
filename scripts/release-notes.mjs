import { readFileSync } from 'node:fs'

const tag = process.argv[2]
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
if (!stableVersion.test(version) || tag !== 'v' + version) {
  throw new Error('发布标签必须与 package.json 的稳定版本一致：v' + version)
}

const prefix = '[' + version + '] - '
const sections = readFileSync('CHANGELOG.md', 'utf8').replaceAll('\r\n', '\n')
  .split(/^## /m).slice(1).filter(section => section.startsWith(prefix))
if (sections.length !== 1 || !/^\d{4}-\d{2}-\d{2}\n\s*\S/.test(sections[0].slice(prefix.length))) {
  throw new Error('CHANGELOG.md 须有且只有一段非空的「## ' + prefix + 'YYYY-MM-DD」')
}
process.stdout.write('## ' + sections[0].trimEnd() + '\n')
