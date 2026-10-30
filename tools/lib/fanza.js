/** FANZA的商品ID只是候选地址，必须用返回的厂商番号二次校验，不能据此直接绑定。 */
const normalize = value =>
  String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s-]/g, '')
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
  if (
    !movie ||
    movie.id !== candidateId ||
    normalize(movie.makerContentId) !== normalize(local.code)
  )
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
module.exports = { candidates, checkedRecord }
