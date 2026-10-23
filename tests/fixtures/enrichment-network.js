/** 元数据测试只用合成响应；不访问真实API，不抓评论或图片。 */
global.fetch = async value => {
  if (process.env.ENRICH_FIXTURE_RATE_LIMIT === '1')
    return new Response('', { status: 429, headers: { 'retry-after': '600' } })
  const url = new URL(value)
  if (url.pathname.endsWith('/search')) {
    const number = url.searchParams.get('q')
    const id = number === 'TEST-001' ? 'A' : 'B'
    const movies = [{ id, number }]
    if (process.env.ENRICH_FIXTURE_AMBIGUOUS === number) movies.push({ id: 'C', number })
    return Response.json({ data: { movies } })
  }
  if (/\/movies\/[AB]$/.test(url.pathname)) {
    const id = url.pathname.split('/').pop()
    return Response.json({
      data: {
        movie: {
          id,
          number: id === 'A' ? 'TEST-001' : 'TEST-002',
          score: '4.2',
          duration: 120,
          release_date: '2026-01-01'
        }
      }
    })
  }
  throw Error('未声明的元数据测试请求')
}
