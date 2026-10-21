/**
 * @file 统一采集入口：默认小规模验证，明确指定 daily 才启用正常任务量。
 * 每步独立执行，失败立即停止；本地此前成功的产物仍留在目录中供排查。
 */
const { spawnSync } = require('child_process')
const path = require('path')
const { relayDir, envInt } = require('./lib/runtime')
const [mode = 'smoke', source = 'all'] = process.argv.slice(2)
if (
  !['smoke', 'daily'].includes(mode) ||
  !['all', 'minnano', 'javdb', 'male', 'directory'].includes(source)
) {
  throw new Error('用法：node tools/collect.js smoke|daily all|minnano|javdb|male|directory')
}
const env = { ...process.env, RELAY_DIR: relayDir() }
if (mode === 'smoke')
  Object.assign(env, {
    SEED_LIMIT: '3',
    MOVIE_PAGES: '1',
    UC_PAGES: '1',
    PROFILE_LIMIT: '3',
    AVA_LIMIT: '3',
    FIX_LIMIT: '0',
    SKIP_IMAGES: '1',
    WEB_GENDER: '0',
    HTTP_TIMEOUT_MS: '8000'
  })
const jobs = []
if (source === 'all' || source === 'minnano') {
  jobs.push(
    ['rank-relay.js'],
    ['bootstrap-roster.js'],
    ['profiles-relay.js'],
    ['gen-female-names.js']
  )
  if (mode === 'daily') jobs.push(['roster-avatars.js', '400'])
}
if (source === 'all' || source === 'javdb') {
  jobs.push(['actors-full-crawl.js'], ['uncensored-actresses-crawl.js'], ['gen-female-names.js'])
}
if (source === 'male') jobs.push(['male-roster-relay.js'])
// 目录发现独立执行，不把新发现的两万多人物立即变成详细资料和头像任务。
if (source === 'directory') {
  env.DIRECTORY_PAGES = mode === 'smoke' ? '1' : String(envInt('DIRECTORY_PAGES', 20, 1, 2000))
  jobs.push(['discover-minnano-groups.js'])
  jobs.push(['gen-female-names.js'])
}
jobs.push(['migrate-avatar-names.js'])
for (const [file, ...args] of jobs) {
  console.log('\n>>> ' + file)
  const result = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
    env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('\n采集步骤执行成功；覆盖范围与未知性别请检查产物及日志。')
