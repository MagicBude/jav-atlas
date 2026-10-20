/**
 * @file 人工修复工具：只复核输入 list 中 gender=m 的人物，并把判为女性的记录改为 f。
 * 用法：node tools/fix-gender-by-web.js <输入 JSON> <输出 JSON>。
 * 环境：GENDER_PROXY 指定 curl 代理，默认 http://127.0.0.1:1082；依赖系统 curl。
 * 规则：检查全部 section-meta，任一含“男優”则为男性；否则当作女性。
 * 重要差异：本工具仅将空响应视作失败，非空拦截页若没有 section-meta 仍会被当作女性。
 * 会刷新根级 female / male / genderSource，但不会逐条更新 genderSource。
 * 外层虽然创建 8 个 async worker，内部 execSync 仍阻塞执行，不是真正并行请求。
 * 输出路径可以与输入相同；写入为直接覆盖，运行前应了解该副作用。
 *
 * 维护边界：本轮仅整理格式与注释，已知行为限制不在此处修复。
 */

const fs = require('fs')
const { execSync } = require('child_process')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const CLEAN = { ...process.env }
;[
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'PROXY',
  'ALL_PROXY',
  'all_proxy'
].forEach(k => delete CLEAN[k])
const PROXY = process.env.GENDER_PROXY || 'http://127.0.0.1:1082' // 上游使用的代理默认值；实际可达性需要运行验证。

/**
 * 通过系统 curl 和指定代理同步获取人物页。清除常见代理环境变量后使用显式 -x。
 * curl 未使用 -f，HTTP 错误页也可能成为非空正文；调用方必须理解该失败边界。
 * @param {string} id JavDB 人物 ID，直接用于构造 URL。
 * @returns {string} 页面正文；命令失败时返回空字符串。
 */
function fetchHtml(id) {
  try {
    return execSync(
      `curl -s --max-time 25 -x ${PROXY} -A "${UA}" "https://javdb.com/actors/${id}"`,
      { encoding: 'utf8', timeout: 30000, env: CLEAN }
    )
  } catch (e) {
    return ''
  }
}

;(async () => {
  // 阶段 1：读取指定输入；参数缺失、JSON 损坏和输出失败均不在本工具内兜底。
  const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const suspects = d.list.filter(a => a.gender === 'm')
  console.log('待判定（原标男优）:', suspects.length)

  // 8 个逻辑 worker；同步 curl 会阻塞事件循环，网络请求实际串行。
  // 阶段 2：slots 保留目标顺序；空正文算失败，非空无标签正文仍被现有规则归为女性。
  const realMale = [],
    realFemale = [],
    fail = []
  const slots = new Array(suspects.length).fill(null)
  let done = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (true) {
        const i = done++
        if (i >= suspects.length) break
        const a = suspects[i]
        const h = fetchHtml(a.id)
        if (!h) {
          slots[i] = { a, bad: true }
          continue
        }
        // ⚠️ 必须 matchAll：section-meta 有多个（别名标签 + 「男優, N 部影片」），
        // 只取第一个会拿到别名（不含「男優」）→ 把鮫島/黒田悠斗这类真男优误判成女优。
        const metas = [...h.matchAll(/section-meta">([^<]+)</g)].map(x => x[1])
        slots[i] = { a, male: metas.some(t => /男優/.test(t)) }
        if (i % 40 === 0) console.log('  ' + i + '/' + suspects.length)
      }
    })
  )
  for (const s of slots) {
    if (!s) continue
    if (s.bad) fail.push(s.a.name)
    else if (s.male) realMale.push(s.a)
    else realFemale.push(s.a)
  }
  console.log(
    '  → 男优 ' + realMale.length + ' · 女优 ' + realFemale.length + ' · 失败 ' + fail.length
  )
  console.log(
    '\n真男优样例:',
    realMale
      .slice(0, 10)
      .map(a => a.name)
      .join('、')
  )
  console.log(
    '被纠正的女优:',
    realFemale
      .slice(0, 16)
      .map(a => a.name)
      .join('、')
  )

  // 写回：纠正 gender
  // 阶段 3：只把复核为女性的男性记录改为 f；失败及仍为男性的记录保持原值。
  const byId = new Map(realFemale.map(a => [a.id, 'f']))
  let changed = 0
  for (const a of d.list) {
    if (a.gender === 'm' && byId.get(a.id) === 'f') {
      a.gender = 'f'
      changed++
    }
  }
  d.female = d.list.filter(a => a.gender === 'f').length
  d.male = d.list.filter(a => a.gender === 'm').length
  d.genderSource = 'javdb-web-section-meta'
  fs.writeFileSync(process.argv[3], JSON.stringify(d))
  console.log('\n已纠正 ' + changed + ' 位 → 女优 ' + d.female + ' · 男优 ' + d.male)
  if (fail.length) console.log('失败名单（保留原判）:', fail.slice(0, 10).join('、'))
})()
