/**
 * 小预算FANZA文字补缺。独立保存，不覆盖JavDB，不下载图片和视频。
 * 只处理缺少JavDB时长的现有作品；候选ID不等于匹配证据，返回番号必须一致。
 * 内部GraphQL接口可能变化，403/429立即停止，不切线路绕过；断点随数据提交。
 */
const fs = require('fs')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const { candidates, checkedRecord } = require('./lib/fanza')
const root = path.dirname(path.dirname(dataPaths().minnanoActresses))
const out = path.join(root, 'fanza/work-enrichment')
const stateFile = path.join(out, 'progress.json')
const state = readJson(stateFile, { tasks: {} })
const mappings = readJson(path.join(root, 'javdb/work-enrichment/mappings.json'), {
  mappings: {}
}).mappings
const limit = envInt('FANZA_LIMIT', 5, 1, 20)
// 指定原生人物库作品ID进行有界复核，仅跳过这些作品的单项退避；来源限流仍然生效。
const selectedIds = process.env.FANZA_IDS ? process.env.FANZA_IDS.split(',') : null
if (selectedIds && !selectedIds.every(id => /^\d+$/.test(id)))
  throw Error('FANZA_IDS必须是逗号分隔的作品原生ID')
const report = { startedAt: Date.now(), requests: 0, results: [] }
const query =
  'query AtlasSupplement($id: ID!) { ppvContent(id: $id) { id makerContentId duration makerReleasedAt directors { name } series { name } maker { name } label { id name } genres { id name } } }'
async function run() {
  const folder = path.join(root, 'minnano/works/records')
  const locals = fs
    .readdirSync(folder)
    .filter(f => /^\d+\.json$/.test(f))
    .map(f => readJson(path.join(folder, f)))
    .filter(row => {
      if (selectedIds && !selectedIds.includes(String(row.id))) return false
      if (
        !candidates(row.code).length ||
        (!selectedIds && state.tasks[row.id]?.nextRetryAt > Date.now())
      )
        return false
      if (readJson(path.join(out, 'records', row.id + '.json'), null)) return false
      const mapping = mappings[row.id]
      return !(
        mapping &&
        Number(
          readJson(path.join(root, 'javdb/work-enrichment/records', mapping.javdbId + '.json'), {})
            ?.metadata?.duration
        ) > 0
      )
    })
    .slice(0, limit)
  if (!(state.blockedUntil > Date.now()))
    for (const local of locals) {
      let record,
        errorText = '候选商品未得到精确番号匹配'
      const observations = []
      for (const id of candidates(local.code)) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        let response, data
        try {
          report.requests++
          response = await fetch('https://api.video.dmm.co.jp/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://video.dmm.co.jp',
              Referer: 'https://video.dmm.co.jp/'
            },
            body: JSON.stringify({ query, variables: { id } }),
            signal: AbortSignal.timeout(15000)
          })
          if (response.status === 403 || response.status === 429) {
            state.blockedUntil = Date.now() + 86400000
            throw Error('HTTP ' + response.status + '，停止本轮FANZA请求')
          }
          if (!response.ok) throw Error('HTTP ' + response.status)
          data = await response.json()
          if (data.errors) throw Error('GraphQL返回错误，接口可能变化')
          const movie = data.data?.ppvContent
          const observation = {
            candidateId: id,
            returnedId: movie?.id ?? null,
            returnedCode: movie?.makerContentId ?? null
          }
          observations.push(observation)
          if (movie) {
            try {
              record = checkedRecord(local, movie, id, Date.now())
            } catch (error) {
              errorText = error.message
              observation.rejected = error.message
              // 当前候选身份不符不代表下一个候选也不符；继续，但每部仍最多两个请求。
            }
          }
        } catch (error) {
          errorText = error.message
          break
        }
        if (record) break
      }
      // 文件错误不属于来源失败，必须交给最外层非零退出，不能吞掉。
      if (record) writeJson(path.join(out, 'records', local.id + '.json'), record)
      state.tasks[local.id] = {
        status: record ? 'success' : 'unavailable',
        checkedAt: Date.now(),
        observations,
        nextRetryAt: record ? 0 : Date.now() + 7 * 86400000
      }
      report.results.push({
        id: local.id,
        code: local.code,
        status: state.tasks[local.id].status,
        observations,
        ...(record ? {} : { error: errorText })
      })
      writeJson(stateFile, state)
      if (state.blockedUntil > Date.now()) break
    }
  report.finishedAt = Date.now()
  writeJson(path.join(out, 'report.json'), report)
  console.log(JSON.stringify(report, null, 2))
  if (report.results.some(row => row.status !== 'success')) process.exitCode = 2
}
run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
