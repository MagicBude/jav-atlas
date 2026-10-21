#!/usr/bin/env node

/**
 * @file 根据固定姓名种子采集 JavDB 男演员资料，不是全站男演员目录。
 * 流程：逐个搜索种子 → 归一化后精确匹配姓名/别名 → 请求人物详情 → 写 JSON → 并行补图。
 * 输入：代码内 SEED；环境变量 RELAY_DIR 可以覆盖产物目录。
 * 默认输出：仓库根 relay/javdb/male-seed-actors.json 与 javdb/avatars/；RELAY_DIR 可覆盖。
 * 所有采集器通过共享目录配置写入同一个 relay/，避免工作流提交目录与实际输出错位。
 * 请求：候选 API 线路逐个尝试；签名采用秒级时间戳和应用固定常量，不执行用户登录。
 * 限制：单个种子失败记入 missed；全体为空才抛错，部分缺失仍会覆盖上一版 JSON。
 * 运行：node tools/male-roster-relay.js。头像失败不回滚已写出的名单。
 *
 * 来源选择：minnano 不提供本脚本所需的男演员榜单或资料，因此通过 JavDB 搜索人物。
 * javdb/male-seed-actors.json 保持与演员资料相近的字段，供浏览端男性列表首次获取后缓存。
 * 网络请求使用 Node 18+ 内置 fetch，无第三方依赖；网页和移动 API 的可达性可能不同。
 */
const fs = require('fs')
const { avatarPath } = require('./lib/avatars')
const { writeJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const paths = dataPaths()
const crypto = require('crypto')

/*
 * JavDB 移动端 API 使用固定应用常量与时间戳生成签名，不依赖用户登录。
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

/*
 * 路径：RELAY_DIR 覆盖优先，默认仓库根 relay/。
 * 工作流与脚本使用相同目录配置，避免写入脚本同级目录导致产物缺失。
 */
const AVA_DIR = paths.javdbAvatars
const TIMEOUT = envInt('HTTP_TIMEOUT_MS', 20000, 1, 120000)
let LINE_OK = ''

/**
 * 依次尝试 API 线路，优先复用成功线路；每条线路均有独立超时。
 * HTTP 非成功或 success 严格等于数字 0 时尝试下一条；没有对同一线路额外重试。
 *
 * 请求没有显式配置代理；实际代理行为由 Node 的运行方式与网络环境决定。
 *
 * @param {string} rel 相对于 /api/ 的路径及查询串，不是完整 URL。
 * @param {boolean} [binary] 真时读取 Buffer；默认读取 JSON。
 * @returns {Promise<object|Buffer>} 成功线路返回的 JSON 或二进制内容。
 * @throws {Error} 所有候选线路均失败时抛出最后一次错误。
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
 *
 * 图片直接访问 tp.spfcas.com 等图床绝对地址，不拼 /api/、不带 API 签名，只带 UA 与 Referer。
 * 图床可能返回 XOR 包装字节，下载后由 imgMaybeDecrypt 还原。
 *
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
 * 统一姓名比较键：小写并删除指定空格、分隔符；是否转换假名取决于本文件实现。
 * 这是字符串比较规则，不保证同名是同一人，也不能替代跨来源身份映射。
 *
 * 姓名精确匹配键去掉空格和分隔符并转小写；此脚本不做 onKana 假名转换。
 *
 * @param {*} s 原始姓名或别名。
 * @returns {string} 比较用键，不用于替换展示姓名。
 */
const onNorm = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[\s　・·,，、/]+/g, '')

/*
 * 种子覆盖知名及活跃男演员，以日文姓名为主，也包含常见艺名和汉字写法。
 * 一个名字可能搜出同名或别名干扰项，因此必须对归一化姓名精确匹配。
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
 *
 * 图片还原协议：第 0 字节为 XOR 密钥，第 1 字节起分别与密钥异或，输出长度减少 1。
 * 普通 JPEG、PNG、WebP、GIF 等已识别文件头直接返回；后续 isImg 仍仅接受 JPEG/PNG。
 *
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

/**
 * 在搜索结果的 name/name_zht/other_name 中寻找归一化后完全相等的姓名。
 * 仅按英文逗号拆分拼接后的别名，返回第一个命中对象，不做模糊匹配。
 *
 * 处理顺序为种子搜索 → 精确匹配候选 → 人物详情；某一步失败会记录为 missed，不强选相近姓名。
 *
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

;(async () => {
  fs.mkdirSync(AVA_DIR, { recursive: true })
  const out = { fetchedAt: Date.now(), source: 'javdb', list: [] }
  const seen = new Set()
  const missed = []
  let ok = 0

  // 阶段 1：固定种子串行搜索；精确匹配不到直接跳过，不选择搜索结果第一项冒充命中。
  for (const seed of SEED.slice(0, envInt('SEED_LIMIT', SEED.length, 1, SEED.length))) {
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

  writeJson(paths.javdbMaleSeeds, out)
  console.log(
    'relay/javdb/male-seed-actors.json 已生成：' +
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
   *
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
    (process.env.SKIP_IMAGES === '1' ? [] : out.list).map(async r => {
      if (!r.avatar_url) return
      try {
        const u = new URL(r.avatar_url)
        if (!IMG_HOST_OK.test(u.hostname)) return
        const f = avatarPath(AVA_DIR, r.id, r.name)
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
