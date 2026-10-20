/**
 * @file 人工复核工具：仅检查无码出演名单中 gender 不为 f 且含 id 的人物。
 * 用法：node tools/verify-uc-gender.js <输入 JSON> <输出 JSON> [worker 数]。
 * worker 数默认 4；现有代码仅转为数字，不校验正整数或范围。
 * WEB_PROXY 指定可选代理；curl 同步执行，worker 数不是实际网络并发数。
 * 复核规则同 verify-gender-local：无 section-meta 则保留旧值，有“男優”判 m，否则判 f。
 * 成功更新逐条 gender 与 genderSource；男女数量仅输出日志，不写根级汇总。
 * 输出直接覆盖指定文件，不创建父目录，不备份；可通过另一个输出路径保留原文件。
 *
 * 维护边界：本轮仅整理格式与注释，已知行为限制不在此处修复。
 */

/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 复核 uncensored_actresses.json 里被判为男优/未知的条目（只问这些，省请求）。
 * 用法：node verify-uc-gender.js <输入> <输出> [并发]
 */
const fs = require('fs')
const { execSync } = require('child_process')
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const PROXY = process.env.WEB_PROXY || ''

/**
 * 同步调用 curl 复核人物页；无标签/请求失败返回 null，供调用方保留旧值。
 * 有标签时，任一包含“男優”返回 m，否则返回 f；不做页面身份的额外校验。
 * @param {string} id JavDB 人物 ID。
 * @returns {string|null} m、f 或 null。
 */
function webGender(id) {
  const cmd = `curl -s --max-time 25 ${PROXY ? '-x ' + PROXY + ' ' : ''}-A "${UA}" "https://javdb.com/actors/${id}"`
  let h = ''
  try {
    const env = { ...process.env }
    ;['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'].forEach(
      k => delete env[k]
    )
    h = execSync(cmd, {
      encoding: 'utf8',
      timeout: 30000,
      env,
      stdio: ['ignore', 'pipe', 'ignore']
    })
  } catch (_) {
    return null
  }
  const metas = [...String(h).matchAll(/section-meta">([^<]+)</g)].map(x => x[1])
  if (!metas.length) return null
  return metas.some(t => /男優/.test(t)) ? 'm' : 'f'
}
;(async () => {
  // 阶段 1：只选择非 f 记录；已有女性记录不会在此工具中被纠正为男性。
  const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const list = d.list || []
  const targets = list.filter(a => a && a.id && a.gender !== 'f')
  const CONC = +(process.argv[4] || 4)
  console.log('待复核（非女优）' + targets.length + ' / 共 ' + list.length + '，并发 ' + CONC)
  // 阶段 2：同步命令逐个完成；逻辑 worker 数不代表同时打开的 curl 数量。
  const slots = new Array(targets.length).fill(null)
  let done = 0,
    ok = 0,
    bad = 0
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (true) {
        const i = done++
        if (i >= targets.length) break
        const g = webGender(targets[i].id)
        slots[i] = g
        if (g) ok++
        else bad++
        if (i % 25 === 0) console.log('  ' + i + '/' + targets.length)
      }
    })
  )
  // 阶段 3：仅把非空复核结果写回，日志统计不写入根级 female/male。
  let changed = 0
  targets.forEach((a, i) => {
    const g = slots[i]
    if (!g) return
    if (g !== a.gender) {
      console.log('  ' + a.name + '：' + a.gender + ' → ' + g)
      changed++
    }
    a.gender = g
    a.genderSource = 'javdb-web-section-meta'
  })
  const f = list.filter(a => a.gender === 'f').length
  console.log(
    '复核成功 ' +
      ok +
      ' · 取不到 ' +
      bad +
      ' · 纠正 ' +
      changed +
      ' → 女优 ' +
      f +
      ' · 男优 ' +
      list.filter(a => a.gender === 'm').length
  )
  fs.writeFileSync(process.argv[3], JSON.stringify(d))
})()
