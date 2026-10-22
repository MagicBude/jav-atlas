/**
 * @file 两个人物的独立作品试采。每次请求串行且至少间隔500ms，不下载封面或视频。
 * 完整是“作品分页链遍历成功”，与详情补齐分开。预算用完保存断点；失败非零退出。
 */
const fs = require('fs')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const { parseList, parseDetail } = require('./lib/minnano-works')
const base = 'https://www.minnano-av.com/'
const root = path.join(path.dirname(dataPaths().minnanoActresses), 'works')
const ids = ['190754', '125605'] // 试采白名单，不提供全池自动扩展。
const pool = readJson(dataPaths().minnanoRankedPool, null)
if (!ids.every(id => Object.hasOwn(pool?.members || {}, id))) throw Error('试采人物不在榜单池')
const pageBudget = envInt('WORK_PAGES', 20, 1, 100)
const detailBudget = envInt('WORK_DETAILS', 50, 0, 100)
const stateFile = path.join(root, 'progress.json')
const state = readJson(stateFile, { schemaVersion: 1, people: {}, pendingDetails: {} })
if (state.schemaVersion !== 1 || !state.people || !state.pendingDetails)
  throw Error('作品断点格式无效')
let lastRequest = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function get(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
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
const report = { startedAt: Date.now(), pages: 0, details: 0, failures: [], people: [] }
function save() {
  writeJson(stateFile, state)
}
function enqueue(entry) {
  if (entry.kind !== 'work') return
  const file = path.join(root, 'records', entry.id + '.json')
  const old = readJson(file, null)
  if (!old?.fetchedAt || Date.now() - old.fetchedAt > 7 * 86400000)
    state.pendingDetails[entry.id] ||= { attempts: 0, nextRetryAt: 0 }
}
async function run() {
  for (const actorId of ids) {
    const file = path.join(root, 'people', actorId + '.json')
    const person = readJson(file, { actorId, entries: [], completedAt: null })
    let scan = state.people[actorId]
    if (!scan || scan.finished || Date.now() - scan.startedAt > 86400000)
      scan = state.people[actorId] = {
        scanId: `${actorId}-${Date.now()}`,
        startedAt: Date.now(),
        nextPage: 1,
        pages: {},
        ids: [],
        firstIds: []
      }
    const entries = new Map(person.entries.map(e => [e.id, e]))
    try {
      while (scan.nextPage && report.pages < pageBudget) {
        const page = scan.nextPage
        const parsed = parseList(await get(listUrl(actorId, page)), actorId, page)
        report.pages++
        const signature = parsed.entries.map(e => e.id).join(',')
        if (Object.values(scan.pages).includes(signature) && signature)
          throw Error('重复分页，停止而不标完成')
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
        person.entries = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id))
        person.updatedAt = Date.now()
        writeJson(file, person)
        save()
      }
      if (!scan.nextPage) {
        // 最后重新核对首页，避免跨页时源站变动却被误标为稳定遍历。
        const check = parseList(await get(listUrl(actorId, 1)), actorId, 1)
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
        writeJson(file, person)
        save()
      }
    } catch (error) {
      report.failures.push({ actorId, page: scan.nextPage, error: error.message })
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
  for (const [id, task] of Object.entries(state.pendingDetails)) {
    if (report.details >= detailBudget) break
    if (task.nextRetryAt > Date.now()) continue
    report.details++
    try {
      const fresh = parseDetail(await get(base + `av${id}.html`), id)
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
  report.finishedAt = Date.now()
  report.pendingDetails = Object.keys(state.pendingDetails).length
  writeJson(path.join(root, 'report.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (report.failures.length) process.exitCode = 1
}
run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
