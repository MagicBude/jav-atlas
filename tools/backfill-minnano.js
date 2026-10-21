/**
 * @file 按固定数量补齐 minnano 人物详情与同批头像，避免新名册立即触发全量请求。
 * 成功时间保存在名册中，跨 runner 生效；没有成功标记的记录下轮仍可重试。
 * 已成功但缺失的字段可能是源站未提供，不据此无限重复抓取；刷新仍可直接用 profiles-relay.js。
 */
const { spawnSync } = require('child_process')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const fs = require('fs')
const { dataPaths } = require('./lib/data-paths')
const limit = envInt('BACKFILL_LIMIT', 20, 1, 1000)
const roster = readJson(dataPaths().minnanoActresses, null)
if (!Array.isArray(roster) || !roster.length) throw new Error('缺少人物名册，请先发现目录')
// 旧批次只有规范字段，需重新补充原字段；版本标记避免源站无字段人物无限重抓。
const targets = roster
  .filter(row => row.mnid && (!row.profileFetchedAt || row.profileSchemaVersion !== 2))
  .slice(0, limit)
const startedAt = Date.now()
/** 即使子步骤失败，也保存本批ID与实际落盘状态；不把尚未尝试的人物算成访问失败。 */
function report(exitCode) {
  const paths = dataPaths()
  const current = readJson(paths.minnanoActresses)
  const byId = new Map(current.map(row => [String(row.mnid), row]))
  const cache = readJson(
    path.join(
      process.env.CACHE_DIR || path.join(__dirname, '..', '.cache', 'profiles'),
      'profiles-relay.json'
    ),
    {}
  )
  const index = readJson(path.join(paths.minnanoAvatars, 'index.json'), { files: {} })
  const imageExists = id => {
    const file = index.files[String(id)]?.file
    if (!file || !/^(female|male|unknown)\/[^/\\]+\.jpg$/.test(file)) return false
    const target = path.join(paths.minnanoAvatars, file)
    return fs.existsSync(target) && fs.statSync(target).size > 2048
  }
  const results = targets.map(row => {
    const id = String(row.mnid)
    const attempt = cache[id]
    const status =
      byId.get(id)?.profileSchemaVersion === 2
        ? 'success'
        : attempt && attempt.fetchedAt >= startedAt && !attempt.ok
          ? 'failed'
          : 'not-attempted'
    return {
      mnid: id,
      name: row.name,
      profile: status,
      avatar: imageExists(id) ? 'available' : 'missing'
    }
  })
  const summary = {
    generatedAt: Date.now(),
    exitCode,
    selected: targets.length,
    batch: {
      profileSuccess: results.filter(row => row.profile === 'success').length,
      profileFailed: results.filter(row => row.profile === 'failed').length,
      profileNotAttempted: results.filter(row => row.profile === 'not-attempted').length,
      missingAvatars: results.filter(row => row.avatar === 'missing').length
    },
    total: {
      people: current.length,
      profileSuccess: current.filter(row => row.profileFetchedAt).length,
      profileFieldsSaved: current.filter(row => row.profileSchemaVersion === 2).length,
      missingAvatars: current.filter(row => !imageExists(row.mnid)).length
    },
    results
  }
  writeJson(path.join(path.dirname(paths.minnanoActresses), 'backfill-report.json'), summary)
  console.log(
    '本批统计：' + JSON.stringify(summary.batch) + '；全册：' + JSON.stringify(summary.total)
  )
}
if (!targets.length) {
  console.log('人物详情已全部尝试成功；缺图可独立运行 roster-avatars.js 补齐')
} else {
  const env = {
    ...process.env,
    PROFILE_LIMIT: String(limit),
    ONLY: targets.map(row => row.mnid).join(',')
  }
  for (const [file, ...args] of [
    ['profiles-relay.js'],
    ...(env.SKIP_IMAGES === '1' ? [] : [['roster-avatars.js', String(limit)]]),
    ['gen-female-names.js']
  ]) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
      env,
      stdio: 'inherit'
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      report(result.status || 1)
      process.exit(result.status || 1)
    }
  }
}
report(0)
