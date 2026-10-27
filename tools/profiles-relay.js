#!/usr/bin/env node

/**
 * @file 对已有 minnano 名册回填并复查资料；来源变化留历史，空值不清除旧资料。
 * 输入/输出：RELAY_DIR/minnano/actresses.json（默认仓库根 relay/）；仅处理包含 mnid 的记录，不发现新人物。
 * 字段：生日、身高、三围、别名、现用名、官网、标签、相关人物及图片 URL 等。
 * 参数：full（或 0）选取全部；默认选择 nick 或 official 至少一项缺失的记录。
 * 环境：ONLY 为逗号分隔的 mnid；它优先于 full，但仍受成功结果的 20 小时缓存过滤，并不强制刷新。
 * 缓存：<CACHE_DIR 或 .cache/profiles>/profiles-relay.json；成功和失败都记录 fetchedAt；失败记录下次立即重试。
 * 流程：读取名册及缓存 → 过滤候选 → 8 个 worker 解析/回填 → 每 200 条保存 → 结束再保存。
 * 限制：缓存读取失败视为空；缓存写入异常被忽略，名册读写异常由顶层捕获并非零退出。
 * 运行：node tools/profiles-relay.js [full]。网络可达性须在实际执行环境验证。
 *
 * 字段覆盖：愛称→nick、公式サイト→official、別名→alias、现用名→mcanon；
 * 同时补出生日期、身高、三围、罩杯、血型、出生地、爱好、出演期间、出道作品、事务所、博客、标签、相关人物及 mimg。
 * 2026-10-02 的解析记录发现 nick / official 漏项，以及“小倉七海 → 兒玉七海”这类改名缺 mcanon，影响现用名检索。
 * 全量样本约 2.5 万页、耗时约 1～2 小时；实际数量及速度取决于名册与源站。
 * 用法：node tools/profiles-relay.js full；增量省略参数；ONLY=698899,677238 可限制候选（此写法用于 POSIX shell）。
 * ONLY 仍受成功结果缓存过滤；缓存实际位于 <CACHE_DIR 或 .cache/profiles>/profiles-relay.json，每 200 条保存。
 * 网络记录包括家庭宽带 SNI 重置、代理 WAF 403 与 Actions 可访问等情况，不能据此保证只有某一种环境可用。
 * 本地缓存仅在同一文件系统存在时复用，工作流未配置跨 runner 持久化。
 */
const fs = require('fs')
const path = require('path')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const paths = dataPaths()

const MN_BASE = 'https://www.minnano-av.com/'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const ROSTER = paths.minnanoActresses
const TMP = path.resolve(process.env.CACHE_DIR || path.join(__dirname, '..', '.cache', 'profiles'))
const CACHE = path.join(TMP, 'profiles-relay.json')
const CONC = 8
/*
 * 每个 worker 的最小迭代时间为 150 ms，不是全局请求间隔。
 * 请求间隔约 0.55 秒的样本未触发限流，不能视作固定安全阈值。
 */
const DELAY = 150
// 缓存有效期 20 小时；成功记录受此寿命控制，失败允许下次重试。
const PROF_TTL = 20 * 3600 * 1000

const FULL = /^full$/i.test(process.argv[2] || '') || process.argv[2] === '0'
const ONLY = (process.env.ONLY || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

/**
 * 解码实现中列出的 HTML 实体，并去除首尾空白；不处理任意数字实体。
 *
 * @param {*} s 原始文本。
 * @returns {string} 解码后的字符串。
 */
const dec = s =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()

/**
 * 先移除标签，再解码实体并将连续空白压成一个空格。
 *
 * @param {*} s HTML 片段。
 * @returns {string} 便于比较和展示的纯文本。
 */
const strip = s =>
  dec(String(s || '').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()

/**
 * 作为 JSON.stringify 的 replacer，省略空字符串、null 和空数组。
 * 数值 0 和 false 保留；数组元素返回 undefined 时按 JSON 规则可能序列化为 null。
 *
 * @param {string} k JSON 属性名，当前实现未使用。
 * @param {*} v 属性值。
 * @returns {*} 原值或用于省略属性的 undefined。
 */
// 保存时保留名册已有的空值与空数组：它们也属于原记录，尤其不能影响本轮范围外的存档人物。

/**
 * 异步等待指定毫秒数；只暂停当前任务，不阻塞 Node 事件循环。
 *
 * @param {number} ms 等待时间，单位毫秒。
 * @returns {Promise<void>} 定时器触发后完成。
 */
const sleep = ms => new Promise(s => setTimeout(s, ms))

/**
 * 用于比较现用名：转换全角字符与指定假名区间、移除非白名单字符并小写。
 * 这里只做字符转换，不支持汉字读音转换；结果不替换原始展示姓名。
 *
 * 比较现用名时按全角→半角、指定片假名→平假名、删除符号的顺序转换，不依赖额外姓名映射。
 *
 * @param {*} s 姓名文本。
 * @returns {string} 比较用字符串。
 */
const cnorm = s =>
  String(s || '')
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[\u30A1-\u30F6\u31F0-\u31FF]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[^\u3040-\u30FF\u4E00-\u9FFF\u3400-\u4DBFa-z0-9]/gi, '')
    .toLowerCase()

/**
 * 抓取资料页，最多尝试 3 次：网络异常和 5xx 才继续重试。
 * 每次请求超时 25 秒，退避等待为 1500 × 尝试序号毫秒；其他 HTTP 状态立即返回空串。
 *
 * @param {string} url 资料页绝对 URL。
 * @returns {Promise<string>} 200 正文或失败时的空字符串。
 */
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, referer: MN_BASE, accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(25000)
      })
      if (r.status === 200) return await r.text()
      if (r.status >= 500) {
        await sleep(1500 * (i + 1))
        continue
      }
      return ''
    } catch (_) {
      await sleep(1500 * (i + 1))
    }
  }
  return ''
}

/**
 * 解析资料表格、标题、标签、相关人物和图片路径；不执行网络请求或落盘。
 * 同名表格字段保留首个非空值；别名单独收集。尺寸和日期按固定模式抽取，缺失为字符串空值。
 * 生日匹配时转 YYYY-MM-DD；未匹配的原文本不会得到严格日期校验。
 *
 * 资料页解析口径应与其他消费端的同类解析器保持一致，防止同一字段在同步与展示时含义不同；此仓库内没有另一份消费端解析器。
 *
 * @param {string} html 个人资料页 HTML。
 * @returns {object} canon、birthday、尺寸、简介、img、alias、tags 与 rel 等解析值。
 */
function parseProfilePage(html) {
  const kv = {}
  const alias = []
  // 原始字段独立保留：不因当前没有对应规范字段而丢弃，也保留重复标签和链接地址。
  const profileFields = []
  for (const m of html.matchAll(/<td[^>]*>\s*<span>([^<]+)<\/span>([\s\S]*?)<\/td>/g)) {
    const k = strip(m[1]),
      v = strip(m[2])
    if (!k || !v) continue
    const links = []
    for (const link of m[2].matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      try {
        const url = new URL(dec(link[1]), MN_BASE)
        if (['http:', 'https:'].includes(url.protocol))
          links.push({ text: strip(link[2]), url: url.href })
      } catch (_) {}
    }
    profileFields.push({ label: k, text: v, ...(links.length ? { links } : {}) })
    if (k === '別名') {
      alias.push(v.split('（')[0].split('(')[0].trim())
      continue
    }
    if (!kv[k]) kv[k] = v
  }
  const size = kv['サイズ'] || ''
  const cupRaw = (size.match(/([A-ZＡ-Ｚ])\s*カップ/) || [])[1] || ''
  const cup = cupRaw.replace(/[Ａ-Ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
  const birthday = (kv['生年月日'] || '')
    .replace(
      /(\d{4})年(\d{1,2})月(\d{1,2})日/,
      (_, y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    )
    .split(/[\s（(]/)[0]
  const canon = strip((html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || '')
    .split(/（|\(|AV女優/)[0]
    .trim()
  const tags = []
  const tagBlock =
    (html.match(/<span>タグ<\/span>[\s\S]*?<div class="tagarea">([\s\S]*?)<\/td>/) || [])[1] || ''
  for (const m of tagBlock.matchAll(/tag_a_id=(\d+)[^>]*>([\s\S]*?)<\/a>/g)) {
    const n = dec(m[2])
    if (n) tags.push([m[1], n])
  }
  const rel = []
  const ri = html.indexOf('をチェックした人が見ている女優')
  if (ri > -1) {
    const seg = html.slice(ri, ri + 6000)
    for (const m of seg.matchAll(/href="(?:\/)?actress(\d+)\.html">\s*<img[^>]*title="([^"]*)"/g)) {
      const n = dec(m[2])
      if (n && !rel.some(x => x.id === m[1]))
        rel.push({ id: m[1], name: n.split(',')[0].trim(), title: n })
      if (rel.length >= 10) break
    }
  }
  const img = (html.match(/src="(?:\/)?(p_actress[^"]+?\.jpg)/) || [])[1] || ''
  return {
    profileFields,
    canon,
    birthday,
    height: (size.match(/T(\d+)/) || [])[1] || '',
    breast: (size.match(/B(\d+)/) || [])[1] || '',
    cup,
    waist: (size.match(/W(\d+)/) || [])[1] || '',
    hip: (size.match(/H(\d+)/) || [])[1] || '',
    shoe: (size.match(/S([\d.]+)/) || [])[1] || '',
    blood: kv['血液型'] || '',
    place: kv['出身地'] || '',
    hobby: kv['趣味・特技'] || '',
    period: kv['AV出演期間'] || '',
    debut: kv['デビュー作品'] || '',
    agency: kv['所属事務所'] || '',
    blog: kv['ブログ'] || '',
    nick: kv['愛称'] || '',
    official: kv['公式サイト'] || '',
    img: img ? MN_BASE + img : '',
    alias: alias.filter(Boolean),
    tags,
    rel
  }
}

const NEED = [
  'birthday',
  'height',
  'breast',
  'cup',
  'waist',
  'hip',
  'shoe',
  'blood',
  'place',
  'hobby',
  'period',
  'debut',
  'agency',
  'blog',
  'nick',
  'official',
  'mcanon',
  'mimg'
]

/**
 * 定义回填允许覆盖的空值集合：undefined、null、空字符串、空数组。
 *
 * @param {*} v 当前字段值。
 * @returns {boolean} 0、false 及空对象均不被视为空。
 */
const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)
const { updateProfile } = require('./lib/profile-update')

;(async () => {
  // 阶段 1：读取已有名册，不能从空目录自行生成名册；输入错误由顶层处理。
  const roster = readJson(ROSTER, null)
  if (!Array.isArray(roster) || !roster.length)
    throw new Error('名册为空：请先抓榜单并运行 bootstrap-roster.js')
  fs.mkdirSync(TMP, { recursive: true })
  let cache = {}
  try {
    cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  } catch (_) {}

  // 阶段 2：ONLY 优先于 full；默认用逻辑或筛选缺少任一目标字段的人物。
  /*
   * 候选优先级：ONLY 指定 ID → full 全量 → nick 或 official 任一缺失。之后所有模式统一应用成功结果的 TTL 缓存。
   */
  let stale
  if (ONLY.length) stale = roster.filter(a => a && a.mnid && ONLY.includes(String(a.mnid)))
  else if (FULL) stale = roster.filter(a => a && a.mnid)
  else stale = roster.filter(a => a && a.mnid && (!a.nick || !a.official))
  // ONLY/full 仅改变候选范围；只有成功缓存受 TTL 控制，失败下次重试，不会因 ONLY 绕过缓存。
  const targets = stale
    .filter(a => {
      const c = cache[a.mnid]
      return a.profileSchemaVersion !== 2 || !c || !c.ok || Date.now() - c.fetchedAt > PROF_TTL
    })
    .slice(0, envInt('PROFILE_LIMIT', 100000))
  console.log(
    `名册 ${roster.length} · 有 mnid ${roster.filter(a => a && a.mnid).length} · 待抓 ${targets.length}${FULL ? '（全量）' : ONLY.length ? '（ONLY 指定）' : '（增量：缺 愛称/公式サイト）'}`
  )
  if (!targets.length) {
    console.log('无需抓取')
    return
  }

  const idx = new Map()
  for (const a of targets) idx.set(String(a.mnid), a)
  let done = 0,
    ok = 0,
    fail = 0
  const t0 = Date.now()
  /**
   * 保存进度时间戳及结果标记；异常被忽略，不中断名册回填。
   *
   * @returns {void} 缓存不保存完整解析资料，不能独立替代名册产物。
   */
  const saveCache = () => {
    try {
      writeJson(CACHE, cache)
    } catch (_) {}
  }
  /**
   * 保留全部已有字段，写同目录临时文件后替换名册；只填空发生在字段合并阶段。
   *
   * @returns {void} 写入/重命名失败向外抛出；与缓存保存不是原子组合。
   */
  const saveRoster = () => {
    writeJson(ROSTER, roster)
  }
  // 阶段 3：共享游标分配资料页任务；计数器在异步请求完成时更新。
  let cursor = 0
  /**
 * 循环领取下一个候选人物，抓取并解析后按来源基线合并字段，同时记录成功/失败缓存。
   * 每 200 条保存，每 100 条输出进度；DELAY 约束单个 worker 的迭代耗时，不是全局请求间隔。
   *
   * @returns {Promise<void>} 队列耗尽后完成；名册保存失败会向顶层传播。
   */
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= targets.length) return
      const a = targets[i]
      const t = Date.now()
      let html = ''
      try {
        html = await get(MN_BASE + 'actress' + a.mnid + '.html')
      } catch (_) {}
      const p = html ? parseProfilePage(html) : null
      if (p && p.canon) {
        cache[a.mnid] = { fetchedAt: Date.now(), ok: true }
        ok++
        // 持久化成功时间，让不同 Actions runner 也能继续补齐；失败不写成功标记。
        a.profileFetchedAt = Date.now()
        a.profileSchemaVersion = 2
        updateProfile(a, {
          ...Object.fromEntries(NEED.map(field => [field, p[field]])),
          mcanon: p.canon,
          mimg: p.img,
          profileFields: p.profileFields,
          relatedProfiles: p.rel,
          alias: p.alias,
          tags: p.tags,
          rel: p.rel.map(x => String(x.id || '')).filter(Boolean)
        }, a.profileFetchedAt)
        if (!a.msrc) a.msrc = MN_BASE + 'actress' + a.mnid + '.html'
      } else {
        cache[a.mnid] = { fetchedAt: Date.now(), ok: false }
        fail++
      }
      done++
      if (done % 200 === 0) {
        saveRoster()
        saveCache()
      }
      if (done % 100 === 0) {
        const el = Math.round((Date.now() - t0) / 1000)
        const eta = Math.round((el / done) * (targets.length - done))
        console.log(
          `  进度 ${done}/${targets.length} · 成功 ${ok} 失败 ${fail} · ${el}s，剩余约 ${Math.floor(eta / 60)}m${eta % 60}s`
        )
      }
      if (DELAY) await sleep(Math.max(0, DELAY - (Date.now() - t)))
    }
  }
  // 阶段 4：等待全部 worker 完成，再保存剩余不足 200 条的进度。
  await Promise.all(Array.from({ length: CONC }, worker))
  if (!ok) {
    saveCache()
    const error = new Error('资料页全部失败或未识别到人物标题，保留原名册')
    // 退出码 2 只表示已完成请求但全部资料不可用；程序错误仍用 1，调用方不能混淆。
    error.exitCode = 2
    throw error
  }
  saveRoster()
  saveCache()
  console.log(`完成：成功 ${ok} · 失败 ${fail} · 耗时 ${Math.round((Date.now() - t0) / 1000)}s`)
  console.log(
    `回填后：有 愛称 ${roster.filter(a => a && a.nick).length} · 有 公式サイト ${roster.filter(a => a && a.official).length} · 有 mcanon ${roster.filter(a => a && a.mcanon).length}`
  )
})().catch(e => {
  console.error('FAIL:', e.stack || e.message)
  // fetch 的代理连接可能仍在释放底层句柄；设置退出码后让事件循环自然结束，
  // 避免立即 process.exit() 打断 Windows 网络句柄清理。失败码语义保持不变。
  process.exitCode = e.exitCode === 2 ? 2 : 1
})
