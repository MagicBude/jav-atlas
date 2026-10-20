/**
 * @file 人工复核工具：处理尚未标记 javdb-web-section-meta 的人物，不限于男性。
 * 用法：node tools/verify-gender-local.js <输入 JSON> <输出 JSON>。
 * 环境：WEB_PROXY 非空才向 curl 传代理；显式清除常见代理环境变量。
 * 规则：有 section-meta 且含“男優”判 m；有标签但不含该词判 f；无标签/请求失败返回 null。
 * 失败保留旧值；成功更新逐条 gender、genderSource，以及根级 female / male。
 * 8 个 async worker 只分配索引，execSync 阻塞使网络复核依次完成。
 * 网络可达性依赖当前环境，不保证家庭宽带、Actions 或代理一定可用。
 * 输出为直接覆盖，没有自动备份；本次注释不改变既有错误处理。
 *
 * 维护边界：本轮仅整理格式与注释，已知行为限制不在此处修复。
 */

/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 本地复核 actors_full.json 里「性别不可信」的条目（网页版 section-meta，权威判据）。
 * 背景：GitHub Actions 里 javdb.com 被 Cloudflare 拦（403），名册又缺失 → 新增演员全被判男优。
 * 本地（家庭宽带）直连 javdb.com 200，可以逐个问。
 * 用法：node verify-gender-local.js <输入> <输出>
 * 补充说明：以上为上游特定环境的网络经验，不保证当前网络或 GitHub runner 仍具有相同可达性。
 */
const fs = require('fs')
const { execSync } = require('child_process')
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const PROXY = process.env.WEB_PROXY || '' // 可按当前网络环境设置 WEB_PROXY；留空不向 curl 传 -x。

/**
 * 同步调用 curl 复核人物页；无标签/请求失败返回 null，供调用方保留旧值。
 * 有标签时，任一包含“男優”返回 m，否则返回 f；不做页面身份的额外校验。
 * @param {string} id JavDB 人物 ID。
 * @returns {string|null} m、f 或 null。
 */
/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 本地一般直连即可；需要时 WEB_PROXY=http://127.0.0.1:1082
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
  // 阶段 1：从指定输入选择未获网页来源标记的人物；不会扫描名册中的其他人物。
  const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const list = d.list || []
  // 筛选所有来源标记不为网页复核的记录，不限于当前标为男性的记录。
  /*
   * 上游原注释（保留设计意图、历史故障与样本记录）：
   * 只问「还没被网页版判过」的：男优（可能混女优）+ 来源不是 javdb-web-section-meta 的
   */
  const targets = list.filter(a => a && a.id && a.genderSource !== 'javdb-web-section-meta')
  console.log('待复核 ' + targets.length + ' / 共 ' + list.length)
  // 阶段 2：slot 以原目标索引关联复核结果，防止回写到其他人物。
  const slots = new Array(targets.length).fill(null)
  let done = 0,
    ok = 0,
    bad = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (true) {
        const i = done++
        if (i >= targets.length) break
        const g = webGender(targets[i].id)
        slots[i] = g
        if (g) ok++
        else bad++
        if (i % 40 === 0) console.log('  ' + i + '/' + targets.length)
      }
    })
  )
  // 阶段 3：null 保留旧值；成功后写逐条来源，并重新统计根级男女数量。
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
  d.female = list.filter(a => a.gender === 'f').length
  d.male = list.filter(a => a.gender === 'm').length
  fs.writeFileSync(process.argv[3], JSON.stringify(d))
  console.log(
    '复核成功 ' +
      ok +
      ' · 取不到 ' +
      bad +
      ' · 纠正 ' +
      changed +
      ' → 女优 ' +
      d.female +
      ' · 男优 ' +
      d.male
  )
})()
