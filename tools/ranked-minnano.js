/**
 * @file 榜单人物的每日流水线：Top250 × 三榜 → 累积人物池 → 补详情 → 独立重试缺图。
 * 人物池按原生 ID 去重，当天最多新增 750 人；历史上榜者保留，所以长期总数不固定为 750。
 * 不遍历全站目录、不采集 JavDB、不清理历史资料。作品采集尚未接入。
 */
const { spawnSync } = require('child_process')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const fs = require('fs')
const { dataPaths } = require('./lib/data-paths')

/** 每步失败立即停止。显式传环境，确保后续所有网络任务只接收人物池 ID。 */
function step(file, args = [], extra = {}) {
  console.log('\n>>> ' + file)
  const result = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
    env: { ...process.env, ...extra },
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
// 排名阶段不重复补图；资料与头像统一在人物池阶段处理，避免同一人重复请求。
step('rank-relay.js', [], { AVA_LIMIT: '0' })
step('bootstrap-roster.js')
const pool = readJson(dataPaths().minnanoRankedPool, null)
const ids = Object.keys(pool?.members || {})
if (!ids.length) throw new Error('榜单人物池为空，停止采集')
const limit = envInt('BACKFILL_LIMIT', 750, 1, 1000)
step('backfill-minnano.js', [], {
  RANKED_ONLY: '1',
  // 详情补齐是可重试的附加步骤；不让单个人物长期被拦截阻塞完整榜单发布。
  ALLOW_PROFILE_UNAVAILABLE: '1',
  BACKFILL_LIMIT: String(limit),
  SKIP_IMAGES: '1'
})
// 图片重试不依赖本轮是否补了详情：旧人物已有详情、但图片失败，也能在以后补齐。
if (process.env.SKIP_IMAGES !== '1')
  step('roster-avatars.js', [String(limit)], { ONLY: ids.join(',') })
// 详情步骤的报告先于独立补图生成；补图结束后只重算图片状态，不再次抓取下一批详情。
const paths = dataPaths()
const reportFile = path.join(path.dirname(paths.minnanoActresses), 'backfill-report.json')
const report = readJson(reportFile, null)
const images = readJson(path.join(paths.minnanoAvatars, 'index.json'), { files: {} })
const imageExists = id => {
  const file = images.files[id]?.file
  if (!file || !/^(female|male|unknown)\/[^/\\]+\.jpg$/.test(file)) return false
  const target = path.join(paths.minnanoAvatars, file)
  return fs.existsSync(target) && fs.statSync(target).size > 2048
}
if (report) {
  for (const row of report.results) row.avatar = imageExists(row.mnid) ? 'available' : 'missing'
  report.batch.missingAvatars = report.results.filter(row => row.avatar === 'missing').length
  report.total.missingAvatars = ids.filter(id => !imageExists(id)).length
  report.scope = 'ranked-pool'
  report.generatedAt = Date.now()
  writeJson(reportFile, report)
}
step('gen-female-names.js')
