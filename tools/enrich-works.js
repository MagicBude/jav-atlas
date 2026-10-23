/**
 * @file 分批补充JavDB评分与基础元数据。只处理已有minnano作品，不采评论/图片。
 * 搜索番号唯一精确匹配后，再校验详情ID和番号；两来源独立保存，不覆盖minnano。
 * 预算暂停退出0；来源失败/待确认退出2且保留有效进度；文件或程序错误退出1。
 */
const fs = require('fs')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const { JDB_LINES, jdbSign } = require('./lib/javdb-mobile')
const { RequestBudget } = require('./lib/works-policy')
const { project, matchCandidate } = require('./lib/work-enrichment')
const paths = dataPaths()
const source = path.join(path.dirname(paths.minnanoActresses), 'works/records')
const root = path.join(path.dirname(paths.javdbActors), 'work-enrichment')
const stateFile = path.join(root, 'progress.json')
const state = readJson(stateFile, { schemaVersion: 1, tasks: {} })
if (state.schemaVersion !== 1 || !state.tasks) throw Error('补充资料断点格式无效')
const mappingDocument = readJson(path.join(root, 'mappings.json'), {
  schemaVersion: 1,
  mappings: {}
})
if (
  mappingDocument.schemaVersion !== 1 ||
  !mappingDocument.mappings ||
  Array.isArray(mappingDocument.mappings)
)
  throw Error('作品映射格式无效')
const mappings = mappingDocument.mappings
const limit = envInt('ENRICH_LIMIT', 10, 1, 50)
const budget = new RequestBudget(envInt('ENRICH_REQUESTS', 30, 1, 150))
const delay = envInt('ENRICH_DELAY_MS', 1000, 0, 10000)
const ttl = 7 * 86400000
let lastRequest = 0,
  preferred = ''
const report = { startedAt: Date.now(), limit, requestLimit: budget.limit, results: [] }
const save = () => writeJson(stateFile, state)

/** 线路切换也消耗预算；只接受JSON业务响应，不把验证页或空响应当搜索无结果。 */
async function get(relative) {
  let lastError
  for (const line of [...new Set([preferred, ...JDB_LINES].filter(Boolean))]) {
    budget.take()
    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, delay - (Date.now() - lastRequest)))
    )
    lastRequest = Date.now()
    try {
      const response = await fetch(line + '/api/' + relative, {
        headers: {
          jdsignature: jdbSign(),
          'User-Agent': 'Dart/3.5 (dart:io)',
          'Accept-Language': 'zh-TW',
          Accept: 'application/json'
        },
        signal: AbortSignal.timeout(12000)
      })
      if (!response.ok) {
        const error = Error('HTTP ' + response.status)
        if (response.status === 429) {
          const value = response.headers.get('retry-after')
          error.rateLimited = true
          error.retryAfter = Math.min(
            86400000,
            Math.max(
              0,
              /^\d+$/.test(value || '') ? Number(value) * 1000 : Date.parse(value) - Date.now()
            ) || 0
          )
        }
        throw error
      }
      const json = await response.json()
      if (json.success === 0 || !json.data) throw Error('来源接口未返回有效资料')
      preferred = line
      return json
    } catch (error) {
      if (error.rateLimited) throw error // 限流时不切线路继续请求，交给跨轮退避。
      lastError = error
    }
  }
  throw lastError || Error('来源线路不可用')
}

async function run() {
  const locals = fs
    .readdirSync(source)
    .filter(file => /^\d+\.json$/.test(file))
    .map(file => readJson(path.join(source, file)))
    .filter(local => /^\d+$/.test(String(local.id)) && local.code)
    .sort(
      (a, b) =>
        (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
        String(a.id).localeCompare(String(b.id))
    )
  const targets = locals
    .filter(local => {
      const task = state.tasks[local.id],
        mapping = mappings[local.id]
      if (task?.nextRetryAt > Date.now()) return false
      const old =
        mapping && /^[a-zA-Z0-9]+$/.test(mapping.javdbId)
          ? readJson(path.join(root, 'records', mapping.javdbId + '.json'), null)
          : null
      return !(
        mapping?.code === local.code &&
        Number.isInteger(old?.metadata?.type) &&
        old.metadata.type >= 0 &&
        old.metadata.type <= 4 &&
        old?.fetchedAt &&
        Date.now() - old.fetchedAt < ttl
      )
    })
    .sort(
      (a, b) =>
        Number(!!mappings[a.id]) - Number(!!mappings[b.id]) ||
        (state.tasks[a.id]?.checkedAt || 0) - (state.tasks[b.id]?.checkedAt || 0)
    )
    .slice(0, limit)
  for (const local of targets) {
    if (state.nextRequestAt > Date.now()) break // 来源限流时间跨runner保留，不仅约束某一部。
    let projected
    try {
      const search = await get(
        'v2/search?q=' + encodeURIComponent(local.code) + '&type=movie&page=1'
      )
      const candidate = matchCandidate(local.code, search)
      const detail = await get('v2/movies/' + candidate.id)
      projected = project(local, search, detail, [], Date.now())
    } catch (error) {
      if (error.budgetExhausted) break // 不是访问失败，不能增加退避或写完成标记。
      if (error instanceof TypeError && !/fetch/i.test(error.message)) throw error
      const previous = state.tasks[local.id]
      const attempts = (previous?.attempts || 0) + 1
      const status = error.matchStatus || 'failed'
      state.tasks[local.id] = {
        status,
        attempts,
        lastError: error.message,
        checkedAt: Date.now(),
        nextRetryAt:
          Date.now() +
          Math.max(
            error.retryAfter || 0,
            error.matchStatus ? ttl : Math.min(86400000, 60000 * 2 ** Math.min(attempts, 10))
          )
      }
      report.results.push({ id: local.id, code: local.code, status, error: error.message })
      if (error.rateLimited) state.nextRequestAt = state.tasks[local.id].nextRetryAt
      save()
      if (error.rateLimited) break // 本轮整体停下，避免紧接着请求下一部再次触发限流。
      continue
    }
    // 所有文件读取/写入在来源异常处理之外，磁盘错误不能被降级为绿色来源失败。
    const recordFile = path.join(root, 'records', projected.record.id + '.json')
    const old = readJson(recordFile, null)
    const record = {
      ...old,
      ...projected.record,
      metadata: {
        ...old?.metadata,
        ...Object.fromEntries(
          Object.entries(projected.record.metadata).filter(
            ([, value]) => value !== null && value !== '' && (!Array.isArray(value) || value.length)
          )
        )
      }
    }
    // 本轮只更新元数据，不抹掉以前保存的评论；评论取得时间也单独保留。
    if (old?.reviews?.length) {
      record.reviews = old.reviews
      record.reviewScope = old.reviewScope
      record.reviewsFetchedAt = old.reviewsFetchedAt || old.fetchedAt
    }
    writeJson(recordFile, record)
    mappings[local.id] = projected.mapping
    writeJson(path.join(root, 'mappings.json'), mappingDocument)
    state.tasks[local.id] = {
      status: 'success',
      checkedAt: Date.now(),
      attempts: 0,
      nextRetryAt: 0
    }
    save()
    report.results.push({
      id: local.id,
      code: local.code,
      javdbId: record.id,
      status: 'success',
      dateDifference: projected.mapping.dateDifference
    })
  }
  report.finishedAt = Date.now()
  report.requests = budget.used
  report.blockedUntil = state.nextRequestAt > Date.now() ? state.nextRequestAt : null
  report.success = report.results.filter(row => row.status === 'success').length
  report.needsAttention = report.results.length - report.success
  writeJson(path.join(root, 'report.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (report.needsAttention) process.exitCode = 2
}
run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
