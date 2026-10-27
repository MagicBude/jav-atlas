/**
 * 来源更新与个人编辑分离：首次接入保留旧名册非空值，记录来源基线；
 * 后续只有当前值仍等于上次来源值时才自动刷新，避免覆盖旧名册中的人工修正。
 * 空值不清除已知资料。每次变化保存差异，含原始资料行和相关人物，方便追溯。
 * 网页个人编辑位于浏览器存储，不参与此合并，也不会被采集器写入。
 */
const empty = value => value == null || value === '' || (Array.isArray(value) && !value.length)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function updateProfile(row, incoming, fetchedAt) {
  const previous = row.profileSource?.values || {}
  const values = { ...previous },
    changes = {},
    conflicts = {}
  for (const [field, value] of Object.entries(incoming)) {
    if (empty(value)) continue
    if (!same(previous[field], value)) {
      changes[field] = { before: previous[field] ?? null, after: value }
      values[field] = value
    }
    if (empty(row[field]) || (Object.hasOwn(previous, field) && same(row[field], previous[field])))
      row[field] = value
    else if (!same(row[field], value)) conflicts[field] = { retained: row[field], source: value }
  }
  if (Object.keys(changes).length) {
    row.profileHistory ||= []
    row.profileHistory.push({ fetchedAt, baseline: !row.profileSource, changes })
  }
  row.profileSource = { fetchedAt, values, conflicts }
  return row
}
module.exports = { updateProfile }
