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
module.exports = { candidates, checkedRecord, sameCode }
