/**
 * @file minnano作品的纯解析函数：只处理人物作品表/作品信息表，排除推荐和广告。
 * 不联网也不写文件；遇到验证页或缺少主体结构便抛错，不能把失败页面当作空集合。
 */
const BASE = 'https://www.minnano-av.com/'
function text(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
function attrs(tag, name) {
  return (
    tag
      .match(new RegExp('\\b' + name + '=\\s*["\']([^"\']*)["\']', 'i'))?.[1]
      ?.replace(/&amp;/g, '&') || ''
  )
}
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap(m => {
    const href = attrs(m[1], 'href') || m[1].match(/href=([^\s>]+)/i)?.[1]
    if (!href) return []
    const url = new URL(href, BASE)
    return ['http:', 'https:'].includes(url.protocol) ? [{ text: text(m[2]), url: url.href }] : []
  })
}
function date(value) {
  const m = value.match(/(\d{4})[年/\-]\s*(\d{1,2})[月/\-]\s*(\d{1,2})/)
  if (!m) return null
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return Number.isFinite(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d ? d : null
}
function guard(html) {
  if (/Just a moment|cf-chl-|challenge-platform\/h\/g/i.test(html.slice(0, 12000)))
    throw Error('源站验证页')
}
function parseList(html, actorId, page) {
  guard(html)
  if (!new RegExp('actress' + actorId + '\\.html').test(html)) throw Error('人物身份无法确认')
  const block = html.match(
    /<div class="act-video-list">([\s\S]*?)<\/div>\s*<!-- \/\.act-video-list -->/
  )?.[1]
  if (!block) throw Error('缺少作品列表容器')
  const entries = []
  for (const row of block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const title = row[1].match(
      /<h[23]\b[^>]*class="ttl"[^>]*>\s*<a\b[^>]*href="av((?:uk)?\d+)\.html"[^>]*>([\s\S]*?)<\/a>/
    )
    if (!title) continue
    const imageTag = row[1].match(/<img\b[^>]*>/i)?.[0] || ''
    const image = attrs(imageTag, 'data-src') || attrs(imageTag, 'src')
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]))
    const casts = [...row[1].matchAll(/<p class="cast">([\s\S]*?)<\/p>/g)]
    const id = title[1]
    entries.push({
      id,
      kind: id.startsWith('uk') ? 'unknown' : 'work',
      title: text(title[2]),
      sourceUrl: BASE + 'av' + id + '.html',
      releaseDate: date(cells[2] || ''),
      coverUrl: image && !/\/(blank|np)\.(gif|jpg)/i.test(image) ? new URL(image, BASE).href : null,
      makerText: text(casts[1]?.[1]),
      cast: links(casts[0]?.[1] || '')
        .map(a => ({ id: a.url.match(/actress(\d+)\.html/)?.[1], name: a.text }))
        .filter(a => a.id),
      raw: { date: cells[2] || '', maker: text(casts[1]?.[1]) }
    })
  }
  if (
    !entries.length &&
    !/作品.{0,15}(ありません|登録されていません)|該当.{0,10}(なし|ありません)/.test(block)
  )
    throw Error('空列表未得到明确确认')
  const pagination = html.match(/<div class="pagination">([\s\S]*?)<\/div>/)?.[1] || ''
  const active = pagination.match(/<u>\s*(\d+)\s*<\/u>/)?.[1]
  if ((page > 1 || active) && Number(active) !== page) throw Error('返回页码不匹配')
  const pages = links(pagination)
    .map(a => new URL(a.url))
    .filter(
      u =>
        u.origin === new URL(BASE).origin &&
        u.pathname === '/actress.php' &&
        u.searchParams.get('actress_id') === actorId
    )
    .map(u => Number(u.searchParams.get('page')))
    .filter(n => Number.isSafeInteger(n) && n > page)
  if (pages.length && !pages.includes(page + 1)) throw Error('分页链缺少下一页')
  return { entries, nextPage: pages.includes(page + 1) ? page + 1 : null }
}
function parseDetail(html, id) {
  guard(html)
  if (!/^\d+$/.test(id)) throw Error('不请求占位详情')
  const canonical =
    html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1] ||
    html.match(/property="og:url" content="([^"]+)"/)?.[1]
  if (!canonical || new URL(canonical, BASE).pathname !== `/av${id}.html`)
    throw Error('作品身份无法确认')
  const block = html.match(
    /<div class="av-data[^">]*">\s*<table[^>]*class="prof-table"[^>]*>([\s\S]*?)<\/table>/
  )?.[1]
  if (!block) throw Error('缺少作品信息表')
  const profileFields = [...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].flatMap(m => {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)]
    return cells.length >= 2
      ? [{ label: text(cells[0][1]), text: text(cells[1][1]), links: links(cells[1][1]) }]
      : []
  })
  const get = label => profileFields.find(f => f.label === label)
  const title = get('作品名')?.text
  if (!title) throw Error('作品标题为空')
  return {
    id,
    sourceUrl: BASE + `av${id}.html`,
    title,
    code: block.match(/data-code="([^"]+)"/)?.[1] || get('品番')?.text || null,
    releaseDate: date(get('発売日')?.text || ''),
    makerText: get('メーカー/レーベル')?.text || '',
    cast: (get('出演者')?.links || [])
      .map(a => ({ id: a.url.match(/actress(\d+)\.html/)?.[1], name: a.text }))
      .filter(a => a.id),
    profileFields
  }
}
module.exports = { parseList, parseDetail }
