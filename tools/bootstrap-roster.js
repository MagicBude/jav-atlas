/**
 * @file 从本项目新抓取的三种榜单建立初始名册，保留已有条目及人工填写字段。
 * 这只是榜单发现入口，不代表全站目录；人物继续使用 minnano ID。
 */
const { readJson, writeJson } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const paths = dataPaths()
const ranks = readJson(paths.minnanoRankings, null)
if (!ranks) throw new Error('请先抓取 minnano/rankings.json，再建立名册')
const file = paths.minnanoActresses
const roster = readJson(file, [])
if (!Array.isArray(roster)) throw new Error('minnano/actresses.json 必须是数组')
const known = new Set(roster.filter(a => a && a.mnid).map(a => String(a.mnid)))
let found = 0
for (const mode of ['day', 'week', 'month']) {
  if (!Array.isArray(ranks[mode]) || !ranks[mode].length) throw new Error('榜单缺失：' + mode)
  for (const row of ranks[mode]) {
    if (!/^\d+$/.test(String(row.id)) || !row.name) throw new Error('榜单人物 ID 或姓名无效')
    if (known.has(String(row.id))) continue
    roster.push({
      mnid: String(row.id),
      name: row.name,
      videoCount: row.works,
      msrc: 'https://www.minnano-av.com/actress' + row.id + '.html'
    })
    known.add(String(row.id))
    found++
  }
}
writeJson(file, roster)
console.log('名册 ' + roster.length + ' 人，本次新增 ' + found + '（仅榜单发现）')
