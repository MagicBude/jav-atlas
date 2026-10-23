/**
 * 为已有 JavDB 记录补齐内容类型，仅请求作品详情，不下载图片或评论。
 * 先核对原生 ID 和番号，再写 type；保留原 fetchedAt，另记类型核实时间，
 * 避免把一次字段回填误认为整份资料都已经刷新。失败保留原文件，下次可续跑。
 */
const fs = require('fs')
const path = require('path')
const { JDB_LINES, jdbSign } = require('./lib/javdb-mobile')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const { checkedMovieType } = require('./lib/work-enrichment')
async function main() {
  const root = path.join(path.dirname(dataPaths().javdbActors), 'work-enrichment/records')
  const limit = envInt('TYPE_BACKFILL_REQUESTS', 50, 1, 150)
  let requests = 0,
    saved = 0,
    failed = 0
  for (const file of fs.readdirSync(root).filter(name => /^[a-zA-Z0-9]+\.json$/.test(name))) {
    const target = path.join(root, file),
      record = readJson(target)
    if (
      Number.isInteger(record.metadata?.type) &&
      record.metadata.type >= 0 &&
      record.metadata.type <= 4
    )
      continue
    if (requests >= limit) break
    let movie, lastError
    for (const line of JDB_LINES) {
      if (requests >= limit) break
      await new Promise(resolve => setTimeout(resolve, 1000))
      requests++
      try {
        const response = await fetch(line + '/api/v2/movies/' + record.id, {
          headers: {
            jdsignature: jdbSign(),
            'User-Agent': 'Dart/3.5 (dart:io)',
            'Accept-Language': 'zh-TW'
          },
          signal: AbortSignal.timeout(12000)
        })
        // 限流后整体停止，不用换线路绕过来源的重试要求。
        if (response.status === 429)
          throw Object.assign(Error('来源限流，停止本轮回填'), { stop: true })
        if (!response.ok) throw Error('HTTP ' + response.status)
        const json = await response.json()
        movie = json.data?.movie
        checkedMovieType(record, movie)
        break
      } catch (error) {
        if (error.stop) throw error
        movie = undefined
        lastError = error
      }
    }
    if (!movie) {
      failed++
      console.error(record.id + ': ' + (lastError?.message || '预算用尽'))
      continue
    }
    // 磁盘写入不放入网络重试范围，文件错误必须显式退出，不能伪装为来源失败。
    record.metadata.type = checkedMovieType(record, movie)
    record.typeFetchedAt = Date.now()
    writeJson(target, record)
    saved++
    console.log(record.id + ': type=' + record.metadata.type)
  }
  const remaining = fs
    .readdirSync(root)
    .filter(name => name.endsWith('.json'))
    .filter(name => {
      const type = readJson(path.join(root, name)).metadata?.type
      return !Number.isInteger(type) || type < 0 || type > 4
    }).length
  console.log(JSON.stringify({ requests, saved, failed, remaining }))
  if (failed || remaining) process.exitCode = 2
}
if (require.main === module)
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
