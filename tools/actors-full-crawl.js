#!/usr/bin/env node

/**
 * @file 从 JavDB 影片中发现演员，合并旧人物资料并补充头像。
 * 发现范围：“全部/有码/无码”三个影片维度，默认各最多 20 页；连续两页无新增便提前结束。
 * 这里的 full 表示累积集合，不保证全站完整；已有 ID 直接复用，不刷新旧人物详情。
 * 输出：RELAY_DIR 下 actors_full.json、actress_fix.json、female_names.json、avatars_jdb/。
 * 默认目录：脚本位于 tools 时使用仓库根 relay/；否则使用脚本同级 relay/。
 * 配置：MOVIE_PAGES=20，AVA_CONC=6，FIX_LIMIT=400；RELAY_DIR 可覆盖目录。
 * 性别：命中女性姓名集合即 f；未命中先为 m，再尝试网页复核。没有命中不能证明是男性。
 * 网页配置：WEB_GENDER=0 关闭复核；WEB_PROXY 指定代理；WEB_GENDER_LOCAL 非空时提供默认代理。
 * 网络/读取/图片错误有多种吞错与兜底策略，细节见各函数；顶层未处理错误才令进程非零退出。
 * 当前保留的限制：旧 Map 引用不是快照、补图缓存形状不一致、空发现仍可能写出结果。
 * 运行：node tools/actors-full-crawl.js。直接写文件，不保证所有产物一起成功。
 *
 * 维护边界：本轮仅整理格式与注释，已知行为限制不在此处修复。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

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

const RELAY_DIR =
  process.env.RELAY_DIR ||
  (path.basename(__dirname) === 'tools'
    ? path.join(__dirname, '..', 'relay')
    : path.join(__dirname, 'relay'))
const AVA_DIR = path.join(RELAY_DIR, 'avatars_jdb')
const OUT_JSON = path.join(RELAY_DIR, 'actors_full.json')
const TIMEOUT = 20000
const MOVIE_PAGES = +(process.env.MOVIE_PAGES || 20) // 翻多少页影片列表（每页 30 部）
const AVA_CONC = +(process.env.AVA_CONC || 6) // 头像并发
const LINE_OK_K = 'actors_full_line_ok'
let LINE_OK = ''

/**
 * 读取上次成功的 API 线路作为优先尝试对象。文件缺失/读取失败时保留当前 LINE_OK。
 * @returns {void} 通过修改模块变量传递结果；不向调用者抛出读取异常。
 */
function loadLine() {
  try {
    LINE_OK = fs.readFileSync(path.join(RELAY_DIR, LINE_OK_K), 'utf8').trim()
  } catch (_) {}
}

/**
 * 持久化最近成功线路。它是请求偏好缓存，不是整个采集任务的断点。
 * @returns {void} 写入失败被忽略，不中断 API 请求。
 */
function saveLine() {
  try {
    fs.writeFileSync(path.join(RELAY_DIR, LINE_OK_K), LINE_OK)
  } catch (_) {}
}

/**
 * 依次尝试 API 线路，优先复用成功线路；每条线路均有独立超时。
 * HTTP 非成功或 success 严格等于数字 0 时尝试下一条；没有对同一线路额外重试。
 * @param {string} rel 相对于 /api/ 的路径及查询串，不是完整 URL。
 * @param {boolean} [binary] 真时读取 Buffer；默认读取 JSON。
 * @returns {Promise<object|Buffer>} 成功线路返回的 JSON 或二进制内容。
 * @throws {Error} 所有候选线路均失败时抛出最后一次错误。
 */
async function jdbGet(rel, binary) {
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
          Accept: binary ? '*/*' : 'application/json'
        }
      })
      if (!r.ok) throw new Error(base + ' → ' + r.status)
      if (binary) {
        LINE_OK = base
        saveLine()
        return Buffer.from(await r.arrayBuffer())
      }
      const j = await r.json()
      if (j && j.success === 0) throw new Error(j.message || 'API 返回失败')
      LINE_OK = base
      saveLine()
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
 * 按绝对图片地址读取原始字节；请求不带 API 签名，也不自动执行 XOR 解码。
 * @param {string} url 图片绝对 URL；调用方负责来源限制与落盘。
 * @returns {Promise<Buffer>} 原始响应字节。
 * @throws {Error} HTTP 错误、超时或读取失败。
 */
async function imgGet(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT)
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'Dart/3.5 (dart:io)', Referer: new URL(url).origin + '/' }
    })
    if (!r.ok) throw new Error('图床 ' + r.status)
    return Buffer.from(await r.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 按文件头粗略区分普通图片与 JavDB XOR 包装。已识别文件头或过短输入原样返回。
 * 未知头部时，取第 0 字节为密钥，对其余字节逐一异或；不会验证解码结果。
 * @param {Buffer} buf 下载得到的字节。
 * @returns {Buffer} 原 Buffer 或长度少 1 的新 Buffer；输入不被修改。
 */
function imgMaybeDecrypt(buf) {
  if (!buf || buf.length < 2) return buf
  const head4 = buf.subarray(0, 4).toString('binary')
  const known =
    (buf[0] === 0xff && buf[1] === 0xd8) ||
    head4 === 'RIFF' ||
    head4 === 'GIF8' ||
    buf.subarray(0, 8).toString('binary') === '\x89PNG\r\n\x1a\n' ||
    head4 === '\x00\x00\x01\x00' ||
    head4 === 'ftyp'
  if (known) return buf
  const key = buf[0]
  const out = Buffer.allocUnsafe(buf.length - 1)
  for (let i = 1; i < buf.length; i++) out[i - 1] = buf[i] ^ key
  return out
}
const IMG_HOST_OK = /(^|\.)(spfcas\.com|jdbstatic\.com|javdb\d*\.com)$/i

/**
 * 只接受长度大于 2048 且前两个字节匹配 JPEG/PNG 的数据。
 * 这不是完整图片解码校验；即使解码器识别 WebP/GIF，此判据仍会拒绝它们。
 * @param {Buffer|null} b 待校验内容。
 * @returns {boolean} 是否通过当前轻量判据。
 */
const isImg = b =>
  !!(b && b.length > 2048 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50)))

/**
 * 通过共享递增索引分配任务，限制同时等待的异步操作数量。
 * 索引在 await 前领取，因此不会重复分配；同步阻塞回调仍会阻塞其他 worker。
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
 * 读取已有演员产物供增量合并。只补新 ID，不刷新旧人物详情。
 * @returns {{list: Array<object>}} 读取/解析失败时返回空 list，不区分缺文件与损坏。
 */
function loadPrev() {
  try {
    return JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) || { list: [] }
  } catch (_) {
    return { list: [] }
  }
}

/**
 * 将正则覆盖的片假名按 Unicode 偏移转成平假名；汉字原样保留。
 * @param {*} s 输入文本；假值按空字符串处理。
 * @returns {string} 转换后的字符串；不提供汉字读音、翻译或同义词映射。
 */
const onKana = s =>
  String(s || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))

/**
 * 统一姓名比较键：小写并删除指定空格、分隔符；是否转换假名取决于本文件实现。
 * 这是字符串比较规则，不保证同名是同一人，也不能替代跨来源身份映射。
 * @param {*} s 原始姓名或别名。
 * @returns {string} 比较用键，不用于替换展示姓名。
 */
const onNorm = s =>
  onKana(String(s || ''))
    .toLowerCase()
    .replace(/[\s　・·,，、/]+/g, '')

/**
 * 在搜索结果的 name/name_zht/other_name 中寻找归一化后完全相等的姓名。
 * 仅按英文逗号拆分拼接后的别名，返回第一个命中对象，不做模糊匹配。
 * @param {Array<object>} actors API 返回的候选列表。
 * @param {string} name 要搜索的姓名。
 * @returns {object|null} 首个命中的原对象或 null。
 */
function pickActor(actors, name) {
  const n = onNorm(name)
  for (const a of actors) {
    const names = [a.name, a.name_zht, a.other_name].filter(Boolean).join(',')
    for (const x of String(names).split(',')) if (x && onNorm(x) === n) return a
  }
  return null
}

/**
 * 下载 minnano 的普通图片字节，附带该站 Referer，不经过 JavDB 解码。
 * @param {string} url 完整图片 URL。
 * @returns {Promise<Buffer>} 响应内容；格式校验由调用方完成。
 * @throws {Error} HTTP、网络或响应读取失败。
 */
async function plainImgGet(url) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT)
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Referer: 'https://www.minnano-av.com/'
      }
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return Buffer.from(await r.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 为外部 actresses.json 中缺 icon 的人物搜索补充资料，并写出补图映射。
 * 按作品数排序后最多选 FIX_LIMIT 条；不直接修改外部名册。
 * @param {Map<string, object>} byId 现有演员映射；当前函数未使用此参数。
 * @returns {Promise<void>} 缺少可用名册时提前返回；文件写入异常向外传播。
 */
async function fixActressesWithoutIcon(byId) {
  const FIX_OUT = path.join(RELAY_DIR, 'actress_fix.json')
  const ROSTER = path.join(RELAY_DIR, '..', 'actresses.json')
  let roster = []
  try {
    roster = JSON.parse(fs.readFileSync(ROSTER, 'utf8')) || []
  } catch (_) {}
  const byName = new Map(roster.map(a => [a && a.name, a]))
  const need = roster
    .filter(a => a && a.name && !a.icon)
    .sort((x, y) => (y.videoCount || 0) - (x.videoCount || 0))
    .slice(0, +(process.env.FIX_LIMIT || 400)) // 高作品数优先
  if (!need.length) {
    console.log('⑤ 无名册数据，跳过女优补图')
    return
  }

  // 续跑：已有记录直接复用
  let fix = {}
  try {
    fix = JSON.parse(fs.readFileSync(FIX_OUT, 'utf8')) || {}
  } catch (_) {}
  // 已知限制：这里直接读取整个包装对象，后面却按名字访问；与输出的 map 包装结构不一致。
  const todo = need.filter(a => !fix[a.name])
  console.log(
    '⑤ 名册无头像女优 ' +
      need.length +
      ' 位（已补 ' +
      (need.length - todo.length) +
      '，本次查 ' +
      todo.length +
      '）'
  )

  let gotJdb = 0,
    gotMn = 0
  await pool(todo, 4, async a => {
    const rec = {
      name: a.name,
      mimg: a.mimg || '',
      mnid: a.mnid || '',
      rosterWorks: a.videoCount || 0,
      at: Date.now()
    }
    try {
      const j = await jdbGet('v2/search?q=' + encodeURIComponent(a.name) + '&type=actor&page=1')
      const arr = ((j || {}).data || {}).actors || []
      const hit = pickActor(arr, a.name)
      if (hit && hit.id) {
        const d = await jdbGet('v1/actors/' + encodeURIComponent(hit.id))
        const ac = ((d || {}).data || {}).actor || {}
        if (ac.id && ac.name) {
          rec.id = ac.id
          rec.jname = ac.name
          rec.name_zht = ac.name_zht || ''
          rec.other_name = ac.other_name || ''
          rec.avatar_url = ac.avatar_url || '' // JavDB 有图就用它
          rec.videos_count = ac.videos_count != null ? ac.videos_count : ''
          rec.birthday = ac.birthday || ''
          rec.height = ac.height != null ? ac.height : ''
          rec.bust = ac.bust != null ? ac.bust : ''
          rec.cup = ac.cup || ''
          rec.waist = ac.waist != null ? ac.waist : ''
          rec.hips = ac.hips != null ? ac.hips : ''
          rec.birthplace = ac.birthplace || ''
          if (ac.avatar_url) gotJdb++
        }
      }
    } catch (_) {}
    fix[a.name] = rec
  })
  // 直接覆盖目标，不使用临时文件；这是既有写入策略，不能保证中途异常时保留旧文件。
  fs.writeFileSync(
    FIX_OUT,
    JSON.stringify({ fetchedAt: Date.now(), count: Object.keys(fix).length, map: fix })
  )
  const withJdb = Object.values(fix).filter(x => x.avatar_url).length
  const withMn = Object.values(fix).filter(x => !x.avatar_url && x.mimg).length
  console.log(
    '   relay/actress_fix.json：共 ' +
      Object.keys(fix).length +
      ' 条 · JavDB 图 ' +
      withJdb +
      '（本次 +' +
      gotJdb +
      '）· JavDB 无图但名册有 minnano 原图 ' +
      withMn
  )
}

let FEM_NAMES = null

/**
 * 首次使用时建立归一化女性姓名 Set，后续调用复用同一进程内缓存。
 * 优先读 female_names.json；没有条目时回退外部 actresses.json。读取失败被忽略。
 * @returns {Set<string>} 可能为空；空集合不能证明候选人物都是男性。
 */
function loadFemaleNames() {
  if (FEM_NAMES) return FEM_NAMES
  FEM_NAMES = new Set()

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

/**
 * 将 gender=f 的人物姓名及别名合并进已有名字集合，仅数量增加时落盘。
 * 集合使用原始字符串；写入失败被忽略。调用方还需确保工作流提交该产物。
 * @param {Array<object>} list 本轮合并后的人物集合。
 * @returns {void} 不重新验证已有性别，不删除旧名字。
 */
function updateFemaleNames(list) {
  try {
    const p = path.join(RELAY_DIR, 'female_names.json')
    const names = new Set()
    try {
      ;((JSON.parse(fs.readFileSync(p, 'utf8')) || {}).names || []).forEach(n => names.add(n))
    } catch (_) {}
    const before = names.size
    for (const a of list) {
      if (!a || a.gender !== 'f') continue
      ;[a.name, a.name_zht].concat(String(a.other_name || '').split(/[,，、]/)).forEach(n => {
        n = String(n || '').trim()
        if (n && n.length < 60) names.add(n)
      })
    }
    if (names.size !== before) {
      fs.writeFileSync(
        p,
        JSON.stringify({
          fetchedAt: Date.now(),
          source: 'minnano-roster+javdb-verified',
          count: names.size,
          names: [...names]
        })
      )
      console.log('   relay/female_names.json：' + before + ' → ' + names.size + ' 个女优名字')
    }
  } catch (_) {}
}

/**
 * 通过姓名集合做第一阶段性别推断。命中为 f，未命中仍返回原版默认 m。
 * 未命中只是名单没有覆盖，不能当作事实确认；调用方用 rosterHit 决定是否网页复核。
 * @param {object} a 含 name、name_zht、other_name 的人物记录。
 * @returns {{gender: string, rosterHit: boolean}} 当前推断及其是否来自名册命中。
 */
function genderOf(a) {
  const fem = loadFemaleNames()
  const keys = [a.name, a.name_zht].concat(String(a.other_name || '').split(/[,，、]/))
  for (const k of keys) {
    if (k && fem.has(onNorm(k))) return { gender: 'f', rosterHit: true }
  }
  // 未命中仅说明名单覆盖不足；现有代码仍返回 m，调用方可继续网页复核。
  return { gender: 'm', rosterHit: false }
}

const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const WEB_PROXY =
  process.env.WEB_PROXY || (process.env.WEB_GENDER_LOCAL ? 'http://127.0.0.1:1082' : '')
const WEB_ON = process.env.WEB_GENDER !== '0'
let WEB_DEAD = false // 连续失败到阈值就整轮放弃，别傻等
let webFailStreak = 0

/**
 * 同步调用 curl 读取人物页并检查全部 section-meta；任何一项含“男優”即 m。
 * 无标签返回 null；连续 15 次无有效标签后设置本轮熔断，后续不再发请求。
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
      console.log('   ⚠ 网页版连续 15 次取不到（被墙/风控），本轮放弃复核，保留名册反查结果')
    }
    return null
  }
  webFailStreak = 0
  return metas.some(t => /男優/.test(t)) ? 'm' : 'f'
}

;(async () => {
  fs.mkdirSync(AVA_DIR, { recursive: true })
  loadLine()

  // 阶段 1：影片列表给出影片 ID，影片详情才提供 actors；两级请求不能混为同一端点。
  console.log('① 翻影片列表反推演员…')
  const found = new Map()
  const SOURCES = [
    { label: '全部', q: 'type=all&sort_by=update' },
    { label: '有码', q: 'type=0&sort_by=update' },
    { label: '无码', q: 'type=1&sort_by=update' }
  ]
  outer: for (const src of SOURCES) {
    let stall = 0
    for (let page = 1; page <= MOVIE_PAGES; page++) {
      let list = []
      try {
        const j = await jdbGet(
          'v1/movies/latest?filter_by=magnets&limit=30&page=' + page + '&' + src.q
        )
        list = ((j || {}).data || {}).movies || []
      } catch (e) {
        console.log('   ' + src.label + ' 第' + page + '页失败：' + e.message)
        break
      }
      if (!list.length) break
      const ids = list.map(m => m.id).filter(Boolean)
      const detail = await pool(ids, 8, async id => {
        try {
          const d = await jdbGet('v2/movies/' + id)
          return ((d || {}).data || {}).movie || {}
        } catch (_) {
          return null
        }
      })
      let added = 0
      for (const mv of detail) {
        for (const a of (mv && mv.actors) || []) {
          if (a && a.id && a.name && !found.has(a.id)) {
            found.set(a.id, a.name)
            added++
          }
        }
      }
      if (page % 10 === 0 || added === 0)
        console.log(
          '   ' +
            src.label +
            ' 第' +
            page +
            '页 → 累计 ' +
            found.size +
            '（本页新增 ' +
            added +
            '）'
        )
      // 连续两页无新增便结束该维度；这是提前停止启发式，不能证明已遍历完整目录。
      stall = added === 0 ? stall + 1 : 0
      if (stall >= 2) break
    }
  }
  console.log('   影片反推共 ' + found.size + ' 个演员')

  // 阶段 2：旧记录优先，只有尚未出现的 ID 才请求人物详情；历史资料不会刷新。
  const prev = loadPrev()
  const byId = new Map((prev.list || []).map(a => [a.id, a]))
  // 注意：Map 别名共享新增记录及对象修改，不能用于恢复独立的历史状态。
  const PREV_BY_ID = byId // 与 byId 指向同一个 Map，并非旧版快照；安全阀的这一限制保持原样。
  const MALE_BEFORE = (prev.list || []).filter(a => a.gender === 'm').length
  const todo = [...found.keys()].filter(id => !byId.get(id))
  console.log('② 已有 ' + byId.size + ' 个，需新抓 ' + todo.length + ' 个')

  let done = 0
  await pool(todo, 4, async id => {
    let a = null
    try {
      a = ((await jdbGet('v1/actors/' + encodeURIComponent(id))) || {}).data || {}
    } catch (_) {
      return
    }
    const ac = a.actor || {}
    if (!ac.id || !ac.name) return
    // 命中名册使用 f；未命中先使用默认 m，并以 pending-web 标记等待复核。
    const g = genderOf(ac)
    byId.set(id, {
      id: ac.id,
      name: ac.name || '',
      name_zht: ac.name_zht || '',
      other_name: ac.other_name || '',
      gender: g.gender,
      genderSource: g.rosterHit ? 'roster' : 'pending-web',
      avatar_url: ac.avatar_url || '',
      birthday: ac.birthday || '',
      age: ac.age != null ? ac.age : '',
      blood_type: ac.blood_type || '',
      height: ac.height != null ? ac.height : '',
      bust: ac.bust != null ? ac.bust : '',
      cup: ac.cup || '',
      waist: ac.waist != null ? ac.waist : '',
      hips: ac.hips != null ? ac.hips : '',
      birthplace: ac.birthplace || '',
      videos_count: ac.videos_count != null ? ac.videos_count : '',
      twitter_id: ac.twitter_id || '',
      instagram_id: ac.instagram_id || '',
      tags: (a.tags || []).map(t => t.name).filter(Boolean),
      source_url: 'https://javdb.com/actors/' + ac.id
    })
    done++
    if (done % 20 === 0) console.log('   新抓 ' + done + '/' + todo.length)
  })

  // 阶段 3：仅复核本次新增且名册未命中的人物，关闭复核会保留 pending-web。
  const pending = todo.map(id => byId.get(id)).filter(r => r && r.genderSource === 'pending-web')
  if (WEB_ON && pending.length) {
    console.log('②b 性别复核（网页版 section-meta）：' + pending.length + ' 位…')
    await pool(pending, 8, async r => {
      const g = webGenderOf(r.id)
      if (g) {
        r.gender = g
        r.genderSource = 'javdb-web-section-meta'
      } else r.genderSource = r.genderSource === 'pending-web' ? 'roster-heuristic' : r.genderSource
    })
    const fixF = pending.filter(r => r.gender === 'f').length
    console.log(
      '   复核结果：女优 ' +
        fixF +
        ' · 男优 ' +
        (pending.length - fixF) +
        (WEB_DEAD ? '（网页版不可用，部分保留名册反查）' : '')
    )
  }

  // 阶段 4：按来源总作品数降序输出；该指标不是本轮采到的影片数。
  const list = [...byId.values()].sort(
    (a, b) => (Number(b.videos_count) || 0) - (Number(a.videos_count) || 0)
  )
  const out = {
    fetchedAt: Date.now(),
    source: 'javdb',
    count: list.length,
    female: list.filter(a => a.gender === 'f').length,
    male: list.filter(a => a.gender === 'm').length,
    genderSource: 'javdb-web-section-meta+roster',
    list
  }

  // 阶段 5：有条件触发原有安全阀；PREV_BY_ID 为共享引用，不能视为可靠历史快照。
  const FEM_COUNT = loadFemaleNames().size
  if (WEB_DEAD && !FEM_COUNT && out.male - MALE_BEFORE > 5) {
    console.log(
      `⚠ 名册缺失且网页版不可用 → 本次新增的 ${out.male - MALE_BEFORE} 位性别不可信，按上一版还原，不写入新性别`
    )
    for (const r of pending) {
      const o = PREV_BY_ID.get(r.id)
      if (o) {
        r.gender = o.gender
        r.genderSource = o.genderSource || 'prev'
      } else {
        r.gender = 'f'
        r.genderSource = 'unverified-default-f'
      }
    }
    out.female = list.filter(a => a.gender === 'f').length
    out.male = list.filter(a => a.gender === 'm').length
  }
  // 直接覆盖目标；发现集合为空也没有统一的失败拦截，保持原实现。
  fs.writeFileSync(OUT_JSON, JSON.stringify(out))
  updateFemaleNames(list)
  console.log(
    '③ relay/actors_full.json 已生成：共 ' +
      out.count +
      ' 位（女优 ' +
      out.female +
      ' · 男优 ' +
      out.male +
      '）'
  )

  // 阶段 6：读取外部名册做补图；名册缺失时跳过，JSON 主产物此前已经写出。
  await fixActressesWithoutIcon(byId)

  let avOk = 0,
    avSkip = 0,
    avMiss = 0,
    avMn = 0
  let fixMap = {}
  try {
    fixMap =
      (JSON.parse(fs.readFileSync(path.join(RELAY_DIR, 'actress_fix.json'), 'utf8')) || {}).map ||
      {}
  } catch (_) {}
  // 阶段 7：合并演员头像与补图映射，允许图片失败，不回滚此前写出的 JSON。
  const avaList = [
    ...list.map(r => ({ id: r.id, avatar_url: r.avatar_url })),
    // 女优补图：JavDB 有图走 JavDB；没有则用名册存的 minnano 原图
    ...Object.values(fixMap)
      .filter(x => x && (x.avatar_url || x.mimg))
      .map(x => ({
        id: x.id || 'mn_' + (x.mnid || x.name),
        avatar_url: x.avatar_url,
        mimg: x.mimg,
        isMn: !x.avatar_url
      }))
  ]
  await pool(avaList, AVA_CONC, async r => {
    if (!r.avatar_url && !r.mimg) {
      avMiss++
      return
    }
    try {
      const f = path.join(AVA_DIR, r.id + '.jpg')
      if (fs.existsSync(f) && fs.statSync(f).size > 2048) {
        avSkip++
        return
      }
      let b = null
      if (r.avatar_url) {
        const u = new URL(r.avatar_url)
        if (!IMG_HOST_OK.test(u.hostname)) {
          avMiss++
          return
        }
        b = imgMaybeDecrypt(await imgGet(u.href))
      } else {
        // minnano 原图：普通 https 图片，不加密
        if (!/^https:\/\/www\.minnano-av\.com\//.test(r.mimg)) {
          avMiss++
          return
        }
        b = await plainImgGet(r.mimg)
        avMn++
      }
      if (isImg(b)) {
        fs.writeFileSync(f, b)
        avOk++
      } else avMiss++
    } catch (_) {
      avMiss++
    }
  })
  console.log(
    '④ 头像：新抓 ' +
      avOk +
      '（其中 minnano 原图 ' +
      avMn +
      '），已存在 ' +
      avSkip +
      '，无图/失败 ' +
      avMiss
  )
})().catch(e => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
