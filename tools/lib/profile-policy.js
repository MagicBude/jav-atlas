/**
 * 人物详情队列：未成功/旧结构先补，成功满30天后每轮最多复查20人。
 * 缺字段不等于抓取失败：来源确实未提供的字段也可能为空，不能每天重复请求。
 * 失败退避写入 relay 随 Actions 提交，避免新 runner 丢失本地缓存后再次撞同一个失败页。
 */
const DAY = 86400000
function planProfiles(rows, tasks, now, limit) {
  const ready = rows.filter(row => row.mnid && !(tasks[String(row.mnid)]?.nextRetryAt > now))
  const missing = ready
    .filter(row => !row.profileFetchedAt || row.profileSchemaVersion !== 2)
    .sort((a, b) => (tasks[a.mnid]?.lastAttemptAt || 0) - (tasks[b.mnid]?.lastAttemptAt || 0))
  const stale = ready
    .filter(
      row =>
        row.profileSchemaVersion === 2 &&
        row.profileFetchedAt &&
        now - row.profileFetchedAt >= 30 * DAY
    )
    .sort((a, b) => a.profileFetchedAt - b.profileFetchedAt)
    .slice(0, 20)
  return [...missing, ...stale].slice(0, limit)
}
function nextProfileTask(previous, now, success) {
  const failures = success ? 0 : (previous?.failures || 0) + 1
  return {
    lastAttemptAt: now,
    failures,
    nextRetryAt: success ? null : now + Math.min(7, 2 ** Math.min(failures - 1, 3)) * DAY
  }
}
module.exports = { planProfiles, nextProfileTask }
