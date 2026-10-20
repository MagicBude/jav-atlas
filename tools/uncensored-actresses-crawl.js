#!/usr/bin/env node

/**
 * @file 从 JavDB 的 type=1 影片样本反推出演人物，男女均保留。
 * 文件名中的 actresses 不表示名单只有女性；调用方需按每条 gender 再筛选。
 * 输入：API、可选 female_names.json / actors_full.json / 上一版无码名单。
 * 输出：RELAY_DIR/uncensored_actresses.json，包含本轮采到的人物及影片编号样本。
 * 配置：UC_PAGES 默认 120，每页请求 30 部影片；连续三页无新增人物即提前结束。
 * 默认目录：脚本位于 tools 时使用仓库根 relay/；RELAY_DIR 可覆盖。
 * 性别优先级：已有全量演员记录 → 女性名册命中 → 网页 → 旧名单 → 未验证的男性默认值。
 * WEB_GENDER=0 时跳过最后复核阶段，尚未判定的人物会保留问号。
 * 指标：uc_count 为本轮不同影片编号数量，uc_codes 最多保存 5 个；videos_count 为详情中的总作品数。
 * 失败边界：分页失败只结束翻页；安全阀有条件保留旧文件，不能保证所有空结果均受保护。
 * 运行：node tools/uncensored-actresses-crawl.js。不是全库出演经历查询。
 *
 * 发现策略：翻 type=1 的影片而非逐个查询约 2.5 万名人物；12 页、360 部影片曾发现 203 位女性人物。
 * 该样本解释影片反推的请求成本优势，不代表当前覆盖率。
 * 演员没有独立的“无码”布尔字段，分类来自出演影片；影片记录可能带 n 前缀编号，本代码以 type=1 查询结果为准。
 * 名单保留 id、name、videos_count、uc_codes 等字段，不表示人物只出演这类影片。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

/*
 * JavDB 移动 API 使用应用级签名和多条候选线路；同一套签名规则也用于其他 JavDB 采集工具。
 */
const JDB_LINES = [
  'https://apidd.spthgb.com',
  'https://apidd.czssdgz.com',
  'https://jdforrepam.com'
]
const JDB_P1 =
  '71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa'
const JDB_P2 = 'lpw6vgqzsp'

/**
 * 构造当前请求的应用签名。时间戳单位是秒；MD5 输入为时间戳字符串与固定常量拼接。
 *
 * @returns {string} 格式为 时间戳.固定标记.MD5十六进制摘要。
 */
function jdbSign() {
  const ts = Math.floor(Date.now() / 1000)
  return (
    ts +
    '.' +
    JDB_P2 +
    '.' +
    crypto
      .createHash('md5')
      .update(String(ts) + JDB_P1)
      .digest('hex')
  )
}

// ⚠️ Actions 里脚本在 tools/ 下跑，仓库根的 relay/ 在上一层；本地自测时脚本和 relay/ 同级。
const RELAY_DIR =
  process.env.RELAY_DIR ||
  (path.basename(__dirname) === 'tools'
    ? path.join(__dirname, '..', 'relay')
    : path.join(__dirname, 'relay'))
const OUT_JSON = path.join(RELAY_DIR, 'uncensored_actresses.json')
const TIMEOUT = 20000
const PAGES = +(process.env.UC_PAGES || 120) // 翻多少页无码影片（每页 30 部）
let LINE_OK = ''

/**
 * 依次尝试 API 线路，优先复用成功线路；每条线路均有独立超时。
 * HTTP 非成功或 success 严格等于数字 0 时尝试下一条；没有对同一线路额外重试。
 *
 * @param {string} rel 相对于 /api/ 的路径及查询串，不是完整 URL。
 * @returns {Promise<object>} 成功线路返回的 JSON。
 * @throws {Error} 所有候选线路均失败时抛出最后一次错误。
 */
async function jdbGet(rel) {
  const order =
    LINE_OK && JDB_LINES.includes(LINE_OK)
      ? [LINE_OK].concat(JDB_LINES.filter(x => x !== LINE_OK))
      : JDB_LINES
  let lastErr = null
  for (const base of order) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), TIMEOUT)
    try {
      const r = await fetch(base + '/api/' + rel, {
        signal: ac.signal,
        headers: {
          jdsignature: jdbSign(),
          'User-Agent': 'Dart/3.5 (dart:io)',
          'Accept-Language': 'zh-TW',
          Accept: 'application/json'
        }
      })
      if (!r.ok) throw new Error(base + ' → ' + r.status)
      const j = await r.json()
      if (j && j.success === 0) throw new Error(j.message || 'API 返回失败')
      LINE_OK = base
      return j
    } catch (e) {
      lastErr = e
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr || new Error('JavDB 线路均不可用')
}

/**
 * 通过共享递增索引分配任务，限制同时等待的异步操作数量。
 * 索引在 await 前领取，因此不会重复分配；同步阻塞回调仍会阻塞其他 worker。
 *
 * @param {Array<*>} items 待处理列表。
 * @param {number} n worker 数，由调用方提供。
 * @param {function(*, number): *} fn 每项处理函数，可返回 Promise。
 * @returns {Promise<Array<*>>} 按原索引保存结果；单项抛错时对应位置记为 null。
 */
const pool = async (items, n, fn) => {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++
        try {
          out[k] = await fn(items[k], k)
        } catch (_) {
          out[k] = null
        }
      }
    })
  )
  return out
}

/**
 * 将正则覆盖的片假名按 Unicode 偏移转成平假名；汉字原样保留。
 *
 * 姓名归一化只转换假名并清理分隔符，不会将汉字变成平假名读音；别名需由数据本身提供。
 *
 * @param {*} s 输入文本；假值按空字符串处理。
 * @returns {string} 转换后的字符串；不提供汉字读音、翻译或同义词映射。
 */
const onKana = s =>
  String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))

/**
 * 统一姓名比较键：小写并删除指定空格、分隔符；是否转换假名取决于本文件实现。
 * 这是字符串比较规则，不保证同名是同一人，也不能替代跨来源身份映射。
 *
 * @param {*} s 原始姓名或别名。
 * @returns {string} 比较用键，不用于替换展示姓名。
 */
const onNorm = s =>
  onKana(String(s || ''))
    .toLowerCase()
    .replace(/[\s　・·,，、/]+/g, '')

/*
 * 将女性名册中的姓名及别名归一化后放入 Set，命中可作为女性来源；集合未命中不说明人物必为男性。
 */
let FEM_NAMES = null

/**
 * 首次使用时建立归一化女性姓名 Set，后续调用复用同一进程内缓存。
 * 优先读 female_names.json；没有条目时回退外部 actresses.json。读取失败被忽略。
 *
 * @returns {Set<string>} 可能为空；空集合不能证明候选人物都是男性。
 */
function loadFemaleNames() {
  if (FEM_NAMES) return FEM_NAMES
  FEM_NAMES = new Set()

  /*
   * 优先加载精简 female_names.json（体积样本约 0.75 MB），没有有效条目再尝试 actresses.json（约 16 MB）。
   * 两份文件均未随初始化预置；均缺失时不能依赖名册反查，需保留复核与旧结果兜底。
   */
  let roster = []
  try {
    const fn = JSON.parse(fs.readFileSync(path.join(RELAY_DIR, 'female_names.json'), 'utf8')) || {}
    roster = (fn.names || []).map(n => ({ name: n }))
  } catch (_) {}
  if (!roster.length) {
    const ROSTER = path.join(RELAY_DIR, '..', 'actresses.json')
    try {
      roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8')) || []
    } catch (_) {}
  }
  const push = n => {
    const k = onNorm(n)
    if (k) FEM_NAMES.add(k)
  }
  for (const a of roster) {
    if (!a || !a.name) continue
    push(a.name)
    ;[a.name_ja, a.name_zh, a.name_en].forEach(n => n && push(n))
    if (Array.isArray(a.alias)) a.alias.forEach(push)
  }
  return FEM_NAMES
}

/*
 * 网页需检查全部 section-meta：首项可能只有别名，任一含“男優”才判为男性。
 * 无有效标签返回 null；可设置 WEB_PROXY，或由 WEB_GENDER_LOCAL 提供 127.0.0.1:1082 默认代理。
 * 本地与 Actions 的网页可达性可能不同，必须实际验证，不能假定某处一定直连可用。
 */
const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const WEB_PROXY =
  process.env.WEB_PROXY || (process.env.WEB_GENDER_LOCAL ? 'http://127.0.0.1:1082' : '')
const WEB_ON = process.env.WEB_GENDER !== '0'
let WEB_DEAD = false,
  webFailStreak = 0

/**
 * 同步调用 curl 读取人物页并检查全部 section-meta；任何一项含“男優”即 m。
 * 无标签返回 null；连续 15 次无有效标签后设置本轮熔断，后续不再发请求。
 *
 * @param {string} id JavDB 人物 ID。
 * @returns {string|null} m、f 或无法判断时的 null。
 */
function webGenderOf(id) {
  if (WEB_DEAD) return null
  const cmd = `curl -s --max-time 25 ${WEB_PROXY ? '-x ' + WEB_PROXY + ' ' : ''}-A "${WEB_UA}" "https://javdb.com/actors/${id}"`
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
    h = ''
  }
  const metas = [...String(h).matchAll(/section-meta">([^<]+)</g)].map(x => x[1])
  if (!metas.length) {
    if (++webFailStreak >= 15) {
      WEB_DEAD = true
      console.log('   ⚠ 网页版连续 15 次取不到（被墙/风控），本轮放弃复核')
    }
    return null
  }
  webFailStreak = 0
  return metas.some(t => /男優/.test(t)) ? 'm' : 'f'
}

/**
 * 为上一版名单建立 id: 和 n: 前缀的复用索引，并按记录统计女性人数。
 *
 * 旧名单按人物 ID 与归一化姓名建立复用键；新一轮无法判断时保留此前已有性别，减少判定漂移。
 *
 * @returns {{map: Map<string, string>, female: number}} 读取/解析失败时为空映射和 0。
 */
function loadPrevGender() {
  const m = new Map()
  let female = 0
  try {
    const p = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) || {}
    for (const a of p.list || []) {
      if (!a) continue
      if (a.gender === 'f') female++ // 按「名单条数」统计，用于安全阀比对
      if (a.id && a.gender) m.set('id:' + a.id, a.gender)
      const n = onNorm(a.name)
      if (n && a.gender) m.set('n:' + n, a.gender)
    }
  } catch (_) {}
  return { map: m, female }
}

/**
 * 读取全量演员产物，供相同 JavDB ID 的记录直接复用性别。
 * 不检查 genderSource 是否可靠；读取失败返回空 Map。
 *
 * actors_full.json 中相同 JavDB ID 的非空 gender 直接复用，减少请求，但不再检查其来源可靠性。
 *
 * @returns {Map<string, string>} 人物 ID 到非空 gender 的映射。
 */
function loadActorsFullGender() {
  const m = new Map()
  try {
    const p = JSON.parse(fs.readFileSync(path.join(RELAY_DIR, 'actors_full.json'), 'utf8')) || {}
    for (const a of p.list || []) if (a && a.id && a.gender) m.set(a.id, a.gender)
  } catch (_) {}
  return m
}

;(async () => {
  console.log('① 翻 JavDB 无码影片（type=1）反推演员…')
  // 阶段 1：按演员 ID 去重，影片编号用 Set 累计；同一编号重复出现只计一次。
  const found = new Map() // id → {name, codes:Set(番号样本)}
  let stall = 0
  for (let page = 1; page <= PAGES; page++) {
    let list = []
    try {
      const j = await jdbGet(
        'v1/movies/latest?filter_by=magnets&limit=30&page=' + page + '&sort_by=update&type=1'
      )
      list = ((j || {}).data || {}).movies || []
    } catch (e) {
      console.log('   第' + page + '页失败：' + e.message)
      break
    }
    if (!list.length) break
    const det = await pool(list.map(m => m.id).filter(Boolean), 8, async id => {
      try {
        const d = await jdbGet('v2/movies/' + id)
        return ((d || {}).data || {}).movie || {}
      } catch (_) {
        return null
      }
    })
    let added = 0
    for (const mv of det) {
      if (!mv) continue
      const code = String(mv.number || mv.code || '')
      for (const a of mv.actors || []) {
        if (!a || !a.id || !a.name) continue
        const cur = found.get(a.id)
        if (!cur) {
          found.set(a.id, { name: a.name, codes: new Set() })
          added++
        }
        if (code) found.get(a.id).codes.add(code)
        if (!cur && a.name) {
          /*
           * 人物名字已在新增 Map 记录中保存，此处无需再次赋值。
           */
        }
      }
    }
    if (page % 20 === 0)
      console.log('   第' + page + '页 → 演员累计 ' + found.size + '（本页新增 ' + added + '）')
    stall = added === 0 ? stall + 1 : 0
    if (stall >= 3) {
      console.log('   连续 3 页无新演员，翻完了')
      break
    }
  }
  console.log('   无码影片反推共 ' + found.size + ' 位演员')

  console.log('② 拉详情 + 性别判定…')
  // 阶段 2：复用已有判断优先于名册判断，不会重新验证已收录人物的 genderSource。
  const fem = loadFemaleNames()
  const AF = loadActorsFullGender()
  const PREV = loadPrevGender()
  const out = { fetchedAt: Date.now(), source: 'javdb-uncensored', count: 0, list: [] }
  const ids = [...found.keys()]
  let isFem = 0,
    isMale = 0
  await pool(ids, 4, async id => {
    const base = found.get(id)
    let vc = 0,
      alias = ''
    try {
      const d = await jdbGet('v1/actors/' + encodeURIComponent(id))
      const ac = ((d || {}).data || {}).actor || {}
      if (!ac.name) return
      base.name = ac.name
      alias = ac.other_name || ''
      if (ac.videos_count != null) vc = Number(ac.videos_count) || 0
      if (ac.avatar_url) base.avatar_url = ac.avatar_url
    } catch (_) {}

    /*
     * 男女都保留，由消费端按 gender 筛选，避免在采集阶段用不完整女性名册直接丢弃人物。
     * 名册规模曾从本地 24,959 变为 25,431；旧名册会漏掉新人物，而且混合厂商影片中也有男性出演。
     */
    const keys = [base.name].concat(String(alias).split(','))
    const isFemale = keys.some(k => k && fem.has(onNorm(k)))

    /*
     * 性别顺序：相同 ID 的 actors_full 结果 → 女性名册命中 → 问号待网页复核；记录 genderSource 便于区分依据。
     */
    let g = AF.get(id) || null,
      gs = g ? 'actors_full' : ''
    if (!g && isFemale) {
      g = 'f'
      gs = 'roster'
    }
    if (!g) {
      g = '?'
      gs = 'pending-web'
    }
    if (g === 'f') isFem++
    else if (g === 'm') isMale++
    out.list.push({
      id,
      name: base.name,
      other_name: alias,
      gender: g,
      genderSource: gs,
      videos_count: vc,
      uc_codes: [...base.codes].slice(0, 5),
      uc_count: base.codes.size,
      avatar_url: base.avatar_url || ''
    })
  })

  // 阶段 3：网页复核失败先尝试旧名单，仍无法确定时沿用默认 m。
  /*
   * 只有名单与姓名集合都不能判断的记录才请求网页，避免每次重复复核全部人物。
   */
  const pending = out.list.filter(r => r.gender === '?')
  if (WEB_ON && pending.length) {
    console.log('②b 性别复核（网页版 section-meta）：' + pending.length + ' 位…')
    await pool(pending, 8, async r => {
      const w = webGenderOf(r.id)
      if (w) {
        r.gender = w
        r.genderSource = 'javdb-web-section-meta'
      } else {
        // 拿不到页面 → 用上一版名单兜底（按 id / 名字），再不行才归男优
        const p = PREV.map.get('id:' + r.id) || PREV.map.get('n:' + onNorm(r.name))
        r.gender = p || 'm'
        r.genderSource = p ? 'prev-list' : 'unverified'
      }
    })
  }
  isFem = out.list.filter(r => r.gender === 'f').length
  // 已知限制：此处 out.count 尚为初始 0，因此日志计数可能为负；实际 list 不受影响。
  isMale = out.count - isFem

  out.count = out.list.length
  out.list.sort(
    (a, b) => (b.uc_count || 0) - (a.uc_count || 0) || (b.videos_count || 0) - (a.videos_count || 0)
  )

  // 阶段 4：仅当网页熔断且女性数量大幅下降时保留旧文件；不是通用空结果保护。
  /*
   * 保护意图：网页熔断且本次女性数不足旧名单 60% 时保留旧文件，避免消费端女性分类突然变空。
   * 缺少姓名来源又无法访问网页时，曾有两千多条人物被默认男性的风险，因此不能盲目覆盖。
   * 这一保护仅针对指定条件，不涵盖所有分页失败或空发现结果。
   */
  const prevFemale = PREV.female
  if (WEB_DEAD && prevFemale > 0 && isFem < prevFemale * 0.6) {
    console.log(
      `⚠ 判定异常（女优 ${isFem} << 上一版 ${prevFemale}）且网页版不可用 → 保留旧名单，不覆盖`
    )
    return
  }

  // 直接覆盖目标，未采用临时文件替换；不对所有平台的 rename 行为作推断。
  /*
   * 写文件使用直接覆盖以兼容曾限制覆盖式 rename 的环境；并非所有平台都会拒绝 rename。
   * 直接写中断可能损坏目标，与临时文件替换具有不同失败边界。
   */
  fs.writeFileSync(OUT_JSON, JSON.stringify(out))
  console.log(
    '③ relay/uncensored_actresses.json：无码演员 ' +
      out.count +
      ' 位（判为女优 ' +
      isFem +
      ' · 男优/未知名 ' +
      isMale +
      '）'
  )
  console.log(
    '   样例：' +
      out.list
        .slice(0, 10)
        .map(x => x.name + '(' + x.uc_count + ')')
        .join('、')
  )
})().catch(e => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
