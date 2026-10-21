/** minnano 公开人物目录解析，不把推荐栏、广告或重复资料按钮当成新人物。 */
const BASE = 'https://www.minnano-av.com/'
const text = value =>
  String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .trim()

/**
 * 只解析带 ttl 标题的人物行；分页标记必须与所请求页一致，避免被重定向到首页后假装翻页。
 * @param {string} html 源站目录 HTML。
 * @param {number} expectedPage 请求页码。
 * @returns {{page:number,totalPages:number,totalPeople:number,rows:object[]}} 当前页面快照。
 */
function parseDirectory(html, expectedPage, expectedGroup) {
  const info = html.match(
    /class=["']page_info["'][^>]*>\s*(\d+)\s*\/\s*(\d+)\s*ページ\s*\(([\d,]+)件\)/
  )
  if (info && Number(info[1]) !== expectedPage)
    throw new Error('目录页码与请求不一致：' + expectedPage)
  if (!info && (expectedPage !== 1 || !expectedGroup))
    throw new Error('目录页码标记缺失：' + expectedPage)
  const rows = new Map()
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const block = match[1]
    const heading = block.match(
      /<h[23][^>]*class=["'][^"']*\bttl\b[^"']*["'][^>]*>\s*<a\b[^>]*href=["'](?:\/)?actress(\d+)\.html[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    )
    if (!heading) continue
    const name = text(heading[2])
    if (!name) throw new Error('目录人物姓名为空')
    const image = block.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1]
    const row = { mnid: heading[1], name, msrc: BASE + 'actress' + heading[1] + '.html' }
    if (image) {
      const url = new URL(text(image), BASE)
      if (url.origin === new URL(BASE).origin && /^\/p_actress[^/]*\//.test(url.pathname))
        row.mimg = url.href
    }
    const works = block.match(/<\/td>\s*<td[^>]*>\s*([\d,]+)\s*<\/td>/i)?.[1]
    if (works) row.videoCount = Number(works.replaceAll(',', ''))
    rows.set(row.mnid, row)
  }
  if (!info) {
    // 只有当前分组的规范URL与有效人物行都匹配、且不足一页时，才允许无分页栏。
    const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
    const url = canonical ? new URL(text(canonical), BASE) : null
    if (
      !url ||
      url.origin !== new URL(BASE).origin ||
      url.pathname !== '/actress_list.php' ||
      url.searchParams.get('gojuon') !== expectedGroup ||
      (url.searchParams.get('page') && url.searchParams.get('page') !== '1') ||
      !rows.size ||
      rows.size >= 30
    ) {
      throw new Error('单页目录缺少足够依据，保留检查点')
    }
    return { page: 1, totalPages: 1, totalPeople: rows.size, rows: [...rows.values()] }
  }
  const totalPages = Number(info[2]),
    totalPeople = Number(info[3].replaceAll(',', ''))
  if (!rows.size || totalPages < expectedPage || !totalPeople)
    throw new Error('目录解析为空或总数无效')
  return { page: expectedPage, totalPages, totalPeople, rows: [...rows.values()] }
}
module.exports = { parseDirectory }
