#!/usr/bin/env node

/**
 * @file 根据固定姓名种子采集 JavDB 男演员资料，不是全站男演员目录。
 * 流程：逐个搜索种子 → 归一化后精确匹配姓名/别名 → 请求人物详情 → 写 JSON → 并行补图。
 * 输入：代码内 SEED；环境变量 RELAY_DIR 可以覆盖产物目录。
 * 默认输出：脚本同级 relay/roster_male.json 与 avatars_male/，在当前目录结构下即 tools/relay/。
 * 注意：默认路径不同于仓库根 relay/；本次仅记录差异，不修复路径或工作流。
 * 请求：候选 API 线路逐个尝试；签名采用秒级时间戳和原项目固定常量，不执行用户登录。
 * 限制：单个种子失败记入 missed；全体为空才抛错，部分缺失仍会覆盖上一版 JSON。
 * 运行：node tools/male-roster-relay.js。头像失败不回滚已写出的名单。
 *
 * 维护边界：本轮仅整理格式与注释，已知行为限制不在此处修复。
 */

/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 男优资料云端中转（GitHub Actions 内运行，机房直连无墙）：
 * 1. 用 JavDB 移动端 API（国内线路 + 应用级签名，与账号无关）搜出男优 → 取详情
 * 2. 写 relay/roster_male.json（字段与 actresses.json / JavDB actor 同构）
 * 3. 抓头像 → relay/avatars_male/<id>.jpg（已存在则跳过）
 *
 * 与 rank-relay.js（minnano）不同：minnano 无男优榜/男优资料页，男优只能走 JavDB。
 * 前端演员页新增「男优」大 tab，数据就是这份 roster_male.json（首次从 relay 拉回本地）。
 * 无第三方依赖，Node 18+ 自带 fetch。
 * 补充说明：以上为上游特定环境的网络经验，不保证当前网络或 GitHub runner 仍具有相同可达性。
 * 补充说明：主仓、前端、NAS 和历史数据规模描述的是上游使用背景；本仓库未包含对应主应用或原数据，不能据此认定这些功能已接入。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * ---- JavDB 移动端 API：国内线路 + 应用级签名（照抄 server.js 的 jdbSign） ----
 * 补充说明：主仓、前端、NAS 和历史数据规模描述的是上游使用背景；本仓库未包含对应主应用或原数据，不能据此认定这些功能已接入。
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

/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 产物目录：Actions 里是仓库根的 relay/；本地自测可用 RELAY_DIR 覆盖或默认同级 relay/
 */
const RELAY_DIR = process.env.RELAY_DIR || path.join(__dirname, 'relay')
const AVA_DIR = path.join(RELAY_DIR, 'avatars_male')
const TIMEOUT = 20000
let LINE_OK = ''

/**
 * 依次尝试 API 线路，优先复用成功线路；每条线路均有独立超时。
 * HTTP 非成功或 success 严格等于数字 0 时尝试下一条；没有对同一线路额外重试。
 * @param {string} rel 相对于 /api/ 的路径及查询串，不是完整 URL。
 * @param {boolean} [binary] 真时读取 Buffer；默认读取 JSON。
 * @returns {Promise<object|Buffer>} 成功线路返回的 JSON 或二进制内容。
 * @throws {Error} 所有候选线路均失败时抛出最后一次错误。
 */
/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 国内线路直连（不继承任何代理环境变量，Actions 机房直连）
 * 补充说明：以上为上游特定环境的网络经验，不保证当前网络或 GitHub runner 仍具有相同可达性。
 */
async function jdbGet(rel, binary) {
  const order = LINE_OK ? [LINE_OK].concat(JDB_LINES.filter(x => x !== LINE_OK)) : JDB_LINES
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
        return Buffer.from(await r.arrayBuffer())
      }
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
 * 按绝对图片地址读取原始字节；请求不带 API 签名，也不自动执行 XOR 解码。
 * @param {string} url 图片绝对 URL；调用方负责来源限制与落盘。
 * @returns {Promise<Buffer>} 原始响应字节。
 * @throws {Error} HTTP 错误、超时或读取失败。
 */
/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 图片：JavDB 图床（tp.spfcas.com 等）走绝对地址直连，不拼 /api/，不需要签名。
 * 只带 UA / Referer；返回的是加密字节流，交给 imgMaybeDecrypt 解开。
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
 * 统一姓名比较键：小写并删除指定空格、分隔符；是否转换假名取决于本文件实现。
 * 这是字符串比较规则，不保证同名是同一人，也不能替代跨来源身份映射。
 * @param {*} s 原始姓名或别名。
 * @returns {string} 比较用键，不用于替换展示姓名。
 */
/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 名字归一化（照抄 server.js onNorm）：去空格/分隔符 + 小写，用于精确匹配
 * 补充说明：主仓、前端、NAS 和历史数据规模描述的是上游使用背景；本仓库未包含对应主应用或原数据，不能据此认定这些功能已接入。
 */
const onNorm = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s　・·,，、/]+/g, '')

/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 种子：知名 + 活跃男优（日文原名为主，含常见艺名/汉字写法）。
 * 一个名字可能搜出同名/别名干扰项，所以下面靠归一化精确匹配挑真正那一个。
 */
const SEED = [
  // 高产/知名男优（JavDB 有正式档案，日文原名）
  '清水健',
  '加藤鷹',
  '南佳也',
  '月野帯人',
  '鈴木一徹',
  '向理来',
  '渡部拓哉',
  '北野翔',
  '藤木一真',
  '有馬芳彦',
  'ムータン',
  '阪本隆太',
  '黒田悠斗',
  '志戸哲也',
  '小田切ジュン',
  '吉村卓',
  '剣持光也',
  '伊織',
  '松宮孝',
  '大野樹佳',
  '風林火山',
  '小澤純',
  '岸谷和明',
  '金馬豪君',
  '菅沼謙',
  '安保隆正',
  // 中坚/在役
  '安倍要',
  '冬月翔',
  '國見真也',
  '鳥居章',
  '野村圭祐',
  '高倉健',
  '沢村陽進',
  '小野貴志',
  '柿沼洋一'
]

/**
 * 按文件头粗略区分普通图片与 JavDB XOR 包装。已识别文件头或过短输入原样返回。
 * 未知头部时，取第 0 字节为密钥，对其余字节逐一异或；不会验证解码结果。
 * @param {Buffer} buf 下载得到的字节。
 * @returns {Buffer} 原 Buffer 或长度少 1 的新 Buffer；输入不被修改。
 */
/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * JavDB 图床（tp.spfcas.com 等）返回的是加密字节流：首字节 = 异或密钥，其余每字节 ⊕ 密钥。
 * 与 server.js 的 imgMaybeDecrypt 同款，解开后应是 JPEG/PNG/WebP/GIF。
 * 补充说明：主仓、前端、NAS 和历史数据规模描述的是上游使用背景；本仓库未包含对应主应用或原数据，不能据此认定这些功能已接入。
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

/**
 * 在搜索结果的 name/name_zht/other_name 中寻找归一化后完全相等的姓名。
 * 仅按英文逗号拆分拼接后的别名，返回第一个命中对象，不做模糊匹配。
 * @param {Array<object>} actors API 返回的候选列表。
 * @param {string} name 要搜索的姓名。
 * @returns {object|null} 首个命中的原对象或 null。
 */
/*
 * 上游原注释（保留设计意图、历史故障与样本记录）：
 * 逐个搜名字 → 命中 actor → 取详情
 */
function pickActor(actors, name) {
  const n = onNorm(name)
  for (const a of actors) {
    const names = [a.name, a.name_zht, a.other_name].filter(Boolean).join(',')
    for (const x of String(names).split(',')) if (x && onNorm(x) === n) return a
  }
  return null
}

;(async () => {
  fs.mkdirSync(AVA_DIR, { recursive: true })
  const out = { fetchedAt: Date.now(), source: 'javdb', list: [] }
  const seen = new Set()
  const missed = []
  let ok = 0

  // 阶段 1：固定种子串行搜索；精确匹配不到直接跳过，不选择搜索结果第一项冒充命中。
  for (const seed of SEED) {
    if (!seed || /[!]/.test(seed)) continue // 防御：占位坏种子跳过
    let actor = null
    try {
      const s = await jdbGet('v2/search?q=' + encodeURIComponent(seed) + '&type=actor&page=1')
      const actors = ((s || {}).data || {}).actors || []
      actor = pickActor(actors, seed)
      // 精确匹配不到就跳过（宁可漏也不要抓错人，比如「加藤鷹」会搜到「加藤あやの」）
      if (!actor || !actor.id || seen.has(actor.id)) {
        missed.push(seed)
        continue
      }
    } catch (e) {
      missed.push(seed)
      continue
    }

    let d = null
    try {
      d = ((await jdbGet('v1/actors/' + encodeURIComponent(actor.id))) || {}).data || {}
    } catch (e) {
      missed.push(seed)
      continue
    }
    const a = d.actor || {}
    if (!a.name) {
      missed.push(seed)
      continue
    }
    seen.add(actor.id)

    // 归一成与 actresses.json / JavDB 一致的字段
    out.list.push({
      id: a.id || actor.id,
      name: a.name || '',
      name_zht: a.name_zht || '',
      other_name: a.other_name || '',
      avatar_url: a.avatar_url || '',
      birthday: a.birthday || '',
      age: a.age != null ? a.age : '',
      blood_type: a.blood_type || '',
      height: a.height != null ? a.height : '',
      birthplace: a.birthplace || '',
      videos_count: a.videos_count != null ? a.videos_count : '',
      twitter_id: a.twitter_id || '',
      instagram_id: a.instagram_id || '',
      share_info: d.share_info || '',
      tags: (d.tags || []).map(t => t.name).filter(Boolean),
      source_url: 'https://javdb.com/actors/' + (a.id || actor.id)
    })
    ok++
    console.log(
      '✓ ' + (a.name || actor.id) + '  ' + (a.videos_count != null ? a.videos_count + ' 部' : '')
    )
  }

  // 阶段 2：名单全空才抛错；部分成功也会替换旧文件，missed 用于人工排查。
  out.count = out.list.length
  out.missed = missed
  if (!out.list.length) throw new Error('男优解析为空（签名/线路/端点可能失效）')

  const tmp = path.join(RELAY_DIR, 'roster_male.json.tmp')
  fs.writeFileSync(tmp, JSON.stringify(out))
  fs.renameSync(tmp, path.join(RELAY_DIR, 'roster_male.json'))
  console.log(
    'relay/roster_male.json 已生成：' +
      ok +
      ' 位（未命中 ' +
      missed.length +
      '：' +
      missed.join('、') +
      '）'
  )

  // 头像：JavDB 图床（tp.spfcas.com）直连即通
  // 阶段 3：JSON 已落盘，再尝试头像；图床白名单只限制此阶段的远端图片地址。
  const IMG_HOST_OK = /(^|\.)(spfcas\.com|jdbstatic\.com|javdb\d*\.com)$/i
  /**
   * 只接受长度大于 2048 且前两个字节匹配 JPEG/PNG 的数据。
   * 这不是完整图片解码校验；即使解码器识别 WebP/GIF，此判据仍会拒绝它们。
   * @param {Buffer|null} b 待校验内容。
   * @returns {boolean} 是否通过当前轻量判据。
   */
  const isImg = b =>
    !!(
      b &&
      b.length > 2048 &&
      ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50))
    )
  let avOk = 0,
    avSkip = 0
  await Promise.all(
    out.list.map(async r => {
      if (!r.avatar_url) return
      try {
        const u = new URL(r.avatar_url)
        if (!IMG_HOST_OK.test(u.hostname)) return
        const f = path.join(AVA_DIR, r.id + '.jpg')
        if (fs.existsSync(f) && fs.statSync(f).size > 2048) {
          avSkip++
          return
        }
        const b = imgMaybeDecrypt(await imgGet(u.href))
        if (isImg(b)) {
          fs.writeFileSync(f, b)
          avOk++
        }
      } catch (_) {}
    })
  )
  console.log('头像：新抓 ' + avOk + '，已存在 ' + avSkip)
})().catch(e => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
