/**
 * @file 本地批量复核 JavDB 未知性别：两个集合按原始 ID 去重，复用已保存的网页依据。
 * 用法：WEB_PROXY 配置本机代理后，node tools/verify-genders.js [--limit 数量] [--ids ID,ID]。
 * 默认 2 个真正并发的 curl 请求，20 秒超时；连续 15 次网络失败暂停，成功依据即时保存。
 * 仅取得含作品数或男性标签的 section-meta 才确认；失败保留原值，不依据姓名或外貌推测。
 * 人工来源记录不覆盖。代理只来自环境变量，不把本机地址写入公开仓库。
 */
const fs = require('fs')
const { execFile } = require('child_process')
const { promisify } = require('util')
const { dataPaths } = require('./lib/data-paths')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { parseGenderEvidence, saveGenderEvidence } = require('./lib/gender-evidence')
const execute = promisify(execFile)
const paths = dataPaths()
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i += 2) {
  if (
    !['--limit', '--ids', '--report'].includes(args[i]) ||
    !args[i + 1] ||
    args[i + 1].startsWith('--')
  ) {
    throw new Error('用法：verify-genders.js [--limit 正整数] [--ids ID,ID] [--report 路径]')
  }
}
const argument = key => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
const reportFile = argument('--report')
const rawLimit = argument('--limit')
if (rawLimit !== undefined && !/^[1-9]\d*$/.test(rawLimit)) throw new Error('--limit 必须为正整数')
const limit = rawLimit ? Number(rawLimit) : Infinity
const selected = argument('--ids')?.split(',')
if (selected?.some(id => !/^[A-Za-z0-9]+$/.test(id))) throw new Error('--ids 包含非法 JavDB ID')
const concurrency = envInt('GENDER_CONCURRENCY', 2, 1, 4)
const proxy = process.env.WEB_PROXY || ''
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^(https?|all)_proxy$/i.test(key)) delete env[key]
const files = [paths.javdbActors, paths.javdbUncensoredActors]
const manual = row => /manual|人工/i.test(row.genderSource || '')

/** 通过参数数组启动 curl，拒绝登录跳转；只返回可判定的标签。 */
async function fetchEvidence(id) {
  if (!/^[A-Za-z0-9]+$/.test(id)) throw new Error('非法 JavDB ID')
  const options = [
    '-fsSL',
    '--connect-timeout',
    '8',
    '--max-time',
    '20',
    '-A',
    'Mozilla/5.0',
    '-w',
    '\nEFFECTIVE_URL:%{url_effective}'
  ]
  if (proxy) options.push('--proxy', proxy)
  options.push(`https://javdb.com/actors/${id}`)
  let stdout
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      ;({ stdout } = await execute(process.platform === 'win32' ? 'curl.exe' : 'curl', options, {
        env,
        timeout: 25000,
        maxBuffer: 4 * 1024 * 1024
      }))
      break
    } catch (error) {
      if (error.code === 22 && /\b(?:404|410)\b/.test(String(error.stderr || ''))) {
        throw Object.assign(new Error('人物页不存在或已移除'), { code: 'PAGE_UNAVAILABLE' })
      }
      // 本机 curl 的偶发 TLS 握手失败（35）只重试一次，不关闭证书校验。
      if (attempt || error.code !== 35) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
  const actual = stdout.match(/EFFECTIVE_URL:(\S+)/)?.[1]
  if (!actual || new URL(actual).pathname !== '/actors/' + id)
    throw Object.assign(
      new Error(
        actual && new URL(actual).pathname === '/login' ? '人物页要求登录' : '请求未到达指定人物页'
      ),
      { code: 'PAGE_UNAVAILABLE' }
    )
  const evidence = parseGenderEvidence(stdout)
  if (!evidence) throw Object.assign(new Error('缺少有效人物标签'), { code: 'PAGE_UNAVAILABLE' })
  return evidence
}

/** 将已保存依据同步至两个集合，仅更改性别、来源与统计；人工确认保留。 */
function applyEvidence() {
  const records = readJson(paths.javdbWebGenders, { records: {} }).records
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    const data = readJson(file)
    if (!Array.isArray(data.list)) throw new Error('人物列表结构错误：' + file)
    let changed = false
    for (const row of data.list) {
      if (!manual(row) && records[row.id]) {
        const record = records[row.id]
        if (row.gender !== record.gender || row.genderSource !== 'javdb-web-section-meta')
          changed = true
        row.gender = record.gender
        row.genderSource = 'javdb-web-section-meta'
      }
    }
    if (changed) {
      data.female = data.list.filter(row => row.gender === 'f').length
      data.male = data.list.filter(row => row.gender === 'm').length
      data.unknown = data.list.filter(row => !['f', 'm'].includes(row.gender)).length
      writeJson(file, data)
    }
  }
}

;(async () => {
  const records = readJson(paths.javdbWebGenders, { records: {} }).records
  const candidates = new Map()
  for (const file of files)
    for (const row of readJson(file, { list: [] }).list) {
      if (
        row.id &&
        !manual(row) &&
        (selected ? selected.includes(row.id) : !['f', 'm'].includes(row.gender)) &&
        !records[row.id]
      )
        candidates.set(String(row.id), row)
    }
  const targets = [...candidates.values()].slice(0, limit)
  console.log(
    '按 ID 去重待复核：' +
      targets.length +
      '；已有依据 ' +
      Object.keys(records).length +
      '；并发 ' +
      concurrency
  )
  const failures = reportFile ? readJson(reportFile, { failures: {} }).failures : {}
  for (const id of Object.keys(records)) delete failures[id]
  const report = () => {
    if (reportFile)
      writeJson(reportFile, {
        updatedAt: new Date().toISOString(),
        attempted: ok + failed,
        successful: ok,
        failures
      })
  }
  let next = 0,
    ok = 0,
    failed = 0,
    streak = 0,
    paused = false
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (!paused && next < targets.length) {
        const row = targets[next++]
        try {
          const evidence = await fetchEvidence(row.id)
          saveGenderEvidence(paths.javdbWebGenders, row.id, evidence)
          delete failures[row.id]
          ok++
          streak = 0
          if (selected) console.log(JSON.stringify({ id: row.id, name: row.name, ...evidence }))
        } catch (error) {
          failed++
          failures[row.id] = {
            name: row.name,
            reason:
              error.code === 'PAGE_UNAVAILABLE'
                ? error.message === '人物页要求登录'
                  ? 'login-required'
                  : 'page-unavailable'
                : 'network-error'
          }
          // 登录页和缺标签是单个人物无法确认，不表示网络整体不可达。
          streak = error.code === 'PAGE_UNAVAILABLE' ? 0 : streak + 1
          if (/\b429\b/.test(String(error.stderr || ''))) {
            paused = true
            console.error('源站限流，停止发起新请求；已有结果保留。')
          }
          if (failed <= 5)
            console.log(
              '未确认 ' +
                row.id +
                '：' +
                (error.killed
                  ? '请求超时'
                  : String(error.stderr || error.message)
                      .trim()
                      .split('\n')[0]
                      .replace(/--proxy\s+\S+/g, '--proxy [hidden]')
                      .slice(0, 140))
            )
          if (streak >= 15) paused = true
        }
        if ((ok + failed) % 20 === 0) {
          applyEvidence()
          report()
          console.log(
            '进度 ' + (ok + failed) + '/' + targets.length + ' · 成功 ' + ok + ' · 失败 ' + failed
          )
        }
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    })
  )
  applyEvidence()
  report()
  console.log(
    '复核结束：成功 ' + ok + ' · 失败 ' + failed + ' · 未尝试 ' + (targets.length - ok - failed)
  )
  if (paused) {
    console.error('已暂停；成功依据已保存，可在网络恢复后重新运行续抓。')
    process.exitCode = 1
  }
})().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
