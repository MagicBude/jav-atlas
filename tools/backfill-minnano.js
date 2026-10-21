/**
 * @file 按固定数量补齐 minnano 人物详情与同批头像，避免新名册立即触发全量请求。
 * 成功时间保存在名册中，跨 runner 生效；没有成功标记的记录下轮仍可重试。
 * 已成功但缺失的字段可能是源站未提供，不据此无限重复抓取；刷新仍可直接用 profiles-relay.js。
 */
const { spawnSync } = require('child_process')
const path = require('path')
const { readJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const limit = envInt('BACKFILL_LIMIT', 20, 1, 1000)
const roster = readJson(dataPaths().minnanoActresses, null)
if (!Array.isArray(roster) || !roster.length) throw new Error('缺少人物名册，请先发现目录')
const targets = roster.filter(row => row.mnid && !row.profileFetchedAt).slice(0, limit)
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
    if (result.status !== 0) process.exit(result.status || 1)
  }
}
