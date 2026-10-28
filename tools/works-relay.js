/**
 * @file 有预算的作品分批采集。默认保留两人试采，显式选择 ranked 才启用人物池轮转。
 * 完整是“作品分页链稳定遍历”，与详情补齐分开；不下载封面或视频。
 * 来源暂时失败以退出码2表达，允许Actions保存有效断点；程序或文件错误仍用1阻断提交。
 */
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const { parseList, parseDetail } = require('./lib/minnano-works')
const {
  planActors,
  RequestBudget,
  shouldRestartScan,
  planWorkRound,
  actorPageAllowance
} = require('./lib/works-policy')
const base = 'https://www.minnano-av.com/'
const root = path.join(path.dirname(dataPaths().minnanoActresses), 'works')
const pool = readJson(dataPaths().minnanoRankedPool, null)
const scope = process.env.WORK_SCOPE || 'trial'
if (!['trial', 'ranked'].includes(scope)) throw Error('WORK_SCOPE只支持trial或ranked')
const ids = scope === 'trial' ? ['190754', '125605'] : Object.keys(pool?.members || {})
if (!ids.length || !ids.every(id => /^\d+$/.test(id) && Object.hasOwn(pool?.members || {}, id)))
  throw Error('作品采集人物不在有效榜单池')
const pageBudget = envInt('WORK_PAGES', 20, 1, 100)
const detailBudget = envInt('WORK_DETAILS', 50, 0, 100)
const peopleBudget = envInt('WORK_PEOPLE', 5, 1, 20)
const perPersonPages = envInt('WORK_PERSON_PAGES', 5, 1, 100)
const requests = new RequestBudget(envInt('WORK_REQUESTS', 100, 1, 300))
const stateFile = path.join(root, 'progress.json')
const state = readJson(stateFile, { schemaVersion: 1, people: {}, pendingDetails: {} })
if (state.schemaVersion !== 1 || !state.people || !state.pendingDetails)
  throw Error('作品断点格式无效')
if (
  !Object.keys(state.people).every(id => /^\d+$/.test(id)) ||
  !Object.keys(state.pendingDetails).every(id => /^\d+$/.test(id))
)
  throw Error('作品断点包含非法原生ID，拒绝请求或写入')
// trial不能消费此前扩池留下的其他人物待办；共享作品仍以作品原生ID去重。
const allowedDetails =
  scope === 'trial'
    ? new Set(
        ids.flatMap(id =>
          readJson(path.join(root, 'people', id + '.json'), { entries: [] })
            .entries.filter(row => row.kind === 'work')
            .map(row => row.id)
        )
      )
    : null
let lastRequest = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // 在请求前扣预算，因此重试和完成前的首页复核也不可能突破硬上限。
    requests.take()
    await sleep(Math.max(0, 500 - (Date.now() - lastRequest)))
    lastRequest = Date.now()
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 JAV-Atlas-research', referer: base },
        signal: AbortSignal.timeout(20000)
      })
      if (!r.ok) {
        const error = Error('HTTP ' + r.status)
        error.permanent = r.status >= 400 && r.status < 500 && r.status !== 429
        error.retryAfter = Math.min(
          60000,
          Math.max(0, Number(r.headers.get('retry-after')) * 1000 || 0)
        )
        throw error
      }
      return await r.text()
    } catch (error) {
      if (error.permanent || attempt === 2) throw error
      await sleep(Math.max(error.retryAfter || 0, 1000 * 2 ** attempt))
    }
  }
}
const listUrl = (id, page) =>
  page === 1 ? base + `actress${id}.html` : base + `actress.php?actress_id=${id}&page=${page}`
const report = {
  startedAt: Date.now(),
  scope,
  budgets: {
    people: peopleBudget,
    pages: pageBudget,
    perPersonPages,
    details: detailBudget,
    requests: requests.limit
  },
  pages: 0,
  details: 0,
  failures: [],
  people: [],
  budgetExhausted: false
}
function save() {
  writeJson(stateFile, state)
}
function enqueue(entry) {
  if (entry.kind !== 'work') return
  allowedDetails?.add(entry.id)
  const file = path.join(root, 'records', entry.id + '.json')
  const old = readJson(file, null)
  // 已有完整详情默认长期复用；新发行作品由列表发现，不为扩池每天重刷旧作品。
  if (!old?.fetchedAt) state.pendingDetails[entry.id] ||= { attempts: 0, nextRetryAt: 0 }
}
/** 只把网络/网页解析失败标为来源问题；磁盘写入等程序错误不进入可提交的容错路径。 */
async function sourceRead(url, parse) {
  let html
  try {
    html = await get(url)
  } catch (error) {
    error.sourceUnavailable = !error.budgetExhausted
    throw error
  }
  try {
    return parse(html)
  } catch (error) {
    // 解析器明确抛出的校验Error表示网页不符合预期；TypeError等编程异常必须阻断。
    if (error.constructor === Error) error.sourceUnavailable = true
    throw error
  }
}
async function collectLists() {
  const selected = planActors({
    ids,
    rankings: readJson(dataPaths().minnanoRankings, {}),
    people: state.people,
    now: Date.now(),
    limit: peopleBudget
  })
  report.eligiblePeople = ids.length
  report.selectedPeople = selected
  for (const [actorIndex, actorId] of selected.entries()) {
    if (report.pages >= pageBudget || requests.used >= requests.limit) break
    const file = path.join(root, 'people', actorId + '.json')
    const person = readJson(file, { actorId, entries: [], completedAt: null })
    let scan = state.people[actorId]
    if (shouldRestartScan(scan, Date.now()))
      scan = state.people[actorId] = {
        lastScheduledAt: scan?.lastScheduledAt || 0,
        scanId: `${actorId}-${Date.now()}`,
        startedAt: Date.now(),
        nextPage: 1,
        pages: {},
        ids: [],
        firstIds: []
      }
    scan.lastScheduledAt = Date.now()
    let actorPages = 0
    const actorPageLimit = actorPageAllowance(
      pageBudget - report.pages,
      selected.length - actorIndex,
      perPersonPages
    )
    const entries = new Map(person.entries.map(e => [e.id, e]))
    try {
      while (scan.nextPage && report.pages < pageBudget && actorPages < actorPageLimit) {
        const page = scan.nextPage
        const parsed = await sourceRead(listUrl(actorId, page), html =>
          parseList(html, actorId, page)
        )
        report.pages++
        actorPages++
        const signature = parsed.entries.map(e => e.id).join(',')
        if (Object.values(scan.pages).includes(signature) && signature)
          throw Object.assign(Error('重复分页，停止而不标完成'), { sourceUnavailable: true })
        scan.pages[page] = signature
        if (page === 1) scan.firstIds = parsed.entries.filter(e => e.kind === 'work').map(e => e.id)
        for (let i = 0; i < parsed.entries.length; i++) {
          const row = parsed.entries[i],
            old = entries.get(row.id)
          const previousObservation = old?.observations || []
          // 原始观察去重保存，规范摘要采用最新非空值；首次出现位置不因跨页重复移动。
          const observation = {
            page,
            title: row.title,
            releaseDate: row.releaseDate,
            makerText: row.makerText
          }
          const observations = previousObservation.some(
            o => JSON.stringify(o) === JSON.stringify(observation)
          )
            ? previousObservation
            : [...previousObservation, observation]
          const merged = {
            ...old,
            ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== '')),
            firstSeenAt: old?.firstSeenAt || Date.now(),
            lastSeenAt: Date.now(),
            sourceOrdinal: scan.ids.includes(row.id) ? old.sourceOrdinal : (page - 1) * 20 + i,
            seenOnPages: [...new Set([...(old?.seenOnPages || []), page])],
            observations
          }
          entries.set(row.id, merged)
          if (!scan.ids.includes(row.id)) scan.ids.push(row.id)
          enqueue(row)
        }
        scan.nextPage = parsed.nextPage
        scan.lastProgressAt = Date.now()
        // 一次有效分页已证明来源恢复，清除历史失败；以后再失败从第一次退避开始。
        scan.attempts = 0
        scan.nextRetryAt = 0
        person.entries = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id))
        person.updatedAt = Date.now()
        writeJson(file, person)
        save()
      }
      if (!scan.nextPage) {
        // 最后重新核对首页，避免跨页时源站变动却被误标为稳定遍历。
        const check = await sourceRead(listUrl(actorId, 1), html => parseList(html, actorId, 1))
        const stable =
          JSON.stringify(check.entries.filter(e => e.kind === 'work').map(e => e.id)) ===
          JSON.stringify(scan.firstIds)
        person.visitedAllPagesAt = Date.now()
        if (stable) {
          person.completedAt = Date.now()
          person.scanId = scan.scanId
          for (const row of person.entries)
            row.missingFromLatestCompleteScan = !scan.ids.includes(row.id)
        }
        scan.finished = true
        scan.stable = stable
        scan.completedAt = stable ? Date.now() : null
        scan.attempts = 0
        scan.nextRetryAt = 0
        writeJson(file, person)
        save()
      }
    } catch (error) {
      if (error.budgetExhausted) report.budgetExhausted = true
      else if (error.sourceUnavailable) {
        scan.attempts = (scan.attempts || 0) + 1
        scan.nextRetryAt = Date.now() + Math.min(86400000, 60000 * 2 ** Math.min(scan.attempts, 10))
        report.failures.push({ actorId, page: scan.nextPage, error: error.message })
      } else throw error
      save()
    }
    report.people.push({
      actorId,
      formal: person.entries.filter(e => e.kind === 'work').length,
      placeholders: person.entries.filter(e => e.kind === 'unknown').length,
      nextPage: scan.nextPage,
      stable: scan.stable || false
    })
  }
}
async function collectDetails() {
  for (const [id, task] of Object.entries(state.pendingDetails)) {
    if (report.details >= detailBudget) break
    if (allowedDetails && !allowedDetails.has(id)) continue
    if (task.nextRetryAt > Date.now()) continue
    // 兼容旧断点：旧版本会排入七天前的详情；扩池阶段复用已有成功版本。
    if (readJson(path.join(root, 'records', id + '.json'), null)?.fetchedAt) {
      delete state.pendingDetails[id]
      continue
    }
    if (requests.used >= requests.limit) {
      report.budgetExhausted = true
      break
    }
    report.details++
    try {
      const fresh = await sourceRead(base + `av${id}.html`, html => parseDetail(html, id))
      const file = path.join(root, 'records', id + '.json')
      const old = readJson(file, {})
      const record = {
        ...old,
        ...Object.fromEntries(
          Object.entries(fresh).filter(
            ([, v]) => v !== null && v !== '' && (!Array.isArray(v) || v.length)
          )
        ),
        fetchedAt: Date.now()
      }
      writeJson(file, record)
      delete state.pendingDetails[id]
    } catch (error) {
      if (error.budgetExhausted) {
        report.budgetExhausted = true
        break // 预算暂停不是源站失败，不增加尝试次数或退避时间。
      }
      if (!error.sourceUnavailable) throw error
      task.attempts++
      task.lastError = error.message
      task.nextRetryAt =
        Date.now() +
        (error.permanent
          ? 7 * 86400000
          : Math.min(86400000, 60000 * 2 ** Math.min(task.attempts, 10)))
      report.failures.push({ workId: id, error: error.message })
    }
    save()
  }
}
/** 只统计当前范围中真正缺详情的任务；成功缓存和退避任务均不能误触发暂停。 */
function detailBacklog(now) {
  let ready = 0,
    waiting = 0
  for (const [id, task] of Object.entries(state.pendingDetails)) {
    if (allowedDetails && !allowedDetails.has(id)) continue
    if (readJson(path.join(root, 'records', id + '.json'), null)?.fetchedAt) continue
    if (task.nextRetryAt > now) waiting++
    else ready++
  }
  return { ready, waiting }
}
async function run() {
  const before = detailBacklog(Date.now())
  const mode = planWorkRound({ readyDetails: before.ready, detailLimit: detailBudget })
  report.scheduling = {
    mode,
    detailThreshold: detailBudget,
    before,
    skippedLists: mode === 'details-first'
  }
  // 决策在轮次开始时固定；即便本轮恰好清空积压，也留到下一轮再恢复列表，防止立即回填。
  await collectDetails()
  if (mode === 'normal') {
    await collectLists()
    await collectDetails()
  }
  report.scheduling.after = detailBacklog(Date.now())
  save()
  report.finishedAt = Date.now()
  report.requests = requests.used
  report.budgetExhausted ||= requests.used >= requests.limit
  report.pendingDetails = Object.keys(state.pendingDetails).length
  writeJson(path.join(root, 'report.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (report.failures.length) process.exitCode = 2
}
run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
