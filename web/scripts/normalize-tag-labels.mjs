/**
 * 手动整理入口：npm run labels:normalize；只检查用 npm run labels:check。
 * 原始采集记录、目录ID、分组成员和来源名称都不写入；仅更新独立显示词典。
 * 重复执行无变化时不写文件，便于Git审查和后续目录更新后再次运行。
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeTagDictionary } from './tag-label-normalization.mjs'
const file = fileURLToPath(new URL('../src/data/javdb-tag-labels.json', import.meta.url))
const before = JSON.parse(fs.readFileSync(file, 'utf8'))
const next = normalizeTagDictionary(before)
const changes = Object.entries(next.terms).filter(
  ([id, term]) => before.terms[id].label !== term.label
)
const text = JSON.stringify(next, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (JSON.stringify(before) !== JSON.stringify(next)) {
    console.error('类别词典尚有未整理项，请运行 npm run labels:normalize')
    process.exitCode = 1
  } else console.log('类别与分组显示名均符合简体规则')
} else {
  if (JSON.stringify(before) !== JSON.stringify(next)) fs.writeFileSync(file, text)
  console.log(
    JSON.stringify(
      {
        terms: Object.keys(next.terms).length,
        groups: Object.keys(next.groupLabels).length,
        changedLabels: changes.length,
        samples: changes
          .slice(0, 12)
          .map(([id, term]) => ({ id, from: before.terms[id].label, to: term.label }))
      },
      null,
      2
    )
  )
}
