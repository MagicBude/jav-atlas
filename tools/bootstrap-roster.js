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
// 人物池独立于全站名册：成员只由榜单发现，落榜也不删除，首次和最近上榜时间持续保留。
// 旧名册仍作为资料存档，不因缩小日常采集范围而删字段或图片。
const pool = readJson(paths.minnanoRankedPool, { schemaVersion: 1, members: {} })
if (
  pool.schemaVersion !== 1 ||
  !pool.members ||
  typeof pool.members !== 'object' ||
  Array.isArray(pool.members)
)
  throw new Error('榜单人物池格式无效，拒绝覆盖')
const fetchedAt = Number(ranks.fetchedAt) || Date.now()
let found = 0
for (const mode of ['day', 'week', 'month']) {
  if (!Array.isArray(ranks[mode]) || !ranks[mode].length) throw new Error('榜单缺失：' + mode)
  for (const row of ranks[mode]) {
    if (!/^\d+$/.test(String(row.id)) || !row.name) throw new Error('榜单人物 ID 或姓名无效')
    const id = String(row.id)
    const previous = pool.members[id]
    pool.members[id] = {
      ...previous,
      id,
      name: row.name,
      firstSeenAt: previous?.firstSeenAt || fetchedAt,
      lastSeenAt: fetchedAt
    }
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
pool.updatedAt = fetchedAt
writeJson(paths.minnanoRankedPool, pool)
console.log('名册 ' + roster.length + ' 人，本次新增 ' + found + '（仅榜单发现）')
