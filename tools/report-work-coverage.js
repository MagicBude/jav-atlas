/**
 * 只读覆盖盘点：不联网，不改采集断点。传 --output <路径> 时另存报告。
 * 完成数、缺失数和重试等待分别列出，运行成功不代表来源数据已经全部补齐。
 */
const fs = require('fs')
const path = require('path')
const { readJson, writeJson, relayDir } = require('./lib/runtime')
const { listCoverage } = require('./lib/work-coverage')
const root = relayDir()
const read = (file, fallback) => readJson(path.join(root, file), fallback)
const pool = read('minnano/ranked-pool.json', { members: {} }).members
const progress = read('minnano/works/progress.json', { people: {}, pendingDetails: {} })
const enrichment = read('javdb/work-enrichment/progress.json', { tasks: {} })
const mappings = read('javdb/work-enrichment/mappings.json', { mappings: {} }).mappings
const now = Date.now()
const profiles = read('minnano/actresses.json', []).filter(row =>
  Object.hasOwn(pool, String(row.mnid))
)
const profileTasks = read('minnano/profile-progress.json', { tasks: {} }).tasks
const profileCoverage = {
  fetched: profiles.filter(row => row.profileSchemaVersion === 2 && row.profileFetchedAt).length,
  waitingRetry: Object.values(profileTasks).filter(task => task.nextRetryAt > now).length,
  // 这些是“当前保存的非空字段”数量，不把缺值直接解释成采集失败或来源确实没有。
  availableFields: Object.fromEntries(
    ['birthday', 'height', 'cup', 'agency', 'official', 'hobby'].map(field => [
      field,
      profiles.filter(
        row =>
          row[field] != null &&
          row[field] !== '' &&
          (!Array.isArray(row[field]) || row[field].length)
      ).length
    ])
  )
}
const lists = { 'not-started': 0, partial: 0, unstable: 0, complete: 0 }
let waitingLists = 0
for (const id of Object.keys(pool)) {
  lists[listCoverage(progress.people[id])]++
  if (progress.people[id]?.nextRetryAt > now) waitingLists++
}
const folder = path.join(root, 'minnano/works/people')
const listed = new Set()
if (fs.existsSync(folder))
  for (const file of fs.readdirSync(folder).filter(f => /^\d+\.json$/.test(f))) {
    const person = readJson(path.join(folder, file))
    if (!Object.hasOwn(pool, person.actorId)) continue
    for (const entry of person.entries) if (entry.kind === 'work') listed.add(entry.id)
  }
let details = 0,
  withCode = 0,
  matched = 0,
  fresh = 0,
  waitingMetadata = 0
for (const id of listed) {
  const local = read(`minnano/works/records/${id}.json`, null)
  if (!local?.fetchedAt) continue
  details++
  if (local.code) withCode++
  const mapping = mappings[id]
  const record =
    mapping && /^[a-zA-Z0-9]+$/.test(mapping.javdbId)
      ? read(`javdb/work-enrichment/records/${mapping.javdbId}.json`, null)
      : null
  if (
    local.code &&
    mapping?.code === local.code &&
    record?.id === mapping.javdbId &&
    record?.metadata
  ) {
    matched++
    if (
      Number.isInteger(record.metadata.type) &&
      record.metadata.type >= 0 &&
      record.metadata.type <= 4 &&
      now - record.fetchedAt < 7 * 86400000
    )
      fresh++
  }
  if (enrichment.tasks[id]?.nextRetryAt > now) waitingMetadata++
}
const report = {
  generatedAt: new Date(now).toISOString(),
  scope: 'cumulative-ranked-pool',
  people: {
    total: Object.keys(pool).length,
    lists,
    waitingRetry: waitingLists,
    profiles: profileCoverage
  },
  works: {
    listed: listed.size,
    details,
    missingDetails: listed.size - details,
    withCode,
    missingCode: details - withCode
  },
  metadata: {
    matched,
    notMatched: withCode - matched,
    freshWithinSevenDays: fresh,
    waitingRetry: waitingMetadata
  },
  pendingDetailTasks: Object.keys(progress.pendingDetails).length
}
const args = process.argv.slice(2)
if (args.length) {
  if (args.length !== 2 || args[0] !== '--output')
    throw Error('用法：node tools/report-work-coverage.js [--output 文件路径]')
  writeJson(path.resolve(args[1]), report)
}
console.log(JSON.stringify(report, null, 2))
