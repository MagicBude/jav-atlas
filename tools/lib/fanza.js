/** FANZA的商品ID只是候选地址，必须用返回的厂商番号二次校验，不能据此直接绑定。 */
/**
 * 借鉴OpenAver的严格号码比较：只对“字母前缀+纯数字”忽略数字补零。
 * OFJE00528与OFJE-528相同；分片后缀、数字厂商前缀不随意删掉，避免串片。
 * 这里只比较号码，不改写任何来源的原始编号。
 */
function codeKey(value) {
  const text = String(value || '')
    .normalize('NFKC')
    .trim()
    .toUpperCase()
  const match = text.match(/^([A-Z]+)-?(\d+)$/)
  return match ? `${match[1]}:${match[2].replace(/^0+/, '') || '0'}` : null
}
function sameCode(left, right) {
  const key = codeKey(left)
  return key !== null && key === codeKey(right)
}
function candidates(code) {
  const match = String(code).match(/^([A-Za-z]+)-?(\d+)$/)
  if (!match) return []
  return [
    ...new Set([
      match[1].toLowerCase() + match[2].padStart(5, '0'),
      match[1].toLowerCase() + match[2]
    ])
  ]
}
function checkedRecord(local, movie, candidateId, now) {
  if (!movie || movie.id !== candidateId || !sameCode(movie.makerContentId, local.code))
    throw Error('FANZA商品身份或番号不一致')
  return {
    source: 'fanza',
    minnanoId: String(local.id),
    code: local.code,
    fetchedAt: now,
    sourceUrl: `https://video.dmm.co.jp/av/content/?id=${encodeURIComponent(movie.id)}`,
    metadata: {
      id: movie.id,
      makerContentId: movie.makerContentId,
      durationSeconds:
        Number.isFinite(movie.duration) && movie.duration > 0 ? movie.duration : null,
      directors: movie.directors || [],
      series: movie.series || null,
      maker: movie.maker || null,
      label: movie.label || null,
      genres: movie.genres || [],
      makerReleasedAt: movie.makerReleasedAt || null
    }
  }
}
/** 搜索返回的商品ID可能带厂商数字前缀；这里只用于筛选候选，不作为最终绑定证据。 */
function searchCandidates(code, contents) {
  return [
    ...new Set(
      contents
        .map(row => row?.id)
        .filter(id => {
          if (typeof id !== 'string') return false
          const match = id.match(/^(?:(?:h_\d+)|\d+)?([a-z]+)(\d+)$/i)
          return match && sameCode(match[1] + match[2], code)
        })
    )
  ]
}

/**
 * 请求由调用者注入：便于离线验证“相似结果不误选”和多版本歧义，不依赖真实网络。
 * 每部最多2次直查+1次搜索+2次详情。搜索结果超过2个等价候选时直接待确认。
 */
async function resolveFanza(local, request, now = Date.now) {
  const observations = []
  async function detail(id, via) {
    const data = await request('detail', { id })
    if (!data.data || !Object.hasOwn(data.data, 'ppvContent')) throw Error('FANZA详情响应结构无效')
    const movie = data.data.ppvContent
    const observation = {
      via,
      candidateId: id,
      returnedId: movie?.id ?? null,
      returnedCode: movie?.makerContentId ?? null
    }
    observations.push(observation)
    if (!movie) return null
    try {
      return checkedRecord(local, movie, id, now())
    } catch (error) {
      observation.rejected = error.message
      return null
    }
  }
  try {
    const direct = candidates(local.code)
    for (const id of direct) {
      const record = await detail(id, 'direct')
      if (record) return { record, observations }
    }
    const key = codeKey(local.code)
    if (!key) return { record: null, observations }
    const data = await request('search', {
      limit: 20,
      sort: 'RELEASE_DATE',
      queryWord: key.replace(':', ' ')
    })
    const contents = data.data?.legacySearchPPV?.result?.contents
    if (!Array.isArray(contents)) throw Error('FANZA搜索响应结构无效')
    const ids = searchCandidates(local.code, contents)
    observations.push({
      via: 'search',
      returnedIds: contents.map(row => row?.id ?? null),
      eligibleIds: ids
    })
    if (ids.length > 2)
      return { record: null, observations, reason: '搜索返回多个版本，超过核查预算，待人工确认' }
    const matches = []
    for (const id of ids.filter(id => !direct.includes(id))) {
      const record = await detail(id, 'search-detail')
      if (record) matches.push(record)
    }
    return {
      record: matches.length === 1 ? matches[0] : null,
      observations,
      reason:
        matches.length > 1 ? '搜索返回多个同番号商品，未自动选择版本' : '候选商品未得到精确番号匹配'
    }
  } catch (error) {
    error.observations = observations
    throw error
  }
}
module.exports = { candidates, checkedRecord, sameCode, searchCandidates, resolveFanza }
