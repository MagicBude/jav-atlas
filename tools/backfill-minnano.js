/**
 * @file 按固定数量补齐 minnano 人物详情与同批头像，避免新名册立即触发全量请求。
 * 成功时间保存在名册中，跨 runner 生效；没有成功标记的记录下轮仍可重试。
 * 已成功但缺失的字段可能是源站未提供，不据此无限重复抓取；满30天后限量复查。
 */
const { spawnSync } = require('child_process')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const fs = require('fs')
const { dataPaths } = require('./lib/data-paths')
const { planProfiles, nextProfileTask } = require('./lib/profile-policy')
const limit = envInt('BACKFILL_LIMIT', 20, 1, 1000)
const roster = readJson(dataPaths().minnanoActresses, null)
if (!Array.isArray(roster) || !roster.length) throw new Error('缺少人物名册，请先发现目录')
// 旧批次只有规范字段，需重新补充原字段；版本标记避免源站无字段人物无限重抓。
const pool = process.env.RANKED_ONLY === '1' ? readJson(dataPaths().minnanoRankedPool, null) : null
if (process.env.RANKED_ONLY === '1' && (!pool || !Object.keys(pool.members || {}).length))
  throw new Error('缺少榜单人物池，拒绝降级为全名册采集')
const scoped = pool ? roster.filter(row => Object.hasOwn(pool.members, String(row.mnid))) : roster
const startedAt = Date.now()
const progressFile = path.join(path.dirname(dataPaths().minnanoActresses), 'profile-progress.json')
const progress = readJson(progressFile, { tasks: {} })
const targets = planProfiles(scoped, progress.tasks, startedAt, limit)
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
      byId.get(id)?.profileSchemaVersion === 2 && byId.get(id)?.profileFetchedAt >= startedAt
        ? 'success'
        : attempt && attempt.fetchedAt >= startedAt && !attempt.ok
          ? 'failed'
          : 'not-attempted'
    // 未实际尝试不能记为失败；旧详情仍在也不能把本轮复查失败报成成功。
    if (status !== 'not-attempted')
      progress.tasks[id] = nextProfileTask(progress.tasks[id], Date.now(), status === 'success')
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
      people: pool
        ? current.filter(row => Object.hasOwn(pool.members, String(row.mnid))).length
        : current.length,
      profileSuccess: current.filter(
        row => (!pool || Object.hasOwn(pool.members, String(row.mnid))) && row.profileFetchedAt
      ).length,
      profileFieldsSaved: current.filter(
        row =>
          (!pool || Object.hasOwn(pool.members, String(row.mnid))) && row.profileSchemaVersion === 2
      ).length,
      missingAvatars: current.filter(
        row => (!pool || Object.hasOwn(pool.members, String(row.mnid))) && !imageExists(row.mnid)
      ).length
    },
    results
  }
  writeJson(progressFile, progress)
  writeJson(path.join(path.dirname(paths.minnanoActresses), 'backfill-report.json'), summary)
  console.log(
    '本批统计：' + JSON.stringify(summary.batch) + '；全册：' + JSON.stringify(summary.total)
  )
}
if (!targets.length) {
  console.log('本轮没有到期的人物详情任务；缺图仍由独立头像队列补齐')
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
      // 日常榜单允许详情暂时不可用：保留真实失败报告，不写成功时间，下轮仍会重试。
      // 仅接受详情脚本约定的退出码 2；语法、文件和其他子步骤错误必须继续阻断。
      if (
        file === 'profiles-relay.js' &&
        result.status === 2 &&
        process.env.ALLOW_PROFILE_UNAVAILABLE === '1'
      ) {
        console.warn('::warning::本轮人物详情暂不可用，已保留旧资料及失败报告，继续更新榜单')
        process.exit(0)
      }
      process.exit(result.status || 1)
    }
  }
}
report(0)
