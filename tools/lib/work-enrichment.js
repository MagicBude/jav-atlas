/**
 * @file 小样本JavDB补充数据转换：两站身份独立，番号双重验证，不覆盖minnano记录。
 * 只保存作品元数据和公开评论展示字段，不带账号凭据、资源链接或用户内部ID。
 */
const normalize = value =>
  String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
/** 搜索结果再少也不能模糊兜底；保留前导零，只接受唯一规范番号候选。 */
function matchCandidate(code, search) {
  if (!Array.isArray(search.data?.movies)) throw Error('搜索响应缺少作品数组')
  const candidates = (search.data?.movies || []).filter(
    row => normalize(row.number || row.code) === normalize(code)
  )
  if (!normalize(code) || candidates.length !== 1)
    throw Object.assign(Error('番号未唯一精确匹配'), {
      matchStatus: candidates.length > 1 ? 'ambiguous' : 'unmatched'
    })
  if (!/^[a-zA-Z0-9]+$/.test(String(candidates[0].id || ''))) throw Error('来源作品ID无效')
  return candidates[0]
}
function project(local, search, detail, pages, fetchedAt) {
  const candidate = matchCandidate(local.code, search)
  const movie = detail.data?.movie
  if (
    !movie ||
    movie.id !== candidate.id ||
    normalize(movie.number || movie.code) !== normalize(local.code)
  )
    throw Error('作品详情身份不一致')
  const fields = [
    'id',
    'number',
    'title',
    'duration',
    'score',
    'reviews_count',
    'comments_count',
    'want_watch_count',
    'watched_count',
    'maker_id',
    'maker_name',
    'publisher_id',
    'publisher_name',
    'director_id',
    'director_name',
    'series_id',
    'series_name',
    'tags',
    'actors',
    'thumb_url',
    'cover_url',
    'release_date'
  ]
  const metadata = Object.fromEntries(
    fields.filter(key => Object.hasOwn(movie, key)).map(key => [key, movie[key]])
  )
  // 评论按原生ID去重；未知评分保留null，不伪造零分。正文仅作为文本交给React渲染。
  const reviews = new Map()
  for (const page of pages)
    for (const row of page.data?.reviews || []) {
      if (row.id == null) continue
      reviews.set(String(row.id), {
        id: String(row.id),
        author: String(row.username || ''),
        score:
          row.score == null || row.score === ''
            ? null
            : Number.isFinite(Number(row.score))
              ? Number(row.score)
              : null,
        content: String(row.content || ''),
        likes: Number(row.likes_count) || 0,
        createdAt: String(row.created_at || ''),
        status: String(row.status_title || '')
      })
    }
  const sourceUrl = `https://javdb.com/v/${movie.id}`
  return {
    record: {
      schemaVersion: 1,
      id: movie.id,
      source: 'javdb',
      sourceUrl,
      fetchedAt,
      metadata,
      reviews: [...reviews.values()],
      reviewScope: {
        pagesRequested: pages.length,
        saved: reviews.size,
        complete: false,
        ordering: 'unverified'
      }
    },
    mapping: {
      minnanoId: local.id,
      javdbId: movie.id,
      code: local.code,
      method: 'unique-exact-code-and-detail-id',
      checkedAt: fetchedAt,
      dateDifference: !!(
        local.releaseDate &&
        movie.release_date &&
        local.releaseDate !== movie.release_date
      ),
      minnanoDate: local.releaseDate || null,
      javdbDate: movie.release_date || null
    }
  }
}
module.exports = { project, matchCandidate }
