#!/usr/bin/env node

/**
 * @file 为已有 minnano 名册补齐缺失头像，不创建或扩充人物名册。
 * 输入：仓库根 relay/minnano/actresses.json；可选读取 minnano/rankings.json 并加入新上榜 ID。
 * 输出：relay/minnano/avatars/<minnano ID>_<姓名>.jpg。超过 2048 字节的现有文件直接复用。
 * 参数：[limit] 默认 400；full 或 0 表示不限量，其他值通过 parseInt 解释。
 * 流程：合并候选 ID → 筛出缺图记录 → 截取本轮数量 → 4 个 worker 抓资料页及图片。
 * 限制：失败记录不会持久化，后续运行仍可能从同一批缺图人物开始；不保证每日推进到所有人物。
 * 运行：node tools/roster-avatars.js 400。需要先有名册。
 *
 * 数据来源：minnano/actresses.json 的 mnid/name 与 minnano/rankings.json 的榜上 ID 合并，不回写名册。
 * 从资料页 og:image 获取头像，仅为缺少有效体积文件的人物补图；full/0 表示不限任务数。
 * 全量回填样本约 2.4 万张、1～2 小时，不能作为当前规模或耗时承诺。
 * 使用 Node 18+ 内置 fetch，不增加第三方依赖。
 */
const fs = require('fs')
const { avatarPath } = require('./lib/avatars')
const { readJson, envInt } = require('./lib/runtime')
const { dataPaths } = require('./lib/data-paths')
const paths = dataPaths()

const MN_BASE = 'https://www.minnano-av.com/'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const AVA_DIR = paths.minnanoAvatars
const TIMEOUT = envInt('HTTP_TIMEOUT_MS', 20000, 1, 120000)

const limit = (() => {
  const a = process.argv[2]
  if (!a) return 400
  if (/^0$/i.test(a) || /^full$/i.test(a)) return Infinity
  return parseInt(a, 10) || 400
})()

/**
 * 按 URL 请求 HTML 或图片，单次超时 20 秒，不执行额外重试。
 *
 * @param {string} url 请求地址。
 * @param {boolean} [binary] 真时读取图片字节，否则读取文本。
 * @returns {Promise<string|Buffer>} 响应正文；不在此处校验 HTML 或图片内容。
 * @throws {Error} HTTP 非成功、超时或网络错误。
 */
async function get(url, binary) {
  const rs = await fetch(url, {
    headers: {
      'user-agent': UA,
      referer: MN_BASE,
      accept: binary ? 'image/jpeg,image/png,*/*' : 'text/html'
    },
    signal: AbortSignal.timeout(TIMEOUT)
  })
  if (!rs.ok) throw new Error('HTTP ' + rs.status + ' ' + url)
  return binary ? Buffer.from(await rs.arrayBuffer()) : await rs.text()
}

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
 * @returns {Promise<void>} 只等待所有任务；回调异常被忽略，结果由调用方计数或落盘。
 */
const pool = async (items, n, fn) => {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++
        try {
          await fn(items[k], k)
        } catch (_) {}
      }
    })
  )
}

;(async () => {
  fs.mkdirSync(AVA_DIR, { recursive: true })
  const roster = readJson(paths.minnanoActresses, null)
  if (!Array.isArray(roster)) throw new Error('缺少名册：请先运行 bootstrap-roster.js')
  // 阶段 1：名册是必需输入；榜单是可选补充，不会回写名册。
  const names = new Map(roster.map(r => [String(r.mnid), r.name]))
  const ids = []
  for (const r of roster) if (r && r.mnid) ids.push(String(r.mnid))
  try {
    // 榜上 id 并入：新上榜的女优 roster 快照可能还没收录
    const rk = JSON.parse(fs.readFileSync(paths.minnanoRankings, 'utf8'))
    for (const k of ['day', 'week', 'month'])
      for (const r of rk[k] || []) {
        if (!names.has(String(r.id))) names.set(String(r.id), r.name)
        if (r.id && !ids.includes(String(r.id))) ids.push(String(r.id))
      }
  } catch (_) {}
  // 阶段 2：仅按文件存在及体积决定是否重抓，不检查已有文件是否完整可解码。
  const miss = ids.filter(id => {
    const f = avatarPath(AVA_DIR, id, names.get(String(id)))
    return !(fs.existsSync(f) && fs.statSync(f).size > 2048)
  })
  const todo = miss.slice(0, limit)
  console.log(
    '名册 ' +
      ids.length +
      ' · 缺头像 ' +
      miss.length +
      ' · 本轮抓 ' +
      todo.length +
      (limit === Infinity ? '（全量）' : '')
  )
  let ok = 0,
    fail = 0
  // 阶段 3：每项失败只累计 fail，整批结束后不因单项失败非零退出。
  await pool(todo, 4, async (id, i) => {
    try {
      const html = await get(MN_BASE + 'actress' + id + '.html')
      const img = (html.match(/property="og:image" content="([^"]+)"/) ||
        html.match(/<img[^>]+class="[^"]*actress[^"]*"[^>]+src="([^"]+)"/) ||
        [])[1]
      if (!img) {
        fail++
        return
      }
      const b = await get(new URL(img, MN_BASE).href, true).catch(() => null)
      if (isImg(b)) {
        fs.writeFileSync(avatarPath(AVA_DIR, id, names.get(String(id))), b)
        ok++
      } else {
        fail++
      }
    } catch (_) {
      fail++
    }
    if ((i + 1) % 100 === 0) console.log('进度 ' + (i + 1) + '/' + todo.length + ' · ok=' + ok)
  })
  console.log('完成：新抓 ' + ok + ' · 失败 ' + fail + ' · 名册仍缺 ' + (miss.length - ok))
})().catch(e => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
