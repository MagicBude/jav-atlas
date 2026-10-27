/**
 * 榜单历史只保存完整成功的三榜快照。同一个北京时间日期保留最后一次成功结果，
 * 比较时取之前日期的最近有效快照，避免手动重复运行让“昨日变化”变成“几分钟前变化”。
 * 历史独立存档，不往源站行里混入前端字段；没有基准时返回 null，不能假定全部新上榜。
 */
const fs = require('fs')
const path = require('path')
const { writeJson, readJson } = require('./runtime')
const periods = ['day', 'week', 'month']
function validSnapshot(value) {
  return (
    Number.isFinite(value?.fetchedAt) &&
    value.fetchedAt > 0 &&
    periods.every(period => {
      const rows = value[period]
      return (
        Array.isArray(rows) &&
        rows.length === 250 &&
        new Set(rows.map(row => String(row.id))).size === 250 &&
        rows.every((row, index) => /^\d+$/.test(String(row.id)) && row.rank === index + 1)
      )
    })
  )
}
function snapshotDay(time) {
  return new Date(time + 8 * 3600000).toISOString().slice(0, 10)
}
function archiveRankings(folder, snapshot) {
  if (!validSnapshot(snapshot)) throw Error('只有完整 Top250 三榜才能存入历史')
  writeJson(path.join(folder, snapshotDay(snapshot.fetchedAt) + '.json'), snapshot)
}
function readHistory(folder) {
  if (!fs.existsSync(folder)) return []
  return fs
    .readdirSync(folder)
    .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map(name => readJson(path.join(folder, name), null))
    .filter(validSnapshot)
}
function compareRankings(current, history) {
  const previous = validSnapshot(current)
    ? history
        .filter(
          value =>
            validSnapshot(value) && snapshotDay(value.fetchedAt) < snapshotDay(current.fetchedAt)
        )
        .sort((a, b) => b.fetchedAt - a.fetchedAt)[0]
    : null
  return Object.fromEntries(
    periods.map(period => {
      if (!previous) return [period, { previousFetchedAt: null, changes: {} }]
      const before = new Map(previous[period].map(row => [String(row.id), row.rank]))
      const changes = Object.fromEntries(
        current[period].map(row => {
          const rank = before.get(String(row.id))
          return [
            String(row.id),
            rank == null
              ? { kind: 'entered', delta: null }
              : {
                  kind: rank === row.rank ? 'same' : rank > row.rank ? 'up' : 'down',
                  delta: rank - row.rank
                }
          ]
        })
      )
      return [period, { previousFetchedAt: previous.fetchedAt, changes }]
    })
  )
}
module.exports = { validSnapshot, snapshotDay, archiveRankings, readHistory, compareRankings }
