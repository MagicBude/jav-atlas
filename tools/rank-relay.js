#!/usr/bin/env node

/**
 * @file 从 minnano 页面采集日、周、月榜，并为部分上榜人物补充头像。
 * 流程：依次读取三个榜单，每榜最多两页 → 按站内 ID 去重 → 处理最多 160 位人物的头像 → 写出榜单。
 * 输入：无需本地名册；依赖源站 HTML 的固定标签与类名。
 * 输出：仓库根 relay/minnano-rankings.json，以及 relay/avatars/<minnano ID>.jpg。
 * 约束：榜单为空抛错；头像任务失败由并发池转为 null，不阻止榜单写入。
 * 榜单先写同目录 .tmp 再 rename；这不构成 JSON 与所有头像之间的整体事务。
 * 运行：node tools/rank-relay.js。直接执行即产生网络请求和文件写入。
 *
 * 数据分发：榜单保留 rank/id/name/works 原始字段，头像按 minnano ID 命名。
 * 当使用端无法直连 minnano 时，可通过公开仓库的 raw.githubusercontent.com 或 CDN 读取 JSON 与头像。
 * 抓取与消费解耦，不要求客户端持有 token；当前仓库未实现浏览端。
 * 执行环境可使用 GitHub 托管 runner；家庭网络 SNI 阻断与机房可访问只是网络记录，需实际验证。
 * 运行依赖：Node 18+ 内置 fetch，无第三方依赖。
 */
const fs = require('fs')
const path = require('path')
const { relayDir, writeJson, envInt } = require('./lib/runtime')

const MN_BASE = 'https://www.minnano-av.com/'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const RELAY_DIR = relayDir()
const AVA_DIR = path.join(RELAY_DIR, 'avatars')
const AVA_LIMIT = envInt('AVA_LIMIT', 160, 0, 10000) // 榜上去重后最多抓多少个头像
const TIMEOUT = envInt('HTTP_TIMEOUT_MS', 20000, 1, 120000)

/**
 * 去除标签并解码当前支持的少量 HTML 实体，不是通用 HTML 解析器。
 *
 * @param {*} s 原始片段，空值作为空字符串。
 * @returns {string} 去除首尾空白后的展示文本。
 */
function mnStrip(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .trim()
}

/**
 * 按 <tr> 分块，只处理含 rnkno 的片段，兼容 h2/h3 的姓名标题。
 * 排名、ID、姓名缺任一项便丢弃；作品数缺失为 0；去重与 Top100 截断由调用方完成。
 *
 * @param {string} html 榜单页面 HTML。
 * @returns {Array<{rank: number, id: string, name: string, works: number}>} 保留页面顺序的有效记录。
 */
function parseRankRows(html) {
  const rows = []
  for (const chunk of String(html || '').split('<tr>')) {
    if (!/class="rnkno"/.test(chunk)) continue
    const rank = +((chunk.match(/rnkcnt">(\d+)/) || [])[1] || 0)
    const id = (chunk.match(/actress(\d+)\.html/) || [])[1]
    // 接受 h2 或 h3 标题；这里依赖精确的类名、引号和标签排列，改版时需更新解析样本。
    /*
     * 2026-10 的页面兼容记录：人物名标题由 h2 变为 h3，因此用 h[23] 同时接受两种结构。
     */
    const name = mnStrip((chunk.match(/<h[23] class="ttl"><a[^>]*>([\s\S]*?)<\/a>/) || [])[1])
    const works = +((chunk.match(/<td[^>]*>\s*(\d{1,6})\s*<\/td>/) || [])[1] || 0)
    if (rank && id && name) rows.push({ rank, id, name, works })
  }
  return rows
}

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
 * @returns {Promise<Array<*>>} 按原索引保存结果；单项抛错时对应位置记为 null。
 */
const pool = async (items, n, fn) => {
  // 简易并发池
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

;(async () => {
  fs.mkdirSync(AVA_DIR, { recursive: true })
  // 阶段 1：三个榜单按顺序抓取，避免把尚未抓完的榜单写成完整结果。
  const modes = [
    ['day', 'ranking_actress.php?daily'],
    ['week', 'ranking_actress.php'],
    ['month', 'ranking_actress.php?monthly']
  ]
  const out = { fetchedAt: Date.now() }
  const ids = new Set()
  for (const [key, q] of modes) {
    // 最多读取两页，达到 100 条提前停止；第二页是否足够取决于源站当前分页。
    /*
     * 2026-10 的分页样本为每页 50 条，第二页通过 page=N 请求；最多抓两页并按 ID 去重，目标为 Top100。
     */
    const seen = new Set()
    let rows = []
    for (let page = 1; page <= 2; page++) {
      const sep = q.includes('?') ? '&' : '?'
      const url = MN_BASE + q + (page === 1 ? '' : sep + 'page=' + page)
      const html = await get(url)
      const r = parseRankRows(html)
      if (!r.length) break
      for (const x of r)
        if (!seen.has(x.id)) {
          seen.add(x.id)
          rows.push(x)
        }
      if (rows.length >= 100) break
    }
    if (!rows.length) throw new Error('榜单解析为空：' + q)
    out[key] = rows.slice(0, 100)
    for (const r of rows) ids.add(r.id)
    console.log(key + ' 榜：' + rows.length + ' 条')
  }
  // 阶段 2：按首次出现顺序截取头像任务；三榜去重人数可能超过上限。
  const list = [...ids].slice(0, AVA_LIMIT)
  let ok = 0,
    skip = 0
  await pool(list, 4, async id => {
    const f = path.join(AVA_DIR, id + '.jpg')
    if (fs.existsSync(f) && fs.statSync(f).size > 2048) {
      skip++
      return
    }
    const html = await get(MN_BASE + 'actress' + id + '.html')
    const img = (html.match(/property="og:image" content="([^"]+)"/) ||
      html.match(/<img[^>]+class="[^"]*actress[^"]*"[^>]+src="([^"]+)"/) ||
      [])[1]
    if (!img) return
    const b = await get(new URL(img, MN_BASE).href, true).catch(() => null)
    if (isImg(b)) {
      fs.writeFileSync(f, b)
      ok++
    }
  })
  console.log('头像：新抓 ' + ok + '，已存在 ' + skip + '，共 ' + list.length + ' 个')
  // 阶段 3：头像允许部分失败；所有榜单至少非空后才用临时文件替换 JSON。
  writeJson(path.join(RELAY_DIR, 'minnano-rankings.json'), out)
  console.log('relay/minnano-rankings.json 已生成')
})().catch(e => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
