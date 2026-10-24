/**
 * @file 作品任务的纯调度规则，不联网、不读写文件，方便独立验证队列顺序。
 * “当前上榜”只决定首次发现的优先级；旧任务也必须轮到，不能每天被榜首挤掉。
 */
function planActors({ ids, rankings, people, now, limit }) {
  const rank = new Map()
  for (const kind of ['day', 'week', 'month'])
    for (const row of rankings[kind] || []) {
      const id = String(row.id)
      rank.set(id, Math.min(rank.get(id) ?? Infinity, row.rank))
    }
  const eligible = ids
    .filter(id => {
      const scan = people[id]
      // 列表和详情有独立队列；列表七天内稳定完成时，不妨碍消费已有详情待办。
      return (
        !(scan?.finished && scan.stable && now - scan.completedAt < 7 * 86400000) &&
        !(scan?.nextRetryAt > now)
      )
    })
    .sort((a, b) => {
      const left = people[a],
        right = people[b]
      // 尚未服务者排前；服务过的按时间轮转，长分页人物不能独占后续每一轮。
      return (
        (left?.lastScheduledAt || 0) - (right?.lastScheduledAt || 0) ||
        (rank.has(a) ? 0 : 1) - (rank.has(b) ? 0 : 1) ||
        (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
        a.localeCompare(b)
      )
    })
  // 给未完成扫描预留一半名额（5人时为2人），其余名额继续发现/复核人物。
  // 两组内部仍按服务时间轮转；某组不足时另一组补位，不浪费名额。
  const pending = eligible.filter(id => people[id] && !people[id].finished)
  const fresh = eligible.filter(id => !people[id] || people[id].finished)
  const reserved = Math.max(1, Math.floor(limit / 2))
  const resumed = pending.slice(0, reserved)
  const discovered = fresh.slice(0, limit - resumed.length)
  return [...resumed, ...discovered, ...pending.slice(resumed.length)].slice(0, limit)
}

/** 每天续跑不能因为扫描总时长超过24小时而反复回到首页；仅连续7天无进展才重启。 */
function shouldRestartScan(scan, now) {
  return !scan || scan.finished || now - (scan.lastProgressAt || scan.startedAt) > 7 * 86400000
}

/** 每次真实网络尝试（包括重试和首页复核）都占一个名额。 */
class RequestBudget {
  constructor(limit) {
    this.limit = limit
    this.used = 0
  }
  take() {
    if (this.used >= this.limit) {
      const error = new Error('本轮网络请求预算已用完，保存断点后续跑')
      error.budgetExhausted = true
      throw error
    }
    this.used++
  }
}

/**
 * 一轮开始时，可立即处理的详情若已够消耗整轮详情预算，就暂停本轮列表发现。
 * 等待退避的任务不参与判断，否则某个长期失败任务可能阻止整个人物池更新。
 * 详情预算为0是显式的仅列表模式，不应被队列阻塞；低于一轮预算时自动恢复正常。
 */
function planWorkRound({ readyDetails, detailLimit }) {
  return detailLimit > 0 && readyDetails >= detailLimit ? 'details-first' : 'normal'
}
module.exports = { planActors, RequestBudget, shouldRestartScan, planWorkRound }
