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
  return ids
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
    .slice(0, limit)
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

module.exports = { planActors, RequestBudget }
