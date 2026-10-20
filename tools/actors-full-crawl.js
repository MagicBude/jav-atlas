#!/usr/bin/env node

/**
 * @file 从 JavDB 影片中发现演员，合并旧人物资料并补充头像。
 * 发现范围：“全部/有码/无码”三个影片维度，默认各最多 20 页；连续两页无新增便提前结束。
 * 这里的 full 表示累积集合，不保证全站完整；已有 ID 直接复用，不刷新旧人物详情。
 * 输出：RELAY_DIR 下 javdb-actors.json、avatar-supplements.json、female-name-index.json、avatars_jdb/。
 * 默认目录：所有采集器统一使用仓库根 relay/，RELAY_DIR 可覆盖。
 * 配置：MOVIE_PAGES=20，AVA_CONC=6，FIX_LIMIT=400；RELAY_DIR 可覆盖目录。
 * 性别：命中女性姓名集合即 f；未命中先为 ?，再尝试网页复核。没有命中不能证明是男性。
 * 网页配置：WEB_GENDER=0 关闭复核；WEB_PROXY 指定代理；WEB_GENDER_LOCAL 非空时提供默认代理。
 * 网络/读取/图片错误有多种吞错与兜底策略，细节见各函数；顶层未处理错误才令进程非零退出。
 * 保护：已有确认记录复用、未知记录重试、按 map 读取补图缓存，空发现或全部新增详情失败时不覆盖产物。
 * 运行：node tools/actors-full-crawl.js。直接写文件，不保证所有产物一起成功。
 *
 * 设计依据：人物发现依赖影片详情中的 actors，因为 v1/actors 曾返回空集合，无法用作演员目录。
 * 人物详情取自 v1/actors/{id}；资料含 gender，头像使用 JavDB ID 命名。
 * 资料与头像作为浏览端本地资源缺失时的兜底，不要求浏览端直接请求源站。当前仓库未实现该消费端。
 * 运行依赖：Node 18+ 内置 fetch，无第三方采集依赖；API 与网页可能受不同网络限制。
 */
const fs = require('fs')
const path = require('path')
const { relayDir, readJson, writeJson, envInt, compareIds } = require('./lib/runtime')
const crypto = require('crypto')
const { execSync } = require('child_process')

/*
 * JavDB 移动端 API：候选线路共享应用级签名算法，不使用用户账号或登录 token。
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
 * 路径约定：统一以工具库位置确定仓库根 relay/，RELAY_DIR 可提供绝对路径或相对工作目录的覆盖值。
 * 曾因无条件采用 path.join(__dirname, 'relay')，在 Actions 中写入 tools/relay 而触发 ENOENT。
 * 当前共享目录函数固定默认位置，工作流仍显式设置 RELAY_DIR，使运行入口与输出一致。
 */
const RELAY_DIR = relayDir()
const AVA_DIR = path.join(RELAY_DIR, 'avatars_jdb')
const OUT_JSON = path.join(RELAY_DIR, 'javdb-actors.json')
const TIMEOUT = envInt('HTTP_TIMEOUT_MS', 20000, 1, 120000)
const MOVIE_PAGES = envInt('MOVIE_PAGES', 20, 1, 1000) // 翻多少页影片列表（每页 30 部）
const AVA_CONC = envInt('AVA_CONC', 6, 1, 32) // 头像并发
const LINE_OK_K = 'actors_full_line_ok'
let LINE_OK = ''

/**
 * 读取上次成功的 API 线路作为优先尝试对象。文件缺失/读取失败时保留当前 LINE_OK。
 *
 * 成功线路缓存跨次复用，避免每轮从第一条线路重新探测；它不记录人物采集进度。
 *
 * @returns {void} 通过修改模块变量传递结果；不向调用者抛出读取异常。
 */
function loadLine() {
  try {
    LINE_OK = fs.readFileSync(path.join(RELAY_DIR, LINE_OK_K), 'utf8').trim()
  } catch (_) {}
}

/**
 * 持久化最近成功线路。它是请求偏好缓存，不是整个采集任务的断点。
 *
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
 *
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
 *
 * 图床使用绝对 URL，不拼接 /api/，也不附 API 签名；读取的原始字节随后交给 imgMaybeDecrypt。
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
 * 按文件头粗略区分普通图片与 JavDB XOR 包装。已识别文件头或过短输入原样返回。
 * 未知头部时，取第 0 字节为密钥，对其余字节逐一异或；不会验证解码结果。
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
const IMG_HOST_OK = /(^|\.)(spfcas\.com|jdbstatic\.com|javdb\d*\.com)$/i

/**
 * 只接受长度大于 2048 且前两个字节匹配 JPEG/PNG 的数据。
 * 这不是完整图片解码校验；即使解码器识别 WebP/GIF，此判据仍会拒绝它们。
 *
 * @param {Buffer|null} b 待校验内容。
 * @returns {boolean} 是否通过当前轻量判据。
 */
const isImg = b =>
  !!(b && b.length > 2048 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50)))

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
 * 读取已有演员产物供增量合并。只补新 ID，不刷新旧人物详情。
 *
 * 增量策略：读取既有人物并仅补新增 ID。这里复用最终 JSON，不代表每一步都具备中断恢复能力。
 *
 * @returns {{list: Array<object>}} 文件不存在时返回空 list；JSON 损坏或 list 类型错误时中止，防止覆盖。
 */
function loadPrev() {
  const previous = readJson(OUT_JSON, { list: [] })
  if (!Array.isArray(previous.list)) throw new Error('javdb-actors.json 缺少 list 数组')
  return previous
}

/**
 * 将正则覆盖的片假名按 Unicode 偏移转成平假名；汉字原样保留。
 *
 * 姓名比较需要处理全角、假名、汉字写法与别名差异，但此处只执行 onKana 的假名转换及分隔符清理。
 * 例如“松本いちか”与“松本一香”不能靠 Unicode 偏移互转，应依赖候选的姓名/别名字段覆盖。
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

/**
 * 在搜索结果的 name/name_zht/other_name 中寻找归一化后完全相等的姓名。
 * 仅按英文逗号拆分拼接后的别名，返回第一个命中对象，不做模糊匹配。
 *
 * 搜索会混入同名或相近姓名，必须检查 name、name_zht 和 other_name 的精确归一化匹配，不能直接取首项。
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

/**
 * 下载 minnano 的普通图片字节，附带该站 Referer，不经过 JavDB 解码。
 *
 * minnano 原图是普通 HTTPS 图片，无需 JavDB 的 XOR 还原；与图床请求使用不同的 Referer。
 *
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
 * 为当前 minnano-actresses.json 中缺 icon 的人物搜索补充资料，并写出补图映射。
 * 按作品数排序后最多选 FIX_LIMIT 条；不直接修改当前名册。
 *
 * 补图动机：缺人物头像时，消费端可能用影片封面代替，导致人物列表难以辨认。
 * 名册采样记录：24,959 人中 1,141 人（约 4.6%）缺少 icon。
 * 另一批 400 人中，JavDB 仅约 13% 有头像，但 276 人保留 minnano 原图地址。
 * 因此按 JavDB 头像 → 名册 mimg 原图 → 无可用图片的顺序提供来源，不覆盖已有 icon。
 * 这些数量用于解释补图策略，不代表当前仓库的数据规模。
 *
 * @param {Map<string, object>} byId 现有演员映射；当前函数未使用此参数。
 * @returns {Promise<void>} 缺少可用名册时提前返回；文件写入异常向外传播。
 */
async function fixActressesWithoutIcon(byId) {
  const FIX_OUT = path.join(RELAY_DIR, 'avatar-supplements.json')
  const ROSTER = path.join(RELAY_DIR, 'minnano-actresses.json')
  const roster = readJson(ROSTER, [])
  if (!Array.isArray(roster)) throw new Error('minnano-actresses.json 必须为数组')
  const byName = new Map(roster.map(a => [a && a.name, a]))
  const need = roster
    .filter(a => a && a.name && !a.icon)
    .sort((x, y) => (y.videoCount || 0) - (x.videoCount || 0))
    .slice(0, envInt('FIX_LIMIT', 400, 0, 100000)) // 高作品数优先
  if (!need.length) {
    console.log('⑤ 无名册数据，跳过女优补图')
    return
  }

  // 续跑：已有记录直接复用
  const fix = readJson(FIX_OUT, { map: {} }).map
  if (!fix || typeof fix !== 'object' || Array.isArray(fix))
    throw new Error('补图缓存缺少 map 对象')
  // 缓存约定：补图记录位于包装对象的 map 属性，按名字复用以避免重复查询和嵌套包装。
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
  // 补图 JSON 完成临时写入后再替换目标，读取与写入统一使用 map 包装结构。
  /*
   * 覆盖式 rename 曾受部分执行环境限制；当前使用标准临时文件替换，如不支持则显式失败。
   * 不退回直接覆盖旧文件，避免把文件系统错误隐蔽为成功。
   */
  writeJson(FIX_OUT, { fetchedAt: Date.now(), count: Object.keys(fix).length, map: fix })
  const withJdb = Object.values(fix).filter(x => x.avatar_url).length
  const withMn = Object.values(fix).filter(x => !x.avatar_url && x.mimg).length
  console.log(
    '   relay/avatar-supplements.json：共 ' +
      Object.keys(fix).length +
      ' 条 · JavDB 图 ' +
      withJdb +
      '（本次 +' +
      gotJdb +
      '）· JavDB 无图但名册有 minnano 原图 ' +
      withMn
  )
}

/*
 * 性别策略：不能用三围是否存在判断男女。116 位女性的样本中仅 7 位有三围；
 * 另有 880 条按缺少三围判为男性的记录，其中 623 条（约 71%）实际为女性，如安倍亜沙美、AIKA、松本一香。
 * 因此优先反查女性姓名集合（名册规模样本约 2.5 万人），未命中时再尝试网页。
 * 未命中时返回 ?，等待网页或已有依据确认，不默认分配男性/女性。
 */
let FEM_NAMES = null

/**
 * 首次使用时建立归一化女性姓名 Set，后续调用复用同一进程内缓存。
 * 优先读 female-name-index.json；没有条目时回退当前 minnano-actresses.json。文件缺失允许冷启动，损坏数据则中止。
 * 名字精简集合体积样本约 0.75 MB、完整名册约 16 MB；精简输入减少采集环境的名册依赖。
 * 2026-10-07 的运行记录曾因姓名输入缺失新增 21 条误标男性数据，因此不能将缺失输入解释为男性。
 *
 * @returns {Set<string>} 可能为空；空集合不能证明候选人物都是男性。
 */
function loadFemaleNames() {
  if (FEM_NAMES) return FEM_NAMES
  const precise = readJson(path.join(RELAY_DIR, 'female-name-index.json'), { names: [] })
  if (!Array.isArray(precise.names)) throw new Error('female-name-index.json 缺少 names 数组')
  const roster = precise.names.length
    ? precise.names.map(name => ({ name }))
    : readJson(path.join(RELAY_DIR, 'minnano-actresses.json'), [])
  if (!Array.isArray(roster)) throw new Error('minnano-actresses.json 必须为数组')
  FEM_NAMES = new Set()
  const push = name => {
    const key = onNorm(name)
    if (key) FEM_NAMES.add(key)
  }
  for (const a of roster) {
    if (!a || !a.name) continue
    ;[a.name, a.name_ja, a.name_zh, a.name_en].forEach(push)
    if (Array.isArray(a.alias)) a.alias.forEach(push)
  }
  return FEM_NAMES
}

/**
 * 将 gender=f 的人物姓名及别名合并进已有名字集合，仅数量增加时落盘。
 * 集合使用原始字符串；损坏输入或写入失败向上抛出，调用方需确保工作流提交该产物。
 *
 * 女性姓名集合需要随新人物与新别名增长；将本次 gender=f 的姓名合并回文件，避免反查覆盖逐渐落后。
 * 此步骤只扩充已判结果，不会重新验证性别，也不负责将文件提交到 Git。
 *
 * @param {Array<object>} list 本轮合并后的人物集合。
 * @returns {void} 不重新验证已有性别，不删除旧名字。
 */
function updateFemaleNames(list) {
  const file = path.join(RELAY_DIR, 'female-name-index.json')
  const previous = readJson(file, { names: [] })
  if (!Array.isArray(previous.names)) throw new Error('female-name-index.json 缺少 names 数组')
  const names = new Set(previous.names)
  const before = names.size
  for (const a of list) {
    if (!a || a.gender !== 'f' || String(a.genderSource || '').startsWith('unverified')) continue
    ;[a.name, a.name_zht, ...String(a.other_name || '').split(/[,，、]/)].forEach(value => {
      const name = String(value || '').trim()
      if (name && name.length < 60) names.add(name)
    })
  }
  if (names.size !== before) {
    writeJson(file, {
      fetchedAt: Date.now(),
      source: 'minnano-roster+javdb-verified',
      count: names.size,
      names: [...names].sort()
    })
    console.log('   female-name-index.json：' + before + ' → ' + names.size)
  }
}

/**
 * 通过姓名集合做第一阶段性别推断。命中为 f，未命中返回 ?。
 * 未命中只是名单没有覆盖，不能当作事实确认；调用方用 rosterHit 决定是否网页复核。
 *
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
  /*
   * 样本中 256 条默认男性记录有 152 条（约 59%）实际为女性，说明默认值需要网页复核。
   *
   * 姓名集合对欧美人物和部分无码厂商人物覆盖有限，未命中比例高。
   *
   * 名册未命中时保留待复核标记，后续使用网页判断；现有问号表示没有确认依据。
   */
  return { gender: '?', rosterHit: false }
}

/*
 * 网页规则：检查 https://javdb.com/actors/<id> 中所有 section-meta。
 * “男優, 5415 部影片”包含明确男性标记；“81 部影片”只含作品数，当前规则将其判为女性。
 * 必须 matchAll：首个 section-meta 可能只是别名，如鮫島的“鮫島健介”、黒田悠斗的“黒田将稔…”。
 * 只检查首项会把这些男性人物误判为女性；完全没有标签时返回 null。
 * 2026-10-07 的网络记录中，Actions curl 收到 403 / “Just a moment...”，家庭网络收到 200。
 * 机房地址可能受 Cloudflare 限制，网页与 API 的可达性需分别验证；网页失败保留姓名反查结果。
 */
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
  /*
   * 影片发现：三种维度共同收集演员 ID 与名字，扩大单独 latest 列表的覆盖；影片详情提供人物关联。
   * 目录端点返回空与页面不提供性别筛选，是选择影片反推而非逐人搜索的原因。
   */
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
        list = j?.data?.movies
        if (!Array.isArray(list)) throw new Error('影片列表响应缺少 movies 数组')
      } catch (e) {
        console.log('   ' + src.label + ' 第' + page + '页失败：' + e.message)
        throw e
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
      if (ids.length && detail.every(movie => !movie || !Array.isArray(movie.actors))) {
        throw new Error('本页影片详情全部失败或结构无效，停止发布部分结果')
      }
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
      /*
       * 连续两页无新增便停止该维度并继续下一维度。这是节省请求的启发式，不能证明已完整遍历。
       */
      stall = added === 0 ? stall + 1 : 0
      if (stall >= 2) break
    }
  }
  if (!found.size) throw new Error('未发现演员，保留已有文件；请检查 API 与分页响应')
  console.log('   影片反推共 ' + found.size + ' 个演员')

  // 阶段 2：旧记录优先，只有尚未出现的 ID 才请求人物详情；历史资料不会刷新。
  /*
   * 将已有演员集合并入 Map，待抓列表仅包含新 ID，避免重复请求已收录人物。
   */
  const prev = loadPrev()
  const byId = new Map((prev.list || []).map(a => [a.id, a]))
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
    // 命中名册使用 f；未命中先保留 ?，并以 pending-web 标记等待复核。
    /*
     * 命中名册写入 f；未命中先保留 ?，genderSource 标记 pending-web，随后尝试网页复核。
     */
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

  // 阶段 3：复核新旧集合中尚无可信依据的人物，禁用网页时未命中者保留 unverified。
  /*
   * 网页复核只处理没有可靠来源的记录；已确认旧人物直接复用，避免每天产生约千次重复请求。
   */
  if (todo.length && !done) throw new Error('新增演员详情全部失败，保留已有文件')
  // smoke 留下的未知记录必须能在后续 daily 获得姓名/网页依据后被确认，不能永久跳过。
  const pending = []
  for (const r of byId.values()) {
    if (
      ['f', 'm'].includes(r.gender) &&
      !['pending-web', 'unverified', 'roster-heuristic'].includes(r.genderSource)
    )
      continue
    const inferred = genderOf(r)
    r.gender = inferred.gender
    r.genderSource = inferred.rosterHit ? 'roster' : 'unverified'
    if (!inferred.rosterHit) pending.push(r)
  }
  if (WEB_ON && pending.length) {
    console.log('②b 性别复核（网页版 section-meta）：' + pending.length + ' 位…')
    await pool(pending, 8, async r => {
      const g = webGenderOf(r.id)
      if (g) {
        r.gender = g
        r.genderSource = 'javdb-web-section-meta'
      } else r.genderSource = 'unverified'
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
    (a, b) => (Number(b.videos_count) || 0) - (Number(a.videos_count) || 0) || compareIds(a, b)
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

  // 阶段 5：已有确认记录保持不动；缺少新依据的记录保留问号，不做数量推测或默认分配。
  out.female = list.filter(a => a.gender === 'f').length
  out.male = list.filter(a => a.gender === 'm').length
  out.unknown = list.filter(a => a.gender === '?').length
  writeJson(OUT_JSON, out)
  updateFemaleNames(list)
  console.log(
    '③ relay/javdb-actors.json 已生成：共 ' +
      out.count +
      ' 位（女优 ' +
      out.female +
      ' · 男优 ' +
      out.male +
      ' · 未知 ' +
      out.unknown +
      '）'
  )

  // 阶段 6：读取当前名册做补图；名册缺失时跳过，JSON 主产物此前已经写出。
  /*
   * 补图限定为名册中缺 icon 的人物，不替换已有头像；缺图率样本为 4.6%。
   * avatar-supplements.json 实际结构为 { fetchedAt, count, map: { 名字: { id, avatar_url, videos_count, ... } } }。
   */
  await fixActressesWithoutIcon(byId)

  /*
   * 头像集合同时包含人物资料中的 JavDB 图片与缺图名册的补充来源；JavDB 无图时可用 minnano 原图。
   */
  let avOk = 0,
    avSkip = 0,
    avMiss = 0,
    avMn = 0
  let fixMap = {}
  try {
    fixMap =
      (JSON.parse(fs.readFileSync(path.join(RELAY_DIR, 'avatar-supplements.json'), 'utf8')) || {})
        .map || {}
  } catch (_) {}
  // 阶段 7：合并演员头像与补图映射，允许图片失败，不回滚此前写出的 JSON。
  const avaList =
    process.env.SKIP_IMAGES === '1'
      ? []
      : [
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
